# Explore — session-scrub-cleanup

Status: exploration-only (no decisions) · Date: 2026-09-11
Inputs read: PRD.md v0.1, AGENTS.md, extensions/session-scrub/index.ts (v2 minimal stub),
openspec/config.yaml, pi-plugin-dev references/extensions.md, pi-sessions
references/sessions.md + session-format.md + compaction.md + env-vars.md.

## 1. What the platform actually supports

**Session listing (audit source of truth).**
- `SessionManager.list(cwd)` → sessions for the current project only (mirrors `/resume` picker scope).
- `SessionManager.listAll()` → everything across projects (exists per skill; needed only if a global view is chosen).
- Storage: `~/.pi/agent/sessions/--<cwd>--/<timestamp>_<id>.jsonl` (JSONL v3). Delete file = delete session.
- Skill rule: prefer `SessionManager` over hand-parsing JSONL. Each entry (except header) has `{type, id, parentId, timestamp}`; tree via `parentId`; `session_info` entries carry the display name (set via `/name`, `--name`, `setSessionName()`, fires `session_info_changed`).

**Deletion / reversibility.**
- No `SessionManager.delete` in the distilled API. The blessed path is the OS `trash` CLI (what `/resume` + `Ctrl+D` uses when available) — reversible (~30d), not `rm`.
- Skill hard rule: never touch the live session (`ctx.sessionManager.getSessionFile()` identifies it); trash via `trash` CLI only.
- Live-session file is also exposed to shell tools as `PI_SESSION_FILE` (bash/powershell tools only, not `!`/`!!`).

**Naming.**
- `/name <name>` sets display name (shown instead of first message in `/resume`); `Ctrl+R` renames inline; `Ctrl+N` filters named-only.
- Programmatic: `pi.setSessionName()` (fires `session_info_changed`, so an extension can observe/cooperate but should not auto-rename silently — PRD open question #4).
- Header/first-line + `session_info` entries are display-only, never LLM context.

**Extension mechanics (zero-token constraint).**
- Entry: default-exported factory `extensions/session-scrub/index.ts` receiving `ExtensionAPI`, run via jiti (no build).
- `pi.registerCommand(name, {description, handler})` → opt-in `/scrub`-style commands. Commands skip the `input` event and cost nothing until invoked — the mechanism that satisfies "zero tokens by default".
- `pi.on("session_start" | "session_shutdown" | "agent_start" | ...)` for lifecycle. `before_agent_start` injection is the documented anti-pattern here (~400-token ceremony that killed session-hygiene); skill says use sparingly.
- `ctx.ui`: `notify / confirm / select / input / editor / setStatus / setWidget / custom()` (TUI-only for `custom()`; guard with `ctx.mode`/`ctx.hasUI`). `confirm`/`select` give explicit-destruction UX without model tokens.
- `ctx.sessionManager` is read-only (`getEntries/getBranch/buildContextEntries/getLeafId/getSessionFile`) — audit reads go here; mutation goes through trash CLI, never by editing JSONL.
- `custom` entries + `pi.registerEntryRenderer()` persist extension state without polluting LLM context (a possible keep/trash verdict store — see §4).
- Compaction hooks (`session_before_compact`, `session_compact`, `session_before_tree`) exist but are out of scope unless naming/summaries reuse them.

**Packaging.**
- `package.json`: `pi.extensions: ["./extensions/session-scrub/index.ts"]` + `pi-package` keyword; core libs in `peerDependencies: *`, never bundled. Trial via `pi -e <path>` + `/reload`; install tagged versions only.

## 2. v0/v2 stub: what it assumes vs reality

| Stub behavior | Reality check |
|---|---|
| `SessionManager.list(ctx.cwd)` returns objects with `.name`, `.file` | Distilled docs confirm list-by-cwd and name-via-`session_info`, but the exact field names (`name`? `file`?) are **unverified** — full types live in `node_modules/@earendil-works/pi-coding-agent/dist` (not present in this repo; no automated tests yet). Proposal must pin the real `SessionInfo` shape before any filter logic. |
| `sessions.filter(s => !s.name)` = "trashable" | Too aggressive as a definition: conflates *unnamed* with *worthless*. No age, message-count, token, or keep-verdict signal consulted. This is exactly PRD question #2 — stub punts it. |
| `live = getSessionFile()`, exclude by `file !== live` | Directionally right (hard rule), but comparison key unverified (path string? normalized? id?). Must confirm `SessionInfo` exposes a comparable file/id field. |
| `agent_start` → first-user-message slug → `setStatus("scrub-name", "sugerido: /name …")` | Mechanically plausible (`getEntries()` read + `setStatus` hint, no injection, model not in loop). Open issues: fires on *every* agent start (should fire once per unnamed session); slug quality unvalidated; `setStatus` key collision/UX unverified in TUI. |
| `scrub-apply` ends in dry-run notify (no real trash) | Honest placeholder. Real step needs: `trash` CLI availability check + fallback, per-item confirm vs bulk confirm, post-trash verification (re-list counts). |
| `session_shutdown` keep-vs-trash commented out | Correctly cautious: shutdown-time prompts risk becoming the new ceremony (PRD non-goal "no startup ritual"). Whether close-time ask exists at all is PRD question #5. |
| Empty `session_start` handler | Dead code — either remove or justify (e.g., future status widget anchor). |

## 3. Where the 6 PRD open questions bite

1. **Trigger + name.** Opt-in slash commands are the only trigger consistent with zero-tokens-by-default (events like `agent_start`/`session_start` run unasked). Naming surface: keep `/scrub` + `/scrub-apply` or rename — proposal decides; note `/resume` already owns list/manage, so scrub must read as *audit*, not a second picker.
2. **Cleanable vs never-touch.** Needs a predicate over verified `SessionInfo` fields: live session (absolute never), named sessions (never auto?), age/recency, emptiness (0 user messages?), size/cost. Stub's "unnamed ⇒ trashable" is the naive endpoint — proposal must define the real predicate and its false-positive cost.
3. **Explicit + reversible destruction.** Blessed primitives exist: `confirm`/`select` (explicit) + `trash` CLI (reversible). Gaps to close: `trash` availability fallback, bulk-vs-itemized confirm, dry-run-first ordering, post-run re-list proof.
4. **Who names / confirm.** Options span: deterministic slug hint (stub's approach, user confirms via `/name`) → `select`/`input` picker inside scrub → nothing (defer to `/resume Ctrl+R`). Auto-naming via LLM or `setSessionName()` without confirmation contradicts the ceremony-free goal; proposal must pick the confirmation point.
5. **Ask on close?** Highest ceremony risk. A `session_shutdown` confirm reintroduces a per-session interruption (the thing PRD non-goals forbid in startup form). Cheaper alternatives: `custom`-entry keep-verdict written silently + surfaced only inside `/scrub`; or nothing. Proposal must justify any close-time UI against the zero-ceremony goal.
6. **Per-project vs global.** `list(cwd)` = project scope (matches `/resume`, matches `ctx.cwd` in handler); `listAll()` = global (needs cwd-grouped display, cross-project trash confirmation, larger blast radius). Per-project is the natural first slice; global is a separate scope decision with its own confirm UX.

## 4. Cross-cutting observations for proposal

- **Source of truth = session dir via SessionManager.** No registry files (PRD non-goal + README rule). Any keep/trash verdict state should live as `custom` entries or be derived at audit time — not a sidecar file.
- **Counts must cross-check with `/resume`.** Skill output contract: verify audit counts match the picker, live session excluded. Manual trial path exists (`pi -e … + /reload`); no automated runner yet (config: `none-automated-yet`, strict TDD flagged but no harness — proposal must say how the first slice is verified).
- **Non-TUI modes.** `ctx.mode` (`tui|rpc|json|print`) + `ctx.hasUI`: `confirm`/`select` need a non-interactive behavior (skip? notify-only? flag?). Stub ignores this; proposal must define it.
- **TUI not required for slice 1.** `notify/confirm/select/setStatus` cover audit + trash + naming hint. `ctx.ui.custom()` (pi-tui skill) only matters if proposal wants a picker richer than `select` — defer unless justified.
- **TypeScript skill constraints** (const-objects-not-unions, flat interfaces, no `any` — stub currently uses `any[]` casts) apply to whatever proposal's implementation follows.
- **Review budget 400 lines; meta/code commits separate.** First slice should fit one work-unit code commit; this exploration is meta (no code touched).

## 5. First-slice shape (options, NOT a decision)

- A: read-only `/scrub` audit with correct `SessionInfo` fields + `/resume`-matching counts (no mutation; de-risks the field-shape unknown).
- B: A + real `trash`-CLI-backed `/scrub-apply` with explicit confirm + dry-run + re-list proof.
- C: B + naming-hint refinement (once-per-session gating, slug quality).
- Deferred explicitly: close-time prompt, global view, custom TUI picker, compaction-hook reuse.
