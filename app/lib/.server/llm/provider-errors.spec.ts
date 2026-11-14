import { describe, it, expect } from 'vitest';
import { classifyProviderFailure } from './provider-errors';

describe('sanitized provider diagnostics', () => {
  it.each([
    [400, 'PROVIDER_REQUEST'],
    [401, 'PROVIDER_AUTH'],
    [402, 'PROVIDER_BILLING'],
    [403, 'PROVIDER_AUTH'],
    [404, 'PROVIDER_MODEL'],
    [413, 'PROVIDER_CONTEXT'],
    [422, 'PROVIDER_REQUEST'],
    [429, 'PROVIDER_RATE_LIMIT'],
    [500, 'PROVIDER_UNAVAILABLE'],
    [504, 'PROVIDER_TIMEOUT'],
    [529, 'PROVIDER_UNAVAILABLE'],
  ])('classifies HTTP %s without raw provider content', (statusCode, code) => {
    const result = classifyProviderFailure({
      statusCode,
      message: 'PRIVATE_API_KEY',
      responseBody: 'PRIVATE_PROMPT',
      requestBodyValues: { messages: 'PRIVATE_PROMPT' },
    });
    expect(result.code).toBe(code);
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });
  it('recognizes an Anthropic400 billing response and retains only its safe request id/type', () => {
    const result = classifyProviderFailure({
      statusCode: 400,
      responseBody: JSON.stringify({
        request_id: 'req_test_fixture',
        type: 'error',
        error: { type: 'invalid_request_error', message: 'Your credit balance is too low. PRIVATE_API_KEY' },
      }),
    });
    expect(result).toMatchObject({
      code: 'PROVIDER_BILLING',
      upstreamStatus: 400,
      upstreamType: 'invalid_request_error',
      upstreamRequestId: 'req_test_fixture',
    });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });
  it.each([
    ['ECONNREFUSED', 'PROVIDER_CONNECTION'],
    ['ENOTFOUND', 'PROVIDER_CONNECTION'],
    ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'PROVIDER_TLS'],
    ['UND_ERR_CONNECT_TIMEOUT', 'PROVIDER_TIMEOUT'],
  ])('walks nested transport %s', (code, expected) => {
    expect(
      classifyProviderFailure(new TypeError('fetch failed', { cause: Object.assign(new Error('PRIVATE'), { code }) }))
        .code,
    ).toBe(expected);
  });
  it('unwraps nested SDK retry errors without serializing them', () => {
    expect(classifyProviderFailure({ name: 'AI_RetryError', lastError: { statusCode: 529 } }).code).toBe(
      'PROVIDER_UNAVAILABLE',
    );
  });
  it('keeps unknown errors private and avoids false timeout after ordinary failure', () => {
    expect(classifyProviderFailure(new Error('PRIVATE'))).toMatchObject({ code: 'CHAT_INITIALIZATION', status: 502 });
    expect(classifyProviderFailure(new Error('PRIVATE'), true).code).toBe('PROVIDER_TIMEOUT');
  });
  it('bounds cyclic causes and rejects untrusted provider request identifiers', () => {
    const error: any = { responseHeaders: { 'request-id': 'PRIVATE_API_KEY' } };
    error.cause = error;
    expect(classifyProviderFailure(error).upstreamRequestId).toBeUndefined();
  });
  it('recognizes context/tool rejection but never repeats request data', () => {
    expect(
      classifyProviderFailure({
        statusCode: 400,
        data: { error: { type: 'invalid_request_error', message: 'prompt is too long PRIVATE' } },
      }).code,
    ).toBe('PROVIDER_CONTEXT');
    expect(
      classifyProviderFailure({ statusCode: 400, data: { error: { message: 'tools are not supported PRIVATE' } } })
        .code,
    ).toBe('PROVIDER_TOOLS');
  });
});
