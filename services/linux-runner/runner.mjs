import http from 'node:http';
import { spawn as nodeSpawn } from 'node:child_process';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const SECRET_NAME = /(?:^|[_.-])(?:env|secret|secrets|credential|credentials|token|tokens|password|passwd|shadow|private|id_rsa|id_ed25519)(?:[_.-]|$)|\.(?:key|pem|p12|pfx|kdbx)$/i;
const OPERATIONS = new Set(['identity', 'system_info', 'workspace_list', 'workspace_file_read']);
const TOP_KEYS = ['actorId', 'workspaceId', 'requestId', 'operation', 'args'];
const NOFOLLOW = constants.O_NOFOLLOW;
const DIRECTORY = constants.O_DIRECTORY;
const hash = (value) => createHash('sha256').update(value).digest();
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const fault = (code, status = 400) => Object.assign(new Error(code), { code, status });

export function validRelativeFile(value) {
  if (typeof value !== 'string' || value.length > 512) return false;
  const parts = value.split('/');
  return parts.length > 0 && parts.length <= 8 && parts.every((part) => SEGMENT.test(part) && !SECRET_NAME.test(part));
}

function boundedInteger(value, fallback, minimum, maximum, name) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw fault(`INVALID_${name}`, 500);
  return value;
}

function validateConfig(input) {
  if (process.platform !== 'linux' || NOFOLLOW === undefined || DIRECTORY === undefined) throw fault('LINUX_REQUIRED', 500);
  if (typeof input.token !== 'string' || !/^[\x21-\x7e]{32,256}$/.test(input.token)) throw fault('INVALID_TOKEN_CONFIGURATION', 500);
  if (typeof input.actorId !== 'string' || typeof input.workspaceId !== 'string' || !ID.test(input.actorId) || !ID.test(input.workspaceId)) throw fault('INVALID_ID_CONFIGURATION', 500);
  if (typeof input.workspaceRoot !== 'string' || !path.isAbsolute(input.workspaceRoot) || input.workspaceRoot === '/') throw fault('INVALID_WORKSPACE_ROOT', 500);
  if (typeof input.auditPath !== 'string' || !path.isAbsolute(input.auditPath)) throw fault('INVALID_AUDIT_PATH', 500);
  const root = path.resolve(input.workspaceRoot);
  const auditPath = path.resolve(input.auditPath);
  if (root === '/') throw fault('INVALID_WORKSPACE_ROOT', 500);
  if (auditPath === root || auditPath.startsWith(`${root}/`)) throw fault('AUDIT_MUST_BE_OUTSIDE_WORKSPACE', 500);
  const files = input.readFiles ?? [];
  if (!Array.isArray(files) || files.length > 256 || files.some((file) => !validRelativeFile(file)) || new Set(files).size !== files.length) throw fault('INVALID_READ_ALLOWLIST', 500);
  return Object.freeze({
    actorId: input.actorId, workspaceId: input.workspaceId, workspaceRoot: root, auditPath,
    tokenDigest: hash(input.token), readFiles: new Set(files),
    maxBodyBytes: boundedInteger(input.maxBodyBytes, 8192, 256, 16384, 'BODY_LIMIT'),
    maxOutputBytes: boundedInteger(input.maxOutputBytes, 32768, 16, 65536, 'OUTPUT_LIMIT'),
    maxFileBytes: boundedInteger(input.maxFileBytes, 16384, 1, 32768, 'FILE_LIMIT'),
    maxEntries: boundedInteger(input.maxEntries, 200, 1, 1000, 'ENTRY_LIMIT'),
    maxConcurrency: boundedInteger(input.maxConcurrency, 4, 1, 16, 'CONCURRENCY_LIMIT'),
    executionTimeoutMs: boundedInteger(input.executionTimeoutMs, 3000, 10, 10000, 'EXECUTION_TIMEOUT'),
    bodyTimeoutMs: boundedInteger(input.bodyTimeoutMs, 3000, 10, 10000, 'BODY_TIMEOUT'),
  });
}

// Linux procfs provides dirfd-anchored traversal with built-in Node fs calls.
// Each user-visible component is opened O_NOFOLLOW; open directories remain pinned.
async function openAbsoluteDirectory(absolute) {
  const parts = path.resolve(absolute).split('/').filter(Boolean);
  let current = await fs.open('/', constants.O_RDONLY | DIRECTORY | NOFOLLOW);
  try {
    for (const part of parts) {
      const next = await fs.open(`/proc/self/fd/${current.fd}/${part}`, constants.O_RDONLY | DIRECTORY | NOFOLLOW);
      await current.close();
      current = next;
    }
    return current;
  } catch (error) {
    await current.close();
    throw error;
  }
}

async function openWorkspaceFile(rootHandle, relative) {
  const parts = relative.split('/');
  let directory = rootHandle;
  const owned = [];
  try {
    for (const part of parts.slice(0, -1)) {
      directory = await fs.open(`/proc/self/fd/${directory.fd}/${part}`, constants.O_RDONLY | DIRECTORY | NOFOLLOW);
      owned.push(directory);
    }
    return await fs.open(`/proc/self/fd/${directory.fd}/${parts.at(-1)}`, constants.O_RDONLY | NOFOLLOW | constants.O_NONBLOCK);
  } finally {
    await Promise.all(owned.map((handle) => handle.close()));
  }
}

async function createAudit(auditPath) {
  const directory = await openAbsoluteDirectory(path.dirname(auditPath));
  let handle;
  try {
    const dirStat = await directory.stat();
    if ((dirStat.mode & 0o077) !== 0 || dirStat.uid !== process.getuid()) throw fault('AUDIT_DIRECTORY_MUST_BE_PRIVATE', 500);
    handle = await fs.open(`/proc/self/fd/${directory.fd}/${path.basename(auditPath)}`, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | NOFOLLOW, 0o600);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0) throw fault('UNSAFE_AUDIT_FILE', 500);
    await handle.sync();
    await directory.sync();
  } catch (error) {
    if (handle) await handle.close();
    await directory.close();
    throw error;
  }
  let tail = Promise.resolve();
  let failed = false;
  return {
    get failed() { return failed; },
    append(record) {
      const work = tail.then(async () => {
        if (failed) throw fault('AUDIT_UNAVAILABLE', 503);
        try {
          const stat = await handle.stat();
          const named = await fs.lstat(`/proc/self/fd/${directory.fd}/${path.basename(auditPath)}`);
          if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0 || stat.ino !== named.ino || stat.dev !== named.dev) throw fault('UNSAFE_AUDIT_FILE', 503);
          const bytes = Buffer.from(`${JSON.stringify({ timestamp: new Date().toISOString(), ...record })}\n`);
          let offset = 0;
          while (offset < bytes.length) {
            const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, null);
            if (bytesWritten <= 0) throw fault('AUDIT_SHORT_WRITE', 503);
            offset += bytesWritten;
          }
          await handle.sync();
        } catch {
          failed = true;
          throw fault('AUDIT_UNAVAILABLE', 503);
        }
      });
      tail = work.catch(() => {});
      return work;
    },
    async close() { await tail; await handle.close(); await directory.close(); },
  };
}

async function readBody(req, config) {
  const declared = req.headers['content-length'];
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > config.maxBodyBytes)) throw fault('BODY_TOO_LARGE', 413);
  const chunks = [];
  let total = 0;
  let onData, onEnd, onError, onAborted, timer;
  try {
    const bytes = await new Promise((resolve, reject) => {
      timer = setTimeout(() => { req.pause(); reject(fault('BODY_TIMEOUT', 408)); }, config.bodyTimeoutMs);
      onData = (chunk) => {
        total += chunk.length;
        if (total > config.maxBodyBytes) { req.pause(); reject(fault('BODY_TOO_LARGE', 413)); }
        else chunks.push(chunk);
      };
      onEnd = () => resolve(Buffer.concat(chunks));
      onError = () => reject(fault('INVALID_BODY', 400));
      onAborted = () => reject(fault('INVALID_BODY', 400));
      req.on('data', onData).once('end', onEnd).once('error', onError).once('aborted', onAborted);
    });
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return JSON.parse(text);
  } catch (error) {
    if (error.status) throw error;
    throw fault('INVALID_JSON', 400);
  } finally {
    clearTimeout(timer);
    req.off('data', onData).off('end', onEnd).off('error', onError).off('aborted', onAborted);
  }
}

function validateRequest(body, config) {
  if (!exactKeys(body, TOP_KEYS)) throw fault('INVALID_FIELDS');
  if (!ID.test(body.actorId ?? '') || !ID.test(body.workspaceId ?? '') || typeof body.actorId !== 'string' || typeof body.workspaceId !== 'string') throw fault('INVALID_IDS');
  if (typeof body.requestId !== 'string' || !REQUEST_ID.test(body.requestId)) throw fault('INVALID_REQUEST_ID');
  if (body.actorId !== config.actorId || body.workspaceId !== config.workspaceId) throw fault('WORKSPACE_FORBIDDEN', 403);
  if (!OPERATIONS.has(body.operation)) throw fault(body.operation === 'disposable_log_delete' ? 'DELETE_NOT_IMPLEMENTED_READ_ONLY' : 'OPERATION_NOT_ALLOWED');
  const keys = body.operation === 'workspace_file_read' ? ['path'] : [];
  if (!exactKeys(body.args, keys)) throw fault('INVALID_ARGS');
  if (body.operation === 'workspace_file_read') {
    if (!validRelativeFile(body.args.path)) throw fault('INVALID_PATH');
    if (!config.readFiles.has(body.args.path)) throw fault('FILE_NOT_ALLOWLISTED', 403);
  }
  return body;
}

function metadata(body) {
  if (!plain(body)) return {};
  return {
    ...(typeof body.actorId === 'string' && ID.test(body.actorId) ? { actorId: body.actorId } : {}),
    ...(typeof body.workspaceId === 'string' && ID.test(body.workspaceId) ? { workspaceId: body.workspaceId } : {}),
    ...(typeof body.requestId === 'string' && REQUEST_ID.test(body.requestId) ? { requestId: body.requestId } : {}),
    ...(OPERATIONS.has(body.operation) ? { operation: body.operation } : {}),
    ...(body.operation === 'workspace_file_read' && plain(body.args) && validRelativeFile(body.args.path) ? { targetSha256: hash(body.args.path).toString('hex') } : {}),
  };
}

function result(requestId, started, output = '', error, exitCode = null) {
  return { success: !error, output, ...(error ? { error } : {}), exitCode, duration: Math.round(performance.now() - started), backend: 'linux', requestId };
}

function killGroup(child) {
  if (!child.pid) return;
  try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} }
}

async function runProcess(command, fixedArgs, config, rootHandle, spawnImpl, signal) {
  if (signal.aborted) throw fault('EXECUTION_CANCELLED', 499);
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(command, fixedArgs, {
        shell: false, detached: true, cwd: `/proc/self/fd/${rootHandle.fd}`,
        env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch { reject(fault('EXECUTION_FAILED', 500)); return; }
    let size = 0;
    const output = [];
    let stopped;
    const stop = (code, status) => { if (!stopped) stopped = fault(code, status); killGroup(child); };
    const abort = () => stop('EXECUTION_CANCELLED', 499);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    const timer = setTimeout(() => stop('EXECUTION_TIMEOUT', 504), config.executionTimeoutMs);
    const collect = (chunk) => {
      size += chunk.length;
      if (size > config.maxOutputBytes) stop('OUTPUT_LIMIT_EXCEEDED', 422);
      else if (!stopped) output.push(chunk);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', () => { if (!stopped) stopped = fault('EXECUTION_FAILED', 500); });
    child.once('close', (code) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      // No surviving descendants are allowed after a fixed operation exits.
      killGroup(child);
      if (stopped) { reject(stopped); return; }
      if (code !== 0) { reject(Object.assign(fault('PROCESS_NONZERO_EXIT', 422), { exitCode: code })); return; }
      resolve({ output: Buffer.concat(output).toString('utf8'), exitCode: code });
    });
  });
}

async function executeRead(request, config, rootHandle, spawnImpl, signal) {
  if (request.operation === 'identity') return runProcess('/usr/bin/id', [], config, rootHandle, spawnImpl, signal);
  if (request.operation === 'system_info') return runProcess('/usr/bin/uname', ['-a'], config, rootHandle, spawnImpl, signal);
  if (signal.aborted) throw fault('EXECUTION_CANCELLED', 499);
  const deadline = performance.now() + config.executionTimeoutMs;
  const check = () => { if (signal.aborted) throw fault('EXECUTION_CANCELLED', 499); if (performance.now() >= deadline) throw fault('EXECUTION_TIMEOUT', 504); };
  if (request.operation === 'workspace_list') {
    const entries = [];
    const directory = await fs.opendir(`/proc/self/fd/${rootHandle.fd}`);
    let scanned = 0;
    try {
      for await (const entry of directory) {
        check();
        if (++scanned > config.maxEntries) throw fault('DIRECTORY_ENTRY_LIMIT_EXCEEDED', 422);
        if (!SEGMENT.test(entry.name) || SECRET_NAME.test(entry.name)) continue;
        entries.push({ name: entry.name, type: entry.isFile() ? 'file' : entry.isDirectory() ? 'directory' : entry.isSymbolicLink() ? 'symlink' : 'other' });
      }
    } catch (error) { throw error; }
    check();
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    const output = JSON.stringify(entries, null, 2);
    if (Buffer.byteLength(output) > config.maxOutputBytes) throw fault('OUTPUT_LIMIT_EXCEEDED', 422);
    return { output, exitCode: 0 };
  }
  let handle;
  try {
    handle = await openWorkspaceFile(rootHandle, request.args.path);
    check();
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1) throw fault('UNSAFE_FILE', 403);
    const limit = Math.min(config.maxFileBytes, config.maxOutputBytes);
    if (stat.size > limit) throw fault('FILE_LIMIT_EXCEEDED', 422);
    const bytes = Buffer.alloc(limit + 1);
    let total = 0;
    while (total < bytes.length) {
      check();
      const { bytesRead } = await handle.read(bytes, total, bytes.length - total, null);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    check();
    if (total > limit) throw fault('FILE_LIMIT_EXCEEDED', 422);
    const content = bytes.subarray(0, total);
    if (content.includes(0)) throw fault('TEXT_FILES_ONLY', 422);
    let output;
    try { output = new TextDecoder('utf-8', { fatal: true }).decode(content); } catch { throw fault('TEXT_FILES_ONLY', 422); }
    return { output, exitCode: 0 };
  } catch (error) {
    if (error.status) throw error;
    if (error.code === 'ENOENT') throw fault('FILE_NOT_FOUND', 404);
    throw fault('UNSAFE_OR_UNREADABLE_FILE', 403);
  } finally { if (handle) await handle.close(); }
}

function send(res, status, payload, close = false) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(close ? { Connection: 'close' } : {}) });
  res.end(JSON.stringify(payload));
}

// dependencies are code-only test seams, never accepted from HTTP or environment.
export async function createRunner(input, dependencies = {}) {
  if ((dependencies.getuid ?? process.getuid)() === 0) throw fault('ROOT_EXECUTION_REFUSED', 500);
  const config = validateConfig(input);
  const rootHandle = await openAbsoluteDirectory(config.workspaceRoot);
  let audit;
  try { audit = await (dependencies.createAudit ?? createAudit)(config.auditPath); } catch (error) { await rootHandle.close(); throw error; }
  const spawnImpl = dependencies.spawn ?? nodeSpawn;
  let active = 0;
  let pending = 0;
  let poisoned = false;
  let closing = false;
  let inFlight = 0;
  let closePromise;
  const controllers = new Set();
  const append = async (record) => {
    try { await audit.append(record); } catch {
      poisoned = true;
      for (const controller of controllers) controller.abort();
      throw fault('AUDIT_UNAVAILABLE', 503);
    }
  };
  const server = http.createServer({ maxHeaderSize: 8192 }, async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      send(res, poisoned || closing ? 503 : 200, { status: poisoned || closing ? 'unavailable' : 'ok', backend: 'linux' });
      return;
    }
    if (req.method !== 'POST' || req.url !== '/execute') { send(res, 404, { error: 'NOT_FOUND', backend: 'linux' }, true); return; }
    const started = performance.now();
    const dispatchId = randomUUID();
    inFlight += 1;
    let body;
    let requestId = null;
    let dispatched = false;
    let admitted = false;
    let slot = false;
    let authenticated = false;
    const controller = new AbortController();
    const disconnected = () => { if (!res.writableEnded) controller.abort(); };
    res.once('close', disconnected);
    let status = 200;
    let response;
    try {
      if (poisoned || closing) throw fault('AUDIT_UNAVAILABLE', 503);
      // Bound work queued behind fsync and body reads, separately from processes.
      if (pending >= config.maxConcurrency + 8) throw fault('REQUEST_CAPACITY_EXCEEDED', 429);
      pending += 1;
      admitted = true;
      const authorizationCount = req.rawHeaders.filter((_, index) => index % 2 === 0 && req.rawHeaders[index].toLowerCase() === 'authorization').length;
      const auth = req.headers.authorization;
      if (authorizationCount !== 1 || typeof auth !== 'string' || !auth.startsWith('Bearer ') || !timingSafeEqual(hash(auth.slice(7)), config.tokenDigest)) throw fault('UNAUTHORIZED', 401);
      authenticated = true;
      if (req.headers.expect !== undefined) throw fault('EXPECT_NOT_SUPPORTED', 417);
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '')) throw fault('CONTENT_TYPE_REQUIRED', 415);
      if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') throw fault('CONTENT_ENCODING_NOT_ALLOWED', 415);
      body = await readBody(req, config);
      const meta = metadata(body);
      requestId = meta.requestId ?? null;
      await append({ event: 'dispatch', dispatchId, ...meta, authenticated });
      dispatched = true;
      if (poisoned || closing) throw fault('AUDIT_UNAVAILABLE', 503);
      const request = validateRequest(body, config);
      if (active >= config.maxConcurrency) throw fault('CONCURRENCY_LIMIT_EXCEEDED', 429);
      active += 1;
      slot = true;
      controllers.add(controller);
      const executed = await executeRead(request, config, rootHandle, spawnImpl, controller.signal);
      response = result(requestId, started, executed.output, undefined, executed.exitCode);
    } catch (error) {
      status = error.status ?? 500;
      response = result(requestId, started, '', error.status ? error.code : 'INTERNAL_ERROR', error.exitCode ?? null);
    }
    try {
      if (!dispatched && !poisoned) {
        await append({ event: 'dispatch', dispatchId, ...metadata(body), authenticated, admitted });
      }
      if (!poisoned) await append({ event: 'terminal', dispatchId, ...metadata(body), success: response.success, httpStatus: status, error: response.error ?? null, exitCode: response.exitCode, duration: response.duration, outputBytes: Buffer.byteLength(response.output) });
      else throw fault('AUDIT_UNAVAILABLE', 503);
    } catch {
      status = 503;
      response = result(requestId, started, '', 'AUDIT_UNAVAILABLE');
    } finally {
      if (slot) active -= 1;
      controllers.delete(controller);
      if (admitted) pending -= 1;
      res.off('close', disconnected);
      inFlight -= 1;
    }
    send(res, status, response, status !== 200);
  });
  server.maxConnections = 32;
  server.requestTimeout = 10000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 2000;
  server.maxRequestsPerSocket = 100;
  server.on('checkContinue', (req, res) => { server.emit('request', req, res); });
  server.on('checkExpectation', (req, res) => { server.emit('request', req, res); });
  server.on('clientError', (_error, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); });
  return {
    server,
    close() {
      closePromise ??= (async () => {
        closing = true;
        for (const controller of controllers) controller.abort();
        await new Promise((resolve) => { server.close(resolve); server.closeIdleConnections(); server.closeAllConnections(); });
        // Request handlers retain ownership of their final audit until drained.
        while (inFlight > 0) await new Promise((resolve) => setTimeout(resolve, 10));
        await audit.close();
        await rootHandle.close();
      })();
      return closePromise;
    },
  };
}

export function configFromEnvironment(env = process.env) {
  let readFiles;
  try { readFiles = JSON.parse(env.RUNNER_READ_FILES_JSON ?? '[]'); } catch { throw fault('INVALID_READ_ALLOWLIST', 500); }
  return { token: env.RUNNER_TOKEN, actorId: env.RUNNER_ACTOR_ID, workspaceId: env.RUNNER_WORKSPACE_ID, workspaceRoot: env.RUNNER_WORKSPACE_ROOT, auditPath: env.RUNNER_AUDIT_PATH, readFiles };
}

async function main() {
  const port = Number(process.env.RUNNER_PORT ?? '8788');
  const host = process.env.RUNNER_HOST ?? '127.0.0.1';
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !['127.0.0.1', '0.0.0.0', '::1'].includes(host)) throw fault('INVALID_LISTEN_CONFIGURATION', 500);
  const runner = await createRunner(configFromEnvironment());
  runner.server.listen(port, host, () => console.log('Linux read-only runner listening.'));
  runner.server.on('error', () => { console.error('Runner listen failed.'); process.exitCode = 1; void runner.close().catch(() => {}); });
  let stopping = false;
  for (const name of ['SIGTERM', 'SIGINT']) process.on(name, () => { if (!stopping) { stopping = true; void runner.close().catch(() => { process.exitCode = 1; }); } });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(`Runner startup refused: ${error.status ? error.code : 'UNSAFE_OR_UNAVAILABLE_CONFIGURATION'}`); process.exitCode = 1; });
}
