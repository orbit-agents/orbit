import { cn } from '@/lib/cn';
import { useUiStore, type RightPanelTab } from '@/stores/ui-store';
import { useAgentsStore } from '@/stores/agents';
import { AgentChatPanel } from './agent-chat-panel';
import { AgentSettingsPanel } from './agent-settings-panel';
import { IdentityPendingPill } from './identity/identity-pending-pill';

const TABS: { id: RightPanelTab; label: string }[] = [
  { id: 'chat', label: 'Chat' },
  { id: 'settings', label: 'Settings' },
];

/**
 * Wraps the right-panel content with a Chat / Settings tab strip. The
 * active tab lives in the UI store so the canvas double-click can jump
 * straight to Settings.
 */
export function AgentDetailPanel(): JSX.Element {
  const tab = useUiStore((s) => s.rightPanelTab);
  const setTab = useUiStore((s) => s.setRightPanelTab);
  const identityDirty = useAgentsStore((s) =>
    s.selectedAgentId ? Boolean(s.agents[s.selectedAgentId]?.identityDirty) : false,
  );

  return (
    <aside className="flex h-full flex-col border-l border-border-subtle bg-panel">
      <nav
        role="tablist"
        aria-label="Agent detail"
        className="flex items-center gap-1 border-b border-border-subtle px-3 py-2"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'rounded-input px-3 py-1 text-13',
              tab === t.id
                ? 'bg-hover text-text-primary'
                : 'text-text-secondary hover:bg-hover/60 hover:text-text-primary',
            )}
          >
            {t.label}
          </button>
        ))}
        {identityDirty ? (
          <span className="ml-auto">
            <IdentityPendingPill />
          </span>
        ) : null}
      </nav>
      <div className="min-h-0 flex-1">
        {tab === 'chat' ? <AgentChatPanel /> : <AgentSettingsPanel />}
      </div>
    </aside>
  );
}
