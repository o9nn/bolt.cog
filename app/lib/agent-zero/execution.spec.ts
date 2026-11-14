import { describe, expect, it, vi } from 'vitest';
import { AgentZero } from './agent';
import { SudoManager, SudoPrivilege } from './sudo-capabilities';

function agent() {
  return new AgentZero({
    id: 'test-agent',
    name: 'test',
    role: 'superior',
    capabilities: [],
    memory: { enabled: false, vectorStore: 'memory', maxMemories: 0, embeddingModel: '' },
    tools: [],
    instruments: [],
    systemPrompt: '',
  });
}

describe('trusted AgentZero dispatch', () => {
  it('starts unprivileged and isolates manager state', () => {
    const a = agent();
    expect(a.sudo.hasSudo(a.id)).toBe(false);
    expect(a.sudo).not.toBe(agent().sudo);
  });
  it.each(['terminal', 'code_execution', 'web_search', 'sudo', 'godmode'])(
    'does not simulate success for %s',
    async (name) => {
      const result = await agent().executeTool(name, { command: 'id' });
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    },
  );
  it('returns actual handler output and failure metadata unchanged', async () => {
    const a = agent();
    a.registerTool({ name: 'workspace_inspect', type: 'builtin', enabled: true, description: '', parameters: [] });

    const receipt = { success: false, output: 'stderr', duration: 2, error: 'exit 1', metadata: { exitCode: 1 } };
    a.registerToolHandler('workspace_inspect', async () => receipt);
    expect(await a.executeTool('workspace_inspect', {})).toEqual(receipt);
  });
  it('cannot re-enable privileged tools or register their handlers', () => {
    const a = agent();
    a.registerTool({ name: 'sudo', type: 'builtin', enabled: true, description: '', parameters: [] });
    expect(a.getTools().find((t) => t.name === 'sudo')?.enabled).toBe(false);
    expect(() => a.registerToolHandler('sudo', async () => ({ success: true, output: '', duration: 0 }))).toThrow();
  });
});

describe('scoped local capability manager', () => {
  it('denies unauthorized callbacks and retains denial evidence without a session', async () => {
    const m = new SudoManager();
    const callback = vi.fn();
    await expect(m.sudo('a', 'read', SudoPrivilege.ELEVATED, callback)).rejects.toThrow('Permission denied');
    expect(callback).not.toHaveBeenCalled();
    expect(m.getAuditLog('a')[0].result).toBe('denied');
  });
  it.each([Infinity, 0, -1, 300001])('rejects invalid duration %s', (duration) => {
    expect(() => new SudoManager().grantSudo('a', SudoPrivilege.SYSTEM, 'test', duration, ['read'])).toThrow();
  });
  it.each([SudoPrivilege.ROOT, SudoPrivilege.GODMODE])('rejects legacy unrestricted grant %s', (privilege) => {
    expect(() => new SudoManager().grantSudo('a', privilege, 'test', 1000, ['read'])).toThrow();
  });
  it('requires exact operation scopes', async () => {
    const m = new SudoManager();
    m.grantSudo('a', SudoPrivilege.SYSTEM, 'test', 1000, ['read']);
    await expect(m.sudo('a', 'delete', SudoPrivilege.SYSTEM, async () => true)).rejects.toThrow();
    expect(await m.sudo('a', 'read', SudoPrivilege.SYSTEM, async () => 'actual')).toBe('actual');
  });
  it('expires at the boundary', () => {
    vi.useFakeTimers();

    const m = new SudoManager();
    m.grantSudo('a', SudoPrivilege.ELEVATED, 'test', 1000, ['read']);
    vi.advanceTimersByTime(1000);
    expect(m.hasSudo('a')).toBe(false);
    vi.useRealTimers();
  });
  it('returned grants and logs cannot mutate authorization', () => {
    const m = new SudoManager();
    const grant = m.grantSudo('a', SudoPrivilege.ELEVATED, 'test', 1000, ['read']);
    grant.allowedOperations.push('delete');
    expect(m.hasSudo('a', SudoPrivilege.ELEVATED, 'delete')).toBe(false);
    m.getAuditLog().length = 0;
    expect(m.getAuditLog()).toHaveLength(1);
  });
});
