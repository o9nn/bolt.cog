import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { DEFAULT_ANTHROPIC_MODEL, getLLMConfig } from './api-key';

export function getAnthropicModel(apiKey: string, modelId = DEFAULT_ANTHROPIC_MODEL) {
  return createAnthropic({ apiKey })(modelId);
}

export function getModel(serverEnv: Env) {
  const config = getLLMConfig(serverEnv);

  if (config.provider === 'anthropic') {
    return getAnthropicModel(config.apiKey, config.model);
  }

  const openai = createOpenAI({
    baseURL: config.baseURL,
    compatibility: 'compatible',

    // SDK 0.0.66 accepts an empty string, preventing implicit OPENAI_API_KEY fallback
    apiKey: config.apiKey,
    fetch: (input, init) => {
      const headers = new Headers(init?.headers);

      if (!config.apiKey) {
        // an unauthenticated local endpoint needs neither a fake key nor an empty Bearer header
        headers.delete('authorization');
      }

      // redirects must not bypass endpoint validation or move credentials to another URL
      return globalThis.fetch(input, { ...init, headers, redirect: 'error' });
    },
  });

  // explicit chat selection keeps tools on the real adapter, even for arbitrary local model IDs
  return openai.chat(config.model);
}
