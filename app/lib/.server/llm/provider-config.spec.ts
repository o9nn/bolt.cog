import { createServer, type IncomingHttpHeaders, type Server, type ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tool } from 'ai';
import { z } from 'zod';
import { DEFAULT_ANTHROPIC_MODEL, getAPIKey, getLLMConfig, hasAPIKey, validateLLMBaseURL } from './api-key';
import { getModel } from './model';
import { streamText } from './stream-text';

const ENV_NAMES = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'LLM_PROVIDER',
  'LLM_BASE_URL',
  'LLM_MODEL',
  'LLM_API_KEY',
  'OPENAI_API_KEY',
] as const;

const localEnv: Env = {
  LLM_PROVIDER: 'openai-compatible',
  LLM_BASE_URL: 'http://127.0.0.1:8080/v1',
  LLM_MODEL: 'fixture-model-not-an-inference-engine',
};

beforeEach(() => {
  // never depend on or print credentials from the developer's real environment
  for (const name of ENV_NAMES) {
    vi.stubEnv(name, undefined);
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('trusted server provider configuration', () => {
  it('retains Anthropic/Haiku defaults', () => {
    const env: Env = { ANTHROPIC_API_KEY: 'fixture-anthropic-key' };
    expect(getLLMConfig(env)).toEqual({
      provider: 'anthropic',
      model: DEFAULT_ANTHROPIC_MODEL,
      apiKey: 'fixture-anthropic-key',
    });
    expect(getModel(env).provider).toBe('anthropic.messages');
    expect(getModel(env).modelId).toBe('claude-3-haiku-20240307');
    expect(hasAPIKey(env)).toBe(true);
  });

  it('allows an explicit Anthropic model', () => {
    expect(getModel({ ANTHROPIC_API_KEY: 'fixture-key', ANTHROPIC_MODEL: 'explicit-model' }).modelId).toBe(
      'explicit-model',
    );
  });

  it('requires a real Anthropic key and never borrows a local provider key', () => {
    expect(hasAPIKey({})).toBe(false);
    expect(hasAPIKey({ ANTHROPIC_API_KEY: '   ', LLM_API_KEY: 'fixture-local-key' })).toBe(false);
    expect(() => getModel({})).toThrow('ANTHROPIC_API_KEY is required');
  });

  it('uses explicit bindings before process values, including intentionally empty keys', () => {
    vi.stubEnv('LLM_PROVIDER', 'anthropic');
    vi.stubEnv('LLM_BASE_URL', 'https://process.example/v1');
    vi.stubEnv('LLM_MODEL', 'process-model');
    vi.stubEnv('LLM_API_KEY', 'fixture-process-key');
    vi.stubEnv('ANTHROPIC_API_KEY', 'fixture-process-anthropic-key');
    expect(getLLMConfig({ ...localEnv, LLM_API_KEY: '' })).toEqual({
      provider: 'openai-compatible',
      baseURL: localEnv.LLM_BASE_URL,
      model: localEnv.LLM_MODEL,
      apiKey: '',
    });
    expect(hasAPIKey({ LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: '' })).toBe(false);
  });

  it('falls back to process fields only when bindings are absent', () => {
    vi.stubEnv('LLM_PROVIDER', 'openai-compatible');
    vi.stubEnv('LLM_BASE_URL', 'http://localhost:8080/v1/');
    vi.stubEnv('LLM_MODEL', 'process-fixture-model');
    expect(getLLMConfig({})).toEqual({
      provider: 'openai-compatible',
      baseURL: 'http://localhost:8080/v1',
      model: 'process-fixture-model',
      apiKey: '',
    });
  });

  it('an explicit empty provider selects the default rather than the process provider', () => {
    vi.stubEnv('LLM_PROVIDER', 'openai-compatible');
    expect(getLLMConfig({ LLM_PROVIDER: '', ANTHROPIC_API_KEY: 'fixture-key' } as unknown as Env).provider).toBe(
      'anthropic',
    );
  });

  it('does not infer a model from the endpoint, key, or provider', () => {
    vi.stubEnv('LLM_MODEL', 'process-fixture-model');

    const missingModel = { ...localEnv, LLM_MODEL: '' };
    expect(hasAPIKey(missingModel)).toBe(false);
    expect(() => getModel(missingModel)).toThrow('LLM_MODEL is required');
  });

  it('does not replace an explicit empty endpoint with a process endpoint', () => {
    vi.stubEnv('LLM_BASE_URL', 'http://localhost:8080/v1');
    expect(hasAPIKey({ ...localEnv, LLM_BASE_URL: '' })).toBe(false);
    expect(() => getModel({ ...localEnv, LLM_BASE_URL: '' })).toThrow('LLM_BASE_URL is required');
  });

  it('treats a keyless local endpoint with a model as configured, not as verified healthy', () => {
    expect(hasAPIKey(localEnv)).toBe(true);
    expect(getAPIKey(localEnv)).toBe('');
    expect(getModel(localEnv).modelId).toBe(localEnv.LLM_MODEL);
    expect(getModel(localEnv).specificationVersion).toBe('v1');
  });

  it('never borrows Anthropic or implicit OpenAI credentials for local requests', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'fixture-anthropic-key');
    vi.stubEnv('OPENAI_API_KEY', 'fixture-openai-key');
    expect(getAPIKey(localEnv)).toBe('');
  });

  it('rejects unsupported provider names without reflecting their values', () => {
    const env = { LLM_PROVIDER: 'fixture-secret-invalid-provider' } as unknown as Env;
    expect(hasAPIKey(env)).toBe(false);
    expect(() => getLLMConfig(env)).toThrow('LLM_PROVIDER must be anthropic or openai-compatible.');
  });

  it('rejects credential control characters without reflecting credentials', () => {
    expect(() => getLLMConfig({ ...localEnv, LLM_API_KEY: 'fixture-secret\r\nheader' })).toThrow(
      'LLM_API_KEY must not contain control characters.',
    );
  });
});

describe('LLM_BASE_URL policy', () => {
  it.each([
    'http://127.0.0.1:8080/v1',
    'http://localhost:5001/v1',
    'http://LOCALHOST:8080/v1',
    'http://[::1]:8080/v1',
    'https://127.0.0.1:8080/v1',
    'https://provider.example/v1',
  ])('accepts %s', (url) => {
    expect(validateLLMBaseURL(url)).toBe(new URL(url).href.replace(/\/+$/, ''));
    expect(hasAPIKey({ ...localEnv, LLM_BASE_URL: url })).toBe(true);
  });

  it.each([
    'http://192.168.1.2:8080/v1',
    'http://0.0.0.0:8080/v1',
    'http://provider.example/v1',
    'http://localhost.evil.example/v1',
    'http://127.0.0.2/v1',
    'http://127.1/v1',
    'http://2130706433/v1',
    'http://0x7f000001/v1',
    'http://localhost./v1',
    'http://[::ffff:127.0.0.1]/v1',
    'http://user:password@localhost:8080/v1',
    'https://fixture-secret@provider.example/v1',
    'http://@localhost:8080/v1',
    'http://localhost:8080/v1?key=fixture-secret',
    'http://localhost:8080/v1?',
    'https://provider.example/v1#fixture-secret',
    'https://provider.example/v1#',
    'http://localhost:8080/white space',
    'http://localhost:8080/\\path',
    'http:localhost:8080/v1',
    'http:///localhost:8080/v1',
    'file:///tmp/model',
    '/v1',
    'not-a-url',
  ])('rejects %s without echoing its value', (url) => {
    expect(hasAPIKey({ ...localEnv, LLM_BASE_URL: url })).toBe(false);
    expect(() => validateLLMBaseURL(url)).toThrow(/LLM_BASE_URL/);

    try {
      validateLLMBaseURL(url);
    } catch (error) {
      expect((error as Error).message).not.toContain(url);
      expect((error as Error).message).not.toContain('fixture-secret');
    }
  });
});

interface CapturedRequest {
  path?: string;
  method?: string;
  headers: IncomingHttpHeaders;
  body: Record<string, unknown>;
}

// these are protocol fixtures, NOT a model server or evidence of genuine inference
async function httpFixture(reply: (request: CapturedRequest, response: ServerResponse) => void) {
  const requests: CapturedRequest[] = [];
  const server: Server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];

    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk));
    }

    const captured: CapturedRequest = {
      path: request.url,
      method: request.method,
      headers: request.headers,
      body: JSON.parse(Buffer.concat(chunks).toString()),
    };
    requests.push(captured);
    reply(captured, response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('HTTP fixture did not bind a TCP port');
  }

  return {
    requests,
    env: { ...localEnv, LLM_BASE_URL: `http://127.0.0.1:${address.port}/v1` },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

function sseResponse(response: ServerResponse, deltas: unknown[], reason = 'stop') {
  response.writeHead(200, { 'content-type': 'text/event-stream' });

  for (const delta of deltas) {
    response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
  }

  response.end(
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: reason }] })}\n\ndata: [DONE]\n\n`,
  );
}

describe('real Anthropic adapter with a labelled offline transport fixture', () => {
  it('retains the cloud endpoint, Haiku model, real-key header, and 4096 output limit', async () => {
    const events = [
      { type: 'message_start', message: { usage: { input_tokens: 1, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Anthropic fixture only.' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
      { type: 'message_stop' },
    ];
    const fetchFixture = vi.fn(
      async () =>
        new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
          headers: { 'content-type': 'text/event-stream' },
        }),
    );
    vi.stubGlobal('fetch', fetchFixture);

    const result = await streamText(
      [{ role: 'user', content: 'Fixture' }],
      { ANTHROPIC_API_KEY: 'fixture-key' },
      {
        maxRetries: 0,
      },
    );
    await new Response(result.toDataStream()).text();
    expect(await result.text).toBe('Anthropic fixture only.');
    expect(fetchFixture).toHaveBeenCalledOnce();

    const [url, init] = (fetchFixture.mock.calls as unknown as [string, RequestInit][])[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(new Headers(init.headers).get('x-api-key')).toBe('fixture-key');
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: DEFAULT_ANTHROPIC_MODEL,
      max_tokens: 4096,
      stream: true,
    });
    expect(String(init.body)).not.toContain('fixture-key');
  });
});

describe('real SDK v3 OpenAI adapter with labelled HTTP protocol fixtures', () => {
  it('streams fixture text from the configured backend URL with the explicit model and 4096 output limit', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'fixture-must-not-leak');

    const fixture = await httpFixture((_, response) => sseResponse(response, [{ content: 'Fixture text only.' }]));

    try {
      const result = await streamText([{ role: 'user', content: 'Test fixture stream' }], fixture.env, {
        maxRetries: 0,
      });
      await new Response(result.toDataStream()).text();
      expect(await result.text).toBe('Fixture text only.');

      const request = fixture.requests[0];
      expect(request.path).toBe('/v1/chat/completions');
      expect(request.method).toBe('POST');
      expect(request.body.model).toBe(localEnv.LLM_MODEL);
      expect(request.body.max_tokens).toBe(4096);
      expect(request.body.stream).toBe(true);
      expect(request.body.stream_options).toBeUndefined();
      expect(request.headers.authorization).toBeUndefined();
      expect(request.headers['anthropic-beta']).toBeUndefined();
      expect(JSON.stringify(request.body)).not.toContain('fixture-must-not-leak');
    } finally {
      await fixture.close();
    }
  });

  it('sends an optional fixture key only in the backend authorization header', async () => {
    const fixture = await httpFixture((_, response) => sseResponse(response, [{ content: 'Authenticated fixture.' }]));

    try {
      const result = await streamText(
        [{ role: 'user', content: 'Fixture' }],
        { ...fixture.env, LLM_API_KEY: 'fixture-key' },
        {
          maxRetries: 0,
          maxTokens: 32,
          headers: { 'x-fixture-request': 'retained' },
        },
      );
      await new Response(result.toDataStream()).text();
      expect(await result.text).toBe('Authenticated fixture.');
      expect(fixture.requests[0].headers.authorization).toBe('Bearer fixture-key');
      expect(fixture.requests[0].headers['x-fixture-request']).toBe('retained');
      expect(fixture.requests[0].body.max_tokens).toBe(32);
      expect(JSON.stringify(fixture.requests[0].body)).not.toContain('fixture-key');
    } finally {
      await fixture.close();
    }
  });

  it('passes tool schemas, streamed arguments, execution results, and follow-up text through the real adapter', async () => {
    let step = 0;
    const fixture = await httpFixture((_, response) => {
      if (++step === 1) {
        sseResponse(
          response,
          [
            {
              tool_calls: [
                {
                  index: 0,
                  id: 'fixture-call',
                  type: 'function',
                  function: { name: 'inspect', arguments: '{"path":' },
                },
              ],
            },
            { tool_calls: [{ index: 0, function: { arguments: '"fixture.txt"}' } }] },
          ],
          'tool_calls',
        );
      } else {
        sseResponse(response, [{ content: 'Fixture tool receipt acknowledged.' }]);
      }
    });
    const execute = vi.fn(async ({ path }: { path: string }) => ({ fixture: true, path, receipt: 'fixture-receipt' }));

    try {
      const result = await streamText([{ role: 'user', content: 'Protocol fixture tool test' }], fixture.env, {
        maxRetries: 0,
        maxSteps: 2,
        tools: {
          inspect: tool({
            description: 'Fixture-only inspection',
            parameters: z.object({ path: z.string() }),
            execute,
          }),
        },
      });
      const frames = await new Response(result.toDataStream()).text();
      expect(frames).toContain('fixture-receipt');
      expect(await result.text).toBe('Fixture tool receipt acknowledged.');
      expect(execute).toHaveBeenCalledOnce();
      expect(execute.mock.calls[0][0]).toEqual({ path: 'fixture.txt' });
      expect(fixture.requests).toHaveLength(2);
      expect(fixture.requests[0].body.tools).toMatchObject([{ type: 'function', function: { name: 'inspect' } }]);
      expect(JSON.stringify(fixture.requests[1].body.messages)).toContain('fixture-receipt');
      expect((await result.steps)[0].toolResults).toMatchObject([
        { result: { fixture: true, receipt: 'fixture-receipt' } },
      ]);
    } finally {
      await fixture.close();
    }
  });

  it('propagates backend HTTP failure instead of synthesizing successful output', async () => {
    const fixture = await httpFixture((_, response) => {
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'Fixture backend unavailable', type: 'fixture_failure' } }));
    });

    try {
      await expect(streamText([{ role: 'user', content: 'Fixture' }], fixture.env, { maxRetries: 0 })).rejects.toThrow(
        'Fixture backend unavailable',
      );
    } finally {
      await fixture.close();
    }
  });

  it('never follows backend redirects that could bypass URL policy or leak credentials', async () => {
    const fixture = await httpFixture((_, response) => {
      response.writeHead(307, { location: 'http://localhost:1/untrusted' });
      response.end();
    });

    try {
      await expect(
        streamText(
          [{ role: 'user', content: 'Fixture' }],
          { ...fixture.env, LLM_API_KEY: 'fixture-key' },
          { maxRetries: 0 },
        ),
      ).rejects.toThrow();
      expect(fixture.requests).toHaveLength(1);
    } finally {
      await fixture.close();
    }
  });
});
