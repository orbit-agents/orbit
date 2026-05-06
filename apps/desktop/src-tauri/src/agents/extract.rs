//! Single-pass per-turn extractor for the pseudo-tool markers we
//! recognise in assistant text:
//!
//! - `<remember>...</remember>` (ADR 0005)
//! - `<send_to agent="Name">...</send_to>` (ADR 0006)
//! - `<task action="..." ...>title — description</task>` (ADR 0009)
//!
//! All three must occupy the entire line (after trimming surrounding
//! whitespace) — see ADR 0005 for the rationale. The single-pass
//! design lets us avoid running multiple line iterations over the
//! same assistant text on every `TurnComplete`.

use super::remember::{ExtractedMemory, MEMORY_LENGTH_CAP};

/// One outbound `<send_to>` invocation extracted from a turn.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExtractedSendTo {
    /// The agent name as the sender wrote it (case-insensitive at the
    /// broker, but we preserve the original casing for diagnostics).
    pub agent_name: String,
    pub content: String,
    /// True when the original payload exceeded the broker length cap
    /// and we appended the truncation suffix.
    pub truncated: bool,
}

const SEND_TO_TRUNCATION_SUFFIX: &str = "\n[…truncated by Orbit at 8KB]";

/// Pre-existing `<remember>` opener.
const REMEMBER_OPEN: &str = "<remember>";
const REMEMBER_CLOSE: &str = "</remember>";

/// `<send_to>` opener prefix; the closing `>` is found dynamically so
/// we tolerate any quoting style in the `agent` attribute.
const SEND_TO_PREFIX: &str = "<send_to ";
const SEND_TO_CLOSE: &str = "</send_to>";

/// `<task ...>` opener prefix; ADR 0009.
const TASK_PREFIX: &str = "<task ";
const TASK_CLOSE: &str = "</task>";

/// One `<task>` invocation extracted from a turn. Lifecycle handler
/// in `agents::turn` interprets the `action` field and dispatches.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExtractedTask {
    pub action: TaskAction,
    /// Required on update, ignored on create.
    pub id: Option<String>,
    /// Optional on update; required on create (validated downstream).
    pub status: Option<String>,
    pub priority: Option<String>,
    /// Body text split as `title — description`. Either may be empty.
    pub title: Option<String>,
    pub description: Option<String>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskAction {
    Create,
    Update,
}

#[derive(Debug, Default)]
pub struct ExtractionResult {
    pub cleaned_text: String,
    pub memories: Vec<ExtractedMemory>,
    pub send_tos: Vec<ExtractedSendTo>,
    pub tasks: Vec<ExtractedTask>,
}

/// Walk every line of `text` once. A line that exactly matches one of
/// the two markers is consumed (added to `memories` or `send_tos`)
/// and removed from `cleaned_text`; everything else is preserved.
pub fn extract(text: &str) -> ExtractionResult {
    let mut out = ExtractionResult::default();
    out.cleaned_text.reserve(text.len());

    for line in text.split_inclusive('\n') {
        let (content_part, trailing_newline) = match line.strip_suffix('\n') {
            Some(rest) => (rest, true),
            None => (line, false),
        };
        let trimmed = content_part.trim();

        if let Some(memory) = match_remember(trimmed) {
            if !memory.is_empty() {
                out.memories.push(cap_memory(memory));
            }
            continue;
        }
        if let Some(parsed) = match_send_to(trimmed) {
            if !parsed.content.is_empty() {
                out.send_tos.push(cap_send_to(parsed));
            }
            continue;
        }
        if let Some(parsed) = match_task(trimmed) {
            out.tasks.push(parsed);
            continue;
        }
        out.cleaned_text.push_str(content_part);
        if trailing_newline {
            out.cleaned_text.push('\n');
        }
    }
    out
}

/// `<task action="..." ...>title — description</task>`. Returns None
/// for any malformed input — see ADR 0009 for the rules.
fn match_task(line: &str) -> Option<ExtractedTask> {
    let after_prefix = line.strip_prefix(TASK_PREFIX)?;
    let tag_close = after_prefix.find('>')?;
    let attrs = &after_prefix[..tag_close];
    let body_with_close = &after_prefix[tag_close + 1..];
    let body = body_with_close.strip_suffix(TASK_CLOSE)?;

    let action = parse_attr(attrs, "action")?;
    let action = match action.as_str() {
        "create" => TaskAction::Create,
        "update" => TaskAction::Update,
        _ => return None,
    };

    let id = parse_attr(attrs, "id");
    let status = parse_attr(attrs, "status");
    let priority = parse_attr(attrs, "priority");

    // ADR 0009: update requires an id. Create ignores any id sent.
    if matches!(action, TaskAction::Update) && id.is_none() {
        return None;
    }
    // ADR 0009: create requires a status.
    if matches!(action, TaskAction::Create) && status.is_none() {
        return None;
    }

    // Validate enum values; drop on unknown.
    if let Some(s) = &status {
        if !matches!(
            s.as_str(),
            "queued" | "running" | "awaiting_human" | "blocked" | "done" | "failed",
        ) {
            return None;
        }
    }
    if let Some(p) = &priority {
        if !matches!(p.as_str(), "low" | "normal" | "high") {
            return None;
        }
    }

    let trimmed_body = body.trim();
    let (title, description) = if trimmed_body.is_empty() {
        (None, None)
    } else if let Some((t, d)) = trimmed_body.split_once(" — ") {
        (Some(t.trim().to_string()), Some(d.trim().to_string()))
    } else {
        (Some(trimmed_body.to_string()), None)
    };

    // Title is required on create; on update it can stay empty.
    if matches!(action, TaskAction::Create) && title.as_ref().map(|t| t.is_empty()).unwrap_or(true)
    {
        return None;
    }

    let (title_capped, truncated_title) = cap_string(title);
    let (description_capped, truncated_description) = cap_string(description);

    Some(ExtractedTask {
        action,
        id,
        status,
        priority,
        title: title_capped,
        description: description_capped,
        truncated: truncated_title || truncated_description,
    })
}

/// Generic attribute parser used by both `<send_to>` and `<task>`.
/// Tolerates either single or double quotes. Returns the captured
/// value (without the quotes).
fn parse_attr(attrs: &str, name: &str) -> Option<String> {
    let needle_eq = format!("{name}=");
    let idx = find_attr(attrs, &needle_eq)?;
    let after_eq = &attrs[idx + needle_eq.len()..];
    let after_eq = after_eq.trim_start();
    let (quote, rest) = if let Some(r) = after_eq.strip_prefix('"') {
        ('"', r)
    } else if let Some(r) = after_eq.strip_prefix('\'') {
        ('\'', r)
    } else {
        return None;
    };
    let end = rest.find(quote)?;
    Some(rest[..end].to_string())
}

/// Find the start of an attribute on a word boundary so a substring
/// match (e.g. matching `id=` inside `valid="..."`) doesn't fool us.
fn find_attr(attrs: &str, needle: &str) -> Option<usize> {
    let mut search_from = 0;
    while let Some(rel) = attrs[search_from..].find(needle) {
        let abs = search_from + rel;
        let preceded_by_space_or_start =
            abs == 0 || attrs.as_bytes().get(abs - 1).copied() == Some(b' ');
        if preceded_by_space_or_start {
            return Some(abs);
        }
        search_from = abs + needle.len();
    }
    None
}

fn cap_string(input: Option<String>) -> (Option<String>, bool) {
    let Some(s) = input else { return (None, false) };
    if s.len() <= MEMORY_LENGTH_CAP {
        return (Some(s), false);
    }
    let mut truncated: String = s
        .chars()
        .scan(0_usize, |acc, c| {
            *acc += c.len_utf8();
            if *acc <= MEMORY_LENGTH_CAP - SEND_TO_TRUNCATION_SUFFIX.len() {
                Some(c)
            } else {
                None
            }
        })
        .collect();
    truncated.push_str(SEND_TO_TRUNCATION_SUFFIX);
    (Some(truncated), true)
}

fn match_remember(line: &str) -> Option<String> {
    let inner = line
        .strip_prefix(REMEMBER_OPEN)?
        .strip_suffix(REMEMBER_CLOSE)?;
    Some(inner.trim().to_string())
}

struct ParsedSendTo {
    agent_name: String,
    content: String,
}

/// `<send_to agent="Name">content</send_to>` (or single-quoted).
/// Returns None on any malformed input.
fn match_send_to(line: &str) -> Option<ParsedSendTo> {
    let after_prefix = line.strip_prefix(SEND_TO_PREFIX)?;
    // Find the close of the opening tag.
    let tag_close = after_prefix.find('>')?;
    let attrs = &after_prefix[..tag_close];
    let body_with_close = &after_prefix[tag_close + 1..];
    let content = body_with_close.strip_suffix(SEND_TO_CLOSE)?;

    // Parse `agent="X"` or `agent='X'`.
    let agent_name = parse_agent_attr(attrs)?;
    Some(ParsedSendTo {
        agent_name,
        content: content.trim().to_string(),
    })
}

fn parse_agent_attr(attrs: &str) -> Option<String> {
    let trimmed = attrs.trim();
    let after_eq = trimmed
        .strip_prefix("agent")?
        .trim_start()
        .strip_prefix('=')?
        .trim_start();
    let (quote, rest) = if let Some(r) = after_eq.strip_prefix('"') {
        ('"', r)
    } else if let Some(r) = after_eq.strip_prefix('\'') {
        ('\'', r)
    } else {
        return None;
    };
    let end = rest.find(quote)?;
    Some(rest[..end].to_string())
}

fn cap_memory(s: String) -> ExtractedMemory {
    if s.len() <= MEMORY_LENGTH_CAP {
        return ExtractedMemory {
            content: s,
            truncated: false,
        };
    }
    let mut truncated: String = s
        .chars()
        .scan(0_usize, |acc, c| {
            *acc += c.len_utf8();
            if *acc <= MEMORY_LENGTH_CAP - "\n[…truncated by Orbit at 8KB]".len() {
                Some(c)
            } else {
                None
            }
        })
        .collect();
    truncated.push_str("\n[…truncated by Orbit at 8KB]");
    ExtractedMemory {
        content: truncated,
        truncated: true,
    }
}

fn cap_send_to(p: ParsedSendTo) -> ExtractedSendTo {
    if p.content.len() <= MEMORY_LENGTH_CAP {
        return ExtractedSendTo {
            agent_name: p.agent_name,
            content: p.content,
            truncated: false,
        };
    }
    let mut truncated: String = p
        .content
        .chars()
        .scan(0_usize, |acc, c| {
            *acc += c.len_utf8();
            if *acc <= MEMORY_LENGTH_CAP - SEND_TO_TRUNCATION_SUFFIX.len() {
                Some(c)
            } else {
                None
            }
        })
        .collect();
    truncated.push_str(SEND_TO_TRUNCATION_SUFFIX);
    ExtractedSendTo {
        agent_name: p.agent_name,
        content: truncated,
        truncated: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem_contents(r: &ExtractionResult) -> Vec<&str> {
        r.memories.iter().map(|m| m.content.as_str()).collect()
    }
    fn send_to_pairs(r: &ExtractionResult) -> Vec<(&str, &str)> {
        r.send_tos
            .iter()
            .map(|s| (s.agent_name.as_str(), s.content.as_str()))
            .collect()
    }

    #[test]
    fn extracts_a_remember_marker() {
        let r = extract("intro\n<remember>foo</remember>\nouter");
        assert_eq!(r.cleaned_text, "intro\nouter");
        assert_eq!(mem_contents(&r), vec!["foo"]);
        assert!(r.send_tos.is_empty());
    }

    #[test]
    fn extracts_a_send_to_with_double_quoted_attr() {
        let r = extract("plan:\n<send_to agent=\"Atlas\">handle the API migration</send_to>\nthx");
        assert_eq!(r.cleaned_text, "plan:\nthx");
        assert_eq!(
            send_to_pairs(&r),
            vec![("Atlas", "handle the API migration")]
        );
    }

    #[test]
    fn extracts_a_send_to_with_single_quoted_attr() {
        let r = extract("<send_to agent='Bee'>buzz</send_to>");
        assert_eq!(send_to_pairs(&r), vec![("Bee", "buzz")]);
    }

    #[test]
    fn handles_both_markers_in_a_single_turn() {
        let text = "Sure.\n\
<send_to agent=\"Atlas\">do the thing</send_to>\n\
And by the way:\n\
<remember>user prefers concise summaries</remember>\n\
done.";
        let r = extract(text);
        assert_eq!(send_to_pairs(&r), vec![("Atlas", "do the thing")]);
        assert_eq!(mem_contents(&r), vec!["user prefers concise summaries"]);
        assert!(r.cleaned_text.contains("Sure."));
        assert!(r.cleaned_text.contains("And by the way"));
        assert!(r.cleaned_text.contains("done."));
        assert!(!r.cleaned_text.contains("<send_to"));
        assert!(!r.cleaned_text.contains("<remember"));
    }

    #[test]
    fn ignores_send_to_in_mid_prose() {
        // Agent answering a question about the syntax — must not invoke.
        let text = "The syntax is `<send_to agent=\"Atlas\">hi</send_to>` mid-line.";
        let r = extract(text);
        assert_eq!(r.cleaned_text, text);
        assert!(r.send_tos.is_empty());
    }

    #[test]
    fn missing_agent_attr_is_dropped_silently() {
        let r = extract("<send_to>no recipient</send_to>");
        assert!(r.send_tos.is_empty());
        // Without a valid match the whole line stays as text.
        assert_eq!(r.cleaned_text, "<send_to>no recipient</send_to>");
    }

    #[test]
    fn empty_send_to_content_is_dropped() {
        let r = extract("<send_to agent=\"Atlas\">   </send_to>");
        assert!(r.send_tos.is_empty());
        // Empty marker still strips the line — same as <remember>.
        assert_eq!(r.cleaned_text, "");
    }

    #[test]
    fn caps_long_send_to_content_and_flags_truncated() {
        let huge = "x".repeat(MEMORY_LENGTH_CAP * 2);
        let text = format!("<send_to agent=\"A\">{huge}</send_to>");
        let r = extract(&text);
        assert_eq!(r.send_tos.len(), 1);
        let s = &r.send_tos[0];
        assert!(s.truncated);
        assert!(s.content.ends_with("[…truncated by Orbit at 8KB]"));
    }

    #[test]
    fn surrounding_whitespace_on_send_to_line_is_tolerated() {
        let r = extract("intro\n   <send_to agent=\"Atlas\">go</send_to>   \nouter");
        assert_eq!(r.cleaned_text, "intro\nouter");
        assert_eq!(send_to_pairs(&r), vec![("Atlas", "go")]);
    }

    #[test]
    fn extracts_task_create_with_title_and_description() {
        let r = extract(
            "<task action=\"create\" status=\"queued\" priority=\"high\">Audit RL — Find missing burst guard</task>",
        );
        assert_eq!(r.tasks.len(), 1);
        let t = &r.tasks[0];
        assert!(matches!(t.action, TaskAction::Create));
        assert_eq!(t.status.as_deref(), Some("queued"));
        assert_eq!(t.priority.as_deref(), Some("high"));
        assert_eq!(t.title.as_deref(), Some("Audit RL"));
        assert_eq!(t.description.as_deref(), Some("Find missing burst guard"));
    }

    #[test]
    fn extracts_task_update_status_only() {
        let r = extract("<task action=\"update\" id=\"abc-123\" status=\"done\"></task>");
        let t = &r.tasks[0];
        assert!(matches!(t.action, TaskAction::Update));
        assert_eq!(t.id.as_deref(), Some("abc-123"));
        assert_eq!(t.status.as_deref(), Some("done"));
        assert!(t.title.is_none());
    }

    #[test]
    fn task_create_without_status_is_dropped() {
        let r = extract("<task action=\"create\">title</task>");
        assert!(r.tasks.is_empty());
    }

    #[test]
    fn task_update_without_id_is_dropped() {
        let r = extract("<task action=\"update\" status=\"done\"></task>");
        assert!(r.tasks.is_empty());
    }

    #[test]
    fn task_unknown_action_is_dropped() {
        let r = extract("<task action=\"merge\">title</task>");
        assert!(r.tasks.is_empty());
    }

    #[test]
    fn task_unknown_status_is_dropped() {
        let r = extract("<task action=\"create\" status=\"yolo\">title</task>");
        assert!(r.tasks.is_empty());
    }

    #[test]
    fn task_create_without_title_is_dropped() {
        let r = extract("<task action=\"create\" status=\"queued\"></task>");
        assert!(r.tasks.is_empty());
    }

    #[test]
    fn task_marker_in_mid_prose_is_ignored() {
        let text = "the syntax is `<task action=\"create\" status=\"queued\">x</task>` mid-line.";
        let r = extract(text);
        assert!(r.tasks.is_empty());
        assert_eq!(r.cleaned_text, text);
    }

    #[test]
    fn extracts_all_three_marker_types_in_one_turn() {
        let text = "intro\n\
<remember>note</remember>\n\
<send_to agent=\"Atlas\">handle the migration</send_to>\n\
<task action=\"create\" status=\"queued\">Audit — find issues</task>\n\
done.";
        let r = extract(text);
        assert_eq!(r.memories.len(), 1);
        assert_eq!(r.send_tos.len(), 1);
        assert_eq!(r.tasks.len(), 1);
        assert!(!r.cleaned_text.contains("<task"));
    }

    #[test]
    fn task_attribute_order_is_flexible() {
        // Attributes can appear in any order. Status before id, etc.
        let r = extract("<task action=\"update\" status=\"done\" id=\"abc\"></task>");
        assert_eq!(r.tasks[0].id.as_deref(), Some("abc"));
        assert_eq!(r.tasks[0].status.as_deref(), Some("done"));
    }
}
