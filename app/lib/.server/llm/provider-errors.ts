export interface ProviderFailure {
  status: number;
  code: string;
  message: string;
  upstreamStatus?: number;
  upstreamType?: string;
  upstreamRequestId?: string;
  transportCode?: string;
}

const types = new Set([
  'invalid_request_error',
  'authentication_error',
  'billing_error',
  'permission_error',
  'not_found_error',
  'rate_limit_error',
  'overloaded_error',
  'api_error',
  'timeout_error',
  'request_too_large',
]);
const transports = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
]);

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

/** Inspect bounded exception metadata internally; return only fixed text and allowlisted codes. */
export function classifyProviderFailure(error: unknown, aborted = false): ProviderFailure {
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();
  let upstreamStatus: number | undefined;
  let upstreamType: string | undefined;
  let upstreamRequestId: string | undefined;
  let transportCode: string | undefined;
  let billing = false;
  let context = false;
  let tools = false;
  let timedOut = aborted;
  let fetchFailed = false;

  for (let count = 0; queue.length && count < 12; count++) {
    const value = queue.shift();

    if (seen.has(value)) {
      continue;
    }

    seen.add(value);

    const current = object(value);

    if (!current) {
      continue;
    }

    if (
      typeof current.statusCode === 'number' &&
      Number.isInteger(current.statusCode) &&
      current.statusCode >= 400 &&
      current.statusCode <= 599
    ) {
      upstreamStatus ??= current.statusCode;
    }

    if (typeof current.type === 'string' && types.has(current.type)) {
      upstreamType ??= current.type;
    }

    if (typeof current.code === 'string' && transports.has(current.code)) {
      transportCode ??= current.code;
    }

    if (current.name === 'AbortError' || current.name === 'TimeoutError') {
      timedOut = true;
    }

    const message = typeof current.message === 'string' ? current.message.slice(0, 8192) : '';
    billing ||= /credit balance|insufficient (?:credit|balance|fund)|billing|spend limit/i.test(message);
    context ||= /context (?:window|length|size)|prompt is too long|maximum context|too many tokens/i.test(message);
    tools ||= /tool_choice|tool use|function.calling|tools? (?:are|is) (?:not supported|unsupported)/i.test(message);
    fetchFailed ||= /fetch failed|network error|failed to fetch/i.test(message);

    const headers = object(current.responseHeaders);
    const id = current.request_id ?? headers?.['request-id'];

    if (typeof id === 'string' && /^req_[a-zA-Z0-9_-]{1,120}$/.test(id)) {
      upstreamRequestId ??= id;
    }

    for (const name of ['cause', 'lastError', 'error', 'data']) {
      if (current[name]) {
        queue.push(current[name]);
      }
    }

    if (Array.isArray(current.errors)) {
      queue.push(...current.errors.slice(-2));
    }

    if (typeof current.responseBody === 'string' && current.responseBody.length <= 32_768) {
      try {
        queue.push(JSON.parse(current.responseBody));
      } catch {
        /* Non-JSON provider bodies remain private. */
      }
    }
  }

  let result: Pick<ProviderFailure, 'status' | 'code' | 'message'>;

  if (billing || upstreamStatus === 402 || upstreamType === 'billing_error') {
    result = {
      status: 503,
      code: 'PROVIDER_BILLING',
      message:
        'The provider rejected billing or a spend limit. Check API credits and workspace spending limits for this key; a Claude chat subscription is not API credit.',
    };
  } else if (
    upstreamStatus === 401 ||
    upstreamStatus === 403 ||
    upstreamType === 'authentication_error' ||
    upstreamType === 'permission_error'
  ) {
    result = {
      status: 503,
      code: 'PROVIDER_AUTH',
      message:
        'Provider API credentials or permissions were rejected. Re-enter the API key and check its organization/workspace access in Inference settings.',
    };
  } else if (upstreamStatus === 404 || upstreamType === 'not_found_error') {
    result = {
      status: 503,
      code: 'PROVIDER_MODEL',
      message:
        "The configured model or API route is unavailable. Use an exact model ID from this key's models API; for local providers use a Base URL ending in /v1, not /chat/completions.",
    };
  } else if (context || upstreamStatus === 413) {
    result = {
      status: 400,
      code: 'PROVIDER_CONTEXT',
      message:
        'The provider rejected the prompt or context size. Start a shorter chat or increase the engine context if the model and available memory support it.',
    };
  } else if (tools) {
    result = {
      status: 400,
      code: 'PROVIDER_TOOLS',
      message:
        'This provider/model rejected tool options. Turn local Agent-Zero tools off for an initial text test and use a tool-compatible model/template before enabling them.',
    };
  } else if (upstreamStatus === 400 || upstreamStatus === 422 || upstreamType === 'invalid_request_error') {
    result = {
      status: 400,
      code: 'PROVIDER_REQUEST',
      message:
        'The provider rejected the chat request. Check the exact model ID, supported options and API billing. Use the provider connection test to isolate authentication and model access.',
    };
  } else if (upstreamStatus === 429 || upstreamType === 'rate_limit_error') {
    result = {
      status: 429,
      code: 'PROVIDER_RATE_LIMIT',
      message:
        'Provider rate or spending limit reached. Check the workspace limit and retry only after capacity is available.',
    };
  } else if (
    timedOut ||
    upstreamStatus === 504 ||
    upstreamType === 'timeout_error' ||
    transportCode?.includes('TIME')
  ) {
    result = {
      status: 504,
      code: 'PROVIDER_TIMEOUT',
      message:
        'The provider connection or generation timed out. Check engine readiness/network and use a smaller prompt or faster model; a bounded provider deadline was reached.',
    };
  } else if (transportCode && /CERT|SELF_SIGNED|VERIFY|ISSUER/.test(transportCode)) {
    result = {
      status: 502,
      code: 'PROVIDER_TLS',
      message:
        'The provider TLS certificate could not be verified. Check the system certificate trust and proxy configuration; do not disable TLS verification.',
    };
  } else if (transportCode || fetchFailed) {
    result = {
      status: 502,
      code: 'PROVIDER_CONNECTION',
      message:
        'The provider could not be reached. For Anthropic check HTTPS connectivity/proxy/firewall; for local inference start the engine on the configured loopback port.',
    };
  } else if (upstreamStatus && upstreamStatus >= 500) {
    result = {
      status: 503,
      code: 'PROVIDER_UNAVAILABLE',
      message: 'The provider is unavailable or overloaded. Retry later; no synthetic inference fallback was used.',
    };
  } else {
    result = {
      status: 502,
      code: 'CHAT_INITIALIZATION',
      message:
        'Chat initialization failed. Use the provider connection test and inspect the local diagnostic log for this request.',
    };
  }

  return {
    ...result,
    ...(upstreamStatus ? { upstreamStatus } : {}),
    ...(upstreamType ? { upstreamType } : {}),
    ...(upstreamRequestId ? { upstreamRequestId } : {}),
    ...(transportCode ? { transportCode } : {}),
  };
}
