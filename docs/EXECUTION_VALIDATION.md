# Bolt real-execution patch: validation record

Validated on 14 November 2026 in the Manus Ubuntu sandbox, Node v22.23.4, against `o9nn/bolt.cog` base commit `3b44440`. No Git commit/push, production deployment, Access-policy change, or elevated/destructive OS operation was performed.

| Check | Result |
|---|---|
| Targeted application tests | **68 passed**, 5 files |
| Standalone Linux runner tests | **23 passed**, no skips/cancellations |
| `pnpm typecheck` | Passed |
| `pnpm build` | Passed |
| Critical route/broker/stream/UI ESLint check | Passed |
| `git diff --check` | Passed |
| Full application suite | **123 passed, 1 failed**, 9 files |

The sole full-suite assertion failure is pre-existing `app/lib/cognitive/grammar-engine.spec.ts:36`: its expected keyword token omits position metadata present in the actual token. The same failure was captured in the baseline before this patch. It is not silently removed or reported as a green whole-repository test run. Broad AgentZero lint also retains pre-existing legacy comment/case-style issues; the critical new route, broker and stream path was lint-checked separately. Build output contains existing Sass/React Router deprecation and chunk/import warnings.

Vitest now includes only `app/**/*.spec.ts` and `app/**/*.spec.tsx`. The standalone runner uses Node's `node --test` harness and is validated separately, not imported as a Vitest suite. The route spec is outside `app/routes`, preventing Remix from discovering it as a production route.

## Actual native execution, not a simulated receipt

`app/lib/.server/native-execution.spec.ts` constructs the real Linux runner on loopback with fresh disposable workspace/audit directories, then calls the actual `createAgentZeroTools()` broker and `AgentZero.executeTool()`. A test-only fetch wrapper rewrites the fixed HTTPS destination to the loopback test service. Production code still requires fixed HTTPS and disallows redirects.

The identity operation spawned real `/usr/bin/id` and returned:

```text
uid=1000(ubuntu) gid=1000(ubuntu) groups=1000(ubuntu),4(adm),20(dialout),24(cdrom),25(floppy),27(sudo),29(audio),30(dip),44(video),46(plugdev)
backend=linux
exitCode=0
requestId=integration:1
```

Membership of the sandbox account's `sudo` group is merely reported by `id`; no sudo command or elevation was invoked. Production instructions use an isolated non-root service UID with capabilities dropped.

The next call read only an exact allowlisted newly created `approved.txt` fixture and returned `DISPOSABLE_INTEGRATION_FIXTURE`. A third call for a non-allowlisted file was denied. Three dispatch records and three terminal records were written; two terminal results were successful and the denied call recorded `FILE_NOT_ALLOWLISTED`. The audit did not contain the fixture service token. Cleanup removed only the fresh `mkdtemp` fixture directory after closing the server.

## Stream and SDK validation

The installed AI SDK v3 was exercised with deterministic `MockLanguageModelV1` fixtures, not a replacement handwritten streaming implementation. Tests prove that a model tool call reaches a registered AgentZero handler, the receipt reaches the next model prompt, final assistant text remains in the stream, and length continuation preserves final bytes.

Route/guard tests cover full drain, zero-byte upstream EOF, empty text deltas, fragmented frames, tool-result-only fallback, initialization and late-stream errors, consumer cancellation, cancellation during a pending read, invalid roles/JSON/content types, byte limits, stripped forged tool results, explicit native opt-in and sanitized provider status handling. The SDK fixtures do not prove live model quality, real provider tool choice or production authentication.

## Authorization and runner validation

Broker tests cover JWT verifier constraints, required authentication configuration, missing/expired signature errors, server workspace ACLs, traversal/glob/metacharacter paths, unsupported operations, fixed endpoint constraints, authenticated dispatch payloads, receipt correlation, four-call budget and cancellation. JWT behavior is exercised through the `jose` dependency interface; a real authenticated Cloudflare Access canary remains outstanding.

Runner tests exercise real fixed spawning, authentication and schemas, actor/workspace ACLs, traversal, symlinks/hardlinks/FIFOs, pinned-root substitution, output/file/body/list caps, invalid JSON/UTF-8, unsupported routes/Expect, HTTP body timeout, actual detached process/descendant termination, concurrency, sanitized audit, dispatch/terminal storage faults, actual audit unlink, root/startup refusal, audit dispatch correlation and graceful shutdown.

The Dockerfile and hardened deployment example are supplied but were not built or deployed. Node 20 compatibility is the target, while Node 22.23.4 was the runtime actually tested. Local kernel/storage stalls and fsync are not forcibly interruptible; production requires local storage, supervisor/resource controls and protected archival audit retention.

## Real-provider smoke test and live-site status

A smoke request against the compiled chat action reached the sandbox's configured Anthropic service and failed with **HTTP 401 `authentication_error`**. Before the specific status mapping was added, the action returned **HTTP 502 with a non-empty 78-byte data-stream error**, instead of empty HTTP 200. After the mapping, tests validate that a provider 401/403 returns a sanitized framed **503**, with no raw secret/exception text. The current credential has not been replaced or exposed. This local credential result is not a test of the deployed Pages secret.

The live `https://bolt-cog.pages.dev/api/chat` probe returned **HTTP 302 to Cloudflare Access** on 14 November 2026. No authenticated production canary was completed. Do not claim that production empty responses, tool execution or sudo behavior have been fixed live until the patch is deliberately deployed and checked through Access.

## Remaining release gates

Deploy the chat patch with native execution disabled first. Provision a reviewed isolated runner plus private TLS ingress, rate/egress/resource policies, exact Access identity and workspace ACLs, runner file allowlist and durable audit storage. The current broker has one endpoint and the runner one actor/workspace pair; multi-tenant routing is not provided.

Add a native opt-in/workspace UI and a reviewed versioned workspace-sync contract if required. Protect audit retention beyond the service UID. Root/arbitrary shell/deletion endpoints, single-use elevated approval tokens, native build/install operations, durable trusted conversation history and a Cloudflare Containers adapter are intentionally absent. Existing browser Bolt shell artifacts are a separate execution path and are not governed by the native runner allowlist.
