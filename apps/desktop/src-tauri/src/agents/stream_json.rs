//! Parser for Claude Code's `--output-format stream-json` NDJSON output.
//!
//! Claude Code emits newline-delimited JSON events of several shapes:
//!
//! 1. `{"type":"system","subtype":"init","session_id":"..."}` — session start
//! 2. Batched assistant messages with full content blocks:
//!    `{"type":"assistant","message":{"content":[{"type":"text",...}]}}`
//! 3. Tool results:
//!    `{"type":"user","message":{"content":[{"type":"tool_result",...}]}}`
//! 4. Optional streaming sub-events: `content_block_{start,delta,stop}`,
//!    `message_{start,delta,stop}` — emitted when finer-grained streaming
//!    is available.
//! 5. `{"type":"result","subtype":"success","usage":{...}}` — turn end
//!
//! We translate these into our own [`AgentEvent`] enum, keeping the
//! protocol confined to this file. See [`AgentEvent`] for the target
//! shape.
//!
//! The parser is stateful: tool-use input can arrive in deltas and must be
//! reassembled per `index`. State is per-agent — one parser per agent.

use std::collections::HashMap;

use serde::Deserialize;
use serde_json::Value;

use super::engine::{AgentEvent, TokenUsage};

#[derive(Debug, Default)]
pub struct StreamJsonParser {
    /// Partial input-JSON buffers for tool_use content blocks that are
    /// being delta-streamed. Keyed by content block index.
    tool_inputs: HashMap<u64, PartialTool>,
}

#[derive(Debug, Clone)]
struct PartialTool {
    tool_id: String,
    tool_name: String,
    input_json: String,
}

impl StreamJsonParser {
    pub fn new() -> Self {
        Self::default()
    }

    /// Parse one NDJSON line and emit zero or more [`AgentEvent`]s.
    ///
    /// Unknown event shapes are tolerated — we never hard-fail on a single
    /// line, because the CLI format may evolve and we would rather drop
    /// an event than crash the whole conversation.
    pub fn feed_line(&mut self, line: &str) -> Vec<AgentEvent> {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return Vec::new();
        }

        let value: Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!(error = %e, line = %trimmed, "failed to parse stream-json line");
                return vec![AgentEvent::Error {
                    message: format!("invalid JSON from engine: {e}"),
                    recoverable: true,
                }];
            }
        };

        let Some(kind) = value.get("type").and_then(Value::as_str) else {
            return Vec::new();
        };

        match kind {
            "system" => self.handle_system(&value),
            "assistant" => self.handle_assistant(&value),
            "user" => self.handle_user(&value),
            "result" => self.handle_result(&value),
            "content_block_start" => self.handle_content_block_start(&value),
            "content_block_delta" => self.handle_content_block_delta(&value),
            "content_block_stop" => self.handle_content_block_stop(&value),
            // message_start / message_delta / message_stop carry usage and
            // stop_reason info, but we emit TurnComplete from the `result`
            // event instead, so we can ignore these.
            "message_start" | "message_delta" | "message_stop" => Vec::new(),
            _ => Vec::new(),
        }
    }

    fn handle_system(&mut self, value: &Value) -> Vec<AgentEvent> {
        let subtype = value.get("subtype").and_then(Value::as_str);
        if subtype != Some("init") {
            return Vec::new();
        }
        let Some(session_id) = value.get("session_id").and_then(Value::as_str) else {
            return Vec::new();
        };
        vec![AgentEvent::SessionStarted {
            session_id: session_id.to_string(),
        }]
    }

    fn handle_assistant(&mut self, value: &Value) -> Vec<AgentEvent> {
        let Some(content) = value
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(Value::as_array)
        else {
            return Vec::new();
        };

        let mut out = Vec::new();
        for block in content {
            if let Some(ev) = self.translate_assistant_block(block) {
                match ev {
                    BlockTranslation::Single(e) => out.push(e),
                    BlockTranslation::Pair(a, b) => {
                        out.push(a);
                        out.push(b);
                    }
                }
            }
        }
        out
    }

    fn translate_assistant_block(&mut self, block: &Value) -> Option<BlockTranslation> {
        let kind = block.get("type").and_then(Value::as_str)?;
        match kind {
            "text" => {
                let text = block.get("text").and_then(Value::as_str)?.to_string();
                Some(BlockTranslation::Single(AgentEvent::TextDelta {
                    content: text,
                }))
            }
            "thinking" => {
                let text = block.get("thinking").and_then(Value::as_str)?.to_string();
                Some(BlockTranslation::Single(AgentEvent::ThinkingDelta {
                    content: text,
                }))
            }
            "tool_use" => {
                let tool_id = block.get("id").and_then(Value::as_str)?.to_string();
                let tool_name = block.get("name").and_then(Value::as_str)?.to_string();
                let input = block.get("input").cloned().unwrap_or(Value::Null);
                Some(BlockTranslation::Pair(
                    AgentEvent::ToolUseStart {
                        tool_id: tool_id.clone(),
                        tool_name: tool_name.clone(),
                        input: input.clone(),
                    },
                    AgentEvent::ToolUseComplete {
                        tool_id,
                        tool_name,
                        input,
                    },
                ))
            }
            _ => None,
        }
    }

    fn handle_user(&mut self, value: &Value) -> Vec<AgentEvent> {
        let Some(content) = value
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(Value::as_array)
        else {
            return Vec::new();
        };

        content
            .iter()
            .filter_map(|b| {
                if b.get("type").and_then(Value::as_str) != Some("tool_result") {
                    return None;
                }
                let tool_id = b.get("tool_use_id").and_then(Value::as_str)?.to_string();
                let is_error = b.get("is_error").and_then(Value::as_bool).unwrap_or(false);
                let result = content_to_string(b.get("content"));
                Some(AgentEvent::ToolUseResult {
                    tool_id,
                    result,
                    is_error,
                })
            })
            .collect()
    }

    fn handle_result(&mut self, value: &Value) -> Vec<AgentEvent> {
        let usage = parse_usage(value.get("usage"));
        let mut out = Vec::new();

        if value
            .get("subtype")
            .and_then(Value::as_str)
            .map(|s| s == "error")
            .unwrap_or(false)
        {
            if let Some(message) = value.get("result").and_then(Value::as_str) {
                out.push(AgentEvent::Error {
                    message: message.to_string(),
                    recoverable: true,
                });
                return out;
            }
        }

        out.push(AgentEvent::TurnComplete { usage });
        out
    }

    fn handle_content_block_start(&mut self, value: &Value) -> Vec<AgentEvent> {
        let index = value.get("index").and_then(Value::as_u64).unwrap_or(0);
        let Some(block) = value.get("content_block") else {
            return Vec::new();
        };
        let kind = block.get("type").and_then(Value::as_str).unwrap_or("");
        if kind != "tool_use" {
            return Vec::new();
        }
        let Some(tool_id) = block.get("id").and_then(Value::as_str) else {
            return Vec::new();
        };
        let Some(tool_name) = block.get("name").and_then(Value::as_str) else {
            return Vec::new();
        };
        let input = block.get("input").cloned().unwrap_or(Value::Null);
        self.tool_inputs.insert(
            index,
            PartialTool {
                tool_id: tool_id.to_string(),
                tool_name: tool_name.to_string(),
                input_json: String::new(),
            },
        );
        vec![AgentEvent::ToolUseStart {
            tool_id: tool_id.to_string(),
            tool_name: tool_name.to_string(),
            input,
        }]
    }

    fn handle_content_block_delta(&mut self, value: &Value) -> Vec<AgentEvent> {
        let index = value.get("index").and_then(Value::as_u64).unwrap_or(0);
        let Some(delta) = value.get("delta") else {
            return Vec::new();
        };
        let kind = delta.get("type").and_then(Value::as_str).unwrap_or("");
        match kind {
            "text_delta" => {
                let Some(text) = delta.get("text").and_then(Value::as_str) else {
                    return Vec::new();
                };
                vec![AgentEvent::TextDelta {
                    content: text.to_string(),
                }]
            }
            "thinking_delta" => {
                let Some(text) = delta.get("thinking").and_then(Value::as_str) else {
                    return Vec::new();
                };
                vec![AgentEvent::ThinkingDelta {
                    content: text.to_string(),
                }]
            }
            "input_json_delta" => {
                if let Some(tool) = self.tool_inputs.get_mut(&index) {
                    if let Some(partial) = delta.get("partial_json").and_then(Value::as_str) {
                        tool.input_json.push_str(partial);
                    }
                }
                Vec::new()
            }
            _ => Vec::new(),
        }
    }

    fn handle_content_block_stop(&mut self, value: &Value) -> Vec<AgentEvent> {
        let index = value.get("index").and_then(Value::as_u64).unwrap_or(0);
        let Some(tool) = self.tool_inputs.remove(&index) else {
            return Vec::new();
        };
        let input: Value = if tool.input_json.is_empty() {
            Value::Object(serde_json::Map::new())
        } else {
            match serde_json::from_str(&tool.input_json) {
                Ok(v) => v,
                Err(_) => Value::String(tool.input_json.clone()),
            }
        };
        vec![AgentEvent::ToolUseComplete {
            tool_id: tool.tool_id,
            tool_name: tool.tool_name,
            input,
        }]
    }
}

enum BlockTranslation {
    Single(AgentEvent),
    Pair(AgentEvent, AgentEvent),
}

fn content_to_string(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|i| i.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join(""),
        Some(other) => other.to_string(),
        None => String::new(),
    }
}

#[derive(Debug, Deserialize, Default)]
struct RawUsage {
    #[serde(default)]
    input_tokens: u64,
    #[serde(default)]
    output_tokens: u64,
    #[serde(default)]
    cache_read_input_tokens: u64,
    #[serde(default)]
    cache_creation_input_tokens: u64,
}

fn parse_usage(v: Option<&Value>) -> TokenUsage {
    let Some(value) = v else {
        return TokenUsage::default();
    };
    let raw: RawUsage = serde_json::from_value(value.clone()).unwrap_or_default();
    TokenUsage {
        input_tokens: raw.input_tokens,
        output_tokens: raw.output_tokens,
        cache_read_tokens: raw.cache_read_input_tokens,
        cache_creation_tokens: raw.cache_creation_input_tokens,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_all(lines: &[&str]) -> Vec<AgentEvent> {
        let mut p = StreamJsonParser::new();
        lines.iter().flat_map(|l| p.feed_line(l)).collect()
    }

    #[test]
    fn parses_system_init_to_session_started() {
        let events = parse_all(&[
            r#"{"type":"system","subtype":"init","session_id":"sess-abc","model":"claude-opus-4-5","tools":["Read"]}"#,
        ]);
        assert_eq!(
            events,
            vec![AgentEvent::SessionStarted {
                session_id: "sess-abc".into()
            }]
        );
    }

    #[test]
    fn parses_batched_assistant_text_block() {
        let events = parse_all(&[
            r#"{"type":"assistant","message":{"id":"m1","role":"assistant","content":[{"type":"text","text":"hello world"}]}}"#,
        ]);
        assert_eq!(
            events,
            vec![AgentEvent::TextDelta {
                content: "hello world".into()
            }]
        );
    }

    #[test]
    fn parses_batched_assistant_tool_use_emits_pair() {
        let events = parse_all(&[
            r#"{"type":"assistant","message":{"id":"m1","role":"assistant","content":[
                {"type":"tool_use","id":"t_1","name":"Read","input":{"path":"src/App.tsx"}}
            ]}}"#,
        ]);
        assert_eq!(
            events,
            vec![
                AgentEvent::ToolUseStart {
                    tool_id: "t_1".into(),
                    tool_name: "Read".into(),
                    input: serde_json::json!({"path":"src/App.tsx"}),
                },
                AgentEvent::ToolUseComplete {
                    tool_id: "t_1".into(),
                    tool_name: "Read".into(),
                    input: serde_json::json!({"path":"src/App.tsx"}),
                }
            ]
        );
    }

    #[test]
    fn parses_tool_result_with_string_content() {
        let events = parse_all(&[r#"{"type":"user","message":{"content":[
                {"type":"tool_result","tool_use_id":"t_1","content":"file contents","is_error":false}
            ]}}"#]);
        assert_eq!(
            events,
            vec![AgentEvent::ToolUseResult {
                tool_id: "t_1".into(),
                result: "file contents".into(),
                is_error: false,
            }]
        );
    }

    #[test]
    fn parses_tool_result_with_array_content() {
        let events = parse_all(&[r#"{"type":"user","message":{"content":[
                {"type":"tool_result","tool_use_id":"t_1","content":[{"type":"text","text":"line1\n"},{"type":"text","text":"line2"}],"is_error":true}
            ]}}"#]);
        assert_eq!(
            events,
            vec![AgentEvent::ToolUseResult {
                tool_id: "t_1".into(),
                result: "line1\nline2".into(),
                is_error: true,
            }]
        );
    }

    #[test]
    fn parses_result_to_turn_complete_with_usage() {
        let events = parse_all(&[
            r#"{"type":"result","subtype":"success","session_id":"s","usage":{"input_tokens":42,"output_tokens":7,"cache_read_input_tokens":10,"cache_creation_input_tokens":0},"result":"done"}"#,
        ]);
        assert_eq!(
            events,
            vec![AgentEvent::TurnComplete {
                usage: TokenUsage {
                    input_tokens: 42,
                    output_tokens: 7,
                    cache_read_tokens: 10,
                    cache_creation_tokens: 0,
                }
            }]
        );
    }

    #[test]
    fn parses_result_error_subtype_to_error_event() {
        let events =
            parse_all(&[r#"{"type":"result","subtype":"error","result":"model refused"}"#]);
        assert_eq!(
            events,
            vec![AgentEvent::Error {
                message: "model refused".into(),
                recoverable: true,
            }]
        );
    }

    #[test]
    fn tolerates_unknown_event_types_without_emitting() {
        let events = parse_all(&[
            r#"{"type":"some_future_event","payload":{"x":1}}"#,
            r#"{"type":"assistant","message":{"content":[{"type":"text","text":"after"}]}}"#,
        ]);
        assert_eq!(
            events,
            vec![AgentEvent::TextDelta {
                content: "after".into()
            }]
        );
    }

    #[test]
    fn bad_json_emits_recoverable_error() {
        let mut p = StreamJsonParser::new();
        let events = p.feed_line("{not json");
        assert_eq!(events.len(), 1);
        match &events[0] {
            AgentEvent::Error { recoverable, .. } => assert!(recoverable),
            _ => panic!("expected Error event, got {:?}", events[0]),
        }
    }

    #[test]
    fn empty_line_yields_nothing() {
        let mut p = StreamJsonParser::new();
        assert!(p.feed_line("").is_empty());
        assert!(p.feed_line("   \n").is_empty());
    }

    #[test]
    fn handles_streaming_text_deltas() {
        let events = parse_all(&[
            r#"{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}"#,
            r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel"}}"#,
            r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"lo"}}"#,
            r#"{"type":"content_block_stop","index":0}"#,
        ]);
        assert_eq!(
            events,
            vec![
                AgentEvent::TextDelta {
                    content: "Hel".into()
                },
                AgentEvent::TextDelta {
                    content: "lo".into()
                },
            ]
        );
    }

    #[test]
    fn handles_streaming_tool_use_with_input_deltas() {
        let events = parse_all(&[
            r#"{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"t_1","name":"Edit","input":{}}}"#,
            r#"{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"path\":\""}}"#,
            r#"{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"src/a.ts\"}"}}"#,
            r#"{"type":"content_block_stop","index":1}"#,
        ]);
        assert_eq!(events.len(), 2);
        assert!(matches!(events[0], AgentEvent::ToolUseStart { .. }));
        match &events[1] {
            AgentEvent::ToolUseComplete { input, .. } => {
                assert_eq!(input, &serde_json::json!({"path": "src/a.ts"}));
            }
            _ => panic!("expected ToolUseComplete"),
        }
    }

    #[test]
    fn streaming_tool_input_falls_back_to_string_if_invalid_json() {
        let events = parse_all(&[
            r#"{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"t_1","name":"Bash","input":{}}}"#,
            r#"{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"not json"}}"#,
            r#"{"type":"content_block_stop","index":0}"#,
        ]);
        match &events[1] {
            AgentEvent::ToolUseComplete { input, .. } => {
                assert_eq!(input, &Value::String("not json".into()));
            }
            _ => panic!("expected ToolUseComplete"),
        }
    }

    #[test]
    fn missing_session_id_in_init_is_tolerated() {
        let events = parse_all(&[r#"{"type":"system","subtype":"other"}"#]);
        assert!(events.is_empty());
    }
}
