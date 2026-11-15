import { randomUUID } from 'node:crypto';
import { streamText } from 'ai';
import { getModel } from '../app/lib/.server/llm/model';
import { getLLMConfig } from '../app/lib/.server/llm/api-key';
import { classifyProviderFailure } from '../app/lib/.server/llm/provider-errors';
import { requiresModernAnthropicTextAdapter } from '../app/lib/.server/llm/anthropic-compat';
import { createDiagnosticRecorder } from './diagnostics';

export async function probeProvider(env: Env, diagnosticFile: string) {
  const requestId = randomUUID();
  const abort = new AbortController();
  let timer = setTimeout(() => abort.abort(), 30_000);
  let configured = false;
  try {
    const configuration = getLLMConfig(env);
    configured = true;
    if (configuration.provider === 'anthropic' && requiresModernAnthropicTextAdapter(configuration.model)) {
      clearTimeout(timer);
      timer = setTimeout(() => abort.abort(), 120_000);
    }
    const result = await streamText({
      model: getModel(env),
      messages: [{ role: 'user', content: 'Reply with Ready.' }],
      maxTokens: configuration.provider === 'anthropic' && requiresModernAnthropicTextAdapter(configuration.model) ? 4096 : 32,
      maxRetries: 0,
      abortSignal: abort.signal,
    });
    let characters = 0;
    for await (const part of result.fullStream) {
      if (part.type === 'error') throw part.error;
      if (part.type === 'text-delta') characters += part.textDelta.length;
    }
    if (!characters) throw new Error('Provider returned no text');
    return {
      ok: true,
      requestId,
      message:
        'A real short inference request succeeded using your selected provider, key and model. This verifies connectivity and text generation, not the full Bolt prompt or tool-call support.',
    };
  } catch (error) {
    const failure = configured
      ? classifyProviderFailure(error, abort.signal.aborted)
      : {
          status: 503,
          code: 'PROVIDER_CONFIG',
          message:
            'Provider configuration is incomplete or invalid. Select a provider and exact model ID; Anthropic also requires a valid API key.',
        };
    await createDiagnosticRecorder(diagnosticFile)({ requestId, phase: 'probe', failure });
    return { ok: false, requestId, code: failure.code, message: `${failure.message} [request ${requestId}]` };
  } finally {
    clearTimeout(timer);
  }
}
