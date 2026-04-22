import { invoke } from '@tauri-apps/api/core';
import type { Agent, Message, SystemHealth } from '@orbit/types';

/** Input shape matching the Rust `SpawnAgentInput` struct. */
export interface SpawnAgentInput {
  name: string;
  emoji: string;
  color: string;
  workingDir: string;
  modelOverride?: string | null;
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

export function ipcSystemHealthCheck(): Promise<SystemHealth> {
  return invoke<SystemHealth>('system_health_check');
}
