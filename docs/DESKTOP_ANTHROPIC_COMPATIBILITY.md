# Desktop0.2.1 — Opus5.5 compatibility and safe diagnostics

## Confirmed0.2.0 defects

The user configured the valid current Anthropic model ID `claude-opus-5-5`. A network-denied inspection of the installed0.2.0 AI SDK adapter's request showed `temperature:0`. Anthropic's [Opus5.5 migration guide](https://platform.claude.com/docs/en/models/opus-5-5/migration-guide) explicitly requires omission of `temperature`, `top_p` and `top_k`; sending these parameters returns HTTP400. The same installed adapter supports only text/tool content blocks and throws on modern thinking/signature deltas. Opus5.5 always produces adaptive-thinking blocks. Fixing only temperature would therefore leave a stream-parser defect.

The old route masks unrecognized provider statuses, including400, and transport/TLS failures behind `Chat initialization failed [request UUID]`. The UUID is not an encoded diagnosis, and0.2.0 did not persist chat-provider diagnostics. These are confirmed code/protocol defects, but the user's original upstream HTTP status was not captured, so billing, account access or connectivity issues cannot be ruled out. No key has been requested from the user, and no successful live Opus5.5 inference is claimed.

## Narrow compatibility repair

The exact `claude-opus-5-5` profile keeps that model, uses the real Anthropic API and preserves provider text/error/usage events. It removes rejected sampling fields and the old tool-beta header, normalizes SSE newline framing, and filters only thinking/redacted-thinking blocks for the explicitly text-only legacy UI. It never invents a model answer, silently swaps models or disables mandatory reasoning. Other model IDs and the actual local OpenAI-compatible adapter retain their existing behavior.

**Native Agent-Zero tool loops are blocked for this profile.** The old AI SDK/chat history protocol cannot preserve signed thinking blocks across tool roundtrips, which the modern API requires. Both the route and adapter fail closed before dispatch. Enable those tools only after a full signed-thinking-capable SDK/history migration and tests. Browser Bolt artifact actions and the WebContainer terminal remain separate existing functionality; they do not imply native sudo.

Assistant-prefill continuation is disabled for this model, because Opus5.5 rejects it. The text chat uses one provider step, a16,384-token output cap including reasoning, and a300-second overall deadline with user abort propagation. The provider connection test uses a4,096-token cap and120-second deadline for Opus5.5; other providers retain a32-token/30-second probe. These are ceilings, not promised usage, and real API calls are billed for actual usage. A long reasoning phase can appear as a pause because the text-only UI does not display reasoning content. Truncated output is not fabricated or automatically continued with an invalid assistant prefill.

## How to test your installation

1. Install the0.2.1 diagnostic build when available;0.2.0 installers are immutable and were not overwritten.
2. Open **File → Inference settings**. Choose **Anthropic**, keep `claude-opus-5-5`, and enter your API key privately. Check the key's API workspace has credit and spending capacity; a Claude chat subscription is not API credit. Saving settings restarts Bolt's local backend but is not an inference test.
3. Turn **Local read-only Agent-Zero tools off**, and start a fresh text chat.
4. Use **File → Test provider connection…**. The native confirmation explains that one genuine short prompt will be sent and may consume API credit. The same model/provider adapter is used as chat. Success verifies small text inference, not full-project quality or tool-call support.
5. If it fails, use **File → Open diagnostics folder**. Provide only the safe receipt for that request from `chat-diagnostics.jsonl`: request UUID, status/code and optional allowlisted upstream error type/request ID or transport code. Never send your API key, full headers, environment dump, raw provider exception or private chat history.

Error categories distinguish request/model, authentication/permissions, billing/spend, rate limit, context, TLS, connection, timeout and service overload. A400 alone is not labelled billing unless its provider metadata matches a billing rejection. Logs are local, metadata-only, best effort, private on POSIX, and rotated at1MiB with one backup. No raw error/message/body, prompt, generated answer, endpoint URL, model ID or API credential is stored. These logs are diagnostic receipts, not tamper-proof forensic evidence.

## Validation boundaries

Network-denied failure fixtures validate the installed SDK's400/401/529 error transport and private receipts. Modern stream fixtures exercise real adapter framing with reasoning blocks, fragmented UTF8, final provider text/usage, errors, forbidden tool histories and prefill. They are protocol tests, not proof of live Opus5.5 generation. A separately installed real llama.cpp model is used to verify local inference still functions; that is not an Opus substitution or proof of this user's Anthropic account health.

The previously successful five-platform0.2.0 packaging run remains historical evidence. The shared general-CI action now uses Node22, matching the validated desktop matrix, rather than the old Node20.15.1 that failed loading ESM dependencies. Historical failed runs are not erased and no test is suppressed.

Remaining release gates still apply: unsigned Windows/macOS distribution and no macOS notarization; native Windows/macOS end-user runtime/keyring acceptance; workspace persistence/export recovery; realistic coding-model/tool reliability; dependency vulnerabilities; existing broader cognitive scaffolding. Renderer Node denial, context isolation, sandboxing, exact loopback capabilities, endpoint-scoped encrypted keys, redirect refusal and native read-only policy remain unchanged. No TLS verification bypass, unrestricted host terminal, sudo bridge, automatic updater or fully offline vendor WebContainer guarantee is added.
