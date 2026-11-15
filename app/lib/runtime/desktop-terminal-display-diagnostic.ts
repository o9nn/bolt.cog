import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Artifact } from '~/components/chat/Artifact';

export function installTerminalDisplayDiagnostic() {
  if (
    typeof window === 'undefined' ||
    window.location.hostname !== '127.0.0.1' ||
    new URLSearchParams(window.location.search).get('terminal-display-smoke') !== '1'
  ) {
    return;
  }

  let cleanup: (() => void) | undefined;
  (window as any).__boltTerminalDisplayQA = {
    mount: (messageId: string) => {
      cleanup?.();

      const panel = document.createElement('div');
      panel.dataset.testid = 'terminal-display-fixture';
      panel.style.cssText =
        'position:fixed;inset:48px 16px 16px;z-index:10000;overflow:auto;background:#111827;color:#eee;padding:20px;';
      document.body.appendChild(panel);

      const root = createRoot(panel);
      root.render(createElement(Artifact, { messageId }));

      cleanup = () => {
        root.unmount();
        panel.remove();
      };
    },
    dispose: () => {
      cleanup?.();
      cleanup = undefined;
    },
  };
}
