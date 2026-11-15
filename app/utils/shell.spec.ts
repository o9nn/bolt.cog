import type { WebContainer, WebContainerProcess } from '@webcontainer/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ITerminal } from '~/types/terminal';
import { withResolvers } from './promises';
import { newShellProcess } from './shell';

// deterministic process/stream UNIT tests; no model inference or real browser runtime is mocked as proof
function fixture() {
  const exit = withResolvers<number>();
  let output!: ReadableStreamDefaultController<string>;
  const outputStream = new ReadableStream<string>({
    start(controller) {
      output = controller;
    },
  });
  const writes = vi.fn();
  const input = new WritableStream<string>({ write: writes });
  const kill = vi.fn(() => exit.resolve(143));
  const process = {
    input,
    output: outputStream,
    exit: exit.promise,
    kill,
    resize: vi.fn(),
  } as unknown as WebContainerProcess;
  const spawn = vi.fn(async () => process);
  const container = { spawn } as unknown as WebContainer;
  const handlers = new Set<(data: string) => void>();
  const listenerDispose = vi.fn();
  const terminal: ITerminal = {
    cols: 100,
    rows: 30,
    write: vi.fn(),
    reset: vi.fn(),
    onData: vi.fn((handler) => {
      handlers.add(handler);

      return {
        dispose: () => {
          handlers.delete(handler);
          listenerDispose();
        },
      };
    }),
  };

  return {
    process,
    container,
    spawn,
    terminal,
    writes,
    handlers,
    kill,
    input,
    outputStream,
    exit,
    listenerDispose,
    write: (data: string) => output.enqueue(data),
    close: () => output.close(),
    outputError: (error: Error) => output.error(error),
    type: (data: string) => handlers.forEach((handler) => handler(data)),
  };
}

async function flush() {
  for (let index = 0; index < 20; index++) {
    await Promise.resolve();
  }
}

afterEach(() => vi.useRealTimers());

describe('newShellProcess lifecycle unit tests (deterministic process mocks)', () => {
  it.each(['\x07', '\x1b\\'])(
    'handles OSC split at every boundary with terminator %j and flushes early input',
    async (terminator) => {
      const mock = fixture();
      const attachment = newShellProcess(mock.container, mock.terminal);
      await flush();
      mock.type('echo early\r');
      expect(mock.writes).not.toHaveBeenCalled();

      const marker = '\x1b]654;interactive' + terminator;

      for (const character of marker) {
        mock.write(character);
        await flush();
      }

      const shell = await attachment;
      await flush();
      expect(mock.spawn).toHaveBeenCalledWith('/bin/jsh', ['--osc'], { terminal: { cols: 100, rows: 30 } });
      expect(mock.writes).toHaveBeenCalledWith('echo early\r', expect.anything());
      mock.type('echo ready\r');
      await flush();
      expect(mock.writes).toHaveBeenCalledWith('echo ready\r', expect.anything());
      expect(vi.mocked(mock.terminal.write).mock.calls.flat().join('')).toBe(marker);
      await shell.dispose();
      await shell.dispose();
      expect(mock.kill).toHaveBeenCalledTimes(1);
      expect(mock.listenerDispose).toHaveBeenCalledTimes(1);
      expect(mock.handlers.size).toBe(0);
      expect(mock.input.locked).toBe(false);
      expect(mock.outputStream.locked).toBe(false);
      await expect(shell.done).resolves.toBeUndefined();
    },
  );

  it('does not interpret unrelated OSC as readiness and rejects with a bounded timeout', async () => {
    vi.useFakeTimers();

    const mock = fixture();
    const failed = expect(newShellProcess(mock.container, mock.terminal, { readyTimeoutMs: 50 })).rejects.toThrow(
      'did not become interactive',
    );
    await flush();
    mock.write('\x1b]654;prompt\x07');
    await vi.advanceTimersByTimeAsync(50);
    await failed;
    expect(mock.kill).toHaveBeenCalledTimes(1);
    expect(mock.handlers.size).toBe(0);
    expect(mock.input.locked).toBe(false);
  });

  it('rejects an exit before readiness even with exit code zero', async () => {
    const mock = fixture();
    const failed = expect(newShellProcess(mock.container, mock.terminal)).rejects.toThrow(
      'exited with code 0 before interactive',
    );
    await flush();
    mock.exit.resolve(0);
    await failed;
    expect(mock.handlers.size).toBe(0);
    expect(mock.kill).not.toHaveBeenCalled();
  });

  it('rejects an output close or read failure before readiness', async () => {
    for (const outputFailure of [false, true]) {
      const mock = fixture();
      const failed = expect(newShellProcess(mock.container, mock.terminal)).rejects.toThrow(
        outputFailure ? 'Shell output failed' : 'closed before interactive',
      );
      await flush();

      if (outputFailure) {
        mock.outputError(new Error('read failure'));
      } else {
        mock.close();
      }

      await failed;
      expect(mock.kill).toHaveBeenCalledTimes(1);
      expect(mock.handlers.size).toBe(0);
    }
  });

  it('reports a rejected input write after readiness through done and cleans owned resources', async () => {
    const mock = fixture();
    mock.writes.mockImplementation(() => {
      throw new Error('input failure');
    });

    const attachment = newShellProcess(mock.container, mock.terminal);
    await flush();
    mock.write('\x1b]654;interactive\x07');

    const shell = await attachment;
    const failed = expect(shell.done).rejects.toThrow('Shell input failed');
    mock.type('command\r');
    await failed;
    await flush();
    expect(mock.kill).toHaveBeenCalledTimes(1);
    expect(mock.handlers.size).toBe(0);
    await expect(shell.dispose()).rejects.toThrow('Shell input failed');
    expect(mock.input.locked).toBe(false);
  });

  it('reports a rejected output read and exit after readiness', async () => {
    for (const outputFailure of [false, true]) {
      const mock = fixture();
      const attachment = newShellProcess(mock.container, mock.terminal);
      await flush();
      mock.write('\x1b]654;interactive\x07');

      const shell = await attachment;
      const failed = expect(shell.done).rejects.toThrow(outputFailure ? 'Shell output failed' : 'Shell exit failed');

      if (outputFailure) {
        mock.outputError(new Error('broken stdout'));
      } else {
        mock.exit.reject(new Error('lost process'));
      }

      await failed;
      await flush();
      expect(mock.handlers.size).toBe(0);
      await expect(shell.dispose()).rejects.toThrow();
    }
  });

  it('supports cancellation during pending startup and kills a spawn that resolves after cancellation', async () => {
    const mock = fixture();
    const spawning = withResolvers<WebContainerProcess>();
    mock.spawn.mockImplementation(() => spawning.promise);

    const controller = new AbortController();
    const failed = expect(
      newShellProcess(mock.container, mock.terminal, { signal: controller.signal }),
    ).rejects.toThrow('aborted');
    await flush();
    controller.abort();
    await failed;
    spawning.resolve(mock.process);
    await flush();
    expect(mock.kill).toHaveBeenCalledTimes(1);
    expect(mock.terminal.onData).not.toHaveBeenCalled();
  });

  it('bounds a spawn that never resolves', async () => {
    vi.useFakeTimers();

    const mock = fixture();
    mock.spawn.mockImplementation(() => new Promise(() => undefined));

    const failed = expect(newShellProcess(mock.container, mock.terminal, { readyTimeoutMs: 50 })).rejects.toThrow(
      'did not become interactive',
    );
    await vi.advanceTimersByTimeAsync(50);
    await failed;
    expect(mock.terminal.onData).not.toHaveBeenCalled();
  });

  it('uses the fallback dimensions and releases input subscriptions on normal exit', async () => {
    const mock = fixture();
    const terminal = { ...mock.terminal, cols: undefined, rows: undefined };
    const attachment = newShellProcess(mock.container, terminal);
    await flush();
    mock.write('\x1b]654;interactive\x07');

    const shell = await attachment;
    expect(mock.spawn).toHaveBeenCalledWith('/bin/jsh', ['--osc'], { terminal: { cols: 80, rows: 15 } });
    mock.exit.resolve(0);
    await shell.done;
    expect(mock.handlers.size).toBe(0);
    expect(mock.kill).not.toHaveBeenCalled();
    expect(mock.input.locked).toBe(false);
  });
});
