import { describe, it, expect, vi, afterEach } from 'vitest';
import { streamText } from 'ai';
import { getAnthropicModel } from './model';
import { filterThinkingForTextOnly, modernAnthropicTextFetch } from './anthropic-compat';

const frame = (event: any) => `event: ${event.type}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`;

function providerFixture() {
  return [
    { type: 'message_start', message: { usage: { input_tokens: 7, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'PRIVATE_REASONING_FIXTURE' } },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'signature_delta', signature: 'PRIVATE_SIGNATURE_FIXTURE' },
    },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    {
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'text_delta', text: 'Provider transport fixture only: café.' },
    },
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 11 } },
    { type: 'message_stop' },
  ]
    .map(frame)
    .join('');
}
afterEach(() => vi.unstubAllGlobals());
describe('real adapter modern-Anthropic transport compatibility (network-denied fixtures)', () => {
  it('omits rejected sampling and stale beta headers while keeping the exact selected model', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('provider rejected fixture', { status: 400 }));
    const shim = modernAnthropicTextFetch(fetcher);
    await shim('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': 'fixture', 'anthropic-beta': 'tools-2024-04-04' },
      body: JSON.stringify({
        model: 'claude-opus-5-5',
        temperature: 0,
        top_p: 1,
        top_k: 2,
        messages: [{ role: 'user', content: 'Fixture' }],
        stream: true,
      }),
    });

    const request = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    expect(request.model).toBe('claude-opus-5-5');

    for (const field of ['temperature', 'top_p', 'top_k', 'thinking']) {
      expect(request).not.toHaveProperty(field);
    }
    expect(fetcher.mock.calls[0][1].headers.has('anthropic-beta')).toBe(false);
    expect(fetcher.mock.calls[0][1].redirect).toBe('error');
  });
  it('passes provider text/usage through the installed SDK after reasoning blocks, including fragmented UTF8 frames', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      const bytes = new TextEncoder().encode(providerFixture());
      let offset = 0;

      return new Response(
        new ReadableStream({
          pull(controller) {
            if (offset >= bytes.length) {
              controller.close();
              return;
            }

            controller.enqueue(bytes.slice(offset, (offset += 7)));
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    });
    vi.stubGlobal('fetch', fetcher);

    const result = await streamText({
      model: getAnthropicModel('fixture-no-live-key', 'claude-opus-5-5'),
      messages: [{ role: 'user', content: 'Network-denied fixture' }],
      maxTokens: 4096,
      maxRetries: 0,
    });
    const parts = [];

    for await (const part of result.fullStream) {
      parts.push(part);
    }
    expect(parts.filter((part) => part.type === 'error')).toHaveLength(0);
    expect(
      parts
        .filter((part) => part.type === 'text-delta')
        .map((part: any) => part.textDelta)
        .join(''),
    ).toBe('Provider transport fixture only: café.');
    expect(JSON.stringify(parts)).not.toContain('PRIVATE');
    expect(parts.at(-1)).toMatchObject({
      type: 'finish',
      finishReason: 'stop',
      usage: { promptTokens: 7, completionTokens: 11 },
    });
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string).temperature).toBeUndefined();
  });
  it('blocks tool history, tools and assistant prefill before any request', async () => {
    const fetcher = vi.fn();
    const shim = modernAnthropicTextFetch(fetcher);

    for (const body of [
      { tools: [{ name: 'workspace_inspect' }], messages: [{ role: 'user', content: 'Fixture' }] },
      { messages: [{ role: 'user', content: [{ type: 'tool_result' }] }] },
      { messages: [{ role: 'assistant', content: 'Prefill' }] },
    ]) {
      await expect(
        shim('https://api.anthropic.com/v1/messages', { body: JSON.stringify({ model: 'claude-opus-5-5', ...body }) }),
      ).rejects.toThrow();
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not invent visible text when the provider sends reasoning only', async () => {
    const raw =
      frame({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } }) +
      frame({ type: 'content_block_stop', index: 0 }) +
      frame({ type: 'message_stop' });
    const output = await new Response(filterThinkingForTextOnly(new Response(raw).body!)).text();
    expect(output).not.toContain('text_delta');
    expect(output).toContain('message_stop');
  });
  it('fails closed on unexpected tool output rather than stripping signed context and executing it', async () => {
    await expect(
      new Response(
        filterThinkingForTextOnly(
          new Response(frame({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use' } })).body!,
        ),
      ).text(),
    ).rejects.toThrow('signed-thinking');
  });
  it('retains provider streaming errors unchanged', async () => {
    const raw = frame({ type: 'error', error: { type: 'overloaded_error', message: 'Provider error fixture' } });
    expect(await new Response(filterThinkingForTextOnly(new Response(raw).body!)).text()).toContain('overloaded_error');
  });
});
