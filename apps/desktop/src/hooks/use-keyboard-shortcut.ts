import { useEffect } from 'react';

interface ShortcutOptions {
  key: string;
  /** Match Cmd on macOS, Ctrl elsewhere. */
  modKey?: boolean;
  shift?: boolean;
  alt?: boolean;
}

/** Register a global keyboard shortcut. Callback receives the raw event. */
export function useKeyboardShortcut(
  opts: ShortcutOptions,
  handler: (event: KeyboardEvent) => void,
): void {
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== opts.key.toLowerCase()) return;
      if (opts.modKey) {
        const mod = event.metaKey || event.ctrlKey;
        if (!mod) return;
      }
      if (opts.shift && !event.shiftKey) return;
      if (opts.alt && !event.altKey) return;
      event.preventDefault();
      handler(event);
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [opts.key, opts.modKey, opts.shift, opts.alt, handler]);
}
