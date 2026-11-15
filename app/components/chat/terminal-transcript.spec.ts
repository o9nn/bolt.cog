import { describe, expect, it, vi } from 'vitest';
import {
  boundedTranscriptTail,
  createTranscriptSession,
  extractTerminalTranscript,
  TRANSCRIPT_COLS,
  TRANSCRIPT_RAW_LIMIT,
  TRANSCRIPT_ROWS,
  TRANSCRIPT_SCROLLBACK,
  TRANSCRIPT_TEXT_LIMIT,
  type TranscriptBuffer,
  type TranscriptTerminal,
} from '~/components/chat/terminal-transcript';

/**
 * Synthetic buffer and transport tests, not an ANSI parser replacement/proof.
 * The real browser xterm parser must be verified by Electron integration tests.
 */
type BufferLine = NonNullable<ReturnType<TranscriptBuffer['getLine']>>;

function line(text: string, isWrapped = false, cols = TRANSCRIPT_COLS): BufferLine {
  const cells = Array.from(text);

  return {
    isWrapped,
    length: cols,
    getCell: vi.fn((index: number) => ({ getChars: () => cells[index] ?? '', getWidth: () => 1 })),
    translateToString: vi.fn((trimRight = false, start = 0, end = cols) => {
      const value = text.padEnd(cols, ' ').slice(start, end);

      // xterm trims null cells, not spaces that were actually printed
      return trimRight ? value.slice(0, Math.max(0, text.length - start)) : value;
    }),
  } as unknown as BufferLine;
}

function buffer(lines: BufferLine[]): TranscriptBuffer {
  return { length: lines.length, getLine: (index) => lines[index] };
}

function fakeTerminal() {
  let currentBuffer = buffer([line('')]);
  const callbacks: (() => void)[] = [];
  const terminal: TranscriptTerminal = {
    cols: TRANSCRIPT_COLS,
    get buffer() {
      return { active: currentBuffer };
    },
    write: vi.fn((_data: string, callback: () => void) => callbacks.push(callback)),
    dispose: vi.fn(),
  };

  return {
    terminal,
    finish(text: string) {
      currentBuffer = buffer([line(text)]);
      callbacks.shift()!();
    },
    callbacks,
  };
}

function setupSession() {
  const terminals: ReturnType<typeof fakeTerminal>[] = [];
  const create = vi.fn(() => {
    const fake = fakeTerminal();
    terminals.push(fake);

    return fake.terminal;
  });
  const onText = vi.fn();
  const onError = vi.fn();
  const session = createTranscriptSession(create, onText, onError);

  return { terminals, create, onText, onError, session };
}

describe('extractTerminalTranscript (synthetic public buffer)', () => {
  it('drops unused trailing viewport rows without depending on the current cursor position', () => {
    expect(extractTerminalTranscript(buffer([line('first'), line('last'), line(''), line('')]))).toBe('first\nlast');
    expect(extractTerminalTranscript(buffer([line(''), line('')]))).toBe('');
  });

  it('preserves explicit leading/internal blank lines and command indentation', () => {
    expect(extractTerminalTranscript(buffer([line(''), line('  first'), line(''), line('  last'), line('')]))).toBe(
      '\n  first\n\n  last',
    );
  });

  it('joins soft wraps but preserves explicit hard breaks', () => {
    const lines = [line('abcdef', false, 6), line('ghijkl', true, 6), line('mn', true, 6), line('next', false, 6)];
    expect(extractTerminalTranscript(buffer(lines), 6)).toBe('abcdefghijklmn\nnext');
  });

  it('retains real spaces at a wrap boundary but omits null padding before a wide glyph', () => {
    expect(extractTerminalTranscript(buffer([line('abc ', false, 4), line('d', true, 4)]), 4)).toBe('abc d');

    const preceding = line('abc', false, 4);
    expect(extractTerminalTranscript(buffer([preceding, line('界', true, 4)]), 4)).toBe('abc界');
    expect(preceding.translateToString).toHaveBeenCalledWith(false, 0, 3);
  });

  it('returns Unicode and HTML-shaped text verbatim from translated cells', () => {
    const text = 'café e\u0301 界 😀 <img src=x onerror=alert(1)>';
    expect(extractTerminalTranscript(buffer([line(text)]))).toBe(text);
  });

  it('limits columns when a retained buffer line is wider than the virtual viewport', () => {
    expect(extractTerminalTranscript(buffer([line('abcdefgh', false, 8)]), 4)).toBe('abcd');
  });

  it('bounds traversal as well as final text, including a partial wrapped tail', () => {
    const lines = Array.from({ length: 500 }, (_, index) => line(index.toString().padEnd(120, 'x'), true));
    const getLine = vi.fn((index: number) => lines[index]);
    const text = extractTerminalTranscript({ length: lines.length, getLine });
    expect(text).toHaveLength(TRANSCRIPT_TEXT_LIMIT);
    expect(text.endsWith('499'.padEnd(120, 'x'))).toBe(true);
    expect(getLine.mock.calls.length).toBeLessThanOrEqual(Math.ceil(TRANSCRIPT_TEXT_LIMIT / 120));
    expect(text).not.toContain('\n');
  });

  it('bounds blank-buffer reads to the configured viewport plus scrollback', () => {
    const getLine = vi.fn(() => line(''));
    expect(extractTerminalTranscript({ length: 10000, getLine })).toBe('');
    expect(getLine).toHaveBeenCalledTimes(TRANSCRIPT_ROWS + TRANSCRIPT_SCROLLBACK);
  });

  it('does not invent a blank line for a missing buffer row', () => {
    expect(extractTerminalTranscript({ length: 2, getLine: (index) => (index === 1 ? line('tail') : undefined) })).toBe(
      'tail',
    );
  });
});

describe('boundedTranscriptTail', () => {
  it('does not introduce a lone low surrogate when truncating UTF-16', () => {
    expect(boundedTranscriptTail('x😀end', 4)).toBe('end');
    expect(boundedTranscriptTail('x😀end', 5)).toBe('😀end');
    expect(boundedTranscriptTail('short', 100)).toBe('short');
  });
});

describe('createTranscriptSession (client-independent transport fake)', () => {
  it('passes raw bytes through unchanged and publishes only after the parser callback', () => {
    const { session, terminals, onText } = setupSession();
    const raw = '\u001b[31mred\u001b[0m\r\u001b[2Kdone';
    session.update(raw);
    expect(terminals[0].terminal.write).toHaveBeenCalledWith(raw, expect.any(Function));
    expect(onText).not.toHaveBeenCalled();
    terminals[0].finish('done');
    expect(onText).toHaveBeenCalledWith('done');
    session.dispose();
  });

  it('writes prefix deltas, preserving split CSI/OSC input on the same emulator', () => {
    const { session, terminals, create, onText } = setupSession();
    session.update('\u001b[');
    terminals[0].finish('');
    session.update('\u001b[31mhello\u001b]0;ti');
    terminals[0].finish('hello');
    session.update('\u001b[31mhello\u001b]0;title\u0007');
    terminals[0].finish('hello');
    expect(create).toHaveBeenCalledTimes(1);
    expect(vi.mocked(terminals[0].terminal.write).mock.calls.map(([data]) => data)).toEqual([
      '\u001b[',
      '31mhello\u001b]0;ti',
      'tle\u0007',
    ]);
    expect(onText).toHaveBeenLastCalledWith('hello');
    session.dispose();
  });

  it('coalesces rapid snapshots to one pending latest value while publishing compatible parsed progress', () => {
    const { session, terminals, onText } = setupSession();
    session.update('a');

    for (let index = 2; index <= 1000; index++) {
      session.update('a'.repeat(index));
    }

    expect(terminals[0].terminal.write).toHaveBeenCalledTimes(1);
    terminals[0].finish('a');
    expect(onText).toHaveBeenCalledWith('a');
    expect(terminals[0].terminal.write).toHaveBeenLastCalledWith('a'.repeat(999), expect.any(Function));
    terminals[0].finish('latest');
    expect(onText).toHaveBeenCalledTimes(2);
    expect(onText).toHaveBeenCalledWith('latest');
    session.dispose();
  });

  it('recreates the emulator after a replaced raw tail, without replaying into unfinished parser state', () => {
    const { session, terminals, create, onText } = setupSession();
    session.update('old\u001b]0;unfinished');
    session.update('new\r\u001b[2Kfresh');
    expect(create).toHaveBeenCalledTimes(1);
    terminals[0].finish('old');
    expect(terminals[0].terminal.dispose).toHaveBeenCalledTimes(1);
    expect(onText).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(2);
    expect(terminals[1].terminal.write).toHaveBeenCalledWith('new\r\u001b[2Kfresh', expect.any(Function));
    terminals[1].finish('fresh');
    expect(onText).toHaveBeenCalledWith('fresh');
    session.dispose();
  });

  it('resets after the display input limit rolls over and caps a single oversized update', () => {
    const { session, terminals } = setupSession();
    session.update('a'.repeat(TRANSCRIPT_RAW_LIMIT));
    terminals[0].finish('a');
    session.update('a'.repeat(TRANSCRIPT_RAW_LIMIT) + 'END');
    expect(terminals[0].terminal.dispose).toHaveBeenCalledTimes(1);
    expect(terminals[1].terminal.write).toHaveBeenCalledWith(
      'a'.repeat(TRANSCRIPT_RAW_LIMIT - 3) + 'END',
      expect.any(Function),
    );
    terminals[1].finish('END');
    session.update('x'.repeat(TRANSCRIPT_RAW_LIMIT + 200));
    expect(terminals[2].terminal.write).toHaveBeenCalledWith('x'.repeat(TRANSCRIPT_RAW_LIMIT), expect.any(Function));
    session.dispose();
  });

  it('clears output using a fresh parser lifecycle and ignores identical updates', () => {
    const { session, terminals, onText, create } = setupSession();
    session.update('one');
    terminals[0].finish('one');
    session.update('one');
    expect(terminals[0].terminal.write).toHaveBeenCalledTimes(1);
    session.update('');
    expect(terminals[0].terminal.dispose).toHaveBeenCalledTimes(1);
    expect(onText).toHaveBeenLastCalledWith('');
    session.update('two');
    expect(create).toHaveBeenCalledTimes(2);
    session.dispose();
  });

  it('disposes once and ignores callbacks/updates after teardown even with a pending write', () => {
    const { session, terminals, onText, create, onError } = setupSession();
    session.update('one');
    session.dispose();
    session.dispose();
    terminals[0].finish('late');
    session.update('later');
    expect(terminals[0].terminal.dispose).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(onText).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports parser creation/write/extraction failures without falling back to raw bytes', () => {
    const onError = vi.fn();
    const onText = vi.fn();
    const badCreate = createTranscriptSession(
      () => {
        throw new Error('browser unavailable');
      },
      onText,
      onError,
    );
    badCreate.update('\u001b[31mprivate raw');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onText).not.toHaveBeenCalled();

    const fake = fakeTerminal();
    vi.mocked(fake.terminal.write).mockImplementationOnce(() => {
      throw new Error('write rejected');
    });

    const badWrite = createTranscriptSession(() => fake.terminal, onText, onError);
    badWrite.update('one');
    expect(fake.terminal.dispose).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(2);

    const badBuffer = fakeTerminal();
    const badExtract = createTranscriptSession(
      () => badBuffer.terminal,
      () => {
        throw new Error('view detached');
      },
      onError,
    );
    badExtract.update('one');
    badBuffer.finish('one');
    expect(badBuffer.terminal.dispose).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(3);
  });
});
