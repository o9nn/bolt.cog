'use strict';

const { app, BrowserWindow, Menu, dialog, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { PARTITION, parseConfig, isTrustedNavigation, isAppURL, isSafeDownload, rendererPreferences, safeFilename } = require('./policy.cjs');

// Remote renderers receive no preload script, IPC endpoint, Node API, or runner secret.
app.enableSandbox();
const smokeMode = app.commandLine.hasSwitch('desktop-smoke');
if (smokeMode && process.env.BOLT_DESKTOP_SMOKE_PROFILE) app.setPath('userData', process.env.BOLT_DESKTOP_SMOKE_PROFILE);
const config = parseConfig(JSON.parse(fs.readFileSync(path.join(__dirname, 'app.config.json'), 'utf8')));
const offlinePath = path.join(__dirname, 'offline.html');
let mainWindow;
let quitting = false;

function isOfflineURL(value) {
  try { return value.startsWith('file:') && fileURLToPath(value) === offlinePath; } catch { return false; }
}

function guardContents(contents) {
  const allowNavigation = (event, value) => {
    if (!isTrustedNavigation(value, config) && !isOfflineURL(value)) event.preventDefault();
  };
  contents.on('will-navigate', allowNavigation);
  contents.on('will-redirect', allowNavigation);
  contents.on('will-frame-navigate', (event) => {
    try {
      if (!['https:', 'blob:', 'about:'].includes(new URL(event.url).protocol)) event.preventDefault();
    } catch { event.preventDefault(); }
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    if (!isTrustedNavigation(url, config)) return { action: 'deny' };
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 900, height: 700, autoHideMenuBar: true,
        webPreferences: rendererPreferences()
      }
    };
  });
  contents.on('did-create-window', (popup) => guardContents(popup.webContents));
}

async function loadApplication() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    await mainWindow.loadURL(config.appUrl);
  } catch {
    if (!quitting && mainWindow && !mainWindow.isDestroyed()) await mainWindow.loadFile(offlinePath).catch(() => {});
  }
}

function buildMenu() {
  const template = [];
  if (process.platform === 'darwin') template.push({ role: 'appMenu' });
  template.push(
    { label: 'File', submenu: [
      { label: 'Reconnect to Bolt Cog', accelerator: 'CmdOrCtrl+Shift+R', click: loadApplication },
      { label: 'Open deployment in browser', click: () => shell.openExternal(config.appUrl).catch(() => {}) },
      { type: 'separator' },
      { label: 'Clear local sign-in and workspace data…', click: async () => {
        const answer = await dialog.showMessageBox(mainWindow, {
          type: 'warning', buttons: ['Cancel', 'Clear local data'], defaultId: 0, cancelId: 0,
          message: 'Clear this desktop client’s local data?',
          detail: 'This removes saved sign-in, browser workspace storage and caches for this client only. Export unsaved work first.'
        });
        if (answer.response !== 1) return;
        const clientSession = session.fromPartition(PARTITION);
        await clientSession.clearStorageData();
        await clientSession.clearCache();
        await loadApplication();
      } },
      { type: 'separator' },
      { role: process.platform === 'darwin' ? 'close' : 'quit' }
    ] },
    { role: 'editMenu' },
    { label: 'View', submenu: [ { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' } ] },
    { role: 'windowMenu' },
    { label: 'Help', submenu: [{ label: 'About Bolt Cog Desktop', click: () => dialog.showMessageBox(mainWindow, {
      type: 'info', message: `Bolt Cog Desktop ${app.getVersion()}`,
      detail: 'Online desktop client for bolt-cog.pages.dev. Cloudflare, Access, model inference and WebContainer stay on their existing paths. No host sudo or local execution bridge.'
    }) }] }
  );
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'Bolt Cog Desktop', width: 1440, height: 960, minWidth: 900, minHeight: 600,
    backgroundColor: '#111827', icon: path.join(__dirname, 'assets/icon.png'),
    webPreferences: rendererPreferences()
  });
  guardContents(mainWindow.webContents);
  if (smokeMode) require('./smoke-runtime.cjs')(mainWindow, config, offlinePath);
  mainWindow.webContents.on('did-fail-load', (_event, code, _description, url, isMainFrame) => {
    if (isMainFrame && code !== -3 && !isOfflineURL(url) && !quitting) mainWindow.loadFile(offlinePath).catch(() => {});
  });
  mainWindow.webContents.on('render-process-gone', () => {
    if (!quitting && !mainWindow.isDestroyed()) mainWindow.loadFile(offlinePath).catch(() => {});
  });
  mainWindow.on('closed', () => { mainWindow = undefined; });
  void loadApplication();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); }
  });
  app.on('before-quit', () => { quitting = true; });
  app.whenReady().then(() => {
    const clientSession = session.fromPartition(PARTITION);
    // No certificate bypass and no permission-dependent native bridge.
    clientSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    clientSession.setPermissionCheckHandler(() => false);
    clientSession.on('will-download', (event, item, contents) => {
      if (!contents || !isAppURL(contents.getURL(), config) || !isSafeDownload(item.getURL(), config)) {
        event.preventDefault(); return;
      }
      item.setSaveDialogOptions({ title: 'Save Bolt export', defaultPath: safeFilename(item.getFilename()) });
    });
    buildMenu();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  }).catch(() => app.exit(1));
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
