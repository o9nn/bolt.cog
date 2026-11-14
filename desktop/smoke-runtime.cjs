'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const { isTrustedNavigation } = require('./policy.cjs');

module.exports = function runSmoke(window, config, offlinePath) {
  let started = false;
  const fail = () => { console.error('ELECTRON_SMOKE_FAILED'); app.exit(1); };
  const watchdog = setTimeout(fail, 35_000);
  const forceOffline = setTimeout(() => {
    if (!started && !window.isDestroyed()) window.loadFile(offlinePath).catch(fail);
  }, 12_000);
  window.webContents.on('did-finish-load', async () => {
    if (started) return;
    started = true;
    clearTimeout(forceOffline);
    try {
      const url = window.webContents.getURL();
      const liveLoaded = isTrustedNavigation(url, config);
      assert.ok(liveLoaded || url.startsWith('file:'));
      const prefs = window.webContents.getLastWebPreferences();
      assert.equal(prefs.sandbox, true);
      assert.equal(prefs.contextIsolation, true);
      assert.equal(prefs.nodeIntegration, false);
      assert.equal(prefs.nodeIntegrationInWorker, false);
      assert.equal(prefs.webSecurity, true);
      assert.equal(app.commandLine.hasSwitch('no-sandbox'), false);
      const isolation = await window.webContents.executeJavaScript('({node: typeof process, require: typeof require, crossOriginIsolated: globalThis.crossOriginIsolated})');
      assert.equal(isolation.node, 'undefined');
      assert.equal(isolation.require, 'undefined');
      const count = BrowserWindow.getAllWindows().length;
      const denied = await window.webContents.executeJavaScript('window.open("file:///tmp/bolt-desktop-smoke-not-a-real-file") === null');
      assert.equal(denied, true);
      assert.equal(BrowserWindow.getAllWindows().length, count);
      const outputDir = process.env.BOLT_DESKTOP_SMOKE_OUTPUT;
      if (outputDir) {
        fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(path.join(outputDir, 'desktop-loaded.png'), (await window.webContents.capturePage()).toPNG());
      }
      window.webContents.executeJavaScript('window.location.assign("https://untrusted-desktop-test.invalid/")').catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 350));
      assert.equal(window.webContents.getURL(), url);
      await window.loadFile(offlinePath);
      assert.equal(await window.webContents.executeJavaScript('document.title'), 'Bolt Cog — connection unavailable');
      assert.equal(await window.webContents.executeJavaScript('typeof process'), 'undefined');
      if (outputDir) fs.writeFileSync(path.join(outputDir, 'desktop-offline.png'), (await window.webContents.capturePage()).toPNG());
      clearTimeout(watchdog);
      console.log('ELECTRON_SMOKE_RESULT ' + JSON.stringify({
        electron: process.versions.electron, arch: process.arch, packaged: app.isPackaged,
        sandbox: prefs.sandbox, nodeIntegration: prefs.nodeIntegration,
        contextIsolation: prefs.contextIsolation, webSecurity: prefs.webSecurity,
        liveLoaded, loadedOrigin: liveLoaded ? new URL(url).origin : 'offline',
        crossOriginIsolated: isolation.crossOriginIsolated,
        blockedFilePopup: denied, blockedUntrustedNavigation: true, offlinePageVerified: true
      }));
      app.exit(0);
    } catch { clearTimeout(watchdog); fail(); }
  });
};
