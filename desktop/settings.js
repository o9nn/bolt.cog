'use strict';

(() => {
  const form = document.getElementById('settings-form');
  const provider = document.getElementById('provider');
  const endpoint = document.getElementById('base-url');
  const model = document.getElementById('model');
  const key = document.getElementById('api-key');
  const persist = document.getElementById('persist-key');
  const clear = document.getElementById('clear-key');
  const status = document.getElementById('status');
  const keyStatus = document.getElementById('key-status');
  const storageHelp = document.getElementById('storage-help');
  let publicValues;
  let saving = false;
  function message(text, error = false) { status.textContent = text; status.dataset.error = String(error); }
  function providerState() {
    const anthropic = provider.value === 'anthropic';
    document.getElementById('endpoint-field').hidden = anthropic;
    endpoint.required = !anthropic;
    endpoint.disabled = anthropic || saving;
    // Key state is only known for the provider loaded by the main process.
    keyStatus.textContent = publicValues && publicValues.provider === provider.value
      ? `Key configured: ${publicValues.apiKeyConfigured ? 'yes' : 'no'}. Stored: ${publicValues.apiKeyStored ? 'yes' : 'no'}. Session: ${publicValues.apiKeySession ? 'yes' : 'no'}. Environment: ${publicValues.environmentApiKeyConfigured ? 'yes' : 'no'}.`
      : 'Key state for this provider will be shown after saving. Empty input preserves any existing key.';
  }
  function apply(values) {
    publicValues = values;
    provider.value = values.provider;
    endpoint.value = values.baseURL;
    model.value = values.model;
    key.value = '';
    clear.checked = false;
    persist.checked = values.secretStorageAvailable;
    storageHelp.textContent = values.secretStorageAvailable
      ? 'OS-protected key storage is available. Uncheck to keep a new key for this session only, replacing any stored key for this provider.'
      : 'Secure OS key storage is unavailable. New keys can be session-only; plaintext persistence is refused. You can also configure an environment variable.';
    providerState();
  }
  function enabled(value) {
    for (const control of form.elements) control.disabled = !value;
    if (value) {
      persist.disabled = !publicValues.secretStorageAvailable;
      key.disabled = clear.checked;
      providerState();
    }
  }
  provider.addEventListener('change', () => {
    key.value = '';
    clear.checked = false;
    key.disabled = false;
    // A provider switch must not silently carry the other provider's model ID.
    model.value = publicValues.provider === provider.value ? publicValues.model : '';
    providerState();
  });
  clear.addEventListener('change', () => { key.value = ''; key.disabled = clear.checked; });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving || !publicValues || !window.localSettings) return;
    const input = {
      provider: provider.value,
      baseURL: endpoint.value,
      model: model.value,
      apiKey: key.value,
      clearApiKey: clear.checked,
      persistApiKey: persist.checked
    };
    saving = true; enabled(false); message('Saving local provider configuration…');
    // Do not retain a secret in the form or display it in status/error text.
    key.value = '';
    try {
      const result = await window.localSettings.save(input);
      if (!result.ok) { message(result.message || 'Settings could not be saved.', true); return; }
      apply(result.values);
      message(result.message || 'Settings saved. No connection or inference was tested.', result.backendRestarted === false);
    } catch { message('The trusted settings channel is unavailable. No successful save was confirmed.', true); }
    finally { input.apiKey = ''; saving = false; enabled(true); }
  });
  async function initialize() {
    if (!window.localSettings || typeof window.localSettings.read !== 'function' || typeof window.localSettings.save !== 'function') {
      message('The trusted local settings bridge is unavailable.', true); return;
    }
    try {
      const result = await window.localSettings.read();
      if (!result.ok) { message(result.message || 'Local settings could not be read safely.', true); return; }
      apply(result.values); enabled(true);
      message('Configuration loaded. Enter a real model ID before saving.');
    } catch { message('The trusted local settings channel is unavailable.', true); }
  }
  void initialize();
})();
