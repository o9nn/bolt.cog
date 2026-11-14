import type { WebContainer } from '@webcontainer/api';
import { atom, type WritableAtom } from 'nanostores';
import type { ITerminal } from '~/types/terminal';
import { newShellProcess, type ShellProcess } from '~/utils/shell';
import { coloredText } from '~/utils/terminal';

export const ASSISTANT_OUTPUT_LIMIT = 64 * 1024;
export const TERMINAL_RUNTIME_TIMEOUT_MS = 90_000;
export type TerminalCleanup = () => Promise<void>;

interface TerminalAttachment {
  controller: AbortController;
  process?: ShellProcess;
  disposed: boolean;
  cleanup: TerminalCleanup;
}

export class TerminalStore {
  #webcontainer: Promise<WebContainer>;
  #terminals = new Map<ITerminal, TerminalAttachment>();
  #assistantTerminals = new Set<ITerminal>();
  #assistantOutput = '';
  #disposed = false;

  showTerminal: WritableAtom<boolean> = import.meta.hot?.data.showTerminal ?? atom(false);

  constructor(webcontainerPromise: Promise<WebContainer>) {
    this.#webcontainer = webcontainerPromise;

    if (import.meta.hot) {
      import.meta.hot.data.showTerminal = this.showTerminal;
    }
  }

  toggleTerminal(value?: boolean) {
    this.showTerminal.set(value !== undefined ? value : !this.showTerminal.get());
  }

  /**
   * Resolves with an idempotent cleanup once the interactive shell is ready.
   * On unmount, call that cleanup even if this promise resolves after unmount.
   * detachTerminal/dispose can also cancel an attachment BEFORE it resolves.
   * Startup failures are displayed and rejected, never presented as a ready shell.
   */
  async attachTerminal(terminal: ITerminal): Promise<TerminalCleanup> {
    if (this.#disposed) {
      throw new Error('Terminal store is disposed');
    }

    const previous = this.#terminals.get(terminal);
    const controller = new AbortController();
    const attachment: TerminalAttachment = {
      controller,
      disposed: false,
      cleanup: async () => {
        if (attachment.disposed) {
          return;
        }

        attachment.disposed = true;
        controller.abort();

        if (this.#terminals.get(terminal) === attachment) {
          this.#terminals.delete(terminal);
        }

        await attachment.process?.dispose();
      },
    };
    this.#terminals.set(terminal, attachment);

    try {
      await previous?.cleanup();

      if (attachment.disposed || this.#disposed) {
        throw new Error('Terminal attachment aborted');
      }

      const container = await this.#awaitContainer(controller.signal);
      const process = await newShellProcess(container, terminal, { signal: controller.signal });
      attachment.process = process;

      if (attachment.disposed) {
        await process.dispose();
      }

      /**
       * Observe errors after startup as well as startup failures. Never write to
       * an unmounted terminal or let a rejection from background IO go unnoticed.
       */
      void process.done
        .then(
          () => {
            if (this.#terminals.get(terminal) === attachment) {
              this.#terminals.delete(terminal);
            }
          },
          (error) => {
            try {
              if (!attachment.disposed) {
                terminal.write(coloredText.red('\r\nShell failed: ') + String(error) + '\r\n');
              }
            } finally {
              if (this.#terminals.get(terminal) === attachment) {
                this.#terminals.delete(terminal);
              }
            }
          },
        )
        .catch((error) => console.error('Terminal failure display failed', error));

      return attachment.cleanup;
    } catch (error) {
      if (!attachment.disposed) {
        try {
          terminal.write(
            coloredText.red('Failed to spawn shell\r\n\r\n') + (error instanceof Error ? error.message : String(error)),
          );
        } finally {
          await attachment.cleanup();
        }
      }

      throw error;
    }
  }

  /** Resizes only the shell belonging to the originating terminal. */
  onTerminalResize(cols: number, rows: number, terminal?: ITerminal) {
    if (cols <= 0 || rows <= 0 || !Number.isInteger(cols) || !Number.isInteger(rows)) {
      return;
    }

    const attachment = terminal
      ? this.#terminals.get(terminal)
      : this.#terminals.size === 1
        ? this.#terminals.values().next().value
        : undefined;

    if (attachment && !attachment.disposed) {
      attachment.process?.resize({ cols, rows });
    }
  }

  async detachTerminal(terminal: ITerminal): Promise<void> {
    await this.#terminals.get(terminal)?.cleanup();
  }

  /** Output-only attachment: no process, onData subscription, or input writer. */
  attachAssistantTerminal(terminal: ITerminal): () => void {
    if (this.#disposed) {
      throw new Error('Terminal store is disposed');
    }

    this.#assistantTerminals.add(terminal);

    try {
      if (this.#assistantOutput) {
        terminal.write(this.#assistantOutput);
      }
    } catch (error) {
      this.#assistantTerminals.delete(terminal);
      throw error;
    }

    return () => {
      this.#assistantTerminals.delete(terminal);
    };
  }

  /** Buffers a bounded tail even when no assistant xterm has mounted yet. */
  writeAssistantOutput(data: string) {
    this.#assistantOutput = (this.#assistantOutput + data).slice(-ASSISTANT_OUTPUT_LIMIT);

    for (const terminal of this.#assistantTerminals) {
      try {
        terminal.write(data);
      } catch (error) {
        // one detached/broken view must not prevent other views or future replay
        this.#assistantTerminals.delete(terminal);
        console.error('Assistant terminal output failed', error);
      }
    }
  }

  /** Cancels pending attachments and disposes all OWNED shells, not action-runner servers. */
  async dispose(): Promise<void> {
    this.#disposed = true;
    this.#assistantTerminals.clear();
    await Promise.all(Array.from(this.#terminals.values(), (attachment) => attachment.cleanup()));
  }

  async #awaitContainer(signal: AbortSignal): Promise<WebContainer> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: () => void = () => undefined;
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(new Error('Terminal attachment aborted'));
      signal.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => reject(new Error('Terminal runtime startup timed out')), TERMINAL_RUNTIME_TIMEOUT_MS);

      if (signal.aborted) {
        abort();
      }
    });

    try {
      return await Promise.race([this.#webcontainer, cancelled]);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  }
}
