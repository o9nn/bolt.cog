import type { WebContainer, WebContainerProcess } from '@webcontainer/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BoltAction } from '~/types/actions';
import { withResolvers } from '~/utils/promises';
import {
  ActionRunner,
  ACTION_OUTPUT_LIMIT,
  BACKGROUND_STARTUP_TIMEOUT_MS,
  SHELL_EXECUTION_TIMEOUT_MS,
} from './action-runner';
import { StreamingMessageParser, type ActionCallbackData } from './message-parser';

// these are deterministic runtime UNIT tests, not browser/WebContainer or model-inference proof
function fakeProcess() {
  const exit = withResolvers<number>();
  let output!: ReadableStreamDefaultController<string>;
  let closed = false;
  const stream = new ReadableStream<string>({
    start(controller) {
      output = controller;
    },
    cancel() {
      closed = true;
    },
  });
  const finish = (code = 0) => {
    if (!closed) {
      closed = true;
      output.close();
    }

    exit.resolve(code);
  };
  const process = {
    output: stream,
    input: new WritableStream<string>(),
    exit: exit.promise,
    kill: vi.fn(() => finish(143)),
    resize: vi.fn(),
  } as unknown as WebContainerProcess;

  return {
    process,
    finish,
    exit,
    write: (chunk: string) => output.enqueue(chunk),
    error: (error: Error) => {
      closed = true;
      output.error(error);
    },
  };
}

function fakeContainer(processes: ReturnType<typeof fakeProcess>[]) {
  const listeners = new Set<(port: number, url: string) => void>();
  const spawn = vi.fn(async () => processes.shift()!.process);
  const fs = { mkdir: vi.fn(async () => undefined), writeFile: vi.fn(async () => undefined) };
  const container = {
    spawn,
    fs,
    on: vi.fn((_event: string, listener: (port: number, url: string) => void) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    }),
  } as unknown as WebContainer;

  return {
    container,
    spawn,
    fs,
    listeners,
    ready: (port: number) => listeners.forEach((listener) => listener(port, `https://preview-${port}.test`)),
  };
}

function data(id: string, action: BoltAction = { type: 'shell', content: 'printf hello' }): ActionCallbackData {
  return { artifactId: 'artifact', messageId: 'message', actionId: id, action };
}

async function flush() {
  for (let index = 0; index < 15; index++) {
    await Promise.resolve();
  }
}

afterEach(() => vi.useRealTimers());

describe('ActionRunner runtime unit contracts (deterministic process mocks)', () => {
  it('registers inertly and returns one awaitable execution using actual output and exit', async () => {
    const child = fakeProcess();
    const runtime = fakeContainer([child]);
    const output = vi.fn();
    const start = vi.fn();
    const receipt = vi.fn();
    const runner = new ActionRunner(Promise.resolve(runtime.container), {
      onShellOutput: output,
      onShellStart: start,
      onShellResult: receipt,
    });
    const action = data('one');
    runner.addAction(action);
    await flush();
    expect(runtime.spawn).not.toHaveBeenCalled();
    expect(runner.actions.get().one.status).toBe('pending');

    const execution = runner.runAction(action);
    expect(runner.runAction(action)).toBe(execution);

    const settled = vi.fn();
    void execution.then(settled);
    await flush();
    expect(runtime.spawn).toHaveBeenCalledWith('jsh', ['-c', 'printf hello'], { env: { npm_config_yes: true } });
    child.write('stdout\n');
    child.write('stderr\n');
    await flush();
    expect(settled).not.toHaveBeenCalled();
    child.finish(0);

    const state = await execution;
    expect(state).toMatchObject({ status: 'complete', exitCode: 0, output: 'stdout\nstderr\n' });
    expect(output.mock.calls.flat()).toEqual(['stdout\n', 'stderr\n']);
    expect(start).toHaveBeenCalledWith('printf hello');
    expect(receipt).toHaveBeenCalledWith(
      expect.objectContaining({ actionId: 'one', command: 'printf hello', status: 'complete', exitCode: 0 }),
    );
    expect(runner.results.one.output).toBe(state.output);
    expect(Object.isFrozen(runner.results.one)).toBe(true);
    expect(runtime.spawn).toHaveBeenCalledTimes(1);
  });

  it('rejects with failure/output/exit code without poisoning the next serial job', async () => {
    const first = fakeProcess();
    const second = fakeProcess();
    const runtime = fakeContainer([first, second]);
    const runner = new ActionRunner(Promise.resolve(runtime.container));
    runner.addAction(data('bad'));
    runner.addAction(data('good'));

    const bad = runner.runAction(data('bad'));
    const failed = expect(bad).rejects.toMatchObject({
      state: { status: 'failed', exitCode: 7, output: 'real failure' },
    });
    const good = runner.runAction(data('good'));
    await flush();
    expect(runtime.spawn).toHaveBeenCalledTimes(1);
    first.write('real failure');
    first.finish(7);
    await failed;
    await flush();
    expect(runtime.spawn).toHaveBeenCalledTimes(2);
    second.finish(0);
    await expect(good).resolves.toMatchObject({ status: 'complete' });
    await runner.waitForIdle();
  });

  it('retains a bounded tail while streaming every chunk without a mounted xterm', async () => {
    const child = fakeProcess();
    const runtime = fakeContainer([child]);
    const output = vi.fn();
    const runner = new ActionRunner(Promise.resolve(runtime.container), { onShellOutput: output });
    runner.addAction(data('tail'));

    const execution = runner.runAction(data('tail'));
    await flush();

    const text = 'x'.repeat(ACTION_OUTPUT_LIMIT + 100) + 'END';
    child.write(text);
    child.finish();

    const state = await execution;
    expect(state.output).toHaveLength(ACTION_OUTPUT_LIMIT);
    expect(state.output.endsWith('END')).toBe(true);
    expect(output).toHaveBeenCalledWith(text);
  });

  it('releases the queue only for the explicit matching server-ready event, then keeps output and exit live', async () => {
    const child = fakeProcess();
    const runtime = fakeContainer([child]);
    const receipt = vi.fn();
    const runner = new ActionRunner(Promise.resolve(runtime.container), { onShellResult: receipt });
    const action = data('server', { type: 'shell', content: 'npm run dev', background: true, port: 5173 });
    runner.addAction(action);
    runner.addAction(data('file', { type: 'file', filePath: 'src/index.ts', content: 'export {};' }));

    const startup = runner.runAction(action);
    const file = runner.runAction(data('file', { type: 'file', filePath: 'src/index.ts', content: 'export {};' }));
    await flush();
    child.write('ready http://localhost:5173');
    runtime.ready(9999);
    await flush();
    expect(runner.actions.get().server.status).toBe('running');
    expect(runtime.fs.writeFile).not.toHaveBeenCalled();
    runtime.ready(5173);

    const started = await startup;
    expect(started.status).toBe('started');
    expect(started.exitCode).toBeUndefined();
    await file;
    await runner.waitForIdle();
    expect(child.process.kill).not.toHaveBeenCalled();
    child.write('still running');
    await flush();
    expect(runner.actions.get().server.output).toContain('still running');
    child.finish(9);
    await flush();
    expect(runner.actions.get().server).toMatchObject({ status: 'failed', exitCode: 9 });
    expect(receipt.mock.calls.map(([result]) => result.status)).toEqual(['started', 'failed']);
    expect(runtime.listeners.size).toBe(0);
  });

  it('times out and kills a background action that never produces matching readiness', async () => {
    vi.useFakeTimers();

    const child = fakeProcess();
    const runtime = fakeContainer([child]);
    const runner = new ActionRunner(Promise.resolve(runtime.container));
    const action = data('server', { type: 'shell', content: 'npm run dev', background: true, port: 5173 });
    runner.addAction(action);

    const failed = expect(runner.runAction(action)).rejects.toMatchObject({
      state: { status: 'failed', error: expect.stringContaining('not ready') },
    });
    await flush();
    await vi.advanceTimersByTimeAsync(BACKGROUND_STARTUP_TIMEOUT_MS);
    await failed;
    expect(child.process.kill).toHaveBeenCalledTimes(1);
    expect(runtime.listeners.size).toBe(0);
    await runner.waitForIdle();
  });

  it('fails a background process even when exit is zero if readiness never happened', async () => {
    const child = fakeProcess();
    const runtime = fakeContainer([child]);
    const runner = new ActionRunner(Promise.resolve(runtime.container));
    const action = data('server', { type: 'shell', content: 'echo not-a-server', background: true, port: 5173 });
    runner.addAction(action);

    const failed = expect(runner.runAction(action)).rejects.toMatchObject({ state: { status: 'failed', exitCode: 0 } });
    await flush();
    child.finish(0);
    await failed;
    expect(runtime.listeners.size).toBe(0);
  });

  it('abortAll cancels pending commands and a live started server, but not already completed actions', async () => {
    const child = fakeProcess();
    const runtime = fakeContainer([child]);
    const runner = new ActionRunner(Promise.resolve(runtime.container));
    const action = data('server', { type: 'shell', content: 'npm run dev', background: true, port: 5173 });
    runner.addAction(action);

    const startup = runner.runAction(action);
    await flush();
    runtime.ready(5173);
    await startup;
    runner.addAction(data('pending'));
    runner.abortAll();
    await flush();
    expect(child.process.kill).toHaveBeenCalledTimes(1);
    expect(runner.actions.get().server.status).toBe('aborted');
    await expect(runner.runAction(data('pending'))).resolves.toMatchObject({ status: 'aborted' });
    expect(runtime.spawn).toHaveBeenCalledTimes(1);
    await runner.waitForIdle();
  });

  it('cancels a finite process even if kill does not resolve exit', async () => {
    const child = fakeProcess();
    vi.mocked(child.process.kill).mockImplementation(() => undefined);

    const runtime = fakeContainer([child]);
    const runner = new ActionRunner(Promise.resolve(runtime.container));
    runner.addAction(data('one'));

    const execution = runner.runAction(data('one'));
    await flush();
    runner.abortAll();
    await expect(execution).resolves.toMatchObject({ status: 'aborted' });
    await runner.waitForIdle();
    child.exit.resolve(143);
  });

  it('bounds finite command hangs rather than leaving the queue blocked', async () => {
    vi.useFakeTimers();

    const child = fakeProcess();
    const runtime = fakeContainer([child]);
    const runner = new ActionRunner(Promise.resolve(runtime.container));
    runner.addAction(data('one'));

    const failed = expect(runner.runAction(data('one'))).rejects.toMatchObject({
      state: { status: 'failed', error: expect.stringContaining('timed out') },
    });
    await flush();
    await vi.advanceTimersByTimeAsync(SHELL_EXECUTION_TIMEOUT_MS);
    await failed;
    expect(child.process.kill).toHaveBeenCalledTimes(1);
  });

  it('kills a late spawn after cancellation and propagates output-pipe failures', async () => {
    const child = fakeProcess();
    const runtime = fakeContainer([]);
    const spawning = withResolvers<WebContainerProcess>();
    runtime.spawn.mockImplementationOnce(() => spawning.promise);

    const runner = new ActionRunner(Promise.resolve(runtime.container));
    runner.addAction(data('late'));

    const execution = runner.runAction(data('late'));
    await flush();
    runner.abortAll();
    await expect(execution).resolves.toMatchObject({ status: 'aborted' });
    spawning.resolve(child.process);
    await flush();
    expect(child.process.kill).toHaveBeenCalledTimes(1);

    const broken = fakeProcess();
    const other = fakeContainer([broken]);
    const runner2 = new ActionRunner(Promise.resolve(other.container));
    runner2.addAction(data('broken'));

    const failed = expect(runner2.runAction(data('broken'))).rejects.toMatchObject({
      state: { status: 'failed', error: expect.stringContaining('Shell output failed') },
    });
    await flush();
    broken.error(new Error('output read failure'));
    await failed;
  });

  it.each(['../escape', '/absolute', '<boltAction', '.', 'folder/', 'C:\\escape', ''])(
    'rejects invalid file path %s',
    async (filePath) => {
      const runtime = fakeContainer([]);
      const runner = new ActionRunner(Promise.resolve(runtime.container));
      const action = data('invalid', { type: 'file', filePath, content: 'text' });
      runner.addAction(action);
      await expect(runner.runAction(action)).rejects.toThrow('invalid workspace-relative');
      expect(runtime.fs.writeFile).not.toHaveBeenCalled();
    },
  );

  it('rejects unknown types, missing background ports, and blank commands', async () => {
    const runtime = fakeContainer([]);
    const runner = new ActionRunner(Promise.resolve(runtime.container));

    for (const [id, action] of [
      ['unknown', { type: 'unknown', content: 'text' }],
      ['background', { type: 'shell', content: 'npm run dev', background: true }],
      ['empty', { type: 'shell', content: '   ' }],
    ] as [string, BoltAction][]) {
      const callback = data(id, action);
      runner.addAction(callback);
      await expect(runner.runAction(callback)).rejects.toThrow();
      expect(runner.actions.get()[id].status).toBe('failed');
    }

    expect(runtime.spawn).not.toHaveBeenCalled();
  });

  it('does not let another runner claim a live server port and releases the reservation on exit', async () => {
    const first = fakeProcess();
    const next = fakeProcess();
    const runtime = fakeContainer([first, next]);
    const runner1 = new ActionRunner(Promise.resolve(runtime.container));
    const runner2 = new ActionRunner(Promise.resolve(runtime.container));
    const server = data('server', { type: 'shell', content: 'npm run dev', background: true, port: 5173 });
    runner1.addAction(server);

    const startup = runner1.runAction(server);
    await flush();
    runtime.ready(5173);
    await startup;
    runner2.addAction(server);
    await expect(runner2.runAction(server)).rejects.toThrow('already owned');
    expect(runtime.spawn).toHaveBeenCalledTimes(1);
    first.finish();
    await flush();

    const runner3 = new ActionRunner(Promise.resolve(runtime.container));
    runner3.addAction(server);

    const restarting = runner3.runAction(server);
    await flush();
    runtime.ready(5173);
    await restarting;
    runner3.abortAll();
    await flush();
    expect(next.process.kill).toHaveBeenCalledTimes(1);
  });

  it('does not mark an already-exited process started on a later matching event', async () => {
    const child = fakeProcess();
    const runtime = fakeContainer([child]);
    const runner = new ActionRunner(Promise.resolve(runtime.container));
    const server = data('server', { type: 'shell', content: 'echo done', background: true, port: 5173 });
    runner.addAction(server);

    const failed = expect(runner.runAction(server)).rejects.toMatchObject({ state: { status: 'failed', exitCode: 0 } });
    await flush();
    child.finish();
    await Promise.resolve();
    runtime.ready(5173);
    await failed;
    expect(runner.results.server.status).toBe('failed');
  });

  it('keeps actual process status truthful when a display observer throws', async () => {
    const child = fakeProcess();
    const runtime = fakeContainer([child]);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const runner = new ActionRunner(Promise.resolve(runtime.container), {
      onShellOutput: () => {
        throw new Error('view detached');
      },
    });
    runner.addAction(data('one'));

    const execution = runner.runAction(data('one'));
    await flush();
    child.write('actual stdout');
    child.finish();
    await expect(execution).resolves.toMatchObject({ status: 'complete', exitCode: 0, output: 'actual stdout' });
    log.mockRestore();
  });

  it('does not execute truncated parser output that never reaches onActionClose', async () => {
    const runtime = fakeContainer([]);
    const runner = new ActionRunner(Promise.resolve(runtime.container));
    const close = vi.fn((action: ActionCallbackData) => {
      runner.addAction(action);
      return runner.runAction(action);
    });
    const parser = new StreamingMessageParser({ callbacks: { onActionClose: close } });
    parser.parse('truncated', '<boltArtifact id="a" title="test"><boltAction type="shell">echo partial');
    await flush();
    expect(close).not.toHaveBeenCalled();
    expect(runtime.spawn).not.toHaveBeenCalled();
    expect(runner.actions.get()).toEqual({});
  });
});
