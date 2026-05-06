import {
  FolderIcon,
  LayoutGridIcon,
  ListChecksIcon,
  MessageSquareIcon,
  PlugIcon,
  SearchIcon,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { SidebarTeamsSection } from '@/features/teams/sidebar-teams-section';
import { SidebarGroupsSection } from '@/features/groups/sidebar-groups-section';
import { useUiStore, type CenterView } from '@/stores/ui-store';

interface SidebarSectionProps {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children?: React.ReactNode;
}

function SidebarSection({ title, icon: Icon, children }: SidebarSectionProps): JSX.Element {
  return (
    <section className="flex flex-col gap-2 px-3 py-2">
      <div className="flex items-center gap-2 text-11 font-medium uppercase tracking-wider text-text-tertiary">
        <Icon className="h-3 w-3" />
        <span>{title}</span>
      </div>
      <div className="text-13 text-text-secondary">
        {children ?? <span className="italic text-text-tertiary">empty</span>}
      </div>
    </section>
  );
}

export function Sidebar(): JSX.Element {
  return (
    <aside
      className={cn('flex flex-col border-r border-border-subtle bg-panel')}
      aria-label="Sidebar"
    >
      <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
        <SearchIcon className="h-3 w-3 text-text-tertiary" />
        <input
          type="text"
          placeholder="Search"
          className={cn(
            'w-full bg-transparent text-13 text-text-primary placeholder:text-text-tertiary',
            'focus:outline-none',
          )}
        />
      </div>
      <div className="overflow-y-auto">
        <CenterViewNav />
        <SidebarSection title="Folders" icon={FolderIcon} />
        <SidebarSection title="DMs" icon={MessageSquareIcon} />
        <SidebarGroupsSection />
        <SidebarTeamsSection />
      </div>
    </aside>
  );
}

/**
 * Workspace-level nav: switches the center pane between the canvas
 * and the Task Inbox. V1 Ledger spec lists "Tasks" as a top-level
 * row; clicking it replaces the canvas full-pane.
 */
function CenterViewNav(): JSX.Element {
  const view = useUiStore((s) => s.centerView);
  const setView = useUiStore((s) => s.setCenterView);
  return (
    <section className="flex flex-col px-2 pb-1 pt-2">
      <span className="px-2 pt-1 font-mono text-10 uppercase tracking-[0.12em] text-text-faint">
        Workspace
      </span>
      <NavRow
        label="Canvas"
        icon={<LayoutGridIcon className="h-3 w-3" />}
        active={view === 'canvas'}
        onClick={() => setView('canvas')}
      />
      <NavRow
        label="Tasks"
        icon={<ListChecksIcon className="h-3 w-3" />}
        active={view === 'task-inbox'}
        onClick={() => setView('task-inbox')}
      />
      <NavRow
        label="MCP"
        icon={<PlugIcon className="h-3 w-3" />}
        active={view === 'mcp-settings'}
        onClick={() => setView('mcp-settings')}
      />
    </section>
  );
}

function NavRow({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 rounded-[3px] px-2 py-1 text-left',
        'text-12 transition-colors duration-fast',
        active
          ? 'bg-ink-4 text-text-primary'
          : 'text-text-secondary hover:bg-hover hover:text-text-primary',
      )}
    >
      <span className="flex h-3 w-3 items-center justify-center text-text-faint">{icon}</span>
      <span className="flex-1">{label}</span>
    </button>
  );
}

// Phase 7: kept around so future panes can plug into the same nav
// without restructuring. Suppress the unused warning.
export type _CenterViewType = CenterView;
