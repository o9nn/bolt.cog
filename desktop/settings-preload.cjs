'use strict';

// Sandboxed preloads may require Electron, not arbitrary local Node modules.
// Never expose ipcRenderer itself, channel selection, events, or stored secrets.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('localSettings', Object.freeze({
  read: () => ipcRenderer.invoke('bolt-cog:settings:read'),
  save: (providerConfig) => ipcRenderer.invoke('bolt-cog:settings:save', providerConfig)
}));
