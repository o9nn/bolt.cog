import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const jwt = vi.hoisted(() => ({ verify: vi.fn(), jwks: vi.fn() }));
vi.mock('jose', () => ({ jwtVerify: jwt.verify, createRemoteJWKSet: jwt.jwks }));
import { authorizeWorkspace, createAgentZeroTools, inspectionSchema } from './agent-zero-tools';

const env: Env = {
  ANTHROPIC_API_KEY: 'test-only',
  CF_ACCESS_TEAM_DOMAIN: 'test.cloudflareaccess.com',
  CF_ACCESS_AUD: 'aud',
  EXECUTOR_WORKSPACE_ACL: '{"actor":["w1"]}',
  EXECUTOR_URL: 'https://runner.example/execute',
  EXECUTOR_TOKEN: 'test-runner-secret',
};
const request = () =>
  new Request('https://bolt.example/api/chat', { headers: { 'Cf-Access-Jwt-Assertion': 'test-jwt' } });
beforeEach(() => {
  vi.clearAllMocks();
  jwt.verify.mockResolvedValue({ payload: { sub: 'actor' } });
});
afterEach(() => vi.unstubAllGlobals());

describe('workspace identity authorization', () => {
  it('validates issuer/audience/signature constraints and returns verified subject', async () => {
    expect(await authorizeWorkspace(request(), env, 'w1')).toBe('actor');
    expect(jwt.verify.mock.calls[0][2]).toMatchObject({
      issuer: 'https://test.cloudflareaccess.com',
      audience: 'aud',
      algorithms: ['RS256'],
      requiredClaims: ['sub', 'exp', 'iat'],
    });
  });
  it('rejects missing authentication configuration', async () => {
    await expect(authorizeWorkspace(request(), { ANTHROPIC_API_KEY: '' }, 'w1')).rejects.toMatchObject({ status: 503 });
  });
  it('rejects missing assertion', async () => {
    await expect(authorizeWorkspace(new Request('https://bolt.example'), env, 'w1')).rejects.toMatchObject({
      status: 401,
    });
  });
  it('rejects invalid or expired signatures', async () => {
    jwt.verify.mockRejectedValue(new Error('expired'));
    await expect(authorizeWorkspace(request(), env, 'w1')).rejects.toMatchObject({ status: 401 });
  });
  it('rejects cross-workspace access', async () => {
    await expect(authorizeWorkspace(request(), env, 'other')).rejects.toMatchObject({ status: 403 });
  });
  it('rejects malformed ACLs', async () => {
    await expect(authorizeWorkspace(request(), { ...env, EXECUTOR_WORKSPACE_ACL: 'bad' }, 'w1')).rejects.toMatchObject({
      status: 503,
    });
  });
});

describe('Linux broker schema and receipts', () => {
  it.each(['../escape', '/etc/passwd', 'a/../b', 'a//b', 'a;id', '*.log', 'a\\b'])('rejects unsafe path %s', (path) => {
    expect(inspectionSchema.safeParse({ operation: 'workspace_file_read', args: { path } }).success).toBe(false);
  });
  it.each(['sudo', 'delete', 'terminal'])('rejects operation %s', (operation) => {
    expect(inspectionSchema.safeParse({ operation, args: {} }).success).toBe(false);
  });
  it('requires path only for file reads and rejects extra command input', () => {
    expect(inspectionSchema.safeParse({ operation: 'identity', args: { path: 'a' } }).success).toBe(false);
    expect(inspectionSchema.safeParse({ operation: 'workspace_file_read', args: {} }).success).toBe(false);
    expect(inspectionSchema.safeParse({ operation: 'identity', args: {}, command: 'id' }).success).toBe(false);
  });
  it('forwards fixed authenticated payload and returns real receipt metadata', async () => {
    const fetcher = vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      return Response.json({
        success: true,
        output: 'uid=1000',
        exitCode: 0,
        duration: 2,
        backend: 'linux',
        requestId: body.requestId,
      });
    });
    vi.stubGlobal('fetch', fetcher);

    const { agent } = createAgentZeroTools(env, 'actor', 'w1', 'r', new AbortController().signal);
    const result = await agent.executeTool('workspace_inspect', { operation: 'identity', args: {} });
    expect(result).toMatchObject({
      success: true,
      output: 'uid=1000',
      metadata: { backend: 'linux', requestId: 'r:1', exitCode: 0 },
    });
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      redirect: 'error',
      headers: { Authorization: 'Bearer test-runner-secret' },
    });
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
      actorId: 'actor',
      workspaceId: 'w1',
      operation: 'identity',
    });
  });
  it('masks remote exceptions and rejects mismatched receipts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ success: true, output: '', exitCode: 0, duration: 0, backend: 'linux', requestId: 'wrong' }),
      ),
    );

    const { agent } = createAgentZeroTools(env, 'actor', 'w1', 'r', new AbortController().signal);
    expect((await agent.executeTool('workspace_inspect', { operation: 'identity', args: {} })).success).toBe(false);
  });
  it('enforces four-call execution budget', async () => {
    const f = vi.fn(async (_url, init) =>
      Response.json({
        success: true,
        output: 'ok',
        exitCode: 0,
        duration: 0,
        backend: 'linux',
        requestId: JSON.parse(init.body).requestId,
      }),
    );
    vi.stubGlobal('fetch', f);

    const { agent } = createAgentZeroTools(env, 'actor', 'w1', 'r', new AbortController().signal);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => agent.executeTool('workspace_inspect', { operation: 'identity', args: {} })),
    );
    expect(results.filter((r) => r.success)).toHaveLength(4);
    expect(f).toHaveBeenCalledTimes(4);
  });
  it('denies cancellation before native dispatch', async () => {
    const abort = new AbortController();
    abort.abort();

    const f = vi.fn();
    vi.stubGlobal('fetch', f);

    const { agent } = createAgentZeroTools(env, 'actor', 'w1', 'r', abort.signal);
    expect((await agent.executeTool('workspace_inspect', { operation: 'identity', args: {} })).success).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
  it.each(['http://runner.example/execute', 'https://runner.example/else', 'https://u:p@runner.example/execute'])(
    'rejects endpoint %s',
    (url) => {
      expect(() =>
        createAgentZeroTools({ ...env, EXECUTOR_URL: url }, 'actor', 'w1', 'r', new AbortController().signal),
      ).toThrow();
    },
  );
});
