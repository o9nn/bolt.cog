import { useStore } from '@nanostores/react';
import { useState } from 'react';
import { toast } from 'react-toastify';
import { Dialog, DialogButton, DialogDescription, DialogRoot, DialogTitle } from '~/components/ui/Dialog';
import { settingsStore, addApiKey, updateApiKey, removeApiKey, updateAdditionalProjectPrompt, type ApiKey } from '~/lib/stores/settings';

interface ApiKeyFormData {
  name: string;
  value: string;
  provider: string;
}

type DialogContent = { type: 'add-api-key' } | { type: 'edit-api-key'; apiKey: ApiKey } | { type: 'delete-api-key'; apiKey: ApiKey } | null;

export function SettingsPanel() {
  const settings = useStore(settingsStore);
  const [dialogContent, setDialogContent] = useState<DialogContent>(null);
  const [apiKeyForm, setApiKeyForm] = useState<ApiKeyFormData>({ name: '', value: '', provider: '' });
  const [projectPrompt, setProjectPrompt] = useState(settings.additionalProjectPrompt);

  const closeDialog = () => {
    setDialogContent(null);
    setApiKeyForm({ name: '', value: '', provider: '' });
  };

  const handleAddApiKey = () => {
    setApiKeyForm({ name: '', value: '', provider: '' });
    setDialogContent({ type: 'add-api-key' });
  };

  const handleEditApiKey = (apiKey: ApiKey) => {
    setApiKeyForm({ name: apiKey.name, value: apiKey.value, provider: apiKey.provider });
    setDialogContent({ type: 'edit-api-key', apiKey });
  };

  const handleDeleteApiKey = (apiKey: ApiKey) => {
    setDialogContent({ type: 'delete-api-key', apiKey });
  };

  const handleSaveApiKey = () => {
    if (!apiKeyForm.name.trim() || !apiKeyForm.value.trim() || !apiKeyForm.provider.trim()) {
      toast.error('Please fill in all fields');
      return;
    }

    if (dialogContent?.type === 'add-api-key') {
      addApiKey(apiKeyForm.name.trim(), apiKeyForm.value.trim(), apiKeyForm.provider.trim());
      toast.success('API key added successfully');
    } else if (dialogContent?.type === 'edit-api-key') {
      updateApiKey(dialogContent.apiKey.id, {
        name: apiKeyForm.name.trim(),
        value: apiKeyForm.value.trim(),
        provider: apiKeyForm.provider.trim(),
      });
      toast.success('API key updated successfully');
    }

    closeDialog();
  };

  const handleConfirmDeleteApiKey = () => {
    if (dialogContent?.type === 'delete-api-key') {
      removeApiKey(dialogContent.apiKey.id);
      toast.success('API key deleted successfully');
      closeDialog();
    }
  };

  const handleSaveProjectPrompt = () => {
    updateAdditionalProjectPrompt(projectPrompt);
    toast.success('Project prompt saved successfully');
  };

  const maskApiKey = (value: string) => {
    if (value.length <= 8) return '*'.repeat(value.length);
    return value.slice(0, 4) + '*'.repeat(value.length - 8) + value.slice(-4);
  };

  return (
    <div className="p-6 h-full overflow-auto">
      <h2 className="text-xl font-bold text-bolt-elements-textPrimary mb-6">Settings</h2>
      
      {/* API Keys Section */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-bolt-elements-textPrimary">API Keys</h3>
          <button
            onClick={handleAddApiKey}
            className="bg-bolt-elements-button-primary-background hover:bg-bolt-elements-button-primary-backgroundHover text-bolt-elements-button-primary-text px-3 py-1 rounded-md text-sm font-medium transition-colors"
          >
            Add API Key
          </button>
        </div>
        
        <div className="space-y-2">
          {settings.apiKeys.length === 0 ? (
            <div className="text-bolt-elements-textTertiary text-sm italic">No API keys configured</div>
          ) : (
            settings.apiKeys.map((apiKey) => (
              <div
                key={apiKey.id}
                className="flex items-center justify-between p-3 bg-bolt-elements-background-depth-3 rounded-md border border-bolt-elements-borderColor"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-bolt-elements-textPrimary">{apiKey.name}</span>
                    <span className="text-xs text-bolt-elements-textTertiary bg-bolt-elements-background-depth-2 px-2 py-0.5 rounded">
                      {apiKey.provider}
                    </span>
                  </div>
                  <div className="text-sm text-bolt-elements-textSecondary font-mono">
                    {maskApiKey(apiKey.value)}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleEditApiKey(apiKey)}
                    className="text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary text-sm"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDeleteApiKey(apiKey)}
                    className="text-red-500 hover:text-red-400 text-sm"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Additional Project Prompt Section */}
      <div className="mb-8">
        <h3 className="text-lg font-semibold text-bolt-elements-textPrimary mb-4">Additional Project Prompt</h3>
        <div className="space-y-3">
          <textarea
            value={projectPrompt}
            onChange={(e) => setProjectPrompt(e.target.value)}
            placeholder="Enter additional instructions or context that will be included with every project prompt..."
            className="w-full h-32 p-3 bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor rounded-md text-bolt-elements-textPrimary placeholder-bolt-elements-textTertiary resize-none focus:outline-none focus:ring-2 focus:ring-bolt-elements-focus"
          />
          <button
            onClick={handleSaveProjectPrompt}
            className="bg-bolt-elements-button-primary-background hover:bg-bolt-elements-button-primary-backgroundHover text-bolt-elements-button-primary-text px-4 py-2 rounded-md text-sm font-medium transition-colors"
          >
            Save Project Prompt
          </button>
        </div>
      </div>

      {/* Dialog */}
      <DialogRoot open={dialogContent !== null}>
        <Dialog onBackdrop={closeDialog} onClose={closeDialog}>
          {dialogContent?.type === 'add-api-key' && (
            <>
              <DialogTitle>Add API Key</DialogTitle>
              <DialogDescription asChild>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-bolt-elements-textPrimary mb-1">
                      Name
                    </label>
                    <input
                      type="text"
                      value={apiKeyForm.name}
                      onChange={(e) => setApiKeyForm({ ...apiKeyForm, name: e.target.value })}
                      placeholder="e.g., OpenAI Production"
                      className="w-full p-2 bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor rounded text-bolt-elements-textPrimary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-bolt-elements-textPrimary mb-1">
                      Provider
                    </label>
                    <input
                      type="text"
                      value={apiKeyForm.provider}
                      onChange={(e) => setApiKeyForm({ ...apiKeyForm, provider: e.target.value })}
                      placeholder="e.g., OpenAI, Anthropic, etc."
                      className="w-full p-2 bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor rounded text-bolt-elements-textPrimary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-bolt-elements-textPrimary mb-1">
                      API Key
                    </label>
                    <input
                      type="password"
                      value={apiKeyForm.value}
                      onChange={(e) => setApiKeyForm({ ...apiKeyForm, value: e.target.value })}
                      placeholder="Enter your API key"
                      className="w-full p-2 bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor rounded text-bolt-elements-textPrimary"
                    />
                  </div>
                </div>
              </DialogDescription>
              <div className="px-5 pb-4 bg-bolt-elements-background-depth-2 flex gap-2 justify-end">
                <DialogButton type="secondary" onClick={closeDialog}>
                  Cancel
                </DialogButton>
                <DialogButton type="primary" onClick={handleSaveApiKey}>
                  Add API Key
                </DialogButton>
              </div>
            </>
          )}

          {dialogContent?.type === 'edit-api-key' && (
            <>
              <DialogTitle>Edit API Key</DialogTitle>
              <DialogDescription asChild>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-bolt-elements-textPrimary mb-1">
                      Name
                    </label>
                    <input
                      type="text"
                      value={apiKeyForm.name}
                      onChange={(e) => setApiKeyForm({ ...apiKeyForm, name: e.target.value })}
                      className="w-full p-2 bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor rounded text-bolt-elements-textPrimary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-bolt-elements-textPrimary mb-1">
                      Provider
                    </label>
                    <input
                      type="text"
                      value={apiKeyForm.provider}
                      onChange={(e) => setApiKeyForm({ ...apiKeyForm, provider: e.target.value })}
                      className="w-full p-2 bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor rounded text-bolt-elements-textPrimary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-bolt-elements-textPrimary mb-1">
                      API Key
                    </label>
                    <input
                      type="password"
                      value={apiKeyForm.value}
                      onChange={(e) => setApiKeyForm({ ...apiKeyForm, value: e.target.value })}
                      className="w-full p-2 bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor rounded text-bolt-elements-textPrimary"
                    />
                  </div>
                </div>
              </DialogDescription>
              <div className="px-5 pb-4 bg-bolt-elements-background-depth-2 flex gap-2 justify-end">
                <DialogButton type="secondary" onClick={closeDialog}>
                  Cancel
                </DialogButton>
                <DialogButton type="primary" onClick={handleSaveApiKey}>
                  Save Changes
                </DialogButton>
              </div>
            </>
          )}

          {dialogContent?.type === 'delete-api-key' && (
            <>
              <DialogTitle>Delete API Key</DialogTitle>
              <DialogDescription asChild>
                <div>
                  <p>
                    Are you sure you want to delete the API key <strong>{dialogContent.apiKey.name}</strong>?
                  </p>
                  <p className="mt-1 text-bolt-elements-textSecondary">This action cannot be undone.</p>
                </div>
              </DialogDescription>
              <div className="px-5 pb-4 bg-bolt-elements-background-depth-2 flex gap-2 justify-end">
                <DialogButton type="secondary" onClick={closeDialog}>
                  Cancel
                </DialogButton>
                <DialogButton type="danger" onClick={handleConfirmDeleteApiKey}>
                  Delete
                </DialogButton>
              </div>
            </>
          )}
        </Dialog>
      </DialogRoot>
    </div>
  );
}