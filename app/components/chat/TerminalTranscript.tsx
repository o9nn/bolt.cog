import { memo, useEffect, useRef, useState } from 'react';
import {
  createTranscriptSession,
  TRANSCRIPT_COLS,
  TRANSCRIPT_ROWS,
  TRANSCRIPT_SCROLLBACK,
  type TranscriptSession,
} from '~/components/chat/terminal-transcript';

interface TerminalTranscriptProps {
  output: string;
}

let xtermModule: Promise<typeof import('@xterm/xterm')> | undefined;

/** Display-only terminal snapshot. Never connects to a process or sends input. */
export const TerminalTranscript = memo(({ output }: TerminalTranscriptProps) => {
  const latestOutput = useRef(output);
  const session = useRef<TranscriptSession>();
  const [view, setView] = useState({ text: '', status: 'loading' });

  useEffect(() => {
    latestOutput.current = output;
    session.current?.update(output);
  }, [output]);

  useEffect(() => {
    let disposed = false;
    let ownedSession: TranscriptSession | undefined;

    /**
     * The browser build references browser globals; importing inside an effect
     * keeps server rendering safe. No raw escape bytes are rendered while loading.
     * Share only the module promise, never the terminal/session between views.
     */
    xtermModule ??= import('@xterm/xterm');
    void xtermModule
      .then((xterm) => {
        if (disposed) {
          return;
        }

        ownedSession = createTranscriptSession(
          () =>
            new xterm.Terminal({
              cols: TRANSCRIPT_COLS,
              rows: TRANSCRIPT_ROWS,
              scrollback: TRANSCRIPT_SCROLLBACK,
              convertEol: true,
              disableStdin: true,
              allowProposedApi: false,
            }),
          (text) => {
            if (!disposed) {
              setView({ text, status: 'ready' });
            }
          },
          () => {
            if (!disposed) {
              setView({ text: '', status: 'error' });
            }
          },
        );
        session.current = ownedSession;
        ownedSession.update(latestOutput.current);
      })
      .catch(() => {
        if (!disposed) {
          setView({ text: '', status: 'error' });
        }
      });

    return () => {
      disposed = true;
      ownedSession?.dispose();

      if (session.current === ownedSession) {
        session.current = undefined;
      }
    };
  }, []);

  return (
    <div
      className="whitespace-pre-wrap break-words"
      data-testid="shell-action-transcript"
      data-transcript-state={output ? view.status : 'ready'}
      aria-busy={Boolean(output) && view.status === 'loading'}
    >
      {!output
        ? ''
        : view.status === 'loading'
          ? 'Preparing terminal output…'
          : view.status === 'error'
            ? 'Terminal output unavailable in this view; see Assistant terminal.'
            : view.text}
    </div>
  );
});
