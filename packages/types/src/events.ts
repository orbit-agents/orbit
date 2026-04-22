/**
 * Discriminated union of events emitted by the agent engine, mirroring
 * the Rust `AgentEvent` enum (`#[serde(tag = "type", rename_all = "snake_case")]`).
 */
export type AgentEvent =
  | { type: 'session_started'; session_id: string }
  | { type: 'text_delta'; content: string }
  | { type: 'thinking_delta'; content: string }
  | {
      type: 'tool_use_start';
      tool_id: string;
      tool_name: string;
      input: unknown;
    }
  | {
      type: 'tool_use_complete';
      tool_id: string;
      tool_name: string;
      input: unknown;
    }
  | {
      type: 'tool_use_result';
      tool_id: string;
      result: string;
      is_error: boolean;
    }
  | { type: 'turn_complete'; usage: TokenUsage }
  | { type: 'error'; message: string; recoverable: boolean };

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface AgentEventPayload {
  agentId: string;
  event: AgentEvent;
}

export interface AgentStatusChangePayload {
  agentId: string;
  status: string;
}

export interface AgentTerminatedPayload {
  agentId: string;
  reason: string;
}

export interface EngineHealth {
  available: boolean;
  version: string | null;
  authenticated: boolean;
  details: string;
  executablePath: string | null;
}

export interface SystemHealth {
  engine: EngineHealth;
}

export const EVENT_AGENT_EVENT = 'agent:event' as const;
export const EVENT_AGENT_STATUS_CHANGE = 'agent:status_change' as const;
export const EVENT_AGENT_TERMINATED = 'agent:terminated' as const;
