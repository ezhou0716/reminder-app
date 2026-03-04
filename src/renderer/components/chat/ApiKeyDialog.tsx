import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { useChatStore } from '@/stores/chat-store';

interface ApiKeyDialogProps {
  onClose: () => void;
}

export default function ApiKeyDialog({ onClose }: ApiKeyDialogProps) {
  const { setApiKey, clearApiKey, hasApiKey } = useChatStore();
  const [inputValue, setInputValue] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const trimmed = inputValue.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await setApiKey(trimmed);
      onClose();
    } catch (err) {
      console.error('Failed to save API key:', err);
      setSaving(false);
    }
  };

  const handleClear = async () => {
    await clearApiKey();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-background border border-border rounded-lg shadow-xl w-[420px] p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold">Gemini API Key</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-muted-foreground mb-3">
          Enter your Google Gemini API key to enable the AI scheduling assistant. Get a free key at aistudio.google.com. Your key is stored locally.
        </p>

        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="AIza..."
          className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring mb-4 font-mono"
          onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          autoFocus
        />

        <div className="flex justify-end gap-2">
          {hasApiKey && (
            <Button variant="outline" size="sm" onClick={handleClear}>
              Clear Key
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!inputValue.trim() || saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}
