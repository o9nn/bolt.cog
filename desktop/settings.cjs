'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { createPreferences, PreferencesError } = require('./preferences.cjs');

const SETTINGS_URL = pathToFileURL(path.join(__dirname, 'settings.html')).href;
const SCRIPT_URL = pathToFileURL(path.join(__dirname, 'settings.js')).href;
const READ_CHANNEL = 'bolt-cog:settings:read';
const SAVE_CHANNEL = 'bolt-cog:settings:save';
const registries = new WeakMap();
let electronPreferences;

// Main-process API, AFTER app.whenReady():
// createSettings({app, BrowserWindow, ipcMain, safeStorage, dialog},
//   {parent, onSaved, preferences?}) -> {window, preferences}.
// Pass main's existing preferences instance to share session-only keys.
// onSaved(preferences) runs after disk commit, allowing a local-backend restart.
// Without a supplied instance, the returned preferences is the authoritative store.
// openSettings({parent, preferences, onSaved}) imports Electron for convenience.
// Legacy positional openSettings(parent, onSaved) is also accepted.
// Only settings.html gets this preload; NEVER attach it to the remote app.
// Security: https://www.electronjs.org/docs/latest/tutorial/security
function registryFor(ipcMain) {
  let registry = registries.get(ipcMain);
  if (registry) return registry;
  registry = new Map();
  function owner(event) {
    const entry = event && registry.get(event.sender);
    if (!entry || entry.window.isDestroyed() || event.sender.isDestroyed() ||
        !event.senderFrame || event.senderFrame !== event.sender.mainFrame ||
        event.senderFrame.url !== SETTINGS_URL || event.sender.getURL() !== SETTINGS_URL) {
      throw new Error('Settings IPC denied.');
    }
    return entry;
  }
  ipcMain.handle(READ_CHANNEL, (event, ...args) => {
    const entry = owner(event);
    if (args.length) throw new Error('Settings IPC denied.');
    try { return { ok: true, values: entry.preferences.publicValues() }; }
    catch { return { ok: false, code: 'READ_FAILED', message: 'Local settings could not be read safely.' }; }
  });
  ipcMain.handle(SAVE_CHANNEL, async (event, ...args) => {
    const entry = owner(event);
    if (args.length !== 1 || entry.saving) return { ok: false, message: 'A single settings save is required; wait for any current save.' };
    entry.saving = true;
    try {
      const values = entry.preferences.save(args[0]);
      let backendRestarted = null;
      if (entry.onSaved) {
        try { await entry.onSaved(entry.preferences); backendRestarted = true; }
        catch { backendRestarted = false; }
      }
      return {
        ok: true, saved: true, values, backendRestarted,
        message: backendRestarted === false
          ? 'Settings saved, but backend restart failed. Retry restart before using the new configuration. No inference was tested.'
          : 'Settings saved. No connection or inference was tested.'
      };
    } catch (error) {
      return error instanceof PreferencesError
        ? { ok: false, code: error.code, message: error.message }
        : { ok: false, code: 'SAVE_FAILED', message: 'Settings could not be saved.' };
    } finally { entry.saving = false; }
  });
  registries.set(ipcMain, registry);
  return registry;
}

function createSettings({ app, BrowserWindow, ipcMain, safeStorage, dialog }, { parent, onSaved, preferences } = {}) {
  if (typeof onSaved !== 'undefined' && typeof onSaved !== 'function') throw new TypeError('onSaved must be a function.');
  preferences = preferences || createPreferences({ userData: app.getPath('userData'), safeStorage });
  const registry = registryFor(ipcMain);
  const window = new BrowserWindow({
    parent: parent || undefined,
    title: 'Bolt Cog · Local provider settings', width: 680, height: 800,
    minWidth: 520, minHeight: 620, show: false, autoHideMenuBar: true,
    backgroundColor: '#101827',
    webPreferences: {
      preload: path.join(__dirname, 'settings-preload.cjs'),
      partition: `bolt-cog-settings-${randomUUID()}`,
      sandbox: true, contextIsolation: true, nodeIntegration: false,
      nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
      webSecurity: true, allowRunningInsecureContent: false,
      webviewTag: false, navigateOnDragDrop: false, devTools: false
    }
  });
  const contents = window.webContents;
  registry.set(contents, { window, preferences, onSaved, saving: false });
  // Denials are installed on THIS isolated session, not on default/remote sessions.
  const settingsSession = contents.session;
  settingsSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  settingsSession.setPermissionCheckHandler(() => false);
  if (settingsSession.setDevicePermissionHandler) settingsSession.setDevicePermissionHandler(() => false);
  settingsSession.on('will-download', (event) => event.preventDefault());
  settingsSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: ![SETTINGS_URL, SCRIPT_URL].includes(details.url) });
  });
  const denyNavigation = (event) => event.preventDefault();
  contents.on('will-navigate', denyNavigation);
  contents.on('will-redirect', denyNavigation);
  contents.on('will-frame-navigate', denyNavigation);
  contents.on('will-attach-webview', denyNavigation);
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.on('closed', () => {
    registry.delete(contents);
    if (registry.size === 0) {
      ipcMain.removeHandler(READ_CHANNEL);
      ipcMain.removeHandler(SAVE_CHANNEL);
      registries.delete(ipcMain);
    }
  });
  window.once('ready-to-show', () => { if (!window.isDestroyed()) window.show(); });
  void window.loadURL(SETTINGS_URL).catch(() => {
    if (dialog && dialog.showErrorBox) dialog.showErrorBox('Settings unavailable', 'The trusted local settings page could not be loaded.');
    if (!window.isDestroyed()) window.close();
  });
  return { window, preferences };
}

function openSettings(options = {}, onSaved) {
  const electron = require('electron');
  if (options && typeof options === 'object' &&
      (Object.hasOwn(options, 'parent') || Object.hasOwn(options, 'preferences') || Object.hasOwn(options, 'onSaved') || Object.keys(options).length === 0)) {
    if (options.preferences) return createSettings(electron, options);
    if (!electronPreferences) electronPreferences = createPreferences({ userData: electron.app.getPath('userData'), safeStorage: electron.safeStorage });
    return createSettings(electron, { ...options, preferences: electronPreferences });
  }
  if (!electronPreferences) electronPreferences = createPreferences({ userData: electron.app.getPath('userData'), safeStorage: electron.safeStorage });
  return createSettings(electron, { parent: options, onSaved, preferences: electronPreferences });
}

module.exports = { createSettings, openSettings, SETTINGS_URL };
