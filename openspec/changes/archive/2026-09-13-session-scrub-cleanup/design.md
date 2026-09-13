# Design — session-scrub-cleanup (slice 1)

**Change:** `session-scrub-cleanup` · **Date:** 2026-09-11 · **Author:** SDD design executor
**Inputs:** proposal.md rev 2 (+D5/D6), spec.md v1 (REQ-01…REQ-12, VERIFY-1…VERIFY-4, T1…T12), research.md rev 2 + addendum, `extensions/session-scrub/index.ts` (v0 stub), `package.json`, `openspec/config.yaml` (pi 0.85.1)
**Scope guard:** This is the HOW to the spec's WHAT. Fixed decisions F1–F4, D1–D6, and the out-of-scope list are not reopened. No `before_agent_start`, no `session_start` noise, no `session_shutdown` prompt, no `unlink`/`rm`/`trash` CLI, no `/scrub-empty`, no `listAll()`, no `ctx.ui.custom()` picker.

**Dist re-verified during design (pi 0.85.1):**
- `dist/core/extensions/types.d.ts` — `select(title, options, opts?) → Promise<string|undefined>` (single-select only); `confirm(title, message, opts?) → Promise<boolean>`; `registerTool(tool: ToolDefinition)` (single-object form); `registerCommand(name, options)`; `on("agent_start", …)` exists; `on("session_shutdown", …)` exists (must NOT register).
- `dist/core/session-manager.d.ts` — `appendCustomEntry(customType: string, data?: unknown): string`; `getSessionFile(): string|undefined`; `getSessionDir(): string`; `static list(cwd, sessionDir?, onProgress?)`; `static open(path, …)`.

---

## 1. Module structure — single file rewrite

**File:** `extensions/session-scrub/index.ts` (only file touched for code; `package.json`/`README.md` are meta/docs, separate commits).

**Section order (top → bottom):**

```
1. imports (type-only Pi imports + node:fs/node:path/node:os)
2. constants (MAX_AGE_MS, VERDICT/CLASSIFICATION_KIND/CANDIDATE_REASON const-objects,
   CUSTOM_TYPE_VERDICT, CUSTOM_TYPE_NAME_HINT, POLICY delimiters/keys, status key)
3. flat interfaces + spec types (SessionInfo mirror, Classification union,
   VerdictPayload, NameHintPayload, PolicyConfig, AuditSummary)
4. pure functions (no ctx, no fs-write, fully testable by eye):
   classifySession, matchesEphemeralFlow, deriveSlug (slugify),
   parsePolicyBlock, formatAuditLine, formatDetailRow, resolveDryRun
5. fs/io helpers (thin, throwing, per-file try/catch lives in callers):
   getTrashDir, getSessionsDir, moveToTrash, moveFromTrash,
   readPolicyConfig, readLatestVerdict
6. command handlers: handleScrub, handleScrubApply, handleScrubRestore, handleScrubInit
7. tool handler: handleScrubMark
8. event handler: handleAgentStart (naming hint only)
9. default-export factory: registration only, zero logic
```

**Pure vs handler split:**

| Pure (no `ctx`, no fs writes) | Handlers / IO (own all side effects) |
|---|---|
| `classifySession(s, livePath, verdict, ephemeralFlows, nowMs?)` — D2 tree verbatim, F1 constant | `handleScrub` — list → read verdicts → classify → notify |
| `matchesEphemeralFlow(s, ephemeralFlows)` — exact flow-name match on `allMessagesText` (`/skill:<flow>` token) + `firstMessage`; no substring/fuzzy | `handleScrubApply` — dryRun choke → actionable set → confirm loop → `moveToTrash` per file → re-list |
| `deriveSlug(text)` — lowercase, NFKD strip, `[^a-z0-9]+`→`-`, trim, slice 60 | `handleScrubRestore` — list trash dir → confirm loop → `moveFromTrash` → notify |
| `parsePolicyBlock(agentsMdText)` — F4 grammar (`#`/blank skip, 3 keys, `<…>`→empty, absent/unparseable→`undefined`/conservative default) | `handleScrubInit` — read/append AGENTS.md, idempotent delimiter check |
| `formatAuditLine / formatDetailRow` — one-line-per-session strings | `handleScrubMark` — validate verdict → `appendCustomEntry`, tool-error on invalid |
| `resolveDryRun(args, ctx)` — `args.includes("--dry-run") \|\| !ctx.hasUI` | `handleAgentStart` — gate check → `setStatus` → append gate entry; try/catch never breaks session |

**Registration order (factory body — this exact order):**

```ts
export default function (pi: ExtensionAPI) {
  pi.registerCommand("scrub", { description: "Audit this project's sessions (read-only)", handler: handleScrub });
  pi.registerCommand("scrub-apply", { description: "Move selected candidates to plugin trash (dry-run first, reversible)", handler: handleScrubApply });
  pi.registerCommand("scrub-restore", { description: "Restore trashed sessions for this project", handler: handleScrubRestore });
  pi.registerCommand("scrub-init", { description: "Write opt-in session-scrub POLICY block to project AGENTS.md", handler: handleScrubInit });
  pi.registerTool({ name: "scrub_mark", label: "Record session verdict", description: "…taxonomy + when-to-mark…", parameters: Type.Object({ verdict: Type.Union([...]), reason: Type.Optional(Type.String()) }), execute: handleScrubMark });
  pi.on("agent_start", handleAgentStart);
  // Deliberately absent: no pi.on("session_start"), no pi.on("session_shutdown")
  // (not even a no-op — T9 proves silence by absence; grep gate: "session_shutdown" MUST NOT appear).
}
```

**Why this order:** commands first (primary UX, discovery order in help), tool second (model surface, depends on same custom-type constants), hint event last (background, zero-token). Absence of `session_start`/`session_shutdown` is a reviewed property, not an oversight — call it out in the code comment.

---

## 2. Data flow per command

Shared preamble (all four commands): `livePath = ctx.sessionManager.getSessionFile()` (string-equality key vs `SessionInfo.path`); `ephemeralFlows = readPolicyConfig(ctx.cwd)` (absent/unparseable → `[]`).

### `/scrub` (read-only — REQ-05)

```
list(ctx.cwd) → for each s: verdict = await readLatestVerdict(s.path)
→ classifySession(s, livePath, verdict, ephemeralFlows)
→ tally AuditSummary + per-session detail rows
→ ctx.ui.notify(summary + rows, "info") → return (zero writes, zero prompts)
```

- `readLatestVerdict(sessionPath)`: `SessionManager.open(sessionPath)` → `getEntries()` → filter `e.type === "custom" && e.customType === "session-scrub/verdict"` → order by `payload.at` desc → validate against VERDICT const-object → return verdict or `undefined`. NEVER throws on malformed entries (defensive parse, skip bad). For the **live** session, skip `open()` and use `ctx.sessionManager.getEntries()` directly (same filter).
- `SessionManager.open` is used **read-only**: the opened instance is never appended to, never persisted through. (Skill preference for `SessionManager` API over hand-parsing JSONL.)
- Cross-check invariant: `summary.total === sessions.length`; `live` counted, never actionable.

### `/scrub-apply [--dry-run]` (REQ-06, REQ-10, REQ-11)

```
dryRun = resolveDryRun(args, ctx)
list → verdicts → classify (same as /scrub)
actionable = [auto-deletable, candidate, old-needs-confirm]  // old rows carry full SessionDetail
if dryRun: notify(full actionable detail list, "info") → return (zero mutations)
else (TUI only):
  confirmed: string[] = []
  for each actionable s (in list order):
    ok = await ctx.ui.confirm(`Trash ${shortName(s)}?`, formatDetailRow(s, classification))
    if ok: confirmed.push(s.path)
  if confirmed empty: notify("Cancelled.", "info") → return
  for each path in confirmed:
    try { moveToTrash(path, ctx) } catch (e) { notify(`Failed to trash <file>: <msg>`, "error"); continue }
  relist = await SessionManager.list(ctx.cwd)
  notify(`Trashed ${moved} sessions. Remaining: ${relist.length} sessions.`, "info")
```

### `/scrub-restore` (REQ-07, REQ-10, REQ-11)

```
trashDir = getTrashDir(ctx)
entries = readdir(trashDir) catch ENOENT → [] 
if empty: notify("No trashed sessions for this project.", "info") → return
if !ctx.hasUI: notify(trashed file list, "info") → return (dry-run only)
else:
  for each trashed file:
    ok = await ctx.ui.confirm(`Restore ${file}?`, detailRow)
    if ok: try { moveFromTrash(file, ctx) } catch (e) { notify(error, "error"); continue }
  notify(`Restored ${n} sessions.`, "info")
```

### `/scrub-init` (REQ-08)

```
agentsPath = join(ctx.cwd, "AGENTS.md")
text = readFile(agentsPath) catch ENOENT → ""
if text.includes("<!-- pi-session-scrub:start -->"): notify("Policy block already exists.", "info") → return
append generic commented template (proposal §4.4 verbatim, F4 grammar, placeholders preserved)
notify("Policy block written to AGENTS.md. …", "info")
```

### Naming hint — `agent_start` (REQ-09)

```
entries = ctx.sessionManager.getEntries()
hasName = ctx.sessionManager.getSessionName() !== undefined  // preferred over scanning session_info
hasHint = entries.some(customType === "session-scrub/name-hint")
if hasName || hasHint: return (silent)
firstUserText = first message/role=user text join slice(0,80)
slug = deriveSlug(firstUserText); if (!slug) return
ctx.ui.setStatus("scrub-name", `sugerido: /name ${slug}`)
ctx.sessionManager.appendCustomEntry("session-scrub/name-hint", { version: 1, slug, offeredAt: Date.now() })
whole body in try/catch → never breaks the session
```

Plugin never calls `setSessionName()`; user confirms via built-in `/name`.

---

## 3. VERIFY-1…VERIFY-4 resolution plan

Apply phase MUST open these exact dist files first (paths relative to the installed 0.85.1 package root):

| ID | File + lines to check | Expected (design-time, re-verified 2026-09-11) | Fallback if different |
|---|---|---|---|
| VERIFY-1 | `dist/core/extensions/types.d.ts` ~`registerTool`/`registerCommand` decls (≈ lines 944–947) + `on("agent_start")` (≈ line 918); `ToolDefinition` interface (name/label/description/parameters/execute) | `registerTool(tool: ToolDefinition)` single-object; `registerCommand(name, options)`; `on("agent_start", handler)` | If `registerTool(name, def)` positional: adapt call shape only — tool name, schema, and handler behavior unchanged. If `agent_start` renamed: bind to the dist name, keep hint logic identical. |
| VERIFY-2 | `dist/core/extensions/types.d.ts` `ExtensionUIContext.select` decl (`select(title: string, options: string[], opts?) → Promise<string\|undefined>`) | **Single-select only — no multi-select exists.** Design already assumes this: per-item `confirm()` loop is the PRIMARY path, not a fallback | No further fallback needed. If a future multi-select appears, do NOT adopt it in slice 1 (keeps F2 per-item consent + line budget). `ctx.ui.custom()` picker stays out of scope. |
| VERIFY-3 | `dist/core/session-manager.d.ts` `static list(cwd…)` (≈ line 349), `getSessionDir()` (≈ line 206), `getSessionFile()` (≈ line 209); session-dir encoding helper if exported | `getTrashDir` reuses Pi's encoding **verbatim without knowing it**: `trashDir = join(dirname(ctx.sessionManager.getSessionDir()), "session-scrub-trash", basename(ctx.sessionManager.getSessionDir()))`; `sessionsDir = ctx.sessionManager.getSessionDir()` for restore | If `getSessionDir()` absent/undefined (in-memory, `--no-session`): notify `"No session directory — nothing to trash."` + exit, zero mutations. NEVER invent a parallel `cwd→--cwd--` transform. At apply start, read the actual `dirFor`/encoding fn from dist only to sanity-check the sibling-derivation, not to copy it. |
| VERIFY-4 | `dist/core/session-manager.d.ts` `appendCustomEntry` (≈ line 226: `(customType: string, data?: unknown)`) + `CustomEntry` field names (`type === "custom"`, `customType`, `data`/`payload`?) | Write: `appendCustomEntry("session-scrub/verdict", { version: 1, verdict, at: ISO, reason? })`; read: `getEntries()` filter `customType === "session-scrub/verdict"`, latest `at` wins | If field names differ (e.g. `data` vs `payload`): adapt the accessor only — keep `customType` strings and `version: 1` payload shape regardless. If `appendCustomEntry` signature differs: adapt arg order, keep validation-then-write behavior. |

**Read verdicts — `SessionManager.open` read-only?** Yes: `readLatestVerdict(path)` uses `SessionManager.open(path)` + `getEntries()` and never mutates that instance (no append/persist calls on it). Live session uses `ctx.sessionManager.getEntries()` directly. No raw JSONL parsing (per pi-sessions skill).

---

## 4. Error handling per file (never silent, never destructive)

| Operation | Failure | Handling |
|---|---|---|
| `moveToTrash` — `renameSync(sessionPath, trashPath)` | `EXDEV` (cross-filesystem), `EPERM`/`EACCES`, missing source | Throw; caller catches **per file**, `notify("Failed to trash <basename>: <code/message>", "error")`, continue with next file, source left intact. **No copy+unlink fallback. No `unlink`/`rm`/`trash` CLI strings anywhere** (grep gate). |
| Missing trash dir | `ENOENT` on first trash | `mkdirSync(trashDir, { recursive: true })` inside `moveToTrash` before rename (auto-create, no pre-flight). |
| `moveFromTrash` — reverse rename | Missing sessions dir, collision (file already restored), perms | `mkdirSync(sessionsDir, { recursive: true })`; if target exists, `notify(error)` + skip (never overwrite). Per-file catch + continue. |
| POLICY read/parse (`readPolicyConfig`) | Missing AGENTS.md, malformed delimiters, bad encoding, placeholder-only | Conservative default: `ephemeralFlows = []`, no agent-marking assumption. Never throw out of `/scrub`/`/scrub-apply` for policy reasons. |
| `readLatestVerdict` | Unparseable custom entry, bad `at`, unknown verdict string | Skip entry, try older; return `undefined` when none valid. Never throws. |
| `appendCustomEntry` — hint gate (`handleAgentStart`) | Persist failure | try/catch around whole handler; `setStatus` already shown is harmless; swallow + silent (hint must never break the session). |
| `appendCustomEntry` — `handleScrubMark` | Invalid verdict value, persist failure | Invalid → return tool error, write nothing (REQ-04 scenario). Persist throw → return tool error with message. |
| `/scrub-init` write | `readFile` ENOENT, `appendFile` EACCES | ENOENT → treat as `""` and create file with template. EACCES → `notify(error, "error")`, no partial write (build full text first, single `appendFileSync`/`writeFileSync`). Idempotent delimiter check prevents duplicates. |
| `SessionManager.list` | Rejects (bad cwd, IO) | Let handler catch → `notify("scrub: failed to list sessions: <msg>", "error")` → return. `/scrub` still mutates nothing. |
| Non-TUI prompt attempt | Any path reaching `confirm`/`select`/`input` with `!hasUI` | Impossible by construction: `resolveDryRun` forces dry-run first; add an assertion comment at each TUI branch. Never a blocking prompt outside the TUI loop. |

---

## 5. `hasUI` degradation wiring — single choke point

```ts
function resolveDryRun(args: string | undefined, ctx: { hasUI: boolean }): boolean {
  return (args ?? "").split(/\s+/).includes("--dry-run") || !ctx.hasUI;
}
```

- `handleScrubApply` and `handleScrubRestore` call `resolveDryRun` (apply) / check `ctx.hasUI` (restore) **at entry, before any `confirm`/`select`/`input`**.
- Dry-run path = `notify(info)` full detail list + return. Zero mutations, zero prompts. Covers `rpc`/`json`/`print` (`hasUI === false`).
- `/scrub` and `/scrub-init` never prompt in any mode (notify only), so no guard needed beyond not calling dialogs.
- Only `--dry-run` flag exists (F2: no `--force`). Command descriptions document the non-TUI implicit dry-run.

---

## 6. Test mapping + manual trial procedure

No automated harness (per `openspec/config.yaml`). All verification is manual, in order:

| T | Procedure | Pass criterion | Covers |
|---|---|---|---|
| T1 clean boot | `pi -e ./extensions/session-scrub/index.ts` → `/reload` | No errors on start or reload | REQ-12 (loads) |
| T2 audit truth | Seed named/unnamed/empty/old sessions; run `/scrub` | Classifications match D2 tree; `total` sums; live shown as live | REQ-01, REQ-02, REQ-03, REQ-05 |
| T3 dry-run | Checksum session files → `/scrub-apply --dry-run` → checksum again | Detail list == actionable set; checksums identical | REQ-06 (dry-run), REQ-05 |
| T4 apply | TUI: per-item confirms, select 1–2 → re-run `/scrub` + `ls` trash dir | Exactly confirmed files under `session-scrub-trash/--<cwd>--/`; count drops | REQ-06, REQ-10 |
| T5 restore | `/scrub-restore` → confirm one → `/scrub` | File back in sessions dir; audit lists it again | REQ-07, REQ-10 |
| T6 EXDEV honesty | Mock `renameSync` to throw `EXDEV` (or bind-mount cross-fs) → `/scrub-apply` | Per-file error notify; source intact; no fallback copy | REQ-10 |
| T7 non-TUI | `pi --print` (and `--json`) run `/scrub-apply` and `/scrub-restore` | Notify-only output, exit promptly, zero prompts | REQ-11 |
| T8 hint once | Fresh unnamed session → observe status; trigger second `agent_start` | `sugerido: /name <slug>` once; slug obeys rules; second run silent; gate entry present | REQ-09 |
| T9 silent close | Quit/reload session | No keep-vs-trash prompt; grep confirms no `session_shutdown` in source | Proposal §2 close behavior |
| T10 init idempotent | `/scrub-init` → rerun → inspect AGENTS.md | Block present once with delimiters; rerun notifies "already exists", file unchanged | REQ-08 |
| T11 verdict round-trip | Invoke `scrub_mark({ verdict: "finished", reason: "PR merged" })` → `/scrub`; invoke with `{ verdict: "done" }` | Versioned entry via `getEntries()`; candidate/finished shown; invalid → tool error, nothing written | REQ-04 |
| T12 strict + budget | `tsc --strict` (or repo typecheck), `grep -n "any"`, `git diff --stat` | Zero errors, zero `any`, code commit ≤ 400 lines, docs/meta separate | REQ-12 |

**`/resume` cross-check (every run):** after T2/T4/T5, open `/resume` picker and confirm visible sessions == `/scrub` list minus trashed ± restored, live session always present in both. **Non-TUI check (T7):** `pi --print` variants must complete without hanging — any hang = `hasUI` guard regression, fix before anything else.

---

## 7. Line-budget estimate vs 400

| Block | Lines |
|---|---|
| Imports + constants (MAX_AGE_MS, const-objects, custom types, delimiters, template literal) | ~45 |
| Interfaces (SessionInfo mirror, 6 Classification variants + union, payloads, PolicyConfig, AuditSummary) | ~45 |
| Pure: `classifySession` + `matchesEphemeralFlow` + `deriveSlug` + `parsePolicyBlock` + formatters + `resolveDryRun` | ~120 |
| IO: `getTrashDir`/`getSessionsDir` + `moveToTrash`/`moveFromTrash` + `readPolicyConfig` + `readLatestVerdict` | ~60 |
| Handlers: 4 commands (~30 each) + `handleScrubMark` (~20) + `handleAgentStart` (~25) | ~165 |
| Factory registration + comments | ~20 |
| **Total** | **~455 raw → ~360–380 after tightening** (formatters inline, terse notify strings, shared `audit()` helper for `/scrub` + `/scrub-apply` preamble) |

**Verdict:** lands within 400 after the shared-`audit()` dedup (single `auditSessions(ctx)` helper returning classified list + summary, used by both `/scrub` and `/scrub-apply`). **Standing recommendation if over (unchanged):** `/scrub-restore` moves to slice 2 first — manual `mv` covers recovery, and its handler + confirm loop (~40 lines) is the cleanest separable cut. Second cut candidate: `formatDetailRow` richness (not a command). Never cut: `resolveDryRun` guard, per-file error handling, or the `session_shutdown` absence.

---

## Risks (design-level, deltas only)

- **Shared-`audit()` staleness:** `/scrub-apply` re-lists post-run, so the pre-selection snapshot is never reused for verification — mitigated by construction (§2).
- **`SessionManager.open` side effects:** design treats it as read-only; apply phase must confirm `open()` performs no writes on load (check `session-manager` impl, not just `.d.ts`). If it writes, switch live-only reads to `open` + immediate inspection still without append — writes on open would be a Pi behavior, caught at T3 checksum.
- **Trash sibling-derivation vs custom `sessionDir`:** users with explicit `sessionDir` get a correctly-siblinged trash dir automatically (derivation from `getSessionDir()`, not from cwd) — no extra code.

## Next recommended

Proceed to **plan/apply phase**: at apply start, open the VERIFY dist files (§3 table), confirm the four signatures, then rewrite `extensions/session-scrub/index.ts` per §1–§5, then run T1…T12 (§6). Keep code commit ≤ 400 lines; `package.json` (`pi-package` keyword check) and `README.md` go in separate meta/docs commits.

## Skill resolution

**skill_resolution: paths-injected** — all five parent-injected skills read before work (pi-plugin-dev, pi-sessions, pi-packages, pi-tui, typescript) plus on-demand `references/extensions.md`, `references/sessions.md`, `references/tui.md`, and live 0.85.1 dist `types.d.ts`/`session-manager.d.ts` for VERIFY grounding. No fallback used.
