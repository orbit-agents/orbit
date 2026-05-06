import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { cn } from '@/lib/cn';
import { ipcAgentImportClaudeMd } from '@/lib/ipc';

interface AdvancedSectionProps {
  agentId: string;
  /** Bound to the per-agent toggle; persisted in localStorage. */
  importOnSpawn: boolean;
  onChangeImportOnSpawn: (next: boolean) => void;
}

/**
 * Phase 3 Advanced settings:
 * - Toggle for "Import CLAUDE.md from working dir on spawn" (default OFF)
 * - "Import now" button for already-spawned agents
 *
 * The toggle is persisted client-side; it only matters at the moment a
 * NEW agent is spawned in a directory, so the spawn dialog reads it
 * from the same key. This keeps the surface area small for Phase 3.
 */
export function AdvancedSection({
  agentId,
  importOnSpawn,
  onChangeImportOnSpawn,
}: AdvancedSectionProps): JSX.Element {
  const [feedback, setFeedback] = useState<string | null>(null);

  const importNow = useMutation({
    mutationFn: () => ipcAgentImportClaudeMd(agentId),
    onSuccess: (result) => {
      setFeedback(
        result.imported
          ? `Imported from ${result.sourcePath ?? 'CLAUDE.md'}.`
          : 'No CLAUDE.md found in the working directory.',
      );
      window.setTimeout(() => setFeedback(null), 4000);
    },
    onError: (e) => setFeedback(`Import failed: ${String(e)}`),
  });

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={importOnSpawn}
          onChange={(e) => onChangeImportOnSpawn(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-border accent-accent"
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-13 text-text-primary">Import CLAUDE.md on spawn</span>
          <span className="text-11 text-text-tertiary">
            When spawning a new agent, look for a CLAUDE.md in the working directory and use its
            contents as the initial Purpose. Off by default — Orbit owns this mechanic.
          </span>
        </span>
      </label>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => importNow.mutate()}
          disabled={importNow.isPending}
          className={cn(
            'rounded-button border border-border-subtle bg-elevated px-3 py-1.5',
            'text-12 text-text-secondary hover:bg-hover hover:text-text-primary',
            'disabled:opacity-50',
          )}
        >
          Import now
        </button>
        {feedback ? <span className="text-11 text-text-tertiary">{feedback}</span> : null}
      </div>
    </div>
  );
}
