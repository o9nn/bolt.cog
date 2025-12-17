/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the workbench store to avoid webcontainer dependency
vi.mock('~/lib/stores/workbench', () => ({
  workbenchStore: {
    toggleTerminal: vi.fn(),
  },
}));

// Mock crypto.randomUUID for tests
let uuidCounter = 0;
Object.defineProperty(globalThis, 'crypto', {
  value: {
    randomUUID: () => `test-uuid-${++uuidCounter}`,
  },
});

import { settingsStore, addApiKey, updateApiKey, removeApiKey, updateAdditionalProjectPrompt, type Settings } from '~/lib/stores/settings';

// Mock localStorage
const mockLocalStorage = {
  store: {} as Record<string, string>,
  getItem: function(key: string) {
    return this.store[key] || null;
  },
  setItem: function(key: string, value: string) {
    this.store[key] = value;
  },
  removeItem: function(key: string) {
    delete this.store[key];
  },
  clear: function() {
    this.store = {};
  }
};

Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
  writable: true
});

describe('SettingsStore', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    // Reset store to initial state
    const initialSettings: Settings = {
      shortcuts: {
        toggleTerminal: {
          key: 'j',
          ctrlOrMetaKey: true,
          action: () => {},
        },
      },
      apiKeys: [],
      additionalProjectPrompt: '',
    };
    settingsStore.set(initialSettings);
  });

  describe('API Key Management', () => {
    it('should add a new API key', () => {
      addApiKey('Test Key', 'test-api-key-123', 'OpenAI');
      
      const settings = settingsStore.get();
      expect(settings.apiKeys).toHaveLength(1);
      expect(settings.apiKeys[0].name).toBe('Test Key');
      expect(settings.apiKeys[0].value).toBe('test-api-key-123');
      expect(settings.apiKeys[0].provider).toBe('OpenAI');
      expect(settings.apiKeys[0].id).toBeDefined();
      expect(settings.apiKeys[0].createdAt).toBeDefined();
    });

    it('should update an existing API key', () => {
      addApiKey('Test Key', 'test-api-key-123', 'OpenAI');
      const settings = settingsStore.get();
      const apiKeyId = settings.apiKeys[0].id;
      
      updateApiKey(apiKeyId, { name: 'Updated Key', provider: 'Anthropic' });
      
      const updatedSettings = settingsStore.get();
      expect(updatedSettings.apiKeys[0].name).toBe('Updated Key');
      expect(updatedSettings.apiKeys[0].provider).toBe('Anthropic');
      expect(updatedSettings.apiKeys[0].value).toBe('test-api-key-123'); // Should remain unchanged
      expect(updatedSettings.apiKeys[0].id).toBe(apiKeyId); // Should remain unchanged
    });

    it('should remove an API key', () => {
      addApiKey('Test Key 1', 'test-api-key-123', 'OpenAI');
      addApiKey('Test Key 2', 'test-api-key-456', 'Anthropic');
      
      let settings = settingsStore.get();
      expect(settings.apiKeys).toHaveLength(2);
      
      const firstKeyId = settings.apiKeys[0].id;
      removeApiKey(firstKeyId);
      
      settings = settingsStore.get();
      expect(settings.apiKeys).toHaveLength(1);
      expect(settings.apiKeys[0].name).toBe('Test Key 2');
    });
  });

  describe('Additional Project Prompt', () => {
    it('should update additional project prompt', () => {
      const testPrompt = 'This is a test prompt for the project.';
      updateAdditionalProjectPrompt(testPrompt);
      
      const settings = settingsStore.get();
      expect(settings.additionalProjectPrompt).toBe(testPrompt);
    });

    it('should handle empty prompt', () => {
      updateAdditionalProjectPrompt('');
      
      const settings = settingsStore.get();
      expect(settings.additionalProjectPrompt).toBe('');
    });
  });

  describe('Persistence', () => {
    it('should save settings to localStorage when API keys change', () => {
      addApiKey('Test Key', 'test-api-key-123', 'OpenAI');
      
      const stored = mockLocalStorage.getItem('bolt-settings');
      expect(stored).toBeDefined();
      
      const parsedSettings = JSON.parse(stored!);
      expect(parsedSettings.apiKeys).toHaveLength(1);
      expect(parsedSettings.apiKeys[0].name).toBe('Test Key');
    });

    it('should save settings to localStorage when project prompt changes', () => {
      const testPrompt = 'Test prompt';
      updateAdditionalProjectPrompt(testPrompt);
      
      const stored = mockLocalStorage.getItem('bolt-settings');
      expect(stored).toBeDefined();
      
      const parsedSettings = JSON.parse(stored!);
      expect(parsedSettings.additionalProjectPrompt).toBe(testPrompt);
    });
  });
});