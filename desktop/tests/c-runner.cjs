'use strict';
// UNIT TRANSPORT FIXTURES ONLY: no Docker CLI, compiler, daemon, or container is run.
// These prove policy/transport decisions, NOT Linux namespace or runtime isolation.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createHash } = require('node:crypto');
const { buildSync } = require('../../node_modules/esbuild');
const image = 'docker.io/library/gcc@sha256:' + 'a'.repeat(64);
const root = path.resolve(__dirname, '../..');
const code = buildSync({ entryPoints: [path.join(root, 'desktop/c-runner.ts')], platform: 'node', format: 'cjs', bundle: true, write: false }).outputFiles[0].text;
const valid = { files: { 'main.c': '#include <stdio.h>\nint main(void) { puts("UNIT_FIXTURE"); return 0; }\n' } };
const canonicalCode = buildSync({ entryPoints: [path.join(root, 'app/lib/coding/c-project.ts')], platform: 'node', format: 'cjs', bundle: true, write: false }).outputFiles[0].text;
function load(code, childProcess) {
  const module = { exports: {} };
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})')((name) => name === 'node:child_process' && childProcess ? childProcess : require(name), module, module.exports);
  return module.exports;
}
const plain = load(code);
const shared = load(canonicalCode);
function readTar(bytes) {
  const result = []; let paxPath;
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const h = bytes.subarray(offset, offset + 512); if (h.every((b) => !b)) break;
    const z = (start, length) => h.subarray(start, start + length).toString('ascii').replace(/\0.*$/s, '');
    const prefix = z(345, 155); let name = (prefix ? prefix + '/' : '') + z(0, 100);
    const size = parseInt(z(124, 12), 8), expected = parseInt(z(148, 8), 8);
    const check = Buffer.from(h); check.fill(32, 148, 156);
    assert.equal(expected, check.reduce((a, b) => a + b, 0));
    assert.equal(z(257, 6), 'ustar'); assert.equal(z(157, 100), '');
    const data = bytes.subarray(offset + 512, offset + 512 + size);
    if (h[156] === 0x78) { const record = data.toString('utf8'); assert.match(record, /^\d+ path=[^\n]+\n$/); assert.equal(Number(record.split(' ')[0]), data.length); paxPath = record.replace(/^\d+ path=/, '').replace(/\n$/, ''); }
    else { if (paxPath) { name = paxPath; paxPath = undefined; } result.push({ name, size, data, type: String.fromCharCode(h[156]), uid: parseInt(z(108, 8), 8), mode: parseInt(z(100, 8), 8) }); }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return result;
}
async function fixture(t, scenario = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bolt-c-unit-')));
  const socket = path.join(dir, 'engine.sock');
  let server;
  if (process.platform !== 'win32') {
    server = net.createServer(); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socket, resolve); });
  }
  t.after(async () => { if (server) await new Promise((resolve) => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  const calls = [], states = new Map(), children = new Set(); let seq = 0;
  const api = load(code, { spawn(executable, argv, options) {
    assert.equal(executable, process.execPath);
    assert.equal(options.shell, false); assert.equal(options.windowsHide, true);
    for (const key of Object.keys(options.env)) assert.equal(/DOCKER|TOKEN|KEY|PROXY|SECRET|HOME/i.test(key), false);
    assert.equal(argv[0], '--config'); assert.match(argv[1], /\.c-docker-[a-f0-9]{32}$/);
    assert.equal(argv[2], '--host');
    const args = argv.slice(4); calls.push({ args, options });
    const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); children.add(child);
    let closed = false, stdin = [];
    const close = (exit = 0) => { if (closed) return; closed = true; children.delete(child); child.stdout.end(); child.stderr.end(); child.emit('close', exit); };
    child.kill = () => { queueMicrotask(() => close(null)); return true; };
    child.stdin.on('data', (b) => stdin.push(b));
    const out = (value) => child.stdout.write(Buffer.isBuffer(value) ? value : String(value));
    const err = (value) => child.stderr.write(Buffer.isBuffer(value) ? value : String(value));
    child.stdin.once('finish', () => queueMicrotask(() => {
      if (closed) return;
      const kind = args[0], verb = args[1];
      if (kind === 'info') {
        out(JSON.stringify({ OSType: 'linux', CgroupVersion: '2', CgroupDriver: 'systemd', MemoryLimit: true, SwapLimit: true,
          CpuCfsQuota: true, PidsLimit: true, SecurityOptions: ['name=seccomp,profile=builtin'], ServerVersion: 'UNIT-NOT-DOCKER', ...(scenario.engine || {}) })); close();
      } else if (kind === 'image') {
        out(JSON.stringify({ Os: 'linux', RepoDigests: [image], Id: 'sha256:' + 'b'.repeat(64), Config: { Volumes: null }, ...(scenario.image || {}) })); close();
      } else if (verb === 'create') {
        if (scenario.createFailure) { err('fixture create error'); close(1); return; }
        const arg = (flag) => args[args.indexOf(flag) + 1];
        const id = (++seq).toString(16).padStart(64, '0');
        const name = arg('--name'), scope = arg('--label').split('=')[1], runtime = name.includes('-run-');
        const memory = runtime ? 256 : 512;
        const metadata = { Id: id, Name: '/' + name, Config: { User: '65534:65534', Labels: { 'io.bolt.c-runner.scope': scope }, Volumes: null },
          HostConfig: { Privileged: false, NetworkMode: 'none', ReadonlyRootfs: true, CapDrop: ['ALL'], CapAdd: [], SecurityOpt: ['no-new-privileges'],
            PidsLimit: 64, Memory: memory * 1024 * 1024, MemorySwap: memory * 1024 * 1024, NanoCpus: 1e9, IpcMode: 'private', CgroupnsMode: 'private', Tmpfs: { '/input': 'noexec,nosuid,nodev,size=1m', '/tmp': 'noexec,nosuid,nodev,size=16m', '/work': 'exec,nosuid,nodev,size=64m' }, Binds: [], Devices: [], Mounts: [] },
          Mounts: [], State: { Running: false, Status: 'created', ExitCode: 0, OOMKilled: false, Error: '' } };
        states.set(id, { metadata, runtime, ready: false }); out(id); close();
      } else if (verb === 'inspect') {
        const state = states.get(args[2]) || [...states.values()].find((s) => s.metadata.Name === '/' + args[2]);
        if (!state) { close(1); return; }
        const value = structuredClone(state.metadata);
        if (scenario.badOwnership) value.Config.Labels = {};
        if (scenario.badIsolation) value.HostConfig.NetworkMode = 'host';
        if (scenario.waitMismatch && state.runtime && !value.State.Running && value.State.Status === 'exited') value.State.ExitCode = 99;
        out(JSON.stringify(value)); close();
      } else if (verb === 'start') {
        states.get(args[2]).metadata.State.Running = true; states.get(args[2]).metadata.State.Status = 'running'; out(args[2]); close();
      } else if (verb === 'rm') {
        assert.equal(args[2], '--force'); assert.match(args[3], /^[a-f0-9]{64}$/);
        if (scenario.cleanupFailure) { close(1); return; }
        states.delete(args[3]); out(args[3]); close();
      } else if (verb === 'exec') {
        if (args.includes('/proc/swaps')) { out(scenario.swaps ?? 'Filename\tType\tSize\tUsed\tPriority\n'); close(); }
        else if (args.includes('/proc/meminfo')) { out(scenario.meminfo ?? 'MemTotal: 1024000 kB\nSwapTotal: 0 kB\n'); close(); }
        else if (args.includes('/bin/cat')) { out(Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(64)])); close(); }
        else if (args.includes('bolt-c17')) {
          if (scenario.holdCompile) { scenario.compileChild = child; return; }
          out(scenario.compileStdout || ''); err(scenario.compileStderr || ''); close(scenario.compileCode || 0);
        } else {
          const entries = readTar(Buffer.concat(stdin));
          if (entries.some((e) => e.name === 'program')) {
            const state = [...states.values()].find((s) => s.runtime); state.ready = true;
            state.metadata.State = { Running: false, Status: 'exited', ExitCode: scenario.runCode || 0, OOMKilled: false, Error: '' };
          } else {
            assert.equal(entries.find((e) => e.name === 'main.c').data.toString(), valid.files['main.c']);
          }
          close();
        }
      } else if (verb === 'logs' || verb === 'wait') {
        const id = args[verb === 'logs' ? 3 : 2];
        const check = () => {
          if (closed) return;
          const state = states.get(id);
          if (!state) { close(1); return; }
          if (!state.ready) { setTimeout(check, 1); return; }
          if (verb === 'wait') out(scenario.runCode || 0);
          else { out(scenario.runStdout || 'UNIT_FIXTURE\n'); err(scenario.runStderr || ''); }
          close();
        }; check();
      } else throw new Error('Unimplemented UNIT Docker command: ' + args.join(' '));
    }));
    return child;
  } });
  const compiler = api.createCCompiler({ image, dockerPath: process.execPath,
    dockerHost: process.platform === 'win32' ? 'npipe:////./pipe/docker_engine' : 'unix://' + socket,
    workspace: dir, auditFile: path.join(dir, 'audit.jsonl') });
  t.after(async () => { for (const c of children) c.kill(); await compiler.close().catch(() => {}); });
  return { compiler, calls, states, dir };
}

for (const name of ['/a.c', '../a.c', 'a/../b.c', 'a\\b.c', '.a.c', 'a/.h/b.c', 'x%2fc.c', 'a.c\0', 'Makefile', 'CMakeLists.txt', '-fplugin.c', 'a.hpp', 'a.C', 'CON.c']) {
  test(`UNIT shared validator rejects unsafe path ${JSON.stringify(name)}`, () => assert.throws(() => plain.validateCProject({ files: { [name]: 'int main(void){return 0;}' } })));
}
test('UNIT shared validator denies extension tokens but ignores comments and string literals', () => {
  for (const word of ['asm', '__asm__', 'typeof', '__typeof__', '__builtin_trap']) assert.throws(() => plain.validateCProject({ files: { 'main.c': `int main(void) { ${word}(0); }` } }));
  assert.doesNotThrow(() => plain.validateCProject({ files: { 'main.c': '/* typeof asm __builtin_trap */\nint main(void){ const char *s="__asm__"; (void)s; return 0; }' } }));
});
test('UNIT shared validator denies extra flags, descriptors, header escapes and case collisions', () => {
  for (const input of [ { ...valid, flags: '-fplugin=bad' }, { ...valid, shell: 'sh' }, { files: { 'main.c': { type: 'symlink', target: '/etc/passwd' } } },
    { files: { 'a.c': '', 'A.c': '' } }, { files: { 'a/main.c': '', 'A/header.h': '' } },
    { files: { 'main.c': '#include </etc/passwd>\n' } }, { files: { 'main.c': '#include <unistd.h>\n' } },
    { files: { 'main.c': '#define H <stdio.h>\n#include H\n' } }, { files: { 'main.c': '#include "missing.h"\n' } },
    { files: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`a${i}.c`, ''])) }, { files: { 'main.c': ' '.repeat(256 * 1024 + 1) } },
    { ...valid, stdin: 'a'.repeat(8193) } ]) assert.throws(() => plain.validateCProject(input));
});
test('UNIT fixed USTAR writes regular root-owned immutable source bytes, nested long paths and no links', () => {
  const long = 'a'.repeat(60) + '/' + 'b'.repeat(60) + '/' + 'c'.repeat(60) + '/' + 'd'.repeat(48) + '.c';
  const project = { files: { '_main.c': 'int main(void){return 0;}\n', [long]: 'int helper(void){return 1;}\n', 'inc/data.h': '/* ü */\n' } };
  const entries = readTar(plain.encodeCProjectTar(project));
  for (const entry of entries) { assert.ok(['0', '5'].includes(entry.type)); assert.equal(entry.uid, 0); assert.ok(!entry.name.startsWith('/')); }
  for (const [name, source] of Object.entries(project.files)) {
    const entry = entries.find((e) => e.name === name); assert.ok(entry); assert.equal(entry.data.toString('utf8'), source); assert.equal(entry.mode, 0o444);
  }
});
test('UNIT image pin repository normalization keeps digest and registry identity', () => {
  assert.equal(plain.canonicalDockerImage('gcc@sha256:' + 'a'.repeat(64)), image);
  assert.equal(plain.canonicalDockerImage('docker.io/gcc@sha256:' + 'a'.repeat(64)), image);
  assert.notEqual(plain.canonicalDockerImage('evil.example/gcc@sha256:' + 'a'.repeat(64)), image);
});
test('UNIT Docker configuration requires pinned image/native executable/local-only endpoints', () => {
  const base = { image, auditFile: path.join(os.tmpdir(), 'unit-audit.jsonl') };
  for (const bad of ['gcc:latest', 'gcc@sha256:abc', 'gcc@sha256:' + 'g'.repeat(64)]) assert.throws(() => plain.createCCompiler({ ...base, image: bad }), (e) => e.code === 'CONFIG');
  for (const host of ['tcp://127.0.0.1:2375', 'ssh://localhost', 'unix:///tmp/../docker.sock', 'unix:///tmp//docker.sock', 'npipe:////remote/pipe/docker_engine', 'default'])
    assert.throws(() => plain.validateDockerHost(host, host.startsWith('npipe:') ? 'win32' : 'linux'));
  assert.equal(plain.validateDockerHost('unix:///var/run/docker.sock', 'linux'), 'unix:///var/run/docker.sock');
  assert.equal(plain.validateDockerHost('npipe:////./pipe/docker_engine', 'win32'), 'npipe:////./pipe/docker_engine');
  assert.throws(() => plain.createCCompiler({ ...base, dockerPath: 'docker' }));
});
test('UNIT complete phase receipt, canonical hash, hardening argv and private non-content audit', async (t) => {
  const f = await fixture(t); assert.equal((await f.compiler.info()).available, true);
  const result = await f.compiler.execute(valid, { requestId: 'unit-good' });
  assert.equal(result.success, true); assert.equal(result.compile.exitCode, 0); assert.equal(result.run.exitCode, 0);
  assert.equal(result.compile.evidence, 'docker-exec'); assert.equal(result.run.evidence, 'docker-wait-inspect');
  assert.equal(result.sourceHash, createHash('sha256').update(shared.canonicalCProject(valid)).digest('hex'));
  assert.equal(result.cleanup.ok, true); assert.equal(f.states.size, 0); assert.equal(result.audit.recorded, true);
  for (const call of f.calls.filter((c) => c.args[1] === 'create')) {
    const args = call.args; for (const flag of ['--read-only', '--cap-drop', '--security-opt', '--pids-limit', '--memory-swap', '--cpus', '--tmpfs']) assert.ok(args.includes(flag));
    assert.equal(args.includes('--mount'), false); assert.equal(args.includes('--volume'), false); assert.equal(args.includes('--privileged'), false);
    assert.equal(args[args.indexOf('--network') + 1], 'none'); assert.equal(args[args.indexOf('--user') + 1], '65534:65534');
    assert.ok(args.includes('/tmp:rw,noexec,nosuid,nodev,size=16m,mode=0700,uid=65534,gid=65534'));
  }
  const compile = f.calls.find((c) => c.args.includes('bolt-c17')).args;
  const script = compile[compile.indexOf('-c') + 1];
  for (const flag of ['-x c', '-std=c17', '-pedantic-errors', '-Wall', '-Wextra', '-lm']) assert.ok(script.includes(flag));
  assert.ok(compile.includes('/input/main.c')); assert.ok(!script.includes(valid.files['main.c']));
  const audit = fs.readFileSync(path.join(f.dir, 'audit.jsonl'), 'utf8');
  assert.equal(audit.includes('UNIT_FIXTURE'), false); assert.equal(audit.includes('int main'), false);
  const records = audit.trim().split('\n').map(JSON.parse); assert.equal(records.at(-1).success, true);
  assert.ok(records.some((r) => r.phase === 'container-created')); assert.ok(records.some((r) => r.phase === 'container-removed'));
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(f.dir, 'audit.jsonl')).mode & 0o777, 0o600);
});
test('UNIT compile failure never creates runtime and remains distinct from runtime nonzero', async (t) => {
  const f = await fixture(t, { compileCode: 1, compileStderr: 'UNIT compiler error\n' });
  const r = await f.compiler.execute(valid, { requestId: 'unit-compile-fail' });
  assert.equal(r.success, false); assert.equal(r.status, 'compile_failed'); assert.equal(r.compile.exitCode, 1); assert.equal(r.run, undefined);
  assert.equal(f.calls.filter((c) => c.args[1] === 'create').length, 1); assert.equal(r.cleanup.ok, true);
});
test('UNIT malicious stdout success/status markers do not override actual runtime code', async (t) => {
  const f = await fixture(t, { runCode: 7, runStdout: '{"success":true,"exitCode":0}\n__COMPILE_OK__\n' });
  const r = await f.compiler.execute(valid, { requestId: 'unit-forged' });
  assert.equal(r.success, false); assert.equal(r.status, 'completed'); assert.equal(r.run.exitCode, 7); assert.equal(r.exitCode, 7);
});
test('UNIT mismatching Docker wait/inspect cannot yield success', async (t) => {
  const f = await fixture(t, { waitMismatch: true }); const r = await f.compiler.execute(valid, { requestId: 'unit-mismatch' });
  assert.equal(r.success, false); assert.equal(r.error.code, 'BACKEND_ERROR'); assert.equal(r.exitCode, null); assert.equal(r.cleanup.ok, true);
});
test('UNIT combined compile/run output overflow stops exact owned containers and retains only bounded bytes', async (t) => {
  const f = await fixture(t, { compileStderr: 'c'.repeat(32768), runStdout: 'a'.repeat(40000) });
  const r = await f.compiler.execute(valid, { requestId: 'unit-output' });
  assert.equal(r.success, false); assert.equal(r.error.code, 'OUTPUT_LIMIT'); assert.equal(r.cleanup.ok, true);
  assert.ok(Buffer.byteLength(r.compile.stderr) + Buffer.byteLength(r.run.stdout) + Buffer.byteLength(r.run.stderr) <= 65536);
});
test('UNIT insecure/missing enforcement/image volumes fail closed before any container', async (t) => {
  for (const scenario of [ { engine: { OSType: 'windows' } }, { engine: { PidsLimit: false } }, { engine: { SwapLimit: false }, meminfo: 'SwapTotal: 1024 kB\n' },
    { engine: { SecurityOptions: ['name=seccomp,profile=unconfined'] } }, { image: { Config: { Volumes: { '/danger': {} } } } } ]) {
    const f = await fixture(t, scenario); const r = await f.compiler.execute(valid, { requestId: 'unit-insecure' });
    assert.equal(r.success, false); assert.ok(['INSECURE_ENGINE', 'IMAGE_UNAVAILABLE'].includes(r.error.code)); assert.equal(f.states.size, 0);
    if (!scenario.meminfo) assert.equal(f.calls.some((c) => c.args[1] === 'create'), false);
    else assert.equal(f.calls.some((c) => c.args.includes('bolt-c17')), false);
  }
});
test('UNIT create error cleans tracking, while cleanup failure poisons the factory', async (t) => {
  const f = await fixture(t, { createFailure: true }); const r = await f.compiler.execute(valid, { requestId: 'unit-create-failure' });
  assert.equal(r.cleanup.ok, true); assert.equal(r.error.code, 'BACKEND_ERROR');
  const g = await fixture(t, { cleanupFailure: true }); const bad = await g.compiler.execute(valid, { requestId: 'unit-cleanup-failure' });
  assert.equal(bad.success, false); assert.equal(bad.cleanup.ok, false); assert.equal(bad.error.code, 'CLEANUP_FAILED');
  await assert.rejects(g.compiler.execute(valid, { requestId: 'unit-retry' }), (e) => e.code === 'CLEANUP_FAILED');
});
test('UNIT abort kills compiler descendants via container removal, concurrent jobs reject BUSY', async (t) => {
  const scenario = { holdCompile: true }; const f = await fixture(t, scenario), controller = new AbortController();
  const job = f.compiler.execute(valid, { requestId: 'unit-abort', signal: controller.signal });
  await assert.rejects(f.compiler.execute(valid, { requestId: 'unit-busy' }), (e) => e.code === 'BUSY');
  while (!scenario.compileChild) await new Promise((resolve) => setTimeout(resolve, 1));
  controller.abort(); const r = await job;
  assert.equal(r.error.code, 'ABORTED'); assert.equal(r.success, false); assert.equal(r.cleanup.ok, true);
  assert.ok(f.calls.some((c) => c.args[1] === 'rm')); await f.compiler.close();
  await assert.rejects(f.compiler.execute(valid, { requestId: 'unit-closed' }), (e) => e.code === 'CLOSED');
});
test('UNIT invalid source and audit symlink fail closed without spawning Docker', async (t) => {
  const f = await fixture(t); const invalid = await f.compiler.execute({ files: { 'main.c': '#include <sys/socket.h>\n' } }, { requestId: 'unit-invalid' });
  assert.equal(invalid.error.code, 'INVALID_PROJECT'); assert.equal(f.calls.length, 0);
  fs.unlinkSync(path.join(f.dir, 'audit.jsonl')); const target = path.join(f.dir, 'protected.txt'); fs.writeFileSync(target, 'unchanged');
  fs.symlinkSync(target, path.join(f.dir, 'audit.jsonl'));
  const bad = await f.compiler.execute(valid, { requestId: 'unit-audit-link' });
  assert.equal(bad.error.code, 'AUDIT_ERROR'); assert.equal(bad.success, false); assert.equal(f.calls.length, 0); assert.equal(fs.readFileSync(target, 'utf8'), 'unchanged');
});
test('UNIT unavailable Docker returns unavailable info and never silently uses host compiler', async (t) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bolt-c-unavailable-'))); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const compiler = plain.createCCompiler({ image, dockerPath: path.join(dir, 'missing'), auditFile: path.join(dir, 'audit.jsonl'), workspace: dir,
    dockerHost: process.platform === 'win32' ? 'npipe:////./pipe/unit_missing' : 'unix://' + path.join(dir, 'missing.sock') });
  assert.equal((await compiler.info()).available, false);
  const r = await compiler.execute(valid, { requestId: 'unit-unavailable' }); assert.equal(r.success, false); assert.equal(r.error.code, 'UNAVAILABLE'); await compiler.close();
});

test('UNIT malformed UTF-8 program output stays bounded after decoding', async (t) => {
  const f = await fixture(t, { runStdout: Buffer.alloc(65536, 0xff) });
  const r = await f.compiler.execute(valid, { requestId: 'unit-binary-output' });
  assert.equal(r.success, true); assert.ok(Buffer.byteLength(r.run.stdout) + Buffer.byteLength(r.run.stderr) <= 65536);
});
test('UNIT foreign ownership cannot trigger deletion; altered isolation stops before start', async (t) => {
  const f = await fixture(t, { badOwnership: true });
  const r = await f.compiler.execute(valid, { requestId: 'unit-foreign' });
  assert.equal(r.success, false); assert.equal(r.cleanup.ok, false); assert.equal(f.calls.some((c) => c.args[1] === 'rm'), false);
  const g = await fixture(t, { badIsolation: true }); const bad = await g.compiler.execute(valid, { requestId: 'unit-ignored-limits' });
  assert.equal(bad.success, false); assert.equal(bad.error.code, 'INSECURE_ENGINE'); assert.equal(bad.cleanup.ok, true);
  assert.equal(g.calls.some((c) => c.args[1] === 'start'), false);
});
test('UNIT close aborts active work and waits for exact owned cleanup', async (t) => {
  const scenario = { holdCompile: true }; const f = await fixture(t, scenario);
  const job = f.compiler.execute(valid, { requestId: 'unit-close-aborts' });
  while (!scenario.compileChild) await new Promise((resolve) => setTimeout(resolve, 1));
  await f.compiler.close(); const r = await job;
  assert.equal(r.error.code, 'ABORTED'); assert.equal(r.cleanup.ok, true); assert.equal(f.states.size, 0);
});

test('UNIT absent swap controller requires per-preflight proof inside trusted image, never host /proc', async (t) => {
  const f = await fixture(t, { engine: { SwapLimit: false } });
  assert.equal((await f.compiler.info()).available, true); const r = await f.compiler.execute(valid, { requestId: 'unit-zero-swap' });
  assert.equal(r.success, true); assert.ok(r.warnings.some((w) => w.includes('zero swap'))); assert.equal(r.cleanup.ok, true);
  assert.equal(f.calls.filter((c) => c.args.includes('/proc/swaps')).length, 2);
  assert.equal(f.calls.filter((c) => c.args.includes('/proc/meminfo')).length, 2);
  for (const scenario of [ { meminfo: 'SwapTotal: 1 kB\n' }, { swaps: 'Filename Type Size Used Priority\n/dev/sda swap 1 0 0\n' },
    { swaps: '' }, { meminfo: 'SwapTotal: 0 kB\nSwapTotal: 0 kB\n' }, { meminfo: 'malformed' } ]) {
    const g = await fixture(t, { ...scenario, engine: { SwapLimit: false } });
    const bad = await g.compiler.execute(valid, { requestId: 'unit-swap-denied' });
    assert.equal(bad.success, false); assert.equal(bad.error.code, 'INSECURE_ENGINE'); assert.equal(bad.cleanup.ok, true);
    assert.equal(g.calls.some((c) => c.args.includes('bolt-c17')), false);
  }
});
