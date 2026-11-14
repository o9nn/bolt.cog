'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// Main-process API (call after app.whenReady):
// const preferences = createPreferences({ userData: app.getPath('userData'), safeStorage });
// load() -> { provider, baseURL, model }; never includes a key.
// save({provider, baseURL, model, apiKey?, clearApiKey?, persistApiKey?}) -> publicValues().
// providerEnv(env = process.env) -> ONLY the selected provider's backend variables.
// Saved settings take precedence over environment; missing keys/models fall back to env.
// persistApiKey:false explicitly keeps a supplied key in this instance's memory only.
// No model is invented: the initial model is empty and save requires an actual model ID.
// Security references: https://www.electronjs.org/docs/latest/api/safe-storage
// https://www.electronjs.org/docs/latest/tutorial/security
const PREFERENCES_FILENAME = 'provider-preferences.json';
const DEFAULTS = Object.freeze({ provider: 'openai-compatible', baseURL: 'http://127.0.0.1:8080/v1', model: '' });
const PROVIDERS = Object.freeze(['openai-compatible', 'anthropic']);
const MAX_FILE_BYTES = 65536;
const MAX_KEY_BYTES = 8192;
const INPUT_KEYS = new Set(['provider', 'baseURL', 'model', 'apiKey', 'clearApiKey', 'persistApiKey']);

class PreferencesError extends Error {
  constructor(code, message) { super(message); this.name = 'PreferencesError'; this.code = code; }
}
function invalid(message) { throw new PreferencesError('INVALID_CONFIG', message); }
function strictObject(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid('Settings must be a plain object.');
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.has(key)) invalid('Settings contain an unsupported field.');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) invalid('Settings cannot contain accessor fields.');
  }
}
function field(value, label, limit) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > limit || /[\u0000-\u001f\u007f]/u.test(value)) {
    invalid(`${label} must be text within ${limit} bytes, without control characters.`);
  }
  return value;
}
function validateEndpoint(value) {
  field(value, 'Endpoint', 2048);
  if (!/^https?:\/\//u.test(value) || /[\s\\?#]/u.test(value)) invalid('Endpoint must be an HTTP(S) URL without whitespace, query or fragment.');
  let url;
  try { url = new URL(value); } catch { invalid('Endpoint is not a valid URL.'); }
  if (!url.hostname || url.username || url.password || value.split('/')[2].includes('@')) invalid('Endpoint cannot contain URL credentials.');
  const authority = value.split('/')[2];
  const hostname = authority.match(/^(\[[^\]]+\]|[^:]+)(?::\d+)?$/u)?.[1]?.toLowerCase();
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) invalid('HTTP endpoints must be loopback; other hosts require HTTPS.');
  return url.href.replace(/\/+$/u, '');
}
function validateConfig(input, requireModel = false) {
  strictObject(input, INPUT_KEYS);
  if (!PROVIDERS.includes(input.provider)) invalid('Choose Anthropic or OpenAI-compatible.');
  const baseURL = validateEndpoint(input.baseURL);
  const model = field(input.model, 'Model ID', 256).trim();
  if (requireModel && !model) invalid('Configure the actual model ID served by your provider.');
  if (/\s/u.test(model)) invalid('Model ID cannot contain whitespace.');
  if (Object.hasOwn(input, 'apiKey')) {
    field(input.apiKey, 'API key', MAX_KEY_BYTES);
    if (/\s/u.test(input.apiKey)) invalid('API key cannot contain whitespace.');
  }
  for (const key of ['clearApiKey', 'persistApiKey']) {
    if (Object.hasOwn(input, key) && typeof input[key] !== 'boolean') invalid(`${key} must be boolean.`);
  }
  if (input.clearApiKey && input.apiKey) invalid('Clear and replace the API key in separate saves.');
  return { provider: input.provider, baseURL, model };
}
function secureStorageAvailable(safeStorage) {
  try {
    if (!safeStorage || safeStorage.isEncryptionAvailable() !== true ||
        typeof safeStorage.encryptString !== 'function' || typeof safeStorage.decryptString !== 'function') return false;
    if (process.platform === 'linux') {
      if (typeof safeStorage.getSelectedStorageBackend !== 'function') return false;
      const backend = safeStorage.getSelectedStorageBackend();
      if (!['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(backend)) return false;
    }
    return true;
  } catch { return false; }
}
function validateEncryptedKeys(value) {
  strictObject(value, new Set(PROVIDERS));
  const keys = {};
  for (const provider of Object.keys(value)) {
    const encoded = value[provider];
    if (typeof encoded !== 'string' || !encoded || encoded.length > 24576 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded) ||
        Buffer.from(encoded, 'base64').toString('base64') !== encoded) invalid('Stored encrypted key is malformed.');
    keys[provider] = encoded;
  }
  return keys;
}
function readDisk(filename) {
  let fd;
  try {
    fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) invalid('Stored settings are not a bounded regular file.');
    const disk = JSON.parse(fs.readFileSync(fd, 'utf8'));
    strictObject(disk, new Set(['version', 'provider', 'baseURL', 'model', 'encryptedKeys']));
    if (disk.version !== 1) invalid('Stored settings version is unsupported.');
    const config = validateConfig({ provider: disk.provider, baseURL: disk.baseURL, model: disk.model });
    return { config, encryptedKeys: validateEncryptedKeys(disk.encryptedKeys) };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new PreferencesError('READ_FAILED', 'Local settings could not be read safely. Restore or remove the settings file before saving.');
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}
function atomicWrite(filename, data) {
  const directory = path.dirname(filename);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.${PREFERENCES_FILENAME}.${randomUUID()}.tmp`);
  let fd;
  try {
    fd = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
    fs.fchmodSync(fd, 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    fs.renameSync(temporary, filename);
    // The rename is atomic; best-effort directory sync provides crash durability.
    if (process.platform !== 'win32') {
      let directoryFd;
      try { directoryFd = fs.openSync(directory, fs.constants.O_RDONLY); fs.fsyncSync(directoryFd); }
      catch { /* Some filesystems do not support directory fsync; the rename already committed. */ }
      finally { if (directoryFd !== undefined) fs.closeSync(directoryFd); }
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
function createPreferences({ userData, safeStorage }) {
  if (typeof userData !== 'string' || !path.isAbsolute(userData)) throw new TypeError('userData must be an absolute path.');
  const filename = path.join(userData, PREFERENCES_FILENAME);
  let initialized = false;
  let saved = false;
  let config = { ...DEFAULTS };
  let encryptedKeys = {};
  let sessionKeys = {};
  function ensureLoaded() {
    if (initialized) return;
    const disk = readDisk(filename);
    if (disk) { config = disk.config; encryptedKeys = disk.encryptedKeys; saved = true; }
    initialized = true;
  }
  function load() { ensureLoaded(); return { ...config }; }
  function environmentValue(env, name, fallback, validator) {
    const value = env && env[name];
    if (value === undefined || value === '') return fallback;
    return validator(value);
  }
  function effectiveConfig(env) {
    ensureLoaded();
    if (saved) return { ...config };
    let provider = DEFAULTS.provider;
    if (env && env.LLM_PROVIDER) {
      if (!PROVIDERS.includes(env.LLM_PROVIDER)) invalid('Environment LLM_PROVIDER is unsupported.');
      provider = env.LLM_PROVIDER;
    } else if (env && (env.ANTHROPIC_API_KEY || env.ANTHROPIC_MODEL)) provider = 'anthropic';
    const baseURL = provider === 'openai-compatible'
      ? environmentValue(env, 'LLM_BASE_URL', DEFAULTS.baseURL, validateEndpoint) : DEFAULTS.baseURL;
    return { provider, baseURL, model: '' };
  }
  function environmentKey(env, provider, baseURL) {
    if (provider === 'openai-compatible' && validateEndpoint(env?.LLM_BASE_URL || DEFAULTS.baseURL) !== baseURL) return '';
    return environmentValue(env, provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'LLM_API_KEY', '', (key) => {
      field(key, 'Environment API key', MAX_KEY_BYTES);
      if (/\s/u.test(key)) invalid('Environment API key cannot contain whitespace.');
      return key;
    });
  }
  function resolvedKey(provider, env, baseURL) {
    if (sessionKeys[provider]) return sessionKeys[provider];
    if (encryptedKeys[provider] && secureStorageAvailable(safeStorage)) {
      try {
        const key = safeStorage.decryptString(Buffer.from(encryptedKeys[provider], 'base64'));
        field(key, 'Stored API key', MAX_KEY_BYTES);
        if (key && !/\s/u.test(key)) return key;
      } catch { /* Locked/unavailable keyring: use an explicit environment fallback, never plaintext. */ }
    }
    return environmentKey(env, provider, baseURL);
  }
  function providerEnv(env = process.env) {
    const current = effectiveConfig(env);
    const modelVariable = current.provider === 'anthropic' ? 'ANTHROPIC_MODEL' : 'LLM_MODEL';
    const model = current.model || environmentValue(env, modelVariable, '', (value) => {
      const result = field(value, 'Environment model ID', 256).trim();
      if (/\s/u.test(result)) invalid('Environment model ID cannot contain whitespace.');
      return result;
    });
    const key = resolvedKey(current.provider, env, current.baseURL);
    if (current.provider === 'anthropic') return { ANTHROPIC_API_KEY: key, ANTHROPIC_MODEL: model };
    return { LLM_PROVIDER: 'openai-compatible', LLM_BASE_URL: current.baseURL, LLM_MODEL: model, LLM_API_KEY: key };
  }
  function publicValues() {
    ensureLoaded();
    // Deliberately expose booleans only, never plaintext or encrypted key bytes.
    const provider = config.provider;
    const environmentApiKeyConfigured = Boolean(environmentKey(process.env, provider, config.baseURL));
    return {
      ...config,
      apiKeyConfigured: Boolean(sessionKeys[provider] || encryptedKeys[provider] || environmentApiKeyConfigured),
      apiKeyStored: Boolean(encryptedKeys[provider]),
      apiKeySession: Boolean(sessionKeys[provider]),
      environmentApiKeyConfigured,
      secretStorageAvailable: secureStorageAvailable(safeStorage)
    };
  }
  function save(input) {
    const nextConfig = validateConfig(input, true);
    ensureLoaded();
    const nextEncrypted = { ...encryptedKeys };
    const nextSession = { ...sessionKeys };
    const provider = nextConfig.provider;
    // Never transfer a compatible provider credential to a different endpoint.
    if (nextConfig.baseURL !== config.baseURL) {
      delete nextEncrypted['openai-compatible']; delete nextSession['openai-compatible'];
    }
    if (input.clearApiKey) { delete nextEncrypted[provider]; delete nextSession[provider]; }
    else if (input.apiKey) {
      if (input.persistApiKey !== false) {
        if (!secureStorageAvailable(safeStorage)) throw new PreferencesError('SECRET_STORAGE_UNAVAILABLE', 'Secure OS key storage is unavailable. Choose session-only or use an environment variable; plaintext persistence is refused.');
        try {
          const bytes = safeStorage.encryptString(input.apiKey);
          if (!Buffer.isBuffer(bytes) || !bytes.length) throw new Error('No encrypted bytes');
          nextEncrypted[provider] = bytes.toString('base64');
          validateEncryptedKeys(nextEncrypted);
        } catch { throw new PreferencesError('ENCRYPTION_FAILED', 'OS key encryption failed. Nothing was saved.'); }
        delete nextSession[provider];
      } else {
        nextSession[provider] = input.apiKey;
        delete nextEncrypted[provider];
      }
    }
    try { atomicWrite(filename, { version: 1, ...nextConfig, encryptedKeys: nextEncrypted }); }
    catch { throw new PreferencesError('WRITE_FAILED', 'Local settings could not be saved.'); }
    config = nextConfig; encryptedKeys = nextEncrypted; sessionKeys = nextSession; saved = true;
    return publicValues();
  }
  return Object.freeze({ load, save, publicValues, providerEnv });
}

module.exports = { createPreferences, PreferencesError, DEFAULTS, PREFERENCES_FILENAME, validateConfig, validateEndpoint };
