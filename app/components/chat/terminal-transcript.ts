import type { Terminal } from '@xterm/xterm';

// these bounds apply only to this view; executor output is never modified
export const TRANSCRIPT_RAW_LIMIT = 32 * 1024;
export const TRANSCRIPT_TEXT_LIMIT = 8 * 1024;
export const TRANSCRIPT_COLS = 120;
export const TRANSCRIPT_ROWS = 40;
export const TRANSCRIPT_SCROLLBACK = 200;

export type TranscriptBuffer = Pick<Terminal['buffer']['active'], 'length' | 'getLine'>;

/** UTF-16 tail without introducing a lone low surrogate at the cut. */
export function boundedTranscriptTail(text: string, limit: number): string {
  const start = Math.max(0, text.length - limit);
  const code = text.charCodeAt(start);

  return text.slice(start > 0 && code >= 0xdc00 && code <= 0xdfff ? start + 1 : start);
}

/**
 * Snapshot screen/scrollback text after xterm's write callback. Soft-wrapped rows
 * are joined; explicit line breaks and internal empty lines are retained. Empty
 * viewport padding is omitted, including below a cursor that moved upwards.
 */
export function extractTerminalTranscript(buffer: TranscriptBuffer, cols = TRANSCRIPT_COLS): string {
  const start = Math.max(0, buffer.length - TRANSCRIPT_ROWS - TRANSCRIPT_SCROLLBACK);
  const lines: string[] = [];
  let hasContent = false;
  let nextIsWrapped = false;
  let size = 0;

  // walk backwards so extraction itself is bounded, not just its final result
  for (let index = buffer.length - 1; index >= start; index--) {
    const line = buffer.getLine(index);

    if (!line) {
      break;
    }

    let end = Math.min(cols, line.length);

    if (nextIsWrapped) {
      /**
       * A wide glyph can wrap with an unused cell at the end of the preceding
       * row. Omit null padding, but retain actual spaces at a wrap boundary.
       */
      while (end > 0) {
        const cell = line.getCell(end - 1);

        if (!cell || cell.getChars() !== '' || cell.getWidth() !== 1) {
          break;
        }

        end--;
      }
    }

    const text = line.translateToString(!nextIsWrapped, 0, end);

    if (text.length > 0 || hasContent) {
      const part = text + (hasContent && !nextIsWrapped ? '\n' : '');
      lines.push(part);
      size += part.length;
      hasContent = true;
    }

    nextIsWrapped = line.isWrapped;

    if (size >= TRANSCRIPT_TEXT_LIMIT) {
      break;
    }
  }

  return boundedTranscriptTail(lines.reverse().join(''), TRANSCRIPT_TEXT_LIMIT);
}

/** Minimal public xterm transport surface, also usable by lifecycle unit fakes. */
export interface TranscriptTerminal {
  readonly cols: number;
  readonly buffer: { readonly active: TranscriptBuffer };
  write(data: string, callback: () => void): void;
  dispose(): void;
}

export interface TranscriptSession {
  update(raw: string): void;
  dispose(): void;
}

/**
 * One write in flight and one latest snapshot, rather than an unbounded queue.
 * Prefix deltas keep xterm's parser state across split CSI/OSC/Unicode input.
 * A replaced/truncated raw tail requires a fresh terminal: in xterm 5.5.0 the
 * public reset() does not reset an unfinished escape parser sequence. Neither
 * resetting nor disposing a terminal cancels already queued write callbacks.
 */
export function createTranscriptSession(
  createTerminal: () => TranscriptTerminal,
  onText: (text: string) => void,
  onError: () => void,
): TranscriptSession {
  let terminal: TranscriptTerminal | undefined;
  let parsedRaw = '';
  let latestRaw = '';
  let writing = false;
  let disposed = false;

  const disposeTerminal = () => {
    const previous = terminal;
    terminal = undefined;
    previous?.dispose();
  };

  const fail = () => {
    disposed = true;
    disposeTerminal();
    onError();
  };

  const pump = () => {
    if (disposed || writing || latestRaw === parsedRaw) {
      return;
    }

    try {
      if (!latestRaw.startsWith(parsedRaw)) {
        disposeTerminal();
        parsedRaw = '';
      }

      if (!latestRaw) {
        onText('');
        return;
      }

      terminal ??= createTerminal();

      const currentTerminal = terminal;
      const snapshot = latestRaw;
      const delta = snapshot.slice(parsedRaw.length);
      writing = true;
      currentTerminal.write(delta, () => {
        writing = false;

        if (disposed) {
          return;
        }

        parsedRaw = snapshot;

        /**
         * A newer snapshot may have replaced the source while parsing. Do not
         * briefly publish the obsolete screen; replay the latest source first.
         * Compatible prefixes are published so a busy stream remains visible.
         */
        if (!latestRaw.startsWith(snapshot)) {
          pump();
          return;
        }

        try {
          onText(extractTerminalTranscript(currentTerminal.buffer.active, currentTerminal.cols));
          pump();
        } catch {
          fail();
        }
      });
    } catch {
      writing = false;
      fail();
    }
  };

  return {
    update(raw) {
      if (!disposed) {
        latestRaw = boundedTranscriptTail(raw, TRANSCRIPT_RAW_LIMIT);
        pump();
      }
    },
    dispose() {
      disposed = true;
      latestRaw = '';
      parsedRaw = '';
      disposeTerminal();
    },
  };
}
