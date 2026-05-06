import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

interface IdentityEditorProps {
  /** Current persisted value. Editor seeds its internal state from this. */
  value: string;
  /** Called once the user has stopped typing for `debounceMs`. */
  onSave: (next: string) => void;
  placeholder: string;
  /** Min/max textarea height in lines. */
  minLines?: number;
  maxLines?: number;
  debounceMs?: number;
  /** Disable the editor (e.g. while no agent is selected). */
  disabled?: boolean;
}

/**
 * Auto-saving textarea for Soul / Purpose. Debounced 500ms by default.
 * Internal state tracks the in-flight draft; the parent component owns
 * the persisted value (which may be updated by other clients via the
 * identity-updated event channel).
 *
 * Saving is fire-and-forget — the parent decides whether to surface a
 * "Saved" indicator. Per ADR 0005 / Phase 3 design, soul + purpose
 * edits flip the dirty flag in the backend, so the canonical
 * confirmation users care about is the "Identity pending" pill in the
 * panel header — not a per-field "Saved" toast.
 */
export function IdentityEditor({
  value,
  onSave,
  placeholder,
  minLines = 8,
  maxLines = 24,
  debounceMs = 500,
  disabled,
}: IdentityEditorProps): JSX.Element {
  const [draft, setDraft] = useState(value);
  const lastSavedRef = useRef(value);

  // External updates (e.g. CLAUDE.md import wrote a new purpose) replace
  // the draft, but only if the user isn't actively editing.
  useEffect(() => {
    if (value !== lastSavedRef.current && draft === lastSavedRef.current) {
      setDraft(value);
      lastSavedRef.current = value;
    } else {
      lastSavedRef.current = value;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Debounced save. Resets the timer on every keystroke; saves only when
  // the draft differs from what we last persisted.
  useEffect(() => {
    if (draft === lastSavedRef.current) return;
    const handle = window.setTimeout(() => {
      lastSavedRef.current = draft;
      onSave(draft);
    }, debounceMs);
    return () => window.clearTimeout(handle);
  }, [draft, debounceMs, onSave]);

  return (
    <textarea
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      rows={minLines}
      style={{ maxHeight: `${maxLines * 1.5}rem` }}
      className={cn(
        'w-full resize-y rounded-input border border-border bg-elevated px-3 py-2',
        'font-mono text-13 text-text-primary placeholder:text-text-tertiary',
        'focus:border-accent focus:outline-none',
        'disabled:opacity-60',
      )}
    />
  );
}
