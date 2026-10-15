# Daybell — rules for every agent

Daybell is multi-studio school and volume photography software for the US and Canada (Quebec excluded at
launch). It matches GotPhoto feature for feature and charges studios 3% of product sales, nothing if nothing sells.

**Source of truth:** the "Daybell — Brainstorm & Decision Log" doc
(https://claude.ai/code/artifact/2e7455af-9847-40ea-9a16-4c1623d9128c). Decisions are numbered D1, D2, …
The current phase spec lives in the doc's Build phases tab. Short summaries are in `docs/adr/`.

## How work happens (D10)

1. Every change cites the decision(s) it implements, in the PR description and in ADRs where it matters.
2. If something is not covered by a decision or the phase spec, **stop and ask Seenu**. Do not guess.
3. One PR per step in the phase spec. Each PR has passing checks and a preview link.
4. Tests are required: new logic gets unit tests; anything touching studio data gets a leak test.
5. The five roles review every PR: architect, developer, tester, code reviewer, security reviewer
   (`.claude/agents/`). The developer does not approve their own work.
6. **Only Seenu releases.** Agents never merge to `main` without Seenu's approval and never deploy production.
7. **No silent changes to decided behaviour.** Every part of a design or a build traces to a decision (D-number),
   an ADR, or Seenu's own words. Anything new, or different from what was decided or built (an order, a grouping,
   a default, a removed or moved control), is labelled "New: needs Seenu" on the design frame or listed under
   "Calls for Seenu" in the PR, and is asked before it is treated as final. If unsure where something came from,
   say so and ask; never present your own choice as decided.

## Non-negotiables

- **Studio separation (D96):** every studio-owned table has `studio_id` and row-level security. No query runs
  without a studio scope. Cross-studio leak tests must pass.
- **Data region (D113):** each studio's data stays in its chosen region (US or Canada). Never copy Canadian
  studio data to US services. Background jobs carry record IDs only, never personal data.
- **Money (D96):** whole cents (integer) plus currency code. Never floats. Every money movement writes a ledger
  entry.
- **API first (D92):** screens call the same versioned API (`/api/v1`) that the public API and MCP server use.
- **Events (D96):** every change writes an event through the outbox; the activity log reads from it.
- **Words in files (D96):** no user-facing text hard-coded in components; it goes in the locale files.
- **Accessibility (D91):** WCAG 2.2 AA. Labels on inputs, 44px touch targets, visible focus, no colour-only meaning.
- **Light theme only at launch (D112).** Use design tokens, never raw hex values in components.
- **Children's privacy:** COPPA, FERPA, PIPEDA, BIPA/CUBI. No face matching at launch. Never log names, emails,
  photos or access codes. Strip personal data before it reaches Sentry.
- **Secrets:** never in code, commits, logs or chat. Read them from environment variables declared in
  `packages/config`.

## Repo map

| Path | What |
|---|---|
| `apps/web` | Next.js: studio app, parent shop, admin |
| `apps/tagger` | Expo tagging app |
| `packages/ui` | Design system (tokens, Tailwind theme, components) |
| `packages/db` | Schema, migrations, RLS policies |
| `packages/core` | Framework-free domain logic |
| `packages/api` | API contracts (typed inputs and outputs) |
| `packages/config` | Environment schema and shared constants |
| `docs/adr` | Architecture decision records |

## Commands

`pnpm install` · `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm build` · `pnpm check` (all four)

Pin exact dependency versions, at least two weeks old.
