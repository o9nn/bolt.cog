import { WebContainer } from '@webcontainer/api';
import { WORK_DIR_NAME } from '~/utils/constants';

interface WebContainerContext {
  loaded: boolean;
}

export const webcontainerContext: WebContainerContext = import.meta.hot?.data.webcontainerContext ?? {
  loaded: false,
};

if (import.meta.hot) {
  import.meta.hot.data.webcontainerContext = webcontainerContext;
}

export let webcontainer: Promise<WebContainer> = new Promise(() => {
  // noop for ssr
});

if (!import.meta.env.SSR) {
  webcontainer =
    import.meta.hot?.data.webcontainer ??
    Promise.resolve()
      .then(() => {
        return WebContainer.boot({ workdirName: WORK_DIR_NAME });
      })
      .then((webcontainer) => {
        webcontainerContext.loaded = true;
        return webcontainer;
      });

  if (import.meta.hot) {
    import.meta.hot.data.webcontainer = webcontainer;
  }

  if (
    window.location.hostname === '127.0.0.1' &&
    new URLSearchParams(window.location.search).get('desktop-smoke') === '1'
  ) {
    const diagnostic = webcontainer
      .then(async (container) => {
        try {
          return await (await import('./desktop-diagnostic')).runDesktopWebContainerDiagnostic(container);
        } catch (error) {
          return {
            boot: true,
            stage: 'process-or-preview',
            error: error instanceof Error ? error.message : 'Diagnostic failed',
          };
        }
      })
      .catch((error) => ({
        boot: false,
        stage: 'boot',
        error: error instanceof Error ? error.message : 'WebContainer boot failed',
      }));
    (window as unknown as { __boltDesktopWC: typeof diagnostic }).__boltDesktopWC = diagnostic;
  }
}
