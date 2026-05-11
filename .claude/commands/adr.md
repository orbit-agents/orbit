---
description: Scaffold a new Architecture Decision Record under docs/decisions/. Use when about to make an architectural choice not covered by CLAUDE.md.
allowed-tools: Bash(ls docs/decisions:*), Read, Write
argument-hint: '<short-title-in-kebab-case>'
---

Steps:

1. List `docs/decisions/` to find the next number (existing files are `NNNN-title.md`).
2. Read `docs/decisions/README.md` if it exists, to follow the project's ADR template.
3. Create `docs/decisions/NNNN-$ARGUMENTS.md` with this skeleton:

```markdown
# NNNN — <Title from $ARGUMENTS>

- Status: Proposed
- Date: <today>
- Deciders: <names>

## Context

<What problem are we solving? What constraints?>

## Decision

<What did we choose?>

## Consequences

<Trade-offs. What gets easier? What gets harder?>

## Alternatives considered

- <Option A> — <why rejected>
- <Option B> — <why rejected>
```

4. After writing, remind the user to link the ADR from CLAUDE.md or the relevant phase doc if it changes a non-negotiable rule.
