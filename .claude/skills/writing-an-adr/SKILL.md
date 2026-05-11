---
name: writing-an-adr
description: Use when making an architectural choice in the Orbit repo that isn't already covered by CLAUDE.md or an existing ADR. Walks through writing a tight, decision-first ADR under docs/decisions/.
---

# Writing an ADR for Orbit

ADRs live in `docs/decisions/` as `NNNN-kebab-title.md`. They capture **why** a choice was made, not how it works — the code is the how.

## When to write one

Write an ADR if **any** of these are true:

- The change introduces a new top-level dependency.
- The change crosses a module boundary in the Rust core.
- The change overrides or amends a non-negotiable rule in CLAUDE.md.
- The change picks one of multiple defensible designs and the reasons aren't obvious from the diff.

Do NOT write an ADR for: refactors, bug fixes, dependency bumps, doc edits, or anything covered by an existing ADR.

## Process

1. Skim `docs/decisions/` to confirm no existing ADR already covers it. If it amends an existing ADR, prefer a follow-up "amends NNNN" ADR over editing the original.
2. Scaffold via `/adr <kebab-title>` (creates the file with the right number and skeleton).
3. Fill in the sections — **keep them short**:
   - **Context** (3–6 sentences): the problem, the constraints, what would happen if we did nothing.
   - **Decision** (1–3 sentences): the choice, stated as a present-tense fact ("We use X.").
   - **Consequences**: bullets — what gets easier, what gets harder, what is now harder to reverse.
   - **Alternatives considered**: 2–4 options with a single-line reason each for rejection.
4. Status starts as `Proposed`. Move to `Accepted` when merged. Use `Superseded by NNNN` (not deletion) when replaced.
5. If the ADR changes a non-negotiable rule, update `CLAUDE.md` in the same PR.

## Style

- Decisions first, prose second.
- No vague hedging. If the decision is "We use sqlx," write that — not "We probably use sqlx."
- Cross-link related ADRs with `[NNNN](NNNN-...)`.
- Date in ISO format. Use the actual date, not "today."

## Look at neighbors

The clearest examples in this repo are `0001-tauri-over-electron.md`, `0002-claude-code-as-engine.md`, and `0008-git-worktrees.md`. Match their length and tone.
