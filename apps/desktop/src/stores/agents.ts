import { create } from 'zustand';
import type { Agent, AgentEvent, Message, TokenUsage } from '@orbit/types';

export type AgentId = string;

/** One in-progress assistant turn, accumulated from streaming events. */
export interface StreamingTurn {
  /** Live assistant text as it streams in. */
  text: string;
  /** Tool calls encountered during this turn, in order. */
  toolCalls: StreamingToolCall[];
  /** Token usage reported at turn completion; null until the turn ends. */
  usage: TokenUsage | null;
}

export interface StreamingToolCall {
  toolId: string;
  toolName: string;
  input: unknown;
  /** True once a matching `tool_use_complete` has arrived. */
  complete: boolean;
  /** The tool's result, once it arrives. */
  result: string | null;
  /** Whether the tool reported an error. */
  isError: boolean;
}

interface AgentsState {
  agents: Record<AgentId, Agent>;
  orderedAgentIds: AgentId[];
  activeAgentId: AgentId | null;
  messagesByAgent: Record<AgentId, Message[]>;
  streamingByAgent: Record<AgentId, StreamingTurn | null>;
  lastErrorByAgent: Record<AgentId, string | null>;

  hydrate: (agents: Agent[]) => void;
  upsertAgent: (agent: Agent) => void;
  removeAgent: (agentId: AgentId) => void;
  selectAgent: (agentId: AgentId | null) => void;
  setMessages: (agentId: AgentId, messages: Message[]) => void;
  appendPersistedMessage: (agentId: AgentId, message: Message) => void;
  applyEvent: (agentId: AgentId, event: AgentEvent) => void;
  setAgentStatus: (agentId: AgentId, status: string) => void;
}

export const useAgentsStore = create<AgentsState>((set, get) => ({
  agents: {},
  orderedAgentIds: [],
  activeAgentId: null,
  messagesByAgent: {},
  streamingByAgent: {},
  lastErrorByAgent: {},

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
        activeAgentId: order[0] ?? null,
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
        activeAgentId: s.activeAgentId ?? agent.id,
      };
    }),

  removeAgent: (agentId) =>
    set((s) => {
      const { [agentId]: _discarded, ...rest } = s.agents;
      const order = s.orderedAgentIds.filter((id) => id !== agentId);
      const { [agentId]: _m, ...restMessages } = s.messagesByAgent;
      const { [agentId]: _st, ...restStream } = s.streamingByAgent;
      return {
        agents: rest,
        orderedAgentIds: order,
        activeAgentId: s.activeAgentId === agentId ? (order[0] ?? null) : s.activeAgentId,
        messagesByAgent: restMessages,
        streamingByAgent: restStream,
      };
    }),

  selectAgent: (agentId) => set(() => ({ activeAgentId: agentId })),

  setMessages: (agentId, messages) =>
    set((s) => ({
      messagesByAgent: { ...s.messagesByAgent, [agentId]: messages },
    })),

  appendPersistedMessage: (agentId, message) =>
    set((s) => {
      const existing = s.messagesByAgent[agentId] ?? [];
      if (existing.some((m) => m.id === message.id)) {
        return s;
      }
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
        // Phase 1 renders thinking inline as dimmed text, using the same
        // `text` buffer would conflate it with final output — for now we
        // just ignore. Phase 3 will add a dedicated thinking channel.
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
        // Clear the streaming buffer. Persisted rows will arrive via
        // `appendPersistedMessage` or on next load; Phase 1 keeps it
        // simple and re-fetches from the DB on demand.
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
        // Exhaustiveness sentinel — unknown future variant.
        const _unreachable: never = event;
        void _unreachable;
      }
    }
  },
}));
