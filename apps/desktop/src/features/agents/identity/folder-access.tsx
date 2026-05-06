import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { FolderIcon, FolderOpenIcon, XIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ipcAgentUpdateFolderAccess } from '@/lib/ipc';

interface FolderAccessProps {
  agentId: string;
  workingDir: string;
  /** JSON-encoded array of absolute paths from `agents.folder_access`. */
  rawFolderAccess: string;
}

/**
 * Folder access editor. Shows the agent's working dir as a read-only
 * "always allowed" row at the top, then a list of additional
 * allowlisted directories the user has added. On every mutation we
 * persist the full normalized list via the Tauri command (which
 * canonicalizes + dedupes server-side).
 */
export function FolderAccess({
  agentId,
  workingDir,
  rawFolderAccess,
}: FolderAccessProps): JSX.Element {
  const [folders, setFolders] = useState<readonly string[]>(() => safeParse(rawFolderAccess));
  const qc = useQueryClient();

  // Re-sync when the persisted value changes (e.g. another panel
  // edited it, or we just hydrated from `agent_list`).
  useEffect(() => {
    const parsed = safeParse(rawFolderAccess);
    setFolders(parsed);
  }, [rawFolderAccess]);

  const update = useMutation({
    mutationFn: (next: readonly string[]) => ipcAgentUpdateFolderAccess(agentId, [...next]),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['agents'] });
    },
  });

  const addFolder = async (): Promise<void> => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: 'Allow access to a folder',
      });
      if (typeof selected !== 'string') return;
      if (folders.includes(selected) || selected === workingDir) return;
      const next = [...folders, selected];
      setFolders(next);
      update.mutate(next);
    } catch (e) {
      console.warn('folder picker failed', e);
    }
  };

  const removeFolder = (path: string): void => {
    const next = folders.filter((f) => f !== path);
    setFolders(next);
    update.mutate(next);
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-11 text-text-tertiary">
        Folders this agent can read or edit. The working directory is always accessible and
        isn&apos;t listed here.
      </p>

      <ul className="flex flex-col gap-1">
        <li>
          <FolderRow path={workingDir} muted label="working dir · always allowed" />
        </li>
        {folders.map((path) => (
          <li key={path}>
            <FolderRow path={path} onRemove={() => removeFolder(path)} />
          </li>
        ))}
        {folders.length === 0 ? (
          <li className="px-2 py-1 text-11 text-text-faint">No additional folders allowlisted.</li>
        ) : null}
      </ul>

      <button
        type="button"
        onClick={() => void addFolder()}
        disabled={update.isPending}
        className={cn(
          'self-start rounded-button border border-line-2 bg-ink-3 px-3 py-1.5',
          'text-12 text-text-secondary hover:bg-hover hover:text-text-primary',
          'disabled:opacity-50',
        )}
      >
        <FolderOpenIcon className="mr-1 inline-block h-3 w-3 -translate-y-px" />
        Add folder
      </button>
    </div>
  );
}

function FolderRow({
  path,
  muted,
  label,
  onRemove,
}: {
  path: string;
  muted?: boolean;
  label?: string;
  onRemove?: () => void;
}): JSX.Element {
  return (
    <div
      className={cn(
        'group flex items-center gap-2 rounded-card border border-line-2 bg-ink-2 px-3 py-2',
      )}
    >
      <FolderIcon className={cn('h-3 w-3', muted ? 'text-text-faint' : 'text-text-secondary')} />
      <div className="flex flex-1 flex-col">
        <span
          className={cn(
            'truncate font-mono text-12',
            muted ? 'text-text-tertiary' : 'text-text-primary',
          )}
        >
          {path}
        </span>
        {label ? <span className="text-10 text-text-faint">{label}</span> : null}
      </div>
      {onRemove ? (
        <button
          type="button"
          aria-label="Remove folder"
          onClick={onRemove}
          className={cn(
            'rounded-[3px] p-1 text-text-faint opacity-0 transition-opacity duration-fast',
            'hover:bg-hover hover:text-status-error group-hover:opacity-100',
          )}
        >
          <XIcon className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}

function safeParse(raw: string): readonly string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.every((s): s is string => typeof s === 'string')) {
      return parsed;
    }
    return [];
  } catch {
    return [];
  }
}
