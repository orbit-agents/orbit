import { useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { XIcon, FolderOpenIcon } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/cn';
import { ipcAgentSpawn } from '@/lib/ipc';
import { useAgentsStore } from '@/stores/agents';

const EMOJIS = [
  '🛰️',
  '🦊',
  '🐙',
  '🦉',
  '🐝',
  '🐞',
  '🦋',
  '🪐',
  '⭐',
  '🌙',
  '🔮',
  '🎯',
  '🧭',
  '📡',
  '🛠️',
  '⚙️',
  '🧪',
  '🔭',
  '📚',
  '🎨',
  '🎭',
  '🚀',
  '🛸',
  '🧊',
  '🌊',
  '🔥',
  '⚡',
  '💡',
  '🪄',
  '🗝️',
  '📜',
  '🌱',
] as const;

const COLORS = [
  '#5E6AD2',
  '#22C55E',
  '#EAB308',
  '#EF4444',
  '#EC4899',
  '#06B6D4',
  '#8B5CF6',
  '#F97316',
] as const;

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SpawnAgentDialog({ open, onClose }: Props): JSX.Element | null {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState<string>(EMOJIS[0]);
  const [color, setColor] = useState<string>(COLORS[0]);
  const [workingDir, setWorkingDir] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);
  const upsertAgent = useAgentsStore((s) => s.upsertAgent);
  const selectAgent = useAgentsStore((s) => s.selectAgent);
  const qc = useQueryClient();

  const spawn = useMutation({
    mutationFn: ipcAgentSpawn,
    onSuccess: (agent) => {
      upsertAgent(agent);
      selectAgent(agent.id);
      void qc.invalidateQueries({ queryKey: ['agents'] });
      reset();
      onClose();
    },
    onError: (e) => setFormError(String(e)),
  });

  const reset = (): void => {
    setName('');
    setEmoji(EMOJIS[0]);
    setColor(COLORS[0]);
    setWorkingDir('');
    setFormError(null);
  };

  const pickFolder = async (): Promise<void> => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: 'Choose working directory',
      });
      if (typeof selected === 'string') {
        setWorkingDir(selected);
      }
    } catch (e) {
      setFormError(`Could not open folder picker: ${String(e)}`);
    }
  };

  const submit = (): void => {
    setFormError(null);
    if (!name.trim()) {
      setFormError('Name is required.');
      return;
    }
    if (!workingDir.trim()) {
      setFormError('Pick a working directory.');
      return;
    }
    spawn.mutate({
      name: name.trim(),
      emoji,
      color,
      workingDir,
    });
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Spawn agent"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'w-[480px] rounded-panel border border-border bg-panel shadow-xl',
          'flex flex-col gap-4 p-6',
        )}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-16 font-semibold text-text-primary">Spawn agent</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-input p-1 text-text-tertiary hover:bg-hover hover:text-text-primary"
            aria-label="Close"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="agent-name"
            className="text-11 uppercase tracking-wider text-text-tertiary"
          >
            Name
          </label>
          <input
            id="agent-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Scout"
            className={cn(
              'rounded-input border border-border bg-elevated px-3 py-2',
              'text-13 text-text-primary placeholder:text-text-tertiary',
              'focus:border-accent focus:outline-none',
            )}
            autoFocus
          />
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-11 uppercase tracking-wider text-text-tertiary">Emoji</span>
          <div className="grid grid-cols-8 gap-1">
            {EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setEmoji(e)}
                className={cn(
                  'h-8 w-8 rounded-input text-16',
                  emoji === e ? 'bg-hover ring-1 ring-accent' : 'hover:bg-hover',
                )}
                aria-label={`Emoji ${e}`}
                aria-pressed={emoji === e}
              >
                {e}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-11 uppercase tracking-wider text-text-tertiary">Color</span>
          <div className="flex gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={cn(
                  'h-6 w-6 rounded-full',
                  color === c ? 'ring-2 ring-text-primary ring-offset-2 ring-offset-panel' : '',
                )}
                style={{ backgroundColor: c }}
                aria-label={`Color ${c}`}
                aria-pressed={color === c}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-11 uppercase tracking-wider text-text-tertiary">
            Working directory
          </span>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={workingDir}
              readOnly
              placeholder="No folder selected"
              className={cn(
                'flex-1 rounded-input border border-border bg-elevated px-3 py-2',
                'text-13 text-text-primary placeholder:text-text-tertiary',
                'focus:outline-none',
              )}
            />
            <button
              type="button"
              onClick={() => void pickFolder()}
              className={cn(
                'flex items-center gap-2 rounded-button border border-border px-3 py-2',
                'text-13 text-text-primary hover:bg-hover',
              )}
            >
              <FolderOpenIcon className="h-4 w-4" />
              Choose
            </button>
          </div>
        </div>

        {formError ? (
          <div className="rounded-input border border-status-error/40 bg-status-error/10 px-3 py-2 text-13 text-status-error">
            {formError}
          </div>
        ) : null}

        <div className="mt-2 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-button px-3 py-2 text-13 text-text-secondary hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={spawn.isPending}
            className={cn(
              'rounded-button bg-accent px-4 py-2 text-13 font-medium text-white',
              'hover:opacity-90 disabled:opacity-60',
            )}
          >
            {spawn.isPending ? 'Spawning…' : 'Spawn'}
          </button>
        </div>
      </div>
    </div>
  );
}
