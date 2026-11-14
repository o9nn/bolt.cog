import { env as processEnv } from 'node:process';

export const DEFAULT_ANTHROPIC_MODEL = 'claude-3-haiku-20240307';

type ProviderName = 'anthropic' | 'openai-compatible';
type ProviderEnvKey =
  | 'ANTHROPIC_API_KEY'
  | 'ANTHROPIC_MODEL'
  | 'LLM_PROVIDER'
  | 'LLM_BASE_URL'
  | 'LLM_MODEL'
  | 'LLM_API_KEY';

export type LLMConfig =
  | { provider: 'anthropic'; model: string; apiKey: string }
  | { provider: 'openai-compatible'; model: string; apiKey: string; baseURL: string };

/** Only trusted server bindings/process variables may select the provider or endpoint. */
function setting(serverEnv: Env, name: ProviderEnvKey): string {
  // an explicit empty binding must not inherit a credential or endpoint from the process
  const value = serverEnv[name] ?? processEnv[name];

  if (value !== undefined && typeof value !== 'string') {
    throw new Error(`${name} must be a string server environment binding.`);
  }

  return value?.trim() ?? '';
}

function providerName(serverEnv: Env): ProviderName {
  const provider = setting(serverEnv, 'LLM_PROVIDER') || 'anthropic';

  if (provider !== 'anthropic' && provider !== 'openai-compatible') {
    throw new Error('LLM_PROVIDER must be anthropic or openai-compatible.');
  }

  return provider;
}

/** Validate without including the supplied URL (which might contain a secret) in errors. */
export function validateLLMBaseURL(value: string): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error('LLM_BASE_URL must be an absolute HTTP or HTTPS URL.');
  }

  if (!/^https?:\/\//i.test(value) || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    throw new Error('LLM_BASE_URL must be an absolute HTTP or HTTPS URL.');
  }

  const authority = value.match(/^https?:\/\/([^/?#]+)/i)?.[1] ?? '';

  if (url.username || url.password || authority.includes('@') || value.includes('?') || value.includes('#')) {
    throw new Error('LLM_BASE_URL must not contain credentials, a query string, or a fragment.');
  }

  if (/[\s\\]/.test(value)) {
    throw new Error('LLM_BASE_URL must not contain whitespace or backslashes.');
  }

  // require the explicit loopback names, not arbitrary LAN addresses or numeric aliases
  const hostname = authority.match(/^(\[[^\]]+\]|[^:]+)(?::\d+)?$/)?.[1]?.toLowerCase();

  if (url.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(hostname ?? '')) {
    throw new Error('LLM_BASE_URL requires HTTPS except for HTTP on 127.0.0.1, localhost, or [::1].');
  }

  return url.href.replace(/\/+$/, '');
}

/** Return the selected provider's key only; no dummy key or cross-provider fallback. */
export function getAPIKey(serverEnv: Env): string {
  const name = providerName(serverEnv) === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'LLM_API_KEY';
  const apiKey = setting(serverEnv, name);

  if (/[\x00-\x1f\x7f]/.test(apiKey)) {
    throw new Error(`${name} must not contain control characters.`);
  }

  return apiKey;
}

export function getLLMConfig(serverEnv: Env): LLMConfig {
  const provider = providerName(serverEnv);
  const apiKey = getAPIKey(serverEnv);

  if (provider === 'anthropic') {
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is required for the Anthropic provider.');
    }

    return { provider, apiKey, model: setting(serverEnv, 'ANTHROPIC_MODEL') || DEFAULT_ANTHROPIC_MODEL };
  }

  const baseURL = setting(serverEnv, 'LLM_BASE_URL');
  const model = setting(serverEnv, 'LLM_MODEL');

  if (!baseURL) {
    throw new Error('LLM_BASE_URL is required for the openai-compatible provider.');
  }

  if (!model) {
    throw new Error('LLM_MODEL is required for the openai-compatible provider; no model is inferred.');
  }

  return { provider, apiKey, model, baseURL: validateLLMBaseURL(baseURL) };
}

/** Historical name: true means a valid provider configuration, not proven endpoint health. */
export function hasAPIKey(serverEnv: Env): boolean {
  try {
    getLLMConfig(serverEnv);
    return true;
  } catch {
    return false;
  }
}
