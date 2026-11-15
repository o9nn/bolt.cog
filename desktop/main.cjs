'use strict';
const { app, BrowserWindow, Menu, dialog, session, shell, utilityProcess, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { fileURLToPath } = require('node:url');
const { PARTITION, localConfig, isTrustedNavigation, isAppURL, isSafeDownload, rendererPreferences, safeFilename } = require('./policy.cjs');
const { createPreferences } = require('./preferences.cjs');
const { openSettings } = require('./settings.cjs');

app.enableSandbox();
const smokeMode = app.commandLine.hasSwitch('desktop-smoke');
if (smokeMode && process.env.BOLT_DESKTOP_SMOKE_PROFILE) app.setPath('userData', process.env.BOLT_DESKTOP_SMOKE_PROFILE);
const offlinePath = path.join(__dirname, 'offline.html');
let mainWindow, backend, config, preferences;
let quitting = false, restarting = false;
let localToken = '';
const payload = app.isPackaged ? path.join(process.resourcesPath, 'runtime') : path.join(__dirname, 'runtime');

function isOfflineURL(value) {
  try { return value.startsWith('file:') && fileURLToPath(value) === offlinePath; } catch { return false; }
}
function guardContents(contents) {
  const allow = (event, value) => { if (!config || (!isTrustedNavigation(value, config) && !isOfflineURL(value))) event.preventDefault(); };
  contents.on('will-navigate', allow); contents.on('will-redirect', allow);
  contents.on('will-frame-navigate', (event) => {
    try {
      const url = new URL(event.url);
      // Preview frames retain the existing browser-sandboxed WebContainer origins, never Node.
      if (event.isMainFrame && !isTrustedNavigation(event.url, config) && !isOfflineURL(event.url)) event.preventDefault();
      else if (!['https:', 'http:', 'blob:', 'about:', 'file:'].includes(url.protocol)) event.preventDefault();
      else if (url.protocol === 'file:' && !isOfflineURL(event.url)) event.preventDefault();
      else if (url.protocol === 'http:' && !isAppURL(event.url, config)) event.preventDefault();
    } catch { event.preventDefault(); }
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
}
function selectedPort() {
  try { const value = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'local-port.json'), 'utf8')); return Number.isInteger(value.port) && value.port > 1024 && value.port < 65536 ? value.port : 0; } catch { return 0; }
}
async function startBackend() {
  if (!fs.existsSync(path.join(payload, 'backend.cjs'))) throw new Error('Build the local desktop runtime first');
  localToken = randomBytes(32).toString('hex');
  const providerEnv = preferences.providerEnv(process.env);
  // No GitHub/Cloudflare/other-service tokens are inherited into the backend.
  const baseEnv = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LANG'].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
  backend = utilityProcess.fork(path.join(payload, 'backend.cjs'), [], {
    cwd: app.getPath('userData'), stdio: 'ignore', serviceName: 'Bolt local application backend',
    env: { ...baseEnv, ...providerEnv, NODE_ENV: 'production', BOLT_DESKTOP_UTILITY: '1', BOLT_LOCAL_TOKEN: localToken,
      BOLT_ASSETS_DIR: path.join(payload, 'client'), BOLT_WORKSPACE: path.join(app.getPath('userData'), 'workspace'),
      BOLT_AUDIT_FILE: path.join(app.getPath('userData'), 'audit', 'native-inspections.jsonl'), BOLT_LOCAL_PORT: String(selectedPort()) },
  });
  const child = backend;
  config = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Local backend startup timed out')); }, 20_000);
    child.once('message', (message) => {
      clearTimeout(timeout);
      if (message?.type !== 'ready') return reject(new Error('Local backend startup failed'));
      try { resolve(localConfig(message.origin)); } catch (error) { reject(error); }
    });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error('Local backend exited')); });
  });
  fs.mkdirSync(app.getPath('userData'), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(app.getPath('userData'), 'local-port.json'), JSON.stringify({ port: Number(new URL(config.appOrigin).port) }) + '\n', { mode: 0o600 });
  child.on('exit', () => {
    if (!quitting && !restarting && mainWindow && !mainWindow.isDestroyed()) mainWindow.loadFile(offlinePath).catch(() => {});
  });
}
async function stopBackend() {
  const child = backend; backend = undefined;
  if (!child?.pid) return;
  await new Promise((resolve) => {
    const timeout = setTimeout(() => { child.kill(); resolve(); }, 3000);
    child.once('exit', () => { clearTimeout(timeout); resolve(); });
    child.postMessage({ type: 'shutdown' });
  });
}
async function restartApplication() {
  if (restarting) throw new Error('A local backend restart is already in progress');
  restarting = true;
  try {
    await stopBackend(); await startBackend();
    buildMenu(); await loadApplication();
  } catch {
    await mainWindow?.loadFile(offlinePath).catch(() => {});
    await dialog.showMessageBox(mainWindow, { type: 'error', message: 'The local backend could not restart.', detail: 'Check provider settings and ensure the saved loopback port is available. No cloud fallback was used.' });
    throw new Error('Local backend restart failed');
  } finally { restarting = false; }
}
async function loadApplication() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const smokeQuery = new URLSearchParams();
  if (smokeMode && process.env.BOLT_DESKTOP_SMOKE_WEBCONTAINER === '1') smokeQuery.set('desktop-smoke', '1');
  if (smokeMode && process.env.BOLT_DESKTOP_SMOKE_TERMINAL === '1') smokeQuery.set('terminal-smoke', '1');
  try { await mainWindow.loadURL(config.appUrl + (smokeQuery.size ? '?' + smokeQuery.toString() : '')); }
  catch { if (!quitting && !mainWindow.isDestroyed()) await mainWindow.loadFile(offlinePath).catch(() => {}); }
}
function settings() { return openSettings({ parent: mainWindow, preferences, onSaved: restartApplication }); }
let probing = false;
async function testProvider() {
  if (probing) return;
  const approval = await dialog.showMessageBox(mainWindow, { type: 'question', buttons: ['Cancel', 'Run test'], defaultId: 0, cancelId: 0,
    message: 'Test the selected inference provider?', detail: 'This sends one real short prompt using your saved provider, key and model. It may consume a small amount of API credit. No key, prompt or generated response is written to the diagnostic log.' });
  if (approval.response !== 1) return;
  probing = true;
  try {
    const { probeProvider } = require(path.join(payload, 'probe.cjs'));
    const result = await probeProvider(preferences.providerEnv(process.env), path.join(app.getPath('userData'), 'audit', 'chat-diagnostics.jsonl'));
    await dialog.showMessageBox(mainWindow, { type: result.ok ? 'info' : 'error', message: result.ok ? 'Provider test passed' : 'Provider test failed', detail: result.message });
  } catch {
    await dialog.showMessageBox(mainWindow, { type: 'error', message: 'Provider test could not run', detail: 'Check saved provider configuration and the installed diagnostic runtime. No successful inference was claimed.' });
  } finally { probing = false; }
}
function buildMenu() {
  const template = [];
  if (process.platform === 'darwin') template.push({ role: 'appMenu' });
  template.push(
    { label: 'File', submenu: [
      { label: 'Inference settings…', accelerator: 'CmdOrCtrl+,', click: settings },
      { label: 'Test provider connection…', click: () => testProvider().catch(() => {}) },
      { label: 'Open diagnostics folder', click: () => {
        const directory = path.join(app.getPath('userData'), 'audit');
        try { fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); void shell.openPath(directory); } catch { /* No arbitrary client-selected path. */ }
      } },
      { label: 'Restart local backend', accelerator: 'CmdOrCtrl+Shift+R', click: () => restartApplication().catch(() => {}) },
      { label: 'Open official releases', click: () => shell.openExternal('https://github.com/o9nn/bolt.cog/releases').catch(() => {}) },
      { type: 'separator' },
      { label: 'Clear local browser workspace data…', click: async () => {
        const answer = await dialog.showMessageBox(mainWindow, { type: 'warning', buttons: ['Cancel', 'Clear browser data'], defaultId: 0, cancelId: 0,
          message: 'Clear this desktop client’s browser data?', detail: 'Export unsaved work first. This removes IndexedDB chats/workspace and caches; provider preferences and native audit files remain.' });
        if (answer.response !== 1) return;
        const clientSession = session.fromPartition(PARTITION); await clientSession.clearStorageData(); await clientSession.clearCache(); await loadApplication();
      } }, { type: 'separator' }, { role: process.platform === 'darwin' ? 'close' : 'quit' }
    ] }, { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
    { label: 'Help', submenu: [{ label: 'About Bolt Cog Desktop', click: () => dialog.showMessageBox(mainWindow, { type: 'info',
      message: `Bolt Cog Desktop ${app.getVersion()}`, detail: 'Bundled local UI, chat server and Agent-Zero adapter. Configure a real local inference endpoint or optional direct Anthropic provider. Browser WebContainer remains sandboxed; no host sudo. Model weights are not bundled.' }) }] }
  );
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
function createWindow() {
  mainWindow = new BrowserWindow({ title: 'Bolt Cog Desktop — Local', width: 1440, height: 960, minWidth: 900, minHeight: 600,
    backgroundColor: '#111827', icon: path.join(__dirname, 'assets/icon.png'), webPreferences: rendererPreferences() });
  guardContents(mainWindow.webContents);
  if (smokeMode) require('./smoke-runtime.cjs')(mainWindow, config, offlinePath);
  mainWindow.webContents.on('did-fail-load', (_event, code, _description, url, isMainFrame) => {
    if (isMainFrame && code !== -3 && !isOfflineURL(url) && !quitting) mainWindow.loadFile(offlinePath).catch(() => {});
  });
  mainWindow.on('closed', () => { mainWindow = undefined; });
  void loadApplication();
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
  app.on('before-quit', () => { quitting = true; if (backend?.pid) backend.kill(); });
  app.whenReady().then(async () => {
    preferences = createPreferences({ userData: app.getPath('userData'), safeStorage });
    const clientSession = session.fromPartition(PARTITION);
    clientSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    clientSession.setPermissionCheckHandler(() => false);
    clientSession.webRequest.onBeforeSendHeaders((details, callback) => {
      // Secrets stay in main/utility processes. Attach only to the exact current local origin.
      if (config && isAppURL(details.url, config)) details.requestHeaders['X-Bolt-Desktop-Token'] = localToken;
      else for (const key of Object.keys(details.requestHeaders)) if (key.toLowerCase() === 'x-bolt-desktop-token') delete details.requestHeaders[key];
      callback({ requestHeaders: details.requestHeaders });
    });
    clientSession.on('will-download', (event, item, contents) => {
      if (!config || !contents || !isAppURL(contents.getURL(), config) || !isSafeDownload(item.getURL(), config)) { event.preventDefault(); return; }
      item.setSaveDialogOptions({ title: 'Save Bolt export', defaultPath: safeFilename(item.getFilename()) });
    });
    await startBackend(); buildMenu(); createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  }).catch(async () => { await dialog.showMessageBox({ type: 'error', message: 'Bolt local backend failed to start.', detail: 'The bundled runtime must be present, and the saved loopback port must be free. No hosted fallback is used.' }); app.exit(1); });
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
