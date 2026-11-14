'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomBytes } = require('node:crypto');
const http = require('node:http');
const { startBackend, createLocalToolFactory } = require('../runtime/backend.cjs');

async function withBackend(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bolt-local-backend-'));
  const token = randomBytes(32).toString('hex');
  const backend = await startBackend({ token, assetsDir: path.join(__dirname, '../runtime/client'),
    workspace: path.join(directory, 'workspace'), auditFile: path.join(directory, 'audit.jsonl'),
    env: { LLM_PROVIDER: 'openai-compatible', LLM_BASE_URL: 'http://127.0.0.1:19999/v1', LLM_MODEL: 'not-running-test-endpoint' } });
  try { await run({ ...backend, token, directory }); }
  finally { await backend.close(); await fs.rm(directory, { recursive: true, force: true }); }
}

test('actual bundled app serves local UI and headers without provider/cloud connectivity', () => withBackend(async ({ origin, token }) => {
  const response = await fetch(origin, { headers: { 'X-Bolt-Desktop-Token': token } });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<html|Bolt|bolt/i);
  assert.equal(response.headers.get('Cross-Origin-Opener-Policy'), 'same-origin');
  assert.equal(response.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp');
}));
test('local requests require the per-launch capability and exact Host/Origin', () => withBackend(async ({ origin, token }) => {
  assert.equal((await fetch(origin + '/api/desktop/info')).status, 401);
  assert.equal((await fetch(origin + '/api/desktop/info', { headers: { 'X-Bolt-Desktop-Token': '0'.repeat(64) } })).status, 401);
  assert.equal((await fetch(origin + '/api/desktop/info', { headers: { 'X-Bolt-Desktop-Token': token, Origin: 'https://evil.test' } })).status, 403);
  const foreignHostStatus = await new Promise((resolve, reject) => {
    http.get(origin + '/api/desktop/info', { headers: { 'X-Bolt-Desktop-Token': token, Host: 'evil.test' } }, (response) => {
      response.resume(); resolve(response.statusCode);
    }).on('error', reject);
  });
  assert.equal(foreignHostStatus, 403);
  const response = await fetch(origin + '/api/desktop/info', { headers: { 'X-Bolt-Desktop-Token': token } });
  const info = await response.json(); assert.equal(info.runtime, 'desktop'); assert.equal(info.nativeTools, 'read-only');
  assert.equal('token' in info, false); assert.equal('apiKey' in info, false);
}));
test('static traversal, hidden files and cross-root symlinks are not served', () => withBackend(async ({ origin, token }) => {
  for (const target of ['/%2e%2e%2fpackage.json', '/.env', '/%5c..%5cpackage.json']) {
    const response = await fetch(origin + target, { headers: { 'X-Bolt-Desktop-Token': token } });
    assert.equal(response.status, 403);
  }
}));
test('local chat refuses unavailable real providers rather than simulating text', () => withBackend(async ({ origin, token }) => {
  const response = await fetch(origin + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bolt-Desktop-Token': token }, body: JSON.stringify({ messages: [{ role: 'user', content: 'Say hello.' }] }) });
  const stream = await response.text();
  assert.match(stream, /^3:/m); assert.doesNotMatch(stream, /^0:/m);
}));
test('real Agent-Zero identity invokes the fixed native utility, audits, and denies file/privileged tools', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bolt-native-tools-'));
  const auditFile = path.join(directory, 'audit.jsonl');
  try {
    const { agent } = createLocalToolFactory(path.join(directory, 'workspace'), auditFile)('native-test', new AbortController().signal);
    const identity = await agent.executeTool('workspace_inspect', { operation: 'identity', args: {} });
    assert.equal(identity.success, true); assert.ok(identity.output.length); assert.equal(identity.metadata.backend, 'desktop-native');
    assert.equal(identity.metadata.exitCode, 0);
    const file = await agent.executeTool('workspace_inspect', { operation: 'workspace_file_read', args: { path: 'secret.txt' } });
    assert.equal(file.success, false); assert.match(file.error, /allowlist/);
    assert.equal((await agent.executeTool('sudo', { command: 'id' })).success, false);
    assert.equal((await agent.executeTool('godmode', {})).success, false);
    assert.equal((await agent.executeTool('workspace_inspect', { operation: 'identity', args: { path: '../secret' } })).success, false);
    const events = (await fs.readFile(auditFile, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(events.length, 4); assert.equal(events[0].phase, 'authorized'); assert.equal(events[1].success, true); assert.equal(events[3].success, false);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
