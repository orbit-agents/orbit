import { create } from 'zustand';
import type {
  Agent,
  AgentEvent,
  InterAgentMessage,
  MemoryEntry,
  Message,
  TokenUsage,
} from '@orbit/types';

export type AgentId = string;
export type MemoryEntryId = string;
export type InterAgentMessageId = string;

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
