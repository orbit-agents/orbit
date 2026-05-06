//! Per-turn extractor for the `<remember>...</remember>` pseudo-tool.
//!
//! See ADR 0005. The function is intentionally pure so the rest of the
//! agent pipeline doesn't need to be tested through Tauri/sqlx layers.
//!
//! Operating model:
//! - Run **after** a turn completes, on the assembled assistant text.
//!   Per-delta scanning is fragile because the marker can split across
//!   `text_delta` events (`<remem` then `ber>...</remember>`), and we
//!   prefer atomic semantics: a turn either completes with its memories
//!   saved, or it errors and saves none.
//! - Markers must occupy **the whole line** (after a leading `\s*` and
//!   before a trailing `\s*`). This keeps the parser safe when the agent
//!   is *discussing* the marker mid-prose (e.g. answering "what is the
//!   `<remember>` syntax?") rather than invoking it.
//! - Empty / whitespace-only content is dropped silently.
//! - Content over [`MEMORY_LENGTH_CAP`] bytes is truncated with a
//!   one-line note appended so the user can see what happened.
//!
//! The function returns `(cleaned_text, memories)` where `cleaned_text`
//! is the assistant message with marker lines removed (so the persisted
//! `Message` row never contains them) and `memories` is the list of
//! contents to insert into the database with `source = 'agent'`.

/// Hard limit on a single memory entry. SQLite TEXT has no practical
/// upper bound but the UI is happier without 50KB blobs and the system
/// prompt cap means anything bigger gets truncated downstream anyway.
pub const MEMORY_LENGTH_CAP: usize = 8 * 1024;

const TRUNCATION_SUFFIX: &str = "\n[…truncated by Orbit at 8KB]";

/// One memory extracted from a turn's assistant text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExtractedMemory {
    pub content: String,
    /// True when the original marker payload exceeded
    /// [`MEMORY_LENGTH_CAP`] and we appended the truncation suffix.
    /// The supervisor logs a warning with the agent id when this is
    /// set so misbehaving agents are visible in operator logs.
    pub truncated: bool,
}

/// Extract `<remember>...</remember>` line-anchored markers from
/// `text`. Returns `(cleaned_text, memories)`.
///
/// Stripping rules:
/// - The line containing the marker is removed entirely.
/// - A single trailing newline that becomes redundant after a strip is
///   collapsed so the persisted text doesn't end up with double blanks.
pub fn extract_memories(text: &str) -> (String, Vec<ExtractedMemory>) {
    let mut cleaned = String::with_capacity(text.len());
    let mut memories: Vec<ExtractedMemory> = Vec::new();

    for line in text.split_inclusive('\n') {
        // `split_inclusive` keeps the newline at the end of every chunk
        // except possibly the last; that lets us preserve the original
        // line endings exactly when we keep the line.
        let (content_part, trailing_newline) = match line.strip_suffix('\n') {
            Some(rest) => (rest, true),
            None => (line, false),
        };
        if let Some(memory) = match_remember_line(content_part) {
            if !memory.is_empty() {
                memories.push(cap_length(memory));
            }
            // Drop the line entirely. A trailing blank line that becomes
            // adjacent to another blank line is fine — Claude's text is
            // already conventional and downstream renderers tolerate it.
            continue;
        }
        cleaned.push_str(content_part);
        if trailing_newline {
            cleaned.push('\n');
        }
    }
    (cleaned, memories)
}

/// Match a single line against `^\s*<remember>(.+)</remember>\s*$`.
/// Returns `Some(content)` on match, `None` otherwise.
///
/// We do this without `regex` to keep the dependency footprint small —
/// the grammar is trivial.
fn match_remember_line(line: &str) -> Option<String> {
    let trimmed = line.trim();
    let inner = trimmed
        .strip_prefix("<remember>")?
        .strip_suffix("</remember>")?;
    Some(inner.trim().to_string())
}

fn cap_length(s: String) -> ExtractedMemory {
    if s.len() <= MEMORY_LENGTH_CAP {
        return ExtractedMemory {
            content: s,
            truncated: false,
        };
    }
    let mut truncated: String = s
        .chars()
        .scan(0, |acc, c| {
            *acc += c.len_utf8();
            if *acc <= MEMORY_LENGTH_CAP - TRUNCATION_SUFFIX.len() {
                Some(c)
            } else {
                None
            }
        })
        .collect();
    truncated.push_str(TRUNCATION_SUFFIX);
    ExtractedMemory {
        content: truncated,
        truncated: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn contents(mems: &[ExtractedMemory]) -> Vec<&str> {
        mems.iter().map(|m| m.content.as_str()).collect()
    }

    #[test]
    fn extracts_a_single_marker_on_its_own_line() {
        let text =
            "Sure, I'll fix that.\n<remember>table is named usres not users</remember>\nDone.";
        let (cleaned, mems) = extract_memories(text);
        assert_eq!(cleaned, "Sure, I'll fix that.\nDone.");
        assert_eq!(contents(&mems), vec!["table is named usres not users"]);
        assert!(!mems[0].truncated);
    }

    #[test]
    fn extracts_multiple_markers() {
        let text = "<remember>a</remember>\nMiddle text.\n<remember>b</remember>\nEnd.";
        let (cleaned, mems) = extract_memories(text);
        assert_eq!(cleaned, "Middle text.\nEnd.");
        assert_eq!(contents(&mems), vec!["a", "b"]);
    }

    #[test]
    fn ignores_marker_in_mid_prose() {
        // The agent is *answering* a question about the syntax — not
        // invoking the tool. Both markers are mid-line so we ignore them.
        let text = "The syntax is `<remember>thing</remember>`. You'd use it like \"<remember>foo</remember>\" on its own line.";
        let (cleaned, mems) = extract_memories(text);
        assert_eq!(cleaned, text);
        assert!(mems.is_empty());
    }

    #[test]
    fn ignores_marker_with_leading_or_trailing_text_on_same_line() {
        let text = "Here you go: <remember>foo</remember> and that's it.";
        let (cleaned, mems) = extract_memories(text);
        assert_eq!(cleaned, text);
        assert!(mems.is_empty());
    }

    #[test]
    fn allows_surrounding_whitespace_on_marker_line() {
        let text = "intro\n   <remember>spaced out</remember>   \noutro";
        let (cleaned, mems) = extract_memories(text);
        assert_eq!(cleaned, "intro\noutro");
        assert_eq!(contents(&mems), vec!["spaced out"]);
    }

    #[test]
    fn drops_empty_marker_silently() {
        let text = "before\n<remember>   </remember>\nafter";
        let (cleaned, mems) = extract_memories(text);
        assert_eq!(cleaned, "before\nafter");
        assert!(mems.is_empty());
    }

    #[test]
    fn unclosed_marker_is_kept_as_text() {
        let text = "before\n<remember>I never closed it\nafter";
        let (cleaned, mems) = extract_memories(text);
        assert_eq!(cleaned, text);
        assert!(mems.is_empty());
    }

    #[test]
    fn no_markers_returns_input_unchanged() {
        let text = "just a normal answer with no tools used.";
        let (cleaned, mems) = extract_memories(text);
        assert_eq!(cleaned, text);
        assert!(mems.is_empty());
    }

    #[test]
    fn caps_long_memory_content_and_flags_truncated() {
        let huge = "x".repeat(MEMORY_LENGTH_CAP * 2);
        let text = format!("<remember>{huge}</remember>");
        let (_, mems) = extract_memories(&text);
        assert_eq!(mems.len(), 1);
        assert!(mems[0].content.len() <= MEMORY_LENGTH_CAP);
        assert!(mems[0].content.ends_with("[…truncated by Orbit at 8KB]"));
        assert!(mems[0].truncated);
    }

    #[test]
    fn marker_at_end_without_trailing_newline_is_extracted() {
        let text = "intro\n<remember>last thing</remember>";
        let (cleaned, mems) = extract_memories(text);
        assert_eq!(cleaned, "intro\n");
        assert_eq!(contents(&mems), vec!["last thing"]);
    }

    #[test]
    fn preserves_internal_whitespace_inside_marker_content() {
        // Trim only the outer edges; inner doubled spaces or tabs survive.
        let text = "<remember>two  spaces\there</remember>";
        let (_, mems) = extract_memories(text);
        assert_eq!(contents(&mems), vec!["two  spaces\there"]);
    }
}
