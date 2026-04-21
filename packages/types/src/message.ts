export type SenderType = 'human' | 'agent' | 'system';

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  senderType: SenderType;
  content: string;
  createdAt: string;
}

export type ConversationType = 'dm' | 'group' | 'agent-to-agent';

export interface Conversation {
  id: string;
  mapId: string;
  participantIds: readonly string[];
  type: ConversationType;
  createdAt: string;
}
