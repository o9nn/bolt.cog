import type { WebContainer, WebContainerProcess } from '@webcontainer/api';
import { map, type MapStore } from 'nanostores';
import * as nodePath from 'node:path';
import type { BoltAction } from '~/types/actions';
import { createScopedLogger } from '~/utils/logger';
import { withResolvers } from '~/utils/promises';
import type { ActionCallbackData } from './message-parser';

const logger = createScopedLogger('ActionRunner');
export const ACTION_OUTPUT_LIMIT = 32 * 1024;
export const BACKGROUND_STARTUP_TIMEOUT_MS = 30_000;
export const SHELL_EXECUTION_TIMEOUT_MS = 300_000;

const OUTPUT_DRAIN_TIMEOUT_MS = 2_000;

// reservations prevent two runners from claiming the same preview port in one container
const previewPorts = new WeakMap<WebContainer, Set<number>>();

export type ActionStatus = 'pending' | 'running' | 'started' | 'complete' | 'aborted' | 'failed';

export type BaseActionState = BoltAction & {
  status: Exclude<ActionStatus, 'failed'>;
  abort: () => void;
  executed: boolean;
  abortSignal: AbortSignal;
  output: string;
  exitCode?: number;
  error?: string;
};

export type FailedActionState = BoltAction & Omit<BaseActionState, 'status'> & { status: 'failed'; error: string };
export type ActionState = BaseActionState | FailedActionState;
export type ActionStateUpdate = Partial<
  Pick<BaseActionState, 'abort' | 'executed' | 'output' | 'exitCode' | 'error'>
> & { status?: ActionStatus };
type ActionsMap = MapStore<Record<string, ActionState>>;

export interface ShellActionResult {
  actionId: string;
  command: string;
  status: ActionStatus;
  output: string;
  exitCode?: number;
  error?: string;
}

export interface ActionRunnerOptions {
  onShellOutput?: (chunk: string) => void;
  onShellStart?: (command: string) => void;
  onShellResult?: (result: ShellActionResult) => void;
}

export class ActionExecutionError extends Error {
  constructor(
    readonly actionId: string,
    readonly state: ActionState,
  ) {
    super(state.error ?? `Action ${actionId} failed`);
    this.name = 'ActionExecutionError';
  }
}

type ProcessOutcome = { exitCode?: number; error?: string; stopped?: boolean };

export class ActionRunner {
  #webcontainer: Promise<WebContainer>;
  #options: ActionRunnerOptions;
  #currentExecutionPromise: Promise<void> = Promise.resolve();
  #executions = new Map<string, Promise<ActionState>>();
  #results: Record<string, ShellActionResult> = {};
  #finished = new Set<string>();

  actions: ActionsMap = map({});

  constructor(webcontainerPromise: Promise<WebContainer>, options: ActionRunnerOptions = {}) {
    this.#webcontainer = webcontainerPromise;
    this.#options = options;
  }

  /** Snapshot of the latest shell receipts; a started receipt is not an exit receipt. */
  get results(): Readonly<Record<string, Readonly<ShellActionResult>>> {
    return Object.fromEntries(Object.entries(this.#results).map(([id, result]) => [id, Object.freeze({ ...result })]));
  }

  /** Registration is inert: only the parser's closed-action callback may call runAction. */
  addAction(data: ActionCallbackData) {
    const { actionId } = data;

    if (this.actions.get()[actionId]) {
      return;
    }

    const controller = new AbortController();
    this.actions.setKey(actionId, {
      ...data.action,
      status: 'pending',
      executed: false,
      output: '',
      abortSignal: controller.signal,
      abort: () => {
        if (this.#finished.has(actionId)) {
          return;
        }

        controller.abort();
        this.#updateAction(actionId, { status: 'aborted' });

        if (!this.actions.get()[actionId].executed) {
          this.#finishAction(actionId, { status: 'aborted' });
        }
      },
    });
  }

  /**
   * Await real command completion (or verified background startup). Failed actions reject
   * with their recorded state; the private recovery tail keeps subsequent jobs runnable.
   * Duplicate calls share the same execution promise and never execute twice.
   */
  runAction(data: ActionCallbackData): Promise<ActionState> {
    const { actionId } = data;
    const existing = this.#executions.get(actionId);

    if (existing) {
      return existing;
    }

    const action = this.actions.get()[actionId];

    if (!action) {
      return Promise.reject(new Error(`Action ${actionId} not found`));
    }

    this.actions.setKey(actionId, { ...action, ...data.action, executed: true });

    const execution = this.#currentExecutionPromise.then(() => this.#executeAction(actionId));
    this.#executions.set(actionId, execution);
    this.#currentExecutionPromise = execution.then(
      () => undefined,
      () => undefined,
    );

    return execution;
  }

  abortAll() {
    for (const action of Object.values(this.actions.get())) {
      action.abort();
    }
  }

  /** Wait for the serial queue, NOT the lifetime of verified, still-running servers. */
  async waitForIdle(): Promise<void> {
    let tail: Promise<void>;

    do {
      tail = this.#currentExecutionPromise;
      await tail;
    } while (tail !== this.#currentExecutionPromise);
  }

  async #executeAction(actionId: string): Promise<ActionState> {
    const action = this.actions.get()[actionId];

    if (action.abortSignal.aborted) {
      return this.#finishAction(actionId, { status: 'aborted' });
    }

    this.#updateAction(actionId, { status: 'running' });

    try {
      if (action.type !== 'shell' && action.type !== 'file') {
        throw new Error('Refusing to execute an unknown action type');
      }

      if (action.type === 'shell') {
        if (!action.content.trim()) {
          throw new Error('Refusing to execute an empty shell action');
        }

        const result = await this.#runShellAction(actionId);

        if (result.status === 'failed') {
          throw new ActionExecutionError(actionId, result);
        }

        return result;
      }

      await this.#runFileAction(action);

      return this.#finishAction(actionId, { status: action.abortSignal.aborted ? 'aborted' : 'complete' });
    } catch (error) {
      const state = this.#finishAction(actionId, {
        status: action.abortSignal.aborted ? 'aborted' : 'failed',
        error: error instanceof Error ? error.message : String(error),
      });

      if (state.status === 'aborted') {
        return state;
      }

      throw error instanceof ActionExecutionError ? error : new ActionExecutionError(actionId, state);
    }
  }

  async #runShellAction(actionId: string): Promise<ActionState> {
    const action = this.actions.get()[actionId];

    if (action.type !== 'shell') {
      throw new Error('Expected shell action');
    }

    const { background, port } = action;

    if (background && (!Number.isInteger(port) || port! < 1 || port! > 65535)) {
      throw new Error('Background shell actions require an explicit port between 1 and 65535');
    }

    const startupMs = background ? BACKGROUND_STARTUP_TIMEOUT_MS : SHELL_EXECUTION_TIMEOUT_MS;
    const webcontainer = await this.#awaitSetup(this.#webcontainer, action.abortSignal, startupMs);
    const ready = withResolvers<void>();
    let removeReady: (() => void) | undefined;
    let releasePort: (() => void) | undefined;
    let process: WebContainerProcess;
    let processExited = false;

    if (background) {
      const ports = previewPorts.get(webcontainer) ?? new Set<number>();
      previewPorts.set(webcontainer, ports);

      if (ports.has(port!)) {
        throw new Error(`Preview port ${port} is already owned by another background action`);
      }

      ports.add(port!);
      releasePort = () => ports.delete(port!);

      /**
       * Register before spawn so a fast server event is not missed. No regex or
       * startup banner is treated as evidence of a successful server launch.
       */
      try {
        removeReady = webcontainer.on('server-ready', (readyPort, url) => {
          if (readyPort === port && url && !action.abortSignal.aborted && !processExited) {
            ready.resolve();
          }
        });
      } catch (error) {
        releasePort();
        throw error;
      }
    }

    try {
      const spawning = webcontainer.spawn('jsh', ['-c', action.content], { env: { npm_config_yes: true } });

      try {
        process = await this.#awaitSetup(spawning, action.abortSignal, startupMs);
      } catch (error) {
        // a late spawn still belongs to this action; cancellation must not orphan it
        void spawning
          .then((lateProcess) => lateProcess.kill())
          .catch((killError) => logger.error('Late shell cleanup failed', killError));
        throw error;
      }
    } catch (error) {
      removeReady?.();
      releasePort?.();
      throw error;
    }

    this.#notify(() => this.#options.onShellStart?.(action.content));

    const stopped = withResolvers<ProcessOutcome>();
    const outputController = new AbortController();
    let killed = false;

    const stop = (error?: string) => {
      let killError: string | undefined;

      if (!killed) {
        killed = true;

        try {
          process.kill();
        } catch (error) {
          killError = `Process cleanup failed: ${String(error)}`;
          logger.error(killError);
        }
      }

      outputController.abort();
      stopped.resolve({ stopped: true, error: [error, killError].filter(Boolean).join('; ') || undefined });
    };
    const abort = () => stop();
    action.abortSignal.addEventListener('abort', abort, { once: true });

    const output = process.output
      .pipeTo(
        new WritableStream<string>({
          write: (chunk) => {
            const state = this.actions.get()[actionId];
            this.#updateAction(actionId, { output: (state.output + chunk).slice(-ACTION_OUTPUT_LIMIT) });
            this.#notify(() => this.#options.onShellOutput?.(chunk));
          },
        }),
        { signal: outputController.signal },
      )
      .then(
        () => undefined,
        (error) => {
          if (!outputController.signal.aborted) {
            const message = `Shell output failed: ${error instanceof Error ? error.message : String(error)}`;
            stop(message);

            return message;
          }

          return undefined;
        },
      );

    const timer = setTimeout(
      () =>
        stop(
          background
            ? `Preview port ${port} was not ready within ${startupMs}ms`
            : `Shell command timed out after ${startupMs}ms`,
        ),
      startupMs,
    );

    if (action.abortSignal.aborted) {
      abort();
    }

    // this monitor stays owned after startup and emits the eventual exit/failure receipt
    const completion = (async () => {
      try {
        const outcome = await Promise.race([
          process.exit.then<ProcessOutcome, ProcessOutcome>(
            (exitCode) => {
              processExited = true;
              return { exitCode };
            },
            (error) => {
              processExited = true;
              return { error: `Shell exit failed: ${String(error)}` };
            },
          ),
          stopped.promise,
        ]);
        let error = outcome.error;

        if (!outcome.stopped) {
          clearTimeout(timer);

          let drainTimer: ReturnType<typeof setTimeout> | undefined;
          const outputError = await Promise.race([
            output,
            stopped.promise.then((result) => result.error),
            new Promise<string>((resolve) => {
              drainTimer = setTimeout(
                () => resolve('Shell output did not close after process exit'),
                OUTPUT_DRAIN_TIMEOUT_MS,
              );
            }),
          ]);
          clearTimeout(drainTimer);
          error ??= outputError;
        }

        if (background && this.actions.get()[actionId].status !== 'started' && !action.abortSignal.aborted) {
          error ??= `Background command exited before preview port ${port} became ready`;
        }

        if (outcome.exitCode !== undefined && outcome.exitCode !== 0) {
          error ??= `WebContainer command exited with code ${outcome.exitCode}`;
        }

        if (error && !outcome.stopped) {
          stop(error);
        }

        return this.#finishAction(actionId, {
          status: action.abortSignal.aborted ? 'aborted' : error ? 'failed' : 'complete',
          exitCode: outcome.exitCode,
          error,
        });
      } finally {
        clearTimeout(timer);
        action.abortSignal.removeEventListener('abort', abort);
        removeReady?.();
        releasePort?.();
        outputController.abort();
      }
    })();

    if (!background) {
      return completion;
    }

    return Promise.race([
      completion,
      ready.promise.then(() => {
        const state = this.actions.get()[actionId];

        if (state.status !== 'running' || action.abortSignal.aborted || processExited) {
          return completion;
        }

        clearTimeout(timer);
        removeReady?.();
        removeReady = undefined;
        this.#updateAction(actionId, { status: 'started' });
        this.#emitShellResult(actionId);

        return this.actions.get()[actionId];
      }),
    ]);
  }

  async #awaitSetup<T>(promise: Promise<T>, signal: AbortSignal, timeoutMs: number): Promise<T> {
    const cancelled = withResolvers<never>();
    const abort = () => cancelled.reject(new Error('Action aborted'));
    signal.addEventListener('abort', abort, { once: true });

    const timer = setTimeout(
      () => cancelled.reject(new Error(`Shell startup timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );

    if (signal.aborted) {
      abort();
    }

    try {
      return await Promise.race([promise, cancelled.promise]);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  }

  async #runFileAction(action: ActionState) {
    if (action.type !== 'file') {
      throw new Error('Expected file action');
    }

    /**
     * Filesystem writes require a real workspace-relative file, not parser markup,
     * a traversal, a directory, an absolute path, or an alternate Windows stream.
     */
    const path = action.filePath;

    if (
      typeof path !== 'string' ||
      !path.trim() ||
      path !== path.trim() ||
      /[\x00-\x1f<>:\\]/.test(path) ||
      nodePath.isAbsolute(path) ||
      path.endsWith('/') ||
      path.split('/').some((part) => part === '..' || part === '') ||
      nodePath.normalize(path) === '.'
    ) {
      throw new Error('Refusing to write an invalid workspace-relative file path');
    }

    const webcontainer = await this.#awaitSetup(this.#webcontainer, action.abortSignal, SHELL_EXECUTION_TIMEOUT_MS);
    const folder = nodePath.dirname(action.filePath).replace(/\/+$/g, '');

    if (folder !== '.') {
      await webcontainer.fs.mkdir(folder, { recursive: true });
    }

    if (!action.abortSignal.aborted) {
      await webcontainer.fs.writeFile(action.filePath, action.content);
    }
  }

  #finishAction(actionId: string, update: ActionStateUpdate): ActionState {
    if (!this.#finished.has(actionId)) {
      this.#finished.add(actionId);
      this.#updateAction(actionId, update);
      this.#emitShellResult(actionId);
    }

    return this.actions.get()[actionId];
  }

  #emitShellResult(actionId: string) {
    const action = this.actions.get()[actionId];

    if (action.type !== 'shell') {
      return;
    }

    const result: ShellActionResult = {
      actionId,
      command: action.content,
      status: action.status,
      output: action.output,
      exitCode: action.exitCode,
      error: action.error,
    };
    this.#results[actionId] = result;
    this.#notify(() => this.#options.onShellResult?.({ ...result }));
  }

  #notify(callback: () => void) {
    try {
      callback();
    } catch (error) {
      // display failures must not rewrite the actual process result or poison the queue
      logger.error('Shell observer failed', error);
    }
  }

  #updateAction(id: string, update: ActionStateUpdate) {
    this.actions.setKey(id, { ...this.actions.get()[id], ...update } as ActionState);
  }
}
