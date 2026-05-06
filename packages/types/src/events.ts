import type { Message } from './message.js';

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

export interface AgentMemoryAddedPayload {
  agentId: string;
  entry: MemoryEntry;
}

export interface AgentIdentityUpdatedPayload {
  agentId: string;
  identityDirty: boolean;
}

export interface AgentAssistantMessagePersistedPayload {
  agentId: string;
  message: Message;
}

/** Source attribution for a memory entry. Mirrors the Rust enum. */
export type MemorySource = 'user' | 'agent' | 'imported';

export interface MemoryEntry {
  id: string;
  agentId: string;
  content: string;
  category: string | null;
  /** Stored as string on the wire; narrow to `MemorySource` at the call site. */
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface ImportClaudeMdResult {
  imported: boolean;
  sourcePath: string | null;
}

/** Phase 6: per-file diff entry returned by agent_get_diff. */
export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked';

export interface DiffLine {
  origin: string;
  content: string;
  oldLineno: number | null;
  newLineno: number | null;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

export interface BranchInfo {
  branch: string;
  sourceRepo: string;
  baseBranch: string | null;
  baseRef: string;
  currentCommit: string;
  worktreePath: string;
}

import type { Task } from './task.js';

export interface AgentTaskCreatedPayload {
  task: Task;
}

export interface AgentTaskUpdatedPayload {
  task: Task;
}

export interface AgentTaskDeletedPayload {
  taskId: string;
  agentId: string;
}

/** Phase 7: human-only canvas annotation. */
export interface StickyNote {
  id: string;
  content: string;
  positionX: number;
  positionY: number;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface StickyNoteCreatedPayload {
  note: StickyNote;
}

export interface StickyNoteUpdatedPayload {
  note: StickyNote;
}

export interface StickyNoteDeletedPayload {
  noteId: string;
}

/** Phase 8: group thread (multiple agents + the human). */
export interface GroupThread {
  id: string;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface GroupThreadMember {
  threadId: string;
  agentId: string;
  addedAt: string;
}

export interface GroupMessage {
  id: string;
  threadId: string;
  /** `'human' | 'agent'` */
  senderKind: string;
  senderAgentId: string | null;
  content: string;
  createdAt: string;
}

export interface GroupMessageAppendedPayload {
  message: GroupMessage;
}

export interface GroupThreadUpdatedPayload {
  threadId: string;
}

/** Phase 8: external MCP server configuration. */
export interface McpServer {
  id: string;
  name: string;
  /** `'stdio' | 'http'` */
  transport: string;
  command: string | null;
  argsJson: string;
  envJson: string;
  url: string | null;
  isDefault: number;
  createdAt: string;
  updatedAt: string;
}

/** Phase 8: PTY data chunk emitted to the frontend. */
export interface TerminalDataPayload {
  agentId: string;
  chunk: string;
}

export interface TerminalExitPayload {
  agentId: string;
  reason: string;
}

/** Phase 7: chronological activity feed entry. */
export interface ActivityEntry {
  kind: string;
  agentId: string;
  timestamp: string;
  title: string;
  status: string | null;
  taskId: string | null;
  memoryId: string | null;
}

/** One row of the `inter_agent_messages` audit table. */
export type InterAgentMessageStatus = 'pending' | 'delivered' | 'acknowledged' | 'failed';

export interface InterAgentMessage {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  content: string;
  originHumanMessageId: string | null;
  depth: number;
  /** String on the wire so a future status doesn't break older databases. */
  status: string;
  createdAt: string;
  deliveredAt: string | null;
}

export interface AgentInterAgentMessageDispatchedPayload {
  message: InterAgentMessage;
}

export interface AgentInterAgentMessageFailedPayload {
  fromAgentId: string;
  toAgentName: string;
  /** Stable machine tag: 'unknown_recipient' | 'self_send' | 'depth_exceeded' | 'db_error'. */
  reason: string;
  detail: string;
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
export const EVENT_AGENT_MEMORY_ADDED = 'agent:memory_added' as const;
export const EVENT_AGENT_IDENTITY_UPDATED = 'agent:identity_updated' as const;
export const EVENT_AGENT_ASSISTANT_MESSAGE_PERSISTED = 'agent:assistant_message_persisted' as const;
export const EVENT_AGENT_INTER_AGENT_MESSAGE_DISPATCHED =
  'agent:inter_agent_message_dispatched' as const;
export const EVENT_AGENT_INTER_AGENT_MESSAGE_FAILED = 'agent:inter_agent_message_failed' as const;
export const EVENT_AGENT_TASK_CREATED = 'agent:task_created' as const;
export const EVENT_AGENT_TASK_UPDATED = 'agent:task_updated' as const;
export const EVENT_AGENT_TASK_DELETED = 'agent:task_deleted' as const;
export const EVENT_STICKY_NOTE_CREATED = 'sticky_note:created' as const;
export const EVENT_STICKY_NOTE_UPDATED = 'sticky_note:updated' as const;
export const EVENT_STICKY_NOTE_DELETED = 'sticky_note:deleted' as const;
export const EVENT_GROUP_MESSAGE_APPENDED = 'group:message_appended' as const;
export const EVENT_GROUP_THREAD_UPDATED = 'group:thread_updated' as const;
export const EVENT_TERMINAL_DATA = 'terminal:data' as const;
export const EVENT_TERMINAL_EXIT = 'terminal:exit' as const;
