import { create } from 'zustand';
import type {
  Agent,
  AgentEvent,
  GroupMessage,
  GroupThread,
  InterAgentMessage,
  MemoryEntry,
  Message,
  StickyNote,
  Task,
  Team,
  TokenUsage,
} from '@orbit/types';

export type AgentId = string;
export type MemoryEntryId = string;
export type InterAgentMessageId = string;
export type TeamId = string;
export type TaskId = string;
export type StickyNoteId = string;
export type GroupThreadId = string;
export type GroupMessageId = string;

export interface XY {
  x: number;
  y: number;
}

/** One in-progress assistant turn, accumulated from streaming events. */
export interface StreamingTurn {
  text: string;
  toolCalls: StreamingToolCall[];
  usage: TokenUsage | null;
}

export interface StreamingToolCall {
  toolId: string;
  toolName: string;
  input: unknown;
  complete: boolean;
  result: string | null;
  isError: boolean;
}

interface AgentsState {
  agents: Record<AgentId, Agent>;
  orderedAgentIds: AgentId[];

  /** Currently-selected agent on the canvas / in the right panel. */
  selectedAgentId: AgentId | null;

  messagesByAgent: Record<AgentId, Message[]>;
  streamingByAgent: Record<AgentId, StreamingTurn | null>;
  lastErrorByAgent: Record<AgentId, string | null>;

  /** Per-agent chat-input draft text. Preserved across agent switches. */
  chatDraftByAgent: Record<AgentId, string>;

  /** Per-agent scroll offset (pixels from top) for the chat panel. */
  chatScrollByAgent: Record<AgentId, number>;

  /** Transient flag: true while a drag is in progress for an agent so
   *  downstream consumers (e.g. position persistence) know when to write. */
  draggingAgentId: AgentId | null;

  /** Phase 3: per-agent memory list (newest first). Hydrated on demand
   *  from `memory_list`; live updates flow through `agent:memory_added`. */
  memoriesByAgent: Record<AgentId, MemoryEntry[]>;

  /** Memory ids freshly added since the last render — drives the slide-in
   *  highlight animation. Cleared after the highlight animation duration. */
  recentlyAddedMemoryIds: Record<MemoryEntryId, true>;

  /** Phase 4: per-agent inter-agent message list (newest first). Both
   *  outbound and inbound messages land here, keyed by the agent's id
   *  on the *focal* side — the agent the user is currently looking at. */
  interAgentMessagesByAgent: Record<AgentId, InterAgentMessage[]>;

  /** Phase 4: messages currently in flight on the canvas. Keyed by id
   *  for O(1) updates from the dispatch / delivered / acknowledged
   *  events. The MessageFlightLayer reads from this. */
  inFlightMessages: Record<InterAgentMessageId, InterAgentMessage>;

  /** Phase 5: teams keyed by id. Order is stable on creation. */
  teams: Record<TeamId, Team>;
  orderedTeamIds: TeamId[];

  /** Phase 5: when set, the canvas pans/fits to the named team's
   *  members on the next render and then clears the value. Used by
   *  the sidebar's Teams section to request "show me this team". */
  focusedTeamId: TeamId | null;

  /** Phase 7: per-agent task list. Both agent-emitted (via the
   *  `<task>` pseudo-tool) and human-edited tasks land here, keyed
   *  by the agent the task belongs to. */
  tasksByAgent: Record<AgentId, Task[]>;

  /** Phase 7: sticky notes are not per-agent — they're global canvas
   *  annotations. Keyed by id for O(1) updates from events. */
  stickyNotes: Record<StickyNoteId, StickyNote>;

  /** Phase 8: group threads (multi-agent + human chats). Order is
   *  insertion order. Messages keyed by thread id, members similarly. */
  groupThreads: Record<GroupThreadId, GroupThread>;
  orderedGroupThreadIds: GroupThreadId[];
  groupMessagesByThread: Record<GroupThreadId, GroupMessage[]>;
  groupMembersByThread: Record<GroupThreadId, AgentId[]>;
  /** When set, the center pane shows this thread's chat. */
  selectedGroupThreadId: GroupThreadId | null;

  hydrate: (agents: Agent[]) => void;
  upsertAgent: (agent: Agent) => void;
  removeAgent: (agentId: AgentId) => void;
  selectAgent: (agentId: AgentId | null) => void;
  renameAgent: (agentId: AgentId, name: string) => void;
  setIdentity: (agentId: AgentId, soul: string | null, purpose: string | null) => void;
  setIdentityDirty: (agentId: AgentId, dirty: boolean) => void;

  setMemories: (agentId: AgentId, memories: MemoryEntry[]) => void;
  addMemory: (agentId: AgentId, entry: MemoryEntry, opts?: { highlight?: boolean }) => void;
  updateMemory: (agentId: AgentId, entry: MemoryEntry) => void;
  deleteMemory: (agentId: AgentId, memoryId: MemoryEntryId) => void;
  clearMemoryHighlight: (memoryId: MemoryEntryId) => void;

  setInterAgentMessages: (agentId: AgentId, messages: InterAgentMessage[]) => void;
  upsertInterAgentMessage: (message: InterAgentMessage) => void;

  hydrateTeams: (teams: Team[]) => void;
  upsertTeam: (team: Team) => void;
  removeTeam: (teamId: TeamId) => void;
  setAgentTeam: (agentId: AgentId, teamId: TeamId | null) => void;
  focusTeam: (teamId: TeamId | null) => void;

  setTasks: (agentId: AgentId, tasks: Task[]) => void;
  upsertTask: (task: Task) => void;
  removeTask: (agentId: AgentId, taskId: TaskId) => void;

  hydrateStickyNotes: (notes: StickyNote[]) => void;
  upsertStickyNote: (note: StickyNote) => void;
  removeStickyNote: (noteId: StickyNoteId) => void;

  hydrateGroupThreads: (threads: GroupThread[]) => void;
  upsertGroupThread: (thread: GroupThread) => void;
  removeGroupThread: (threadId: GroupThreadId) => void;
  setGroupMessages: (threadId: GroupThreadId, messages: GroupMessage[]) => void;
  appendGroupMessage: (message: GroupMessage) => void;
  setGroupMembers: (threadId: GroupThreadId, agentIds: AgentId[]) => void;
  selectGroupThread: (threadId: GroupThreadId | null) => void;

  setMessages: (agentId: AgentId, messages: Message[]) => void;
  appendPersistedMessage: (agentId: AgentId, message: Message) => void;

  applyEvent: (agentId: AgentId, event: AgentEvent) => void;
  setAgentStatus: (agentId: AgentId, status: string) => void;

  updateAgentPosition: (agentId: AgentId, position: XY) => void;

  setChatDraft: (agentId: AgentId, text: string) => void;
  setChatScroll: (agentId: AgentId, offset: number) => void;

  setDraggingAgent: (agentId: AgentId | null) => void;
}

export const useAgentsStore = create<AgentsState>((set, get) => ({
  agents: {},
  orderedAgentIds: [],
  selectedAgentId: null,
  messagesByAgent: {},
  streamingByAgent: {},
  lastErrorByAgent: {},
  chatDraftByAgent: {},
  chatScrollByAgent: {},
  draggingAgentId: null,
  memoriesByAgent: {},
  recentlyAddedMemoryIds: {},
  interAgentMessagesByAgent: {},
  inFlightMessages: {},
  teams: {},
  orderedTeamIds: [],
  focusedTeamId: null,
  tasksByAgent: {},
  stickyNotes: {},
  groupThreads: {},
  orderedGroupThreadIds: [],
  groupMessagesByThread: {},
  groupMembersByThread: {},
  selectedGroupThreadId: null,

  hydrate: (agents) =>
    set(() => {
      const map: Record<AgentId, Agent> = {};
      const order: AgentId[] = [];
      for (const a of agents) {
        map[a.id] = a;
        order.push(a.id);
      }
      return {
        agents: map,
        orderedAgentIds: order,
        selectedAgentId: order[0] ?? null,
      };
    }),

  upsertAgent: (agent) =>
    set((s) => {
      const order = s.orderedAgentIds.includes(agent.id)
        ? s.orderedAgentIds
        : [...s.orderedAgentIds, agent.id];
      return {
        agents: { ...s.agents, [agent.id]: agent },
        orderedAgentIds: order,
        selectedAgentId: s.selectedAgentId ?? agent.id,
      };
    }),

  removeAgent: (agentId) =>
    set((s) => {
      const { [agentId]: _agent, ...restAgents } = s.agents;
      const order = s.orderedAgentIds.filter((id) => id !== agentId);
      const { [agentId]: _m, ...restMessages } = s.messagesByAgent;
      const { [agentId]: _st, ...restStream } = s.streamingByAgent;
      const { [agentId]: _d, ...restDraft } = s.chatDraftByAgent;
      const { [agentId]: _sc, ...restScroll } = s.chatScrollByAgent;
      const { [agentId]: _mem, ...restMemories } = s.memoriesByAgent;
      const { [agentId]: _iam, ...restIam } = s.interAgentMessagesByAgent;
      const { [agentId]: _tasks, ...restTasks } = s.tasksByAgent;
      return {
        agents: restAgents,
        orderedAgentIds: order,
        selectedAgentId: s.selectedAgentId === agentId ? (order[0] ?? null) : s.selectedAgentId,
        messagesByAgent: restMessages,
        streamingByAgent: restStream,
        chatDraftByAgent: restDraft,
        chatScrollByAgent: restScroll,
        memoriesByAgent: restMemories,
        interAgentMessagesByAgent: restIam,
        tasksByAgent: restTasks,
      };
    }),

  selectAgent: (agentId) => set(() => ({ selectedAgentId: agentId })),

  renameAgent: (agentId, name) =>
    set((s) => {
      const agent = s.agents[agentId];
      if (!agent) return s;
      return {
        agents: { ...s.agents, [agentId]: { ...agent, name } },
      };
    }),

  setMessages: (agentId, messages) =>
    set((s) => ({
      messagesByAgent: { ...s.messagesByAgent, [agentId]: messages },
    })),

  appendPersistedMessage: (agentId, message) =>
    set((s) => {
      const existing = s.messagesByAgent[agentId] ?? [];
      if (existing.some((m) => m.id === message.id)) return s;
      return {
        messagesByAgent: {
          ...s.messagesByAgent,
          [agentId]: [...existing, message],
        },
      };
    }),

  setAgentStatus: (agentId, status) =>
    set((s) => {
      const agent = s.agents[agentId];
      if (!agent) return s;
      return {
        agents: { ...s.agents, [agentId]: { ...agent, status } },
      };
    }),

  updateAgentPosition: (agentId, position) =>
    set((s) => {
      const agent = s.agents[agentId];
      if (!agent) return s;
      return {
        agents: {
          ...s.agents,
          [agentId]: { ...agent, positionX: position.x, positionY: position.y },
        },
      };
    }),

  setChatDraft: (agentId, text) =>
    set((s) => ({
      chatDraftByAgent: { ...s.chatDraftByAgent, [agentId]: text },
    })),

  setChatScroll: (agentId, offset) =>
    set((s) => ({
      chatScrollByAgent: { ...s.chatScrollByAgent, [agentId]: offset },
    })),

  setDraggingAgent: (agentId) => set(() => ({ draggingAgentId: agentId })),

  setIdentity: (agentId, soul, purpose) =>
    set((s) => {
      const agent = s.agents[agentId];
      if (!agent) return s;
      const next: Agent = { ...agent, identityDirty: 1 };
      if (soul !== null && soul !== undefined) next.soul = soul;
      if (purpose !== null && purpose !== undefined) next.purpose = purpose;
      return { agents: { ...s.agents, [agentId]: next } };
    }),

  setIdentityDirty: (agentId, dirty) =>
    set((s) => {
      const agent = s.agents[agentId];
      if (!agent) return s;
      return {
        agents: {
          ...s.agents,
          [agentId]: { ...agent, identityDirty: dirty ? 1 : 0 },
        },
      };
    }),

  setMemories: (agentId, memories) =>
    set((s) => ({ memoriesByAgent: { ...s.memoriesByAgent, [agentId]: memories } })),

  addMemory: (agentId, entry, opts) =>
    set((s) => {
      const existing = s.memoriesByAgent[agentId] ?? [];
      // Idempotent on duplicate ids — events can race with optimistic
      // updates from the modal-add path.
      if (existing.some((e) => e.id === entry.id)) return s;
      const nextList = [entry, ...existing];
      return {
        memoriesByAgent: { ...s.memoriesByAgent, [agentId]: nextList },
        recentlyAddedMemoryIds: opts?.highlight
          ? { ...s.recentlyAddedMemoryIds, [entry.id]: true }
          : s.recentlyAddedMemoryIds,
      };
    }),

  updateMemory: (agentId, entry) =>
    set((s) => {
      const existing = s.memoriesByAgent[agentId] ?? [];
      const nextList = existing.map((e) => (e.id === entry.id ? entry : e));
      return { memoriesByAgent: { ...s.memoriesByAgent, [agentId]: nextList } };
    }),

  deleteMemory: (agentId, memoryId) =>
    set((s) => {
      const existing = s.memoriesByAgent[agentId] ?? [];
      const nextList = existing.filter((e) => e.id !== memoryId);
      return { memoriesByAgent: { ...s.memoriesByAgent, [agentId]: nextList } };
    }),

  clearMemoryHighlight: (memoryId) =>
    set((s) => {
      if (!(memoryId in s.recentlyAddedMemoryIds)) return s;
      const { [memoryId]: _gone, ...rest } = s.recentlyAddedMemoryIds;
      return { recentlyAddedMemoryIds: rest };
    }),

  setInterAgentMessages: (agentId, messages) =>
    set((s) => ({
      interAgentMessagesByAgent: { ...s.interAgentMessagesByAgent, [agentId]: messages },
    })),

  upsertInterAgentMessage: (message) =>
    set((s) => {
      const updateList = (list: InterAgentMessage[] | undefined): InterAgentMessage[] => {
        const existing = list ?? [];
        const idx = existing.findIndex((m) => m.id === message.id);
        if (idx === -1) return [message, ...existing];
        const next = existing.slice();
        next[idx] = message;
        return next;
      };
      // Both endpoints care about this row.
      const next: Record<AgentId, InterAgentMessage[]> = { ...s.interAgentMessagesByAgent };
      next[message.fromAgentId] = updateList(next[message.fromAgentId]);
      if (message.fromAgentId !== message.toAgentId) {
        next[message.toAgentId] = updateList(next[message.toAgentId]);
      }
      // Track in-flight set: any non-terminal status keeps the row visible
      // on the canvas overlay; terminal statuses (acknowledged, failed)
      // get the row removed.
      const flight = { ...s.inFlightMessages };
      const terminal = message.status === 'acknowledged' || message.status === 'failed';
      if (terminal) {
        delete flight[message.id];
      } else {
        flight[message.id] = message;
      }
      return { interAgentMessagesByAgent: next, inFlightMessages: flight };
    }),

  hydrateTeams: (teams) =>
    set(() => {
      const map: Record<TeamId, Team> = {};
      const order: TeamId[] = [];
      for (const t of teams) {
        map[t.id] = t;
        order.push(t.id);
      }
      return { teams: map, orderedTeamIds: order };
    }),

  upsertTeam: (team) =>
    set((s) => {
      const order = s.orderedTeamIds.includes(team.id)
        ? s.orderedTeamIds
        : [...s.orderedTeamIds, team.id];
      return {
        teams: { ...s.teams, [team.id]: team },
        orderedTeamIds: order,
      };
    }),

  removeTeam: (teamId) =>
    set((s) => {
      const { [teamId]: _gone, ...rest } = s.teams;
      // Clear team_id from any agent that referenced it, optimistically.
      const nextAgents: Record<AgentId, Agent> = {};
      for (const id of Object.keys(s.agents)) {
        const a = s.agents[id]!;
        nextAgents[id] = a.teamId === teamId ? { ...a, teamId: null } : a;
      }
      return {
        teams: rest,
        orderedTeamIds: s.orderedTeamIds.filter((id) => id !== teamId),
        agents: nextAgents,
      };
    }),

  setAgentTeam: (agentId, teamId) =>
    set((s) => {
      const agent = s.agents[agentId];
      if (!agent) return s;
      return {
        agents: { ...s.agents, [agentId]: { ...agent, teamId } },
      };
    }),

  focusTeam: (teamId) => set(() => ({ focusedTeamId: teamId })),

  setTasks: (agentId, tasks) =>
    set((s) => ({ tasksByAgent: { ...s.tasksByAgent, [agentId]: tasks } })),

  upsertTask: (task) =>
    set((s) => {
      const list = s.tasksByAgent[task.agentId] ?? [];
      const idx = list.findIndex((t) => t.id === task.id);
      const next = idx === -1 ? [task, ...list] : list.map((t) => (t.id === task.id ? task : t));
      return { tasksByAgent: { ...s.tasksByAgent, [task.agentId]: next } };
    }),

  removeTask: (agentId, taskId) =>
    set((s) => {
      const list = s.tasksByAgent[agentId] ?? [];
      return {
        tasksByAgent: {
          ...s.tasksByAgent,
          [agentId]: list.filter((t) => t.id !== taskId),
        },
      };
    }),

  hydrateStickyNotes: (notes) =>
    set(() => {
      const map: Record<StickyNoteId, StickyNote> = {};
      for (const n of notes) map[n.id] = n;
      return { stickyNotes: map };
    }),

  upsertStickyNote: (note) => set((s) => ({ stickyNotes: { ...s.stickyNotes, [note.id]: note } })),

  removeStickyNote: (noteId) =>
    set((s) => {
      const { [noteId]: _gone, ...rest } = s.stickyNotes;
      return { stickyNotes: rest };
    }),

  hydrateGroupThreads: (threads) =>
    set(() => {
      const map: Record<GroupThreadId, GroupThread> = {};
      const order: GroupThreadId[] = [];
      for (const t of threads) {
        map[t.id] = t;
        order.push(t.id);
      }
      return { groupThreads: map, orderedGroupThreadIds: order };
    }),

  upsertGroupThread: (thread) =>
    set((s) => {
      const order = s.orderedGroupThreadIds.includes(thread.id)
        ? s.orderedGroupThreadIds
        : [...s.orderedGroupThreadIds, thread.id];
      return {
        groupThreads: { ...s.groupThreads, [thread.id]: thread },
        orderedGroupThreadIds: order,
      };
    }),

  removeGroupThread: (threadId) =>
    set((s) => {
      const { [threadId]: _gone, ...rest } = s.groupThreads;
      const { [threadId]: _msgs, ...restMsgs } = s.groupMessagesByThread;
      const { [threadId]: _members, ...restMembers } = s.groupMembersByThread;
      return {
        groupThreads: rest,
        orderedGroupThreadIds: s.orderedGroupThreadIds.filter((id) => id !== threadId),
        groupMessagesByThread: restMsgs,
        groupMembersByThread: restMembers,
        selectedGroupThreadId:
          s.selectedGroupThreadId === threadId ? null : s.selectedGroupThreadId,
      };
    }),

  setGroupMessages: (threadId, messages) =>
    set((s) => ({
      groupMessagesByThread: { ...s.groupMessagesByThread, [threadId]: messages },
    })),

  appendGroupMessage: (message) =>
    set((s) => {
      const list = s.groupMessagesByThread[message.threadId] ?? [];
      // Idempotent on duplicate ids — local optimistic insert can
      // race the event for the same row.
      if (list.some((m) => m.id === message.id)) return s;
      return {
        groupMessagesByThread: {
          ...s.groupMessagesByThread,
          [message.threadId]: [...list, message],
        },
      };
    }),

  setGroupMembers: (threadId, agentIds) =>
    set((s) => ({
      groupMembersByThread: { ...s.groupMembersByThread, [threadId]: agentIds },
    })),

  selectGroupThread: (threadId) => set(() => ({ selectedGroupThreadId: threadId })),

  applyEvent: (agentId, event) => {
    const current = get().streamingByAgent[agentId] ?? null;
    const ensure = (): StreamingTurn => current ?? { text: '', toolCalls: [], usage: null };

    switch (event.type) {
      case 'session_started': {
        set((s) => {
          const agent = s.agents[agentId];
          if (!agent) return s;
          return {
            agents: { ...s.agents, [agentId]: { ...agent, sessionId: event.session_id } },
          };
        });
        return;
      }
      case 'text_delta': {
        const turn = ensure();
        const next: StreamingTurn = { ...turn, text: turn.text + event.content };
        set((s) => ({
          streamingByAgent: { ...s.streamingByAgent, [agentId]: next },
        }));
        return;
      }
      case 'thinking_delta': {
        // Phase 3 will wire thinking into a dedicated channel.
        return;
      }
      case 'tool_use_start': {
        const turn = ensure();
        const next: StreamingTurn = {
          ...turn,
          toolCalls: [
            ...turn.toolCalls,
            {
              toolId: event.tool_id,
              toolName: event.tool_name,
              input: event.input,
              complete: false,
              result: null,
              isError: false,
            },
          ],
        };
        set((s) => ({
          streamingByAgent: { ...s.streamingByAgent, [agentId]: next },
        }));
        return;
      }
      case 'tool_use_complete': {
        const turn = ensure();
        const next: StreamingTurn = {
          ...turn,
          toolCalls: turn.toolCalls.map((c) =>
            c.toolId === event.tool_id ? { ...c, input: event.input, complete: true } : c,
          ),
        };
        set((s) => ({
          streamingByAgent: { ...s.streamingByAgent, [agentId]: next },
        }));
        return;
      }
      case 'tool_use_result': {
        const turn = ensure();
        const next: StreamingTurn = {
          ...turn,
          toolCalls: turn.toolCalls.map((c) =>
            c.toolId === event.tool_id
              ? { ...c, result: event.result, isError: event.is_error }
              : c,
          ),
        };
        set((s) => ({
          streamingByAgent: { ...s.streamingByAgent, [agentId]: next },
        }));
        return;
      }
      case 'turn_complete': {
        set((s) => ({
          streamingByAgent: { ...s.streamingByAgent, [agentId]: null },
          lastErrorByAgent: { ...s.lastErrorByAgent, [agentId]: null },
        }));
        return;
      }
      case 'error': {
        set((s) => ({
          streamingByAgent: { ...s.streamingByAgent, [agentId]: null },
          lastErrorByAgent: { ...s.lastErrorByAgent, [agentId]: event.message },
        }));
        return;
      }
      default: {
        const _unreachable: never = event;
        void _unreachable;
      }
    }
  },
}));

/**
 * Heuristic for the status ring on the canvas. Derived fresh each render
 * so we don't drift when the persisted row and the streaming state
 * disagree.
 *
 * Phase 1's status column on the DB is still authoritative for error
 * cases; Phase 2 lifts "active" and "waiting_for_human" into the store.
 */
export type DerivedStatus = 'idle' | 'active' | 'waiting_for_human' | 'error';

export function deriveStatus(
  agent: Agent,
  streaming: StreamingTurn | null,
  lastError: string | null,
  lastAssistantText: string | null,
): DerivedStatus {
  if (agent.status === 'error' || lastError) return 'error';
  if (streaming !== null) return 'active';
  // Heuristic: an agent is "waiting for human" if its last assistant
  // message ended with a question mark and no tool calls are pending.
  // Phase 7 replaces this with an explicit help flag.
  if (lastAssistantText && /[?？]\s*$/u.test(lastAssistantText)) {
    return 'waiting_for_human';
  }
  return 'idle';
}
