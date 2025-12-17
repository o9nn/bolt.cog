import { map } from 'nanostores';
import { workbenchStore } from './workbench';

export interface Shortcut {
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  ctrlOrMetaKey?: boolean;
  action: () => void;
}

export interface Shortcuts {
  toggleTerminal: Shortcut;
}

export interface ApiKey {
  id: string;
  name: string;
  value: string;
  provider: string;
  createdAt: string;
}

export interface Settings {
  shortcuts: Shortcuts;
  apiKeys: ApiKey[];
  additionalProjectPrompt: string;
}

export const shortcutsStore = map<Shortcuts>({
  toggleTerminal: {
    key: 'j',
    ctrlOrMetaKey: true,
    action: () => workbenchStore.toggleTerminal(),
  },
});

// Load settings from localStorage
function loadSettingsFromStorage(): Partial<Settings> {
  if (typeof window === 'undefined') return {};
  
  try {
    const stored = localStorage.getItem('bolt-settings');
    return stored ? JSON.parse(stored) : {};
  } catch (error) {
    console.warn('Failed to load settings from localStorage:', error);
    return {};
  }
}

// Save settings to localStorage
function saveSettingsToStorage(settings: Settings) {
  if (typeof window === 'undefined') return;
  
  try {
    localStorage.setItem('bolt-settings', JSON.stringify({
      apiKeys: settings.apiKeys,
      additionalProjectPrompt: settings.additionalProjectPrompt,
    }));
  } catch (error) {
    console.warn('Failed to save settings to localStorage:', error);
  }
}

export const settingsStore = map<Settings>({
  shortcuts: shortcutsStore.get(),
  apiKeys: [],
  additionalProjectPrompt: '',
});

// Load settings only on client side
if (typeof window !== 'undefined') {
  const storedSettings = loadSettingsFromStorage();
  settingsStore.set({
    shortcuts: shortcutsStore.get(),
    apiKeys: storedSettings.apiKeys || [],
    additionalProjectPrompt: storedSettings.additionalProjectPrompt || '',
  });
}

shortcutsStore.subscribe((shortcuts) => {
  const currentSettings = settingsStore.get();
  const newSettings = {
    ...currentSettings,
    shortcuts,
  };
  settingsStore.set(newSettings);
  saveSettingsToStorage(newSettings);
});

// Save to localStorage when settings change
settingsStore.subscribe((settings) => {
  saveSettingsToStorage(settings);
});

// Helper functions for managing API keys
export function addApiKey(name: string, value: string, provider: string): void {
  const currentSettings = settingsStore.get();
  const newApiKey: ApiKey = {
    id: crypto.randomUUID(),
    name,
    value,
    provider,
    createdAt: new Date().toISOString(),
  };
  
  settingsStore.set({
    ...currentSettings,
    apiKeys: [...currentSettings.apiKeys, newApiKey],
  });
}

export function updateApiKey(id: string, updates: Partial<Omit<ApiKey, 'id' | 'createdAt'>>): void {
  const currentSettings = settingsStore.get();
  const apiKeys = currentSettings.apiKeys.map(key => 
    key.id === id ? { ...key, ...updates } : key
  );
  
  settingsStore.set({
    ...currentSettings,
    apiKeys,
  });
}

export function removeApiKey(id: string): void {
  const currentSettings = settingsStore.get();
  const apiKeys = currentSettings.apiKeys.filter(key => key.id !== id);
  
  settingsStore.set({
    ...currentSettings,
    apiKeys,
  });
}

export function updateAdditionalProjectPrompt(prompt: string): void {
  const currentSettings = settingsStore.get();
  
  settingsStore.set({
    ...currentSettings,
    additionalProjectPrompt: prompt,
  });
}
