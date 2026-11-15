import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateCProject, canonicalCProject, C_PROJECT_LIMITS, CProjectValidationError } from '../app/lib/coding/c-project';
import type { CProject } from '../app/lib/coding/c-project';
export { validateCProject } from '../app/lib/coding/c-project';
export type { CProject } from '../app/lib/coding/c-project';

/**
 * Trusted desktop configuration ONLY. Never populate these fields from a tool call,
 * a project, model output, HTTP parameters, Docker contexts, or environment variables.
 * Image must be preloaded by the operator; this adapter never pulls/builds an image.
 * Image contract: Linux, no VOLUME declarations, trusted /bin/{sh,sleep,tar,chmod,cat},
 * /usr/bin/{env,timeout}, and gcc at /usr/bin/gcc or /usr/local/bin/gcc (or clang).
 *
 * Docker containers share a kernel, not a VM security boundary. Keep the engine,
 * kernel, image and compiler patched. C17 checks are a conservative policy, not an
 * ISO-conformance proof or a defense against a compiler/kernel vulnerability.
 *
 * Docker references underpinning this design:
 * https://docs.docker.com/reference/cli/docker/container/cp/ (tmpfs/rootfs caveats)
 * https://docs.docker.com/reference/cli/docker/container/exec/ (real exec exit status)
 * https://docs.docker.com/reference/cli/docker/container/wait/
 * https://docs.docker.com/engine/security/seccomp/ (builtin profile, never unconfined)
 */
export interface CCompilerConfig {
  image: string;
  dockerPath?: string;
  dockerHost?: string;
  /** Absolute, trusted host directories; source files are NOT written here. */
  workspace?: string;
  auditFile: string;
}
export type CErrorCode = 'INVALID_PROJECT' | 'CONFIG' | 'UNAVAILABLE' | 'INSECURE_ENGINE' |
  'IMAGE_UNAVAILABLE' | 'BUSY' | 'CLOSED' | 'ABORTED' | 'TIMEOUT' | 'OUTPUT_LIMIT' |
  'BACKEND_ERROR' | 'AUDIT_ERROR' | 'CLEANUP_FAILED';
export class CCompilerError extends Error {
  stdout = '';
  stderr = '';
  constructor(public readonly code: CErrorCode, message: string) { super(message); this.name = 'CCompilerError'; }
}
export interface CPhaseReceipt {
  phase: 'compile' | 'run';
  stdout: string;
  stderr: string;
  /** Null means infrastructure/cancellation prevented a reliable program exit. */
  exitCode: number | null;
  duration: number;
  status: 'completed' | 'failed' | 'aborted' | 'timeout' | 'output_limit' | 'backend_error';
  /** compile: Docker CLI exec status; run: matching Docker wait + inspect status. */
  evidence: 'docker-exec' | 'docker-wait-inspect' | 'none';
  oomKilled?: boolean;
}
export interface CExecutionReceipt {
  requestId: string;
  sourceHash: string;
  backend: 'docker-cli';
  image: string;
  success: boolean;
  status: 'completed' | 'compile_failed' | 'error';
  phase: 'validate' | 'prepare' | 'compile' | 'run' | 'cleanup';
  stdout: string;
  stderr: string;
  exitCode: number | null;
  duration: number;
  compile?: CPhaseReceipt;
  run?: CPhaseReceipt;
  error?: { code: CErrorCode; message: string };
  cleanup: { ok: boolean; remainingContainerIds: string[] };
  audit: { recorded: boolean; file: string };
  warnings: readonly string[];
}
export interface CCompilerInfo {
  available: boolean;
  backend: 'docker-cli';
  image: string;
  dockerHost: string;
  engine?: { version: string; osType: 'linux'; cgroupVersion: string; securityOptions: string[] };
  limits: typeof C_LIMITS;
  warnings: readonly string[];
  error?: { code: CErrorCode; message: string };
}
export interface CCompiler {
  info(): Promise<CCompilerInfo>;
  execute(project: CProject, options: { signal?: AbortSignal; requestId: string }): Promise<CExecutionReceipt>;
  close(): Promise<void>;
}
export const C_LIMITS = Object.freeze({ files: 32, sourceBytes: 256 * 1024, stdinBytes: C_PROJECT_LIMITS.maxStdinBytes,
  outputBytes: 65536, artifactBytes: 8 * 1024 * 1024, compileMs: 25000, runMs: 8000,
  jobMs: 65000, commandMs: 10000, cleanupMs: 5000, pids: 64, compileMemory: '512m', runMemory: '256m' });
const WARNINGS = Object.freeze([
  'Containers share the Docker engine kernel; this is not a VM boundary.',
  'C17 flags and lexical checks are conservative policy, not an absolute ISO C proof.',
  'Program stdout/stderr are untrusted data and never determine successful execution.',
]);
const LABEL = 'io.bolt.c-runner.scope';
const COMPILER_SCRIPT = 'for cc in /usr/bin/gcc /usr/local/bin/gcc /usr/bin/clang /usr/local/bin/clang; do if [ -x "$cc" ]; then exec /usr/bin/timeout --signal=KILL 20s "$cc" -x c -std=c17 -pedantic-errors -Wall -Wextra -Werror=implicit-function-declaration -Werror=implicit-int -fno-diagnostics-color -I/input -o /work/program "$@" -lm; fi; done; exit 127';
// All shell text is server-owned. Project strings are separate argv or archive bytes.
const INGEST_SCRIPT = 'set -eu; /bin/tar -xf - -C /input; /bin/chmod -R a-w /input';
const RUNTIME_INGEST_SCRIPT = 'set -eu; /bin/tar -xf - -C /work; /bin/chmod 0555 /work/program; /bin/chmod 0444 /work/stdin; /bin/chmod 0555 /work; : > /input/ready; /bin/chmod 0444 /input/ready; /bin/chmod 0555 /input';
const RUNTIME_SCRIPT = 'set -eu; while [ ! -f /input/ready ]; do /bin/sleep 0.05; done; /bin/sleep 0.05; exec /usr/bin/env -i PATH=/usr/bin:/bin LC_ALL=C HOME=/nonexistent TMPDIR=/tmp /usr/bin/timeout --signal=KILL 5s /work/program < /work/stdin';

function fail(code: CErrorCode, message: string): never { throw new CCompilerError(code, message); }
function normalizedError(error: unknown): CCompilerError {
  if (error instanceof CProjectValidationError) return new CCompilerError('INVALID_PROJECT', error.message);
  return error instanceof CCompilerError ? error : new CCompilerError('BACKEND_ERROR', 'Docker backend failed; inspect the operator-controlled engine.');
}
function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
interface ValidatedCProject { files: Readonly<Record<string, string>>; sources: readonly string[]; stdin: string; sourceHash: string; sourceBytes: number }
function prepareProject(input: unknown): ValidatedCProject {
  const project = validateCProject(input);
  const names = Object.keys(project.files).sort();
  return Object.freeze({ files: Object.freeze(project.files), sources: Object.freeze(names.filter((name) => name.endsWith('.c'))),
    stdin: project.stdin ?? '', sourceHash: createHash('sha256').update(canonicalCProject(project), 'utf8').digest('hex'),
    sourceBytes: names.reduce((total, name) => total + Buffer.byteLength(project.files[name], 'utf8'), 0) });
}

/** Fixed USTAR writer; generated POSIX path-only PAX for long names. No links or caller metadata. */
function archive(entries: { name: string; data: Buffer; executable?: boolean }[]): Buffer {
  const chunks: Buffer[] = [], directories = new Set<string>();
  function entry(name: string, data: Buffer, directory: boolean, executable = false, pax = false) {
    if (!/^[A-Za-z0-9_][A-Za-z0-9_.\/-]*$/.test(name) || name.split('/').some((part) => part === '..' || part === '.') || Buffer.byteLength(name) > 240) fail('BACKEND_ERROR', 'Unsafe internal archive entry.');
    const header = Buffer.alloc(512);
    let basename = name, prefix = '';
    if (name.length > 100) {
      const boundary = name.lastIndexOf('/', Math.min(155, name.length - 2));
      if (boundary < 1 || name.length - boundary - 1 > 100) {
        // POSIX PAX supports the shared policy's 240-character paths without truncation.
        // Only one internally generated 'path' key, never uid/link/sparse/vendor entries.
        const body = ` path=${name}\n`;
        let length = Buffer.byteLength(body) + 1;
        while (length !== Buffer.byteLength(body) + String(length).length) length = Buffer.byteLength(body) + String(length).length;
        entry('BoltPaxPath', Buffer.from(String(length) + body), false, false, true);
        basename = 'BoltLongPath';
      } else { prefix = name.slice(0, boundary); basename = name.slice(boundary + 1); }
    }
    header.write(basename, 0, 100, 'ascii');
    header.write(prefix, 345, 155, 'ascii');
    const octal = (offset: number, width: number, n: number) => header.write(n.toString(8).padStart(width - 1, '0') + '\0', offset, width, 'ascii');
    octal(100, 8, directory ? 0o755 : executable ? 0o555 : 0o444);
    octal(108, 8, 0); octal(116, 8, 0); octal(124, 12, data.length); octal(136, 12, 0);
    header.fill(0x20, 148, 156); header[156] = pax ? 0x78 : directory ? 0x35 : 0x30;
    header.write('ustar\0', 257, 6, 'ascii'); header.write('00', 263, 2, 'ascii');
    const sum = header.reduce((a, b) => a + b, 0);
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
    chunks.push(header, data);
    if (data.length % 512) chunks.push(Buffer.alloc(512 - data.length % 512));
  }
  for (const item of entries) {
    const parts = item.name.split('/');
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      if (!directories.has(dir)) { directories.add(dir); entry(dir + '/', Buffer.alloc(0), true); }
    }
    entry(item.name, item.data, false, item.executable);
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}
export function encodeCProjectTar(project: unknown): Buffer {
  const validated = prepareProject(project);
  return archive(Object.keys(validated.files).map((name) => ({ name, data: Buffer.from(validated.files[name]) })));
}

/** Exported for configuration tests; no TCP, ssh, context names, Windows remote pipe, URI escapes, or queries. */
export function validateDockerHost(host: unknown, platform = process.platform): string {
  if (typeof host !== 'string') fail('CONFIG', 'Docker host must be an explicit local endpoint.');
  if (platform === 'win32') {
    if (!/^npipe:\/\/\/\/\.\/pipe\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(host)) fail('CONFIG', 'Only a local Windows Docker named pipe is allowed.');
  } else {
    if (!/^unix:\/\/\/[A-Za-z0-9_./-]+$/.test(host) || host.slice(8).split('/').some((s) => s === '.' || s === '..' || s === ''))
      fail('CONFIG', 'Only an absolute local Unix Docker socket is allowed.');
  }
  return host;
}
/** Compare repository AND digest; normalize only Docker Hub's documented shorthand. */
export function canonicalDockerImage(reference: string): string {
  const [repository, digest] = reference.split('@');
  if (!repository || !/^sha256:[a-f0-9]{64}$/.test(digest ?? '') || reference.split('@').length !== 2) fail('CONFIG', 'Invalid digest image reference.');
  let parts = repository.split('/');
  const first = parts[0];
  if (parts.length === 1 || (!first.includes('.') && !first.includes(':') && first !== 'localhost')) parts.unshift('docker.io');
  if (parts[0] === 'index.docker.io') parts[0] = 'docker.io';
  if (parts[0] === 'docker.io' && parts.length === 2) parts.splice(1, 0, 'library');
  return parts.join('/') + '@' + digest;
}
function validateConfig(config: CCompilerConfig) {
  if (!isRecord(config) || typeof config.image !== 'string' ||
    !/^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$/.test(config.image) || config.image.includes('..') || config.image.length > 256)
    fail('CONFIG', 'A trusted Docker image pinned by a full sha256 digest is mandatory.');
  const defaultWorkspace = !config.workspace;
  const workspace = config.workspace ?? path.join(os.tmpdir(), 'bolt-c-sandbox');
  config = { ...config, workspace };
  for (const field of ['workspace', 'auditFile'] as const) {
    if (typeof config[field] !== 'string' || !path.isAbsolute(config[field]) || config[field].includes('\0')) fail('CONFIG', `Trusted absolute ${field} is required.`);
  }
  const dockerHost = validateDockerHost(config.dockerHost ?? (process.platform === 'win32' ? 'npipe:////./pipe/docker_engine' : 'unix:///var/run/docker.sock'));
  const dockerPath = config.dockerPath ?? (process.platform === 'win32' ? 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe' : process.platform === 'darwin' ? '/usr/local/bin/docker' : '/usr/bin/docker');
  if (typeof dockerPath !== 'string' || !path.isAbsolute(dockerPath) || dockerPath.includes('\0') || /\.(?:bat|cmd|ps1)$/i.test(dockerPath)) fail('CONFIG', 'Docker CLI must be a trusted absolute native executable path.');
  return Object.freeze({ ...config, workspace, dockerHost, dockerPath, defaultWorkspace });
}
// Bound the UTF-8 representation as well as wire bytes (binary output may decode to U+FFFD).
function outputText(bytes: Buffer): string {
  const text = bytes.toString('utf8');
  if (Buffer.byteLength(text) <= bytes.length) return text;
  const capped = Buffer.from(text).subarray(0, bytes.length);
  return new TextDecoder('utf-8').decode(capped, { stream: true });
}
interface CommandResult { code: number | null; stdout: Buffer; stderr: Buffer }
interface Budget { used: number; max: number }
interface OwnedContainer { id?: string; name: string; verified: boolean }

export function createCCompiler(configuration: CCompilerConfig): CCompiler {
  const config = validateConfig(configuration);
  const scope = randomBytes(16).toString('hex');
  const containers = new Set<OwnedContainer>();
  let closed = false, poisoned = false, active: { controller: AbortController; done: Promise<void> } | undefined;
  let checking: Promise<CCompilerInfo> | undefined;
  let checkingController: AbortController | undefined;
  let currentRequestId: string | undefined;
  // Do not inherit DOCKER_*, proxy variables, credentials, contexts, or plugin paths.
  const environment: NodeJS.ProcessEnv = process.platform === 'win32'
    ? { SystemRoot: process.env.SystemRoot || 'C:\\Windows', WINDIR: process.env.SystemRoot || 'C:\\Windows', PATH: 'C:\\Windows\\System32', LANG: 'C', LC_ALL: 'C' }
    : { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' };
  let hostWorkspace = config.workspace;
  let dockerConfig = path.join(hostWorkspace, `.c-docker-${scope}`);
  let hostReady = false;
  let verifiedZeroSwap = false;
  async function ensureHost() {
    if (hostReady) return;
    // macOS /var and /tmp are OS-owned aliases. Canonicalize ONLY the default temp root.
    if (config.defaultWorkspace) { hostWorkspace = path.join(await realpath(os.tmpdir()), 'bolt-c-sandbox'); dockerConfig = path.join(hostWorkspace, `.c-docker-${scope}`); }
    await mkdir(hostWorkspace, { recursive: true, mode: 0o700 });
    await assertHostDirectory(hostWorkspace);
    await mkdir(dockerConfig, { recursive: true, mode: 0o700 });
    await assertHostDirectory(dockerConfig);
    if (process.platform !== 'win32') {
      const socketPath = config.dockerHost.slice(7);
      if (!(await lstat(socketPath)).isSocket()) fail('UNAVAILABLE', 'Configured Docker endpoint is not a local socket.');
    }
    const executable = await realpath(config.dockerPath);
    const stat = await lstat(executable);
    if (!stat.isFile()) fail('UNAVAILABLE', 'Configured Docker CLI is unavailable.');
    hostReady = true;
  }
  function command(args: string[], options: { signal?: AbortSignal; timeout?: number; input?: Buffer; budget?: Budget; max?: number } = {}): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      if (options.signal?.aborted) return reject(new CCompilerError('ABORTED', 'C execution was cancelled.'));
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(config.dockerPath, ['--config', dockerConfig, '--host', config.dockerHost, ...args], {
          cwd: hostWorkspace, shell: false, windowsHide: true, env: environment, stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch { return reject(new CCompilerError('UNAVAILABLE', 'Docker CLI could not be started.')); }
      const out: Buffer[] = [], err: Buffer[] = [];
      let bytes = 0, stop: CCompilerError | undefined;
      const stopWith = (error: CCompilerError) => { if (!stop) { stop = error; child.kill('SIGKILL'); } };
      const abort = () => stopWith(new CCompilerError('ABORTED', 'C execution was cancelled.'));
      options.signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => stopWith(new CCompilerError('TIMEOUT', 'Docker command exceeded its deadline.')), options.timeout ?? C_LIMITS.commandMs);
      const collect = (target: Buffer[], chunk: Buffer) => {
        bytes += chunk.length;
        if (options.budget) options.budget.used += chunk.length;
        if (bytes > (options.max ?? C_LIMITS.outputBytes) || (options.budget && options.budget.used > options.budget.max)) {
          const remaining = Math.max(0, Math.min((options.max ?? C_LIMITS.outputBytes) - (bytes - chunk.length), options.budget ? options.budget.max - (options.budget.used - chunk.length) : chunk.length));
          if (remaining) target.push(chunk.subarray(0, remaining));
          stopWith(new CCompilerError('OUTPUT_LIMIT', 'Combined program output exceeded its configured bound.')); return;
        }
        target.push(chunk);
      };
      child.stdout.on('data', (b: Buffer) => collect(out, b)); child.stderr.on('data', (b: Buffer) => collect(err, b));
      // EPIPE is handled by the authoritative process close/error, not an uncaught stream error.
      child.stdin.on('error', () => {});
      child.on('error', () => { stop = stop ?? new CCompilerError('UNAVAILABLE', 'Docker CLI could not be started.'); });
      child.on('close', (code) => {
        clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
        if (stop) { if (options.budget) { stop.stdout = outputText(Buffer.concat(out)); stop.stderr = outputText(Buffer.concat(err)); } reject(stop); } else resolve({ code, stdout: Buffer.concat(out), stderr: Buffer.concat(err) });
      });
      child.stdin.end(options.input);
    });
  }
  const checked = async (args: string[], options: Parameters<typeof command>[1] = {}) => {
    const result = await command(args, options);
    if (result.code !== 0) fail('BACKEND_ERROR', `Docker ${args[0]}/${args[1] ?? ''} failed (exit ${result.code}): ${outputText(result.stderr).replace(/[\r\n]+/g, ' ').slice(0, 600)}`);
    return result;
  };
  async function inspect(container: OwnedContainer, signal?: AbortSignal) {
    const result = await checked(['container', 'inspect', container.id ?? container.name, '--format', '{{json .}}'], { signal });
    let value: any;
    try { value = JSON.parse(result.stdout.toString('utf8')); } catch { fail('BACKEND_ERROR', 'Invalid Docker inspect response.'); }
    if (!/^[a-f0-9]{64}$/.test(value.Id) || value.Config?.Labels?.[LABEL] !== scope ||
      value.Name !== '/' + container.name || (container.id && value.Id !== container.id)) fail('BACKEND_ERROR', 'Container ownership verification failed.');
    container.id = value.Id; container.verified = true;
    return value;
  }
  async function remove(container: OwnedContainer) {
    // Recovery after create transport loss uses unpredictable name, then immutable ID and scope label.
    if (!container.verified) await inspect(container);
    const result = await command(['container', 'rm', '--force', container.id!], { timeout: C_LIMITS.cleanupMs });
    if (result.code !== 0) fail('CLEANUP_FAILED', 'Owned Docker container could not be removed.');
    containers.delete(container);
    await audit({ phase: 'container-removed', containerId: container.id, requestId: currentRequestId });
  }
  async function audit(event: Record<string, unknown>) {
    try {
      await mkdir(path.dirname(config.auditFile), { recursive: true, mode: 0o700 });
      await assertHostDirectory(path.dirname(config.auditFile));
      // lstat + O_NOFOLLOW prevents a final-component symlink; ancestors are checked too.
      try { const stat = await lstat(config.auditFile); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) fail('AUDIT_ERROR', 'Audit target must be a single-link regular file.'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const handle = await open(config.auditFile, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0), 0o600);
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.nlink !== 1) fail('AUDIT_ERROR', 'Unsafe audit file.');
        if (process.platform !== 'win32') await handle.chmod(0o600);
        await handle.writeFile(JSON.stringify({ at: new Date().toISOString(), actor: 'c-runner', scope, ...event }) + '\n');
        await handle.sync();
      } finally { await handle.close(); }
    } catch { fail('AUDIT_ERROR', 'C execution audit could not be durably recorded.'); }
  }
  async function preflight(signal?: AbortSignal): Promise<CCompilerInfo> {
    verifiedZeroSwap = false;
    await ensureHost().catch((error) => { if (error instanceof CCompilerError) throw error; fail('UNAVAILABLE', 'Trusted local Docker executable/socket is unavailable.'); });
    const result = await checked(['info', '--format', '{{json .}}'], { signal });
    let engine: any;
    try { engine = JSON.parse(result.stdout.toString('utf8')); } catch { fail('INSECURE_ENGINE', 'Invalid Docker engine information.'); }
    if (engine.OSType !== 'linux' || !['1', '2'].includes(String(engine.CgroupVersion)) ||
      !['cgroupfs', 'systemd'].includes(engine.CgroupDriver) ||
      !['MemoryLimit', 'CpuCfsQuota', 'PidsLimit'].every((key) => engine[key] === true) ||
      !Array.isArray(engine.SecurityOptions) || !engine.SecurityOptions.some((s: unknown) => typeof s === 'string' && /^name=seccomp,profile=(builtin|default)$/.test(s)))
      fail('INSECURE_ENGINE', 'Linux cgroups, memory/swap/CPU/PID enforcement and builtin seccomp are required; unsupported engine limit flags fail closed.');
    const imageResult = await checked(['image', 'inspect', config.image, '--format', '{{json .}}'], { signal }).catch(() => fail('IMAGE_UNAVAILABLE', 'The pinned trusted image must already be installed locally.'));
    let image: any;
    try { image = JSON.parse(imageResult.stdout.toString('utf8')); } catch { fail('IMAGE_UNAVAILABLE', 'Invalid image metadata.'); }
    if (image.Os !== 'linux' || !Array.isArray(image.RepoDigests) || !image.RepoDigests.some((ref: unknown) => typeof ref === 'string' && canonicalDockerImage(ref) === canonicalDockerImage(config.image)) ||
      (image.Config?.Volumes && Object.keys(image.Config.Volumes).length) || !/^sha256:[a-f0-9]{64}$/.test(image.Id))
      fail('IMAGE_UNAVAILABLE', 'Pinned Linux image identity must match and image VOLUME declarations are prohibited.');
    const warnings = [...WARNINGS];
    if (engine.SwapLimit !== true) {
      // Some VM kernels have no swap controller AND no swap. Never infer VM swap
      // from the desktop host; prove zero inside this trusted digest-pinned image.
      const controller = new AbortController();
      const relay = () => controller.abort();
      signal?.addEventListener('abort', relay, { once: true });
      if (signal?.aborted) controller.abort();
      const deadline = setTimeout(relay, 20000);
      let probe: OwnedContainer | undefined;
      try {
        probe = await create('compile', controller.signal, true);
        const swaps = await checked(['container', 'exec', '--user', '65534:65534', probe.id!, '/bin/cat', '/proc/swaps'], { signal: controller.signal, max: 8192 });
        const meminfo = await checked(['container', 'exec', '--user', '65534:65534', probe.id!, '/bin/cat', '/proc/meminfo'], { signal: controller.signal, max: 16384 });
        const lines = swaps.stdout.toString('ascii').trim().split(/\r?\n/);
        const swapTotals = meminfo.stdout.toString('ascii').split(/\r?\n/).filter((line) => /^SwapTotal:/.test(line));
        if (swaps.stderr.length || meminfo.stderr.length || lines.length !== 1 ||
          !/^Filename\s+Type\s+Size\s+Used\s+Priority\s*$/.test(lines[0]) || swapTotals.length !== 1 ||
          !/^SwapTotal:\s+0\s+kB\s*$/.test(swapTotals[0]))
          fail('INSECURE_ENGINE', 'Swap controller unavailable and zero engine-kernel swap could not be proven.');
        verifiedZeroSwap = true;
        await audit({ phase: 'engine-zero-swap-proven', requestId: currentRequestId, containerId: probe.id, swapTotalKiB: 0, swapDevices: 0 });
        warnings.push('Swap-limit controller unavailable; engine kernel verified zero swap for this preflight. Do not enable swap while jobs run.');
      } finally {
        clearTimeout(deadline); signal?.removeEventListener('abort', relay);
        const pending = probe ? [probe] : [...containers];
        const cleaned = await Promise.allSettled(pending.map(remove));
        if (cleaned.some((result) => result.status === 'rejected')) { poisoned = true; fail('CLEANUP_FAILED', 'Trusted swap probe cleanup failed.'); }
      }
    }
    return { available: true, backend: 'docker-cli', image: config.image, dockerHost: config.dockerHost,
      engine: { version: String(engine.ServerVersion), osType: 'linux', cgroupVersion: String(engine.CgroupVersion), securityOptions: [...engine.SecurityOptions] }, limits: C_LIMITS, warnings };
  }
  async function create(kind: 'compile' | 'run', signal: AbortSignal, trustedZeroSwapProbe = false) {
    const container: OwnedContainer = { name: `bolt-c17-${scope}-${kind}-${randomBytes(12).toString('hex')}`, verified: false };
    const memory = kind === 'compile' ? C_LIMITS.compileMemory : C_LIMITS.runMemory;
    const script = kind === 'compile' ? 'exec /usr/bin/env -i PATH=/usr/bin:/bin LC_ALL=C /bin/sleep 90' : RUNTIME_SCRIPT;
    containers.add(container);
    const args = ['container', 'create', '--pull', 'never', '--name', container.name, '--label', `${LABEL}=${scope}`,
      '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--user', '65534:65534', '--pids-limit', '64', '--memory', memory, '--memory-swap', memory, '--cpus', '1',
      '--cgroupns', 'private', '--ipc', 'private', '--no-healthcheck', '--restart', 'no',
      '--ulimit', 'core=0:0', '--ulimit', `cpu=${kind === 'compile' ? 20 : 5}:${kind === 'compile' ? 21 : 6}`,
      '--ulimit', 'fsize=8388608:8388608', '--ulimit', 'nofile=128:128', '--ulimit', 'stack=8388608:8388608',
      '--log-driver', 'local', '--log-opt', 'max-size=128k', '--log-opt', 'max-file=1', '--log-opt', 'compress=false',
      '--tmpfs', '/input:rw,noexec,nosuid,nodev,size=1m,mode=0755,uid=0,gid=0',
      '--tmpfs', `/work:rw,exec,nosuid,nodev,size=${kind === 'compile' ? '64m' : '16m'},mode=${kind === 'compile' ? '1777' : '0755'},uid=0,gid=0`,
      '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=16m,mode=0700,uid=65534,gid=65534',
      '--workdir', '/work', '--entrypoint', '/usr/bin/env', config.image,
      '-i', 'PATH=/usr/bin:/bin', 'LC_ALL=C', 'HOME=/nonexistent', 'TMPDIR=/tmp', '/bin/sh', '-c', script];
    let result: CommandResult;
    try {
      if (signal.aborted) fail('ABORTED', 'C execution was cancelled before container creation.');
      // Creation must finish with an exact owned ID before cancellation propagates. Killing the CLI does not cancel daemon creation.
      result = await command(args, { timeout: C_LIMITS.commandMs });
      if (result.code !== 0) { containers.delete(container); fail('BACKEND_ERROR', 'Docker create failed.'); }
    }
    catch (error) {
      // A create command returning a known failure cannot have yielded a usable ID;
      // uncertain create outcomes remain tracked and must be recovered by exact name.
      throw error;
    }
    const id = result.stdout.toString('utf8').trim();
    if (!/^[a-f0-9]{64}$/.test(id)) fail('BACKEND_ERROR', 'Docker create did not return a full container ID.');
    container.id = id;
    const metadata = await inspect(container, signal);
    const hc = metadata.HostConfig;
    if (metadata.Config.User !== '65534:65534' || hc.Privileged || hc.NetworkMode !== 'none' || !hc.ReadonlyRootfs ||
      !Array.isArray(hc.CapDrop) || !hc.CapDrop.some((c: string) => c.toUpperCase() === 'ALL') ||
      hc.CapAdd?.length || !hc.SecurityOpt?.some((s: string) => s === 'no-new-privileges' || s === 'no-new-privileges=true') ||
      hc.SecurityOpt?.some((s: string) => /unconfined|seccomp=/.test(s)) ||
      hc.PidsLimit !== 64 || hc.Memory !== (kind === 'compile' ? 512 : 256) * 1024 * 1024 || hc.MemorySwap !== hc.Memory && !((trustedZeroSwapProbe || verifiedZeroSwap) && hc.MemorySwap === -1) ||
      hc.NanoCpus !== 1_000_000_000 || hc.PidMode && hc.PidMode !== '' || hc.IpcMode !== 'private' || hc.CgroupnsMode !== 'private' ||
      hc.PublishAllPorts || hc.PortBindings && Object.keys(hc.PortBindings).length || hc.DeviceRequests?.length ||
      !hc.Tmpfs || Object.keys(hc.Tmpfs).sort().join(',') !== '/input,/tmp,/work' ||
      !Object.values(hc.Tmpfs).every((flags) => typeof flags === 'string' && flags.includes('nosuid') && flags.includes('nodev') && flags.includes('size=')) ||
      !hc.Tmpfs['/tmp'].includes('noexec') || !hc.Tmpfs['/input'].includes('noexec') ||
      hc.Binds?.length || hc.Devices?.length || hc.Mounts?.length ||
      metadata.Mounts?.some((m: any) => m.Type !== 'tmpfs') || metadata.Config.Volumes && Object.keys(metadata.Config.Volumes).length)
      fail('INSECURE_ENGINE', 'Docker did not apply the required isolation configuration.');
    await audit({ phase: 'container-created', kind, containerId: id, requestId: currentRequestId });
    await checked(['container', 'start', id], { signal });
    return container;
  }
  async function phaseCompile(container: OwnedContainer, project: ValidatedCProject, signal: AbortSignal, budget: Budget): Promise<CPhaseReceipt> {
    const started = Date.now();
    const bytes = archive(Object.keys(project.files).map((name) => ({ name, data: Buffer.from(project.files[name]) })));
    await checked(['container', 'exec', '--user', '0:0', '-i', container.id!, '/usr/bin/env', '-i', 'PATH=/usr/bin:/bin', 'LC_ALL=C', '/bin/sh', '-c', INGEST_SCRIPT], { signal, input: bytes });
    const result = await command(['container', 'exec', '--user', '65534:65534', container.id!, '/usr/bin/env', '-i',
      'PATH=/usr/local/bin:/usr/bin:/bin', 'LC_ALL=C', 'HOME=/nonexistent', 'TMPDIR=/tmp', '/bin/sh', '-c', COMPILER_SCRIPT,
      'bolt-c17', ...project.sources.map((name) => '/input/' + name)], { signal, timeout: C_LIMITS.compileMs, budget });
    if (result.code === 124 || result.code === 137) fail('TIMEOUT', 'Compiler was terminated by its deadline/resource limit.');
    if (result.code === null || result.code >= 125) fail('BACKEND_ERROR', 'Compiler execution did not produce a reliable normal compiler exit.');
    const metadata = await inspect(container, signal);
    if (!metadata.State?.Running || metadata.State.OOMKilled) fail('BACKEND_ERROR', 'Compilation container terminated unexpectedly.');
    return { phase: 'compile', stdout: outputText(result.stdout), stderr: outputText(result.stderr), exitCode: result.code,
      duration: Date.now() - started, status: result.code === 0 ? 'completed' : 'failed', evidence: 'docker-exec' };
  }
  async function phaseRun(container: OwnedContainer, binary: Buffer, stdin: string, signal: AbortSignal, budget: Budget): Promise<CPhaseReceipt> {
    const started = Date.now();
    // Follow before release of the root-owned ready gate, so no output is lost.
    const logs = command(['container', 'logs', '--follow', container.id!], { signal, timeout: C_LIMITS.runMs, budget });
    const wait = command(['container', 'wait', container.id!], { signal, timeout: C_LIMITS.runMs });
    // Catch immediately; a rejected child must never become an unhandled rejection during ingestion.
    logs.catch(() => {}); wait.catch(() => {});
    try {
      await checked(['container', 'exec', '--user', '0:0', '-i', container.id!, '/usr/bin/env', '-i', 'PATH=/usr/bin:/bin', 'LC_ALL=C',
        '/bin/sh', '-c', RUNTIME_INGEST_SCRIPT], { signal, input: archive([{ name: 'program', data: binary, executable: true }, { name: 'stdin', data: Buffer.from(stdin) }]) });
      const [logResult, waitResult] = await Promise.all([logs, wait]);
      if (logResult.code !== 0 || waitResult.code !== 0) fail('BACKEND_ERROR', 'Runtime Docker transport failed.');
      const metadata = await inspect(container, signal);
      const text = waitResult.stdout.toString('utf8').trim();
      if (!/^\d{1,3}$/.test(text) || metadata.State?.Running || metadata.State?.Status !== 'exited' || metadata.State.Error ||
        !Number.isInteger(metadata.State.ExitCode) || metadata.State.ExitCode < 0 || metadata.State.ExitCode > 255 || metadata.State.ExitCode !== Number(text))
        fail('BACKEND_ERROR', 'Docker wait and inspect did not establish a matching real runtime exit.');
      return { phase: 'run', stdout: outputText(logResult.stdout), stderr: outputText(logResult.stderr),
        exitCode: metadata.State.ExitCode, duration: Date.now() - started,
        status: metadata.State.ExitCode === 0 ? 'completed' : 'failed', evidence: 'docker-wait-inspect', oomKilled: Boolean(metadata.State.OOMKilled) };
    } catch (error) {
      // Removing the container terminates all descendants, not merely the local CLI.
      await remove(container).catch(() => { poisoned = true; });
      await Promise.allSettled([logs, wait]);
      throw error;
    }
  }
  return {
    async info() {
      if (active) return { available: false, backend: 'docker-cli', image: config.image, dockerHost: config.dockerHost, limits: C_LIMITS, warnings: WARNINGS,
        error: { code: 'BUSY', message: 'A C job is active; no concurrent probe is allowed.' } };
      if (closed || poisoned) return { available: false, backend: 'docker-cli', image: config.image, dockerHost: config.dockerHost, limits: C_LIMITS, warnings: WARNINGS,
        error: { code: closed ? 'CLOSED' : 'CLEANUP_FAILED', message: closed ? 'Compiler is closed.' : 'An owned container still needs operator cleanup.' } };
      checkingController ??= new AbortController();
      checking ??= preflight(checkingController.signal).catch((error) => { const e = normalizedError(error); return { available: false, backend: 'docker-cli' as const,
        image: config.image, dockerHost: config.dockerHost, limits: C_LIMITS, warnings: WARNINGS, error: { code: e.code, message: e.message } }; }).finally(() => { checking = undefined; checkingController = undefined; });
      return checking;
    },
    async execute(project, options) {
      if (closed) fail('CLOSED', 'Compiler is closed.');
      if (poisoned) fail('CLEANUP_FAILED', 'An owned container still needs operator cleanup.');
      if (active || checking) fail('BUSY', 'One active C job per compiler is allowed; no implicit queue.');
      if (!options || typeof options.requestId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(options.requestId)) fail('INVALID_PROJECT', 'A bounded ASCII requestId is required.');
      currentRequestId = options.requestId;
      const controller = new AbortController();
      let finish!: () => void;
      active = { controller, done: new Promise<void>((resolve) => { finish = resolve; }) };
      const abort = () => controller.abort();
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) controller.abort();
      const started = Date.now();
      const timer = setTimeout(() => controller.abort(), C_LIMITS.jobMs);
      const receipt: CExecutionReceipt = { requestId: options.requestId, sourceHash: '', backend: 'docker-cli', image: config.image,
        success: false, status: 'error', phase: 'validate', stdout: '', stderr: '', exitCode: null, duration: 0,
        cleanup: { ok: true, remainingContainerIds: [] }, audit: { recorded: false, file: config.auditFile }, warnings: WARNINGS };
      let error: CCompilerError | undefined;
      let authorized = false;
      try {
        const validated = prepareProject(project); receipt.sourceHash = validated.sourceHash;
        await audit({ requestId: receipt.requestId, phase: 'authorized', sourceHash: receipt.sourceHash, image: config.image, fileCount: Object.keys(validated.files).length, sourceBytes: validated.sourceBytes });
        authorized = true; receipt.phase = 'prepare';
        receipt.warnings = (await preflight(controller.signal)).warnings;
        const budget = { used: 0, max: C_LIMITS.outputBytes };
        const compileContainer = await create('compile', controller.signal);
        receipt.phase = 'compile';
        receipt.compile = await phaseCompile(compileContainer, validated, controller.signal, budget);
        receipt.stdout = receipt.compile.stdout; receipt.stderr = receipt.compile.stderr; receipt.exitCode = receipt.compile.exitCode;
        if (receipt.compile.exitCode !== 0) receipt.status = 'compile_failed';
        else {
          const artifact = await checked(['container', 'exec', '--user', '65534:65534', compileContainer.id!, '/bin/cat', '/work/program'],
            { signal: controller.signal, max: C_LIMITS.artifactBytes });
          if (artifact.stderr.length || artifact.stdout.length < 16 || !artifact.stdout.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])))
            fail('BACKEND_ERROR', 'Compiler did not produce a bounded Linux ELF executable.');
          await remove(compileContainer);
          receipt.phase = 'run';
          const runContainer = await create('run', controller.signal);
          receipt.run = await phaseRun(runContainer, artifact.stdout, validated.stdin, controller.signal, budget);
          receipt.stdout = receipt.run.stdout; receipt.stderr = receipt.run.stderr; receipt.exitCode = receipt.run.exitCode;
          receipt.status = 'completed'; receipt.success = receipt.run.exitCode === 0 && !receipt.run.oomKilled;
        }
      } catch (caught) {
        error = normalizedError(caught);
        if (error.code === 'ABORTED' && !options.signal?.aborted && !closed) error = new CCompilerError('TIMEOUT', 'C job exceeded its outer deadline.');
        receipt.error = { code: error.code, message: error.message };
        receipt.stdout = error.stdout; receipt.stderr = error.stderr;
        receipt.success = false; receipt.status = 'error'; receipt.exitCode = null;
        if (receipt.phase === 'compile' || receipt.phase === 'run') {
          const target = receipt.phase;
          const phaseError: CPhaseReceipt = { phase: target, stdout: error.stdout, stderr: error.stderr, exitCode: null, duration: Date.now() - started,
            status: error.code === 'ABORTED' ? 'aborted' : error.code === 'TIMEOUT' ? 'timeout' : error.code === 'OUTPUT_LIMIT' ? 'output_limit' : 'backend_error', evidence: 'none' };
          if (target === 'run' && !receipt.run) receipt.run = phaseError;
          if (target === 'compile' && !receipt.compile) receipt.compile = phaseError;
        }
      } finally {
        clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
        const cleanup = await Promise.allSettled([...containers].map(remove));
        if (cleanup.some((result) => result.status === 'rejected')) {
          poisoned = true; receipt.success = false; receipt.status = 'error'; receipt.phase = 'cleanup';
          receipt.error = { code: 'CLEANUP_FAILED', message: 'Owned container cleanup could not be confirmed; compiler disabled.' };
        }
        receipt.cleanup = { ok: containers.size === 0, remainingContainerIds: [...containers].map((c) => c.id ?? c.name) };
        receipt.duration = Date.now() - started;
        try {
          await audit({ requestId: receipt.requestId, sourceHash: receipt.sourceHash || null, image: config.image, phase: 'completed', authorized,
            status: receipt.status, success: receipt.success, code: receipt.error?.code, compileExitCode: receipt.compile?.exitCode ?? null,
            runExitCode: receipt.run?.exitCode ?? null, duration: receipt.duration, cleanup: receipt.cleanup });
          receipt.audit.recorded = true;
        } catch {
          receipt.success = false; receipt.status = 'error'; receipt.error = { code: 'AUDIT_ERROR', message: 'Final audit could not be durably recorded.' };
        }
        active = undefined; currentRequestId = undefined; finish();
      }
      return receipt;
    },
    async close() {
      closed = true;
      checkingController?.abort();
      if (active) { active.controller.abort(); await active.done; }
      if (checking) await checking;
      const cleanup = await Promise.allSettled([...containers].map(remove));
      if (cleanup.some((result) => result.status === 'rejected')) fail('CLEANUP_FAILED', 'Owned container cleanup could not be confirmed.');
      // No recursive host deletion: operator may retain this private empty Docker config for evidence.
    },
  };
}

async function assertHostDirectory(directory: string) {
  const resolved = path.resolve(directory), parsed = path.parse(resolved);
  let current = parsed.root;
  for (const component of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail('CONFIG', 'Trusted workspace/audit ancestors must not be symlinks.');
  }
}
