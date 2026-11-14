'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.join(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bolt-electron-smoke-'));
const packagedBinary = process.env.BOLT_DESKTOP_SMOKE_BINARY;
const binary = packagedBinary || require('electron');
const args = [...(packagedBinary ? [] : [root]), '--desktop-smoke'];
const withXvfb = process.platform === 'linux' && !process.env.DISPLAY;
const command = withXvfb ? 'xvfb-run' : binary;
const childArgs = withXvfb ? ['-a', '-s', '-screen 0 1440x960x24', binary, ...args] : args;
const child = spawn(command, childArgs, {
  cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, BOLT_DESKTOP_SMOKE_PROFILE: profile }
});
let output = '';
const timer = setTimeout(() => child.kill('SIGKILL'), 50_000);
child.stdout.on('data', (chunk) => { output += chunk; process.stdout.write(chunk); });
child.stderr.on('data', (chunk) => process.stderr.write(chunk));
child.on('error', () => { clearTimeout(timer); fs.rmSync(profile, { recursive: true, force: true }); process.exitCode = 1; });
child.on('close', (code) => {
  clearTimeout(timer);
  fs.rmSync(profile, { recursive: true, force: true });
  process.exitCode = code === 0 && output.includes('ELECTRON_SMOKE_RESULT ') ? 0 : 1;
});
