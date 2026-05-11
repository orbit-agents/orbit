# Graph Report - . (2026-05-11)

## Corpus Check

- cluster-only mode — file stats not available

## Summary

- 734 nodes · 1574 edges · 44 communities (40 shown, 4 thin omitted)
- Extraction: 90% EXTRACTED · 10% INFERRED · 0% AMBIGUOUS · INFERRED: 154 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness

- Built from commit: `612d1130`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)

- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]

## God Nodes (most connected - your core abstractions)

1. `err()` - 55 edges
2. `cn()` - 53 edges
3. `agents` - 42 edges
4. `useAgentsStore` - 41 edges
5. `extract()` - 26 edges
6. `AgentSettingsPanel()` - 25 edges
7. `memory_pool()` - 25 edges
8. `memory_list()` - 19 edges
9. `AgentChatPanel()` - 18 edges
10. `McpSettingsView()` - 17 edges

## Surprising Connections (you probably didn't know these)

- `ResizeHandle()` --calls--> `cn()` [INFERRED]
  apps/desktop/src/App.tsx → packages/ui/src/cn.ts
- `NavRow()` --calls--> `cn()` [INFERRED]
  apps/desktop/src/components/layout/Sidebar.tsx → packages/ui/src/cn.ts
- `NewServerCard()` --calls--> `cn()` [INFERRED]
  apps/desktop/src/features/mcp/mcp-settings-view.tsx → packages/ui/src/cn.ts
- `UserMessageBubble()` --calls--> `cn()` [INFERRED]
  apps/desktop/src/features/agents/message-bubble.tsx → packages/ui/src/cn.ts
- `StatusPill()` --calls--> `cn()` [INFERRED]
  apps/desktop/src/features/agents/inbox/inbox-list.tsx → packages/ui/src/cn.ts

## Communities (44 total, 4 thin omitted)

### Community 0 - "Community 0"

Cohesion: 0.06
Nodes (42): AgentProcess, ClaudeCodeEngine, configure_child_platform(), dirs_home_dir(), discover_claude_executable(), EngineState, health_check_with_missing_binary_is_available_false(), send_message_to_unknown_agent_errors() (+34 more)

### Community 1 - "Community 1"

Cohesion: 0.05
Nodes (56): delete_task(), delete_team(), list_all_tasks(), list_group_threads(), list_inter_agent_audit_log(), list_mcp_servers(), list_sticky_notes(), list_tasks_for_agent() (+48 more)

### Community 2 - "Community 2"

Cohesion: 0.07
Nodes (27): BrokerError, InboxState, QueuedTurn, TurnContext, AppState, DbError, open(), classify_status() (+19 more)

### Community 3 - "Community 3"

Cohesion: 0.08
Nodes (33): GroupChatBody(), GroupChatView(), MemberStrip(), CreateStickyNoteInput, CreateTaskInput, ipcGroupThreadAddMember(), ipcGroupThreadDelete(), ipcGroupThreadList() (+25 more)

### Community 4 - "Community 4"

Cohesion: 0.1
Nodes (34): cap_memory(), cap_send_to(), cap_string(), caps_long_send_to_content_and_flags_truncated(), empty_send_to_content_is_dropped(), extract(), ExtractedSendTo, ExtractedTask (+26 more)

### Community 5 - "Community 5"

Cohesion: 0.1
Nodes (35): parse_folder_access_for_rehydrate(), rehydrate_agents(), count_agents(), delete_mcp_server(), delete_memory_entry(), get_mcp_server(), insert_mcp_server(), insert_memory_entry() (+27 more)

### Community 6 - "Community 6"

Cohesion: 0.08
Nodes (29): AgentSettingsPanel(), InfoRow(), RenameRow(), TerminateButton(), truncate(), AccordionSection(), AccordionSectionProps, AgentDiffPanel() (+21 more)

### Community 7 - "Community 7"

Cohesion: 0.09
Nodes (22): SystemHealthSetupView(), Canvas(), useAgentEvents(), ShortcutOptions, CanvasPlaceholder(), ipcAgentGetActivityFeed(), ipcAgentList(), ipcSystemHealthCheck() (+14 more)

### Community 8 - "Community 8"

Cohesion: 0.18
Nodes (21): agent_name_is_included(), AgentSummary, branch_addendum_appears_when_branch_context_is_provided(), BranchContext, builder(), custom_soul_and_purpose_replace_defaults(), defaults_used_when_soul_and_purpose_are_none(), empty_or_whitespace_soul_and_purpose_fall_back_to_defaults() (+13 more)

### Community 9 - "Community 9"

Cohesion: 0.16
Nodes (25): memory_pool(), migration_creates_expected_tables(), migration_is_idempotent(), clear_agent_worktree(), delete_agent(), delete_agent_cascades_to_conversations_and_messages(), deleting_agent_cascades_group_membership_but_not_message_history(), deleting_agent_cascades_inter_agent_messages() (+17 more)

### Community 10 - "Community 10"

Cohesion: 0.09
Nodes (22): ActivityEntry, BranchInfo, EVENT_AGENT_ASSISTANT_MESSAGE_PERSISTED, EVENT_AGENT_EVENT, EVENT_AGENT_IDENTITY_UPDATED, EVENT_AGENT_INTER_AGENT_MESSAGE_DISPATCHED, EVENT_AGENT_INTER_AGENT_MESSAGE_FAILED, EVENT_AGENT_MEMORY_ADDED (+14 more)

### Community 11 - "Community 11"

Cohesion: 0.13
Nodes (18): AgentChatPanel(), MergedToolRow, PlainRow, ChatInput(), AssistantTextBubble(), InboundAgentBubble(), InboundUserContent, PersistedMessageBubble() (+10 more)

### Community 12 - "Community 12"

Cohesion: 0.16
Nodes (17): AgentDetailPanel(), TABS, AgentRow(), statusDotColor(), lastAssistantTextFor(), GROUP_COLOR_PALETTE, SidebarGroupsSection(), IdentityPendingPill() (+9 more)

### Community 13 - "Community 13"

Cohesion: 0.14
Nodes (14): nodeTypes, AgentNode, AgentNodeData, AgentNodeImpl(), ringClass(), RingDef, active, activeEls (+6 more)

### Community 14 - "Community 14"

Cohesion: 0.18
Nodes (17): run_group_turn(), run_inbound_turn(), run_turn(), run_user_turn(), TurnRequest, get_or_create_conversation_for_agent(), insert_conversation(), insert_inter_agent_message() (+9 more)

### Community 15 - "Community 15"

Cohesion: 0.13
Nodes (15): AddMemoryForm(), MemoryListProps, MemoryRow(), InboxList(), InboxListProps, relativeTime(), Row(), Section() (+7 more)

### Community 16 - "Community 16"

Cohesion: 0.12
Nodes (16): AgentAssistantMessagePersistedPayload, AgentEventPayload, AgentIdentityUpdatedPayload, AgentInterAgentMessageDispatchedPayload, AgentInterAgentMessageFailedPayload, AgentMemoryAddedPayload, AgentStatusChangePayload, AgentTaskCreatedPayload (+8 more)

### Community 17 - "Community 17"

Cohesion: 0.21
Nodes (15): allows_surrounding_whitespace_on_marker_line(), cap_length(), caps_long_memory_content_and_flags_truncated(), drops_empty_marker_silently(), extract_memories(), ExtractedMemory, extracts_a_single_marker_on_its_own_line(), extracts_multiple_markers() (+7 more)

### Community 18 - "Community 18"

Cohesion: 0.13
Nodes (16): add_group_member(), delete_group_thread(), get_group_thread(), group_thread_lifecycle_create_add_member_post_list_delete(), insert_group_message(), insert_group_thread(), list_group_members(), list_group_messages() (+8 more)

### Community 19 - "Community 19"

Cohesion: 0.17
Nodes (11): CanvasInner(), STICKY_COLOR_PALETTE, ButtonProps, CanvasToolbar(), ToolbarButton(), EmptyCanvasPrompt(), useCanvasShortcuts(), ipcAgentSetTeam() (+3 more)

### Community 20 - "Community 20"

Cohesion: 0.21
Nodes (11): GroupMessage, GroupThread, GroupThreadMember, InterAgentMessage, McpServer, MemoryEntry, MemorySource, MessageRole (+3 more)

### Community 21 - "Community 21"

Cohesion: 0.14
Nodes (13): Architecture, ADR 0001 — Tauri 2 over Electron, ADR 0002 — Claude Code CLI as the agent runtime, ADR 0003 — One long-lived `claude` subprocess per agent, ADR 0004 — Canvas state ownership: Zustand, not React Flow, ADR 0005 — The `remember` tool: prompt-based pseudo-tool, not MCP (yet), ADR 0006 — `send_message_to_agent` ships as a `<send_to>` pseudo-tool, ADR 0007 — Team region bounds are derived, not authored (+5 more)

### Community 22 - "Community 22"

Cohesion: 0.15
Nodes (10): ipcMcpServerCreate(), ipcMcpServerDelete(), ipcMcpServerList(), ipcMcpServerUpdate(), inputCls, McpSettingsView(), NewServerCard(), NewServerForm (+2 more)

### Community 23 - "Community 23"

Cohesion: 0.18
Nodes (11): buildTeamRegions(), findTeamAtPoint(), NODE_CENTER_OFFSET, TeamRegion, big, [region], small, t1 (+3 more)

### Community 24 - "Community 24"

Cohesion: 0.17
Nodes (13): AgentCountPill(), MessageFlightLayer(), StickyNoteLayer(), agents, StickyNote, ipcStickyNoteList(), ipcStickyNoteUpdate(), AgentId (+5 more)

### Community 25 - "Community 25"

Cohesion: 0.18
Nodes (11): COLORS, EMOJIS, SpawnAgentDialog(), ACTIONS, AgentContextMenu(), AgentContextMenuAction, Props, AdvancedSection() (+3 more)

### Community 26 - "Community 26"

Cohesion: 0.24
Nodes (7): Agent, AgentStatus, Position, Folder, Map, RegionBounds, Team

### Community 27 - "Community 27"

Cohesion: 0.2
Nodes (8): deriveStatus(), a, deltas, e, e1, e2, events, m

### Community 28 - "Community 28"

Cohesion: 0.25
Nodes (6): AgentEngine, EngineError, SpawnConfig, AgentEvent, EngineHealth, TokenUsage

### Community 29 - "Community 29"

Cohesion: 0.29
Nodes (8): delete_sticky_note(), get_sticky_note(), insert_sticky_note(), sticky_note_round_trip(), sticky_note_create(), sticky_note_delete(), sticky_note_update(), UpdateStickyNoteInput

### Community 30 - "Community 30"

Cohesion: 0.33
Nodes (4): OrbitMark(), OrbitMarkProps, OrbitWordmarkProps, TopBar()

### Community 31 - "Community 31"

Cohesion: 0.29
Nodes (6): Conversation, Message, ConversationType, ToolResultContent, ToolUseContent, UserOrAssistantContent

### Community 32 - "Community 32"

Cohesion: 0.4
Nodes (6): get_team(), insert_team(), update_team(), update_team_hint_round_trips(), team_create(), team_update()

## Knowledge Gaps

- **134 isolated node(s):** `RegionBounds`, `EVENT_AGENT_EVENT`, `EVENT_AGENT_STATUS_CHANGE`, `EVENT_AGENT_TERMINATED`, `EVENT_AGENT_MEMORY_ADDED` (+129 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions

_Questions this graph is uniquely positioned to answer:_

- **Why does `agents` connect `Community 24` to `Community 3`, `Community 6`, `Community 7`, `Community 11`, `Community 12`, `Community 13`, `Community 15`, `Community 19`, `Community 20`, `Community 23`, `Community 25`, `Community 27`?**
  _High betweenness centrality (0.155) - this node is a cross-community bridge._
- **Why does `err()` connect `Community 1` to `Community 32`, `Community 0`, `Community 2`, `Community 5`, `Community 9`, `Community 12`, `Community 14`, `Community 15`, `Community 18`, `Community 29`?**
  _High betweenness centrality (0.136) - this node is a cross-community bridge._
- **Why does `StickyNote` connect `Community 24` to `Community 5`, `Community 6`, `Community 7`, `Community 10`, `Community 20`?**
  _High betweenness centrality (0.132) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `err()` (e.g. with `.write()` and `.create()`) actually correct?**
  _`err()` has 4 INFERRED edges - model-reasoned connections that need verification._
- **Are the 52 inferred relationships involving `cn()` (e.g. with `ResizeHandle()` and `AccordionSection()`) actually correct?**
  _`cn()` has 52 INFERRED edges - model-reasoned connections that need verification._
- **What connects `RegionBounds`, `EVENT_AGENT_EVENT`, `EVENT_AGENT_STATUS_CHANGE` to the rest of the system?**
  _134 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._
