import { describe, expect, it, vi } from 'vitest';
import { streamText, tool, parseStreamPart } from 'ai';
import { MockLanguageModelV1, convertArrayToReadableStream } from 'ai/test';
import { z } from 'zod';
import { AgentZero } from '~/lib/agent-zero/agent';
import { guardChatStream } from './chat-stream';

describe('installed AI SDK v3 integration', () => {
  it('executes an AgentZero handler, feeds its receipt back, and preserves final text', async () => {
    const agent = new AgentZero({
      id: 'test',
      name: 'test',
      role: 'superior',
      capabilities: [],
      memory: { enabled: false, maxMemories: 0, vectorStore: 'memory', embeddingModel: '' },
      tools: [],
      instruments: [],
      systemPrompt: '',
    });
    agent.registerTool({ name: 'inspect', description: '', type: 'builtin', enabled: true, parameters: [] });

    const execute = vi.fn(async () => ({ success: true, output: 'uid=1000', duration: 1 }));
    agent.registerToolHandler('inspect', execute);

    let step = 0;
    const model = new MockLanguageModelV1({
      doStream: async ({ prompt }) => {
        const first = ++step === 1;

        if (!first) {
          expect(JSON.stringify(prompt)).toContain('uid=1000');
        }

        return {
          rawCall: { rawPrompt: null, rawSettings: {} },
          stream: first
            ? convertArrayToReadableStream([
                { type: 'tool-call', toolCallType: 'function', toolCallId: 't1', toolName: 'inspect', args: '{}' },
                { type: 'finish', finishReason: 'tool-calls', usage: { promptTokens: 1, completionTokens: 1 } },
              ])
            : convertArrayToReadableStream([
                { type: 'text-delta', textDelta: 'Actual executor receipt: uid=1000.' },
                { type: 'finish', finishReason: 'stop', usage: { promptTokens: 1, completionTokens: 1 } },
              ]),
        };
      },
    });
    const result = await streamText({
      model,
      messages: [{ role: 'user', content: 'inspect' }],
      maxSteps: 3,
      maxRetries: 0,
      tools: { inspect: tool({ parameters: z.object({}).strict(), execute: (p) => agent.executeTool('inspect', p) }) },
    });
    const response = new Response(guardChatStream(result.toDataStream(), { requestId: 'r', abort() {}, cleanup() {} }));
    const parts = (await response.text()).trim().split('\n').map(parseStreamPart);
    expect(execute).toHaveBeenCalledOnce();
    expect(step).toBe(2);
    expect(parts.some((p) => p.type === 'tool_result')).toBe(true);
    expect(
      parts
        .filter((p) => p.type === 'text')
        .map((p) => p.value)
        .join(''),
    ).toBe('Actual executor receipt: uid=1000.');
    expect(parts.at(-1)?.type).toBe('finish_message');
  });
  it('continues length-limited output without losing final bytes', async () => {
    let step = 0;
    const model = new MockLanguageModelV1({
      doStream: async () => ({
        rawCall: { rawPrompt: null, rawSettings: {} },
        stream: convertArrayToReadableStream([
          { type: 'text-delta', textDelta: ++step === 1 ? 'One ' : 'two.' },
          {
            type: 'finish',
            finishReason: step === 1 ? 'length' : 'stop',
            usage: { promptTokens: 1, completionTokens: 1 },
          },
        ]),
      }),
    });
    const result = await streamText({
      model,
      prompt: 'continue',
      maxSteps: 2,
      experimental_continueSteps: true,
      maxRetries: 0,
    });
    const text = await new Response(
      guardChatStream(result.toDataStream(), { requestId: 'r', abort() {}, cleanup() {} }),
    ).text();
    expect(text).toContain('two.');
    expect(step).toBe(2);
    expect(text.trim().split('\n').map(parseStreamPart).at(-1)?.type).toBe('finish_message');
  });
});
