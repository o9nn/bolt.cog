export function requiresModernAnthropicTextAdapter(modelId: string): boolean {
  return modelId === 'claude-opus-5-5';
}

/**
 * Legacy AI SDK3 lacks signed thinking in its message/tool protocol.
 * This narrow adapter supports real text output only; tool loops fail closed.
 * Sampling parameters are removed per the exact Opus5.5 migration contract.
 */
export function modernAnthropicTextFetch(fetcher: typeof fetch = globalThis.fetch): typeof fetch {
  return async (input, init) => {
    if (typeof init?.body !== 'string') {
      throw new Error('Modern Anthropic request body is required');
    }

    const body = JSON.parse(init.body);

    if (!requiresModernAnthropicTextAdapter(body.model)) {
      throw new Error('Unsupported modern Anthropic compatibility profile');
    }

    const messages: unknown[] = Array.isArray(body.messages) ? body.messages : [];
    const hasToolHistory = messages.some(
      (message: any) =>
        Array.isArray(message.content) &&
        message.content.some((block: any) =>
          ['tool_use', 'tool_result', 'thinking', 'redacted_thinking'].includes(block.type),
        ),
    );

    if (body.tools?.length || hasToolHistory) {
      throw new Error(
        'Modern Anthropic tool use requires a signed-thinking-compatible SDK; start a fresh text chat with native tools off',
      );
    }

    if (body.messages?.at(-1)?.role === 'assistant') {
      throw new Error('Modern Anthropic rejects assistant prefill; end the request with a user turn');
    }

    delete body.temperature;
    delete body.top_p;
    delete body.top_k;

    // omission enables the model's default adaptive thinking; never fabricate or disable it
    delete body.thinking;
    delete body.tool_choice;

    const headers = new Headers(init.headers);
    headers.delete('anthropic-beta');

    const response = await fetcher(input, { ...init, headers, body: JSON.stringify(body), redirect: 'error' });

    if (!response.ok || !body.stream || !response.body) {
      return response;
    }

    return new Response(filterThinkingForTextOnly(response.body), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

/**
 * Filter only provider reasoning blocks for the explicitly text-only legacy client.
 * Text/error/usage frames come from the provider unchanged. No replacement output.
 */
export function filterThinkingForTextOnly(source: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const reasoning = new Set<number>();
  let pending = '';
  let total = 0;
  let finished = false;

  function convert(frame: string): string {
    const lines = frame.split(/\r?\n/);
    const data = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');

    if (!data) {
      return '';
    }

    const event = JSON.parse(data);

    if (event.type === 'content_block_start') {
      const type = event.content_block?.type;

      if (type === 'thinking' || type === 'redacted_thinking') {
        reasoning.add(event.index);
        return '';
      }

      if (type === 'tool_use' || type === 'server_tool_use') {
        throw new Error('Modern Anthropic tool use requires signed-thinking support');
      }

      if (type !== 'text') {
        throw new Error('Unsupported modern Anthropic content block');
      }
    }

    if (event.type === 'content_block_delta' && reasoning.has(event.index)) {
      return '';
    }

    if (event.type === 'content_block_stop' && reasoning.delete(event.index)) {
      return '';
    }

    // versioning permits additional events, but do not send unknown events into the old strict schema
    if (
      ![
        'message_start',
        'content_block_start',
        'content_block_delta',
        'content_block_stop',
        'message_delta',
        'message_stop',
        'ping',
        'error',
      ].includes(event.type)
    ) {
      return '';
    }

    return lines.join('\n') + '\n\n';
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished) {
        return;
      }

      try {
        while (!finished) {
          const { value, done } = await reader.read();

          if (finished) {
            return;
          }

          total += value?.byteLength || 0;

          if (total > 8 * 1024 * 1024) {
            throw new Error('Provider stream size limit exceeded');
          }

          pending += value ? decoder.decode(value, { stream: true }) : '';

          if (done) {
            pending += decoder.decode();
          }

          let output = '';
          let match: RegExpExecArray | null;

          while ((match = /\r?\n\r?\n/.exec(pending))) {
            const frame = pending.slice(0, match.index);
            pending = pending.slice(match.index + match[0].length);
            output += convert(frame);
          }

          if (pending.length > 256 * 1024) {
            throw new Error('Provider event size limit exceeded');
          }

          if (done) {
            if (pending.trim()) {
              output += convert(pending);
            }

            finished = true;

            if (output) {
              controller.enqueue(encoder.encode(output));
            }

            reader.releaseLock();
            controller.close();

            return;
          }

          if (output) {
            controller.enqueue(encoder.encode(output));
            return;
          }
        }
      } catch (error) {
        finished = true;
        await reader.cancel().catch(() => undefined);
        controller.error(error);
      }
    },
    async cancel(reason) {
      finished = true;
      await reader.cancel(reason).catch(() => undefined);
    },
  });
}
