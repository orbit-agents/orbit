import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckSquareIcon, PlusIcon, SquareIcon, TrashIcon } from 'lucide-react';
import type { McpServer } from '@orbit/types';
import { cn } from '@/lib/cn';
import {
  ipcMcpServerCreate,
  ipcMcpServerDelete,
  ipcMcpServerList,
  ipcMcpServerUpdate,
} from '@/lib/ipc';

/**
 * V1 Ledger MCP Servers settings view. Replaces the canvas in the
 * center pane when the user picks Workspace → MCP. Lists configured
 * servers; lets the user toggle defaults; opens an inline form to
 * add a new one.
 */
export function McpSettingsView(): JSX.Element {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['mcp-servers'],
    queryFn: () => ipcMcpServerList(),
  });
  const servers = list.data ?? [];

  const [form, setForm] = useState<NewServerForm | null>(null);

  const create = useMutation({
    mutationFn: (input: NewServerForm) =>
      ipcMcpServerCreate({
        name: input.name.trim(),
        transport: input.transport,
        command: input.transport === 'stdio' ? input.command : null,
        args: input.transport === 'stdio' ? splitArgs(input.args) : [],
        env: input.transport === 'stdio' ? parseEnv(input.env) : {},
        url: input.transport === 'http' ? input.url : null,
        isDefault: input.isDefault,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['mcp-servers'] });
      setForm(null);
    },
  });

  return (
    <div className="flex h-full flex-col bg-app">
      <header className="flex items-center gap-2 border-b border-line-0 px-4 py-2.5">
        <span className="text-13 font-medium text-text-primary">MCP servers</span>
        <span className="ml-2 font-mono text-11 text-text-faint">{servers.length} configured</span>
        <button
          type="button"
          onClick={() => setForm(emptyForm())}
          disabled={form !== null}
          className={cn(
            'ml-auto rounded-button border border-line-2 bg-ink-3 px-3 py-1',
            'text-12 text-text-secondary hover:bg-hover hover:text-text-primary',
            'disabled:opacity-50',
          )}
        >
          <PlusIcon className="mr-1 inline-block h-3 w-3 -translate-y-px" />
          Add server
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto flex max-w-[720px] flex-col gap-3">
          <p className="rounded-card border border-line-2 bg-ink-2 p-3 text-12 text-text-tertiary">
            MCP servers expose external tools to your agents via Claude Code&apos;s{' '}
            <span className="font-mono text-text-secondary">--mcp-config</span>. Servers marked as{' '}
            <span className="font-mono text-text-secondary">default</span> get included in every
            newly-spawned agent. Existing agents need a respawn to pick up changes.
          </p>

          {form ? (
            <NewServerCard
              form={form}
              setForm={setForm}
              onSubmit={() => create.mutate(form)}
              onCancel={() => setForm(null)}
              pending={create.isPending}
            />
          ) : null}

          <ul className="flex flex-col gap-2">
            {servers.map((s) => (
              <ServerRow key={s.id} server={s} />
            ))}
            {servers.length === 0 && !form ? (
              <li className="rounded-card border border-line-2 bg-ink-2 p-4 text-center text-12 text-text-tertiary">
                No MCP servers yet.
              </li>
            ) : null}
          </ul>
        </div>
      </div>
    </div>
  );
}

interface NewServerForm {
  name: string;
  transport: 'stdio' | 'http';
  command: string;
  args: string;
  env: string;
  url: string;
  isDefault: boolean;
}

function emptyForm(): NewServerForm {
  return {
    name: '',
    transport: 'stdio',
    command: '',
    args: '',
    env: '',
    url: '',
    isDefault: true,
  };
}

function NewServerCard({
  form,
  setForm,
  onSubmit,
  onCancel,
  pending,
}: {
  form: NewServerForm;
  setForm: (next: NewServerForm) => void;
  onSubmit: () => void;
  onCancel: () => void;
  pending: boolean;
}): JSX.Element {
  return (
    <div className="rounded-card border border-line-3 bg-ink-2 p-3">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Name">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="filesystem"
            className={inputCls}
          />
        </Field>
        <Field label="Transport">
          <select
            value={form.transport}
            onChange={(e) => setForm({ ...form, transport: e.target.value as 'stdio' | 'http' })}
            className={inputCls}
          >
            <option value="stdio">stdio</option>
            <option value="http">http</option>
          </select>
        </Field>
        {form.transport === 'stdio' ? (
          <>
            <Field label="Command">
              <input
                value={form.command}
                onChange={(e) => setForm({ ...form, command: e.target.value })}
                placeholder="npx"
                className={inputCls}
              />
            </Field>
            <Field label="Args (one per line)">
              <textarea
                value={form.args}
                onChange={(e) => setForm({ ...form, args: e.target.value })}
                placeholder="-y\n@modelcontextprotocol/server-filesystem\n/home/me"
                rows={3}
                className={cn(inputCls, 'resize-none')}
              />
            </Field>
            <Field label="Env (KEY=VALUE per line)">
              <textarea
                value={form.env}
                onChange={(e) => setForm({ ...form, env: e.target.value })}
                placeholder="GITHUB_TOKEN=…"
                rows={2}
                className={cn(inputCls, 'resize-none')}
              />
            </Field>
          </>
        ) : (
          <Field label="URL">
            <input
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              placeholder="https://localhost:9090/mcp"
              className={inputCls}
            />
          </Field>
        )}
        <Field label="Include in new agents">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
              className="h-3.5 w-3.5 accent-status-running"
            />
            <span className="text-12 text-text-secondary">Default</span>
          </label>
        </Field>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-button px-3 py-1 text-12 text-text-secondary hover:text-text-primary"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={
            pending ||
            form.name.trim().length === 0 ||
            (form.transport === 'stdio' && form.command.trim().length === 0) ||
            (form.transport === 'http' && form.url.trim().length === 0)
          }
          onClick={onSubmit}
          className={cn(
            'rounded-button bg-accent px-3 py-1 text-12 font-medium text-white',
            'disabled:opacity-50',
          )}
        >
          Save
        </button>
      </div>
    </div>
  );
}

function ServerRow({ server }: { server: McpServer }): JSX.Element {
  const qc = useQueryClient();
  const update = useMutation({
    mutationFn: (next: { isDefault: boolean }) =>
      ipcMcpServerUpdate({ serverId: server.id, isDefault: next.isDefault }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['mcp-servers'] });
    },
  });
  const remove = useMutation({
    mutationFn: () => ipcMcpServerDelete(server.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['mcp-servers'] });
    },
  });
  const isDefault = server.isDefault === 1;
  return (
    <li className="group flex items-start gap-2 rounded-card border border-line-2 bg-ink-2 p-3">
      <button
        type="button"
        onClick={() => update.mutate({ isDefault: !isDefault })}
        aria-label={isDefault ? 'Disable default' : 'Mark default'}
        className="mt-0.5 text-text-faint hover:text-text-secondary"
      >
        {isDefault ? (
          <CheckSquareIcon className="h-3.5 w-3.5 text-status-running" />
        ) : (
          <SquareIcon className="h-3.5 w-3.5" />
        )}
      </button>
      <div className="flex flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="text-13 text-text-primary">{server.name}</span>
          <span className="rounded-[3px] border border-line-2 bg-ink-3 px-1.5 py-0.5 font-mono text-10 text-text-tertiary">
            {server.transport}
          </span>
          {isDefault ? (
            <span className="rounded-[3px] border border-status-running/40 bg-status-running/10 px-1.5 py-0.5 font-mono text-10 text-status-running">
              default
            </span>
          ) : null}
        </div>
        <span className="font-mono text-11 text-text-tertiary">
          {server.transport === 'stdio'
            ? `${server.command ?? '?'} ${truncateArgs(server.argsJson)}`
            : (server.url ?? '?')}
        </span>
      </div>
      <button
        type="button"
        onClick={() => {
          if (window.confirm(`Delete MCP server "${server.name}"?`)) {
            remove.mutate();
          }
        }}
        aria-label="Delete server"
        className="rounded-[3px] p-1 text-text-faint opacity-0 transition-opacity duration-fast hover:bg-hover hover:text-status-error group-hover:opacity-100"
      >
        <TrashIcon className="h-3 w-3" />
      </button>
    </li>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="flex flex-col gap-1 text-11 text-text-secondary">
      <span className="font-mono text-10 uppercase tracking-[0.12em] text-text-faint">{label}</span>
      {children}
    </label>
  );
}

const inputCls = cn(
  'rounded-input border border-line-2 bg-ink-3 px-2 py-1.5 text-12 text-text-primary',
  'placeholder:text-text-faint focus:border-line-3 focus:outline-none',
);

function splitArgs(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseEnv(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

function truncateArgs(json: string): string {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (Array.isArray(parsed)) {
      const flat = parsed.join(' ');
      return flat.length > 80 ? `${flat.slice(0, 79)}…` : flat;
    }
  } catch {
    // fall through
  }
  return '';
}
