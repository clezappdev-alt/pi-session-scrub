# session-scrub — behavior specification (as-built)

**Status:** as-built documentation, derived from source; requirements are cited by ID from the canonical spec and never restated here.
**Reflects:** anchored to the released tag `v0.6.1`; Layers A–B describe `master` at the `v0.6.1` commit (2026-10-26), which is what that tag releases — everything `v0.6.0` carried (the handoff promise, the bounded result line, and the cell-budgeted call lines), plus the write guards (no write follows a symlink; the restore's overwrite refusal is pinned by a test) and the session discovery fix that makes a custom `--session-dir` the directory both read and written. **Beyond the tag, still unreleased on `master`:** the conditional rename rule and the block's PRECEDENCE section (`session-scrub-mark-on-precedence`), `/scrub:init --update` (`session-scrub-init-update`), and the retention axis (`session-scrub-retention-axis`: a recorded `ephemeral`/`trash` outranks the name, and a candidate row carries its name) — all documented below because the as-built spec follows the code, and all waiting on the `v0.7.0` tag. The anchor is checked against `git describe --tags` by `doccheck.test.ts`, which is why the unreleased part is named here instead of moving the anchor: the tag has not moved yet, and the whole document is re-reconciled at each new tag, not per commit.

## How to read this document

This document has three layers. **Layer A — Surface** lists what exists in a form a
machine could check (registrations, storage, entry types, flags, policy keys,
constants); `doccheck.test.ts` pins the registration inventory against the code.
**Layer B — Contract** is short prose per surface: what it does, what it refuses,
what it writes and where; it cites code by symbol (`file.ts:symbol`) and requirements
by ID (`REQ-n`, `TR-n`, `UX-n`, `NB-n`) instead of by line. **Layer C — Exceptions,
evidence and history** carries accepted deviations, dated measurements and every
`UNVERIFIED` item; it is the only layer allowed to contain `path:line` citations,
and only inside a dated evidence block, because that is what evidence looks like.
Requirements themselves are not decided here: the canonical spec
`openspec/specs/session-scrub/spec.md` (reconciled 2026-10-26) is the requirements
authority, and where a requirement exists this document cites its ID instead of
restating it. The version anchor above is pinned by `doccheck.test.ts` against
`git describe --tags`.

---

## Layer A — Surface

### Registrations

Seven commands, two tools and two hooks are registered by the factory
(`index.ts` default export). Nothing else is registered, and no
`session_start` / `session_shutdown` lifecycle handler exists — the absence is
deliberate (silent close, REQ-12), so nothing in the extension runs without a command
invocation, a tool call, or an agent start/end event, and closing a session never
prompts.

| Surface | Registration | Description (literal) | Handler |
| --- | --- | --- | --- |
| `/scrub:audit` | `pi.registerCommand("scrub:audit"` | `Audit this project's sessions (read-only)` | `index.ts:handleScrub` |
| `/scrub:apply` | `pi.registerCommand("scrub:apply"` | `Trash actionable sessions (dry-run first, reversible via /scrub:restore)` | `index.ts:handleScrubApply` |
| `/scrub:restore` | `pi.registerCommand("scrub:restore"` | `Restore trashed sessions for this project` | `index.ts:handleScrubRestore` |
| `/scrub:init` | `pi.registerCommand("scrub:init"` | `Write the opt-in session-scrub policy block into AGENTS.md` | `index.ts:handleScrubInit` |
| `/scrub:triage` | `pi.registerCommand("scrub:triage"` | `Assisted triage of verdict-less sessions (digests, then confirmed writes)` | `index.ts:handleScrubTriage` |
| `/scrub:adopt` | `pi.registerCommand("scrub:adopt"` | `Apply the naming convention to sessions that predate it (dry-run first)` | `index.ts:handleScrubAdopt` |
| `/scrub:handoff` | `pi.registerCommand("scrub:handoff"` | `Create the continuation this session promised: a new session, named and seeded …` | `index.ts:handleScrubHandoff` |
| `scrub_mark` tool | `pi.registerTool({ name: "scrub_mark"` | `Record session verdict` | `index.ts:handleScrubMark` |
| `scrub_close` tool | `pi.registerTool({ name: "scrub_close"` | `Close this work block` | `index.ts:handleScrubClose` |
| `agent_start` hook | `pi.on("agent_start"` | — | `index.ts:handleAgentStart` |
| `agent_end` hook | `pi.on("agent_end"` | — | `index.ts:handleAgentEnd` |

Machine-readable surface inventory — parsed by `doccheck.test.ts` (S2.1/S2.2);
keep the markers and the `command|tool|hook: <name>` line format verbatim.

<!-- doccheck:surface:start -->
command: scrub:audit
command: scrub:apply
command: scrub:restore
command: scrub:init
command: scrub:triage
command: scrub:adopt
command: scrub:handoff
tool: scrub_mark
tool: scrub_close
hook: agent_start
hook: agent_end
<!-- doccheck:surface:end -->

### Accepted flags and arguments per command

| Command | Flags / arguments actually parsed |
| --- | --- |
| `/scrub:audit` | none — `void args` (`index.ts:handleScrub`) |
| `/scrub:apply` | `--dry-run` (raw substring test, `index.ts:resolveDryRun`); no other flag is read |
| `/scrub:restore` | none — `void args` (`index.ts:handleScrubRestore`) |
| `/scrub:init` | `--dry-run` and `--update` (substring, read via `index.ts:resolveDryRun` and `index.ts:handleScrubInit`); no other flag is read |
| `/scrub:triage` | `--apply` (substring), `--verbose` (whitespace-split token), `--dry-run` (stripped by `index.ts:cleanTriageArgs`, read only via `index.ts:resolveDryRun`); inline assignment grammar `idPrefix:verdict:"reason"` / `idPrefix:name:"slug"` / bare `idPrefix:keep` (`index.ts:parseTriageInput`) |
| `/scrub:adopt` | `--apply` (exact token); inline assignment grammar `idPrefix:state` (`adopt.ts:parseAssignments`) |
| `/scrub:handoff` | free text only — the next step to carry (`handoff.ts:planHandoffNames`) |

No `--force`, `-f`, `--yes`, `-y`, `--skip-guard` or `--no-confirm` exists anywhere.
On `/scrub:triage` and `/scrub:adopt` a bypass-shaped token is refused by name
(`adopt.ts:findBypassAttempt`); the only bypass is waiting out the freshness window.

### Storage layout

- Session discovery always goes through
  `SessionManager.list(ctx.cwd, ctx.sessionManager.getSessionDir())`, so a custom
  `--session-dir` is the directory it reads *and* the one the trash and backups
  derive from; the live
  session is read through `ctx.sessionManager.getEntries()` and never opened from
  disk (`index.ts:auditSessions`).
- Trash dir: `sessionfs.ts:getTrashDir` —
  `join(dirname(dirname(sessionDir)), "session-scrub-trash", basename(sessionDir))`,
  a sibling of Pi's `sessions/` root, two levels up from the per-project dir, so
  trashed files are never where Pi could mistake them for live sessions.
- Backup dir: `sessionfs.ts:getBackupDir` — same arithmetic with root
  `session-scrub-backups`, deliberately a sibling of the trash dir and never a
  directory inside it (a backup inside trash would be offered for restore).
- The only file the extension writes outside trash, backups and session files is
  `<ctx.cwd>/AGENTS.md`, through `sessionfs.ts:appendPolicyBlock` on a first run and
  `sessionfs.ts:replacePolicyBlock` on `--update` (`index.ts:handleScrubInit` plans
  both). An update copies the file into the backups root first
  (`sessionfs.ts:backupFileAside`) and names that path in its report, so the state
  immediately before the rewrite is always recoverable by hand.
- **No write follows a symlink.** `sessionfs.ts:refuseNonRegularFile` runs `lstat`
  and refuses anything that exists and is not a regular file, on the backup copy and
  on that `AGENTS.md` append alike. A path that does not exist passes: the caller
  decides, and `/scrub:init` creates an absent `AGENTS.md`.
- Every mutation of a session file is a `renameSync` into or out of the trash
  (`sessionfs.ts:moveToTrash`, `sessionfs.ts:moveFromTrash`) or an append
  (`pi.appendEntry`, `SessionManager.appendCustomEntry`,
  `SessionManager.appendSessionInfo` via `index.ts:appendNameToOther` and
  `index.ts:appendVerdictToOther`, both inside `withFileMutationQueue`).
  No `unlink`, `rm`, `rmSync` or truncation exists; nothing is ever permanently
  deleted and the trash is never purged (REQ-10).

### Entry types

| Custom type | Shape | Written by |
| --- | --- | --- |
| `session-scrub/verdict` | `{ version: 1, verdict, at (ISO), reason? }` (`classify.ts:VerdictData`) | `scrub_mark` (`index.ts:handleScrubMark`), triage `--apply` (`index.ts:appendVerdictToOther`) |
| `session-scrub/name-hint` | `{ version: 1, slug, offeredAt (ISO) }` | naming-hint hooks (`index.ts:maybeOfferHint`) |
| `session-scrub/handoff` | custom message, `display: false`, payload built by `handoff.ts:buildHandoffMessage` | `/scrub:handoff` destination seed |
| `session_info` | Pi's own name entry (`name`) | consented renames (`index.ts:appendNameToOther`) and `scrub_close`/`/name` via `pi.setSessionName` |

Verdict reads take the entry with the lexicographically greatest `at`
(`index.ts:readLatestVerdict`); malformed verdict entries are skipped, never thrown
on (`index.ts:asVerdictData`). The name is the single carrier of the continuation
question and outranks the verdict entry for everything it can answer
(`name.ts:resolveVerdict`, NB-01/NB-02); `ephemeral` and `trash` are the retention
axis, which no name can express, so a recorded retention verdict outranks the name
instead (RA-01, `session-scrub-retention-axis`) and a name never clears one.

### POLICY keys

`/scrub:init` writes the `POLICY_TEMPLATE` block delimited by
`<!-- pi-session-scrub:start -->` / `<!-- pi-session-scrub:end -->`
(`policy.ts:parsePolicyBlock`). The block is a **region**, not a switch: keys are
read only between the first start marker and the first end marker after it, and
both must be present in that order — otherwise the block is absent and the
conservative default applies (PB-01). Markers inside a fenced code block — three
or more backticks, or three or more tildes — or quoted as an inline code span are
quoted text, never markers and never keys, so a template pasted as an example in a
project's own docs cannot become policy (PB-02). The extension reads exactly one key:
`ephemeral-flows:` — comma-separated exact skill-flow names; blank, `#`-comment,
placeholder (`<…>`) and unknown lines are skipped. The `verdicts:` and `mark-on:`
lines in the template are agent guidance, parsed by nothing. That guidance carries
the precedence the code enforces: the name is the record, and a name that starts
with a state already IS that session's verdict (`name.ts:verdictFromState` —
`pausa`/`espera` → `paused`, `abierto` → `keep`, `hecho`/`traspaso` → `finished`),
which is why `scrub_mark` refuses a write the name would override (NB-02, RA-03) and
why a refused mark means nothing needs marking. That refusal is computed from the
resolution (`name.ts:writeTakesEffect`), not read off the name: a retention verdict is
not expressible there, so marking one is accepted even on a named session. Its sentence
lives in `render.ts:formatMarkRefusal`, so the whole message is asserted instead of a
fragment of it inlined in the handler. The `session_rename` rule is therefore
conditional: it orders `keep` only for a name that declares no state, the one case
where the mark is both writable and load-bearing (a state-less name resolves no
verdict, so it would otherwise return to `/scrub:triage`). `policy.test.ts` parses
the state → verdict rows out of `POLICY_TEMPLATE` and holds them to
`verdictFromState` for every `STATE` value, so a new state cannot land in the code
while the block still describes the old vocabulary.

**Ownership inside the block** is what makes an automated refresh safe, and it is a
rule the template states nowhere else — it lives in `policy.ts:planInitUpdate`:

| line inside the markers | owner | `/scrub:init --update` |
| --- | --- | --- |
| blank, `#`-comment | template | rewritten |
| `verdicts:`, `mark-on:` | template | rewritten |
| `ephemeral-flows:` | **the human** | the value survives verbatim; the key line is re-emitted by the template |
| anything else non-blank | nobody identified | **refused** by line number, nothing written |

A second `ephemeral-flows:` line is refused the same way the parser unions it: two
lines of the human's data are not the extension's to collapse. `--update` therefore
cannot silently delete a line a project added between the markers — the refusal
names it and says where to move it.

**This repository's own block is pinned the same way** (`doccheck.test.ts`, R3):
`AGENTS.md` must be what `--update` would leave, asserted by running the shipped
planner over it (`planInitUpdate(AGENTS.md)` must return `current`) instead of
re-implementing the comparison here. It is the gate that would have caught the
hand edit of 2026-10-27, and a companion test drifts the template generically to
prove the assertion actually bites.

Any parse failure or
missing block collapses to `ephemeralFlows: []` (`index.ts:readPolicyConfig`),
with which no session is ever an ephemeral candidate by flow (REQ-03).

### Named constants

| Constant | Value | Defined in |
| --- | --- | --- |
| `MAX_AGE_MS` | 7 days | `classify.ts` |
| `MIN_CONVERSATION_TURNS` | 5 | `classify.ts` |
| `VERDICTS` | `keep`, `paused`, `finished`, `ephemeral`, `trash` | `classify.ts` |
| `CLASS_KIND` | `live`, `named-protected`, `auto-deletable`, `candidate`, `old-needs-confirm`, `kept` | `classify.ts` |
| `CANDIDATE_REASON` | `explicit-trash`, `finished`, `ephemeral`, `empty` | `classify.ts` |
| `STATE` | `pausa`, `abierto`, `espera`, `traspaso`, `hecho` | `name.ts` |
| `FRESH_MTIME_MS` | 120 000 ms (2-minute freshness window) | `adopt.ts` |
| `HEAD_DIGEST_CHARS` / `TAIL_DIGEST_CHARS` | 300 / 300 | `index.ts` |
| `MAX_DIGEST_SESSIONS` | 20 | `index.ts` |
| `MIN_ABBREV` | 8 (display-id width floor, widened per set) | `ids.ts` |
| `STATUS_KEY` | `scrub:name` | `index.ts` |
| `MEMORY_WRITE_TOOLS` | `mem_save`, `mem_session_summary` | `handoff.ts` |
| `BYPASS_FLAGS` | `--force`, `-f`, `--yes`, `-y`, `--skip-guard`, `--no-confirm` | `adopt.ts` |

Display ids are derived per full project id set by `ids.ts:uniqueAbbreviations`
— minimal-unique, never shorter than eight (NB-06). Restore prompts take the id
from the filename via `ids.ts:idFromFilename` (`<timestamp>_<uuid>.jsonl`), not
from the basename front, which is the date.

---

## Layer B — Contract, command by command

### `/scrub:audit` — read-only audit (REQ-05)

`index.ts:handleScrub` → `index.ts:auditSessions`. Parses no flag. Lists
`SessionManager.list(ctx.cwd)`, resolves the live session by path or id
(`classify.ts:samePath`), reads the policy (`index.ts:readPolicyConfig`), resolves
each session's verdict through `name.ts:resolveVerdict` (the name outranks the entry
for every verdict the name can answer, a recorded `ephemeral`/`trash` outranks the name,
NB-02/RA-01), matches ephemeral flows over joined user-message texts (skipped for
`trash`), counts conversation turns (`classify.ts:countConversationTurns`), and
classifies with `classify.ts:classifySession` (REQ-01, NB-07). Decision order:
live → retention candidates (`trash` → `explicit-trash`, `ephemeral` → `ephemeral`,
both tested ABOVE the name, RA-02) → named `named-protected` → unnamed `finished`
candidate → ephemeral-flow match candidate (below the name on purpose: a text match
never outranks a human record) → any other explicit verdict `kept` (verdict precedence,
NB-07) → empty `auto-deletable` → turn floor (≥ `MIN_CONVERSATION_TURNS`
turns, or an unknown count, is kept) → 7-day `old-needs-confirm` →
`kept has-content-no-verdict`. When the live session is not listed yet, a synthetic
`live` row is unshifted, its `created`/`modified` as `now`; its `messageCount` is
the entry count, not the message count — the one place the two are conflated.

Output is one `notify(info)` with the summary line plus one `index.ts:formatAuditLine`
per session (`live …`, `kept <id> named "…"`, `auto <id> empty`,
`trash-candidate <id> reason=<reason>[ named "…"]` (`render.ts:formatCandidateLine`:
the name is there because RA-02 makes a named session reachable as a candidate, and this
row is the body of the deletion confirm; the quoted name is bounded to 60 cells, because a
name is free text a human typed and every row here must stay inside the terminal frame),
`review <id> msgs=… modified=… first="…"`,
`kept <id> <reason>`). Fully idempotent and side-effect free: no write, no
`mkdirSync`, no confirm, no trash-dir creation. A malformed session file reads as
`[]` (`index.ts:openSessionEntries`) and classifies as if it had no verdict and no
user text. Verdict ordering is lexicographic on the ISO `at` string — correct for
`toISOString()` output, misordering any non-ISO value a foreign writer appends.

### `/scrub:apply` — dispose with consent (REQ-06)

`index.ts:handleScrubApply`. One flag: `--dry-run`, detected as a raw substring.
Flow: re-audit → filter to `index.ts:isActionable` (`auto-deletable`, `candidate`,
`old-needs-confirm`; `live`, `named-protected` and `kept` are never in scope) →
nothing actionable → `"<summary> Nothing to trash."` → dry-run or non-TUI
(`index.ts:isInteractive`: TUI with UI only, REQ-11) → `"<summary> Dry-run — nothing moved."`
plus one line per actionable item → otherwise per item a `ctx.ui.confirm`
(`"Trash session <shortId>?"`, body from `render.ts:formatTrashConfirmBody`, which
always ends with `Move is reversible via /scrub:restore.`) → `sessionfs.ts:moveToTrash`
(mkdir trash chain, `renameSync`; trash-name collisions overwrite silently — there
is no `existsSync` guard outbound) → re-list and report
`Trashed <n> session(s). Remaining: <r>.` (`render.ts:formatTrashResult`).

Per-file `try/catch`: one failure reports `Skipped <shortId>: <message>` at
`warning` and the loop continues. A second run re-audits; trashed sessions no
longer list, so nothing is re-offered or double-moved. The live session can never
be actionable. No `--force`, no `--yes`, no picker, no permanent deletion.

### `/scrub:restore` — restore from trash (REQ-07)

`index.ts:handleScrubRestore`. Parses no flag — `--dry-run` in the TUI is silently
ignored (there is no preflight for this command; the non-TUI guard is a direct
`!isInteractive(ctx)` check). Lists `*.jsonl` in `sessionfs.ts:getTrashDir`
(`index.ts:listTrash`; read failure and empty dir both yield
`"No trashed sessions for this project."`). Non-TUI →
`"Dry-run — nothing restored:\n<basenames>"`. TUI → per file a confirm
(`"Restore session <id8>?"`, id from `ids.ts:idFromFilename`, width from
`ids.ts:uniqueAbbreviations`) → `sessionfs.ts:moveFromTrash` (mkdir sessions dir,
refuses to overwrite: `restore target already exists: <path>`, then `renameSync`; the
refusal is pinned by a test, and it leaves both files untouched)
→ `Restored <n> session(s).` (`render.ts:formatRestoreResult`).

Verdicts are not cleared: restoring only renames the file back, entries included,
so a restored `trash`-verdicted session is a candidate again on the next audit.
Non-`.jsonl` files in the trash dir are invisible. No `--all`, no deletion from
trash, no cross-project restore.

### `/scrub:init` — write the POLICY block, and refresh it (REQ-08)

`index.ts:handleScrubInit` decides with `policy.ts:planInitWrite` and keeps only
I/O and UI for itself. It reads `<ctx.cwd>/AGENTS.md` (a read throw is treated as
empty). With an unfenced start marker present it refuses and names its 1-based
line — `Policy block already exists at line <n>. Nothing written.` Otherwise it
previews the exact text it would append: `--dry-run`, and any non-interactive mode
like every other write path (REQ-11), notifies `Dry-run — nothing written. Would
append to AGENTS.md:` followed by that text; the TUI confirms
`"Write the session-scrub policy block to AGENTS.md?"` with the same text.
A failed write notifies `Could not write AGENTS.md: <message>` and mutates
nothing — the command never rejects outward (PB-04). That includes the §9.6 refusal:
when `AGENTS.md` is a symlink or a directory, the message reads
`Could not write AGENTS.md: refusing to write through AGENTS.md: not a regular file (<path>)`
and the link target is byte-for-byte unchanged. On success it reports
`Policy block written to AGENTS.md. Fill ephemeral-flows for this project.` The
template's placeholder `ephemeral-flows: <flow-name-1>, <flow-name-2>` parses as
empty, so a freshly written block is inert until a human fills it (REQ-03).

**`--update` refreshes a block that already exists** (UD-01…UD-04).
`index.ts:handleScrubInitUpdate` decides with `policy.ts:planInitUpdate`, which
locates the region with the same scanner `planInitWrite` uses
(`policy.ts:findBlockRegion`) and returns one of:

- `append` — no block at all: the append path runs unchanged, with the same message
  as a first run;
- `unterminated` — a start with no end: `Policy block starts at line <n> but has no end marker. Fix it by hand. Nothing written.`
  (the region has no known end, and inventing one deletes the human's text);
- `foreign` — a line inside the markers the template does not own:
  `Policy block has a line this template does not own (line <n>: "<text>"). Move it outside the markers. Nothing written.`;
- `current` — the region already equals the template with the project's flows:
  `Policy block is already up to date (line <n>). Nothing written.` (so a second run
  is always a no-op);
- `update` — the region is rewritten in place, everything outside the markers kept
  byte-for-byte. `--dry-run` / non-interactive notifies
  `Dry-run — nothing written. Policy block at line <n> would change:` plus
  `policy.ts:diffPolicyBlock`'s hunks — `-` leaves, `+` arrives, `  ` is context, and
  the block's own common head and tail are trimmed; an interior line the update keeps
  is never shown as a rewrite (the first live trial caught exactly that: three
  identical lines rendered as a `-`/`+` pair); the TUI confirms `"Update the session-scrub policy block in AGENTS.md?"` with that
  diff. Accepted, the file is copied into the backups root *before* the write
  (`sessionfs.ts:backupFileAside`, and a failed backup stops the write), the write
  goes through `sessionfs.ts:replacePolicyBlock` behind the same §9.6 guard, and the
  report is `Policy block updated in AGENTS.md (line <n>). Backup: <path>`.

### `/scrub:triage` — assisted triage (TR-01…TR-13, UX-01…UX-08)

`index.ts:handleScrubTriage`. A bypass-shaped flag is refused by name
(`adopt.ts:findBypassAttempt`): `"<flag> is not a bypass flag; no such flag exists.
A session written within the last 2 minutes is confirmed, not skipped — waiting is
the only bypass."` Without `--apply`, phase 1 (`index.ts:handleScrubTriagePhase1`);
with it, phase 2 (`index.ts:handleScrubTriagePhase2`).

**Phase 1 — read-only digest (TR-07).** Candidates from
`index.ts:gatherTriageCandidates` (NB-09): live excluded, any session whose resolved
verdict exists (`name.ts:resolveVerdict`) excluded — a verdict is terminal for
triage — empty sessions counted as `emptySkipped`, ephemeral-flow matches as
`ephemeralSkipped`. Empty set →
`"Nothing to triage. (<e> empty skipped, <p> ephemeral already candidates.)"`.
Page composition is WEAK-first with machine keeps filling to
`MAX_DIGEST_SESSIONS` (`index.ts:partitionTriageCandidates`, UX-01); WEAK rows
render as fenced packs (`index.ts:buildDigestPack`: head ≤ 300 chars of the first
user message, tail ≤ 300 chars from the last 3 assistant + 2 user messages
re-merged chronologically (TR-05), both stripped by `index.ts:stripForQuote`,
`weak-guess:` from `index.ts:suggestTriageWeak` — a labeled guess, never a verdict,
TR-04); machine rows render as compact one-liners (`render.ts:formatCompactRow`,
UX-02 — no guess field, proposal is the fact `keep`, TR-03). `--verbose` adds full
packs for machine rows. Deferral is transparent: `deferred (<N>): <id>, <id>, …`
with no packs and no guesses (UX-06). Footer names the `--apply` grammar and states
nothing is written. No write, no mkdir, no confirm in any mode. Nothing is
silently dropped: every candidate is paged or listed.

**Phase 2 — `--apply`, consented writes (TR-08…TR-12).** Grammar
(`index.ts:parseTriageInput`): `idPrefix:verdict:"reason"` (backslash escapes via
`index.ts:unescapeReason`), `idPrefix:name:"slug"`, bare `idPrefix:keep`; one
shared `seen` set spans both classes, so a second assignment of any prefix —
verdict or rename — is rejected as `duplicate assignment "<prefix>"`. `trash` is
never appliable from triage (parser, bare-token parser and
`index.ts:appendVerdictToOther` all refuse it); bare non-`keep` verdicts are
rejected as missing rationale (UX-04). All rejections are emitted as
`Rejected <raw>: <cause>` before any confirm. Fresh resolution
(`index.ts:gatherTriageCandidates` re-run, TR-09): prefix matching via
`startsWith`, zero matches → `unknown session (stale or out of triage set)`,
multiple → `ambiguous prefix (<n> sessions)`. Reasonless `id:keep` is machine-only:
`reasonless keep is machine-only — WEAK needs id:keep:"reason"` otherwise (UX-04).

Non-TUI or `--dry-run` (post-resolve, UX deviation 2): `Dry-run — nothing written.`
plus `would bulk-keep …`, `would apply …`, `would rename …` lines; zero writes,
zero confirms (TR-11). In the TUI, machine-provenance `keep` verdicts bulk-confirm
as one set with the fixed dated rationale
`machine keep, bulk-confirmed <YYYY-MM-DD>` (`index.ts:bulkKeepRationale`, UX-03);
everything else confirms per item. Every write goes through the same per-file body:
pre-append freshness recheck (`verdict appeared meanwhile (<v>)` / `Already
<shortId>: verdict <v> present and matching - counted.` — the idempotency path),
then `index.ts:appendVerdictToOther` (refuses `trash`, a gone file and the live
session by resolved path, then appends the versioned entry inside
`withFileMutationQueue`, TR-10, NB-05 guard stack), then a post-write re-read
(`post-write re-read mismatch` on mismatch). Renames go through
`index.ts:appendNameToOther` — the by-path write stack (NM-08): refuse empty slug /
gone file / live session, snapshot with `sessionfs.ts:snapshotFile` (unparsed
files are refused), back up with `sessionfs.ts:backupSessionFile` into
`sessionfs.ts:getBackupDir`, append `session_info`, verify with
`adopt.ts:verifyAdoption` (exactly one entry gained, name matches). Fresh targets
(additional confirmation inside the 2-minute window, NM-03) get
`adopt.ts:freshnessWarning` in the confirm body; a rename confirm shows
existing → proposed with `msgs`/`age`. Summary: `"Cancelled."` when nothing was
confirmed, else `Triaged <n> of <m> (<a> applied + <b> already)` with optional
`N declined [ids]`, `N conflict [ids]`, `N error [ids]`, `renamed …` parts,
terminated by `Re-run /scrub:audit to see new classifications.`

### `/scrub:adopt` — apply the naming convention in bulk (NB-05)

`index.ts:handleScrubAdopt`. Every session under the cwd is a candidate —
deliberately not the triage subset, because the pre-convention population is
exactly the large unnamed one. Bypass flags refused by name as above. Planning is
`adopt.ts:planAdoption`: a name that already carries a state prefix is
`already-adopted` and untouched (the human text is never rewritten); a session
with neither an inline assignment nor a state-bearing verdict is `needs-state` —
nothing is invented; `adopt.ts:stateFromVerdict` derives `pausa` from `paused` and
`hecho` from `finished` only — `keep`, `ephemeral` and `trash` carry no
continuation claim (NM-01/NM-02). The live session is refused by design and
reported, not dropped: `live session, refused by design (<n>) — use scrub_close to
name it`. Prefix resolution (`adopt.ts:resolveAssignments`) refuses
`Rejected <prefix>:<state> — no session in this project matches.` and
`— ambiguous, matches <n> sessions.`

Without `--apply` or non-interactive: `Dry-run — nothing is written by this command.`
plus per-session `would adopt` lines (naming the source: verdict-derived or your
assignment), a `needs a state from you` block that ends with the syntax reminder
`assign inline: /scrub:adopt --apply <id>:pausa|abierto|espera|traspaso|hecho […]`
— a reminder, never a filled-in batch — plus `no readable text after the prefix`
and `already adopted, untouched` lines (REQ-11). With `--apply`: settled targets
get one summary confirm (`Adopt <n> session(s)?`, naming the backup dir), fresh
targets get one per-item confirm carrying `adopt.ts:freshnessWarning` — elapsed
time, interleaving warning, backup path; there is no flag to skip it. Writes go
through `index.ts:appendNameToOther` (NM-08 stack). Result:
`adopted <n> of <m>; … declined [ids]; … error [ids]; backups in <dir>.`

### `/scrub:handoff` — create the continuation (NB-04)

`index.ts:handleScrubHandoff`, a command because `ctx.newSession` exists only on
the command context. Plans both names with `handoff.ts:planHandoffNames`: the next
step comes from the argument text, falling back to the origin name's text; none →
refusal `"scrub:handoff: this session names no next step to carry. Name it first
with /name using a state prefix, or pass the next step as an argument."` and no
session is created. The **destination is created, seeded and named first**, and only
then is the origin renamed `traspaso: <abbr> · <next>` — by path, through
`index.ts:appendNameToOther` (the NB-08 stack) with the new session as the live path
to refuse, because after the switch the origin is not the live session and
`pi.setSessionName` would name the child. The promise is therefore the **last write**:
a cancelled `newSession` writes nothing, and a failed origin write is reported as a
warning naming the fix instead of counting as success. The destination is always
`pausa: desde <abbr> · <next>` — copying the origin state forward would contradict
the exclusivity of the five states. `<abbr>` is the origin's minimal-unique
abbreviation over the project's
sessions plus the live one (`ids.ts:uniqueAbbreviations`, the NB-06 rule reused
by NB-10), never a fixed slice: measured, two handoffs four seconds apart shared
their first eight characters, so a fixed slice pointed the child's marker at the
child itself. When the origin already carries an inherited head it is re-emitted,
not rebuilt: a middle session becomes `traspaso: desde <parent> · <abbr> · <next>`
(NB-14), so it keeps the link upward while becoming the anchor its own child will
reference — without the re-emission, the parent vanished from the picker the
moment the middle session handed off. A leading lineage marker is stripped (`handoff.ts:stripLineage`) so a
chain stays one line. The destination is seeded with one `session-scrub/handoff`
custom message (`display: false`) built by `handoff.ts:buildHandoffMessage`,
carrying pointers only: origin short id, origin name, next step, and — when the
session's own entries contain one — the last memory write
(`handoff.ts:findLastMemoryWrite` over `MEMORY_WRITE_TOOLS`; reads never count) as
topic key and title. The conversation never travels and no observation id appears
(tool results are not persisted; the topic key is durable). Cancellation reports
`"scrub:handoff: cancelled, no new session was created."` — and, because the promise
is written last, that sentence is true about the origin too: it was left as it was.

### `scrub_mark` — record a verdict (REQ-04, NB-02)

`index.ts:handleScrubMark`. TypeBox schema over the five verdicts plus optional
`reason`. Refusals, all as normal tool results: invalid verdict →
`"Invalid verdict. Use one of: keep, paused, finished, ephemeral, trash."`; a
session whose name already declares a state →
`This session already declares its state as "<name>". The name is the record; use
scrub_close to change it. Nothing was written.` (NB-02: writing a record that
cannot take effect is refused, not written; the policy block says so in its
PRECEDENCE section, so a refused mark reads as nothing-to-do rather than a
failure); no live session file →
`"No live session file; verdict not recorded."`. Write: `pi.appendEntry` with
`version: 1` and an ISO `at` — memory and disk together. No read-before-write and
no update-in-place: every call appends, later `at` wins on read. Failures report
`Could not record verdict: <message>` and never throw. Only the current session
can be marked.

### `scrub_close` — name this session (NB-01, NB-03)

`index.ts:handleScrubClose`. Takes `{ state, text }` over `CLOSE_STATES` — the four
states whose meaning is a fact about *this* session: `pausa`, `abierto`, `espera`,
`hecho` (`name.ts:CLOSE_STATES`; `doccheck.test.ts` pins the constant and the schema
that is built from it). `traspaso` is deliberately absent: it asserts a continuation
in another session, and only `/scrub:handoff` can know that, because only the handoff
creates it (NB-04) — while a handoff is pending, the honest word is `pausa:`. `/name`
and `/scrub:adopt` still write `traspaso:`: a human's intention and a migration of the
past, never the extension asserting an outcome. Writes the name with the same call
`/name` makes (`pi.setSessionName`), so memory and disk update together. Failure reports
`Could not set the session name: <message>`. Success reports
`Session name set: <name>`. The name is composed by `name.ts:closeName`, which
keeps the lineage head the current name already carries — **whole**, both tokens
(`desde <parent> · <self> ·`, NB-16) — and replaces only the free text; the head is
the only thing in the picker that says where the work came from and where it
continues, and rewriting the whole text erased it (NB-11, measured on the session
that reported it). A rename never invents a token, a head-shaped start on the
incoming text is stripped instead of stacked so a name never carries two heads
(NB-13), and the `MAX_TEXT` budget applies to the text, never to the head. The tool description carries the redirect
(while a handoff is pending, close as `pausa:` and tell the user to run
`/scrub:handoff`) and the guidance that the closing memory's
title states the block's state. Annotations: `readOnlyHint: false`,
`destructiveHint: true`, `idempotentHint: true`, `openWorldHint: false`.

### The rendered lines — one line, inside the frame

`render.ts` owns every line this extension hands to Pi's TUI: the two tool call previews
(`render.ts:renderMarkCall`, `renderCloseCall`) and the tool result line
(`renderToolResultLine`). All three obey one contract: the visible width, measured in **cells**
under a conservative rule (combining marks 0, ASCII 1, everything else 2), never exceeds the
`width` the host passes to `render(width)`. This is not cosmetic — Pi aborts the whole TUI when a
component returns a line wider than the frame (measured 2026-10-26 on 1.3.0: `Rendered line 39
exceeds terminal width (283 > 140)`).

Degradation is ordered so the line keeps saying what was called: a result body is collapsed to one
line and truncated by `RESULT_MAX` and the frame; a call preview is shortened, then dropped, and
only then is the head (tool name plus state) cut with the ellipsis. `PREVIEW_MAX` (60 cells) is a
content budget that only applies while the frame allows it. Nothing is ever padded, and no renderer
returns more than one line.

### The passive naming-hint hooks (REQ-09, hint clause intact)

`agent_start` → `index.ts:handleAgentStart` (user texts of the live entries),
`agent_end` → `index.ts:handleAgentEnd` (agent message texts); both delegate to
`index.ts:maybeOfferHint`. Trigger conditions, all required and checked in order:
not already in the in-process `hintedSessions` set; no session name yet; no
existing `session-scrub/name-hint` entry (the persistent once-per-session gate —
finding one also records the session id in the in-process set); and
`index.ts:deriveSlug` yields a non-empty slug from the first user text
(lowercase → NFKD → strip combining diacritics → non-`[a-z0-9]` to `-` → trim →
slice 60). Action: one status line under `STATUS_KEY` — `suggested: /name <slug>` —
the in-process set records the id, and the `session-scrub/name-hint` entry is
appended when a live file exists. Nothing else: no naming API, no verdict write,
no prompt, no block, no LLM-context injection; the whole body is wrapped so a
throw can never break the session, the return value being the only signal and no
caller using it.

### Verdict and policy semantics (cross-cutting)

The five verdicts, their class kinds and candidate reasons are Layer A constants.
`name.ts:verdictFromState` derives `paused`/`keep`/`finished` from the states and
never `ephemeral`/`trash` (NB-02). Ephemeral matching (`index.ts:matchesEphemeralFlow`,
`index.ts:matchedEphemeralFlow`) is an exact `/skill:<flow>` token match over
joined user texts — regex metacharacters escaped, no substring or fuzzy matching
(REQ-02). POLICY parse failures never surface: they collapse to an empty flow list.
The trash/recovery rename path and its failure modes are described in the
`/scrub:apply` and `/scrub:restore` contracts (REQ-10): rename-only, reversible,
no permanent delete, no OS trash, trash collisions overwrite, restore never does.

---

## Spec vs code drift (pointer)

The canonical spec `openspec/specs/session-scrub/spec.md` was reconciled on
**2026-10-26**: Slice 4 (NB-01…NB-09) was appended, REQ-01 was modified (verdict
precedence and conversation-turn floor governed by NB-07), and REQ-09 was
superseded in part (programmatic naming is now specified by NB-03/NB-04). This
document therefore no longer judges requirements; the list of accepted deviations
lives in the canonical spec (`## Verified deviations (ACCEPTED)` and the
per-slice deviation lists). Of the items this section once tabled, the two README
defects — the deferred line and the ambiguous duplicate rule — were fixed in
commit `edabe3b`, and the trash-tree claim was disproved rather than fixed: the
README's rendering agrees with `sessionfs.ts:getTrashDir`. Historical notes are in
Layer C.

---

## Layer C — Exceptions, evidence and history

Each item is labelled with its date and its evidence source. This is the only
layer with `path:line` citations, and only inside dated evidence blocks.

### Accepted deviations (owner-accepted; normative list in the canonical spec)

- **Interactive gate is `mode === "tui" && hasUI`** — Pi can report `hasUI === true`
  in RPC mode, but an unattended caller cannot answer a dialog; every non-TUI mode
  degrades to dry-run and never blocks (REQ-11). Accepted in the Slice-1 verify
  report; visible in `index.ts:isInteractive`.
- **`moveToTrash` can silently overwrite on a trash-name collision** —
  `renameSync` with no `existsSync` guard outbound, while restore guards inbound
  (`sessionfs.ts:moveFromTrash`). Recorded 2026-10-08 with the v0.3.0 snapshot; never
  changed.
- **`/scrub:restore` parses no flag, so `--dry-run` in the TUI is a no-op** —
  an as-built asymmetry with `/scrub:apply`, recorded 2026-10-08; neither the spec
  nor the README claims the flag exists for this command.
- **`asVerdictData` requires a numeric `version` but not `version === 1`** — a
  future `version: 2` entry would be read as-is; and `reason` is write-only on
  read. Recorded 2026-10-08.
- **`--apply` and `--dry-run` are substring tests on `/scrub:triage`** — any
  argument string containing the text selects the mode, including inside a quoted
  reason. Recorded 2026-10-08, still true; flag tokens are stripped by
  `index.ts:cleanTriageArgs` before grammar parsing, so they never leak into
  assignment tokens.

### Dated measurements

**2026-10-07 — 75-session population sweep** (read-only sweep of both homes,
`~/.pi/agent/sessions` 57 + `~/.gentle-shell/agent/sessions` 18; reported by the
delegator, not re-run here). Observed population evidence, not guarantees:
0 malformed lines across all 75 files, so the `catch → []` branches remain
unvalidated by observation; size is a bad discriminator (7-line sessions weigh
99–116 KB because of a fixed ~90–110 KB system preamble, and no code path reads
file size); user+assistant turn count separates cleanly (trivial sessions 2–4
turns, real work ≥ 6); only 1 of 75 sessions had mtime < 120 s at scan time;
sessions live in per-cwd subdirectories named `--<cwd with / → ->--`. Grounding
for `MIN_CONVERSATION_TURNS` (NB-07): `messageCount` counted tool results too and
inflated by roughly 1.8× (2→3, 6→7, 778→1479), so a floor on it would have
protected throwaway sessions (`openspec/specs/session-scrub/spec.md:788`).

**2026-10-18 — first live read pass, `_scrub-fixture` bench** (commit `1840e6b`;
record in `odd/tasks/live-measurement-fixture.md` L4–L5). Nine populations
produced headless and verified; the owner then ran `/scrub:audit` and
`/scrub:triage` live. Result: seven of nine populations behaved as the bench
documented; two of the bench's own expectations were wrong and the extension was
right — a fresh unnamed 2-turn session with content is
`kept has-content-no-verdict` (candidacy requires a signal: `trash`, `finished`,
ephemeral, empty, or ≥ 7 days), pinned by `classify.test.ts`. Observed: all eight
ids shared the prefix `01a14ce0`, exercising `ids.ts:uniqueAbbreviations` for
real; `scrub_mark` ran through Pi's real headless pipeline; the
`session-scrub/name-hint` entry appeared uniformly; Pi kept `/skill:fixture-tag`
literal in the saved user text, exercising the policy flow match as designed.

**2026-10-18 — second read pass** (same record, L6): three of three checks PASS,
and the mechanism of `modified` was pinned down — the audit's `review` line reads
the session's `modified`, not the file mtime.

**2026-10-22 — first live write pass, `_scrub-fixture` bench** (record in
`odd/tasks/write-path-fixture.md` L7–L8; baseline re-frozen with a `sha256` table
and a `cp -a` rollback copy before touching anything). Two disposable sessions,
one fresh and one settled (`touch -d '10 minutes ago'`), then
`/scrub:adopt --apply` from the owner's live session. Verdicts:

- O1 PASS — the settled target folded into one summary prompt (`Adopt 1 session?`),
  the fresh target got its own prompt; two distinct confirmation shapes from one
  command (`index.ts:handleScrubAdopt` fresh/settled split).
- O2 PASS — the fresh prompt carried `written 1 min 6 s ago — if that session is
  live in another terminal, this write can interleave with Pi's own flush.` plus
  the exact backup path and `There is no flag to skip this; waiting is the only
  bypass.`; the settled prompt carried none. The measured age pins the freshness
  input to mtime (`sessionfs.ts:freshnessOf` → `statSync().mtimeMs`), not
  `message.timestamp`.
- O3 PASS — exactly one line appended per target (7 → 8), one new `session_info`
  (1 → 2), human text preserved; final notice `adopted 2 of 2; 8 still need a
  state; backups in …`.
- O4 PASS — one backup copy per target under `session-scrub-backups/<project>/`,
  each an exact byte-prefix of the written file (`cmp`-verified pre-write bytes).
- O5 PASS — 9/9 populations matched the frozen `sha256` table with mtimes intact;
  trash and backups gained nothing outside the two disposables.
- O6 not observable — no live row was rendered because the measuring session had
  no message yet, so Pi had no file for it (`session-manager.js:786`) and
  `getSessionFile()` never resolved; a limit of the observable, not a failure.
- O7 PASS — trash/restore measured in a disposable probe project: file gone from
  the sessions dir, present under `session-scrub-trash/` with `sha256` identical
  to the original and its original mtime preserved (`rename`, not copy-and-rewrite);
  restore returned it `cmp`-identical; `/scrub:apply` created no backup, which is
  correct for a move (`sessionfs.ts:moveToTrash`).

Restoration proof: after cleanup, `diff -r` between the bench sessions dir and the
rollback copy was empty — same 9 files, same bytes, same mtimes; `/tmp` scratch
removed.

### UNVERIFIED (carried from the v0.3.0 snapshot, 2026-10-08)

1. The on-disk shape of `getSessionDir()` and the `--<cwd>--` per-project naming
   convention — a Pi API contract, not code-verifiable in this repo; reported as
   observed layout by the 2026-10-07 sweep.
2. `SessionManager.list(ctx.cwd)` filtering, sorting and live-session inclusion
   semantics — Pi-internal; the code synthesizes the live row when absent, which
   implies the API may or may not include it.
3. The `.jsonl` session filename convention, beyond the extension's own
   `f.endsWith(".jsonl")` filter.
4. How Pi persists a session name and the on-disk encoding `appendSessionInfo`
   produces — the extension writes through the API and never inspects the encoding.
5. That custom entries are excluded from LLM context — the design assumes it
   ("zero tokens by default") and never relies on it in code, but the guarantee
   belongs to Pi.
6. The runtime behavior of `ctx.ui.notify`, `ctx.ui.confirm` and `ctx.ui.setStatus`
   beyond how this extension calls them (e.g. which non-TUI `mode` strings exist).
7. The negative claims (no `unlink`/`rm`/`spawnSync`/OS-trash call) are verified
   for this source tree by grep, as source text — not a runtime guarantee.
8. The 2026-10-07 population sweep — reported, not re-measured here.

### History worth keeping

- **2026-10-08 (v0.3.0 snapshot):** the doc was first written against
  `index.ts` @ `c34b1d6` with every claim cited by line. The naming capability the
  snapshot called unimplemented shipped afterwards: the naming convention and
  `scrub_close`/`/scrub:handoff` (source change `openspec/changes/session-scrub-naming/`,
  reconciled into the canonical spec 2026-10-26), `/scrub:adopt` with per-file
  backup and mtime guard, and the classifier reordering (NM-04 verdict precedence,
  NM-05 conversation-turn floor) with the predicate extracted to `classify.ts`.
  The old boundary section §12 is superseded by the Layer A/B descriptions above,
  not deferred.
- **2026-10-22 — §11 drift items, disposition.** The old §11 table compared the
  pre-reconciliation spec to the code and let the code win: trash-path depth (two
  levels up, not one), `moveToTrash`/`moveFromTrash`/`classifySession`/
  `matchesEphemeralFlow` signatures, phase-1 page ordering (WEAK-first per
  UX-01/UX-06, superseding TR-02's named-first), and the `/scrub:restore` flag
  asymmetry (kept as a Layer B contract note). The 2026-10-26 spec reconciliation
  absorbed every one of these into the canonical spec, so the table is not carried
  forward.
- **2026-10-26 — README alignment (`edabe3b`).** The README's deferred line now
  reads as the code emits it (`deferred (<N>): <ids>`) and separates the two
  senses of "duplicate": the same slug may name several sessions, while a repeated
  id prefix in one command line is rejected as `duplicate assignment`. The
  README's trash-tree rendering was checked against `sessionfs.ts:getTrashDir`
  and agreed — the claimed defect did not exist.

---

## Manual test scenarios

Numbered manual index, shared with the canonical spec (no automated harness for
these yet; the automated suites are `*.test.ts`, including `doccheck.test.ts`).
Slices 1–4 lists all still apply, in sequence.

**Slice 1 (T1…T12):**

1. **T1 clean boot:** `pi -e ./extensions/session-scrub/index.ts` starts with no errors; `/reload` succeeds.
2. **T2 audit truth:** seed named/unnamed/empty/old sessions; `/scrub` classifications match REQ-01; counts reconcile with `/resume` (live shown as live).
3. **T3 dry-run:** `/scrub:apply --dry-run` lists exactly the actionable set with detail; filesystem file-set identical, no trash dir created.
4. **T4 apply:** TUI per-item confirm 1–2 candidates → files appear in the extension's trash sibling dir; re-list count drops accordingly.
5. **T5 restore:** `/scrub:restore` lists trashed; confirm one → file returns to sessions dir with verdict preserved; `/scrub` shows it again; trash empty.
6. **T6 EXDEV honesty:** by inspection + throwing rename path — per-file error notified; source intact; no fallback copy/unlink (no destructive path exists in code).
7. **T7 non-TUI:** `pi --print` (and `--json`) `/scrub:apply` and `/scrub:restore` complete with notify-only output, exit 0; no hang.
8. **T8 hint once:** fresh unnamed session shows the hint line once; second trigger silent; slug matches `index.ts:deriveSlug` rules; gate entry `{ version: 1, slug, offeredAt }` on disk.
9. **T9 silent close:** session shutdown produces no keep-vs-trash prompt (no `session_shutdown` handler in source).
10. **T10 init idempotent:** `/scrub:init` writes delimited block; rerun notifies "already exists" with no duplication.
11. **T11 verdict round-trip:** invoke `scrub_mark({ verdict: "finished", reason: "PR merged" })`; entry readable via `getEntries()` with `version: 1`; `/scrub` shows candidate/finished; invalid verdict → tool error, nothing written.
12. **T12 strict + gates:** typecheck passes, zero `any`, zero `session_shutdown`, zero destructive strings, esbuild bundle clean.

**Slice 2 (TT1…TT12, triage):**

1. TT1 clean boot · 2. TT2 digest truth (3 packs + 2 counted skips, live absent) · 3. TT3 bounds + deferral (cap `index.ts:MAX_DIGEST_SESSIONS`, `…` marks) · 4. TT4 WEAK labels (`index.ts:suggestTriageWeak`, TR-04) · 5. TT5 phase-1 invariance (file-set identical, no trash dir, `--dry-run` byte-identical, TR-07) · 6. TT6 reason-mandatory (TR-08) · 7. TT7 stale/ambiguous (`index.ts:handleScrubTriagePhase2` rejections, TR-09) · 8. TT8 confirmed write (verbatim reason round-trip via `index.ts:appendVerdictToOther`, TR-10) · 9. TT9 race recheck (idempotent-skip) · 10. TT10 post-triage reconcile (`Nothing to triage.` + `/scrub` reflects) · 11. TT11 non-TUI (`pi --print` both phases notify-only, exit 0, no hang, TR-11) · 12. TT12 strict + gates (typecheck clean, zero `any`, zero new lifecycle/unlink; budget `size:exception` accepted at commit time).

**Slice 3 (TU1…TU8, triage UX):**

1. TU1 WEAK-first page (WEAK first, cap 20; deferred lists machine shortIds only, UX-01). 2. TU2 compact default schema (machine one-liners via `render.ts:formatCompactRow` + WEAK packs, zero machine full packs, UX-02). 3. TU3 verbose (adds machine packs, table always present, UX-02). 4. TU4 bulk machine round-trip (reasonless keeps → ONE confirm → verbatim `index.ts:bulkKeepRationale` per file, append-only, UX-03). 5. TU5 WEAK reason-mandatory (reasonless WEAK rejected zero-write, UX-04). 6. TU6 rename round-trip (round-trips to `/resume`; `:name:"   "` rejected zero-write; confirm shows existing name, UX-05). 7. TU7 deferred transparency (every candidate paged or listed, nothing dropped, UX-06). 8. TU8 invariants (stale/ambiguous pre-confirm reject, trash rejected, reasonless-unknown rejected, live absent, non-TUI notify-only zero-write, race skip-warning zero overwrite, dry-run previews zero-write, UX-07).

**Slice 4 (NS1…NS8, in a live Pi host):**

1. **NS1 close and read** — `scrub_close` sets `hecho:`/`pausa:` and `/resume` shows it; `scrub_mark` on that session is refused with the pointer (NB-02, NB-03).
2. **NS2 handoff chain** — `/scrub:handoff` twice in a row produces `traspaso: <id8> · …` and `pausa: desde <id8> · …`, and the second message does not carry two lineage markers (`handoff.ts:stripLineage`, NB-04).
3. **NS3 memory key** — with a `mem_save` before the handoff, the seeded message names its `topic_key`; with none, the message omits the memory lines instead of inventing one (`handoff.ts:findLastMemoryWrite`).
4. **NS4 adopt dry-run** — `/scrub:adopt` lists would-adopt, needs-state, textless, already-adopted and the refused live session, and writes nothing (`adopt.ts:planAdoption`, NB-05).
5. **NS5 adopt apply** — `--apply` with one verdict-derived and one inline assignment writes both, backups exist, and each file gained exactly one entry (`adopt.ts:verifyAdoption`, NB-08).
6. **NS6 freshness** — a target written 8 seconds ago yields a per-item confirmation naming elapsed time and the backup path; `--force` is refused by name (`adopt.ts:findBypassAttempt`, `adopt.ts:freshnessWarning`, NM-03).
7. **NS7 display ids** — a burst of sessions created together renders distinct `ids.ts:uniqueAbbreviations` in `/scrub`, `/scrub:triage` and `/scrub:restore` (NB-06).
8. **NS8 classification** — `keep` on an empty session keeps it; a high-turn unnamed session is kept; a 3-turn 30-day-old session is `old-needs-confirm` (`classify.ts:classifySession`, NB-07).
