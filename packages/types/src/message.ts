export type MessageRole = 'user' | 'assistant' | 'system' | 'tool_use' | 'tool_result';

/**
 * Serialized shape from the Rust `Message` struct. `content` is a JSON
 * string whose schema depends on the role:
 *
 * - `user` / `assistant` / `system`: `{ "text": "..." }`
 * - `tool_use`: `{ "tool_id": "...", "tool_name": "...", "input": ... }`
 * - `tool_result`: `{ "tool_id": "...", "result": "...", "is_error": bool }`
 *
 * Consumers must JSON.parse before rendering.
 */
export interface Message {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  createdAt: string;
}

export type ConversationType = 'dm' | 'group' | 'agent-to-agent';

export interface Conversation {
  id: string;
  agentId: string;
  createdAt: string;
}

/** Payload shapes parsed out of a stored `Message.content`. */
export interface UserOrAssistantContent {
  text: string;
}
export interface ToolUseContent {
  tool_id: string;
  tool_name: string;
  input: unknown;
}
export interface ToolResultContent {
  tool_id: string;
  result: string;
  is_error: boolean;
}
