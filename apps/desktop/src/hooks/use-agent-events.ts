import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  EVENT_AGENT_EVENT,
  EVENT_AGENT_STATUS_CHANGE,
  EVENT_AGENT_TERMINATED,
  type AgentEventPayload,
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
    ];
    return () => {
      for (const p of unlisteners) {
        void p.then((fn) => fn()).catch(() => {});
      }
    };
  }, [applyEvent, setAgentStatus, removeAgent]);
}
