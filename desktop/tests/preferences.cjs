'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createPreferences, DEFAULTS, PREFERENCES_FILENAME, validateEndpoint } = require('../preferences.cjs');
const { createSettings, SETTINGS_URL } = require('../settings.cjs');

// TEST DOUBLE ONLY. XOR is deliberately NOT real encryption. These tests prove
// safeStorage delegation and no plaintext persistence, NOT OS keyring availability.
function safeStorageTestDouble({ available = true, backend = 'gnome_libsecret' } = {}) {
  const calls = { encrypt: 0, decrypt: 0 };
  return {
    calls,
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => backend,
    encryptString(text) { calls.encrypt++; return Buffer.from(Buffer.from(`test-double:${text}`).map((byte) => byte ^ 0xa5)); },
    decryptString(bytes) {
      calls.decrypt++;
      const text = Buffer.from(bytes.map((byte) => byte ^ 0xa5)).toString('utf8');
      if (!text.startsWith('test-double:')) throw new Error('Invalid test-double ciphertext');
      return text.slice('test-double:'.length);
    }
  };
}
function fixture(t, safeStorage = safeStorageTestDouble()) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'bolt-cog-preferences-test-'));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  return { userData, safeStorage, file: path.join(userData, PREFERENCES_FILENAME), preferences: createPreferences({ userData, safeStorage }) };
}
const configured = (overrides = {}) => ({ ...DEFAULTS, model: 'actual-user-specified-model', ...overrides });

test('defaults have no invented model and load returns a config object, not JSON or secrets', (t) => {
  const { preferences, file } = fixture(t);
  assert.deepEqual(preferences.load(), DEFAULTS);
  assert.equal(preferences.providerEnv({}).LLM_MODEL, '');
  assert.equal(fs.existsSync(file), false);
  const snapshot = preferences.load(); snapshot.provider = 'anthropic';
  assert.equal(preferences.load().provider, 'openai-compatible');
  assert.equal(preferences.publicValues().apiKeyConfigured, false);
});

test('safeStorage TEST DOUBLE delegation, real atomic JSON0600 and plaintext absence', (t) => {
  const { preferences, safeStorage, file, userData } = fixture(t);
  const secret = 'unique-test-secret-238714';
  const values = preferences.save(configured({ apiKey: secret }));
  assert.equal(safeStorage.calls.encrypt, 1);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  else assert.equal(fs.statSync(file).isFile(), true); // Windows uses the user-profile ACL and OS-encrypted secret, not POSIX mode bits.
  assert.deepEqual(fs.readdirSync(userData), [PREFERENCES_FILENAME]);
  const bytes = fs.readFileSync(file, 'utf8');
  assert.equal(bytes.includes(secret), false);
  assert.equal(bytes.includes(Buffer.from(secret).toString('base64')), false);
  assert.equal(values.apiKeyStored, true);
  assert.equal(values.apiKeyConfigured, true);
  assert.equal(JSON.stringify(values).includes(secret), false);
  assert.equal(Object.hasOwn(values, 'encryptedKeys'), false);
  const fresh = createPreferences({ userData, safeStorage });
  assert.equal(fresh.providerEnv({}).LLM_API_KEY, secret);
  assert.ok(safeStorage.calls.decrypt > 0);
  assert.equal(JSON.stringify(fresh.load()).includes(secret), false);
});

test('empty key preserves encrypted bytes; explicit clear removes the selected provider only', (t) => {
  const { preferences, file } = fixture(t);
  preferences.save(configured({ apiKey: 'key-openai' }));
  const initial = JSON.parse(fs.readFileSync(file)).encryptedKeys['openai-compatible'];
  preferences.save(configured({ apiKey: '', model: 'second-model' }));
  assert.equal(JSON.parse(fs.readFileSync(file)).encryptedKeys['openai-compatible'], initial);
  preferences.save(configured({ provider: 'anthropic', apiKey: 'key-anthropic' }));
  assert.deepEqual(preferences.providerEnv({}), { ANTHROPIC_API_KEY: 'key-anthropic', ANTHROPIC_MODEL: 'actual-user-specified-model' });
  preferences.save(configured({ provider: 'anthropic', clearApiKey: true }));
  assert.equal(preferences.publicValues().apiKeyStored, false);
  assert.equal(preferences.providerEnv({ ANTHROPIC_API_KEY: 'environment-after-clear' }).ANTHROPIC_API_KEY, 'environment-after-clear');
  preferences.save(configured());
  assert.equal(preferences.providerEnv({}).LLM_API_KEY, 'key-openai');
});

for (const storage of [undefined, safeStorageTestDouble({ available: false }),
  ...(process.platform === 'linux' ? [safeStorageTestDouble({ backend: 'basic_text' }), safeStorageTestDouble({ backend: 'unknown' }),
    { ...safeStorageTestDouble(), getSelectedStorageBackend: undefined },
    { ...safeStorageTestDouble(), getSelectedStorageBackend() { throw new Error('No keyring'); } }] : [])]) {
  test('unavailable/unsafe secret storage refuses persistence and leaves the existing file untouched', (t) => {
    const { preferences, file } = fixture(t, storage);
    // fixture's default argument substitutes undefined; explicitly construct the missing-provider case.
    const prefs = storage === undefined ? createPreferences({ userData: path.dirname(file) }) : preferences;
    prefs.save(configured());
    const initial = fs.readFileSync(file, 'utf8');
    assert.throws(() => prefs.save(configured({ apiKey: 'must-never-persist' })), { code: 'SECRET_STORAGE_UNAVAILABLE' });
    assert.equal(fs.readFileSync(file, 'utf8'), initial);
    assert.equal(prefs.providerEnv({ LLM_API_KEY: 'env-fallback' }).LLM_API_KEY, 'env-fallback');
    prefs.save(configured({ apiKey: 'session-only-secret', persistApiKey: false }));
    assert.equal(fs.readFileSync(file, 'utf8').includes('session-only-secret'), false);
    assert.equal(prefs.providerEnv({ LLM_API_KEY: 'env-fallback' }).LLM_API_KEY, 'session-only-secret');
    assert.equal(prefs.publicValues().apiKeySession, true);
    const fresh = createPreferences({ userData: path.dirname(file), safeStorage: storage });
    assert.equal(fresh.providerEnv({}).LLM_API_KEY, '');
  });
}

test('session key survives empty saves but is not reused across providers or restarts', (t) => {
  const { preferences, userData, safeStorage } = fixture(t);
  preferences.save(configured({ apiKey: 'original-persisted' }));
  preferences.save(configured({ apiKey: 'temporary-key', persistApiKey: false }));
  assert.equal(preferences.publicValues().apiKeyStored, false);
  preferences.save(configured({ apiKey: '' }));
  assert.equal(preferences.providerEnv({}).LLM_API_KEY, 'temporary-key');
  preferences.save(configured({ provider: 'anthropic' }));
  assert.equal(preferences.providerEnv({}).ANTHROPIC_API_KEY, '');
  preferences.save(configured());
  assert.equal(preferences.providerEnv({}).LLM_API_KEY, 'temporary-key');
  assert.equal(createPreferences({ userData, safeStorage }).providerEnv({}).LLM_API_KEY, '');
});

test('encryption failure cannot modify existing configuration or commit a secret', (t) => {
  const { preferences, safeStorage, file } = fixture(t);
  preferences.save(configured());
  const original = fs.readFileSync(file, 'utf8');
  safeStorage.encryptString = () => { throw new Error('Secret should not escape error messages'); };
  assert.throws(() => preferences.save(configured({ apiKey: 'secret', model: 'new-model' })), { code: 'ENCRYPTION_FAILED' });
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  assert.equal(preferences.load().model, 'actual-user-specified-model');
});

test('locked ciphertext uses explicit environment fallback without unprotected decryption', (t) => {
  const { preferences, userData } = fixture(t);
  preferences.save(configured({ apiKey: 'stored-secret' }));
  const locked = safeStorageTestDouble({ available: false });
  const fresh = createPreferences({ userData, safeStorage: locked });
  assert.equal(fresh.providerEnv({ LLM_API_KEY: 'env-secret' }).LLM_API_KEY, 'env-secret');
  assert.equal(locked.calls.decrypt, 0);
  fresh.save(configured({ apiKey: '' }));
  assert.equal(fresh.publicValues().apiKeyStored, true);
});

for (const endpoint of ['http://127.0.0.1:8080/v1', 'http://localhost:8080/v1', 'http://[::1]:8080/v1', 'https://api.example.test/v1']) {
  test(`endpoint accepts allowed loopback HTTP or HTTPS: ${endpoint}`, () => assert.equal(validateEndpoint(endpoint), endpoint));
}
for (const endpoint of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/plain,test', 'ftp://localhost/v1',
  'http://127.4.5.6/v1', 'http://127.1/v1', 'http://2130706433/v1', 'http://0x7f000001/v1',
  'http://example.test/v1', 'http://localhost.evil.test/v1', 'http://0.0.0.0:8080/v1', 'http://[::ffff:127.0.0.1]/v1',
  'https://user:secret@example.test/v1', 'https://@example.test/v1', 'https://example.test/v1?token=x',
  'https://example.test/v1?', 'https://example.test/v1#fragment', 'https://example.test/v1#',
  'https://example.test\\@localhost/v1', ' https://example.test/v1', 'https://example.test/a b', 'not-a-url']) {
  test(`endpoint rejects unsafe scheme, credentials, query or host: ${endpoint}`, (t) => {
    const { preferences, file } = fixture(t);
    assert.throws(() => preferences.save(configured({ baseURL: endpoint })), { code: 'INVALID_CONFIG' });
    assert.equal(fs.existsSync(file), false);
  });
}
for (const changes of [{ provider: 'unknown' }, { baseURL: 'https://example.test/' + 'a'.repeat(2048) },
  { model: '' }, { model: 'm'.repeat(257) }, { model: 'space in id' }, { model: 'bad\nmodel' },
  { apiKey: 'a'.repeat(8193) }, { apiKey: 'spaces in secret' }, { apiKey: '\u0000bad' },
  { apiKey: null }, { clearApiKey: 'true' }, { persistApiKey: 1 }, { clearApiKey: true, apiKey: 'secret' },
  { secret: 'foreign-key' }, { apiKeyEncrypted: 'foreign' }, { constructor: 'foreign' }, { [Symbol('foreign')]: 'x' }]) {
  test('strict validation rejects foreign fields, bad types and oversized/control-character values', (t) => {
    const { preferences, file } = fixture(t);
    assert.throws(() => preferences.save(configured(changes)), { code: 'INVALID_CONFIG' });
    assert.equal(fs.existsSync(file), false);
  });
}

test('non-object and accessor input fail closed', (t) => {
  const { preferences } = fixture(t);
  for (const value of [null, [], 'json', new Date()]) assert.throws(() => preferences.save(value), { code: 'INVALID_CONFIG' });
  const input = configured(); Object.defineProperty(input, 'apiKey', { get() { throw new Error('Must not execute'); } });
  assert.throws(() => preferences.save(input), { code: 'INVALID_CONFIG' });
});

test('environment defaults and saved/session/environment precedence are provider-specific', (t) => {
  const { preferences } = fixture(t);
  const env = { LLM_PROVIDER: 'openai-compatible', LLM_BASE_URL: 'https://env.example.test/v1', LLM_MODEL: 'env-model', LLM_API_KEY: 'env-key',
    ANTHROPIC_API_KEY: 'anthropic-env-key', ANTHROPIC_MODEL: 'anthropic-env-model', OTHER_SECRET: 'must-not-return' };
  assert.deepEqual(preferences.providerEnv(env), { LLM_PROVIDER: 'openai-compatible', LLM_BASE_URL: env.LLM_BASE_URL, LLM_MODEL: 'env-model', LLM_API_KEY: 'env-key' });
  assert.deepEqual(preferences.providerEnv({ ANTHROPIC_API_KEY: 'a-key', ANTHROPIC_MODEL: 'a-model' }), { ANTHROPIC_API_KEY: 'a-key', ANTHROPIC_MODEL: 'a-model' });
  preferences.save(configured());
  assert.deepEqual(preferences.providerEnv(env), { LLM_PROVIDER: 'openai-compatible', LLM_BASE_URL: DEFAULTS.baseURL, LLM_MODEL: 'actual-user-specified-model', LLM_API_KEY: '' });
  preferences.save(configured({ apiKey: 'stored' }));
  assert.equal(preferences.providerEnv(env).LLM_API_KEY, 'stored');
  preferences.save(configured({ apiKey: 'session', persistApiKey: false }));
  assert.equal(preferences.providerEnv(env).LLM_API_KEY, 'session');
  preferences.save(configured({ provider: 'anthropic', apiKey: 'anthropic-stored' }));
  assert.deepEqual(preferences.providerEnv(env), { ANTHROPIC_API_KEY: 'anthropic-stored', ANTHROPIC_MODEL: 'actual-user-specified-model' });
});

test('unsafe environment URLs/fields are rejected, not forwarded', (t) => {
  const { preferences } = fixture(t);
  for (const env of [{ LLM_BASE_URL: 'file:///tmp/model' }, { LLM_PROVIDER: 'unknown' }, { LLM_MODEL: 'x'.repeat(257) }, { LLM_API_KEY: 'bad\nkey' }]) {
    assert.throws(() => preferences.providerEnv(env), { code: 'INVALID_CONFIG' });
  }
});

test('malformed/oversized/foreign plaintext stored records refuse load and overwrite', (t) => {
  const { preferences, file } = fixture(t);
  for (const contents of ['{', 'x'.repeat(65537), JSON.stringify({ version: 1, ...DEFAULTS, apiKey: 'plaintext', encryptedKeys: {} })]) {
    fs.writeFileSync(file, contents);
    assert.throws(() => preferences.load(), { code: 'READ_FAILED' });
    assert.throws(() => preferences.save(configured()), { code: 'READ_FAILED' });
    assert.equal(fs.readFileSync(file, 'utf8'), contents);
  }
});

test('failed write does not update memory and leaves no temporary secret file', (t) => {
  const { preferences, file, userData } = fixture(t);
  preferences.load();
  fs.mkdirSync(file);
  assert.throws(() => preferences.save(configured({ apiKey: 'never-commit-me' })), { code: 'WRITE_FAILED' });
  assert.deepEqual(preferences.load(), DEFAULTS);
  assert.deepEqual(fs.readdirSync(userData), [PREFERENCES_FILENAME]);
});

function electronTestDouble(t) {
  const { preferences, userData } = fixture(t);
  const handlers = new Map();
  const ipcMain = { handle(channel, fn) { assert.equal(handlers.has(channel), false); handlers.set(channel, fn); }, removeHandler(channel) { handlers.delete(channel); } };
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.destroyed = false;
      const session = new EventEmitter();
      session.setPermissionRequestHandler = (fn) => { session.request = fn; };
      session.setPermissionCheckHandler = (fn) => { session.check = fn; };
      session.setDevicePermissionHandler = (fn) => { session.device = fn; };
      session.webRequest = { onBeforeRequest(fn) { session.requestURL = fn; } };
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, { session, mainFrame: { url: SETTINGS_URL }, isDestroyed: () => this.destroyed,
        getURL: () => this.loadedURL, setWindowOpenHandler: (fn) => { this.openHandler = fn; } });
    }
    isDestroyed() { return this.destroyed; }
    show() { this.shown = true; }
    loadURL(url) { this.loadedURL = url; return Promise.resolve(); }
    close() { this.destroyed = true; this.emit('closed'); }
  }
  return { app: { getPath: () => userData }, BrowserWindow, ipcMain, preferences, handlers, safeStorage: safeStorageTestDouble() };
}
const trustedEvent = (window) => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
const channel = (fake, verb) => fake.handlers.get(`bolt-cog:settings:${verb}`);

test('dedicated window uses exact trusted URL, isolated session, sandbox and permissions/navigation denials', (t) => {
  const fake = electronTestDouble(t);
  const { window, preferences } = createSettings(fake, { preferences: fake.preferences });
  t.after(() => window.close());
  assert.equal(preferences, fake.preferences);
  assert.equal(window.loadedURL, SETTINGS_URL);
  const web = window.options.webPreferences;
  for (const key of ['sandbox', 'contextIsolation', 'webSecurity']) assert.equal(web[key], true);
  for (const key of ['nodeIntegration', 'nodeIntegrationInWorker', 'nodeIntegrationInSubFrames', 'webviewTag', 'devTools']) assert.equal(web[key], false);
  assert.match(web.preload, /settings-preload\.cjs$/);
  assert.equal(web.partition.startsWith('persist:'), false);
  const session = window.webContents.session;
  let permission; session.request({}, 'media', (value) => { permission = value; });
  assert.equal(permission, false); assert.equal(session.check(), false); assert.equal(session.device(), false);
  assert.deepEqual(window.openHandler({ url: 'https://evil.test' }), { action: 'deny' });
  for (const name of ['will-navigate', 'will-redirect', 'will-frame-navigate', 'will-attach-webview']) {
    let prevented = false; window.webContents.emit(name, { preventDefault() { prevented = true; } }, 'https://evil.test');
    assert.equal(prevented, true);
  }
  for (const url of [SETTINGS_URL, SETTINGS_URL.replace('settings.html', 'settings.js')]) {
    let result; session.requestURL({ url }, (value) => { result = value; }); assert.equal(result.cancel, false);
  }
  for (const url of ['https://evil.test', 'file:///etc/passwd', SETTINGS_URL + '?x', SETTINGS_URL + '#x']) {
    let result; session.requestURL({ url }, (value) => { result = value; }); assert.equal(result.cancel, true);
  }
});

test('read/save reject remote renderers, iframe senders, URL variants and missing frames before accessing prefs', async (t) => {
  const fake = electronTestDouble(t);
  const { window } = createSettings(fake, { preferences: fake.preferences });
  const read = channel(fake, 'read'); const save = channel(fake, 'save');
  const event = trustedEvent(window);
  assert.equal(read(event).ok, true);
  for (const untrusted of [{ sender: {}, senderFrame: event.senderFrame },
    { sender: event.sender, senderFrame: { url: SETTINGS_URL } }, // Even same-URL subframe is denied.
    { sender: event.sender, senderFrame: null }, {}]) {
    assert.throws(() => read(untrusted), /denied/);
    await assert.rejects(save(untrusted, configured()), /denied/);
  }
  for (const url of ['https://evil.test/', SETTINGS_URL + '#hash', SETTINGS_URL + '?query']) {
    window.webContents.mainFrame.url = url;
    assert.throws(() => read(event), /denied/);
    await assert.rejects(save(event, configured()), /denied/);
  }
  window.webContents.mainFrame.url = SETTINGS_URL;
  window.loadedURL = 'https://evil.test/';
  assert.throws(() => read(event), /denied/);
  window.close();
  assert.equal(fake.handlers.size, 0);
  await assert.rejects(save(event, configured()), /denied/);
});

test('save callback only runs after safe commit, exposes no secret, and distinguishes restart failure', async (t) => {
  const fake = electronTestDouble(t);
  let count = 0;
  const { window } = createSettings(fake, { preferences: fake.preferences, onSaved(preferences) {
    count++; assert.equal(preferences, fake.preferences); assert.equal(preferences.providerEnv({}).LLM_API_KEY, 'secret-ui-test');
    throw new Error('internal callback secret must not escape');
  } });
  t.after(() => window.close());
  const save = channel(fake, 'save'); const event = trustedEvent(window);
  const bad = await save(event, configured({ baseURL: 'file:///tmp/a' }));
  assert.equal(bad.ok, false); assert.equal(count, 0);
  const result = await save(event, configured({ apiKey: 'secret-ui-test', persistApiKey: false }));
  assert.equal(result.ok, true); assert.equal(result.saved, true); assert.equal(result.backendRestarted, false); assert.equal(count, 1);
  assert.match(result.message, /No inference was tested/);
  assert.equal(JSON.stringify(result).includes('secret-ui-test'), false);
  assert.equal(JSON.stringify(channel(fake, 'read')(event)).includes('secret-ui-test'), false);
});

test('save callback success and concurrent saves are correctly reported; multiple windows remain scoped', async (t) => {
  const fake = electronTestDouble(t); let release;
  const first = createSettings(fake, { preferences: fake.preferences, onSaved: () => new Promise((resolve) => { release = resolve; }) });
  const second = createSettings(fake, { preferences: fake.preferences });
  const save = channel(fake, 'save');
  const pending = save(trustedEvent(first.window), configured());
  assert.equal((await save(trustedEvent(first.window), configured())).ok, false);
  release(); assert.equal((await pending).backendRestarted, true);
  first.window.close(); assert.equal(fake.handlers.size, 2);
  assert.equal(channel(fake, 'read')(trustedEvent(second.window)).ok, true);
  second.window.close(); assert.equal(fake.handlers.size, 0);
});

test('sandbox-compatible preload exports exactly two fixed-channel methods, no raw IPC', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../settings-preload.cjs'), 'utf8');
  let exposed; const calls = [];
  vm.runInNewContext(source, { require(name) {
    assert.equal(name, 'electron'); return { contextBridge: { exposeInMainWorld(name, api) { assert.equal(name, 'localSettings'); exposed = api; } },
      ipcRenderer: { invoke(...args) { calls.push(args); return Promise.resolve({ ok: true }); } } };
  } });
  assert.deepEqual(Object.keys(exposed), ['read', 'save']);
  await exposed.read(); await exposed.save(configured());
  assert.equal(calls[0][0], 'bolt-cog:settings:read'); assert.equal(calls[1][0], 'bolt-cog:settings:save');
});

test('local HTML CSP denies network/frames/eval and renderer code has no Node or fake inference', () => {
  const html = fs.readFileSync(path.join(__dirname, '../settings.html'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '../settings.js'), 'utf8');
  assert.match(html, /default-src 'none'/); assert.match(html, /script-src 'self'/);
  assert.match(html, /connect-src 'none'/); assert.match(html, /frame-src 'none'/);
  assert.doesNotMatch(html, /unsafe-eval|<iframe|<webview|\son\w+=|<script>/);
  assert.match(html, /src="\.\/settings\.js"/);
  assert.doesNotMatch(script, /\beval\(|\brequire\(|\bfetch\(|innerHTML|ipcRenderer/);
  assert.match(script, /window\.localSettings\.read\(\)/);
  assert.match(script, /window\.localSettings\.save\(input\)/);
  assert.match(html, /does not verify connectivity or run inference/);
});

// Assigned-file manifest (only these six paths belong to this settings task):
// desktop/preferences.cjs
// desktop/settings.cjs
// desktop/settings-preload.cjs
// desktop/settings.html
// desktop/settings.js
// desktop/tests/preferences.cjs

test('changing compatible endpoint clears stored/session credentials and never borrows a different endpoint environment key', (t) => {
  const { preferences, file } = fixture(t);
  preferences.save(configured({ apiKey: 'old-endpoint-key' }));
  preferences.save(configured({ baseURL: 'https://new-endpoint.example.test/v1', apiKey: '' }));
  assert.equal(preferences.publicValues().apiKeyStored, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)).encryptedKeys, {});
  assert.equal(preferences.providerEnv({ LLM_API_KEY: 'old-env-key', LLM_BASE_URL: DEFAULTS.baseURL }).LLM_API_KEY, '');
  assert.equal(preferences.providerEnv({ LLM_API_KEY: 'new-env-key', LLM_BASE_URL: 'https://new-endpoint.example.test/v1' }).LLM_API_KEY, 'new-env-key');
  preferences.save(configured({ baseURL: 'https://new-endpoint.example.test/v1', apiKey: 'session-endpoint-key', persistApiKey: false }));
  preferences.save(configured({ baseURL: 'http://127.0.0.1:9090/v1', apiKey: '' }));
  assert.equal(preferences.providerEnv({}).LLM_API_KEY, '');
});

test('changing compatible endpoint while selecting Anthropic clears only the compatible secret', (t) => {
  const { preferences } = fixture(t);
  preferences.save(configured({ apiKey: 'old-compatible-key' }));
  preferences.save(configured({ provider: 'anthropic', baseURL: 'https://different-compatible.example.test/v1', apiKey: 'anthropic-key' }));
  assert.equal(preferences.providerEnv({}).ANTHROPIC_API_KEY, 'anthropic-key');
  preferences.save(configured({ baseURL: 'https://different-compatible.example.test/v1' }));
  assert.equal(preferences.providerEnv({}).LLM_API_KEY, '');
});
