import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { validateCProject, canonicalCProject } from '../app/lib/coding/c-project';
import type { CProject } from '../app/lib/coding/c-project';
import { C_LIMITS, createCCompiler } from './c-runner';

export function createCAPI(config: Parameters<typeof createCCompiler>[0]) {
  const compiler = createCCompiler(config);
  const reviews = new Map<string, { hash: string; expires: number }>();
  const hash = (project: CProject) => createHash('sha256').update(canonicalCProject(project)).digest('hex');
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  return {
    close: () => compiler.close(),
    async handle(request: Request): Promise<Response> {
      const requestId = randomUUID();
      const route = new URL(request.url).pathname;
      if (route === '/api/c/info' && request.method === 'GET') {
        try {
          return json({ edition: 'c17', ...(await compiler.info()) });
        } catch {
          return json({
            edition: 'c17',
            available: false,
            error:
              'Install and start local Docker Engine/Desktop, then explicitly fetch the digest-pinned image. No host compilation fallback.',
          });
        }
      }
      if (request.method !== 'POST')
        return json({ error: 'Use POST for C source review and execution', requestId }, 405);
      if (!request.headers.get('content-type')?.startsWith('application/json'))
        return json({ error: 'JSON source payload required', requestId }, 415);
      const length = Number(request.headers.get('content-length') || 0);
      if (length > 400000) return json({ error: 'C project exceeds the request bound', requestId }, 413);
      try {
        const bytes = await readBoundedBody(request, 400000);
        if (bytes.byteLength > 400000) return json({ error: 'C project exceeds the request bound', requestId }, 413);
        const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        for (const [ticket, review] of reviews) if (review.expires < Date.now()) reviews.delete(ticket);
        if (route === '/api/c/preview') {
          const project = validateCProject(value);
          if (reviews.size >= 20)
            return json({ error: 'Too many pending reviews. Complete or wait for expiry.', requestId }, 429);
          const ticket = randomBytes(32).toString('hex');
          const digest = hash(project);
          reviews.set(ticket, { hash: digest, expires: Date.now() + 120000 });
          return json({
            requestId,
            ticket,
            hash: digest,
            files: Object.keys(project.files).sort(),
            expiresInSeconds: 120,
            limits: {
              compiler: 'C17 GCC fixed argument vector',
              ...C_LIMITS,
              cpu: 1,
              network: 'none',
              rootFilesystem: 'read-only',
              hostMounts: false,
              privileged: false,
            },
          });
        }
        if (route !== '/api/c/run') return json({ error: 'Unknown C operation', requestId }, 404);
        if (
          !value ||
          typeof value !== 'object' ||
          Array.isArray(value) ||
          Object.keys(value).some((key) => !['project', 'ticket'].includes(key))
        )
          return json({ error: 'Invalid reviewed run request', requestId }, 400);
        const project = validateCProject(value.project);
        if (typeof value.ticket !== 'string')
          return json({ error: 'An explicit source review is required', requestId }, 403);
        const review = reviews.get(value.ticket);
        reviews.delete(value.ticket);
        if (!review || review.expires < Date.now() || review.hash !== hash(project))
          return json(
            { error: 'Review expired, reused or source changed. Review the exact source again.', requestId },
            403,
          );
        const result = await compiler.execute(project, { requestId, signal: request.signal });
        return json(result);
      } catch (error) {
        return json(
          { error: error instanceof Error ? error.message.slice(0, 500) : 'C operation failed', requestId },
          400,
        );
      }
    },
  };
}

async function readBoundedBody(request: Request, maximum: number): Promise<ArrayBuffer> {
  if (!request.body) throw new Error('A JSON body is required');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) {
        await reader.cancel();
        throw new Error('C request body exceeds the bound');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result.buffer;
}
