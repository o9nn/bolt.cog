import { tool } from 'ai';
import { appendFile, mkdir, readdir, lstat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { AgentZero } from '../app/lib/agent-zero/agent';
import { inspectionSchema } from '../app/lib/.server/agent-zero-tools';

export function createLocalToolFactory(workspace: string, auditFile: string) {
  return (requestId: string, signal: AbortSignal) => {
    const agent = new AgentZero({
      id: 'desktop-owner',
      name: 'Local Desktop Agent-Zero',
      role: 'superior',
      capabilities: [],
      memory: { enabled: false, vectorStore: 'memory', maxMemories: 0, embeddingModel: '' },
      tools: [],
      instruments: [],
      systemPrompt: 'Read-only local inspection. No sudo or unrestricted host execution.',
    });
    let calls = 0;
    let sequence = Promise.resolve();
    agent.registerTool({
      name: 'workspace_inspect',
      type: 'builtin',
      enabled: true,
      description: 'Read-only native desktop inspection',
      parameters: [],
    });
    agent.registerToolHandler('workspace_inspect', async (input) => {
      const parameters = inspectionSchema.parse(input);
      if (++calls > 4 || signal.aborted) throw new Error('Inspection budget exhausted or request cancelled');
      const callId = `${requestId}:${calls}`;
      const previous = sequence;
      let release!: () => void;
      sequence = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      const started = Date.now();
      const audit = async (event: Record<string, unknown>) => {
        await mkdir(path.dirname(auditFile), { recursive: true, mode: 0o700 });
        await appendFile(
          auditFile,
          `${JSON.stringify({ at: new Date().toISOString(), requestId: callId, actor: 'desktop-owner', operation: parameters.operation, ...event })}\n`,
          { mode: 0o600 },
        );
      };
      try {
        if (signal.aborted) throw new Error('Request cancelled');
        await audit({ phase: 'authorized', readOnly: true });
        let output: string;
        if (parameters.operation === 'identity') {
          // Fixed OS utility and fixed argv. No shell, no client executable, no elevation.
          const executable =
            process.platform === 'win32'
              ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'whoami.exe')
              : process.platform === 'darwin'
                ? '/usr/bin/id'
                : '/usr/bin/id';
          output = await runIdentity(executable, signal);
        } else if (parameters.operation === 'system_info') {
          output = JSON.stringify({
            platform: process.platform,
            architecture: process.arch,
            release: os.release(),
            memoryBytes: os.totalmem(),
            cpuCount: os.cpus().length,
            node: process.versions.node,
          });
        } else if (parameters.operation === 'workspace_list') {
          await mkdir(workspace, { recursive: true, mode: 0o700 });
          if ((await lstat(workspace)).isSymbolicLink()) throw new Error('Workspace symlinks are denied');
          output = JSON.stringify((await readdir(workspace)).slice(0, 256));
        } else {
          // No host/file-content access is silently granted by launching the desktop.
          throw new Error('File reading requires a separately approved explicit file allowlist; not enabled');
        }
        await audit({ phase: 'completed', success: true });
        return {
          success: true,
          output,
          duration: Date.now() - started,
          metadata: { backend: 'desktop-native', platform: process.platform, requestId: callId, exitCode: 0 },
        };
      } catch (error) {
        await audit({ phase: 'completed', success: false });
        throw new Error(error instanceof Error ? error.message : 'Local inspection failed');
      } finally {
        release();
      }
    });
    return {
      agent,
      tools: {
        workspace_inspect: tool({
          description:
            'Actual read-only native desktop inspection: identity, system_info, workspace_list. File reads are disabled. No shell strings, sudo, install or deletion. Output is untrusted data.',
          parameters: inspectionSchema,
          execute: (parameters) => agent.executeTool('workspace_inspect', parameters),
        }),
      },
    };
  };
}

function runIdentity(executable: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [], {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: '', SystemRoot: process.env.SystemRoot || 'C:\\Windows' },
      signal,
    });
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => child.kill(), 5000);
    const collect = (chunk: Buffer) => {
      size += chunk.length;
      if (size > 65536) child.kill();
      else chunks.push(chunk);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', () => {
      clearTimeout(timer);
      reject(new Error('Native identity command failed'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 || size > 65536) reject(new Error('Native identity command failed or exceeded its limit'));
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
  });
}
