# Proposal — session-scrub-cleanup

**Change ID:** session-scrub-cleanup
**Status:** proposed
**Revision:** 2 (2026-09-11)
**Author:** SDD proposer (gentle-ai orchestrator)
**Input artifacts:** PRD.md, AGENTS.md, research.md (rev 2 + addendum), explore.md, v2 stub (reference only)

---

## Revision Note (rev 2)

**What changed:**
- **D1 (trash model):** Replaced OS trash CLI design with plugin-owned trash directory (`~/.pi/agent/session-scrub-trash/--<cwd>--/`) using filesystem move (rename). Added `/scrub-restore` command in slice 1. Deferred explicit purge (`/scrub-empty`) to future.
- **D2 (predicate):** Rewrote cleanable predicate per user's decision tree: named sessions deletable ONLY if explicitly marked trash; unnamed sessions never auto-inferred trashable; explicit trash mark wins; ephemeral flow-match proposes only; empty sessions auto-deletable; old sessions (>=7 days) never deleted without user confirmation + context visualization.
- **D3 (verdict flags):** Two-layer mechanism: POLICY layer (opt-in delimited block in project's AGENTS.md via `/scrub-init`) + STATE layer (model-invoked `scrub_mark` tool writing namespaced CustomEntry). Verdict taxonomy: keep | paused | finished | ephemeral. Custom entries do not participate in LLM context.
- **D4 (detail expansions):** Expanded §2 Scope rows with mechanics + example transcripts; expanded §6 with trash-dir layout, move/restore semantics, why OS trash + unlink excluded; expanded §7 Non-TUI table with mode explanations and `ctx.hasUI` semantics; expanded §9 Risks with concrete failure scenarios, likelihood/impact, mechanical mitigations.
- **D5 (ephemeral scope):** `ephemeral` candidates come ONLY from deterministic match against skill flows listed in POLICY `ephemeral-flows:`; no fuzzy single-task heuristic.
- **D6 (generic template):** POLICY block rewritten as a generic commented template — `#` guidance lines for the agent (taxonomy + when-to-mark), machine `key: value` lines, `<placeholder>` flow names filled per project via `/scrub-init`; no hardcoded flow names.

**Why:** User corrective decisions from proposal question round override prior research C4/C5 and proposal §3/§6/§7/§9. All changes are product decisions; implementation follows.

---

## 1. Intent

Implement the first product slice of `pi-session-scrub`: an opt-in, zero-ceremony audit-and-cleanup tool that keeps the per-project `/resume` list clean and descriptive. The plugin exposes slash commands (`/scrub`, `/scrub-apply`, `/scrub-restore`, `/scrub-init`), a model-invoked `scrub_mark` tool for verdict recording, a once-per-session deterministic naming hint, and a plugin-owned trash directory. No tokens are spent unless the user invokes a command.

---

## 2. Scope (First Slice — One Work-Unit Commit ≤ 400 Lines)

### In Scope

| Item | Decision | Mechanics + Concrete Example Transcript |
|------|----------|------------------------------------------|
| **Commands** | `/scrub` (read-only audit), `/scrub-apply` (select-per-item + dry-run + move-to-trash), `/scrub-restore` (list trashed for cwd, select to move back), `/scrub-init` (writes POLICY block in project's AGENTS.md) | **Transcript:**<br>`> /scrub`<br>`🔍 12 sessions · 3 named · 4 candidates (1 empty, 1 finished, 2 ephemeral) · 5 kept`<br>`> /scrub-apply`<br>`Select sessions to trash (space=toggle, enter=confirm):`<br>`  [x] session-abc123  empty · 0 msg · 2026-09-01`<br>`  [ ] session-def456  finished · 15 msg · 2026-09-05`<br>`  [x] session-ghi789  ephemeral · 3 msg · 2026-09-08`<br>`Dry-run: 2 sessions would move to trash. Confirm? [y/N] y`<br>`✅ Moved 2 sessions to ~/.pi/agent/session-scrub-trash/--home-user-proj--/`<br>`> /scrub-restore`<br>`Trashed sessions for this project:`<br>`  [x] session-abc123  empty · 2026-09-01`<br>`  [ ] session-ghi789  ephemeral · 2026-09-08`<br>`Restore selected? [y/N] y`<br>`✅ Restored 1 session` |
| **Trigger** | Opt-in only. No `before_agent_start`, no `session_start` noise, no startup ritual. `/scrub-init` writes POLICY block once; agent respects it thereafter. | POLICY block written once per project. No automatic triggers. |
| **Scope** | Per-project only via `SessionManager.list(ctx.cwd)`. Global `listAll()` deferred. | Single `cwd` keying for both sessions and trash dir. |
| **Cleanable predicate** | **D2 decision tree** (replaces prior predicate):<br>- Named session: deletable ONLY if explicitly marked `trash` verdict.<br>- Unnamed session: NEVER auto-inferred trashable.<br>  a) Explicitly marked `trash` => deletable.<br>  b) Not marked: audit whether "ephemeral" (single concrete task) => promulgate as trash CANDIDATE (heuristic proposes, user disposes — never auto-trash).<br>  c) Empty (`messageCount === 0`) => auto-deletable.<br>- Old (>= 7 days): NEVER delete without user confirmation; report/visualize context detail (name?, firstMessage, messageCount, created/modified, verdict if any). | **Example audit output:**<br>`session-xyz (named="feat/auth") · verdict=keep · 42 msg · 2026-09-01 → KEPT`<br>`session-abc (unnamed) · verdict=finished · 8 msg · 2026-09-04 → CANDIDATE (finished)`<br>`session-def (unnamed) · verdict=none · 0 msg · 2026-09-01 → AUTO-DELETABLE (empty)`<br>`session-ghi (unnamed) · verdict=none · 3 msg · 2026-09-08 "actualización a main" → CANDIDATE (ephemeral heuristic)`<br>`session-jkl (unnamed) · verdict=none · 12 msg · 2026-08-20 → OLD (≥7d) — shows detail, requires confirm` |
| **Destruction flow** | **D1:** Filesystem move (rename) into plugin-owned trash dir. No `trash` CLI dependency. No `unlink`/`rm` anywhere in slice 1. Nothing permanent. | `renameSync(sessionPath, trashPath)` — atomic on same filesystem. Trash dir auto-created on first use. |
| **Naming hint** | Deterministic slug from first user message, surfaced via `setStatus("scrub-name", "sugerido: /name <slug>")` **once per unnamed session** (gated by custom entry verdict). User confirms with `/name`. | Same as rev 1. Gated by `scrub-name-hint` custom entry. |
| **Close behavior** | Silent — nothing on `session_shutdown`. No keep-vs-trash prompt. | No `session_shutdown` handler registered. |
| **Non-TUI modes** | `ctx.hasUI` guard: `confirm`/`select` degrade to `notify` with `--dry-run` hint; never block. See §7 for full table. | TUI: interactive select/confirm. RPC/JSON/Print: dry-run notify only. |
| **Verification** | Post-move re-list; counts must match `/resume` picker (live excluded). Restore verified by re-list. | `/scrub` after `/scrub-apply` shows reduced count. `/scrub-restore` shows restored session in `/scrub`. |
| **Verdict tool** | `scrub_mark` tool (via `pi.registerTool`) appending CustomEntry `{ customType: "session-scrub/verdict", payload: { verdict: "keep"|"paused"|"finished"|"ephemeral", at: ISOstring, reason?: string } }`. Custom entries do NOT participate in LLM context. | Agent invokes: `scrub_mark({ verdict: "finished", reason: "PR merged" })` → custom entry written. `/scrub` reads via `getEntries()`. |
| **POLICY layer** | `/scrub-init` writes opt-in delimited block in project's local AGENTS.md: `<!-- pi-session-scrub:start --> ... directives ... <!-- pi-session-scrub:end -->`. Directives tell agent the verdict taxonomy and WHEN to mark: on session name/rename, on block-closure (pause), on session-closure (work finished => trash candidate). Never unasked. Delimiters let tooling find/update the block. | **AGENTS.md block example:**<br>`<!-- pi-session-scrub:start -->`<br>`# session-scrub policy`<br>`# ...guidance for the agent (comment lines)`<br>`verdicts: keep | paused | finished | ephemeral | trash`<br>`mark-on: session_rename, block_close, session_close`<br>`ephemeral-flows: <flow-name-1>, <flow-name-2>`<br>`<!-- pi-session-scrub:end -->` |

### Explicit Non-Goals (Deferred) — With WHY

| Non-Goal | Why Deferred |
|----------|--------------|
| Close-time prompt (`session_shutdown` confirm) | User explicitly decided silent close (D2). No prompt on shutdown. |
| Global view (`listAll()` + cross-project UI) | Per-project scope is the product slice; cross-project adds UX complexity and permissions surface. |
| Custom TUI picker (`ctx.ui.custom()`) | Standard `confirm`/`select` sufficient for slice 1; custom picker adds maintenance burden. |
| Compaction-hook reuse for summaries | Compaction is orthogonal; session verdicts are explicit agent actions, not compaction byproducts. |
| LLM-assisted naming or auto-rename via `setSessionName()` | Zero tokens by default; deterministic slug is zero-token. LLM naming is opt-in future. |
| Sidecar registry/verdict files | Verdicts live as `custom` entries inside session files — portable, no extra files. |
| Explicit empty/purge of trash (`/scrub-empty`) | Retention: keep indefinitely in slice 1. Explicit purge is a separate decision with data-loss risk. |
| OS trash integration | D1: plugin cannot control user's/system trash management. User empties trash = irreversible. Plugin-owned trash is fully controllable. |

---

## 3. Cleanable Predicate (Over Verified `SessionInfo` Fields) — D2 Rewrite

**Source of truth:** `SessionManager.list(cwd)` → `SessionInfo[]` (verified shape from research C1):

```ts
interface SessionInfo {
  path: string;                    // filesystem path — THE comparison key
  id: string;
  cwd: string;
  name?: string;                   // user-defined display name (from session_info entries)
  parentSessionPath?: string;
  created: Date;
  modified: Date;
  messageCount: number;
  firstMessage: string;
  allMessagesText: string;
}
```

**Live session identifier:** `ctx.sessionManager.getSessionFile(): string | undefined` — compared by **string equality** against `SessionInfo.path` (research C2).

**Verdict source:** Custom entries with `customType === "session-scrub/verdict"` read via `getEntries()` on the session file. Latest verdict wins (by `at` timestamp).

**Predicate `classifySession(s: SessionInfo, livePath: string, verdict?: Verdict): Classification`:**

```ts
type Verdict = "keep" | "paused" | "finished" | "ephemeral" | "trash";
type Classification = 
  | { kind: "live" }
  | { kind: "named-protected"; name: string; verdict?: Verdict }
  | { kind: "auto-deletable"; reason: "empty" }
  | { kind: "candidate"; reason: "explicit-trash" | "finished" | "ephemeral"; verdict?: Verdict }
  | { kind: "old-needs-confirm"; detail: SessionDetail; verdict?: Verdict }
  | { kind: "kept"; reason: "has-verdict-keep" | "has-content-no-verdict" };

interface SessionDetail {
  name?: string;
  firstMessage: string;
  messageCount: number;
  created: Date;
  modified: Date;
  verdict?: Verdict;
}

function classifySession(s: SessionInfo, livePath: string, verdict?: Verdict): Classification {
  // 1. Live session — absolute never
  if (s.path === livePath) return { kind: "live" };

  // 2. Named session — deletable ONLY if explicitly marked trash
  if (s.name && s.name.trim().length > 0) {
    if (verdict === "trash") return { kind: "candidate", reason: "explicit-trash", verdict };
    return { kind: "named-protected", name: s.name, verdict };
  }

  // 3. Unnamed session — NEVER auto-inferred trashable
  // 3a. Explicitly marked trash => deletable
  if (verdict === "trash") return { kind: "candidate", reason: "explicit-trash", verdict };

  // 3b. Finished verdict => candidate (agent marked work done, user disposes)
  if (verdict === "finished") {
    return { kind: "candidate", reason: "finished", verdict };
  }
  // 3b2. Ephemeral skill flow => candidate (DETERMINISTIC match only: the
  // session log contains an invocation of a flow listed in POLICY
  // `ephemeral-flows:`, e.g. `/skill:gentle-main-update`. No fuzzy
  // single-task heuristic exists. An `ephemeral` verdict via scrub_mark is
  // also accepted. Either way the user disposes — never auto-trash.)
  if (verdict === "ephemeral" || matchesEphemeralFlow(s, ephemeralFlows)) {
    return { kind: "candidate", reason: "ephemeral", verdict };
  }

  // 3c. Empty => auto-deletable
  if (s.messageCount === 0) {
    return { kind: "auto-deletable", reason: "empty" };
  }

  // 3d. Old (>= 7 days) => needs confirmation with detail visualization
  const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  if (Date.now() - s.created.getTime() >= MAX_AGE_MS) {
    return { 
      kind: "old-needs-confirm", 
      detail: { 
        name: s.name, 
        firstMessage: s.firstMessage, 
        messageCount: s.messageCount, 
        created: s.created, 
        modified: s.modified, 
        verdict 
      } 
    };
  }

  // 3e. No verdict, not empty, not old => kept
  return { 
    kind: "kept", 
    reason: verdict === "keep" ? "has-verdict-keep" : "has-content-no-verdict" 
  };
}
```

**Ephemeral-flow matching (D5):** `ephemeralFlows: string[]` comes from the project POLICY block (`ephemeral-flows: gentle-main-update, model-profiles-sdd`). Absent block = empty list = no ephemeral candidates (conservative default). `matchesEphemeralFlow` opens the session file read-only and checks for exact invocations of a listed flow (user message `/skill:<flow>` or skill tool call). Exact flow-name match only — no substring/fuzzy matching.

**Rationale:** The decision tree eliminates ambiguity: named sessions are protected unless explicitly marked trash; unnamed sessions require explicit verdict or emptiness to be actionable; age alone never triggers deletion — it only escalates to a detailed confirmation screen.

---

## 4. Command Shapes & Behaviors

### 4.1 `/scrub` — Read-Only Audit

```
Usage: /scrub
Output (notify, info):
  "scrub: 12 sessions · 3 named · 1 auto-deletable (empty) · 2 candidates (1 finished, 1 ephemeral) · 1 old-needs-confirm · 5 kept · 0 live. /scrub-apply to act on candidates."
```

- Lists all sessions for `ctx.cwd` via `SessionManager.list(ctx.cwd)`.
- Reads verdicts from each session's custom entries (`customType: "session-scrub/verdict"`).
- Classifies per `classifySession()`.
- **Never mutates**. Pure audit. Counts must cross-check with `/resume` picker.

### 4.2 `/scrub-apply` — Select-Per-Item with Dry-Run + Move to Trash

```
Usage: /scrub-apply [--dry-run]
```

**Flow:**
1. **Dry-run** (default if `--dry-run` flag OR `!ctx.hasUI`): list actionable candidates (`auto-deletable`, `candidate`, `old-needs-confirm`) with full detail; `notify` summary; exit.
2. **Interactive (TUI only, `ctx.hasUI`):** 
   - Present multi-select list of actionable sessions with detail columns (name/firstMessage, messageCount, created, verdict, classification reason).
   - User toggles selection (space), confirms (enter).
   - If no selection: `notify("Cancelled.", "info")`; exit.
3. **Trash execution:** For each selected session, `moveToTrash(sessionPath, ctx.cwd)` (filesystem rename).
   - Trash dir auto-created: `~/.pi/agent/session-scrub-trash/--<cwd>--/`.
   - On success: count trashed.
   - On failure (cross-filesystem, permissions): `notify("Failed to trash <path>: <error>", "error")`; continue.
4. **Post-run verification:** Re-run `SessionManager.list(ctx.cwd)`; `notify("Trashed X sessions. Remaining: Y sessions, Z candidates.", "info")`.

**Non-TUI behavior (`rpc|json|print`):** Implicit `--dry-run`. Never blocks on undeliverable `confirm`/`select`.

### 4.3 `/scrub-restore` — Restore from Plugin Trash

```
Usage: /scrub-restore
```

**Flow:**
1. List trashed sessions for `ctx.cwd` from `~/.pi/agent/session-scrub-trash/--<cwd>--/`.
2. If TUI (`ctx.hasUI`): multi-select with detail (original name if recoverable, trashed date, messageCount).
3. If non-TUI: dry-run notify list only.
4. On confirm: `moveFromTrash(trashedPath, originalSessionPath)` (rename back).
5. Post-run: `notify("Restored X sessions.", "info")`.

**Manual restore path (documented):** `mv ~/.pi/agent/session-scrub-trash/--<cwd>--/<session>.jsonl ~/.pi/agent/sessions/--<cwd>--/<session>.jsonl`

### 4.4 `/scrub-init` — Write POLICY Block

```
Usage: /scrub-init
```

**Flow:**
1. Read project's local AGENTS.md (or create if absent).
2. If `<!-- pi-session-scrub:start -->` block exists: `notify("Policy block already exists.", "info")`; exit.
3. Write block from the generic template (§8), prompting for the project's ephemeral flows (placeholders kept when left empty):
   ```
   <!-- pi-session-scrub:start -->
   # session-scrub policy — project-local, opt-in.
   # Lines starting with `#` are guidance FOR THE AGENT; the plugin only
   # reads the `key: value` lines below. The user fills the <placeholders>.
   #
   # VERDICTS (record via the scrub_mark tool, with an optional reason):
   #   keep      — this session holds work worth preserving; never a trash candidate.
   #   paused    — block closure: work stopped but WILL continue later; not a candidate.
   #   finished  — session closure: the work is done; the session becomes a trash candidate.
   #   ephemeral — this session ran one of the ephemeral flows below; trash candidate.
   #   trash     — explicitly condemned; trash candidate even if the session is named.
   #
   # WHEN TO MARK:
   #   session_rename — when this session gets named or renamed (/name), record keep.
   #   block_close    — when work pauses with intent to resume, record paused.
   #   session_close  — when the work is done, record finished.
   #   ephemeral flow — when the session invokes a flow listed in ephemeral-flows, record ephemeral.
   #
   # EPHEMERAL FLOWS for this project: exact skill-flow names as invoked
   # (the name after /skill:), comma-separated. ONLY these flows ever qualify
   # a session as ephemeral. Leave the placeholders if none apply.
   verdicts: keep | paused | finished | ephemeral | trash
   mark-on: session_rename, block_close, session_close
   ephemeral-flows: <flow-name-1>, <flow-name-2>
   <!-- pi-session-scrub:end -->
   ```
4. `notify("Policy block written to AGENTS.md. Agent will now mark verdicts per directives.", "info")`.

---

## 5. Naming Hint — Once-Per-Session Gating (Unchanged from Rev 1)

**Mechanism:** On `agent_start`, if the current session is unnamed (`ctx.sessionManager.getEntries()` has no `session_info` with a name), derive a slug from the first user message and surface via `ctx.ui.setStatus("scrub-name", "sugerido: /name <slug>")`.

**Once-per-session gate:** Write a `custom` entry `{ type: "custom", customType: "session-scrub/name-hint", payload: { slug, offeredAt: Date.now() } }` after first hint. On subsequent `agent_start`, check for existing `session-scrub/name-hint` entry; if present, skip.

**Slug derivation (deterministic, no LLM):**
```ts
function deriveSlug(firstUserText: string): string {
  return firstUserText
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
```

**User confirmation:** Explicit `/name <slug>` (built-in Pi command). Plugin does **not** call `setSessionName()` programmatically.

---

## 6. Plugin-Owned Trash Directory — D1 Rewrite

### Layout

```
~/.pi/agent/
├── sessions/
│   └── --<cwd>--/              # Pi's per-project session storage
│       ├── session-abc123.jsonl
│       └── session-def456.jsonl
└── session-scrub-trash/
    └── --<cwd>--/              # Plugin-owned trash, sibling keying
        ├── session-abc123.jsonl
        └── session-def456.jsonl
```

- Trash directory keyed by **exact same cwd transformation** as Pi's session storage (`--<cwd>--`).
- Created automatically on first `moveToTrash()` call (`mkdirSync(recursive: true)`).
- No metadata sidecars — the `.jsonl` file is self-contained (includes verdicts in custom entries).

### Move/Restore Semantics

```ts
function moveToTrash(sessionPath: string, cwd: string): string {
  const trashDir = getTrashDir(cwd); // ~/.pi/agent/session-scrub-trash/--<cwd>--/
  const fileName = basename(sessionPath);
  const trashPath = join(trashDir, fileName);
  mkdirSync(trashDir, { recursive: true });
  renameSync(sessionPath, trashPath); // atomic on same FS
  return trashPath;
}

function moveFromTrash(trashedPath: string, cwd: string): string {
  const sessionsDir = getSessionsDir(cwd); // ~/.pi/agent/sessions/--<cwd>--/
  const fileName = basename(trashedPath);
  const restoredPath = join(sessionsDir, fileName);
  renameSync(trashedPath, restoredPath);
  return restoredPath;
}
```

### Absence Handling

- Trash dir auto-created on first use (no pre-flight check needed).
- If `renameSync` fails (cross-filesystem, permissions), surface error per file; never fall back to copy+unlink.

### Recovery Paths

1. **`/scrub-restore`** command (TUI multi-select, non-TUI dry-run).
2. **Manual `mv`** (documented in README): user can restore any trashed session at any time.
3. **No automatic purge** — trash retained indefinitely in slice 1. `/scrub-empty` deferred.

### Why OS Trash + `unlink` Are Excluded

- **OS trash:** User controls OS trash (empties it, configures retention, may be on different filesystem). Plugin cannot guarantee recoverability. Plugin-owned trash is fully controllable, inspectable, and restorable via plugin commands.
- **`unlink`/`rm`:** Irreversible. Contradicts "reversible deletion" product principle. Not present in slice 1 code paths.

---

## 7. Non-TUI Mode Degradation — D4 Expansion

| Mode | `ctx.hasUI` | What It Means | `/scrub` | `/scrub-apply` | `/scrub-restore` |
|------|-------------|---------------|----------|----------------|------------------|
| `tui` | `true` | Human with keyboard on other end; interactive prompts deliverable | Full audit notify | Interactive multi-select → confirm → move | Interactive multi-select → confirm → restore |
| `rpc` | `false` | Machine consumer (JSON-RPC); no interactive prompt possible | Audit as JSON notify | **Implicit `--dry-run`** — notify candidate list only | **Implicit `--dry-run`** — notify trashed list only |
| `json` | `false` | Structured output consumer; no TTY | Audit as JSON notify | **Implicit `--dry-run`** — notify candidate list only | **Implicit `--dry-run`** — notify trashed list only |
| `print` | `false` | Plain-text streaming (e.g., CI, pipes); no interactivity | Audit as text notify | **Implicit `--dry-run`** — notify candidate list only | **Implicit `--dry-run`** — notify trashed list only |

**`ctx.hasUI` semantics:** "A human with a keyboard on the other end" — Pi sets this true only for the interactive TUI. In all other modes, any `confirm` or `select` call would block forever waiting for input that never arrives. Therefore, degradation is **mandatory**: force dry-run path and notify the would-be action.

**Implementation:** Command handlers check `ctx.hasUI` at entry. If false, set internal `dryRun = true` and skip interactive prompts entirely. Output is `notify` (info) with structured candidate data.

---

## 8. Verdict Mechanism — D3 Detail

### POLICY Layer (Opt-In, Project-Local)

- Written by `/scrub-init` into project's AGENTS.md.
- Delimited block: `<!-- pi-session-scrub:start --> ... <!-- pi-session-scrub:end -->`.
- Directives are **instructions to the agent** (not code). Example:
  ```markdown
  <!-- pi-session-scrub:start -->
  # session-scrub policy — project-local, opt-in.
  # Lines starting with `#` are guidance FOR THE AGENT; the plugin only
  # reads the `key: value` lines below. The user fills the <placeholders>.
  #
  # VERDICTS (record via the scrub_mark tool, with an optional reason):
  #   keep      — this session holds work worth preserving; never a trash candidate.
  #   paused    — block closure: work stopped but WILL continue later; not a candidate.
  #   finished  — session closure: the work is done; the session becomes a trash candidate.
  #   ephemeral — this session ran one of the ephemeral flows below; trash candidate.
  #   trash     — explicitly condemned; trash candidate even if the session is named.
  #
  # WHEN TO MARK:
  #   session_rename — when this session gets named or renamed (/name), record keep.
  #   block_close    — when work pauses with intent to resume, record paused.
  #   session_close  — when the work is done, record finished.
  #   ephemeral flow — when the session invokes a flow listed in ephemeral-flows, record ephemeral.
  #
  # EPHEMERAL FLOWS for this project: exact skill-flow names as invoked
  # (the name after /skill:), comma-separated. ONLY these flows ever qualify
  # a session as ephemeral. Leave the placeholders if none apply.
  verdicts: keep | paused | finished | ephemeral | trash
  mark-on: session_rename, block_close, session_close
  ephemeral-flows: <flow-name-1>, <flow-name-2>
  <!-- pi-session-scrub:end -->
  ```
- Agent reads block on `agent_start` (via `fs.readFileSync`) and follows directives:
  - `session_rename`: when user runs `/name`, mark `keep` (named = active).
  - `block_close`: when agent detects work pause (no more tool calls, user says "pause"), mark `paused`.
  - `session_close`: when agent detects work finished (user says "done", PR merged), mark `finished` (trash candidate).
- Block is **opt-in**; absent = no agent verdict marking.
    - Parser rules: `#` comment lines and blanks are ignored; `<...>` placeholders are filled by the user at `/scrub-init` time; an unfilled placeholder equals an empty ephemeral-flows list (no ephemeral candidates).

### STATE Layer (Machine-Readable, Model-Invoked)

- Tool: `scrub_mark` registered via `pi.registerTool`.
- Signature: `scrub_mark({ verdict: "keep"|"paused"|"finished"|"ephemeral"|"trash", reason?: string })`.
- Implementation: `ctx.sessionManager.appendCustomEntry({ customType: "session-scrub/verdict", payload: { verdict, at: new Date().toISOString(), reason } })`.
- **Custom entries do NOT participate in LLM context** (verified Pi 0.85.1: `:968`).
- Audit (`/scrub`) reads via `getEntries()` filtering `customType === "session-scrub/verdict"`.
- Latest verdict by `at` timestamp wins.

### Verdict Taxonomy

| Verdict | Meaning | Triggers (per POLICY) | Effect on Classification |
|---------|---------|----------------------|--------------------------|
| `keep` | Active, do not touch | session_rename, explicit agent decision | `named-protected` or `kept` |
| `paused` | Block closure, will continue | block_close | `kept` (not a candidate) |
| `finished` | Work done, trash candidate | session_close | `candidate` (reason: finished) |
| `ephemeral` | Invocation of a listed ephemeral skill flow, candidate | deterministic audit match on POLICY `ephemeral-flows:` (agent `scrub_mark` also accepted) | `candidate` (reason: ephemeral) |
| `trash` | Explicitly marked for deletion | explicit agent decision | `candidate` (reason: explicit-trash) — overrides name protection |

### API Verification (Pi 0.85.1 dist)

- `pi.registerTool` — `extensions/types.d.ts:944`
- `appendEntry(customType, data)` — `extensions/types.d.ts:985`
- `SessionManager.appendCustomEntry` — `session-manager.d.ts:226`
- "Custom entries do not participate in LLM context" — `extensions/types.d.ts:968`

---

## 9. Affected Areas

| File | Change Type |
|------|-------------|
| `extensions/session-scrub/index.ts` | **Rewrite** — replace v2 stub with full slice-1 implementation |
| `package.json` | Ensure `peerDependencies` correct; add `pi-package` keyword if missing |
| `README.md` | Update with command docs, trash dir location, manual restore, POLICY block usage |
| `openspec/changes/session-scrub-cleanup/spec.md` | To be written in Spec phase |

**No changes to:** container repo, other plugins, global skills.

---

## 10. Risks & Mitigations — D4 Expansion

| Risk | Concrete Failure Scenario | Likelihood | Impact | Mechanical Mitigation |
|------|---------------------------|------------|--------|----------------------|
| `SessionInfo` field drift in Pi upgrade | Pi 0.86 changes `SessionInfo` shape (e.g., `firstMessage` removed) | Low | Medium | Pin against running Pi (0.85.1 verified); re-check on each Pi upgrade; defensive optional chaining in classifier |
| Plugin-owned trash dir on different filesystem | `renameSync` fails with `EXDEV` (cross-device) | Low | High (trash fails silently) | Detect `EXDEV`, `notify` error per file, **do not** fall back to copy+unlink; user can manual `mv` |
| Disk growth from unbounded trash retention | User never runs `/scrub-restore` or `/scrub-empty`; trash accumulates GBs | Medium | Medium | Per-project trash listing in `/scrub` + `/scrub-restore` makes growth visible; explicit purge (`/scrub-empty`) deferred to explicit decision |
| Ephemeral-flow list stale/overbroad | Renamed flow not proposed (missed cleanup) or broad entry matches wrong session | Low | Low | Exact flow-name matching (no substrings); list owned in POLICY block; match **only proposes** candidate; user disposes in `/scrub-apply` |
| Custom-entry schema drift on Pi upgrade | Pi changes `CustomEntry` shape or `appendCustomEntry` signature | Low | Medium | Namespaced `customType: "session-scrub/verdict"` + `version: 1` in payload; defensive parsing with defaults |
| Non-TUI confirm blocking | `confirm` called in `pi --print` → hangs indefinitely | Medium | High | `ctx.hasUI` guard at command entry forces dry-run; tested in `pi --print` and `pi --json` |
| Naming hint spam | Hint appears on every `agent_start` | Low | Low | Once-per-session `session-scrub/name-hint` custom entry gate |
| Count mismatch vs `/resume` | `/scrub` shows different count than `/resume` picker | Low | Medium | Post-move re-list + notify; live session always excluded from both |
| POLICY block parser failure | AGENTS.md has malformed delimiters or encoding issues | Low | Low | Graceful fallback: if block not parseable, treat as absent (no agent verdict marking) |

---

## 11. Rollback Plan

- **Plugin disable:** `pi config extensions.session-scrub.enabled false` (standard Pi package toggle).
- **Uninstall:** `pi uninstall session-scrub` — removes extension entry; no persistent state (verdicts are `custom` entries inside session files, harmless if plugin gone).
- **Accidental trash:** User restores via `/scrub-restore` or manual `mv` from `~/.pi/agent/session-scrub-trash/--<cwd>--/` to `~/.pi/agent/sessions/--<cwd>--/` (reversible by design).

---

## 12. Success Criteria (Slice 1 Definition of Done)

1. `pi -e ./extensions/session-scrub/index.ts` starts clean; `/reload` works.
2. `/scrub` shows correct classifications matching decision tree (live excluded, named-protected, auto-deletable, candidates, old-needs-confirm, kept).
3. `/scrub-apply --dry-run` lists exact actionable candidates with full detail.
4. `/scrub-apply` (TUI) multi-select → confirm → moves to plugin trash dir → re-list shows reduced count.
5. `/scrub-restore` (TUI) lists trashed sessions → multi-select → confirm → moves back → re-list shows restored.
6. Cross-filesystem `rename` failure: surfaces error per file, never falls back to `unlink`.
7. Non-TUI modes: `/scrub-apply` and `/scrub-restore` do dry-run only, no hang.
8. Naming hint appears once per unnamed session; second `agent_start` silent.
9. `session_shutdown` handler absent — no close prompt.
10. `/scrub-init` writes POLICY block with delimiters; idempotent (no duplicate block).
11. `scrub_mark` tool registered; writes `session-scrub/verdict` custom entry with `version: 1`; readable via `getEntries()`.
12. TypeScript strict passes; no `any`; const-object patterns; flat interfaces.
13. Single code commit ≤ 400 changed lines (meta/docs separate).

---

## 13. Budget Check (Mandatory Section)

**Slice 1 components:**
- `/scrub` command (audit + classification)
- `/scrub-apply` command (dry-run + TUI multi-select + move-to-trash + verify)
- `/scrub-restore` command (list trash + TUI multi-select + move-back + verify)
- `/scrub-init` command (POLICY block write)
- `scrub_mark` tool (registerTool + appendCustomEntry)
- Naming hint (agent_start + custom entry gate + setStatus)
- Trash dir management (getTrashDir, moveToTrash, moveFromTrash, auto-mkdir)
- Non-TUI degradation (ctx.hasUI guard at entry)
- Classification engine (classifySession + verdict reading)

**Estimated lines:**
- Core logic (classify, trash dir, verdict read/write): ~120 lines
- Command handlers (4 commands × ~35 lines): ~140 lines
- Tool registration + naming hint: ~50 lines
- Types/interfaces: ~40 lines
- Error handling + notifications: ~50 lines
- **Total: ~400 lines** — at budget ceiling.

**Recommendation if over:** Move `/scrub-restore` to slice 2 (deferred with explicit decision). It is a convenience command; manual `mv` works for slice 1. Keep `/scrub`, `/scrub-apply`, `/scrub-init`, `scrub_mark`, naming hint, trash dir in slice 1.

---

## 14. Delivery Strategy

**ask-on-risk** (per SDD preflight). First slice targets one work-unit commit ≤ 400 lines. If implementation exceeds budget, pause and ask for chaining decision — do not auto-chain. `exception-ok` requires explicit acceptance of `size:exception`.

---

## 15. Skill Resolution

**skill_resolution: paths-injected** — All five required skills loaded from injected paths:
- `/home/cleceta/.pi/agent/skills/pi-plugin-dev/SKILL.md`
- `/home/cleceta/.pi/agent/skills/pi-sessions/SKILL.md`
- `/home/cleceta/.pi/agent/skills/pi-packages/SKILL.md`
- `/home/cleceta/.pi/agent/skills/typescript/SKILL.md`
- `/home/cleceta/.pi/agent/skills/pi-tui/SKILL.md`

No fallback used.

---

## 16. Next Recommended Action

Proceed to **Spec phase** (`openspec/changes/session-scrub-cleanup/spec.md`) with:
- Exact TypeScript interfaces (flat, const-object enums)
- Function signatures for `classifySession`, `deriveSlug`, `moveToTrash`, `moveFromTrash`, `getTrashDir`, `offerNameHint`, `readPolicyBlock`
- Event/command registration order
- Non-TUI degradation logic
- Test scenarios for manual verification (no automated harness yet)
- CLI flag definitions (`--dry-run` only)

---

## Key Learnings

1. User decisions D1-D4 fundamentally reshaped the trash model, cleanable predicate, verdict mechanism, and risk analysis — all product decisions, not implementation details.
2. Plugin-owned trash directory eliminates dependency on external `trash` CLI and OS trash unpredictability, at cost of explicit purge deferral.
3. Two-layer verdict mechanism (POLICY in AGENTS.md + STATE via custom entries) separates human-readable directives from machine-readable state cleanly.
4. Budget is tight at ~400 lines; `/scrub-restore` is the natural slice-2 candidate if estimate proves optimistic.
5. Non-TUI degradation via `ctx.hasUI` guard is a hard requirement — blocking prompts in RPC/JSON/print modes are unrecoverable.