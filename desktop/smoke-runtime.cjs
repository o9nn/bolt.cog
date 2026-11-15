'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const { isTrustedNavigation } = require('./policy.cjs');

module.exports = function runSmoke(window, config, offlinePath) {
  let started = false;
  const fail = (error) => { console.error('ELECTRON_SMOKE_FAILED', error?.message || 'unknown'); app.exit(1); };
  const watchdog = setTimeout(() => fail(new Error('Smoke deadline exceeded')), process.env.BOLT_DESKTOP_SMOKE_TERMINAL === '1' || process.env.BOLT_DESKTOP_SMOKE_DISPLAY === '1' ? 330_000 : 100_000);
  const remoteAppRequests = [];
  const browserErrors = [];
  window.webContents.session.webRequest.onErrorOccurred((details) => {
    const url = new URL(details.url);
    browserErrors.push(`${details.error}: ${url.origin}${url.pathname}`);
  });
  window.webContents.on('console-message', (event) => {
    if (event.level === 'error' || event.level === 'warning') browserErrors.push(String(event.message).slice(0, 500));
  });
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    if (new URL(details.url).hostname === 'bolt-cog.pages.dev') { remoteAppRequests.push(details.url); callback({ cancel: true }); }
    else callback({});
  });
  window.webContents.on('did-finish-load', async () => {
    if (started) return; started = true;
    try {
      const url = window.webContents.getURL();
      assert.ok(isTrustedNavigation(url, config)); assert.equal(new URL(url).hostname, '127.0.0.1');
      const prefs = window.webContents.getLastWebPreferences();
      for (const key of ['sandbox', 'contextIsolation', 'webSecurity']) assert.equal(prefs[key], true);
      for (const key of ['nodeIntegration', 'nodeIntegrationInWorker']) assert.equal(prefs[key], false);
      assert.equal(app.commandLine.hasSwitch('no-sandbox'), false);
      const isolation = await window.webContents.executeJavaScript('({node: typeof process, require: typeof require, crossOriginIsolated: globalThis.crossOriginIsolated})');
      assert.equal(isolation.node, 'undefined'); assert.equal(isolation.require, 'undefined'); assert.equal(isolation.crossOriginIsolated, true);
      const info = await window.webContents.executeJavaScript('fetch("/api/desktop/info").then(r=>r.json())');
      assert.equal(info.runtime, 'desktop');
      await new Promise((resolve) => setTimeout(resolve, 1500));
      assert.match(await window.webContents.executeJavaScript('document.body.innerText'), /Bolt|What can|Local read-only|build/i);
      let webcontainer;
      if (process.env.BOLT_DESKTOP_SMOKE_WEBCONTAINER === '1') {
        webcontainer = await window.webContents.executeJavaScript('Promise.race([window.__boltDesktopWC, new Promise(resolve=>setTimeout(()=>resolve({boot:false,error:"Diagnostic timed out"}),45000))])');
        console.log('WEBCONTAINER_DIAGNOSTIC ' + JSON.stringify(webcontainer));
        console.log('BROWSER_DIAGNOSTICS ' + JSON.stringify(browserErrors));
        assert.equal(webcontainer?.boot, true, webcontainer?.error || 'WebContainer did not boot');
        assert.equal(webcontainer.commandExitCode, 0); assert.equal(webcontainer.previewText, 'BOLT_REAL_PREVIEW');
      }
      let chat;
      let terminal;
      let terminalDisplay;
      if (process.env.BOLT_DESKTOP_SMOKE_DISPLAY === '1') terminalDisplay = await require('./terminal-display-smoke.cjs')(window, process.env.BOLT_DESKTOP_SMOKE_OUTPUT);
      if (process.env.BOLT_DESKTOP_SMOKE_TERMINAL === '1') terminal = await require('./terminal-smoke.cjs')(window, process.env.BOLT_DESKTOP_SMOKE_OUTPUT);
      if (process.env.BOLT_DESKTOP_SMOKE_CHAT === '1') {
        const payload = { messages: [{ role: 'user', content: 'Write a Python function sum_even(numbers) that returns the sum of even integers. Return only the function code, no XML or prose.' }] };
        chat = await window.webContents.executeJavaScript(`fetch('/api/chat', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(payload)})}).then(async r=>({status:r.status,body:await r.text()}))`);
        assert.equal(chat.status, 200); assert.match(chat.body, /^0:/m); assert.doesNotMatch(chat.body, /^3:/m);
      }
      const count = BrowserWindow.getAllWindows().length;
      const denied = await window.webContents.executeJavaScript('window.open("file:///tmp/bolt-desktop-smoke-not-a-real-file") === null');
      assert.equal(denied, true); assert.equal(BrowserWindow.getAllWindows().length, count);
      const outputDir = process.env.BOLT_DESKTOP_SMOKE_OUTPUT;
      if (outputDir) {
        fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(path.join(outputDir, 'desktop-loaded.png'), (await window.webContents.capturePage()).toPNG());
        fs.writeFileSync(path.join(outputDir, 'browser-errors.json'), JSON.stringify(browserErrors, null, 2));
        if (chat) fs.writeFileSync(path.join(outputDir, 'real-local-chat.sse'), chat.body);
      }
      const lastTrustedURL = window.webContents.getURL();
      assert.ok(isTrustedNavigation(lastTrustedURL, config));
      assert.equal(new URL(lastTrustedURL).origin, new URL(url).origin);
      window.webContents.executeJavaScript('window.location.assign("https://untrusted-desktop-test.invalid/")').catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 350)); assert.equal(window.webContents.getURL(), lastTrustedURL);
      await window.loadFile(offlinePath);
      assert.equal(await window.webContents.executeJavaScript('document.title'), 'Bolt Cog — connection unavailable');
      assert.equal(await window.webContents.executeJavaScript('typeof process'), 'undefined');
      if (outputDir) fs.writeFileSync(path.join(outputDir, 'desktop-offline.png'), (await window.webContents.capturePage()).toPNG());
      assert.equal(remoteAppRequests.length, 0);
      clearTimeout(watchdog);
      console.log('ELECTRON_SMOKE_RESULT ' + JSON.stringify({ electron: process.versions.electron, arch: process.arch,
        packaged: app.isPackaged, sandbox: prefs.sandbox, nodeIntegration: prefs.nodeIntegration,
        contextIsolation: prefs.contextIsolation, webSecurity: prefs.webSecurity, localLoaded: true,
        loadedOrigin: new URL(url).origin, crossOriginIsolated: isolation.crossOriginIsolated,
        webcontainer,
        terminal: terminal ? { passed: terminal.passed, cases: terminal.cases.map((test) => test.name) } : undefined,
        terminalDisplay: terminalDisplay ? { passed: terminalDisplay.passed, rawPreserved: terminalDisplay.rawPreserved } : undefined,
        provider: info.provider, providerConfigured: info.providerConfigured, realChatStream: Boolean(chat),
        cloudflareAppRequests: remoteAppRequests.length, blockedFilePopup: denied, blockedUntrustedNavigation: true, offlinePageVerified: true }));
      app.exit(0);
    } catch (error) {
      if (process.env.BOLT_DESKTOP_SMOKE_OUTPUT) {
        fs.mkdirSync(process.env.BOLT_DESKTOP_SMOKE_OUTPUT, { recursive: true });
        fs.writeFileSync(path.join(process.env.BOLT_DESKTOP_SMOKE_OUTPUT, 'browser-errors.json'), JSON.stringify(browserErrors, null, 2));
      }
      clearTimeout(watchdog); fail(error);
    }
  });
};
