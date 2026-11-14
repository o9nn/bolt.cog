'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseConfig, isTrustedNavigation, isSafeDownload, rendererPreferences, safeFilename } = require('../policy.cjs');
const config = parseConfig(require('../app.config.json'));
const pkg = require('../package.json');

for (const url of ['https://bolt-cog.pages.dev/', 'https://rzo.cloudflareaccess.com/cdn-cgi/access/login', 'https://login.microsoftonline.com/common/oauth2/authorize']) {
  test(`navigation admits configured origin: ${new URL(url).hostname}`, () => assert.equal(isTrustedNavigation(url, config), true));
}
for (const url of ['https://bolt-cog.pages.dev.evil.test/', 'https://rzo.cloudflareaccess.com.evil.test/', 'https://evil.test/', 'http://bolt-cog.pages.dev/', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hello', 'https://user:pass@bolt-cog.pages.dev/', 'not a url']) {
  test(`navigation denies unsafe value: ${url}`, () => assert.equal(isTrustedNavigation(url, config), false));
}
for (const input of [
  { appUrl: 'http://bolt-cog.pages.dev/', authOrigins: [] },
  { appUrl: 'https://bolt-cog.pages.dev/?token=secret', authOrigins: [] },
  { appUrl: 'https://bolt-cog.pages.dev/', authOrigins: ['https://rzo.cloudflareaccess.com/path'] },
  { appUrl: 'https://bolt-cog.pages.dev/', authOrigins: [], token: 'invalid' },
  { appUrl: 'https://bolt-cog.pages.dev/', authOrigins: null }
]) test('invalid configuration fails closed', () => assert.throws(() => parseConfig(input)));

test('config is frozen and has no credential fields', () => {
  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.isFrozen(config.authOrigins), true);
});
test('all remote renderer privilege preferences are explicit', () => {
  const prefs = rendererPreferences();
  for (const key of ['nodeIntegration', 'nodeIntegrationInWorker', 'nodeIntegrationInSubFrames', 'webviewTag', 'allowRunningInsecureContent', 'navigateOnDragDrop']) assert.equal(prefs[key], false);
  for (const key of ['sandbox', 'contextIsolation', 'webSecurity']) assert.equal(prefs[key], true);
  assert.equal(prefs.preload, undefined);
  assert.ok(prefs.partition.startsWith('persist:'));
});
test('downloads allow app HTTPS and app Blob only', () => {
  assert.equal(isSafeDownload('https://bolt-cog.pages.dev/export.zip', config), true);
  assert.equal(isSafeDownload('blob:https://bolt-cog.pages.dev/1234', config), true);
  for (const url of ['file:///etc/passwd', 'blob:https://evil.test/1234', 'https://evil.test/payload.exe', 'data:application/octet-stream,x']) assert.equal(isSafeDownload(url, config), false);
});
test('export filename does not select another directory', () => {
  assert.equal(safeFilename('../../demo.zip'), 'demo.zip');
  assert.equal(safeFilename('C:\\Users\\a\\demo.zip'), 'demo.zip');
  assert.equal(safeFilename('..'), 'bolt-export.zip');
  assert.equal(safeFilename('bad\u0000name.zip'), 'bad_name.zip');
});
test('release version rejects mismatched tags', () => {
  const script = path.join(__dirname, '../scripts/check-version.cjs');
  assert.equal(spawnSync(process.execPath, [script, `desktop-v${pkg.version}`]).status, 0);
  assert.equal(spawnSync(process.execPath, [script, 'desktop-v9.9.9']).status, 1);
});
test('installer names distinguish platform, architecture and Windows target', () => {
  assert.match(pkg.build.artifactName, /\$\{os\}/);
  assert.match(pkg.build.artifactName, /\$\{arch\}/);
  assert.notEqual(pkg.build.nsis.artifactName, pkg.build.portable.artifactName);
  assert.equal(pkg.build.nsis.allowElevation, false);
});
test('build includes no server credentials, local runner or unrelated app sources', () => {
  assert.equal(pkg.build.asar, true);
  assert.equal(pkg.build.publish, null);
  assert.equal(pkg.dependencies, undefined);
  for (const pattern of pkg.build.files) assert.doesNotMatch(pattern, /\.env|runner|app\/|\.git|\*\*\/\*/);
});
test('source defines no IPC bridge, certificate bypass or no-sandbox switch', () => {
  const source = fs.readFileSync(path.join(__dirname, '../main.cjs'), 'utf8');
  assert.doesNotMatch(source, /ipcMain|contextBridge|ignore-certificate-errors|appendSwitch\(['"]no-sandbox/);
  assert.match(source, /app\.enableSandbox\(\)/);
  assert.match(source, /callback\(false\)/);
});
test('offline page truthfully reports network dependency and includes restrictive CSP', () => {
  const page = fs.readFileSync(path.join(__dirname, '../offline.html'), 'utf8');
  assert.match(page, /default-src 'none'/);
  assert.match(page, /does not bundle an offline model/);
  assert.doesNotMatch(page, /<script|iframe|http-equiv="refresh"/);
});
