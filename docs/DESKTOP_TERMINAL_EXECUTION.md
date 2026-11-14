# Desktop built-in terminal repair — v0.2.2

## What was broken

In v0.2.1, assistant shell actions spawned real WebContainer processes, but their stdout/stderr went to the browser console rather than the visible terminal. The visible terminal was a separate interactive JSH process. Shell readiness handling required an OSC marker in one output chunk, discarded early input, and lacked owned-process cleanup. Terminal refs accumulated during renders; resizing targeted every terminal. Persistent preview processes blocked subsequent actions, and Stop's workbench implementation was TODO.

The native Agent-Zero checkbox was offered for Opus 5.5 despite its deliberate signed-thinking/native-tool restriction. That restriction does **not** prohibit WebContainer shell actions. The old UI wording made the distinction unclear.

## Repaired execution path

**Real model → `/api/chat` stream → completed `boltAction` → ActionRunner → real WebContainer JSH → actual output and exit → Assistant xterm and execution receipt.**

The new **Assistant** tab shows the actual assistant process output. **Terminal**, **Terminal 2**, and **Terminal 3** retain independent interactive JSH sessions. Both paths use the same WebContainer workspace; neither is a host OS/root terminal. The Assistant output tab is deliberately read-only, not falsely presented as the user's interactive process.

Shell actions record actual exit codes. A nonzero exit is failed and does not poison the queue. Completed, bounded assistant receipts are attached as untrusted JSON to the next user turn, allowing the real model to respond to execution evidence rather than its own generated text. Manual-terminal output is not automatically sent. At most four new receipts, with 3,072-character output tails each, are attached per turn; previous turns remain in conversation history. Do not print secrets or paste them into chat.

No model weights, neural inference engine, provider defaults, or user's Anthropic settings are changed by this terminal patch. Invalid model output is not coerced into commands. Markdown code fences are not executable actions.

## Using the fix

1. Install the v0.2.2 preview and keep **File → Inference settings** configured for your provider, key, and exact model ID.
2. Ask: **Use the built-in terminal to run `node -v` and `pwd`. Emit complete shell actions.**
3. Watch **Assistant** for the command, actual output, and exit status. A new shell prompt in **Terminal** is not evidence that the assistant's command executed; its own receipt is.
4. For manual input, select **Terminal**, type `node -v`, and press Enter.
5. Ask a follow-up about the output; the next request receives the actual assistant receipt.

For Opus 5.5, native Agent-Zero tools remain disabled by the text-only adapter. The UI now explains that the built-in browser terminal remains available. Do not disable isolation or signed-thinking safeguards to obtain host sudo.

## Preview lifecycle and Stop

Finite installs, builds, and tests use ordinary shell actions. Persistent preview servers use explicit background/port metadata:

```xml
<boltArtifact id="preview" title="Start preview">
  <boltAction type="shell" background="true" port="5173">npm run dev -- --host 0.0.0.0 --port 5173</boltAction>
</boltArtifact>
```

Background startup has a 30-second bound. Only an actual `server-ready` event for the specified port releases the queue. The UI records **started**, not **complete**; a banner or successful spawn is not startup proof. The process remains owned for output, eventual exit, and cancellation. A visible terminal-panel **Stop** button remains available after chat streaming ends. Stop cancels owned assistant processes; it does not kill unrelated interactive sessions or host processes.

Cold WebContainer boot has a separate 90-second bound. Interactive shell OSC readiness has a 15-second bound. Foreground commands have a five-minute bound. Per-container port reservations prevent two owned background actions claiming the same port. WebContainer events identify port/URL, not PID: this is lifecycle evidence, not PID-level security attestation.

## Safety and remaining limits

Electron renderer sandbox, context isolation, web security, authenticated loopback hosting, and COOP/COEP are unchanged. No unrestricted native command IPC, host shell, sudo, native binaries, or privilege elevation is added.

Artifact file paths must be workspace-relative; absolute/traversal/directory/markup paths are rejected. This is **not** a claim that arbitrary shell actions are read-only. They can modify or delete WebContainer workspace files. Review destructive requests and avoid untrusted command/prompt content.

The app/backend is locally bundled, but WebContainer runtime/preview machinery still depends on StackBlitz services. This is not a fully offline native terminal. Provider errors remain separate: use **File → Test inference connection** and sanitized diagnostics.

Windows/macOS hands-on terminal checks, installer signing/notarization, authenticated updates, long-running preview stress, and restored-conversation command lifecycle remain validation gates. A five-platform CI package build is not interactive execution proof on every platform. A working terminal does not prove every model follows the artifact protocol.

## Reproducible tests

```bash
pnpm test
pnpm typecheck
pnpm --dir desktop test
node desktop/scripts/build-runtime.cjs
LLM_PROVIDER=openai-compatible LLM_BASE_URL=http://127.0.0.1:18080/v1 \
LLM_MODEL=your-real-model-alias BOLT_DESKTOP_SMOKE_TERMINAL=1 \
BOLT_DESKTOP_SMOKE_OUTPUT=/tmp/bolt-terminal-evidence pnpm --dir desktop smoke
```

Start a genuine inference server separately. The smoke submits through the actual Electron textarea. Its harmless request supplies explicit XML/code, and the actual neural response—not a mocked/coerced response—passes through the real parser, file writer, process, xterm, and exit handling. This verifies execution integration, not autonomous coding ability. It also tests interactive xterm input.

Set `BOLT_DESKTOP_SMOKE_FEEDBACK=1` for the separate real-model feedback-quality gate. That gate requires a completed, correct summary and no new commands. The tiny Qwen 0.5B test model received the actual receipt but failed this gate through repetitive/incomplete output; it was not patched or replaced to fabricate a pass. The delivered report keeps that failure separate from terminal execution results. The user's own Anthropic/Opus configuration remains unverified here.

Nonzero exit, queue recovery, background readiness, and Stop cases are explicitly labelled integration fixtures, but run against real WebContainer processes. Raw ANSI output is retained; colour codes are removed only for output comparisons. Diagnostic observers are installed only under the explicit loopback `terminal-smoke=1` flag. Normal launches do not expose their globals.

The source-fingerprint guard refuses stale runtime packaging. Rebuild after source changes, before installer creation. Consult the delivered validation report for observed results, exact source revision, and release state—not this procedure alone.
