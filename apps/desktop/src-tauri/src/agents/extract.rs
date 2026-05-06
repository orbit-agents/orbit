//! Single-pass per-turn extractor for the pseudo-tool markers we
//! recognise in assistant text:
//!
//! - `<remember>...</remember>` (ADR 0005)
//! - `<send_to agent="Name">...</send_to>` (ADR 0006)
//!
//! Both must occupy the entire line (after trimming surrounding
//! whitespace) — see ADR 0005 for the rationale. The single-pass
//! design lets us avoid running two independent line iterations over
//! the same assistant text on every `TurnComplete`.

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

#[derive(Debug, Default)]
pub struct ExtractionResult {
    pub cleaned_text: String,
    pub memories: Vec<ExtractedMemory>,
    pub send_tos: Vec<ExtractedSendTo>,
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
        out.cleaned_text.push_str(content_part);
        if trailing_newline {
            out.cleaned_text.push('\n');
        }
    }
    out
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
}
