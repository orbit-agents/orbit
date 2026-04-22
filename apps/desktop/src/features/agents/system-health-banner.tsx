import { AlertTriangleIcon, TerminalIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { SystemHealth } from '@orbit/types';

interface Props {
  health: SystemHealth | null;
  onRecheck: () => void;
}

/**
 * Full-screen setup view shown when Claude Code CLI is missing or
 * unauthenticated. Blocks agent spawning until resolved.
 */
export function SystemHealthSetupView({ health, onRecheck }: Props): JSX.Element {
  const engine = health?.engine;
  const missing = !engine?.available;
  const unauthed = engine?.available && !engine?.authenticated;

  return (
    <div className="flex h-full w-full items-center justify-center bg-app p-8">
      <div className="flex w-full max-w-[640px] flex-col gap-6">
        <div className="flex items-center gap-3 text-status-waiting">
          <AlertTriangleIcon className="h-5 w-5" />
          <h1 className="text-20 font-semibold text-text-primary">
            {missing ? 'Claude Code is not installed' : 'Claude Code is not authenticated'}
          </h1>
        </div>

        <p className="text-13 text-text-secondary">
          Orbit runs every agent as a Claude Code subprocess. Before you can spawn an agent, the{' '}
          <span className="font-mono text-text-primary">claude</span> CLI must be installed and
          authenticated on this machine.
        </p>

        {missing ? <InstallStep /> : null}
        {unauthed ? <AuthStep /> : null}

        {engine?.details ? (
          <pre className="rounded-input border border-border bg-elevated p-3 font-mono text-12 text-text-secondary">
            {engine.details}
          </pre>
        ) : null}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onRecheck}
            className={cn(
              'rounded-button bg-accent px-4 py-2 text-13 font-medium text-white',
              'hover:opacity-90',
            )}
          >
            Re-check
          </button>
          <span className="text-11 text-text-tertiary">
            After installing or signing in, click re-check to continue.
          </span>
        </div>
      </div>
    </div>
  );
}

function InstallStep(): JSX.Element {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="flex items-center gap-2 text-14 font-medium text-text-primary">
        <TerminalIcon className="h-4 w-4 text-text-tertiary" />
        Install
      </h2>
      <pre className="overflow-x-auto rounded-input border border-border bg-elevated p-3 font-mono text-12 text-text-primary">
        {'curl -fsSL https://claude.ai/install.sh | bash'}
      </pre>
      <p className="text-12 text-text-tertiary">
        Installs to <span className="font-mono">~/.local/bin/claude</span> (or similar). You may
        need to reopen your terminal for the PATH change to take effect.
      </p>
    </section>
  );
}

function AuthStep(): JSX.Element {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="flex items-center gap-2 text-14 font-medium text-text-primary">
        <TerminalIcon className="h-4 w-4 text-text-tertiary" />
        Sign in
      </h2>
      <pre className="overflow-x-auto rounded-input border border-border bg-elevated p-3 font-mono text-12 text-text-primary">
        claude
      </pre>
      <p className="text-12 text-text-tertiary">Run once in a terminal and follow the prompts.</p>
    </section>
  );
}
