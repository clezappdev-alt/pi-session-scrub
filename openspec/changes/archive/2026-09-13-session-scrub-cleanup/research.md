# Research — session-scrub-cleanup

Revision: 2
Outcome: complete (parent-run retry after revision 1 blocked)
Date: 2026-09-11

## Research Request (immutable)

Change: session-scrub-cleanup
Questions:
1. What is the exact `SessionInfo` field shape returned by `SessionManager.list(cwd)` — specifically the presence and type of `name`, `file`, `id`, and any other fields? What is the comparison key for `getSessionFile()`?
2. What are the exact semantics of `setSessionName()`, `confirm()`, `select()`, and `setStatus()` — including return types, side effects (events fired), and behavior in non-TUI modes?
3. What is the `trash` CLI availability and reversibility semantics across platforms (Linux, macOS, Windows)? What are the exact confirmation/selection behaviors in non-TUI modes (`rpc`, `json`, `print`)?

Source Classes Selected:
- documentation: official Pi docs via fetch_content + installed pi dist types
- open-web: trash CLI + non-TUI confirm/select via web_search + source_check + fetch_content + get_search_content

Evidence Grants (parent runtime): documentation=[fetch_content], open-web=[web_search, source_check, fetch_content, get_search_content]

## Tool Call Log

| # | Tool | Arguments | Time (UTC) |
|---|------|-----------|------------|
| 1 | web_search | queries=["trash-cli sindresorhus npm how it restores files Linux macOS Windows", "Pi agent pi.dev docs SessionManager extension API confirm dialog"], workflow=none | 2026-09-11 |
| 2 | source_check | claim="trash-cli moves files to the OS trash reversibly and works on macOS, Linux, and Windows", fetchContent=true | 2026-09-11 |
| 3 | fetch_content | urls=[https://pi.dev/docs/latest/extensions, https://pi.dev/docs/latest/session-format] | 2026-09-11 |
| 4 | fetch_content | urls=[https://raw.githubusercontent.com/sindresorhus/trash-cli/main/readme.md, https://cdn.jsdelivr.net/npm/@hugolsramos01-bit/pi-coding-agent@0.80.7-agentic.1/examples/extensions/confirm-destructive.ts] | 2026-09-11 |
| 5 | get_search_content | responseId=mtwyir9xelq5q7 (pi.dev docs slices; findText "ctx.ui/hasUI/registerCommand/confirm" — no matches, JS-rendered) | 2026-09-11 |
| 6 | get_search_content | responseId=mtwyiwa5qep9fg urlIndex=0/1 (trash-cli readme + confirm-destructive.ts full text) | 2026-09-11 |
| 7 | bash (local inspection) | grep/sed over installed pi dist 0.84.4: session-manager.d.ts, extensions/types.d.ts, session-selector.js | 2026-09-11 |

## Sources

- S-web-1: trash-cli readme, publisher sindresorhus, https://raw.githubusercontent.com/sindresorhus/trash-cli/main/readme.md (fetched 2026-09-11 via fetch_content)
- S-web-2: confirm-destructive.ts example, publisher pi-coding-agent examples, https://cdn.jsdelivr.net/npm/@hugolsramos01-bit/pi-coding-agent@0.80.7-agentic.1/examples/extensions/confirm-destructive.ts (fetched 2026-09-11 via fetch_content)
- S-web-3: web_search snippets, pi.dev/docs/latest/extensions + session-format (retrieved 2026-09-11, responseId mtwyincq5m67n5; snippet-level only)
- S-web-4: source_check artifact mtwyit5hen6p7f — verdict UNCLEAR, confidence 0.30; superseded by direct readme fetch S-web-1
- S-local-1: installed dist session-manager.d.ts, pi-coding-agent 0.84.4 (path: pnpm store links/@earendil-works/pi-coding-agent/0.84.4/.../dist/core/session-manager.d.ts)
- S-local-2: installed dist session-selector.js, pi-coding-agent 0.84.4 (dist/modes/interactive/components/session-selector.js, deleteSessionFile ~lines 539-570)
- S-local-3: skill reference pi-plugin-dev/references/extensions.md:56 (`ctx.mode` + `ctx.hasUI` dialog guard)
- S-local-4: installed dist extensions/types.d.ts, pi-coding-agent 0.84.4 (confirm/notify/setStatus signatures, command-ctx ui Pick)

## Validated Claims

### C1 — SessionInfo has `path`, NOT `file` (answers Q1)
Excerpt (S-local-1, session-manager.d.ts:125-139):
```
export interface SessionInfo {
    path: string;
    id: string;
    /** Working directory where the session was started. Empty string for old sessions. */
    cwd: string;
    /** User-defined display name from session_info entries. */
    name?: string;
    /** Path to the parent session (if this session was forked). */
    parentSessionPath?: string;
    created: Date;
    modified: Date;
    messageCount: number;
    firstMessage: string;
    allMessagesText: string;
}
```
Implication: the v0 stub's `s.file !== live` filter never matches (field is `undefined`) — the live-session exclusion is broken and must become `s.path !== live`. Rich fields (`messageCount`, `created`/`modified`) support the confirmed conservative cleanable predicate.

### C2 — Live-session comparison key is a path string (answers Q1)
Excerpt (S-local-1): `getSessionFile(): string | undefined;` (line 208) compared against `SessionInfo.path: string`. Both are filesystem paths; comparison is string equality on the session file path.

### C3 — list/listAll signatures (answers Q1, scope)
Excerpt (S-local-1, lines 348-354):
```
static list(cwd: string, sessionDir?: string, onProgress?: SessionListProgress): Promise<SessionInfo[]>;
static listAll(onProgress?: SessionListProgress): Promise<SessionInfo[]>;
static listAll(sessionDir?: string, onProgress?: SessionListProgress): Promise<SessionInfo[]>;
```
Per-project `list(cwd)` matches the confirmed slice-1 scope; `listAll()` stays deferred.

### C4 — trash CLI is cross-platform and reversible (answers Q3)
Excerpt (S-web-1):
> "Works on macOS (10.12+), Linux, and Windows (8+)."
> "In contrast to `rm` which is dangerous and permanently deletes files, this only moves them to the trash, which is much safer and reversible."
Local fact: `trash` binary is NOT installed on this machine (`which trash` → not found) — the extension must handle absence.

### C5 — Pi's own deletion pattern is trash-first with unlink fallback (answers Q3)
Excerpt (S-local-2, deleteSessionFile):
> "Delete a session file, trying the `trash` CLI first, then falling back to unlink" … `spawnSync("trash", trashArgs…)` … "If trash reports success, or the file is gone afterwards, treat it as successful" … "Fallback to permanent deletion" via `unlink`.
Implication: for scrub's conservative contract the fallback must be trash-ONLY (skip + warn when `trash` is absent), never silent `unlink` — permanent deletion contradicts the confirmed dry-run + reversible decision.

### C6 — Non-TUI dialog guard is `if (!ctx.hasUI) return;` (answers Q2/Q3)
Excerpt (S-web-2, confirm-destructive.ts):
```
pi.on("session_before_switch", async (event: SessionBeforeSwitchEvent, ctx) => {
    if (!ctx.hasUI) return;
    …
    const confirmed = await ctx.ui.confirm("Clear session?", "This will delete all messages in the current session.");
```
Corroborated by S-local-3: "`ctx.mode` (`tui|rpc|json|print`), `ctx.hasUI`; guard dialogs accordingly."
Implication: `/scrub-apply` in non-TUI modes must degrade to notify-only (or a `--dry-run`-style flag), never block on an undeliverable prompt.

### C7 — UI primitives exist with command-ctx limits (answers Q2)
Excerpt (S-local-4): `confirm(title: string, message: string, opts?: ExtensionUIDialogOptions): Promise<boolean>;` · `notify(message, type?: "info"|"warning"|"error"): void;` · `setStatus(key: string, text: string | undefined): void;` · command context `ui: Pick<ExtensionUIContext, "select" | "confirm" | "input" | "notify">` (line 400).
Implication: the `setStatus` slug hint is valid in the `agent_start` event context but NOT inside command handlers (which the stub already respects — notify/confirm only). `setSessionName()` programmatic naming confirmed available but stays user-confirmed per pre-proposal.

### C8 — Opt-in commands are the zero-token trigger (supports trigger decision, snippet-level)
Excerpt (S-web-3, pi.dev/docs/latest/extensions snippet): "User interaction - Prompt users via `ctx.ui` (select, confirm, input, notify)" · "Custom commands - Register commands like `/mycommand` via `pi.registerCommand()`". Strength: snippet only (doc page body not extractable, call #5 no-matches) — corroborated by S-local-4 types and the working stub.

## Proposal Readiness

`proposal_ready: true` — every selected lane produced source-backed claims with exact passages above. Revision 1 blocked state is superseded, not deleted (history preserved).

## Residual Risks

- Installed dist is pi-coding-agent 0.84.4 while openspec/config.yaml records 0.85.1 — minor version skew; proposal must re-pin against the running Pi version before spec code.
- S-web-3 is snippet-level evidence; C8 relies on corroboration from S-local-4, not full doc text.
- `trash` restore UX (how a user recovers a trashed session) was not verified — proposal should state the recovery path (OS trash / file manager) explicitly.

## Addendum — version re-pin (2026-09-11)
Running `pi --version` = 0.85.1 (matches openspec/config.yaml). All local claims C1–C3, C5, C7 re-verified against the 0.85.1 dist
(pnpm store …/0.85.1/995d7c2b…/dist): `SessionInfo.path` (line 126), `getSessionFile(): string | undefined` (line 209),
`static list(cwd…)` (line 349), `confirm/setStatus` (types.d.ts lines 72/80), command-ctx `ui: Pick<…select|confirm|input|notify>` (line 400).
Revision-2 evidence from 0.84.4 holds unchanged on the running version. Residual skew risk closed.
