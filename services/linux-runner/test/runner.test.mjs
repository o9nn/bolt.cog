import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRunner, configFromEnvironment, validRelativeFile } from '../runner.mjs';

const TOKEN = 'test-only-0123456789abcdef0123456789abcdef';
const actorId = 'fixture-actor';
const workspaceId = 'fixture-workspace';
const payload = (operation, args = {}, overrides = {}) => ({ actorId, workspaceId, requestId: 'test-request-1', operation, args, ...overrides });

async function fixture(t, overrides = {}, dependencies = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'linux-runner-test-'));
  const root = path.join(directory, 'workspace');
  const auditDirectory = path.join(directory, 'audit');
  await fs.mkdir(root, { mode: 0o700 });
  await fs.mkdir(auditDirectory, { mode: 0o700 });
  await fs.writeFile(path.join(root, 'README.md'), 'Disposable fixture only.\n');
  await fs.mkdir(path.join(root, 'docs'));
  await fs.writeFile(path.join(root, 'docs', 'note.txt'), 'A nested fixture.\n');
  const config = { token: TOKEN, actorId, workspaceId, workspaceRoot: root, auditPath: path.join(auditDirectory, 'events.jsonl'), readFiles: ['README.md', 'docs/note.txt'], ...overrides };
  let runner;
  t.after(async () => { if (runner) await runner.close(); await fs.rm(directory, { recursive: true, force: true }); });
  runner = await createRunner(config, dependencies);
  await new Promise((resolve) => runner.server.listen(0, '127.0.0.1', resolve));
  const port = runner.server.address().port;
  async function request(body, options = {}) {
    return new Promise((resolve, reject) => {
      const text = typeof body === 'string' ? body : JSON.stringify(body);
      const req = http.request({ hostname: '127.0.0.1', port, path: options.route ?? '/execute', method: options.method ?? 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...options.headers } }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(Buffer.concat(chunks).toString()) }));
      });
      req.on('error', reject);
      req.end(text);
    });
  }
  return { directory, root, config, runner, request, port, async audit() { return (await fs.readFile(config.auditPath, 'utf8')).trim().split('\n').map(JSON.parse); } };
}

function successContract(body, requestId = 'test-request-1') {
  assert.deepEqual(Object.keys(body).sort(), ['backend', 'duration', 'exitCode', 'output', 'requestId', 'success']);
  assert.equal(body.backend, 'linux');
  assert.equal(body.requestId, requestId);
  assert.equal(body.success, true);
  assert.equal(body.exitCode, 0);
  assert.equal(typeof body.duration, 'number');
  assert.equal(typeof body.output, 'string');
}

async function denied(f, body, error, status = 400, options) {
  const response = await f.request(body, options);
  assert.equal(response.status, status);
  assert.equal(response.body.success, false);
  assert.equal(response.body.output, '');
  assert.equal(response.body.error, error);
  assert.equal(response.body.backend, 'linux');
  assert.equal(response.body.exitCode, null);
  return response;
}

test('real identity and system_info spawn exact immutable templates without inherited token', async (t) => {
  const calls = [];
  const f = await fixture(t, {}, { spawn(command, args, options) { calls.push({ command, args, options }); return spawn(command, args, options); } });
  const identity = await f.request(payload('identity'));
  assert.equal(identity.status, 200);
  successContract(identity.body);
  assert.match(identity.body.output, /uid=\d+/);
  const system = await f.request(payload('system_info'));
  successContract(system.body);
  assert.match(system.body.output, /^Linux /);
  assert.deepEqual(calls.map(({ command, args }) => ({ command, args })), [{ command: '/usr/bin/id', args: [] }, { command: '/usr/bin/uname', args: ['-a'] }]);
  for (const { options } of calls) {
    assert.equal(options.shell, false);
    assert.equal(options.detached, true);
    assert.deepEqual(options.env, { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' });
    assert.equal(JSON.stringify(options).includes(TOKEN), false);
  }
});

test('fixed-root list hides dotfiles/secret names; reads only curated UTF-8 files', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, '.env'), 'never expose this fixture');
  await fs.writeFile(path.join(f.root, 'credentials.json'), 'never expose this fixture');
  const response = await f.request(payload('workspace_list'));
  successContract(response.body);
  assert.deepEqual(JSON.parse(response.body.output), [{ name: 'docs', type: 'directory' }, { name: 'README.md', type: 'file' }]);
  for (const [file, output] of [['README.md', 'Disposable fixture only.\n'], ['docs/note.txt', 'A nested fixture.\n']]) {
    const read = await f.request(payload('workspace_file_read', { path: file }));
    successContract(read.body);
    assert.equal(read.body.output, output);
  }
  await denied(f, payload('workspace_file_read', { path: 'unlisted.txt' }), 'FILE_NOT_ALLOWLISTED', 403);
});

test('Bearer authentication is mandatory, exact, and does not spawn on failure', async (t) => {
  const f = await fixture(t, {}, { spawn() { assert.fail('unauthorized dispatch must not spawn'); } });
  for (const Authorization of ['', 'Basic bad', `Bearer ${TOKEN}x`, `bearer ${TOKEN}`, 'Bearer short', `Bearer ${'x'.repeat(TOKEN.length)}`]) {
    await denied(f, payload('identity'), 'UNAUTHORIZED', 401, { headers: { Authorization } });
  }
  const rows = await f.audit();
  assert.equal(rows.length, 12);
  assert.equal(rows.filter((row) => row.event === 'dispatch').every((row) => row.authenticated === false), true);
  assert.equal(JSON.stringify(rows).includes(TOKEN), false);
});

test('actor/workspace mapping cannot be supplied or overridden by clients', async (t) => {
  const f = await fixture(t);
  await denied(f, payload('identity', {}, { actorId: 'other-actor' }), 'WORKSPACE_FORBIDDEN', 403);
  await denied(f, payload('identity', {}, { workspaceId: 'other-workspace' }), 'WORKSPACE_FORBIDDEN', 403);
  await denied(f, payload('identity', {}, { workspaceRoot: '/etc' }), 'INVALID_FIELDS');
});

test('unknown/mutating operations and supplied commands/options/invalid schemas are rejected', async (t) => {
  const f = await fixture(t, {}, { spawn() { assert.fail('invalid request must never spawn'); } });
  for (const operation of ['exec', '/bin/sh', 'sudo', 'http_fetch', 'workspace_file_write', 'constructor']) await denied(f, payload(operation), 'OPERATION_NOT_ALLOWED');
  await denied(f, payload('disposable_log_delete', { approval: 'fake' }), 'DELETE_NOT_IMPLEMENTED_READ_ONLY');
  await denied(f, payload('identity', { command: '/bin/sh' }), 'INVALID_ARGS');
  await denied(f, payload('system_info', { args: ['-a', ';id'] }), 'INVALID_ARGS');
  await denied(f, payload('workspace_list', { path: '..' }), 'INVALID_ARGS');
  for (const body of [null, [], '42', { ...payload('identity'), args: [] }, { ...payload('identity'), args: null }, { ...payload('identity'), args: 'x' }, { ...payload('identity'), requestId: '\nforged' }, { ...payload('identity'), actorId: 12 }]) {
    const response = await f.request(body);
    assert.equal(response.body.success, false);
    assert.equal(response.body.output, '');
  }
});

test('path traversal, absolute paths, encoded traversal, shell syntax and secret names are refused', async (t) => {
  const f = await fixture(t);
  const paths = ['../README.md', '/etc/passwd', 'docs/../../file', 'docs//note.txt', 'docs/./note.txt', 'docs\\note.txt', '%2e%2e/x', 'README.md\u0000', 'README.md;id', '.env', 'credentials.json', 'docs/private.key', 'docs/id_rsa', 'docs/.git/config', 'https://example.com/README.md'];
  for (const value of paths) {
    assert.equal(validRelativeFile(value), false, value);
    await denied(f, payload('workspace_file_read', { path: value }), 'INVALID_PATH');
  }
});

test('final symlinks, directory symlinks, hardlinks, FIFOs and binary files are never read', async (t) => {
  const f = await fixture(t, { readFiles: ['README.md', 'linked/note.txt', 'hard.txt', 'binary.txt', 'pipe.txt', 'docs'] });
  const outside = path.join(f.directory, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'note.txt'), 'outside fixture');
  await fs.unlink(path.join(f.root, 'README.md'));
  await fs.symlink(path.join(outside, 'note.txt'), path.join(f.root, 'README.md'));
  await fs.symlink(outside, path.join(f.root, 'linked'));
  await fs.link(path.join(outside, 'note.txt'), path.join(f.root, 'hard.txt'));
  await fs.writeFile(path.join(f.root, 'binary.txt'), Buffer.from([0, 255, 1]));
  for (const file of ['README.md', 'linked/note.txt']) await denied(f, payload('workspace_file_read', { path: file }), 'UNSAFE_OR_UNREADABLE_FILE', 403);
  await denied(f, payload('workspace_file_read', { path: 'hard.txt' }), 'UNSAFE_FILE', 403);
  await denied(f, payload('workspace_file_read', { path: 'docs' }), 'UNSAFE_FILE', 403);
  await denied(f, payload('workspace_file_read', { path: 'binary.txt' }), 'TEXT_FILES_ONLY', 422);
  // A FIFO fixture is created only in this test's freshly allocated workspace.
  await new Promise((resolve, reject) => { const child = spawn('/usr/bin/mkfifo', [path.join(f.root, 'pipe.txt')], { shell: false }); child.once('error', reject); child.once('close', (code) => code === 0 ? resolve() : reject(new Error('mkfifo failed'))); });
  await denied(f, payload('workspace_file_read', { path: 'pipe.txt' }), 'UNSAFE_FILE', 403);
});

test('pinned root prevents substitution by a later root symlink', async (t) => {
  const f = await fixture(t);
  const moved = path.join(f.directory, 'original-workspace');
  const alternate = path.join(f.directory, 'replacement');
  await fs.mkdir(alternate);
  await fs.writeFile(path.join(alternate, 'README.md'), 'wrong fixture');
  await fs.rename(f.root, moved);
  await fs.symlink(alternate, f.root);
  const response = await f.request(payload('workspace_file_read', { path: 'README.md' }));
  assert.equal(response.body.output, 'Disposable fixture only.\n');
});

test('body/output/file/list limits return no partial output', async (t) => {
  const f = await fixture(t, { maxBodyBytes: 256, maxFileBytes: 16, maxOutputBytes: 256, maxEntries: 2 });
  await denied(f, payload('workspace_file_read', { path: 'README.md' }), 'FILE_LIMIT_EXCEEDED', 422);
  await fs.writeFile(path.join(f.root, 'third.txt'), 'fixture');
  await denied(f, payload('workspace_list'), 'DIRECTORY_ENTRY_LIMIT_EXCEEDED', 422);
  await denied(f, `{"large":"${'x'.repeat(300)}"}`, 'BODY_TOO_LARGE', 413);
  const g = await fixture(t, { maxOutputBytes: 16 });
  await denied(g, payload('identity'), 'OUTPUT_LIMIT_EXCEEDED', 422);
  await denied(g, payload('workspace_list'), 'OUTPUT_LIMIT_EXCEEDED', 422);
});

test('invalid JSON, compressed body, content type, Expect and redirect-like routes are refused', async (t) => {
  const f = await fixture(t);
  await denied(f, '{', 'INVALID_JSON');
  await denied(f, payload('identity'), 'CONTENT_TYPE_REQUIRED', 415, { headers: { 'Content-Type': 'text/plain' } });
  await denied(f, payload('identity'), 'CONTENT_ENCODING_NOT_ALLOWED', 415, { headers: { 'Content-Encoding': 'gzip' } });
  const expect = await f.request(payload('identity'), { headers: { Expect: '100-continue' } });
  assert.equal(expect.status, 417);
  for (const route of ['/execute/', '/execute?url=https://example.com', 'https://example.com/execute', '//example.com/execute']) {
    const response = await f.request(payload('identity'), { route });
    assert.equal(response.status, 404);
    assert.equal(response.headers.location, undefined);
  }
});

test('slow HTTP body times out without dispatching a process', async (t) => {
  const f = await fixture(t, { bodyTimeoutMs: 40 });
  const response = await new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: f.port, path: '/execute', method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': 100 } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }));
    });
    req.on('error', reject);
    req.write('{');
  });
  assert.equal(response.status, 408);
  assert.equal(response.body.error, 'BODY_TIMEOUT');
  assert.deepEqual((await f.audit()).map((row) => row.event), ['dispatch', 'terminal']);
});

test('timeout kills detached child and its process group; templates remain fixed at call boundary', async (t) => {
  let pid;
  let descendant;
  const calls = [];
  // Test seam substitutes a bounded sleeping fixture for id; not a runtime API.
  const f = await fixture(t, { executionTimeoutMs: 120 }, { spawn(command, args, options) {
    calls.push({ command, args });
    const script = `const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); console.log(child.pid); setInterval(()=>{},1000);`;
    const child = spawn(process.execPath, ['-e', script], options);
    pid = child.pid;
    child.stdout.once('data', (chunk) => { descendant = Number(chunk.toString().trim()); });
    return child;
  } });
  const response = await denied(f, payload('identity'), 'EXECUTION_TIMEOUT', 504);
  assert.ok(response.body.duration < 2000);
  assert.deepEqual(calls, [{ command: '/usr/bin/id', args: [] }]);
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
  assert.ok(descendant, 'fixture descendant launched');
  // An orphan can briefly be a zombie until the sandbox init reaps it; it is not executing.
  try { const stat = await fs.readFile(`/proc/${descendant}/stat`, 'utf8'); assert.equal(stat.split(' ')[2], 'Z'); } catch (error) { assert.equal(error.code, 'ENOENT'); }
});

test('concurrency is capped while the first process is still running', async (t) => {
  let count = 0;
  const f = await fixture(t, { maxConcurrency: 1, executionTimeoutMs: 160 }, { spawn(_command, _args, options) { count += 1; return spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], options); } });
  const first = f.request(payload('identity', {}, { requestId: 'first' }));
  while (count === 0) await new Promise((resolve) => setTimeout(resolve, 5));
  await denied(f, payload('system_info', {}, { requestId: 'second' }), 'CONCURRENCY_LIMIT_EXCEEDED', 429);
  assert.equal((await first).body.error, 'EXECUTION_TIMEOUT');
  assert.equal(count, 1);
});

test('durable audit contains dispatch/terminal only, sanitized metadata, no output, token or paths', async (t) => {
  const f = await fixture(t);
  await f.request(payload('workspace_file_read', { path: 'README.md' }));
  await denied(f, payload('workspace_file_read', { path: '../escaped\nforgery' }), 'INVALID_PATH');
  const rows = await f.audit();
  assert.deepEqual(rows.map((row) => row.event), ['dispatch', 'terminal', 'dispatch', 'terminal']);
  assert.match(rows[0].targetSha256, /^[a-f0-9]{64}$/);
  assert.equal(rows[1].outputBytes, Buffer.byteLength('Disposable fixture only.\n'));
  const text = JSON.stringify(rows);
  for (const forbidden of [TOKEN, f.root, 'README.md', 'escaped', 'Disposable fixture']) assert.equal(text.includes(forbidden), false, forbidden);
});

test('dispatch audit failure prevents execution, clears output, poisons health and subsequent requests', async (t) => {
  let executed = 0;
  let writes = 0;
  const f = await fixture(t, {}, { createAudit: async () => ({ async append() { writes += 1; throw new Error('secret internal failure'); }, async close() {} }), spawn() { executed += 1; assert.fail('audit failure must never spawn'); } });
  await denied(f, payload('identity'), 'AUDIT_UNAVAILABLE', 503);
  await denied(f, payload('identity'), 'AUDIT_UNAVAILABLE', 503);
  const health = await f.request('', { route: '/health', method: 'GET' });
  assert.deepEqual(health.body, { status: 'unavailable', backend: 'linux' });
  assert.equal(health.status, 503);
  assert.equal(executed, 0);
  assert.equal(writes, 1);
});

test('terminal audit failure suppresses an otherwise successful operation', async (t) => {
  const rows = [];
  const f = await fixture(t, {}, { createAudit: async () => ({ async append(row) { rows.push(row); if (row.event === 'terminal') throw new Error('fsync failed'); }, async close() {} }) });
  await denied(f, payload('workspace_file_read', { path: 'README.md' }), 'AUDIT_UNAVAILABLE', 503);
  assert.deepEqual(rows.map((row) => row.event), ['dispatch', 'terminal']);
});

test('unsafe audit file/root configurations fail closed at startup', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'linux-runner-config-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'workspace');
  const audit = path.join(directory, 'audit');
  await fs.mkdir(root);
  await fs.mkdir(audit, { mode: 0o700 });
  const config = { token: TOKEN, actorId, workspaceId, workspaceRoot: root, auditPath: path.join(audit, 'events.jsonl') };
  await assert.rejects(createRunner(config, { getuid: () => 0 }), /ROOT_EXECUTION_REFUSED/);
  await assert.rejects(createRunner({ ...config, token: 'short' }), /INVALID_TOKEN_CONFIGURATION/);
  await assert.rejects(createRunner({ ...config, auditPath: path.join(root, 'audit.jsonl') }), /AUDIT_MUST_BE_OUTSIDE_WORKSPACE/);
  await assert.rejects(createRunner({ ...config, readFiles: ['.env'] }), /INVALID_READ_ALLOWLIST/);
  await assert.rejects(createRunner({ ...config, maxConcurrency: 100 }), /INVALID_CONCURRENCY_LIMIT/);
  await fs.symlink(root, path.join(directory, 'root-link'));
  await assert.rejects(createRunner({ ...config, workspaceRoot: path.join(directory, 'root-link') }));
  await fs.writeFile(path.join(audit, 'target'), 'fixture audit');
  await fs.symlink(path.join(audit, 'target'), config.auditPath);
  await assert.rejects(createRunner(config));
  await fs.unlink(config.auditPath);
  await fs.writeFile(config.auditPath, 'fixture', { mode: 0o644 });
  await assert.rejects(createRunner(config), /UNSAFE_AUDIT_FILE/);
  await fs.unlink(config.auditPath);
  await fs.chmod(audit, 0o755);
  await assert.rejects(createRunner(config), /AUDIT_DIRECTORY_MUST_BE_PRIVATE/);
});

test('health has no configuration and environment allowlist defaults to empty', async (t) => {
  const f = await fixture(t, { readFiles: [] });
  const health = await f.request('', { route: '/health', method: 'GET', headers: { Authorization: '' } });
  assert.equal(health.status, 200);
  assert.deepEqual(health.body, { status: 'ok', backend: 'linux' });
  await denied(f, payload('workspace_file_read', { path: 'README.md' }), 'FILE_NOT_ALLOWLISTED', 403);
  assert.deepEqual(configFromEnvironment({ RUNNER_TOKEN: TOKEN, RUNNER_ACTOR_ID: actorId, RUNNER_WORKSPACE_ID: workspaceId, RUNNER_WORKSPACE_ROOT: f.root, RUNNER_AUDIT_PATH: f.config.auditPath }).readFiles, []);
  assert.throws(() => configFromEnvironment({ RUNNER_READ_FILES_JSON: '{' }), /INVALID_READ_ALLOWLIST/);
});

test('unlinking the real durable audit file causes fail-closed refusal before spawning', async (t) => {
  let count = 0;
  const f = await fixture(t, {}, { spawn(command, args, options) { count += 1; return spawn(command, args, options); } });
  await fs.unlink(f.config.auditPath);
  await denied(f, payload('identity'), 'AUDIT_UNAVAILABLE', 503);
  assert.equal(count, 0);
  const health = await f.request('', { route: '/health', method: 'GET' });
  assert.equal(health.status, 503);
});

test('audit pairs use unique server dispatch IDs despite repeated client request IDs', async (t) => {
  const f = await fixture(t);
  await f.request(payload('workspace_list'));
  await f.request(payload('workspace_list'));
  const rows = await f.audit();
  assert.equal(rows[0].dispatchId, rows[1].dispatchId);
  assert.equal(rows[2].dispatchId, rows[3].dispatchId);
  assert.notEqual(rows[0].dispatchId, rows[2].dispatchId);
});

test('malformed UTF-8 and missing allowlisted files return no content', async (t) => {
  const f = await fixture(t, { readFiles: ['broken.txt', 'missing.txt'] });
  await fs.writeFile(path.join(f.root, 'broken.txt'), Buffer.from([0xc0, 0xaf]));
  await denied(f, payload('workspace_file_read', { path: 'broken.txt' }), 'TEXT_FILES_ONLY', 422);
  await denied(f, payload('workspace_file_read', { path: 'missing.txt' }), 'FILE_NOT_FOUND', 404);
});

test('shutdown cancels work and still durably records its terminal result', async (t) => {
  let count = 0;
  const f = await fixture(t, { executionTimeoutMs: 2000 }, { spawn(_command, _args, options) { count += 1; return spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], options); } });
  const first = f.request(payload('identity')).catch((error) => ({ disconnected: true, code: error.code }));
  while (count === 0) await new Promise((resolve) => setTimeout(resolve, 5));
  await f.runner.close();
  await first;
  const rows = await f.audit();
  assert.deepEqual(rows.map((row) => row.event), ['dispatch', 'terminal']);
  assert.equal(rows[1].success, false);
  assert.equal(rows[1].error, 'EXECUTION_CANCELLED');
});

test('numeric actor IDs and normalized root aliases are rejected during startup', async (t) => {
  const f = await fixture(t);
  await assert.rejects(createRunner({ ...f.config, actorId: 123 }), /INVALID_ID_CONFIGURATION/);
  await assert.rejects(createRunner({ ...f.config, workspaceRoot: '/tmp/..' }), /INVALID_WORKSPACE_ROOT/);
});
