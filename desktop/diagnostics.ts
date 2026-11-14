import path from 'node:path';
import { mkdir, open, lstat, rename } from 'node:fs/promises';
import { constants } from 'node:fs';
import type { ProviderFailure } from '../app/lib/.server/llm/provider-errors';

export interface ChatDiagnostic {
  requestId: string;
  phase: 'initialization' | 'stream' | 'probe';
  failure: ProviderFailure;
}
export function createDiagnosticRecorder(filename: string) {
  let chain = Promise.resolve();
  return (event: ChatDiagnostic): Promise<void> => {
    const write = async () => {
      if (!/^[a-f0-9-]{36}$/.test(event.requestId) || !['initialization', 'stream', 'probe'].includes(event.phase))
        return;
      const { code, status, upstreamStatus, upstreamType, upstreamRequestId, transportCode } = event.failure;
      // Fixed/validated metadata only: never stringify the exception or its message/body.
      const receipt = {
        at: new Date().toISOString(),
        requestId: event.requestId,
        phase: event.phase,
        code,
        status,
        ...(upstreamStatus ? { upstreamStatus } : {}),
        ...(upstreamType ? { upstreamType } : {}),
        ...(upstreamRequestId ? { upstreamRequestId } : {}),
        ...(transportCode ? { transportCode } : {}),
      };
      await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
      try {
        const stat = await lstat(filename);
        if (!stat.isFile() || stat.isSymbolicLink()) return;
        if (stat.size >= 1_048_576) {
          try {
            const backup = await lstat(filename + '.previous');
            if (!backup.isFile() || backup.isSymbolicLink()) return;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
          await rename(filename, filename + '.previous');
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const file = await open(
        filename,
        constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY | (constants.O_NOFOLLOW || 0),
        0o600,
      );
      try {
        if (!(await file.stat()).isFile()) return;
        await file.writeFile(JSON.stringify(receipt) + '\n');
      } finally {
        await file.close();
      }
    };
    // Diagnostic failures must not change provider results or expose raw IO exceptions.
    const result = chain.then(write).catch(() => undefined);
    chain = result;
    return result;
  };
}
