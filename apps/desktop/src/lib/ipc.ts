import { invoke } from '@tauri-apps/api/core';
import type {
  Agent,
  ImportClaudeMdResult,
  InterAgentMessage,
  MemoryEntry,
  Message,
  SystemHealth,
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

export function ipcSystemHealthCheck(): Promise<SystemHealth> {
  return invoke<SystemHealth>('system_health_check');
}
