# session-scrub — behavior specification (as-built)

**Status:** as-built documentation, derived from source only.
**Reflects:** released behavior at `v0.3.0` (`3dd6361`). **Refreshed at each tag**, not per commit.
**Source of truth:** `extensions/session-scrub/index.ts` @ `c34b1d6`, 1682 lines.
Every behavioral claim below carries a `path:line` citation to that file. Where a
claim could not be verified from the source, it is written as
`UNVERIFIED: <what could not be confirmed, and why>`.

> **Unreleased changes are not reflected here.** Commits after `3dd6361` change the
> classifier: `6fe1f77` extracted the predicate to `classify.ts`, and `3b0f588` reordered
> it (NM-04 verdict precedence, NM-05 conversation-turn floor). §1 therefore describes the
> **previous** decision tree. Against the working tree, an explicit `keep`/`paused`
> verdict now protects an old or empty unnamed session, and an unnamed session with 5 or
> more conversation turns is never a deletion candidate for being unnamed. This document
> is corrected at the next tag.

Rules used to produce this document:

- The code wins over `openspec/specs/session-scrub/spec.md`, over `README.md`, and
  over prior knowledge. Disagreements are collected in
  [§11 Spec vs code drift](#11-spec-vs-code-drift).
- Nothing here is inferred from the naming feature, which is **not implemented**
  (see [§12 Not implemented yet](#12-not-implemented-yet)).
- The 75-session population sweep (2026-10-07) is used only as **observed population
  evidence**, labelled as such in [§13](#13-observed-population-evidence-not-guarantees).
  It is not a guarantee about any future run.

Line-number anchors re-derived from the file during this write:
`MAX_AGE_MS`:33 · `VERDICTS`:35 · `CLASS_KIND`:44 · `CANDIDATE_REASON`:53 ·
`VERDICT_CUSTOM_TYPE`:62 · `HINT_CUSTOM_TYPE`:63 · `POLICY_START`:64 ·
`POLICY_END`:65 · `STATUS_KEY`:66 · `POLICY_TEMPLATE`:68 · `classifySession`:226 ·
`samePath`:217 · `deriveSlug`:200 · `parsePolicyBlock`:292 · `isInteractive`:317 ·
`resolveDryRun`:321 · `formatAuditLine`:325 · `openSessionEntries`:380 ·
`readLatestVerdict`:388 · `hasCustomType`:401 · `readPolicyConfig`:408 ·
`getTrashDir`:424 · `moveToTrash`:432 · `moveFromTrash`:439 · `listTrash`:449 ·
`auditSessions`:467 · `handleScrub`:537 · `isActionable`:544 ·
`handleScrubApply`:552 · `handleScrubRestore`:590 · `handleScrubInit`:622 ·
`ScrubMarkParams`:644 · `handleScrubMark`:662 · `hintedSessions`:687 ·
`maybeOfferHint`:690 · `TRIAGE_VERDICT`:748 · `TRIAGE_GRADE`:756 ·
`HEAD_DIGEST_CHARS`:763 · `TAIL_DIGEST_CHARS`:764 · `MAX_DIGEST_SESSIONS`:765 ·
`buildDigestPack`:894 · `suggestTriageWeak`:943 · `matchedEphemeralFlow`:966 ·
`ASSIGN_RE`:979 · `RENAME_RE`:980 · `LOOSE_ASSIGN_RE`:981 · `cleanTriageArgs`:984 ·
`parseTriageInput`:997 · `appendVerdictToOther`:1140 · `appendRenameToOther`:1165 ·
`formatDigestPack`:1189 · `partitionTriageCandidates`:1213 · `bulkKeepRationale`:1232 ·
`formatCompactRow`:1238 · `gatherTriageCandidates`:1257 · `shortId`:1300 ·
`handleScrubTriagePhase1`:1304 · `handleScrubTriagePhase2`:1381 ·
`handleScrubTriage`:1610 · default export:1635.

## 0. Registration surface

Five commands and one tool are registered, and nothing else is registered
(`export default function (pi: ExtensionAPI)` at
`extensions/session-scrub/index.ts:1635-1682`):

Each registration is quoted with its literal command name and description; the
handler definitions are cited in their own sections.

| Surface | Registration |
| --- | --- |
| `/scrub` | `pi.registerCommand("scrub"` — `Audit this project's sessions (read-only)` — `index.ts:1636` — handler `handleScrub` |
| `/scrub-apply` | `pi.registerCommand("scrub-apply"` — `Trash actionable sessions` (dry-run first, reversible via `/scrub-restore`) — `index.ts:1642` — handler `handleScrubApply` |
| `/scrub-restore` | `pi.registerCommand("scrub-restore"` — `Restore trashed sessions for this project` — `index.ts:1648` — handler `handleScrubRestore` |
| `/scrub-init` | `pi.registerCommand("scrub-init"` — `Write the opt-in session-scrub policy block into AGENTS` — `index.ts:1654` — handler `handleScrubInit` |
| `/scrub-triage` | `pi.registerCommand("scrub-triage"` — `Assisted triage of verdict-less sessions (digests, then confirmed writes)` — `index.ts:1660` — handler `handleScrubTriage` |
| `scrub_mark` tool | `pi.registerTool({` — `name: "scrub_mark"` — `index.ts:1666` — handler `handleScrubMark` |
| `agent_start` hook | `pi.on("agent_start"` — `index.ts:1676` — handler `handleAgentStart` |
| `agent_end` hook | `pi.on("agent_end"` — `index.ts:1679` — handler `handleAgentEnd` |

No `session_start` / `session_shutdown` handler is registered; the absence is
stated as intentional in the source comment (`Deliberately absent` `index.ts:1632`).
Consequently
nothing in the plugin runs without a command invocation or an agent
start/end event, and closing a session never prompts.

## 1. `/scrub` — read-only audit

**Handler** `handleScrub` (`index.ts:537-542`). It takes `args` and immediately
discards it with `void args` (`index.ts:538`), so **no flag is parsed at all** —
`/scrub --dry-run`, `/scrub --json`, `/scrub anything` all behave identically.

**Data acquisition.** `auditSessions` (`index.ts:467-523`):

1. Reads the policy block for `ctx.cwd` (`index.ts:471` → `readPolicyConfig` `index.ts:408`).
2. Captures the live identity as a `LiveIdentity` object holding `path` and `id`
   (`const live: LiveIdentity = {` `index.ts:472-475`).
3. Lists sessions with `SessionManager.list(ctx.cwd)` (`index.ts:476`).
4. For each listed session, decides liveness by resolved-path equality **or** id
   equality (`index.ts:478-480` → `samePath` `index.ts:217-224`, which uses
   `realpathSync` and falls back to `false` on any throw, `index.ts:219-223`).
5. The live session is read through `ctx.sessionManager.getEntries()` and never
   opened from disk (`index.ts:481-483`); every other session is read via
   `openSessionEntries` (`index.ts:380-386`).
6. Verdict = latest `session-scrub/verdict` entry by `at` (`index.ts:484` → `readLatestVerdict` `index.ts:388-399`).
7. Ephemeral flow match is computed over the joined **user-message texts**
   (`index.ts:485-487`), and is skipped entirely when the verdict is `trash`
   (`index.ts:486`).
8. If the live id is defined but no listed session classified as `live`, a
   synthetic live `SessionInfo` is **unshifted to the front** of the audited list
   (`audited.unshift({` `index.ts:508-512`).
   That synthetic record reports `created`/`modified` as
   `now` (`const now = new Date()` `index.ts:496`),
   and `messageCount` as
   **`liveEntries.length`, i.e. entry count, not message count**
   (`messageCount: liveEntries.length` `index.ts:504`) —
   the only place in the file where the two are conflated.

**Classification** is `classifySession` (`index.ts:226-289`), evaluated in this
exact order:

| # | Condition | Result |
| --- | --- | --- |
| 1 | resolved path equals live path, or id equals live id (`live.path !== undefined`) | `live` (`index.ts:232-237`) |
| 2 | `name` non-blank **and** verdict `trash` (`VERDICTS.trash`) | `candidate` / `explicit-trash` (`index.ts:239-245`) |
| 3 | `name` non-blank (any other verdict, incl. none) (`CLASS_KIND.namedProtected`) | `named-protected` (`index.ts:246`) |
| 4 | verdict `trash` | `candidate` / `explicit-trash` (`index.ts:248-253`) |
| 5 | verdict `finished` (`VERDICTS.finished`) | `candidate` / `finished` (`index.ts:255-261`) |
| 6 | verdict `ephemeral` **or** ephemeral-flow match (`VERDICTS.ephemeral`) | `candidate` / `ephemeral` (`index.ts:262-268`) |
| 7 | `messageCount === 0` (`CANDIDATE_REASON.empty`) | `auto-deletable` / `empty` (`index.ts:269-271`) |
| 8 | `Date.now() - s.created.getTime() >= MAX_AGE_MS` (7 days) (`CLASS_KIND.oldNeedsConfirm`) | `old-needs-confirm` with full detail (`index.ts:273-284`) |
| 9 | any verdict present (`CLASS_KIND.kept`) | `kept` / `has-verdict-<v>` (`index.ts:285-287`) |
| 10 | fallback | `kept` / `has-content-no-verdict` (`index.ts:288`) |

Consequences that follow directly from that order and are worth stating:

- A **named, empty** session is `named-protected`, never `auto-deletable`
  (row 3 precedes row 7).
- A **named, older than 7 days** session is `named-protected`, never
  `old-needs-confirm` (row 3 precedes row 8).
- `keep` and `paused` are terminal: an unnamed session with either verdict can
  still reach row 7 (`auto-deletable`) or row 8 (`old-needs-confirm`), because
  neither verdict is short-circuited before the empty/age checks. This is a
  direct consequence of `s.messageCount === 0` (`index.ts:269`) and
  `Date.now() - s.created.getTime() >= MAX_AGE_MS` (`index.ts:272`) and is
  **not** guarded elsewhere.

**Output.** A single `ctx.ui.notify(lines.join("\n"), "info")` (`index.ts:541`)
containing `summaryLine` (`index.ts:525-531`),
followed by one `formatAuditLine` (`index.ts:325-345`) per session.
Per-kind line formats:

- `live <id8> (current session, unsaved, never touched)` when
  `info.path === ""`, else `live <id8> (current session, never touched)`
  (`case CLASS_KIND.live` `index.ts:328-331`).
- `kept <id8> named "<name>"` (`case CLASS_KIND.namedProtected` `index.ts:332-333`).
- `auto <id8> empty` (`case CLASS_KIND.autoDeletable` `index.ts:334-335`).
- `trash-candidate <id8> reason=<reason>`
  (`trash-candidate ${short} reason` `index.ts:337`).
- `review <id8> msgs=<n> modified=<ISO> first="<first 60 chars>"`
  (`case CLASS_KIND.oldNeedsConfirm` `index.ts:338-341`).
- `kept <id8> <reason>` (`case CLASS_KIND.kept` `index.ts:342-343`).

`id8` is always `info.id.slice(0, 8)` (`index.ts:326`).

**Idempotency.** Fully idempotent and side-effect free: `/scrub` performs no
write, no `mkdirSync`, no `confirm`, and no trash-dir creation anywhere in
`async function handleScrub` (`index.ts:537-542`). Running it twice produces
byte-identical output apart from the synthetic live record's `now` timestamps
(`const now = new Date()` `index.ts:496`),
`created: now` (`index.ts:502`) and `modified: now` (`index.ts:503`).

**Error / edge paths.**

- A session file that cannot be parsed or opened yields `[]` and no throw
  (`openSessionEntries` `index.ts:380-386`), so a malformed session silently
  classifies as if it had no verdict and no user text.
- Malformed verdict entries are skipped by `asVerdictData` (`index.ts:178-185`):
  non-object, non-numeric `version`, non-verdict `verdict`, or non-string `at`
  all return `undefined`, and the entry is ignored (`asVerdictData(c.data)`
  `index.ts:394-395`).
- A verdict with a well-formed body but a `reason` of any type still counts:
  `asVerdictData` does not copy `reason` into the returned object at all
  (`return { version: d.version, verdict: d.verdict, at: d.at }` `index.ts:184`
  returns only `version`, `verdict`, `at`), so `reason` is
  write-only on read.
- **Verdict ordering is lexicographic on the ISO string, not numeric** —
  `v.at > latest.at` (`index.ts:396`). This is correct for ISO-8601 UTC strings
  from `toISOString()` (`index.ts:677`, `index.ts:1160`) but will misorder any
  non-ISO `at` value that a foreign writer appends.
- A missing or unreadable `AGENTS.md` degrades to `ephemeralFlows: []`
  (`index.ts:412-414`); the audit then finds no ephemeral candidates.

**Explicitly NOT supported:** no filtering, sorting, pagination, machine-readable
(`--json`) output, per-session detail beyond the single formatted line, no
selection, no mutation, no OS trash, no purge.

## 2. `/scrub-apply` — dispose with consent

**Handler** `handleScrubApply` (`index.ts:552-588`).

**Flags actually parsed.** Exactly one: `--dry-run`. It is detected by a raw
substring test `args.includes("--dry-run")` (`resolveDryRun` `index.ts:321-323`),
so any argument string containing that substring triggers dry-run. No other flag
is read.

**Flow.**

1. Audit — `handleScrubApply` unpacks `audited` and `summary` first
   (`handleScrubApply` `index.ts:552-553`).
2. Filter to `isActionable` (`function isActionable` `index.ts:544-550`): `auto-deletable`, `candidate`,
   and `old-needs-confirm` only. `live`, `named-protected` and `kept` are never
   in scope.
3. If nothing is actionable → `notify` with `"<summary> Nothing to trash."`
   (`actionable.length === 0` `index.ts:555-558`) and return.
4. If `resolveDryRun` → `notify` with `"<summary> Dry-run — nothing moved."`
   plus one `formatAuditLine` per actionable item, and return
   (`resolveDryRun(args, ctx)` `index.ts:559-566`). No confirm, no write.
5. Otherwise compute `trashDir = getTrashDir(ctx.sessionManager.getSessionDir())`
   (`getTrashDir(ctx.sessionManager.getSessionDir())` `index.ts:567`) and loop
   the actionable set **in audit order** (`const a of actionable` `index.ts:569`).
6. Per item: `ctx.ui.confirm` with `"Trash session <id8>?"`, the audit line, the
   detail, and `"Move is reversible via /scrub-restore."`
   (`ctx.ui.confirm(` `index.ts:574-577`).
   For `old-needs-confirm` the detail additionally carries the first 80 chars of
   the first message and the modified ISO timestamp
   (`const detail =` `index.ts:570-573`).
7. On confirm, `moveToTrash(a.info.path, trashDir)` (`index.ts:580`); any throw is
   caught per file and reported as `Skipped ${a.info.id.slice(0, 8)}: <message>`
   at `warning` (`index.ts:582-584`). The loop continues.
8. Re-lists with `SessionManager.list(ctx.cwd)` and reports
   `Trashed ${trashed} sessions. Remaining: ${relisted.length}.` (`index.ts:586-587`).

**Non-TUI (`print` / `json` / `rpc`) behavior.** `resolveDryRun` is true whenever
`!(mode === "tui" && hasUI)` (`isInteractive` `index.ts:317-319`), so every
non-TUI mode takes the `resolveDryRun` branch at `index.ts:559` and only notifies.
The source comment states the reason (`hasUI true in RPC mode too` `index.ts:313-315`):
Pi can report `hasUI === true` in RPC mode, but an
unattended caller cannot answer a dialog. `confirm()` is
therefore unreachable outside `tui` + `hasUI`. No `--force` flag exists and no
code path skips the confirm loop.

**Idempotency.** A second run re-audits. Sessions moved to trash no longer appear
in `SessionManager.list(ctx.cwd)`, so they are neither re-offered nor
double-moved; with nothing left actionable the run terminates at
`actionable.length === 0` (`index.ts:555-558`) with `Nothing to trash.`
If the whole set was declined the counter never increments
(`let trashed = 0` `index.ts:568`) and the run still reports
`Trashed ${trashed} sessions. Remaining: ${relisted.length}.` (`index.ts:587`).

**Error / edge paths.**

- Per-file `try/catch` means one failure never aborts the loop
  (`moveToTrash(a.info.path, trashDir)` `index.ts:579-584`).
- A session whose file disappeared between audit and move produces a throw from
  `renameSync` and is reported as `Skipped`, not fatal.
- **`moveToTrash` can silently overwrite.** It computes the destination with
  `const trashPath = join(trashDir` (`index.ts:434`) and calls
  `renameSync` with no `existsSync` guard (`function moveToTrash`
  `index.ts:432-437`). The inbound helper guards first with
  `existsSync(restoredPath)` (`index.ts:442-444`). Trash collisions therefore
  clobber.
- `old-needs-confirm` sessions are actionable and are trashed on confirm with no
  separate second gate beyond the single `confirm` (`function isActionable`
  `index.ts:544-550`).
- The live session can never be in `actionable` (row 1 of `classifySession`
  precedes everything, `live.path !== undefined` `index.ts:232-237`).

**Explicitly NOT supported:** no `--force`, no `--yes`, no bulk multi-select
picker, no `--json`, no dry-run-by-flag bypass of the confirm loop, no permanent
deletion, no per-file trash destination override.

## 3. `/scrub-restore` — restore from trash

**Handler** `handleScrubRestore` (`index.ts:590-620`).

**Flags actually parsed: none.** `void args` (`index.ts:591`) discards the whole
argument string. There is no `--dry-run` handling: the non-TUI guard is a direct
`!isInteractive(ctx)` check (`index.ts:598`), not `resolveDryRun`. Consequently
**in the TUI, `/scrub-restore --dry-run` restores for real** — the flag is
silently ignored. This is a real as-built behavior, not a spec intention.

**Flow.**

1. `sessionsDir = ctx.sessionManager.getSessionDir()` (`index.ts:592`).
2. `listTrash(getTrashDir(sessionsDir))` (`index.ts:593`) — only `*.jsonl`
   entries are listed (`f.endsWith(".jsonl")` `index.ts:451-453`),
   and any read failure yields `[]` (`return [];` `index.ts:454-456`).
3. Empty → `notify("No trashed sessions for this project.", "info")`, return
   (`index.ts:594-597`). This message is also what a missing trash dir produces,
   because `listTrash` swallows the error.
4. Non-TUI → `notify` with `"Dry-run — nothing restored:\n<basenames>"`,
   (`!isInteractive(ctx)` `index.ts:598-604`) return. No confirm, no write.
5. TUI → per file, `ctx.ui.confirm` with
   `"Restore session <basename-without-.jsonl, first 8>?"` and
   `"Moves the session file back so /resume shows it again."`
   (`ctx.ui.confirm(` `index.ts:607-610`),
   then `moveFromTrash` (`index.ts:613`) inside try/catch; a throw reports
   `Skipped ${basename(p)}: ${errorMessage(err)}` at `warning`
   (`ctx.ui.notify(` `index.ts:616-617`) and the loop continues.
6. `notify` with `Restored ${restored} sessions.` at `info`
   (`index.ts:619`).

**Idempotency.** Restoring removes the file from the trash listing, so a second
run finds it gone. Verdicts are **not** cleared — restoring only renames the file
back, and the verdict custom entries live inside it, so a restored
`trash`-verdicted session immediately classifies as a candidate again on the next
`/scrub`. Nothing in `moveFromTrash` touches file contents (`index.ts:439-447`).

**Error / edge paths.**

- **Never overwrites.** `moveFromTrash` checks `existsSync(restoredPath)` and
  throws `restore target already exists: <path>` (`index.ts:442-444`); the caller
  converts that into a per-file `Skipped` warning
  (`ctx.ui.notify(` `index.ts:616-617`).
- `mkdirSync(sessionsDir, {recursive: true})` runs before the existence check
  (`function moveFromTrash` `index.ts:440`), so a missing sessions dir is created.
- Non-`.jsonl` files in the trash dir are invisible to the command
  (`f.endsWith(".jsonl")` `index.ts:452`).
- Files moved in manually (outside the plugin) that do not end in `.jsonl` are
  invisible.

**Explicitly NOT supported:** no `--all`, no `--yes`, no per-session verdict
clearing, no deletion from trash, no restore across projects (the trash dir is
derived from this project's session dir
(`const sessionsDir = ctx.sessionManager.getSessionDir();` `index.ts:592-593`),
no `--json`.

## 4. `/scrub-init` — write the POLICY block

**Handler** `handleScrubInit` (`index.ts:622-638`). `void args` (`index.ts:623`)
— **no flags are parsed**.

**Target.** `<ctx.cwd>/AGENTS.md` (`const agentsPath = join(ctx.cwd, "AGENTS.md")` `index.ts:624`). This is the only file the
plugin ever writes outside trash and session files.

**Flow.**

1. Read the existing file; any throw (including not-exists) is treated as empty
   (`let existing = "";` `index.ts:625-630`).
2. If the content already contains `POLICY_START` →
   `notify("Policy block already exists.", "info")` and return
   (`existing.includes(POLICY_START)` `index.ts:631-634`).
   **No rewrite, no merge, no update** — the block is
   written at most once per file by this command.
3. Otherwise append. `sep` is `"\n"` only when the existing content is non-empty
   and does not already end with a newline (`const sep =` `index.ts:635`), and
   the payload is `` `${existing}${sep}\n${POLICY_TEMPLATE}` `` (`index.ts:636`) —
   so an existing file always receives at least one blank-line separator.
4. `notify` with the message `"Policy block written to AGENTS.md. Fill ephemeral-flows for this project."` at `info` (`ctx.ui.notify(` `index.ts:637`).

**Idempotency.** Yes: the second run hits the `POLICY_START` guard
(`existing.includes(POLICY_START)` `index.ts:631`) and changes nothing.

**Error / edge paths.**

- The write at `writeFileSync(agentsPath,` `index.ts:636` is **not** wrapped in
  try/catch. A read-only
  `AGENTS.md`, a permission error, or a non-existent `ctx.cwd` will reject out
  of `handleScrubInit`.
- The guard is a plain `String.includes` on the whole file
  (`existing.includes(POLICY_START)` `index.ts:631`), so
  the start marker appearing anywhere — inside prose, a code fence, or a nested
  doc — suppresses the block permanently.
- Only the **first** occurrence of the start marker matters; `POLICY_END` is
  never checked by this handler.
- When `AGENTS.md` did not exist, the file is created containing the template
  with a leading newline (`const sep =` `index.ts:635`, `index.ts:636`).

**Explicitly NOT supported:** no `--force` to rewrite, no removal of a stale
block, no update of `ephemeral-flows` (that is a manual edit), no writing any
other file, no project-root discovery beyond `ctx.cwd`.

## 5. `/scrub-triage` and `--apply`

Entry point `handleScrubTriage` (`index.ts:1610-1626`).

**Flags actually parsed.**

| Token | Detection | Effect |
| --- | --- | --- |
| `--apply` | raw substring `args.includes("--apply")` (`index.ts:1611`) | switches to phase 2; its **absence** selects phase 1 |
| `--verbose` | whitespace-split exact token (`index.ts:1612`; again at `index.ts:1475`) | phase 1: full packs for machine rows; phase 2: extra `msgs`/`age` fragments in dry-run output |
| `--dry-run` | stripped by `cleanTriageArgs` (`index.ts:984-989`); **not** referenced by the phase dispatcher | see the note below |

`--dry-run` deserves a note: `cleanTriageArgs` strips it before grammar parsing
(`function cleanTriageArgs` `index.ts:984-989`), and the phase dispatcher never
reads it. In phase 2 it is only picked up indirectly, because `resolveDryRun`
(`index.ts:321`) is evaluated against the raw args (`resolveDryRun`
`index.ts:1476`). In phase 1 it is a no-op.

Because `--apply` is detected by substring and not by token
(`args.includes("--apply")` `index.ts:1611`), any argument string containing that
text — including inside a
quoted reason — selects phase 2. `cleanTriageArgs` strips the three flag tokens
before grammar parsing (`function cleanTriageArgs` `index.ts:985-989`), so flag
text never leaks into assignment tokens or leftovers.

### 5.1 Candidate gathering (shared by both phases)

`gatherTriageCandidates` (`index.ts:1257-1298`):

- Re-reads policy and live identity (`const live: LiveIdentity = {` `index.ts:1263-1266`),
  re-lists with
  `SessionManager.list(ctx.cwd)` (`index.ts:1267`).
- **Excludes the live session** by resolved path or id (`const isLive =` `index.ts:1272-1274`).
- **Excludes any session with a verdict** — `readLatestVerdict(entries) !== undefined`
  skips it (`index.ts:1277`). A verdict is therefore terminal for
  triage: it never reappears in a later triage set.
- Counts and skips `messageCount === 0` as `emptySkipped` (`index.ts:1278-1281`).
- Counts and skips ephemeral-flow matches as `ephemeralSkipped`
  (`index.ts:1282-1286`), using `matchedEphemeralFlow` (`index.ts:966-971`).
  Note this check does **not** carry the `verdict !== trash` guard that
  `auditSessions` applies (`VERDICTS.trash &&` `index.ts:486`); it
  is unreachable for trash-verdicted
  sessions only because line 1277 already skipped them.
- Sort: named-first, then `modified` **ascending**
  (`candidates.sort` `index.ts:1291-1296`). This
  sort is consumed only by phase 2 (which ignores order) and is then reshuffled
  by `partitionTriageCandidates` for phase 1 (`index.ts:1213-1228`).

### 5.2 Phase 1 — read-only digest

`handleScrubTriagePhase1` (`index.ts:1304-1379`).

- Empty candidate set → `notify` with
  `"Nothing to triage. (${emptySkipped} empty skipped, ${ephemeralSkipped} ephemeral already candidates.)"`
  at `info` (`ctx.ui.notify(` `index.ts:1306-1312`) and return.
- Partition: `machineKeeps` = named with non-blank `info.name`; `weakQueue` = the
  rest, sorted `modified` **descending**, via
  (`function partitionTriageCandidates` `index.ts:1213-1228`) and
  (`weakQueue.sort` `index.ts:1226`).
- Page composition is `[...weakQueue, ...machineKeeps]` sliced to
  `MAX_DIGEST_SESSIONS` (`index.ts:1315`, constant at `index.ts:765`); the
  remainder is `deferred` (`index.ts:1316`).

**Digest pack bounds** (`buildDigestPack` `index.ts:894-941`):

| Bound | Value | Line |
| --- | --- | --- |
| head char cap | `HEAD_DIGEST_CHARS = 300` | `index.ts:763` |
| tail char cap | `TAIL_DIGEST_CHARS = 300` | `index.ts:764` |
| max packs per run | `MAX_DIGEST_SESSIONS = 20` | `index.ts:765` |

- **head** = first user message text, stripped by `stripForQuote`
  (`ordered.find((m) => m.role === "user")?.text ?? ""` `index.ts:905`), then
  truncated by `truncateWithEllipsis` (`index.ts:858-861`) to at most **301**
  characters (`slice(0,300)` plus a `…` U+2026), with `headTruncated` set
  (`headTruncated: head.truncated` `index.ts:938`).
- **tail** = the last 3 assistant messages plus the last 2 user messages,
  **re-merged in true chronological order** and joined by `\n---\n`
  (`const lastAssistant` `index.ts:908-919`), stripped, then
  `truncateTailFromFront` (`index.ts:863-866`) → at most **300** characters
  (`…` plus the newest `max-1`), so recent text survives and older tail text is
  dropped.
- Both texts are stripped by `stripForQuote` (`index.ts:849-856`), which drops
  three classes: SGR ANSI sequences (`\[[0-9;]*m` `index.ts:851`); combining
  diacritics U+0300–U+036F (byte-verified as `cc 80`–`cd af`) on the second
  `.replace(...)` call (`index.ts:852`); and the zero-width invisibles U+200B–U+200D
  plus U+FEFF (`\u200B-\u200D\uFEFF` `index.ts:855`).
- On the render side `escapeQuote` (`index.ts:1185-1187`) escapes `\` then `"`.
- `ageDays = Math.floor((Date.now() - created) / 86400000)`
  (`ageDays: Math.floor((Date.now() - args.created.getTime()) / 86400000)` `index.ts:931`);
  `created`/`modified` as ISO strings (`args.created.toISOString()` `index.ts:932-933`).
- `flowName` is **always** `undefined` — the field exists on `DigestPack`
  (`flowName: string | undefined;` `index.ts:774`), but the only construction
  site passes `flowName: undefined` (`flowName: undefined,` `index.ts:1328`),
  and the flow name is detected for skipping
  (`matchedEphemeralFlow` `index.ts:1283`) but never surfaced in a pack.

**Grades.**

- `weak` rows render as a full fenced pack with a `weak-guess:` line
  (`function formatDigestPack` `index.ts:1189-1208`, weak branch
  `weak-guess: ${weak.guess}` `index.ts:1204`).
  The guess is `finished` when `ageMs >= MAX_AGE_MS`, else `paused`
  (`function suggestTriageWeak` `index.ts:943-963`), each with an explicit
  "judge from the words, never auto-confirm" style rationale —
  `msgs — words decide; confirm from tail` (`index.ts:954`) or
  `msgs, no signal — words decide; park only if tail agrees`
  (`index.ts:961`).
- `machine` rows render as **compact one-liners** by default
  (`function formatCompactRow` `index.ts:1238-1255`), emitted at
  (`formatCompactRow({` `index.ts:1357`) with the schema
  `<short> · <n>msgs · <d>d · named "<name>"|unnamed · <weak-guess> · <head≤121>`,
  built by `const named =` (`index.ts:1246-1250`); the head slice is 120
  chars plus `…` (`args.head.length > 120` `index.ts:1250`).
  Under `--verbose` machine rows additionally get their full fenced packs with
  the `NAMED → keep (machine) · named session — presumed active` line
  (`verbose) {` `index.ts:1368-1373`),
  built by `machineFactOf` (`index.ts:1340-1345`), and rendered by
  the `lines.push(` in that pack (`index.ts:1202`).
- The machine "proposal" is hardcoded to `TRIAGE_VERDICT.KEEP` (`index.ts:1343`);
  the weak guess line is still computed and rendered for machine rows in compact
  form (`weakGuess: guessOf(c).guess` `index.ts:1362`) and in verbose packs.

**Deferral.** When anything is deferred, a line
`deferred (<N>): <shortId>, <shortId>, …` is appended
(`lines.push(` with `deferred.map((c) => shortId(c.info.id))` `index.ts:1375`).
Deferred rows carry **no packs and no guesses** — only ids, in page order.

**Footer.** Every phase-1 notify ends with an instruction line
(`'Packs are quoted-as-data` `index.ts:1377`) that names
the `--apply` grammar, the bare `id:keep` machine
form, `id:name:"slug"`, `--verbose`, `--dry-run`, and states "nothing is written
by this command".

**Read-only in every mode.** Phase 1 reaches no write, no `mkdirSync`, no
`confirm`. Its I/O is `SessionManager.list(ctx.cwd)` (`index.ts:1267`) and
`openSessionEntries(info.path)` (`index.ts:1276`), plus one read of
`<cwd>/AGENTS.md` that `readPolicyConfig(ctx.cwd)` (`index.ts:1262`) performs
inside `gatherTriageCandidates` — still a read, never a write.

**Idempotency.** Phase 1 writes nothing, so re-running is stable, because every
session with a verdict is skipped by `readLatestVerdict(entries) !== undefined) continue` (`index.ts:1277`),
and empty sessions are skipped by the zero-count guard `messageCount === 0` (`index.ts:1278`),
while ephemeral-flow matches are skipped by `matchedEphemeralFlow` (`index.ts:1283`),
so a fully triaged project converges to the `Nothing to triage.` message
(`ctx.ui.notify(` `index.ts:1306-1312`). Text
extraction is lazy: the `packOf` closure (`const packOf` `index.ts:1320-1332`)
pays for `orderedMessageTexts(c.entries)` (`index.ts:1331`) only when a pack is
actually rendered, so a 20-pack page over a large backlog does not extract the
deferred ones.

### 5.3 Phase 2 — `--apply`, consented writes

`handleScrubTriagePhase2` (`index.ts:1381-1608`).

**Grammar** (`parseTriageInput` `index.ts:997-1124`), two disjoint classes parsed
over one shared cursor and one shared `seen` set:

| Form | Regex | Line |
| --- | --- | --- |
| `idPrefix:verdict:"reason"` | `ASSIGN_RE` | `index.ts:979` |
| `idPrefix:name:"slug"` | `RENAME_RE` | `index.ts:980` |
| bare `idPrefix:keep` | `const bare =` | `index.ts:1089` |
| leftover classifier | `LOOSE_ASSIGN_RE` | `index.ts:981` |

- `verdict ∈ {keep, paused, finished, ephemeral, trash}` in `ASSIGN_RE`
  (`index.ts:979`); `trash` is accepted by the regex then **always rejected**
  with cause `"trash is never appliable from triage"` (`index.ts:1045-1048`).
- `<reason>` supports backslash escapes, unescaped by `unescapeReason`
  (`function unescapeReason` `index.ts:975-977`) at the point of use
  (`const reason = unescapeReason` `index.ts:1040`), so `\"` and `\\`
  can be embedded.
- Tokens are ordered by match index (`ordered.sort` `index.ts:1032`), and the gaps
  between them are collected as leftovers (`token.start > cursor` `index.ts:1037`),
  so a rename token never surfaces as a verdict leftover and vice versa
  (`cursor < cleaned.length` `index.ts:1084`). The two grammars are declared
  disjoint in the function's doc comment
  (`disjoint grammars parsed alongside` `index.ts:992-996`).
- **One shared `seen` set spans both classes** — declared at
  (`const seen = new Set<string>();` `index.ts:1006`),
  consulted at `seen.has(token.prefix)` (`index.ts:1060`) for verdict duplicates,
  `index.ts:1076` for rename duplicates and `index.ts:1104` for bare-token
  duplicates. The second assignment of any prefix — verdict or rename — is
  rejected as `duplicate assignment "<prefix>"`
  (`seen.has(token.prefix)` `index.ts:1060`, `index.ts:1076`). A rename for a
  prefix already verdicted in the same
  command line is therefore rejected.
- Renames normalize CR/LF to a space and trim
  (`token.slugRaw).replace(/[\r\n]+/g, " ").trim()` `unescapeReason(token.slugRaw)` `index.ts:1067`); an empty slug
  is rejected (`slug.length === 0` `index.ts:1072-1074`).
- Bare tokens are accepted **only** in the `id:keep` form
  (`const bare =` `index.ts:1089-1111`); bare `trash` is rejected as
  never-appliable (`"trash is never appliable from triage"` `index.ts:1093-1096`) and any other bare verdict is rejected
  as a missing rationale (`verdictRaw !== TRIAGE_VERDICT.KEEP` `index.ts:1097-1100`).
  A bare non-`keep` verdict therefore cannot be written.
- Leftovers that look like `<token>:<word>:` with an unknown word are rejected
  as `unknown verdict "${loose[2] ?? ""}"` (`index.ts:1114`); anything else as
  `malformed pair (expected id:verdict:"reason")` (`index.ts:1116`).
- All rejections are emitted as `Rejected ${r.raw}: ${r.cause}` at `warning`
  (`Rejected ${r.raw}: ${r.cause}` `index.ts:1389-1394`) **before any confirm** — the
  verdict rejections first, then the rename rejections.

**Resolution against a fresh scan** (`index.ts:1395` re-runs
`gatherTriageCandidates`):

- Prefix matching is `c.info.id.startsWith(a.idPrefix)` (`index.ts:1410`), so any
  prefix length, not only 8, resolves.
- Zero matches → `matches.length === 0`, which either fires the reasonless gate or
  rejects the prefix as
  `unknown session (stale or out of triage set)`
  (`matches.length` `index.ts:1414-1421`).
- More than one match → `matches.length > 1` (`index.ts:1422`); the prefix is
  rejected as `ambiguous prefix (<n> sessions)` (`index.ts:1426`).
- **Provenance gate for the reasonless `id:keep` form:** accepted only when the
  resolved target is named (machine provenance); otherwise rejected with
  `reasonless keep is machine-only — WEAK needs id:keep:"reason"`
  (`const rejectReasonless` `index.ts:1406-1408`); the WEAK-target case is an empty
  reason combined with an unnamed target
  (`target.info.name !== undefined && target.info.name.trim().length > 0` `index.ts:1431-1435`).
  Unknown reasonless assignments are rejected through the same gate
  (`a.reason === ""` `index.ts:1415-1416`),
  and so are ambiguous ones (`matches.length > 1` `index.ts:1423-1424`).
- Provenance is `machine` iff the target is named, else `weak`
  (`named ? TRIAGE_GRADE.MACHINE` `index.ts:1440`).
- Renames resolve by the same prefix rules
  (`const matches = candidates.filter((c) => c.info.id.startsWith(a.idPrefix));`
  `index.ts:1445-1453`) with the same two rejection messages, but **no provenance
  gate** (`renameAssignments` {` `index.ts:1444-1461`).

The grouping is a single filter pair: machine-provenance `keep` verdicts
bulk-confirm as one set (`const bulkKeeps` `index.ts:1465-1467`);
everything else — all WEAK rows and any judged non-`keep` on a named session —
confirms per item (`const perItem` `index.ts:1469`). The bulk rationale is the
fixed string `machine keep, bulk-confirmed ${now.toISOString().slice(0, 10)}` from
`function bulkKeepRationale` (`index.ts:1232-1234`), computed at
(`const bulkRationale` `index.ts:1470`) and stored verbatim as the
`reason` in each file's verdict entry.

**Non-TUI / dry-run.** `resolveDryRun(args, ctx)` (`index.ts:1476`) — true with
`--dry-run` or any non-`tui`/non-UI mode. Output lines
(`index.ts:1477-1494`): `Dry-run — nothing written.`, an optional
`would bulk-keep <n> machine sessions [...] with reason "..."`, one
`would apply <shortId> as <verdict> (provenance=<grade>[ · msgs=… age=…d]): "<reason>"`
per per-item row, and one `would rename <shortId> from "<existing|(unnamed)>" to "<slug>"`
per rename. Zero writes, zero confirms. `--verbose` adds `msgs`/`age` fragments
to the bulk line and the per-item lines (`const fragments = verbose` `index.ts:1479-1484`,
`const extra = verbose ?` `index.ts:1488`).

**Write path.** Shared per-file body `disposeVerdict` (`index.ts:1507-1532`):

1. Re-read the target's latest verdict immediately before appending
   (`const current = readLatestVerdict(openSessionEntries(r.targetPath));` `index.ts:1508`).
   If a verdict appeared meanwhile and **differs** from the assignment →
   `Skipped <shortId>: verdict appeared meanwhile (<v>)`, counted
   as conflict (`verdict appeared meanwhile` `index.ts:1509-1513`).
2. If a verdict is present and **equal** → `Already <shortId>: verdict <v>
   present and matching - counted.`, counted as `already`
   (`present and matching - counted.` `index.ts:1514-1518`).
   **This is the idempotency path.**
3. `appendVerdictToOther` (`function appendVerdictToOther` `index.ts:1140-1163`) —
   defense in depth: it refuses
   `trash` (`index.ts:1146-1148`), refuses a missing file
   (`existsSync(sessionPath)` `index.ts:1151-1153`), and refuses the live session by
   resolved path
   (`samePath(sessionPath, livePath)` `index.ts:1154-1156`), then appends the
   versioned custom entry
   (`appendCustomEntry(VERDICT_CUSTOM_TYPE` `index.ts:1157-1163`). Note the checks
   are redundant by construction: every
   caller has already re-gathered and excluded the live session and verdicted
   files (`const isLive =` `index.ts:1272-1277`).
4. Post-write re-read; a mismatch reports `post-write re-read mismatch` at `warning` (`ctx.ui.notify(` `index.ts:1525-1527`)
   and counts as error. A throw from the append reports the `Skipped` warning built
   from `errorMessage` (`errorMessage(err)` `index.ts:1529-1531`).

Renames use `appendRenameToOther` (`function appendRenameToOther`
`index.ts:1165-1183`): refuses an empty slug
(`slug.trim().length === 0` `index.ts:1170-1172`), a missing file
(`existsSync(sessionPath)` `index.ts:1176-1178`), and the live session
(`samePath(sessionPath, livePath)` `index.ts:1179-1181`), then calls
`appendSessionInfo(slug)` (`index.ts:1182`) — the same entry shape `/name` is
documented to use. The post condition is a re-read via
`SessionManager.open(r.targetPath).getSessionName()` (`index.ts:1582`) compared to
the requested slug (`check === r.assignment.slug` `index.ts:1583-1584`).

Both confirms carry `msgs` and `ageDays` resolved through `ageOf`
(`const ageOf` `index.ts:1397-1404`), which returns `{msgs: 0, ageDays: 0}` for a
target no longer in the map (`return { msgs: 0, ageDays: 0 };` `index.ts:1399`).

**Summary line** (`confirmedVerdicts === 0 && confirmedRenames === 0` { `index.ts:1594-1597`):
if nothing was confirmed at all → `notify` with
`"Cancelled."` at `info` (`"Cancelled."` `index.ts:1595`). Otherwise
`Triaged <applied+already> of <resolved> (<applied> applied + <already> already)`
plus optional `N declined [ids]`, `N conflict [ids]`, `N error [ids]`,
`renamed <n> of <N> (<d> declined, <e> error)`, terminated by
`Re-run /scrub to see new classifications.` (`const parts` `index.ts:1599-1607`).

**Idempotency.** A second `--apply` with the same assignments finds the targets
already carry a matching verdict and takes the `already` path
(`Already ${r.shortId}` `index.ts:1514-1518`) — but only if they are still in the
triage set. Because
every session carrying a verdict is skipped by
`readLatestVerdict(entries) !== undefined) continue` (`index.ts:1277`), the
re-resolve reports them as
`unknown session (stale or out of triage set)` (`index.ts:1418`) and the run
ends as `Cancelled.`
The observable end state is stable either way; the
`already` counter is reachable only when the earlier verdict was written outside
the triage path (e.g. via `scrub_mark` in a way that left the file verdicted but
still listed) or when the verdict appeared between gather and append.

**Explicitly NOT supported:**

- `trash` from triage — rejected by the triple parser (`VERDICTS.trash) {` `index.ts:1045-1048`),
  by the bare-token parser (`verdictRejected.push({ raw: token,` `index.ts:1093-1096`),
  and by `appendVerdictToOther` (`refusing trash verdict from triage` `index.ts:1146-1148`).
- writes to the live session (`samePath(sessionPath, livePath)` `index.ts:1154-1156`).
- inclusion of the live session in the triage set (`const isLive =` `index.ts:1272-1275`).
- reasonless non-`keep` forms (`verdictRaw !== TRIAGE_VERDICT.KEEP` `index.ts:1097-1100`).
- a `--force`, `--yes`, `--json`, a picker UI, cross-project targets, and any
  write during phase 1.

## 6. `scrub_mark` tool

**Registration** `pi.registerTool({` `index.ts:1666-1675`; name `scrub_mark`
(`index.ts:1667`), label `"Record session verdict"` (`index.ts:1668`).

**Verdict set** — a TypeBox union of five literals (`ScrubMarkParams` `index.ts:644-653`), identical to `VERDICTS` (`index.ts:35-41`):
`Type.Literal(VERDICTS.keep)` (`VERDICTS.keep` `index.ts:646`),
`Type.Literal(VERDICTS.paused)` (`VERDICTS.paused` `index.ts:647`),
`Type.Literal(VERDICTS.finished)` (`VERDICTS.finished` `index.ts:648`),
`Type.Literal(VERDICTS.ephemeral)` (`VERDICTS.ephemeral` `index.ts:649`),
`Type.Literal(VERDICTS.trash)` (`VERDICTS.trash` `index.ts:650`). `reason` is an optional string
(`Type.Optional(Type.String())` `index.ts:652`).

**Data shape** written (`appendCustomEntry(VERDICT_CUSTOM_TYPE` `index.ts:674-679`):

```json
{ "version": 1, "verdict": "<verdict>", "at": "<ISO-8601 UTC>", "reason": "<string|undefined>" }
```

appended as a custom entry with `customType = "session-scrub/verdict"`
(`VERDICT_CUSTOM_TYPE` `index.ts:62`, used at `index.ts:674`). The triage write
path emits the identical shape (`index.ts:1157-1163`), so both producers are
read-compatible.

**Versioning.** `version: 1` is hardcoded at both write sites (`version: 1,`
`index.ts:675` and `version: 1,` `index.ts:1158`). The reader
`asVerdictData` (`index.ts:178-185`) requires
`typeof version === "number"` (`typeof d.version !== "number"` `index.ts:181`)
but **does not check that it
equals 1** — a future `version: 2` entry would be read as-is. `reason` is
optional on write (`reason: params.reason,` `index.ts:678`) and never validated;
it is also dropped by
`asVerdictData` on read (`return { version: d.version, verdict: d.verdict, at: d.at }`
`index.ts:184`).

**Read path.** `readLatestVerdict` (`index.ts:388-399`) scans custom entries,
filters `customType`, keeps the entry with the lexicographically greatest `at`
(`v.at > latest.at` `index.ts:396`).

**Idempotency.** **None.** Every `scrub_mark` call appends a new entry; there is
no read-before-write and no update-in-place. Calling it twice records two
entries and the later `at` wins on the next read.

**Error / edge paths.**

- Non-verdict value → `Invalid verdict. Use one of: keep, paused, finished, ephemeral, trash.`
  as a normal tool result, not an error (`!isVerdict(params.verdict)) {`
  `index.ts:666-668`). This branch is defensive: the TypeBox schema should
  already have rejected the call.
- No live session file →
  `"No live session file; verdict not recorded."` (`index.ts:671-672`).
- Append failure → `Could not record verdict` from `errorMessage(err)`
  (`index.ts:681-683`). Failures are reported as text results, never thrown.
- The tool can only mark the **current** session: the path comes from
  `getSessionFile()` (`index.ts:669`).

**Explicitly NOT supported:** no target-session parameter, no read-back, no
verdict deletion, no reason validation, no version negotiation.

## 7. The passive naming-hint hook

**Registration.** Two hooks, both registered and nothing else:
`pi.on("agent_start"` (`index.ts:1676-1678`) → `handleAgentStart`
(`index.ts:737-739`), which passes `userTexts(ctx.sessionManager.getEntries())`;
and the `agent_end` hook (`index.ts:1679-1681`) → `handleAgentEnd` (`index.ts:741-746`),
which passes `agentMessageTexts(event.messages)` (`index.ts:721-735`).
Both delegate to `maybeOfferHint` (`index.ts:690-718`).

**Trigger conditions** — every one must hold, checked in this order:

1. The session id is not already in the in-process set
   (`hintedSessions.has(sessionId)` `index.ts:696`; the set is declared at
   `const hintedSessions` `index.ts:687`).
2. `getSessionName()` is `undefined` — the session has no name yet
   (`index.ts:697`).
3. No `session-scrub/name-hint` custom entry already exists in the live
   session (`hasCustomType` `index.ts:401-406`, called at `index.ts:698`). If one
   exists, the id is added to the in-process set and the hook returns `false`
   (`hintedSessions.add(sessionId);` `index.ts:699`) — this is the **persistent**
   restarts.
4. `deriveSlug(texts[0] ?? "")` yields a non-empty slug (`index.ts:702-703`).

**Slug derivation** `deriveSlug` (`index.ts:200-208`): lowercase →
`normalize("NFKD")` → strip combining diacritics U+0300–U+036F (verified by byte
inspection of the source line) → non-`[a-z0-9]` runs to `-` → trim leading and
trailing `-` → `slice(0, 60)`. It is fully deterministic and takes only the
first user text.

**Action on trigger** (`ctx.ui.setStatus(` `index.ts:704-713`), in order:

1. The status key is `STATUS_KEY`, whose value is
   `"scrub-name"` (`index.ts:66`),
   and it is used by `ctx.ui.setStatus(` (`index.ts:704`). The status text is
   Spanish by design.
2. The session id is added to `hintedSessions` — the
   in-process gate — at the same step as the earlier persistent-branch add
   (`hintedSessions.add(sessionId);` `index.ts:699-705`).
3. If `getSessionFile()` is defined, a custom entry
   `{version: 1, slug, offeredAt: <ISO>}` is appended with `customType =
   "session-scrub/name-hint"` (`HINT_CUSTOM_TYPE` `index.ts:63`), written at
   (`appendCustomEntry(HINT_CUSTOM_TYPE` `index.ts:708-712`). If the file is
   undefined, the hint is still shown and `true` is returned
   (`liveFile === undefined) return true;` `index.ts:707`).

**Dedupe summary.** Two independent gates: the in-process
`const hintedSessions` set, declared at
(`const hintedSessions` `index.ts:687`) and checked at
(`hintedSessions.has(sessionId)` `index.ts:696`); plus a persistent custom-entry
check (`hasCustomType(ctx.sessionManager.getEntries(), HINT_CUSTOM_TYPE)` `index.ts:698-701`). Either alone suppresses a re-offer. The persistent gate
also records the session so a later `/name` + restart does not re-offer.

**Error handling.** The whole body is wrapped in `try { … } catch { return false }` (opened at `try {` `index.ts:694`) with the comment `never break the session for a hint` (`index.ts:715`) on the `catch {` line and `return false;` below it (`index.ts:716`). A throwing slug derivation, `setStatus`,
or append is
swallowed silently; the return value is the only signal, and no caller uses it
(`index.ts:738` in `handleAgentStart`,
`event: { messages: unknown },` `index.ts:742` in `handleAgentEnd`).

**What this hook explicitly does NOT do.**

- It never calls any naming API. There is no `setSessionName`, no
  `appendSessionInfo`, and no rename call anywhere on this path — the only
  `appendSessionInfo` in the file is the consented triage rename
  (`index.ts:1182`).
- It never names the session. It proposes a slug in a status line and stops
  (`ctx.ui.setStatus(` `index.ts:704`).
- It never writes a verdict.
- It never prompts, never calls `confirm`, and never blocks.
- It never fires for a named session (`ctx.sessionManager.getSessionName() !== undefined` `index.ts:697`).
- It never injects anything into LLM context; the two hooks take no
  `before_agent_start`-style injection path (no such handler is registered,
  `pi.registerCommand` `index.ts:1635-1682`).

## 8. Storage layout

**Session directories.** All session discovery goes through
`SessionManager.list(ctx.cwd)`: `index.ts:476` for the audit, `index.ts:1267` for
triage, and `index.ts:586` — bound to `const relisted` — for the post-apply
re-list. The plugin's own notion of
"this project's sessions dir" is `ctx.sessionManager.getSessionDir()`
(`index.ts:567`), and the same call again (`index.ts:592`) on the restore path.

- **UNVERIFIED: the on-disk shape of `getSessionDir()` — specifically the
  claim that Pi stores sessions in per-cwd subdirectories named `--<cwd with /
  replaced by ->--`.** Nothing in `index.ts` derives or assumes that shape;
  `getSessionDir()` is a Pi API whose contract is not defined in this repo, and
  I did not read the Pi distribution source. The convention is reported by the
  delegator's population sweep as observed evidence (§13) and by `README.md`,
  but it is not code-verifiable here.
- **UNVERIFIED: whether `SessionManager.list(ctx.cwd)` filters strictly by cwd,
  sorts, or includes the live session.** The code depends on the result being
  cwd-scoped (`const sessions = await SessionManager.list(ctx.cwd);` `index.ts:476`)
  and handles the live session possibly being absent by synthesizing it
  (`!audited.some(...)` `index.ts:491-513`) whenever no live row came back —
  which implies the API may or may not
  include it. The filtering/sorting semantics are Pi-internal.
- **UNVERIFIED: the `.jsonl` extension convention for session files.** The code
  filters trash entries by `f.endsWith(".jsonl")` (`index.ts:452`) and strips
  `.jsonl` when rendering a restore prompt (`index.ts:608`), which is strong
  in-code evidence for the convention, but the file-naming rule itself
  (`<id>.jsonl`) is Pi-internal and not asserted here.

**The plugin-owned trash dir** `getTrashDir(sessionDir)` (`index.ts:424-430`):

```ts
join(dirname(dirname(sessionDir)), "session-scrub-trash", basename(sessionDir))
```

The literal directory name is `"session-scrub-trash"`
(`index.ts:427`), and the leaf is `basename(sessionDir)` (`index.ts:428`). The path
goes **two** levels up
from the session dir (`dirname(dirname(...))`, `index.ts:426`). The in-source
rationale is recorded in the doc comment at
(`Trash dir as sibling of Pi's` `index.ts:421-423`): it is a sibling of Pi's `sessions/`
root — "two levels up from the per-project dir" — chosen so trashed files are
never inside `sessions/` where Pi could mistake them for live sessions, and never
an invented cwd transform.

Given the observed layout `sessions/--<project>--/`, this yields
`<home>/session-scrub-trash/--<project>--/` at the home level — i.e. the trash
root is a sibling of `sessions/`, not of the per-project dir. (The *shape* of
`<project>` is §13/UNVERIFIED above; the two-levels-up arithmetic is code-verified
at (`dirname(dirname(sessionDir))` `index.ts:426`).)

**How it differs from OS trash.**

- The plugin never invokes an OS trash mechanism; the only mutation primitive
  imported is `renameSync` (`index.ts:10`). It has exactly two call sites —
  `renameSync(sessionPath, trashPath)` and
  `renameSync(trashedPath, restoredPath)` — i.e. outbound
  `sessionPath, trashPath` → `index.ts:435` and inbound
  `trashedPath, restoredPath` → `index.ts:445`.
  There is no `unlink`, no `rm`, no `spawnSync`, no `execSync`, no `trash` CLI
  call anywhere in the file — I grepped the whole source for these.
- **UNVERIFIED: the OS-trash-integration ban and the "no `unlink` /
  `spawnSync` / `execSync` / `trash-cli` strings" requirement are specified in
  `spec.md` REQ-10/REQ-12, and I verified their absence in this file by grep,
  but a negative grep over one source file is not the same as a runtime
  guarantee.** What *is* code-verified is the positive claim: every mutation is a
  `renameSync` into or out of `session-scrub-trash`.
- Consequence: trashed sessions do not appear in any file browser's trash and are
  not subject to OS retention policies. They live until the user deletes them by
  hand.

**Session-name storage.** The only name sources are `info.name`, read at
(`s.name !== undefined` `index.ts:238`), at the audit sort
(`aNamed = a.info.name !== undefined` `index.ts:1292`), at the synthetic live
record (`name: ctx.sessionManager.getSessionName()` `index.ts:501`), and at the
provenance test (`const named = target.info.name` `index.ts:1431`); plus
`getSessionName()` (`index.ts:501`, `index.ts:697`, `index.ts:1582`).
**UNVERIFIED: how Pi persists a session name** — the
plugin writes via `appendSessionInfo(slug)` (`index.ts:1182`) but never inspects
the on-disk encoding, and no `SessionInfo` field is constructed by the plugin for
a named session (the synthetic live record at `liveInfo: SessionInfo` `index.ts:497-507`
copies `getSessionName()`, so it follows the API, not the file).

## 9. Verdicts and the POLICY block

**Verdict constants** `VERDICTS` (`index.ts:35-41`) — all lowercase string
literals, in declaration order:

- `keep` — `index.ts:36`
- `paused` — `index.ts:37`
- `finished` — `index.ts:38`
- `ephemeral` — `index.ts:39`
- `trash` — `index.ts:40`

`isVerdict` (`index.ts:171-176`) is the runtime guard. Its two call sites are
the guard inside handleScrubMark (`params.verdict` `index.ts:666`) and
asVerdictData, whose `d.verdict` check (`index.ts:182`) rejects every other value.

**Verdict entry grammar** (as read back): a custom entry whose `customType` is
exactly the value of the constant `VERDICT_CUSTOM_TYPE` `index.ts:62`, matched at
`index.ts:393` by the guard `c.customType !== VERDICT_CUSTOM_TYPE`, and whose
`data` must pass the three field checks in `asVerdictData` `index.ts:178-185`:
numeric `version`, string `at`, and the `d.verdict` check `index.ts:182`.
Anything else is discarded silently: `asVerdictData` (`index.ts:394-395`) is the
last filter, and `v === undefined` ends the entry with no verdict at all.

**Class kinds** `CLASS_KIND` (`index.ts:44-51`):

- `live` — `index.ts:45`
- `named-protected` — `index.ts:46`
- `auto-deletable` — `index.ts:47`
- `candidate` — `index.ts:48`
- `old-needs-confirm` — `index.ts:49`
- `kept` — `index.ts:50`

**Candidate reasons** `CANDIDATE_REASON` (`index.ts:53-58`):

- `explicit-trash` — `index.ts:54`
- `finished` — `index.ts:55`
- `ephemeral` — `index.ts:56`
- `empty` — `index.ts:57`

**POLICY markers** `POLICY_START = "<!-- pi-session-scrub:start -->"`
(`index.ts:64`), `POLICY_END = "<!-- pi-session-scrub:end -->"`
(`index.ts:65`).

**POLICY grammar actually read** — `parsePolicyBlock` (`index.ts:292-310`):

1. Both markers must be present anywhere in the file text, or the function returns
   `undefined` (`!text.includes(POLICY_START) || !text.includes(POLICY_END)) {`
   `index.ts:293-295`).
2. The file is split on `"\n"` and each line is trimmed (`index.ts:297-298`).
3. Blank lines and lines starting with `#` are skipped (`line.startsWith`
   `index.ts:299`).
4. **Only** lines starting with `ephemeral-flows:` are consumed
   (`index.ts:300`). The value after the colon is trimmed
   (`line.slice("ephemeral-flows:".length).trim();` `index.ts:301`); an
   empty value or one containing `<` is skipped (`value.length === 0 || value.includes("<")` `index.ts:302`).
5. The value is split on `,`, each part trimmed — `part.trim()` `index.ts:304` —
   and parts that
   are empty or contain `<` are dropped by
   `flow.length > 0 && !flow.includes("<")` (`index.ts:305`).

**What the plugin reads from POLICY: exactly one key.** Only `ephemeral-flows:`
has any effect. The `verdicts: keep | paused | finished | ephemeral | trash` line
(`index.ts:89`) and the `session_rename, block_close, session_close` line
(`index.ts:90`) present in the
template are comment-guidance text for the agent and are
**parsed by nothing** — `parsePolicyBlock` never reads them, and the returned
`PolicyConfig` has exactly one field, `ephemeralFlows` (`index.ts:148-150`),
returned as `return { ephemeralFlows: flows };` (`index.ts:309`).

**Defaults.** No `AGENTS.md`, an unreadable `AGENTS.md`, a missing block, a
missing marker, or an empty/placeholder `ephemeral-flows:` all yield
`ephemeralFlows: []`. The parse-failure collapse is
`return parsePolicyBlock(text) ?? { ephemeralFlows: [] };` (`index.ts:411`), and
the `catch` returns `return { ephemeralFlows: [] };` (`index.ts:412-414`). With
an empty flow list, `matchesEphemeralFlow` (`index.ts:192-198`) returns `false`
for every session, so no session is ever an ephemeral candidate by flow.

**Ephemeral match semantics** `matchesEphemeralFlow` (`index.ts:192-198`) /
`matchedEphemeralFlow` (`index.ts:966-971`): for each configured flow, a regex
`(?:^|\s)/skill:<escaped flow>(?:\s|$)` is tested against the joined user
message texts. It is an **exact token match** — no substring, prefix, or fuzzy
matching. Both in-source comments say so: the one above
`matchesEphemeralFlow` (`index.ts:191`) and the one above
`matchedEphemeralFlow` (`index.ts:965`). Empty
flow names are skipped by `flow.length === 0` (`index.ts:194`), and again inside
`matchedEphemeralFlow` (`index.ts:966-971`). Regex metacharacters in flow names
are escaped by `escapeRegExp` (`index.ts:187-190`).

**Parse failure behavior — there is none that surfaces.** `parsePolicyBlock`
returns `undefined` on a marker failure (`return undefined;` `index.ts:294`) and the
caller collapses that to an empty flow list
(`return parsePolicyBlock(text) ?? { ephemeralFlows: [] };` `index.ts:411`).
Malformed lines are skipped
individually. There is no warning, no error, and no non-zero exit for any
malformed POLICY input.

**Template** `POLICY_TEMPLATE` (`index.ts:68-96`) is a single template literal
containing both markers, the verdict glossary, the WHEN-TO-MARK block, and the
`ephemeral-flows:`
placeholder line, whose value is
`<flow-name-1>, <flow-name-2>` `index.ts:91`. It parses
as empty by the `<` rule (`value.includes("<")` `index.ts:302` and
`flow.length > 0 && !flow.includes("<")` `index.ts:305`), so a freshly written
block is inert until a human fills it in.

## 10. Trash and recovery paths

**The rename path, end to end.**

*Outbound* (`moveToTrash` `index.ts:432-437`):

1. `mkdirSync(trashDir, {recursive: true})` — creates the whole trash chain
   (`index.ts:433`).
2. `trashPath = join(trashDir, basename(sessionPath))` (`index.ts:434`).
3. `renameSync(sessionPath, trashPath)` (`index.ts:435`) — a same-filesystem
   atomic rename; the file keeps its name and its contents, including every
   verdict and name-hint custom entry.
4. The trash path is returned (`return trashPath;` `index.ts:436`), though no
   caller uses the return value (`a.info.path, trashDir` `index.ts:580`).
- The caller wraps only steps 1–3 in try/catch per file
  (`moveToTrash(a.info.path, trashDir)` `index.ts:579-584`).

*Inbound* (`moveFromTrash` `index.ts:439-447`):

1. `mkdirSync(sessionsDir, {recursive: true})` creates the
   sessions dir if missing (`index.ts:440`).
2. `restoredPath = join(sessionsDir, basename(trashedPath))` (`index.ts:441`).
3. If `existsSync(restoredPath)` → **throw**
   `restore target already exists: <path>`. The `existsSync(restoredPath` guard
   `index.ts:442-444` is the asymmetry with the outbound path.
4. `renameSync(trashedPath, restoredPath)` — the `trashedPath, restoredPath`
   move (`index.ts:445`).
5. Return the restored path (`return restoredPath;` `index.ts:446`); the caller
   ignores it (`moveFromTrash(p, sessionsDir)` `index.ts:613`).

**Recovery paths that exist in the code:** the `/scrub-restore` command,
registered at `"scrub-restore", {` `index.ts:1648` and handled by
`function handleScrubRestore` `index.ts:590`; and, by construction, a manual `mv`
of the `.jsonl` file back into the session dir — the code imposes no format
requirement beyond the `.jsonl` listing filter (`index.ts:452`).

**Failure modes enumerated.**

| Failure | Site | Observable |
| --- | --- | --- |
| Trash dir cannot be created (permissions) | `mkdirSync(trashDir` `index.ts:433` | throw → per-file skip, reported at `warning` |
| Cross-device rename (`EXDEV`) | `renameSync(sessionPath` `index.ts:435` | throw → same per-file skip |
| Source file vanished between audit and move | `renameSync(sessionPath` `index.ts:435` | throw → same per-file skip |
| Trash name collision (outbound) | `trashPath = join(trashDir` `index.ts:434-435` | **no guard** — `renameSync` overwrites silently |
| Restore target already exists | `existsSync(restoredPath` `index.ts:442-444` | throw → per-file skip, reported at `warning` |
| Restore source vanished | inbound `renameSync` of `trashedPath, restoredPath` `index.ts:445` | throw → per-file skip |
| Trash dir unreadable | `return [];` `index.ts:454-456` | `[]` → "No trashed sessions for this project." |
| `AGENTS.md` unwritable | `writeFileSync(agentsPath` `index.ts:636` | **unhandled** — no try/catch |

Both per-file skips are emitted at `warning`. The outbound one is
`Skipped ${a.info.id.slice(0, 8)}: ${errorMessage(err)}` `index.ts:583`, the
inbound one `Skipped ${basename(p)}: ${errorMessage(err)}` `index.ts:616`. A
missing trash dir yields the same message as an empty one
(`No trashed sessions for this project.` `index.ts:594-596`).

The `EXDEV` case is the one the code deliberately does not work around: there is
no copy+unlink fallback, only `renameSync` (`index.ts:435`), and the in-file
convention is documented in the section header comment at
(`FS helpers (throwing atomic moves; callers catch per file)` `index.ts:418`).

**What is never done.**

- Never permanently deleted: no `unlink`, no `rm`, no `rmSync`, no truncate. I
  grepped the full source; `node:fs` imports are exactly `renameSync`, `mkdirSync`,
  `readdirSync`, `readFileSync`, `writeFileSync`, `existsSync`, `realpathSync`
  (`import {` `index.ts:9-17`) — no delete primitive is even imported.
- Never purges the trash. There is no `/scrub-empty` and no retention policy in
  this file; the only `writeFileSync` outside session entries is `AGENTS.md`
  (`writeFileSync(agentsPath` `index.ts:636`).
- Never writes into the live session's message content. The only writes to any
  session file are verdict appends (`appendCustomEntry` `index.ts:674`,
  `index.ts:1157`), the hint append (`appendCustomEntry` `index.ts:708`), and
  `appendSessionInfo`
  for consented renames (`index.ts:1182`) — all append-only and all guarded
  against the live path except the live session's own verdict and hint writes,
  which are the intended self-writes.
- Never mutates the live session's messages, and never trashes it: the live row
  precedes every actionable row in `classifySession`
  (`live.path !== undefined` `index.ts:232-237`), and
  the live session is excluded from the triage candidate set
  (`const isLive =` `index.ts:1272-1275`) and re-asserted at append time
  (`samePath(sessionPath, livePath)` `index.ts:1154-1156`,
  `samePath(sessionPath, livePath)` `index.ts:1179-1181`).
- Never overwrites on restore (`existsSync(restoredPath` `index.ts:442-444`); **may**
  overwrite in the trash (`trashPath = join(trashDir` `index.ts:434-435`,
  no guard).

## 11. Spec vs code drift

Cross-referenced against `openspec/specs/session-scrub/spec.md`. The code wins in
every case below.

1. **Trash path depth.** `spec.md:142` specifies
   `join(dirname(getSessionDir()), "session-scrub-trash", basename(getSessionDir()))`
   — one level up. Code uses `dirname(dirname(sessionDir))` (`index.ts:426`) —
   **two** levels up, with the rationale comment at
   (`Trash dir as sibling of Pi's` `index.ts:421-423`).
   This is the only drift that changes a real on-disk path.
2. **`moveToTrash` / `moveFromTrash` signatures.** `spec.md:145` declares
   `moveToTrash(sessionPath, cwd)` and `spec.md:150` declares
   `moveFromTrash(trashedPath, cwd)`. Code takes the **already-derived trash /
   sessions directory**, not a cwd. Outbound is
   `moveToTrash(sessionPath, trashDir)` (`index.ts:432`); inbound is
   `moveFromTrash(trashedPath, sessionsDir)` (`index.ts:439`). Callers derive both
   at the call site — `const trashDir` `index.ts:567` and
   `const sessionsDir` `index.ts:592`.
3. **`classifySession` signature.** `spec.md:119-127` declares
   `(s, livePath, verdict, ephemeralFlows: string[], nowMs?)`. Code takes
   `(s, live, verdict: Verdict|undefined, ephemeralFlow: boolean)` at
   `function classifySession` `index.ts:226-231` — a `LiveIdentity` object
   instead of a bare path, and a precomputed boolean instead of the flow
   list. There is no `nowMs`
   parameter; `Date.now()` is called inline at `index.ts:272`.
4. **`matchesEphemeralFlow` signature.** `spec.md:131-135` declares
   `(s: SessionInfo, ephemeralFlows)`. Code takes the already-extracted **text**
   (`index.ts:192-193`), and the caller does the extraction
   (`matchesEphemeralFlow` `index.ts:487`).
5. **Phase-1 page ordering.** Canonical `spec.md:405` (TR-02) says packs sort
   "machine-grade (named→keep) first, then human-grade by `modified`", and
   `spec.md:407-410`'s deferral scenario says exactly 20 packs plus a `+5 more
   deferred` notice. Code composes the page **WEAK-first, machine-keeps filling
   to 20** (`const ordered = [...weakQueue, ...machineKeeps]`
   `index.ts:1313-1316`) and emits
   `deferred (<N>): <shortId>, …` (`index.ts:1375`) instead of
   `+R more deferred — triage these first, then re-run.`. This ordering is
   correct per the **later** change
   `openspec/changes/archive/2026-09-14-session-scrub-triage-ux/spec.md:70-71`,
   which explicitly supersedes TR-02 ("Previously: TR-02 sorted machine-grade
   named-first…"). The canonical `spec.md` was never re-synced, so it is stale
   here. Same for the UX spec's compact-default table (`…-ux/spec.md:87`) and the
   deferred-ID line (`…-ux/spec.md:104`), which the canonical spec does not
   describe.
6. **`/scrub-restore` dry-run flag.** `spec.md:201` and REQ-11 (`spec.md:331`)
   describe implicit dry-run for non-TUI. Code matches that
   (`!isInteractive` `index.ts:598`). But the code takes **no** `--dry-run` argument at all
   (`void args`, `index.ts:591`), so `--dry-run` in the TUI is a no-op rather
   than a preflight. Neither the spec nor `README.md` claims the flag exists for
   this command, so this is a code-level asymmetry with `/scrub-apply` rather
   than a spec contradiction.
7. **`README.md` (non-normative) vs code.** `README.md` says triage renames allow
   duplicates "like `/name`"; code rejects a second assignment of the same
   prefix, including rename-after-verdict, through the single shared `seen` set
   (`const seen` `index.ts:1006`), rejected again at
   `seen.has(token.prefix)` (`index.ts:1060`, `index.ts:1076`) and at
   `seen.has(prefix)` (`index.ts:1104`).
   `README.md` also
   describes the deferred line as
   `+N deferred: <ids> — triage these first, then re-run`, whereas code emits
   `deferred (<N>): <ids>` with no trailing clause
   (`index.ts:1375`). And `README.md` renders the trash root as a sibling of
   `sessions/` (`session-scrub-trash/--<project>--/`), which agrees with the
   code's two-levels-up arithmetic only if `getSessionDir()` really is
   `sessions/--<project>--/` — see the UNVERIFIED in §8.

## 12. Not implemented yet

The session-naming capability is **not implemented**. Nothing in §§0–11 describes
it as current behavior. The following is scope, drawn from the proposed change
(`openspec/changes/session-scrub-naming/proposal.md`, status `proposed`) and
recorded here **only** to mark the boundary — none of it is behavior today:

- Making naming a plugin capability rather than a manual `/resume` + `/name`
  round-trip (proposal §1), which would supersede the REQ-09 prohibition on
  programmatic naming.
- Any LLM-generated or programmatic name-setting call. Today the only
  `appendSessionInfo` call site is the consented triage rename
  (`index.ts:1182`), and the hint path has none.
- A picker, a guard mechanism, or a confirmation UX — the proposal states these
  are deferred to its own spec delta and are unspecified.
- Any change to the classification predicate. Today's predicate is the one
  documented in §1, including the unnamed-session behavior the proposal
  questions.

## 13. Observed population evidence (not guarantees)

From a read-only sweep of all 75 sessions across both homes
(`~/.pi/agent/sessions` = 57, `~/.gentle-shell/agent/sessions` = 18), taken
2026-10-07 and reported by the delegator. I did not re-run this sweep. These are
**observations of one population at one moment** and are deliberately not stated
as behavior of the plugin; they are recorded because they bear on how much weight
each predicate can carry.

- **0 malformed lines across all 75 files.** This exercises the
  `catch → []` branches — the entry reader's `return [];`
  `index.ts:383-385`, `listTrash`'s `return [];` `index.ts:454-456`, and the
  policy `catch` (`return { ephemeralFlows: [] };` `index.ts:412-414`) —
  not at all in practice, so those paths remain unvalidated by observation.
- **Size is a bad discriminator:** 7-line sessions weigh 99–116 KB because of a
  fixed ~90–110 KB system preamble. No code path in `index.ts` reads file size —
  `messageCount` comes from `SessionInfo` (`index.ts:269`, `index.ts:1278`), not
  from bytes — so this is context for future design, not a current defect.
- **User+assistant turn count separates cleanly:** trivial sessions 2–4 turns,
  real work ≥ 6. `orderedMessageTexts` (`index.ts:877-892`) already extracts
  exactly this population, but it is used only for digest packs
  (`orderedMessageTexts` `index.ts:1331`); no classification decision uses a
  turn-count threshold.
- **Only 1 of 75 sessions had mtime < 120 s at scan time.** The 7-day age gate
  (`MAX_AGE_MS` `index.ts:33`, applied at `index.ts:272`) is therefore evaluated
  against a population almost entirely well past the gate.
- **Sessions live in per-cwd subdirectories named by cwd with `/`→`-` wrapped in
  `--`.** Reported as observed layout; see the UNVERIFIED in §8 — the code does
  not derive or encode this convention anywhere.

## 14. Honest gaps

Every claim in this document is cited. The following could not be established
from `extensions/session-scrub/index.ts` and are the only places where this
document declines to assert:

1. The on-disk shape of `getSessionDir()` and the `--<cwd>--` per-project naming
   convention (§8).
2. `SessionManager.list(ctx.cwd)` filtering, sorting, and live-session inclusion
   semantics (§8).
3. The `.jsonl` session filename convention, beyond the plugin's own filter
   (`f.endsWith(".jsonl")` `index.ts:452`).
4. How Pi persists a session name, and the on-disk encoding `appendSessionInfo`
   produces (§8).
5. That custom entries are excluded from LLM context — the plugin's design
   assumes it (`zero tokens by default` `index.ts:3-6`) and never relies on it
   in code, but the guarantee
   belongs to Pi, not to this file (§6).
6. The runtime behavior of `ctx.ui.notify`, `ctx.ui.confirm`, and
   `ctx.ui.setStatus` beyond how this file calls them (e.g. exactly which
   non-TUI `mode` strings exist beyond the `return ctx.mode === "tui" && ctx.hasUI;`
   comparison at `index.ts:318`).
7. The negative-grep claims about `unlink` / `spawnSync` / `execSync` / OS trash
   are verified for this source file only, as source text (§8, §10).
8. The 75-session population sweep (§13) — reported, not re-measured here.