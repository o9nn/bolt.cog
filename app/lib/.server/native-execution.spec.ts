import { expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRunner } from '../../../services/linux-runner/runner.mjs';
import { createAgentZeroTools } from './agent-zero-tools';

it('dispatches real id and approved file reads from AgentZero through the broker and durable runner audit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bolt-native-integration-'));
  const workspace = join(root, 'workspace'); const auditDir = join(root, 'audit');
  await mkdir(workspace); await mkdir(auditDir, { mode: 0o700 });
  await writeFile(join(workspace, 'approved.txt'), 'DISPOSABLE_INTEGRATION_FIXTURE\n');
  const auditPath = join(auditDir, 'events.jsonl'); const token = 'fixture-only-32-character-runner-token';
  const runner = await createRunner({ token, actorId: 'actor', workspaceId: 'w1', workspaceRoot: workspace, auditPath, readFiles: ['approved.txt'] });
  await new Promise<void>((resolve) => runner.server.listen(0, '127.0.0.1', resolve));
  const address = runner.server.address();
  if (!address || typeof address === 'string') { throw new Error('Missing runner port'); }
  const nativeFetch = globalThis.fetch;
  // Test-only transport rewrite. Production broker remains fixed HTTPS and rejects redirects.
  vi.stubGlobal('fetch', (_input: unknown, init: RequestInit) => nativeFetch(`http://127.0.0.1:${address.port}/execute`, init));
  try {
    const env: Env = { ANTHROPIC_API_KEY: '', EXECUTOR_URL: 'https://runner.example/execute', EXECUTOR_TOKEN: token };
    const { agent } = createAgentZeroTools(env, 'actor', 'w1', 'integration', new AbortController().signal);
    const identity = await agent.executeTool('workspace_inspect', { operation: 'identity', args: {} });
    expect(identity.success).toBe(true); expect(identity.output).toMatch(/uid=\d+/); expect(identity.output).not.toContain('uid=0(');
    expect(identity.metadata).toMatchObject({ backend: 'linux', exitCode: 0, requestId: 'integration:1' });
    const file = await agent.executeTool('workspace_inspect', { operation: 'workspace_file_read', args: { path: 'approved.txt' } });
    expect(file.output).toBe('DISPOSABLE_INTEGRATION_FIXTURE\n'); expect(file.success).toBe(true);
    const denied = await agent.executeTool('workspace_inspect', { operation: 'workspace_file_read', args: { path: 'not-approved.txt' } });
    expect(denied.success).toBe(false);
    const audit = (await readFile(auditPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    expect(audit.filter((event) => event.event === 'dispatch')).toHaveLength(3);
    expect(audit.filter((event) => event.event === 'terminal' && event.success)).toHaveLength(2);
    expect(audit.some((event) => event.error === 'FILE_NOT_ALLOWLISTED')).toBe(true);
    expect(JSON.stringify(audit)).not.toContain(token);
    console.log('REAL_NATIVE_RECEIPT', JSON.stringify({ output: identity.output.trim(), backend: identity.metadata?.backend, exitCode: identity.metadata?.exitCode, auditedDispatches: 3 }));
  } finally {
    vi.unstubAllGlobals(); await runner.close(); await rm(root, { recursive: true, force: true });
  }
});
