# Bolt Cog Desktop 0.2.0: local application runtime

The merged PR #1 and published `desktop-v0.1.1` release remain the original hosted desktop client. Version 0.2.0 is a separate local-first implementation: the actual Remix UI, server routes, AI SDK streaming, Agent-Zero adapter and application assets are packaged in the installer. Electron starts a Node utility process bound to `127.0.0.1`, not a Cloudflare Worker. It loads that local origin and never falls back to `bolt-cog.pages.dev`.

The existing inference/cognitive implementations are not replaced with deterministic responses. The provider adapter calls a real model through its API. No engine binary or model weights are included: choose and install an appropriate llama.cpp/KoboldCpp engine and GGUF model for the machine. This is not a claim that a 0.5B model matches a production coding model.

## Configure genuine inference

Start an OpenAI-compatible local engine separately. For llama.cpp, a representative command is:

```bash
llama-server --model /absolute/path/to/model.gguf --alias bolt-local \
  --host 127.0.0.1 --port 8080 --ctx-size 16384 --n-predict 4096
```

Use an instruction/coding model suitable for the machine's RAM/GPU and the desired tasks. For native tool calls, select an engine/chat template and model that support OpenAI-style tools. A configured endpoint does not establish model quality, available context or tool-call reliability.

In **File → Inference settings**, choose **OpenAI-compatible**, base URL `http://127.0.0.1:8080/v1`, and actual model ID `bolt-local` or the ID returned by `/v1/models`. Leave the key blank for a keyless loopback engine. Saving applies settings and restarts the local backend; it is not a fabricated inference-health check. HTTP is allowed only for literal loopback hosts; remote compatible providers require HTTPS. URL credentials, query strings, fragments and redirects are denied.

Environment configuration also works before any settings are saved:

```bash
LLM_PROVIDER=openai-compatible \
LLM_BASE_URL=http://127.0.0.1:8080/v1 \
LLM_MODEL=bolt-local \
pnpm --dir desktop start
```

Windows PowerShell equivalent:

```powershell
$env:LLM_PROVIDER = 'openai-compatible'
$env:LLM_BASE_URL = 'http://127.0.0.1:8080/v1'
$env:LLM_MODEL = 'bolt-local'
# Launch the installed Bolt Cog Desktop executable from this shell.
```

Saved preferences take precedence. A direct Anthropic provider remains optional and connects from the local backend to Anthropic, not through Cloudflare. Its default model remains the previously verified Haiku unless configured otherwise. Model/provider keys stay in main/utility processes; they are never VITE variables, bundled secrets or renderer storage.

Persistent keys are encrypted through Electron safeStorage. Linux `basic_text`, unavailable or unknown key storage refuses persistent secrets. The settings dialog supports a memory-only session key or an environment variable instead. Key fields return only configured-state booleans, not stored plaintext/ciphertext. POSIX files use mode0600; Windows relies on user-profile access control and OS secret encryption, not POSIX permission-bit claims.

Changing an OpenAI-compatible endpoint clears that endpoint's saved/session key rather than transferring it to the new URL. An environment key is used only when its associated `LLM_BASE_URL` matches the selected endpoint. Re-enter a new endpoint's key explicitly. Saving settings never disguises a failed backend restart as success.

## Execution and storage boundaries

The local server uses a fresh random per-launch capability, exact Host validation and same-origin checking. Main injects that capability only into requests to the current loopback origin; it is not a renderer Node API or reusable remote bearer token. The loopback port is saved for stable IndexedDB/chat workspace origins between launches. A occupied saved port fails closed rather than connecting to another service. The app has a single-instance lock and graceful backend shutdown.

The primary app renderer still has Node disabled, process sandboxing, context isolation and web security enabled. Only a separate exact local settings document receives two validated settings IPC methods. It has an isolated session and rejects remote/iframe senders. There is no general-purpose preload, unrestricted filesystem bridge, host shell or sudo grant.

The chat has an opt-in **Local read-only Agent-Zero tools** checkbox. Its trusted server context binds to one desktop workspace; a Cloudflare request cannot enable that adapter by adding a JSON field. The adapter invokes the actual fixed native identity utility with `shell:false`, reads real OS information, and lists only the dedicated user-data workspace. It limits calls, output and process runtime and records filesystem audit receipts. Arbitrary shell commands, package installs, deletions and file-content access are not automatically granted. Read operations can expose local identity/system information to the selected model provider; leave tools off unless requested.

The existing WebContainer editor/terminal/preview path is retained and runs in the browser sandbox. Application assets and `/api/chat` are local, but the WebContainer vendor runtime distribution, preview proxy origins and npm/package downloads can still require network access. This version removes the Cloudflare **application-hosting** dependency; it is not a fully air-gapped replacement for every third-party browser-engine service. It does not silently reimplement a neural/cognitive feature as fake local code. Native unrestricted terminal migration requires a separately reviewed workspace-isolated executor.

Local application responses include COOP `same-origin`, COEP `require-corp` and CORP `same-origin`. Actual local Electron isolation has been observed as `crossOriginIsolated:true`, unlike the former Access login page. WebContainer boot/process/preview results must be measured independently; headers alone are not proof.

## Build and validate

```bash
pnpm install --frozen-lockfile
pnpm --dir desktop install --frozen-lockfile
pnpm run build:desktop
pnpm typecheck
pnpm test
pnpm --dir desktop test
pnpm --dir desktop start
pnpm --dir desktop exec electron-builder --linux --arm64 --publish never
```

Use the corresponding native installer targets for other OS/architectures. `build:desktop` performs the real Remix build without Cloudflare dev proxy and bundles all server dependencies plus the client into `desktop/runtime`; no Node/pnpm installation is required by the packaged app. Runtime output is generated and ignored by Git, then included as installer resources. Build dependencies must be installed at source-build time.

A deterministic source/version fingerprint is stored in the runtime manifest. Electron Builder's `beforePack` guard rejects missing or stale runtime payloads even if a user runs the packager directly. Rebuild after changing app, public assets, desktop code or the dependency/build configuration.

`desktop/tests/local-runtime.cjs` executes the actual bundled Remix handler, checks unauthorized/foreign-host/foreign-origin requests, verifies missing-provider errors rather than synthetic success, and runs the actual Agent-Zero identity process. Model SDK fixtures remain clearly labelled; they are not live inference evidence.

The release matrix builds the full runtime on all five platforms. The separate Linux-runner integration executes only on Linux; portable application and desktop tests run on every platform. Packaged Linux smoke verifies actual local loading, isolation and absence of hosted-app requests. A deliberate local smoke flag can additionally run a disposable WebContainer Node process and preview server. A real inference check needs an installed live model endpoint and `BOLT_DESKTOP_SMOKE_CHAT=1`; CI does not invent a model when none is available.

The installers remain unsigned and macOS is not notarized unless reviewed signing configuration is added. Packaging, OS GUI acceptance, endpoint readiness and inference quality are distinct checks. The original hosted model settings, root dependency vulnerabilities and broader Beast-Mode/GGML scaffolding are not automatically repaired by changing the desktop transport.

## Sources

- [Electron utility process](https://electronjs.org/docs/latest/api/utility-process)
- [Remix runtime/adapters](https://v2.remix.run/docs/discussion/runtimes/)
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)
- [llama.cpp](https://github.com/ggml-org/llama.cpp)
