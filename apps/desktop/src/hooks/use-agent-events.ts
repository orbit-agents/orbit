import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  EVENT_AGENT_ASSISTANT_MESSAGE_PERSISTED,
  EVENT_AGENT_EVENT,
  EVENT_AGENT_IDENTITY_UPDATED,
  EVENT_AGENT_MEMORY_ADDED,
  EVENT_AGENT_STATUS_CHANGE,
  EVENT_AGENT_TERMINATED,
  type AgentAssistantMessagePersistedPayload,
  type AgentEventPayload,
  type AgentIdentityUpdatedPayload,
  type AgentMemoryAddedPayload,
  type AgentStatusChangePayload,
  type AgentTerminatedPayload,
} from '@orbit/types';
import { useAgentsStore } from '@/stores/agents';

/**
 * Subscribe to Rust-side agent events and push them into the Zustand
 * store. Meant to be called once from the root `App` component.
 */
export function useAgentEvents(): void {
  const applyEvent = useAgentsStore((s) => s.applyEvent);
  const setAgentStatus = useAgentsStore((s) => s.setAgentStatus);
  const removeAgent = useAgentsStore((s) => s.removeAgent);
  const appendPersistedMessage = useAgentsStore((s) => s.appendPersistedMessage);
  const addMemory = useAgentsStore((s) => s.addMemory);
  const setIdentityDirty = useAgentsStore((s) => s.setIdentityDirty);

  useEffect(() => {
    const unlisteners: Array<Promise<() => void>> = [
      listen<AgentEventPayload>(EVENT_AGENT_EVENT, (e) => {
        applyEvent(e.payload.agentId, e.payload.event);
      }),
      listen<AgentStatusChangePayload>(EVENT_AGENT_STATUS_CHANGE, (e) => {
        setAgentStatus(e.payload.agentId, e.payload.status);
      }),
      listen<AgentTerminatedPayload>(EVENT_AGENT_TERMINATED, (e) => {
        // Phase 1: termination doesn't delete the agent row, just stops
        // its subprocess. We keep the row visible but mark status idle.
        setAgentStatus(e.payload.agentId, 'idle');
      }),
      // Phase 3: assistant message persisted — swap streaming bubble.
      // The streaming buffer is already cleared by `turn_complete` in
      // `applyEvent`; appending the persisted row keeps the chat panel
      // rendering the cleaned text once the turn ends.
      listen<AgentAssistantMessagePersistedPayload>(
        EVENT_AGENT_ASSISTANT_MESSAGE_PERSISTED,
        (e) => {
          appendPersistedMessage(e.payload.agentId, e.payload.message);
        },
      ),
      listen<AgentMemoryAddedPayload>(EVENT_AGENT_MEMORY_ADDED, (e) => {
        addMemory(e.payload.agentId, e.payload.entry, { highlight: true });
      }),
      listen<AgentIdentityUpdatedPayload>(EVENT_AGENT_IDENTITY_UPDATED, (e) => {
        setIdentityDirty(e.payload.agentId, e.payload.identityDirty);
      }),
    ];
    return () => {
      for (const p of unlisteners) {
        void p.then((fn) => fn()).catch(() => {});
      }
    };
  }, [
    applyEvent,
    setAgentStatus,
    removeAgent,
    appendPersistedMessage,
    addMemory,
    setIdentityDirty,
  ]);
}
