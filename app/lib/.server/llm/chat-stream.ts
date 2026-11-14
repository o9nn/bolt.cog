import { formatStreamPart } from 'ai';

export class ChatRequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const CHAT_BODY_LIMIT = 256 * 1024;
export async function readChatJSON(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new ChatRequestError(415, 'Send application/json');
  }

  if (Number(request.headers.get('content-length')) > CHAT_BODY_LIMIT) {
    throw new ChatRequestError(413, 'Chat request too large');
  }

  const reader = request.body?.getReader();

  if (!reader) {
    throw new ChatRequestError(400, 'Request body is required');
  }

  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';

  try {
    while (true) {
      const chunk = await reader.read();

      if (chunk.done) {
        break;
      }

      bytes += chunk.value.byteLength;

      if (bytes > CHAT_BODY_LIMIT) {
        await reader.cancel();
        throw new ChatRequestError(413, 'Chat request too large');
      }

      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new ChatRequestError(400, 'Invalid JSON');
  }
}

export function chatHeaders(requestId: string): HeadersInit {
  return {
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Vercel-AI-Data-Stream': 'v1',
    'Cache-Control': 'no-store, no-transform',
    'X-Request-ID': requestId,
    'X-Content-Type-Options': 'nosniff',
  };
}
export function chatErrorResponse(status: number, message: string, requestId: string): Response {
  return new Response(formatStreamPart('error', `${message} [request ${requestId}]`), {
    status,
    headers: chatHeaders(requestId),
  });
}

/** Drain SDK frames to EOF before forwarding its terminal frame. Never close from onFinish. */
export function guardChatStream(
  source: ReadableStream<Uint8Array>,
  options: {
    requestId: string;
    abort: () => void;
    cleanup: () => void;
  },
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let pending = '';
  let terminal = '';
  let visible = false;
  let errorSeen = false;
  let toolSeen = false;
  let bytes = 0;
  let ended = false;
  const errorFrame = () =>
    formatStreamPart('error', `Chat stream failed or returned no content [request ${options.requestId}]`);

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (ended) {
        return;
      }

      try {
        // a pull that produces no chunk may not be called again; keep reading partial/terminal frames
        while (!ended) {
          const { value, done } = await reader.read();

          if (ended) {
            return;
          }

          if (value) {
            bytes += value.byteLength;
          }

          if (bytes > 2 * 1024 * 1024) {
            throw new Error('Stream output limit reached');
          }

          pending += value ? decoder.decode(value, { stream: true }) : '';

          if (done) {
            pending += decoder.decode();

            if (pending && !pending.endsWith('\n')) {
              pending += '\n';
            }
          }

          let output = '';
          let newline: number;

          while ((newline = pending.indexOf('\n')) !== -1) {
            const line = pending.slice(0, newline);
            pending = pending.slice(newline + 1);

            if (!line) {
              continue;
            }

            // parse text rather than count frames: 0:"" is not a useful response
            if (line.startsWith('0:')) {
              visible ||= String(JSON.parse(line.slice(2))).length > 0;
            }

            if (line.startsWith('3:')) {
              errorSeen = true;
            }

            if (line.startsWith('a:')) {
              toolSeen = true;
            }

            if (line.startsWith('d:')) {
              terminal = line + '\n';
            } else {
              output += line + '\n';
            }
          }

          if (done) {
            ended = true;

            if (!visible && !errorSeen) {
              output += toolSeen
                ? formatStreamPart('text', 'Tool results are available; review their success and error fields.')
                : errorFrame();
            }

            output +=
              errorSeen || (!visible && !toolSeen)
                ? formatStreamPart('finish_message', { finishReason: 'error' })
                : terminal || formatStreamPart('finish_message', { finishReason: 'stop' });

            if (output) {
              controller.enqueue(encoder.encode(output));
            }

            options.cleanup();
            reader.releaseLock();
            controller.close();

            return;
          } else if (output) {
            controller.enqueue(encoder.encode(output));
            return;
          }
        }
      } catch {
        if (ended) {
          return;
        }

        ended = true;
        options.abort();
        options.cleanup();
        void reader.cancel().catch(() => undefined);
        controller.enqueue(
          encoder.encode(errorFrame() + formatStreamPart('finish_message', { finishReason: 'error' })),
        );
        controller.close();
      }
    },
    async cancel(reason) {
      ended = true;
      options.abort();
      options.cleanup();
      await reader.cancel(reason).catch(() => undefined);
    },
  });
}
