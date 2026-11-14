import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal as XTerm } from '@xterm/xterm';
import { forwardRef, memo, useEffect, useImperativeHandle, useRef } from 'react';
import type { Theme } from '~/lib/stores/theme';
import { observeDiagnosticTerminal } from '~/lib/runtime/desktop-terminal-diagnostic';
import { createScopedLogger } from '~/utils/logger';
import { getTerminalTheme } from './theme';

const logger = createScopedLogger('Terminal');

export interface TerminalRef {
  reloadStyles: () => void;
}

export interface TerminalProps {
  className?: string;
  theme: Theme;
  readonly?: boolean;
  onTerminalReady?: (terminal: XTerm) => void | (() => void) | Promise<void | (() => void)>;
  onTerminalResize?: (cols: number, rows: number, terminal: XTerm) => void;
}

export const Terminal = memo(
  forwardRef<TerminalRef, TerminalProps>(({ className, theme, readonly, onTerminalReady, onTerminalResize }, ref) => {
    const terminalElementRef = useRef<HTMLDivElement>(null);
    const terminalRef = useRef<XTerm>();

    useEffect(() => {
      const element = terminalElementRef.current!;

      const fitAddon = new FitAddon();
      const webLinksAddon = new WebLinksAddon();

      const terminal = new XTerm({
        cursorBlink: true,
        convertEol: true,
        disableStdin: readonly,
        theme: getTerminalTheme(readonly ? { cursor: '#00000000' } : {}),
        fontSize: 12,
        fontFamily: 'Menlo, courier-new, courier, monospace',
      });

      terminalRef.current = terminal;

      const stopObserving = observeDiagnosticTerminal(terminal, Boolean(readonly));

      terminal.loadAddon(fitAddon);
      terminal.loadAddon(webLinksAddon);
      terminal.open(element);

      const resizeObserver = new ResizeObserver(() => {
        if (!element.clientWidth || !element.clientHeight) {
          return;
        }

        fitAddon.fit();
        onTerminalResize?.(terminal.cols, terminal.rows, terminal);
      });

      resizeObserver.observe(element);

      logger.info('Attach terminal');

      let disposed = false;
      let detach: (() => void) | void;
      Promise.resolve(onTerminalReady?.(terminal))
        .then((cleanup) => {
          if (disposed) {
            cleanup?.();
          } else {
            detach = cleanup;
          }
        })
        .catch((error) => {
          if (!disposed) {
            terminal.write(
              `\r\nTerminal attachment failed: ${error instanceof Error ? error.message : 'unknown error'}\r\n`,
            );
          }
        });

      return () => {
        disposed = true;
        detach?.();
        stopObserving();
        resizeObserver.disconnect();
        terminal.dispose();
      };
    }, []);

    useEffect(() => {
      const terminal = terminalRef.current!;

      // we render a transparent cursor in case the terminal is readonly
      terminal.options.theme = getTerminalTheme(readonly ? { cursor: '#00000000' } : {});

      terminal.options.disableStdin = readonly;
    }, [theme, readonly]);

    useImperativeHandle(ref, () => {
      return {
        reloadStyles: () => {
          const terminal = terminalRef.current!;
          terminal.options.theme = getTerminalTheme(readonly ? { cursor: '#00000000' } : {});
        },
      };
    }, []);

    return <div className={className} ref={terminalElementRef} />;
  }),
);
