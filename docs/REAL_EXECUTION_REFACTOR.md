# Real command execution for Bolt on Cloudflare

Keep Cloudflare Pages/Workers as the authenticated control plane and retain WebContainer for browser-local Node development. Execute native Linux commands in a **separate, non-root Linux service**, reached through a fixed authenticated endpoint. Neither a prompt saying “you can use sudo” nor `nodejs_compat` can turn a Worker or WebContainer into a host Linux shell. Cloudflare explicitly lists `node:child_process` as a non-functional stub; WebContainers only support browser-native JavaScript/WebAssembly execution and compatible toolchains. [1] [2]

This patch is based on `o9nn/bolt.cog` commit `3b44440`. It changes local source and supplies a functional read-only Linux runner. It does not deploy to production, grant host/root access, or enable arbitrary shell commands. The repository's `AgentZero` is an Agent-Zero-inspired TypeScript implementation, not an installation of the upstream Python Agent Zero runtime.

## What the empty-response patch fixes

The old `/api/chat` creates a `SwitchableStream` and calls `stream.close()` from the model's `onFinish`. That method cancels the active reader and terminates the transform while SDK-framed output may still be pending. Continuation also replaces a shared reader while the previous asynchronous pump may still be running. Both are lifecycle races. Separately, missing-key and exception branches return raw text with HTTP 200 although `useChat` expects AI SDK data-stream frames. This is a code-level explanation of the inherited empty-response symptom, not a current production trace.

The replacement awaits the installed AI SDK v3 `streamText()` initialization, then uses `toDataStream()` and lets the SDK handle tool roundtrips and length continuation. `guardChatStream()` drains upstream through EOF, holds the terminal `d:` frame until remaining data is delivered, handles transport-fragmented frames, and produces a non-empty framed error when there is no useful content. Its `pull()` continues reading partial or terminal-only chunks rather than leaving the consumer waiting. Cancellation stops the upstream request, and cleanup clears deadline timers.

Successful responses use `Content-Type: text/plain; charset=utf-8` and `X-Vercel-AI-Data-Stream: v1`, matching the installed client. Text, tool calls, tool results and terminal frames remain in the SDK's native protocol. Do not change this to raw text or SSE without also changing the client.

Request validation requires POST JSON, a body no larger than 256 KiB, at most 100 messages, and at most 64,000 characters per message. The last message must be a non-empty user message. Client `system` roles are rejected, and client-supplied tool invocation/result fields are stripped before model conversion. The route has a 90-second model deadline and a 2 MiB response cap. Native execution is sequential, limited to four dispatches and five model steps; plain chat uses the existing two-segment limit. Provider retries are disabled.

Early validation/configuration failures use appropriate non-200 HTTP statuses and a framed error message containing a request ID. Provider credential/model/rate-limit failures receive specific, sanitized messages. Failures after headers have been sent are represented as data-stream error frames; HTTP status cannot be retroactively changed. Environment names, keys, key lengths and raw provider exceptions are not returned. The UI now displays these actionable errors rather than a generic toast.

`ANTHROPIC_MODEL` is optional. The default remains `claude-3-haiku-20240307`, the model verified in the inherited deployment context; availability must be rechecked before a change. The obsolete Sonnet-only beta header is removed. An explicitly supplied Cloudflare key takes precedence over local environment fallback. Output remains capped at 4096 tokens per model step.

## How Agent-Zero tool execution is connected

The route enables native tools only when the request contains an explicit execution selection:

```json
{
  "messages": [{ "role": "user", "content": "Inspect the Linux identity and kernel information." }],
  "execution": { "backend": "linux", "workspaceId": "workspace-1" }
}
```

This selection is a request, not authorization. Before exposing a tool, the Worker verifies the Cloudflare Access JWT against the configured team's JWKS, checks RS256, issuer, audience, required claims and expiration, and obtains the actor from the verified `sub`. It then applies a server-owned subject-to-workspace ACL. The browser/model cannot supply a trusted actor, a filesystem root, an executor endpoint or a service credential.

`createAgentZeroTools()` creates a request-local AgentZero, registers the `workspace_inspect` tool and injects an actual trusted handler using `registerToolHandler()`. The SDK's `execute` callback calls `agent.executeTool()`. That dispatches a validated operation to the Linux runner; the result is fed back into the model for the next step and streamed to the client. This deliberately does **not** invoke the old keyword-driven `AgentZero.run()` planner. The existing planner and cognitive four-agent simulator remain separate, and are not evidence of a production autonomous reasoning loop.

The execution vocabulary is narrow:

```text
identity             args: {}                 real /usr/bin/id
system_info          args: {}                 real /usr/bin/uname -a
workspace_list       args: {}                 bounded configured-root listing
workspace_file_read  args: {path: "..."}      approved UTF-8 regular file only
```

Only `workspace_file_read` accepts a path. Worker validation rejects absolute paths, traversal, empty path components, globs and shell metacharacters; the runner applies stricter descriptor-based filesystem rules and an exact file allowlist. The endpoint is a fixed HTTPS URL whose path is `/execute`, with no user information, query or fragment. Redirect following is disabled. The Bearer token is a server-side secret and is never forwarded to children or placed in the model prompt.

Responses carry actual `success`, `output`, `exitCode`, `duration`, `backend: "linux"` and a correlated request ID. Missing adapters and unsupported tools now fail explicitly rather than returning “Executed” strings. Native stdout and approved file contents are untrusted data, not new authority. Use curated non-sensitive snapshots: filename filtering cannot detect secrets inside an otherwise approved document.

## The sudo security change

Every AgentZero now starts without elevation and has its own capability manager. Constructors and wrappers do not grant automatic ROOT. ROOT/GODMODE grants are rejected; the sudo and godmode tools cannot be re-enabled or supplied with a handler. Terminal/code/search tools without a real adapter return failure.

`SudoManager` remains an **application callback authorization mechanism**, not OS sudo. Explicit application grants require exact operation scopes and a finite lifetime up to five minutes; no operation runs without a matching grant. Returned sessions and logs are defensive copies, denial records remain retrievable, and in-memory diagnostics are bounded. These diagnostics are not a durable production audit or proof of OS privilege. An operation-scope grant alone is also not target-specific authorization: target and actor policy must be enforced in its trusted adapter.

The first native release is read-only. There is no delete, package-install, arbitrary terminal, generated-code, setuid or root endpoint. If actual elevation later becomes necessary, implement a separate fixed-function helper whose authorization is bound to actor, workspace, canonical target, exact operation and arguments, expiry and a single-use nonce. A trusted UI must show a dry-run preview and obtain explicit approval; a model saying “approved” must never mint that capability. Validate at dispatch, durably consume the nonce, revalidate at the helper, record receipt and verify the effect. This is a future design, **not implemented by this patch**.

Do not authorize `sudo sh`, interpreters, user-editable scripts, arbitrary command strings, unrestricted package managers or access to the Docker socket. Container root is not host root, but it is still unnecessarily powerful for these operations.

## Deploying the separate Linux service

The dependency-free reference implementation is in `services/linux-runner/`. Its README supplies exact configuration, hardened Docker commands, limits, test instructions and residual constraints. The runner refuses UID 0 at startup. Native spawning uses fixed absolute executable paths, `shell: false`, a minimal environment, detached process groups, a three-second timeout, output caps and group termination on timeout/disconnect/completion. The authenticated HTTP service rechecks actor/workspace and rejects arbitrary executables, command strings, extra fields and unauthorized paths.

Each runner instance has one exact actor/workspace mapping and its own service token. The current Worker has one configured endpoint, so configure its ACL for that same pair. A multi-tenant deployment needs a **server-owned** workspace-to-runner/service-binding map and scoped credentials; it must not derive destinations from user input. Do not point a broad multi-user ACL at this single-pair runner and assume routing exists.

Runner audit uses a private append-only-in-use JSONL file. A dispatch record is flushed before execution; the terminal record is flushed before releasing output. Records have independent server dispatch IDs and sanitized metadata, not raw headers, stdout, token or paths. Audit failure makes the runner unavailable and suppresses output. A crash can leave an unresolved dispatch; absence of a terminal event must never be treated as success. The log is durable but not immutable against the service UID or host administrator. Add protected archival retention, disk quotas, integrity monitoring and independent proxy logs before production.

Deploy the service with a non-root UID, read-only root filesystem, all Linux capabilities dropped, `no-new-privileges`, PID/CPU/memory limits, the default seccomp profile and a curated read-only workspace mount. Its only durable writable mount is a dedicated private audit directory. Keep ingress on a private transport behind TLS/mTLS or Cloudflare Tunnel/Access, and apply rate and egress policies. No Docker socket, host root mount, privileged container, host PID namespace or host network mode is required.

A Cloudflare-native alternative is a **separate Workers + Containers service**, where a Durable Object controls a Linux container and the Pages Function calls a private service binding. Cloudflare Containers can run full-filesystem/custom-runtime workloads and is available on Workers Paid. It is not activated by adding a Pages environment flag, and needs its own image, lifecycle/routing code and configuration. [3] The supplied Docker image is a runner reference; it is not a deployed or validated Cloudflare Containers adapter.

## Worker settings and client behavior

Configure secrets/settings through the deployment secret manager, never source files:

```dotenv
ANTHROPIC_API_KEY=<server-only provider secret>
ANTHROPIC_MODEL=claude-3-haiku-20240307
EXECUTOR_URL=https://<fixed-private-gateway>/execute
EXECUTOR_TOKEN=<server-only runner token>
CF_ACCESS_TEAM_DOMAIN=<team>.cloudflareaccess.com
CF_ACCESS_AUD=<execution-app audience>
EXECUTOR_WORKSPACE_ACL={"<verified-access-subject>":["workspace-1"]}
```

The runner uses `RUNNER_TOKEN`, `RUNNER_ACTOR_ID`, `RUNNER_WORKSPACE_ID`, `RUNNER_WORKSPACE_ROOT`, `RUNNER_AUDIT_PATH` and `RUNNER_READ_FILES_JSON`. Its read allowlist defaults to empty. Provision runner and gateway secrets separately; do not use example placeholders. If the gateway itself is protected by Access service-token authentication, add its service-token headers through a reviewed server-side gateway integration; the current broker only sends the runner Bearer token.

Existing UI requests omit `execution`, so existing browser chat remains tool-disabled by default. The API supports an authenticated native request, but native workspace selection and an explicit opt-in UX remain a release gate. A future UI may add `body: { execution: { backend: 'linux', workspaceId } }` to `useChat`, using a workspace selected from a server-authorized directory. Do not send API keys or runner tokens to the browser. Existing tool history fields are stripped on later requests; durable trusted conversation/tool history is not implemented.

Keep `public/_headers` COOP/COEP settings for WebContainer. The browser's existing `boltArtifact`/`boltAction` path remains distinct from native tools. This patch makes WebContainer nonzero exits and file-write errors fail visibly, but does not add a server-side approval system to browser-generated shell artifacts. Browser code still has access to its own browser workspace. Do not treat the new Linux allowlist as covering those legacy actions.

## Workspace ownership and synchronization

The initial runner performs diagnostics and reads a server-provisioned snapshot. It does not share WebContainer memory or files. Choose one authoritative workspace before adding write/build operations: either keep browser files authoritative and publish reviewed versioned snapshots to remote compute, or make the remote workspace authoritative and mirror approved changes to the browser.

A safe future transfer contract needs a content-hashed manifest, explicit relative paths and types, byte/file quotas, conflict/version checks, secret exclusions, per-workspace authorization and rejection of symlinks/devices. Publish a snapshot atomically and bind execution receipts to its version. Never silently mount the operator's home directory or mirror an entire credential-bearing repository into the model-readable runner. Those transfer and remote build capabilities are not implemented here.

## Applying the patch

Apply to a clean checkout of the exact base commit, or review conflicts against a newer branch:

```sh
git switch -c fix/chat-real-execution 3b44440
git apply --check /path/to/bolt-chat-real-execution.patch
git apply /path/to/bolt-chat-real-execution.patch
pnpm install --frozen-lockfile
pnpm typecheck
pnpm exec vitest --run app/lib/.server/llm/chat-route.spec.ts \
  app/lib/.server/llm/sdk-roundtrip.spec.ts \
  app/lib/.server/agent-zero-tools.spec.ts \
  app/lib/.server/native-execution.spec.ts \
  app/lib/agent-zero/execution.spec.ts
node --test services/linux-runner/test/runner.test.mjs
pnpm build
```

There is no application dependency upgrade. Tests live outside `app/routes` so Remix does not mistake a spec file for a production route. Publish chat reliability with execution disabled first. Then provision the reviewed runner and run an authenticated canary that requests `identity` and an approved fixture read, verifies receipt IDs and durable audit records, and confirms negative cases. Do not test destructive operations against pre-existing files or production resources.

## Current evidence and remaining constraints

The inherited deployment originally showed an empty HTTP 200 for a bounded sudo prompt. The current live probe on 14 November 2026 returned HTTP 302 to Cloudflare Access; production chat and native execution were not tested through that authentication. No Access policy was bypassed or changed.

A local compiled-action smoke request reached the real configured Anthropic service, which returned HTTP 401 `authentication_error`. The replacement route returned a non-empty framed initialization error rather than an empty success. The current sandbox provider credential is therefore not evidence that the deployed Pages secret works or fails. Positive provider-stream behavior is tested with the installed SDK and deterministic model fixtures; local real Linux execution is tested independently.

The security scope is intentionally bounded: no production deployment, TLS gateway provisioning, Cloudflare Containers adaptation, native UI selector, rate-limit rollout, immutable archive, durable conversational memory, dynamic tool creation, arbitrary code execution, approval service or elevated helper is included. See the delivered validation results for exact local pass counts and the separately identified pre-existing cognitive grammar assertion failure.

## References

[1]: https://developers.cloudflare.com/workers/runtime-apis/nodejs/ "Cloudflare Workers Node.js compatibility and non-functional stub modules"
[2]: https://webcontainers.io/guides/troubleshooting "WebContainer troubleshooting and native addon limitations"
[3]: https://developers.cloudflare.com/containers/ "Cloudflare Containers runtime and separate deployment model"
