import { FolderIcon, MessageSquareIcon, SearchIcon, UsersIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

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
        <SidebarSection title="Folders" icon={FolderIcon} />
        <SidebarSection title="DMs" icon={MessageSquareIcon} />
        <SidebarSection title="Groups" icon={UsersIcon} />
      </div>
    </aside>
  );
}
