# Linux runner — bounded, read-only OS backend

This standalone Node 20+ Linux HTTP service is an **actual OS execution boundary**, not Cloudflare Workers, a WebContainer, or a simulated terminal. It uses only Node built-ins. `identity` and `system_info` spawn fixed system executables with `shell: false`; workspace operations use bounded filesystem reads. No dependencies, package manager, arbitrary command execution, deployment, or app changes are required.

**Initial release is read-only.** `disposable_log_delete` is explicitly rejected with `DELETE_NOT_IMPLEMENTED_READ_ONLY`. There is no sudo, root opt-in, privileged helper, filesystem mutation endpoint, outbound HTTP fetch, shell, user-supplied binary, environment override, or approval-token mechanism. A future privileged helper would be a separately deployed and reviewed service, with its own narrow policy and expiring single-use approvals bound to actor, workspace, target, operation and exact arguments. It is not implemented here.

## Broker contract

The broker calls the server over a private trusted transport:

```http
POST /execute HTTP/1.1
Authorization: Bearer <server-only RUNNER_TOKEN>
Content-Type: application/json
```

The JSON body must contain **exactly** these five fields:

```json
{
  "actorId": "actor-1",
  "workspaceId": "workspace-1",
  "requestId": "request-123",
  "operation": "identity",
  "args": {}
}
```

| Operation | Exact arguments | Behavior |
| --- | --- | --- |
| `identity` | `{}` | Real `/usr/bin/id`, arguments `[]` |
| `system_info` | `{}` | Real `/usr/bin/uname`, arguments `["-a"]` |
| `workspace_list` | `{}` | Lists only the server-configured workspace root; no recursive traversal or client path |
| `workspace_file_read` | `{"path":"README.md"}` | UTF-8 regular-file read, exact server allowlist match, bounded size, no symlinks, hardlinks, FIFO or device reads |

Successful response, HTTP 200:

```json
{
  "success": true,
  "output": "uid=1000(node) gid=1000(node) groups=1000(node)\n",
  "exitCode": 0,
  "duration": 12,
  "backend": "linux",
  "requestId": "request-123"
}
```

`duration` is an integer elapsed time in milliseconds through operation completion (before the final durable audit flush). `output` is always a string. For `workspace_list`, it is a JSON-encoded, name-sorted array of `{name,type}` records; `type` is `file`, `directory`, `symlink` or `other`. Symlinks may be *listed* but are never followed. Dotfiles, suspicious secret-bearing names and names outside the conservative filename grammar are hidden. The list exposes filenames, not file contents or a claim that those files are readable.

Failed `/execute` response, with an appropriate non-2xx HTTP status:

```json
{
  "success": false,
  "output": "",
  "error": "WORKSPACE_FORBIDDEN",
  "exitCode": null,
  "duration": 3,
  "backend": "linux",
  "requestId": "request-123"
}
```

`error` is a fixed code, not an OS error, stack trace or secret. Failures never return partial output. `exitCode` is `null` unless the completed process reported a nonzero exit code. A syntactically valid `requestId` is echoed after authentication/body parsing even when another field is rejected. For unauthenticated, malformed or pre-body rejected requests, `requestId` is `null`. Unknown routes return HTTP 404 with `{error:"NOT_FOUND",backend:"linux"}`, outside the execution result contract. Only exact `/execute` is accepted: trailing slashes, query strings, absolute URLs and redirect-like paths are rejected. HTTP redirects are never produced and no outbound URL operation exists. The **broker must also disable automatic redirect following** when forwarding its Bearer token.

Common error statuses: `UNAUTHORIZED` (401), `WORKSPACE_FORBIDDEN` / `FILE_NOT_ALLOWLISTED` / unsafe files (403), invalid fields/args/paths or unknown operations (400), missing file (404), body timeout (408), body limit (413), wrong content type or encoding (415), unsupported `Expect` (417), file/output/list limits (422), capacity/concurrency limits (429), audit failure (503), and execution timeout (504).

`GET /health` is unauthenticated and returns only `{status:"ok",backend:"linux"}` (200), or `{status:"unavailable",backend:"linux"}` (503) after an audit failure. It never exposes configuration, token, workspace root, usernames or audit contents. It is a liveness/audit-state indicator, not a comprehensive executable or disk-space probe.

### Broker responsibilities

The Bearer token is only a service credential, not end-user identity. The broker must authenticate the user, derive trusted `actorId` and `workspaceId` on the server, and authorize the requested operation **before** forwarding. Never accept trusted actor IDs from browser or LLM text alone, and never send `RUNNER_TOKEN` to the browser, a model or logs. Requests and outputs remain untrusted data and should not become new command authority. `requestId` is correlation only, not a deduplication, replay-protection or approval token; retries are safe because this release has no mutable operations.

There is one exact server-owned actor/workspace mapping per runner instance. Use separate narrowly scoped instances/tokens for separate tenants, rather than trusting caller-selected roots. No client field can override the fixed root.

## Server configuration

| Variable | Requirement / default |
| --- | --- |
| `RUNNER_TOKEN` | Required: 32–256 printable ASCII, non-space characters; use a high-entropy random value |
| `RUNNER_ACTOR_ID` | Required exact actor ID |
| `RUNNER_WORKSPACE_ID` | Required exact workspace ID |
| `RUNNER_WORKSPACE_ROOT` | Required absolute, non-root directory; no symlink components |
| `RUNNER_AUDIT_PATH` | Required absolute JSONL path outside workspace, parent owned by service UID with mode `0700` |
| `RUNNER_READ_FILES_JSON` | JSON array of exact relative paths, default `[]` (all content reads denied) |
| `RUNNER_HOST` | Default `127.0.0.1`; accepted `127.0.0.1`, `0.0.0.0`, `::1` |
| `RUNNER_PORT` | Default `8788`; integer 1024–65535 |

Actor/workspace IDs: 1–64 alphanumeric/underscore/hyphen characters, beginning with an alphanumeric. Request IDs: 1–128 characters, beginning with an alphanumeric, then alphanumeric/underscore/hyphen/dot/colon. Read paths: up to 512 characters and 8 relative components; each component begins with an alphanumeric and uses alphanumeric/dot/underscore/hyphen, up to 128 characters. Traversal (`.` or `..`), hidden components, separators other than `/`, NULs, percent-encoded escapes, URLs and shell metacharacters are rejected. Files named like environment, credentials, tokens, private keys and related secrets are rejected even if allowlisted.

**Filename checks cannot recognize secrets inside an otherwise ordinary file.** Deploy only a curated, non-sensitive workspace snapshot and approve every allowed file's contents out of band. Do not mount a developer home, full repository containing secrets, live mutable tree, `/etc`, host root, or service configuration. Keep the workspace read-only for the runner **and immutable to other untrusted actors** while serving. Linux procfs must be available: the service uses pinned directory descriptors through `/proc/self/fd` with `O_NOFOLLOW` on each user-visible component to prevent symlink substitution and root renaming from escaping the pinned workspace. This is Linux-specific and not a general filesystem sandbox; privileged mount changes, compromised service code, malicious allowed contents, and host administrator access are outside its guarantees.

Default limits are server-owned: 8 KiB body, 8 KiB HTTP headers, 32 KiB combined process output, 16 KiB file content, 200 scanned directory entries, 4 simultaneous operations, at most 12 admitted request handlers, 32 sockets, 3 s body-read timeout, 3 s operation timeout, 10 s HTTP request timeout, 5 s headers timeout, 2 s keepalive, 100 requests per socket. Limits are not HTTP arguments. Programmatic construction can choose stricter limits or bounded server-owned overrides; the CLI exposes no client-tunable limits. File and list operations check deadlines between bounded filesystem calls; kernel/filesystem stalls and audit `fsync` are **not** forcibly interruptible by this implementation. Use local storage plus a supervisor and container resource controls, not network/FUSE mounts. Real process timeouts and disconnects use `SIGKILL` on the detached process group, not just the immediate child. Only minimal `PATH`, `LANG`, `LC_ALL` are inherited by child processes; the token and server environment are not forwarded.

## Durable audit and fail-closed behavior

Before execution, the runner serializes an `event:"dispatch"` JSONL record and `fsync`s it. After completion/rejection it serializes an `event:"terminal"` record and `fsync`s **before** returning output. Rejected `/execute` attempts are audited too, with null/omitted identifiers when authentication or schema parsing fails. Health checks, unsupported routes, raw parser errors and connections dropped before reaching the request handler are not dispatches and are not recorded; collect transport security logs at the proxy.

The log contains timestamp, a unique server-generated `dispatchId` on each dispatch/terminal pair, safe actor/workspace/request IDs where available, known operation, SHA-256 of valid file target, HTTP status, success/error, exit code, duration and output byte count. It never includes the Bearer token, headers, raw request/body, absolute root, literal target path, output, OS exception details or stack traces. Dispatch records do not claim an operation was authorized or executed; correlate the terminal record by `dispatchId`, not caller-controlled `requestId`. A crash may leave a dispatch without a terminal record, which must remain an unresolved audit event, not be treated as success.

The audit parent must be private and the file must be a service-owned regular file with mode `0600`, one hardlink, and no symlink. Directory and file handles remain pinned; appends verify the log identity has not been unlinked/replaced and write in a serialized loop, then `fsync`. A failed append/flush or unsafe log makes the entire runner unavailable, cancels active processes and suppresses output (HTTP 503). **A failure cannot itself be durably recorded to the failed device**; no execution occurs after a failed dispatch append. A terminal failure can happen after a read-only operation ran, but its output is withheld. Restart only after repairing storage and investigating unresolved events. Stop the service for audit rotation; no live rotation, retention, external integrity signing, disk quota management or multi-process shared-log support is implemented. The service itself is not an immutable audit store against a compromised UID or host administrator.

## Local check, no deployment

From the repository root, run:

```sh
node --test services/linux-runner/test/runner.test.mjs
```

Verified locally with Node v22.23.4: `node --check` passed; the 23-test regression suite passed with 0 failures, 0 skips, and 0 cancellations. Node 20 compatibility is the implementation target but was not independently executed in this sandbox. Container build and deployment were not run.

The tests create new `mkdtemp` fixtures and clean up only those exact fixture directories. They do not read the application workspace, delete application files, deploy, install dependencies or require root. Test-only code dependencies can substitute a disposable sleeping process to test group timeout behavior or an audit writer to simulate storage failures; these seams are not reachable through HTTP or environment variables.

To start manually as an unprivileged user on a prepared, curated workspace, set the required variables through your supervisor/secrets manager and run `node services/linux-runner/runner.mjs`. UID 0 is always refused, including in tests through the normal startup path. No root-testing flag exists.

## Hardened Docker example (instructions only)

Build with the service directory as context; application files and tests are not copied:

```sh
docker build -t bolt-linux-runner:readonly services/linux-runner
```

Prepare a **dedicated approved workspace snapshot** at `/srv/bolt-linux/workspace` owned and managed by a trusted operator, readable by container UID 1000. Prepare `/srv/bolt-linux/audit` with owner `1000:1000`, mode `0700`, on durable local storage. Do not share either with unrelated containers. Create `/srv/bolt-linux/runner.env` with mode `0600`, outside workspace/audit, using your secret provisioning process:

```dotenv
RUNNER_TOKEN=<replace-with-random-high-entropy-service-token>
RUNNER_ACTOR_ID=actor-1
RUNNER_WORKSPACE_ID=workspace-1
RUNNER_READ_FILES_JSON=["README.md","docs/approved-note.txt"]
```

Only mount files explicitly reviewed as non-sensitive. Do not use the placeholder token. Ensure the deployment secret file is not tracked in Git or mounted into `/workspace`. Docker admin access can inspect container environment: keep Docker administration trusted. The CLI token is environment-supplied by requirement; child processes receive no token.

```sh
docker run --detach --name bolt-linux-runner \
  --init \
  --user 1000:1000 \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --pids-limit 64 \
  --memory 128m --memory-swap 128m \
  --cpus 0.50 \
  --ulimit nofile=128:128 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777 \
  --mount type=bind,src=/srv/bolt-linux/workspace,dst=/workspace,readonly \
  --mount type=bind,src=/srv/bolt-linux/audit,dst=/audit \
  --env-file /srv/bolt-linux/runner.env \
  --publish 127.0.0.1:8788:8788 \
  --restart unless-stopped \
  bolt-linux-runner:readonly
```

Keep Docker's default seccomp profile and use AppArmor/SELinux where available. Do not pass `--privileged`, `--pid=host`, `--network=host`, extra capabilities, host device mounts, host root mounts, or **any Docker socket**. The only durable writable mount is the dedicated audit directory. `--init` reaps orphaned/zombie descendants; the runner kills groups on timeout, cancellation and process completion. The example limits ingress to host loopback but does not provide egress isolation; use a host/network policy that denies egress when needed. Do not publish this unauthenticated-health/private-Bearer HTTP service on the public internet. Use a private network and a TLS/mTLS gateway if the broker is remote, with strict ingress rate limits and request-size limits. The service intentionally has no CORS and should not be called directly by browsers.

The example base image is Node 20 Debian slim so `/usr/bin/id` and `/usr/bin/uname` are available; pin a reviewed image digest for production and keep the base/security patches current. A container build/run, production TLS setup, firewall policy, privileged helper, browser integration, and live deployment have **not** been performed by this task.
