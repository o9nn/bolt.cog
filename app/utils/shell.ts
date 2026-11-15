import type { WebContainer, WebContainerProcess } from '@webcontainer/api';
import type { ITerminal } from '~/types/terminal';
import { withResolvers } from './promises';

export const SHELL_READY_TIMEOUT_MS = 15_000;

const INPUT_BUFFER_LIMIT = 32 * 1024;
const CLEANUP_TIMEOUT_MS = 2_000;

export interface ShellProcessOptions {
  signal?: AbortSignal;
  readyTimeoutMs?: number;
}

/** Owns only this shell's process, stream locks, and terminal input subscription. */
export type ShellProcess = WebContainerProcess & {
  dispose: () => Promise<void>;

  /** Rejects on real input/output/exit failures, including failures after readiness. */
  done: Promise<void>;
};

export async function newShellProcess(
  webcontainer: WebContainer,
  terminal: ITerminal,
  options: ShellProcessOptions = {},
): Promise<ShellProcess> {
  const ready = withResolvers<void>();
  const done = withResolvers<void>();

  /**
   * Consumers can await these promises; internal observers also prevent fire-and-forget
   * callers from creating unhandled rejections before attachment has returned.
   */
  void ready.promise.catch(() => undefined);
  void done.promise.catch(() => undefined);

  const outputController = new AbortController();
  let process: WebContainerProcess | undefined;
  let input: WritableStreamDefaultWriter<string> | undefined;
  let inputListener: void | { dispose: () => void };
  let output: Promise<void> = Promise.resolve();
  let inputWrites: Promise<void> = Promise.resolve();
  let interactive = false;
  let disposed = false;
  let exited = false;
  let markerBuffer = '';
  let pendingInput = '';
  let cleanupPromise: Promise<void> | undefined;
  let failure: Error | undefined;

  const cleanup = (kill: boolean): Promise<void> => {
    if (cleanupPromise) {
      return cleanupPromise;
    }

    disposed = true;
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);

    try {
      inputListener?.dispose();
    } catch (error) {
      failure ??= new Error(`Shell input listener cleanup failed: ${String(error)}`);
    }

    pendingInput = '';
    outputController.abort();

    if (kill && process && !exited) {
      try {
        process.kill();
      } catch (error) {
        failure ??= new Error(`Shell process cleanup failed: ${String(error)}`);
      }
    }

    cleanupPromise = (async () => {
      try {
        let cleanupTimer: ReturnType<typeof setTimeout> | undefined;

        try {
          await Promise.race([
            Promise.all([
              output,
              input?.abort().catch((error) => {
                /**
                 * Abort can reject for an already-errored input stream. Preserve that
                 * failure rather than creating an ignored rejected write/abort promise.
                 */
                if (!failure && !exited) {
                  failure = new Error(`Shell input cleanup failed: ${String(error)}`);
                }
              }),
            ]),
            new Promise<never>((_, reject) => {
              cleanupTimer = setTimeout(() => reject(new Error('Shell stream cleanup timed out')), CLEANUP_TIMEOUT_MS);
            }),
          ]);
        } finally {
          clearTimeout(cleanupTimer);
        }
      } catch (error) {
        failure ??= error instanceof Error ? error : new Error(String(error));
      } finally {
        try {
          input?.releaseLock();
        } catch (error) {
          failure ??= new Error(`Shell input unlock failed: ${String(error)}`);
        }
      }

      if (failure) {
        done.reject(failure);
        throw failure;
      }

      done.resolve();
    })();

    /**
     * The dispose caller receives failures; done also carries failures from automatic
     * exit/stream cleanup, so none of the automatic cleanup branches are unobserved.
     */
    void cleanupPromise.catch(() => undefined);

    return cleanupPromise;
  };

  const fail = (error: unknown) => {
    if (disposed) {
      return;
    }

    failure = error instanceof Error ? error : new Error(String(error));
    ready.reject(failure);
    void cleanup(true);
  };
  const abort = () => {
    if (!interactive) {
      ready.reject(new Error('Shell attachment aborted'));
    }

    void cleanup(true);
  };

  const sendInput = (data: string) => {
    inputWrites = inputWrites
      .then(async () => {
        if (!disposed) {
          await input!.write(data);
        }
      })
      .catch((error) => fail(new Error(`Shell input failed: ${String(error)}`)));
  };

  options.signal?.addEventListener('abort', abort, { once: true });

  const timer = setTimeout(
    () =>
      fail(new Error(`Shell did not become interactive within ${options.readyTimeoutMs ?? SHELL_READY_TIMEOUT_MS}ms`)),
    options.readyTimeoutMs ?? SHELL_READY_TIMEOUT_MS,
  );

  if (options.signal?.aborted) {
    abort();
  }

  try {
    if (disposed) {
      throw new Error('Shell attachment aborted');
    }

    const spawning = webcontainer.spawn('/bin/jsh', ['--osc'], {
      terminal: { cols: terminal.cols ?? 80, rows: terminal.rows ?? 15 },
    });

    try {
      // readiness rejection also bounds a spawn that never settles
      process = await Promise.race([
        spawning,
        ready.promise.then<never>(() => {
          throw new Error('Shell readiness arrived before spawn');
        }),
      ]);
    } catch (error) {
      void spawning
        .then(
          (lateProcess) => lateProcess.kill(),
          () => undefined,
        )
        .catch((lateError) => {
          const error = new Error(`Late shell cleanup failed: ${String(lateError)}`);
          done.reject(error);
          console.error(error);
        });
      throw error;
    }

    if (disposed) {
      process.kill();
      throw failure ?? new Error('Shell attachment aborted');
    }

    input = process.input.getWriter();
    inputListener = terminal.onData((data) => {
      if (disposed) {
        return;
      }

      if (interactive) {
        sendInput(data);
      } else if (pendingInput.length + data.length <= INPUT_BUFFER_LIMIT) {
        pendingInput += data;
      } else {
        fail(new Error('Shell input buffer overflow before readiness'));
      }
    });

    output = process.output
      .pipeTo(
        new WritableStream<string>({
          write(data) {
            if (disposed) {
              return;
            }

            terminal.write(data);

            if (!interactive) {
              /**
               * OSC can be split at ANY chunk boundary; both BEL and ST terminators
               * are legal. Keep a bounded tail, but scan the whole incoming chunk first.
               */
              const markers = markerBuffer + data;

              if (/\x1b\]654;interactive(?:\x07|\x1b\\)/.test(markers)) {
                interactive = true;
                markerBuffer = '';
                clearTimeout(timer);

                if (pendingInput) {
                  sendInput(pendingInput);
                  pendingInput = '';
                }

                ready.resolve();
              } else {
                markerBuffer = markers.slice(-1024);
              }
            }
          },
        }),
        { signal: outputController.signal },
      )
      .then(
        () => {
          if (!disposed && !interactive) {
            fail(new Error('Shell output closed before interactive readiness'));
          }
        },
        (error) => {
          if (!outputController.signal.aborted) {
            fail(new Error(`Shell output failed: ${String(error)}`));
          }
        },
      );

    void process.exit.then(
      (code) => {
        exited = true;

        if (disposed) {
          return;
        }

        if (!interactive) {
          fail(new Error(`Shell exited with code ${code} before interactive readiness`));
        } else if (code !== 0) {
          fail(new Error(`Shell exited with code ${code}`));
        } else {
          void cleanup(false);
        }
      },
      (error) => fail(new Error(`Shell exit failed: ${String(error)}`)),
    );

    await ready.promise;

    if (disposed) {
      throw failure ?? new Error('Shell attachment aborted');
    }

    return Object.assign(process, { dispose: () => cleanup(true), done: done.promise });
  } catch (error) {
    if (!disposed) {
      failure = error instanceof Error ? error : new Error(String(error));
      ready.reject(failure);
      done.reject(failure);
    }

    await cleanup(true).catch(() => undefined);
    throw error;
  }
}
