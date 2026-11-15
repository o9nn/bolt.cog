import { describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({ stream: vi.fn() }));
vi.mock('./stream-text', () => ({ streamText: mocked.stream }));
vi.mock('./api-key', () => ({
  hasAPIKey: () => true,
  getLLMConfig: () => ({ provider: 'openai-compatible', model: 'real-model' }),
}));
import { action } from '~/routes/api.chat';

function context() {
  return { cloudflare: { env: {} }, desktop: { codingEdition: 'c17', workspaceId: 'desktop', createTools: vi.fn() } };
}

function request(body: unknown) {
  return new Request('http://127.0.0.1/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
describe('trusted C coding edition chat profile', () => {
  it('selects real provider streaming with C instructions, no tools, no assistant prefill', async () => {
    mocked.stream.mockResolvedValue({
      toDataStream: () =>
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode('0:"C project"\n'));
            c.close();
          },
        }),
    });

    const response = await action({
      request: request({ messages: [{ role: 'user', content: 'Write C17' }], codingEdition: 'general' }),
      context: context(),
    } as any);
    await response.text();
    expect(response.status).toBe(200);

    const options = mocked.stream.mock.calls.at(-1)?.[2];
    expect(options.system).toContain('C17');
    expect(options.toolChoice).toBe('none');
    expect(options.tools).toBeUndefined();
    expect(options.maxSteps).toBe(1);
    expect(options.experimental_continueSteps).toBe(false);
  });
  it('rejects client attempts to enable native tools in the C edition', async () => {
    const response = await action({
      request: request({
        messages: [{ role: 'user', content: 'Run sudo' }],
        execution: { backend: 'desktop', workspaceId: 'desktop' },
      }),
      context: context(),
    } as any);
    expect(response.status).toBe(403);
    expect(await response.text()).toContain('reviewed C compile/run');
  });
});
