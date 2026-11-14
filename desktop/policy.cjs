'use strict';

const PARTITION = 'persist:bolt-cog-desktop';

function httpsURL(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Desktop endpoints must use HTTPS without embedded credentials');
  }
  return url;
}

function parseConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid desktop configuration');
  if (Object.keys(input).some((key) => !['appUrl', 'authOrigins'].includes(key))) throw new Error('Unknown configuration field');
  const app = httpsURL(input.appUrl);
  if (app.search || app.hash) throw new Error('App URL cannot contain query credentials or fragments');
  if (!Array.isArray(input.authOrigins) || input.authOrigins.length > 10) throw new Error('Invalid authentication origins');
  const authOrigins = input.authOrigins.map((value) => {
    const url = httpsURL(value);
    if (url.href !== `${url.origin}/`) throw new Error('Authentication entries must be exact origins');
    return url.origin;
  });
  return Object.freeze({ appUrl: app.href, appOrigin: app.origin, authOrigins: Object.freeze(authOrigins) });
}

function isTrustedNavigation(value, config) {
  try {
    const url = httpsURL(value);
    return url.origin === config.appOrigin || config.authOrigins.includes(url.origin);
  } catch { return false; }
}

function isAppURL(value, config) {
  try { return httpsURL(value).origin === config.appOrigin; } catch { return false; }
}

function isSafeDownload(value, config) {
  try {
    const url = new URL(value);
    if (url.protocol === 'blob:') return url.origin === config.appOrigin;
    return isAppURL(value, config);
  } catch { return false; }
}

function rendererPreferences() {
  return {
    partition: PARTITION,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    navigateOnDragDrop: false,
    safeDialogs: true,
    spellcheck: true
  };
}

function safeFilename(value) {
  const name = String(value).split(/[\\/]/).pop().replace(/[\x00-\x1f<>:"|?*]/g, '_').slice(0, 160);
  return name && !/^\.+$/.test(name) ? name : 'bolt-export.zip';
}

module.exports = { PARTITION, parseConfig, isTrustedNavigation, isAppURL, isSafeDownload, rendererPreferences, safeFilename };
