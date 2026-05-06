import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  EVENT_AGENT_ASSISTANT_MESSAGE_PERSISTED,
  EVENT_AGENT_EVENT,
  EVENT_AGENT_IDENTITY_UPDATED,
  EVENT_AGENT_INTER_AGENT_MESSAGE_DISPATCHED,
  EVENT_AGENT_INTER_AGENT_MESSAGE_FAILED,
  EVENT_AGENT_MEMORY_ADDED,
  EVENT_AGENT_STATUS_CHANGE,
  EVENT_AGENT_TERMINATED,
  type AgentAssistantMessagePersistedPayload,
  type AgentEventPayload,
  type AgentIdentityUpdatedPayload,
  type AgentInterAgentMessageDispatchedPayload,
  type AgentInterAgentMessageFailedPayload,
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
  const upsertInterAgentMessage = useAgentsStore((s) => s.upsertInterAgentMessage);

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
      // Phase 4: broker events. The dispatched event carries the row in
      // `pending` state; subsequent state changes (delivered →
      // acknowledged) show up via this same upsert path because the
      // backend re-emits dispatched on each transition. (For Phase 4
      // we only emit on dispatch + acknowledge; the canvas overlay
      // animates from pending until it disappears at acknowledge.)
      listen<AgentInterAgentMessageDispatchedPayload>(
        EVENT_AGENT_INTER_AGENT_MESSAGE_DISPATCHED,
        (e) => {
          upsertInterAgentMessage(e.payload.message);
        },
      ),
      listen<AgentInterAgentMessageFailedPayload>(EVENT_AGENT_INTER_AGENT_MESSAGE_FAILED, (e) => {
        // Failed messages don't carry a row id (the broker may have
        // failed before writing). Surface as a console warning for now;
        // the audit log will catch persistent failures.
        console.warn(
          `[orbit] inter-agent message failed: ${e.payload.fromAgentId} → ${e.payload.toAgentName} (${e.payload.reason}): ${e.payload.detail}`,
        );
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
    upsertInterAgentMessage,
  ]);
}
