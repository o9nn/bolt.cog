import http from 'node:http';
import path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { createLocalToolFactory } from './local-tools';

const mime: Record<string, string> = {
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
};
const security = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
};

type FetchHandler = (request: Request, context: any) => Promise<Response>;
export async function startLocalServer({
  token,
  assetsDir,
  workspace,
  auditFile,
  env,
  handler,
  port = 0,
}: {
  token: string;
  assetsDir: string;
  workspace: string;
  auditFile: string;
  env: Record<string, string>;
  handler: FetchHandler;
  port?: number;
}) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid local capability');
  const root = await realpath(assetsDir);
  const createTools = createLocalToolFactory(workspace, auditFile);
  let origin = '';
  const server = http.createServer(async (req, res) => {
    const abort = new AbortController();
    req.once('aborted', () => abort.abort());
    res.once('close', () => {
      if (!res.writableEnded) abort.abort();
    });
    const deny = (status: number, message: string) => {
      res.writeHead(status, { ...security, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: message }));
    };
    try {
      if (req.headers.host !== new URL(origin).host) return deny(403, 'Invalid local host');
      const supplied = req.headers['x-bolt-desktop-token'];
      if (
        typeof supplied !== 'string' ||
        supplied.length !== token.length ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))
      )
        return deny(401, 'Desktop capability required');
      if (req.headers.origin && req.headers.origin !== origin) return deny(403, 'Foreign origin denied');
      if (!req.url?.startsWith('/') || req.url.startsWith('//')) return deny(400, 'Invalid request target');
      const url = new URL(req.url, origin);
      if (url.pathname === '/api/desktop/info' && req.method === 'GET') {
        res.writeHead(200, { ...security, 'Content-Type': 'application/json' });
        return res.end(
          JSON.stringify({
            runtime: 'desktop',
            nativeTools: 'read-only',
            workspaceId: 'desktop',
            provider: env.LLM_PROVIDER || 'anthropic',
            model: env.LLM_MODEL || env.ANTHROPIC_MODEL || '',
            providerConfigured:
              env.LLM_PROVIDER === 'openai-compatible'
                ? Boolean(env.LLM_MODEL && env.LLM_BASE_URL)
                : Boolean(env.ANTHROPIC_API_KEY),
          }),
        );
      }
      if (req.method === 'GET' || req.method === 'HEAD') {
        let relative: string;
        try {
          relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
        } catch {
          return deny(400, 'Invalid asset path');
        }
        if (
          relative.split(/[\\/]/).some((part) => part === '..' || part.startsWith('.')) ||
          relative.includes('\0') ||
          relative.includes('\\')
        )
          return deny(403, 'Asset path denied');
        const candidate = path.resolve(root, relative);
        if (candidate.startsWith(root + path.sep)) {
          try {
            const actual = await realpath(candidate);
            if (!actual.startsWith(root + path.sep)) return deny(403, 'Asset path denied');
            if ((await stat(actual)).isFile()) {
              res.writeHead(200, {
                ...security,
                'Content-Type': mime[path.extname(actual)] || 'application/octet-stream',
              });
              return res.end(req.method === 'HEAD' ? undefined : await readFile(actual));
            }
          } catch {
            /* Remix handles missing public files and application routes. */
          }
        }
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 1_048_576) return deny(413, 'Request body too large');
        chunks.push(chunk);
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (name === 'x-bolt-desktop-token' || value === undefined) continue;
        headers.set(name, Array.isArray(value) ? value.join(', ') : value);
      }
      const method = req.method || 'GET';
      const request = new Request(url, {
        method,
        headers,
        signal: abort.signal,
        body: ['GET', 'HEAD'].includes(method) ? undefined : Buffer.concat(chunks),
      });
      // Server-owned context only; client input can never select this trust boundary.
      const response = await handler(request, {
        cloudflare: { env },
        desktop: { createTools, workspaceId: 'desktop' },
      });
      response.headers.forEach((value, key) => res.setHeader(key, value));
      for (const [key, value] of Object.entries(security)) res.setHeader(key, value);
      res.statusCode = response.status;
      if (!response.body || method === 'HEAD') return res.end();
      const reader = response.body.getReader();
      const cancelReader = () => {
        void reader.cancel().catch(() => {});
      };
      abort.signal.addEventListener('abort', cancelReader, { once: true });
      try {
        while (!abort.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!res.write(value))
            await new Promise<void>((resolve) => {
              res.once('drain', resolve);
              res.once('close', resolve);
            });
        }
        res.end();
      } finally {
        abort.signal.removeEventListener('abort', cancelReader);
        reader.releaseLock();
      }
    } catch {
      if (!res.headersSent) deny(500, `Local request failed [${randomUUID()}]`);
      else res.destroy();
    }
  });
  server.requestTimeout = 100_000;
  server.headersTimeout = 15_000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Local server did not bind');
  origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    server,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
