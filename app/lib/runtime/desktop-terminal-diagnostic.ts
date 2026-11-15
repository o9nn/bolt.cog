import type { ITerminal } from '~/types/terminal';
import { StreamingMessageParser } from './message-parser';
import { workbenchStore } from '~/lib/stores/workbench';
import { webcontainer, webcontainerContext } from '~/lib/webcontainer';

export const terminalDiagnosticEnabled = () =>
  typeof window !== 'undefined' &&
  window.location.hostname === '127.0.0.1' &&
  new URLSearchParams(window.location.search).get('terminal-smoke') === '1';

const interactive: ITerminal[] = [];
const assistant: ITerminal[] = [];
const observed = new Map<ITerminal, string>();

export function observeDiagnosticTerminal(terminal: ITerminal, readonly: boolean) {
  if (!terminalDiagnosticEnabled()) {
    return () => undefined;
  }

  const list = readonly ? assistant : interactive;
  list.push(terminal);

  const original = terminal.write.bind(terminal);

  terminal.write = (data) => {
    observed.set(terminal, ((observed.get(terminal) || '') + data).slice(-65536));
    original(data);
  };

  return () => {
    const index = list.indexOf(terminal);

    if (index !== -1) {
      list.splice(index, 1);
    }

    observed.delete(terminal);
    terminal.write = original;
  };
}

export function installTerminalDiagnostic() {
  if (!terminalDiagnosticEnabled()) {
    return;
  }

  const parser = new StreamingMessageParser({
    callbacks: {
      onArtifactOpen: (data) => {
        workbenchStore.showWorkbench.set(true);
        workbenchStore.addArtifact(data);
      },
      onActionClose: (data) => {
        workbenchStore.addAction(data);
        void workbenchStore.runAction(data).catch(() => undefined);
      },
      onArtifactClose: (data) => workbenchStore.updateArtifact(data, { closed: true }),
    },
  });
  (window as any).__boltTerminalQA = {
    ready: () => webcontainer.then(() => true),
    snapshot: () => ({
      runtimeLoaded: webcontainerContext.loaded,
      receipts: workbenchStore.terminalReceipts.get(),
      artifacts: Object.fromEntries(
        Object.entries(workbenchStore.artifacts.get()).map(([id, artifact]) => [
          id,
          {
            actions: Object.fromEntries(
              Object.entries(artifact.runner.actions.get()).map(([actionId, action]) => [
                actionId,
                {
                  type: action.type,
                  background: action.type === 'shell' ? action.background : undefined,
                  port: action.type === 'shell' ? action.port : undefined,
                  content: action.content,
                  status: action.status,
                  output: action.output,
                  exitCode: action.exitCode,
                  error: action.error,
                },
              ]),
            ),
            title: artifact.title,
          },
        ]),
      ),
      assistantOutput: assistant.map((terminal) => observed.get(terminal) || '').join(''),
      interactiveOutput: interactive.map((terminal) => observed.get(terminal) || '').join(''),
      interactiveScreen: interactive
        .map((terminal) => {
          const buffer = (terminal as any).buffer.active;
          return Array.from(
            { length: buffer.length },
            (_, index) => buffer.getLine(index)?.translateToString(true) || '',
          )
            .join('\n')
            .slice(-65536);
        })
        .join('\n'),
      interactiveCount: interactive.length,
    }),

    // only labelled integration fixtures use this method; model E2E submits through the actual chat UI
    parseFixture: (id: string, content: string) => parser.parse(id, content),
    wait: () => workbenchStore.waitForActions(),
    abort: () => workbenchStore.abortAllActions(),
    readFile: async (path: string) => (await webcontainer).fs.readFile(path, 'utf8'),
    input: (text: string) => {
      const terminal = interactive[0] as ITerminal & { input?: (data: string, userInput: boolean) => void };

      if (!terminal?.input) {
        throw new Error('Real interactive terminal is not ready');
      }

      terminal.input(text, true);
    },
  };
}
