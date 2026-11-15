import type { WebContainer, WebContainerProcess } from '@webcontainer/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ITerminal } from '~/types/terminal';
import { withResolvers } from '~/utils/promises';
import { ASSISTANT_OUTPUT_LIMIT, TERMINAL_RUNTIME_TIMEOUT_MS, TerminalStore } from './terminal';

function terminal(): ITerminal {
  return { reset: vi.fn(), write: vi.fn(), onData: vi.fn(() => ({ dispose: vi.fn() })) };
}

function processFixture() {
  const exit = withResolvers<number>();
  const process = {
    input: new WritableStream<string>(),
    output: new ReadableStream<string>({
      start(controller) {
        controller.enqueue('\x1b]654;interactive\x07');
      },
    }),
    exit: exit.promise,
    kill: vi.fn(() => exit.resolve(143)),
    resize: vi.fn(),
  } as unknown as WebContainerProcess;

  return { process, exit };
}

function containerFixture(children: ReturnType<typeof processFixture>[]) {
  const spawn = vi.fn(async () => children.shift()!.process);

  return { container: { spawn } as unknown as WebContainer, spawn };
}

async function flush() {
  for (let index = 0; index < 20; index++) {
    await Promise.resolve();
  }
}

afterEach(() => vi.useRealTimers());

describe('TerminalStore lifecycle unit tests (deterministic process mocks)', () => {
  it('buffers/replays assistant output before mounting and never acquires shell input', () => {
    const runtime = containerFixture([]);
    const store = new TerminalStore(Promise.resolve(runtime.container));
    const assistant = terminal();
    store.writeAssistantOutput('old' + 'x'.repeat(ASSISTANT_OUTPUT_LIMIT) + 'TAIL');

    const cleanup = store.attachAssistantTerminal(assistant);
    expect(assistant.write).toHaveBeenCalledWith(expect.stringMatching(/TAIL$/));
    expect(vi.mocked(assistant.write).mock.calls[0][0]).toHaveLength(ASSISTANT_OUTPUT_LIMIT);
    expect(assistant.onData).not.toHaveBeenCalled();
    expect(runtime.spawn).not.toHaveBeenCalled();
    store.writeAssistantOutput('live');
    expect(assistant.write).toHaveBeenLastCalledWith('live');
    cleanup();
    cleanup();
    store.writeAssistantOutput('after unmount');
    expect(assistant.write).toHaveBeenCalledTimes(2);

    const remounted = terminal();
    store.attachAssistantTerminal(remounted);
    expect(remounted.write).toHaveBeenCalledWith(expect.stringContaining('liveafter unmount'));
  });

  it('resizes only the originating interactive process and cleanup does not kill other shells', async () => {
    const first = processFixture();
    const second = processFixture();
    const runtime = containerFixture([first, second]);
    const store = new TerminalStore(Promise.resolve(runtime.container));
    const terminal1 = terminal();
    const terminal2 = terminal();
    const cleanup1 = await store.attachTerminal(terminal1);
    const cleanup2 = await store.attachTerminal(terminal2);
    store.onTerminalResize(90, 24, terminal1);
    expect(first.process.resize).toHaveBeenCalledWith({ cols: 90, rows: 24 });
    expect(second.process.resize).not.toHaveBeenCalled();
    store.onTerminalResize(91, 25);
    expect(first.process.resize).toHaveBeenCalledTimes(1);
    expect(second.process.resize).not.toHaveBeenCalled();
    await cleanup1();
    await cleanup1();
    expect(first.process.kill).toHaveBeenCalledTimes(1);
    expect(second.process.kill).not.toHaveBeenCalled();
    store.onTerminalResize(100, 30);
    expect(second.process.resize).toHaveBeenCalledWith({ cols: 100, rows: 30 });
    await cleanup2();
    expect(second.process.kill).toHaveBeenCalledTimes(1);
  });

  it('cancels an attachment immediately when disposed before awaiting the runtime', async () => {
    const container = withResolvers<WebContainer>();
    const runtime = containerFixture([]);
    const store = new TerminalStore(container.promise);
    const view = terminal();
    const failed = expect(store.attachTerminal(view)).rejects.toThrow('aborted');
    await store.dispose();
    await failed;
    container.resolve(runtime.container);
    await flush();
    expect(runtime.spawn).not.toHaveBeenCalled();
    expect(view.write).not.toHaveBeenCalled();
  });

  it('kills a pending shell spawn that resolves after detach without writing to the unmounted view', async () => {
    const child = processFixture();
    const runtime = containerFixture([]);
    const spawning = withResolvers<WebContainerProcess>();
    runtime.spawn.mockImplementation(() => spawning.promise);

    const store = new TerminalStore(Promise.resolve(runtime.container));
    const view = terminal();
    const failed = expect(store.attachTerminal(view)).rejects.toThrow('aborted');
    await flush();
    await store.detachTerminal(view);
    await failed;
    spawning.resolve(child.process);
    await flush();
    expect(child.process.kill).toHaveBeenCalledTimes(1);
    expect(view.write).not.toHaveBeenCalled();
    expect(view.onData).not.toHaveBeenCalled();
  });

  it('disposes owned shells, clears assistant subscriptions, and refuses new attachments', async () => {
    const child = processFixture();
    const runtime = containerFixture([child]);
    const store = new TerminalStore(Promise.resolve(runtime.container));
    const view = terminal();
    const assistant = terminal();
    await store.attachTerminal(view);
    store.attachAssistantTerminal(assistant);
    await store.dispose();
    expect(child.process.kill).toHaveBeenCalledTimes(1);
    store.writeAssistantOutput('after disposal');
    expect(assistant.write).not.toHaveBeenCalled();
    await expect(store.attachTerminal(terminal())).rejects.toThrow('disposed');
    expect(() => store.attachAssistantTerminal(terminal())).toThrow('disposed');
  });

  it('does not register a failed startup as ready and displays its actual error', async () => {
    const runtime = containerFixture([]);
    runtime.spawn.mockRejectedValue(new Error('runtime spawn failure'));

    const store = new TerminalStore(Promise.resolve(runtime.container));
    const view = terminal();
    await expect(store.attachTerminal(view)).rejects.toThrow('runtime spawn failure');
    expect(view.write).toHaveBeenCalledWith(expect.stringContaining('runtime spawn failure'));
    await store.detachTerminal(view);
  });

  it('observes and displays real failures after an interactive attachment is ready', async () => {
    const child = processFixture();
    const runtime = containerFixture([child]);
    const store = new TerminalStore(Promise.resolve(runtime.container));
    const view = terminal();
    await store.attachTerminal(view);
    child.exit.resolve(5);
    await flush();
    expect(view.write).toHaveBeenCalledWith(expect.stringContaining('Shell exited with code 5'));
    await store.dispose();
  });

  it('allows cold runtime boot beyond the shell OSC budget without claiming readiness', async () => {
    vi.useFakeTimers();

    const child = processFixture();
    const runtime = containerFixture([child]);
    const boot = withResolvers<WebContainer>();
    const store = new TerminalStore(boot.promise);
    const view = terminal();
    const attachment = store.attachTerminal(view);
    const settled = vi.fn();
    void attachment.then(settled);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(runtime.spawn).not.toHaveBeenCalled();
    expect(settled).not.toHaveBeenCalled();
    expect(view.write).not.toHaveBeenCalled();
    boot.resolve(runtime.container);

    const cleanup = await attachment;
    expect(runtime.spawn).toHaveBeenCalledTimes(1);
    await cleanup();
  });

  it('fails an unresolved runtime boot at its separate bounded deadline', async () => {
    vi.useFakeTimers();

    const store = new TerminalStore(new Promise(() => undefined));
    const view = terminal();
    const failed = expect(store.attachTerminal(view)).rejects.toThrow('Terminal runtime startup timed out');
    await vi.advanceTimersByTimeAsync(TERMINAL_RUNTIME_TIMEOUT_MS);
    await failed;
    expect(view.write).toHaveBeenCalledWith(expect.stringContaining('Terminal runtime startup timed out'));
    expect(view.onData).not.toHaveBeenCalled();
    await store.dispose();
  });
});
