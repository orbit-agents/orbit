import { useEffect, useRef, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import {
  EVENT_TERMINAL_DATA,
  EVENT_TERMINAL_EXIT,
  type TerminalDataPayload,
  type TerminalExitPayload,
} from '@orbit/types';
import '@xterm/xterm/css/xterm.css';
import { useAgentsStore } from '@/stores/agents';
import { ipcTerminalClose, ipcTerminalOpen, ipcTerminalResize, ipcTerminalWrite } from '@/lib/ipc';

/**
 * Right-panel Terminal tab. Spawns a per-agent PTY at the agent's
 * working directory on mount, streams output to xterm.js, and ferries
 * stdin back via `terminal_write`. Tab unmount tears the PTY down.
 *
 * One PTY per (agent × open Terminal tab) — Phase 8 ships the simple
 * model. No backgrounding, no reconnect across app restart.
 */
export function AgentTerminalPanel(): JSX.Element {
  const agent = useAgentsStore((s) =>
    s.selectedAgentId ? (s.agents[s.selectedAgentId] ?? null) : null,
  );

  if (!agent) {
    return (
      <div className="flex h-full items-center justify-center text-13 text-text-tertiary">
        No agent selected.
      </div>
    );
  }
  return <TerminalBody key={agent.id} agentId={agent.id} workingDir={agent.workingDir} />;
}

function TerminalBody({
  agentId,
  workingDir,
}: {
  agentId: string;
  workingDir: string;
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [exitReason, setExitReason] = useState<string | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const term = new Terminal({
      fontFamily: 'JetBrains Mono, ui-monospace, monospace',
      fontSize: 12,
      lineHeight: 1.3,
      cursorBlink: true,
      theme: {
        background: '#0c0c0c',
        foreground: '#e8e8e8',
        cursor: '#4ade80',
        cursorAccent: '#0c0c0c',
      },
      convertEol: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();
    term.focus();
    termRef.current = term;
    fitRef.current = fit;

    let dataUnlisten: UnlistenFn | null = null;
    let exitUnlisten: UnlistenFn | null = null;
    let cancelled = false;

    void (async () => {
      try {
        await ipcTerminalOpen(agentId);
      } catch (err) {
        term.write(`\x1b[31morbit: failed to open terminal: ${String(err)}\x1b[0m\r\n`);
        return;
      }
      if (cancelled) return;

      dataUnlisten = await listen<TerminalDataPayload>(EVENT_TERMINAL_DATA, (e) => {
        if (e.payload.agentId !== agentId) return;
        term.write(e.payload.chunk);
      });
      exitUnlisten = await listen<TerminalExitPayload>(EVENT_TERMINAL_EXIT, (e) => {
        if (e.payload.agentId !== agentId) return;
        setExitReason(e.payload.reason);
      });

      // Send keystrokes back to the PTY.
      term.onData((data) => {
        void ipcTerminalWrite(agentId, data).catch((err) => {
          // PTY may have been closed; surface a soft warning instead
          // of throwing.
          console.warn('terminal write failed', err);
        });
      });

      // Sync the PTY size to the rendered grid.
      const handleResize = (): void => {
        if (!fitRef.current || !termRef.current) return;
        fitRef.current.fit();
        const { rows, cols } = termRef.current;
        void ipcTerminalResize(agentId, rows, cols).catch(() => {});
      };
      handleResize();
      const ro = new ResizeObserver(handleResize);
      ro.observe(el);
      // Stash ro on the element so we can disconnect on unmount.
      (el as unknown as { _orbitRo?: ResizeObserver })._orbitRo = ro;
    })();

    return () => {
      cancelled = true;
      void dataUnlisten?.();
      void exitUnlisten?.();
      const ro = (el as unknown as { _orbitRo?: ResizeObserver })._orbitRo;
      ro?.disconnect();
      termRef.current?.dispose();
      termRef.current = null;
      fitRef.current = null;
      void ipcTerminalClose(agentId).catch(() => {});
    };
  }, [agentId]);

  return (
    <div className="flex h-full flex-col bg-ink-0">
      <header className="flex items-center gap-2 border-b border-line-0 px-4 py-2.5">
        <span className="text-13 font-medium text-text-primary">Terminal</span>
        <span className="ml-2 truncate font-mono text-11 text-text-faint">{workingDir}</span>
        {exitReason ? (
          <span className="ml-auto rounded-[3px] border border-status-failed/40 bg-status-failed/10 px-1.5 py-0.5 font-mono text-10 text-status-failed">
            {exitReason}
          </span>
        ) : null}
      </header>
      <div ref={containerRef} className="flex-1 overflow-hidden p-2" />
    </div>
  );
}
