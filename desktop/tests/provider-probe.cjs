'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { probeProvider } = require('../runtime/probe.cjs');
// These are failure-transport fixtures for the real adapter, not fabricated model-success tests.
async function withFixture(t, errorType, message, status) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bolt-provider-errors-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const previous = global.fetch;
  global.fetch = async (input, init) => {
    assert.equal(String(input), 'https://api.anthropic.com/v1/messages');
    assert.equal(new Headers(init.headers).get('x-api-key'), 'fixture-key-never-live');
    const request = JSON.parse(init.body);
    assert.equal(request.model, 'fixture-model-no-live-request');
    assert.equal(request.max_tokens, 32);
    return new Response(JSON.stringify({ request_id: 'req_safe_fixture', type: 'error', error: { type: errorType, message } }), { status, headers: { 'content-type': 'application/json', 'request-id': 'req_safe_fixture' } });
  };
  t.after(() => { global.fetch = previous; });
  const file = path.join(directory, 'audit', 'chat-diagnostics.jsonl');
  const result = await probeProvider({ ANTHROPIC_API_KEY: 'fixture-key-never-live', ANTHROPIC_MODEL: 'fixture-model-no-live-request', LLM_PROVIDER: 'anthropic' }, file);
  const saved = fs.readFileSync(file, 'utf8');
  assert.equal(result.ok, false);
  assert.equal(JSON.parse(saved).requestId, result.requestId);
  assert.equal(JSON.parse(saved).phase, 'probe');
  assert.equal(JSON.parse(saved).upstreamRequestId, 'req_safe_fixture');
  for (const sensitive of ['fixture-key-never-live', 'fixture-model-no-live-request', 'PRIVATE_BODY', 'Reply with Ready', 'api.anthropic.com']) {
    assert.equal(saved.includes(sensitive), false);
    assert.equal(result.message.includes(sensitive), false);
  }
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  return result;
}
test('real Anthropic SDK400 billing failure produces private safe diagnostic receipt', async (t) => {
  assert.equal((await withFixture(t, 'invalid_request_error', 'Your credit balance is too low PRIVATE_BODY', 400)).code, 'PROVIDER_BILLING');
});
test('real Anthropic SDK400 ordinary validation failure is not called an auth or billing failure', async (t) => {
  assert.equal((await withFixture(t, 'invalid_request_error', 'Unsupported request PRIVATE_BODY', 400)).code, 'PROVIDER_REQUEST');
});
test('real Anthropic SDK401 failure retains actionable credentials status', async (t) => {
  assert.equal((await withFixture(t, 'authentication_error', 'PRIVATE_BODY', 401)).code, 'PROVIDER_AUTH');
});
test('real Anthropic SDK529 failure retains service-overload category', async (t) => {
  assert.equal((await withFixture(t, 'overloaded_error', 'PRIVATE_BODY', 529)).code, 'PROVIDER_UNAVAILABLE');
});
test('missing model/provider is a configuration failure, never a simulated inference pass', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bolt-provider-missing-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const result = await probeProvider({ LLM_PROVIDER: 'openai-compatible', LLM_BASE_URL: 'http://127.0.0.1:8080/v1', LLM_MODEL: '', LLM_API_KEY: '' }, path.join(directory, 'diagnostics.jsonl'));
  assert.equal(result.ok, false); assert.equal(result.code, 'PROVIDER_CONFIG');
});
