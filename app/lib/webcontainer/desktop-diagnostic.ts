import type { WebContainer } from '@webcontainer/api';

async function processText(container: WebContainer, code: string, file = false) {
  const process = await container.spawn('node', file ? [code] : ['-e', code]);
  const output: string[] = [];
  const reader = process.output.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      output.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const exitCode = await process.exit;
  return { exitCode, text: output.join('').trim() };
}

export async function runDesktopWebContainerDiagnostic(container: WebContainer) {
  const process = await processText(container, 'console.log("BOLT_REAL_WEBCONTAINER_PROCESS")');
  if (process.exitCode !== 0 || process.text !== 'BOLT_REAL_WEBCONTAINER_PROCESS')
    throw new Error('WebContainer process failed');
  const nonce = crypto.randomUUID();
  const html = `<!doctype html><html><body>BOLT_REAL_PREVIEW<script>parent.postMessage({boltPreview:${JSON.stringify(nonce)}}, '*');</script></body></html>`;
  const directory = `.bolt-disposable-desktop-preview-${nonce}`;
  await container.fs.mkdir(directory);
  let removeReady: (() => void) | undefined;
  const ready = new Promise<string>((resolve) => {
    removeReady = container.on('server-ready', (port, url) => {
      if (port === 31997) resolve(url);
    });
  });
  // Both disposable processes live inside the actual browser WebContainer, not the host OS.
  await container.fs.writeFile(
    directory + '/preview.cjs',
    `require('http').createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(${JSON.stringify(html)})}).listen(31997)`,
  );
  const server = await container.spawn('node', [directory + '/preview.cjs']);
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;left:8px;bottom:8px;width:300px;height:50px;z-index:9999;background:white';
  let serverOutput = '';
  void server.output
    .pipeTo(
      new WritableStream({
        write(chunk) {
          serverOutput += chunk;
        },
      }),
    )
    .catch(() => {});
  let removeMessage: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const previewURL = await Promise.race([
      ready,
      server.exit.then((code) => {
        throw new Error(`Preview process exited ${code}: ${serverOutput.slice(0, 1600)}`);
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('WebContainer preview startup timed out')), 20_000);
      }),
    ]);
    if (timer) clearTimeout(timer);
    await container.fs.writeFile(
      directory + '/probe.cjs',
      'require("http").get("http://127.0.0.1:31997",res=>{let s="";res.on("data",c=>s+=c);res.on("end",()=>console.log(s))}).on("error",()=>process.exit(1))',
    );
    const internal = await processText(container, directory + '/probe.cjs', true);
    if (internal.exitCode !== 0 || !internal.text.includes('BOLT_REAL_PREVIEW'))
      throw new Error('Actual WebContainer HTTP response failed');
    const rendered = new Promise<boolean>((resolve) => {
      const listener = (event: MessageEvent) => {
        if (
          event.source === frame.contentWindow &&
          event.origin === new URL(previewURL).origin &&
          event.data?.boltPreview === nonce
        )
          resolve(true);
      };
      window.addEventListener('message', listener);
      removeMessage = () => window.removeEventListener('message', listener);
      timer = setTimeout(() => resolve(false), 25_000);
    });
    frame.src = previewURL;
    document.body.appendChild(frame);
    const previewRendered = await rendered;
    return {
      boot: true,
      commandExitCode: process.exitCode,
      processOutput: process.text,
      nativePreviewHTTP: true,
      previewText: 'BOLT_REAL_PREVIEW',
      previewRendered,
      ...(previewRendered
        ? {}
        : { previewError: 'Vendor preview iframe did not return its nonce within the deadline' }),
    };
  } finally {
    if (timer) clearTimeout(timer);
    removeReady?.();
    removeMessage?.();
    frame.remove();
    server.kill();
    await container.fs.rm(directory, { recursive: true, force: true });
  }
}
