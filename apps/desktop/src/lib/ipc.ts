import { invoke } from '@tauri-apps/api/core';
import type {
  ActivityEntry,
  Agent,
  BranchInfo,
  FileDiff,
  GroupMessage,
  GroupThread,
  GroupThreadMember,
  ImportClaudeMdResult,
  InterAgentMessage,
  McpServer,
  MemoryEntry,
  Message,
  StickyNote,
  SystemHealth,
  Task,
  Team,
} from '@orbit/types';

/** Input shape matching the Rust `SpawnAgentInput` struct. */
export interface SpawnAgentInput {
  name: string;
  emoji: string;
  color: string;
  workingDir: string;
  modelOverride?: string | null;
  positionX?: number;
  positionY?: number;
}

export function ipcAgentSpawn(input: SpawnAgentInput): Promise<Agent> {
  return invoke<Agent>('agent_spawn', { input });
}

export function ipcAgentList(): Promise<Agent[]> {
  return invoke<Agent[]>('agent_list');
}

export function ipcAgentGetConversation(agentId: string): Promise<Message[]> {
  return invoke<Message[]>('agent_get_conversation', { agentId });
}

export function ipcAgentSendMessage(agentId: string, message: string): Promise<void> {
  return invoke<void>('agent_send_message', { agentId, message });
}

export function ipcAgentTerminate(agentId: string): Promise<void> {
  return invoke<void>('agent_terminate', { agentId });
}

export function ipcAgentDelete(agentId: string): Promise<void> {
  return invoke<void>('agent_delete', { agentId });
}

export function ipcAgentUpdatePosition(agentId: string, x: number, y: number): Promise<void> {
  return invoke<void>('agent_update_position', { agentId, x, y });
}

export function ipcAgentRename(agentId: string, name: string): Promise<void> {
  return invoke<void>('agent_rename', { agentId, name });
}

export interface UpdateIdentityInput {
  agentId: string;
  /** Pass `null`/undefined to leave that field untouched; pass `''` to clear. */
  soul?: string | null;
  purpose?: string | null;
}

export function ipcAgentUpdateIdentity(input: UpdateIdentityInput): Promise<void> {
  return invoke<void>('agent_update_identity', { input });
}

export function ipcMemoryList(agentId: string, search?: string): Promise<MemoryEntry[]> {
  return invoke<MemoryEntry[]>('memory_list', { agentId, search });
}

export interface CreateMemoryInput {
  agentId: string;
  content: string;
  category?: string | null;
}

export function ipcMemoryCreate(input: CreateMemoryInput): Promise<MemoryEntry> {
  return invoke<MemoryEntry>('memory_create', { input });
}

export function ipcMemoryUpdate(memoryId: string, content: string): Promise<MemoryEntry> {
  return invoke<MemoryEntry>('memory_update', { memoryId, content });
}

export function ipcMemoryDelete(memoryId: string, agentId: string): Promise<void> {
  return invoke<void>('memory_delete', { memoryId, agentId });
}

export function ipcAgentImportClaudeMd(agentId: string): Promise<ImportClaudeMdResult> {
  return invoke<ImportClaudeMdResult>('agent_import_claude_md', { agentId });
}

export function ipcAgentGetInterAgentMessages(
  agentId: string,
  limit?: number,
): Promise<InterAgentMessage[]> {
  return invoke<InterAgentMessage[]>('agent_get_inter_agent_messages', { agentId, limit });
}

export function ipcAgentGetAuditLog(limit?: number): Promise<InterAgentMessage[]> {
  return invoke<InterAgentMessage[]>('agent_get_audit_log', { limit });
}

// ─── Phase 5: teams + folder access ───────────────────────────────────────

export interface CreateTeamInput {
  name: string;
  color: string;
}

export function ipcTeamCreate(input: CreateTeamInput): Promise<Team> {
  return invoke<Team>('team_create', { input });
}

export function ipcTeamList(): Promise<Team[]> {
  return invoke<Team[]>('team_list');
}

export interface UpdateTeamInput {
  teamId: string;
  name?: string | null;
  color?: string | null;
}

export function ipcTeamUpdate(input: UpdateTeamInput): Promise<void> {
  return invoke<void>('team_update', { input });
}

export function ipcTeamDelete(teamId: string): Promise<void> {
  return invoke<void>('team_delete', { teamId });
}

export function ipcAgentSetTeam(agentId: string, teamId: string | null): Promise<void> {
  return invoke<void>('agent_set_team', { agentId, teamId });
}

export function ipcAgentUpdateFolderAccess(agentId: string, folders: string[]): Promise<void> {
  return invoke<void>('agent_update_folder_access', {
    input: { agentId, folders },
  });
}

// ─── Phase 6: git diff / branch info ──────────────────────────────────────

export function ipcAgentGetDiff(agentId: string): Promise<FileDiff[]> {
  return invoke<FileDiff[]>('agent_get_diff', { agentId });
}

export function ipcAgentGetBranchInfo(agentId: string): Promise<BranchInfo | null> {
  return invoke<BranchInfo | null>('agent_get_branch_info', { agentId });
}

// ─── Phase 7: tasks + sticky notes + activity feed ────────────────────────

export interface CreateTaskInput {
  agentId: string;
  title: string;
  description?: string | null;
  status?: string | null;
  priority?: string | null;
}

export function ipcTaskCreate(input: CreateTaskInput): Promise<Task> {
  return invoke<Task>('task_create', { input });
}

export function ipcTaskList(agentId: string): Promise<Task[]> {
  return invoke<Task[]>('task_list', { agentId });
}

export function ipcTaskListAll(limit?: number): Promise<Task[]> {
  return invoke<Task[]>('task_list_all', { limit });
}

export interface UpdateTaskInput {
  taskId: string;
  title?: string | null;
  description?: string | null;
  status?: string | null;
  priority?: string | null;
}

export function ipcTaskUpdate(input: UpdateTaskInput): Promise<Task> {
  return invoke<Task>('task_update', { input });
}

export function ipcTaskDelete(taskId: string, agentId: string): Promise<void> {
  return invoke<void>('task_delete', { taskId, agentId });
}

export interface CreateStickyNoteInput {
  content: string;
  positionX: number;
  positionY: number;
  color: string;
}

export function ipcStickyNoteCreate(input: CreateStickyNoteInput): Promise<StickyNote> {
  return invoke<StickyNote>('sticky_note_create', { input });
}

export function ipcStickyNoteList(): Promise<StickyNote[]> {
  return invoke<StickyNote[]>('sticky_note_list');
}

export interface UpdateStickyNoteInput {
  noteId: string;
  content?: string | null;
  positionX?: number | null;
  positionY?: number | null;
  color?: string | null;
}

export function ipcStickyNoteUpdate(input: UpdateStickyNoteInput): Promise<StickyNote> {
  return invoke<StickyNote>('sticky_note_update', { input });
}

export function ipcStickyNoteDelete(noteId: string): Promise<void> {
  return invoke<void>('sticky_note_delete', { noteId });
}

export function ipcAgentGetActivityFeed(limit?: number): Promise<ActivityEntry[]> {
  return invoke<ActivityEntry[]>('agent_get_activity_feed', { limit });
}

// ─── Phase 8: group threads ───────────────────────────────────────────────

export interface CreateGroupThreadInput {
  name: string;
  color: string;
}

export function ipcGroupThreadCreate(input: CreateGroupThreadInput): Promise<GroupThread> {
  return invoke<GroupThread>('group_thread_create', { input });
}

export function ipcGroupThreadList(): Promise<GroupThread[]> {
  return invoke<GroupThread[]>('group_thread_list');
}

export function ipcGroupThreadDelete(threadId: string): Promise<void> {
  return invoke<void>('group_thread_delete', { threadId });
}

export function ipcGroupThreadAddMember(threadId: string, agentId: string): Promise<void> {
  return invoke<void>('group_thread_add_member', { threadId, agentId });
}

export function ipcGroupThreadRemoveMember(threadId: string, agentId: string): Promise<void> {
  return invoke<void>('group_thread_remove_member', { threadId, agentId });
}

export function ipcGroupThreadListMembers(threadId: string): Promise<GroupThreadMember[]> {
  return invoke<GroupThreadMember[]>('group_thread_list_members', { threadId });
}

export function ipcGroupThreadListMessages(
  threadId: string,
  limit?: number,
): Promise<GroupMessage[]> {
  return invoke<GroupMessage[]>('group_thread_list_messages', { threadId, limit });
}

export function ipcGroupThreadPostMessage(
  threadId: string,
  content: string,
): Promise<GroupMessage> {
  return invoke<GroupMessage>('group_thread_post_message', { threadId, content });
}

// ─── Phase 8: MCP servers ─────────────────────────────────────────────────

export interface CreateMcpServerInput {
  name: string;
  transport: 'stdio' | 'http';
  command?: string | null;
  args?: string[];
  env?: Record<string, string>;
  url?: string | null;
  isDefault?: boolean;
}

export function ipcMcpServerCreate(input: CreateMcpServerInput): Promise<McpServer> {
  return invoke<McpServer>('mcp_server_create', { input });
}

export function ipcMcpServerList(): Promise<McpServer[]> {
  return invoke<McpServer[]>('mcp_server_list');
}

export interface UpdateMcpServerInput {
  serverId: string;
  name?: string | null;
  transport?: string | null;
  command?: string | null;
  args?: string[] | null;
  env?: Record<string, string> | null;
  url?: string | null;
  isDefault?: boolean | null;
}

export function ipcMcpServerUpdate(input: UpdateMcpServerInput): Promise<McpServer> {
  return invoke<McpServer>('mcp_server_update', { input });
}

export function ipcMcpServerDelete(serverId: string): Promise<void> {
  return invoke<void>('mcp_server_delete', { serverId });
}

// ─── Phase 8: terminal ────────────────────────────────────────────────────

export function ipcTerminalOpen(agentId: string): Promise<void> {
  return invoke<void>('terminal_open', { agentId });
}

export function ipcTerminalWrite(agentId: string, data: string): Promise<void> {
  return invoke<void>('terminal_write', { agentId, data });
}

export function ipcTerminalResize(agentId: string, rows: number, cols: number): Promise<void> {
  return invoke<void>('terminal_resize', { agentId, rows, cols });
}

export function ipcTerminalClose(agentId: string): Promise<void> {
  return invoke<void>('terminal_close', { agentId });
}

export function ipcSystemRevealPath(path: string): Promise<void> {
  return invoke<void>('system_reveal_path', { path });
}

export function ipcSystemHealthCheck(): Promise<SystemHealth> {
  return invoke<SystemHealth>('system_health_check');
}
