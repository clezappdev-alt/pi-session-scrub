# Specification — session-scrub

**Domain:** `session-scrub` · **Canonical** · **Source change:** `session-scrub-cleanup` (slice 1)
**Verified state:** 2026-09-13 · verify-report 12/12 PASS (with 4 ACCEPTED deviations, see § Verified deviations)
**Scope:** first product slice. No canonical spec existed prior (greenfield plugin); this file is created from the verified change delta per greenfield sync semantics.

## Purpose

Keep the per-project Pi `/resume` list clean and descriptive at zero token cost by default: opt-in audit (`/scrub`), explicit user-disposed trash (`/scrub-apply`, reversible via `/scrub-restore`), project-local verdict policy (`/scrub-init` + `scrub_mark`), and a once-per-session deterministic naming hint. Nothing runs unless the user invokes a command; the live session is never touched; nothing is permanently deleted in slice 1.

## Fixed decisions

- **F1** `MAX_AGE_MS` is the constant `7 * 24 * 60 * 60 * 1000` (7 days). No configuration surface in slice 1.
- **F2** No `--force` flag exists. Every destructive path requires explicit per-item selection (TUI) or is dry-run only (non-TUI).
- **F3** Custom entry types: `session-scrub/name-hint` and `session-scrub/verdict`. Verdict data shape: `{ version: 1, verdict, at, reason? }` stored in `CustomEntry.data` (see verified deviation 2).
- **F4** POLICY grammar: lines starting with `#` and blank lines are ignored; machine keys are `verdicts:` / `mark-on:` / `ephemeral-flows:`; `<...>` placeholders parse as empty (absent value); absent or unparseable block = conservative default (no verdict marking, empty ephemeral-flows list).

## Type model (TypeScript strict, flat interfaces, no `any`)

```ts
// Const-object enums (per typescript skill — never bare unions).
const VERDICT = {
  KEEP: "keep",
  PAUSED: "paused",
  FINISHED: "finished",
  EPHEMERAL: "ephemeral",
  TRASH: "trash",
} as const;
type Verdict = (typeof VERDICT)[keyof typeof VERDICT];

const CLASSIFICATION_KIND = {
  LIVE: "live",
  NAMED_PROTECTED: "named-protected",
  AUTO_DELETABLE: "auto-deletable",
  CANDIDATE: "candidate",
  OLD_NEEDS_CONFIRM: "old-needs-confirm",
  KEPT: "kept",
} as const;
type ClassificationKind = (typeof CLASSIFICATION_KIND)[keyof typeof CLASSIFICATION_KIND];

const CANDIDATE_REASON = {
  EXPLICIT_TRASH: "explicit-trash",
  FINISHED: "finished",
  EPHEMERAL: "ephemeral",
} as const;
type CandidateReason = (typeof CANDIDATE_REASON)[keyof typeof CANDIDATE_REASON];

// SessionInfo mirrors Pi 0.85.1 SessionManager.list.
interface SessionInfo {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  parentSessionPath?: string;
  created: Date;
  modified: Date;
  messageCount: number;
  firstMessage: string;
  allMessagesText: string;
}

interface SessionDetail {
  name?: string;
  firstMessage: string;
  messageCount: number;
  created: Date;
  modified: Date;
  verdict: Verdict | undefined;
}

interface LiveClassification { kind: "live"; }
interface NamedProtectedClassification { kind: "named-protected"; name: string; verdict: Verdict | undefined; }
interface AutoDeletableClassification { kind: "auto-deletable"; reason: "empty"; }
interface CandidateClassification { kind: "candidate"; reason: CandidateReason; verdict: Verdict | undefined; }
interface OldNeedsConfirmClassification { kind: "old-needs-confirm"; detail: SessionDetail; }
interface KeptClassification { kind: "kept"; reason: "has-verdict-keep" | "has-content-no-verdict" | "has-verdict-paused"; }
type Classification =
  | LiveClassification
  | NamedProtectedClassification
  | AutoDeletableClassification
  | CandidateClassification
  | OldNeedsConfirmClassification
  | KeptClassification;

interface VerdictData {
  version: 1;
  verdict: Verdict;
  at: string;
  reason?: string;
}

interface NameHintData {
  version: 1;
  slug: string;
  offeredAt: number;
}

interface PolicyConfig {
  verdicts: Verdict[];
  markOn: string[];
  ephemeralFlows: string[];
}

interface AuditSummary {
  total: number;
  named: number;
  autoDeletable: number;
  candidates: number;
  oldNeedsConfirm: number;
  kept: number;
  live: number;
}
```

## Function signatures (WHAT, not HOW)

```ts
// Pure classifier. livePath comes from ctx.sessionManager.getSessionFile().
// verdict = latest session-scrub/verdict custom entry by `at`, else undefined.
// ephemeralFlows = parsed POLICY ephemeral-flows (empty when block absent).
declare function classifySession(
  s: SessionInfo,
  livePath: string | undefined,
  verdict: Verdict | undefined,
  ephemeralFlows: string[],
  nowMs?: number,
): Classification;

// Deterministic ephemeral match only: session invokes a flow whose exact name
// appears in ephemeralFlows. Checks user-message `/skill:<flow>` invocations and
// skill-call entries containing the exact flow name. No substring/fuzzy match.
declare function matchesEphemeralFlow(
  s: SessionInfo,
  ephemeralFlows: string[],
): boolean;

// Deterministic slug, no LLM. Lowercase, NFKD strip diacritics,
// non-alphanumeric runs → "-", trim edge dashes, slice(0, 60).
declare function deriveSlug(firstUserText: string): string;

// Trash layout. getTrashDir is a sibling of Pi's session dir:
// join(dirname(getSessionDir()), "session-scrub-trash", basename(getSessionDir())).
// Never an invented cwd→--cwd-- transform; sessions dir = getSessionDir() directly.
declare function getTrashDir(ctxSessionDir: string): string;
// Atomic rename session file → trash dir (auto-mkdir recursive). Returns trash path.
// MUST throw on failure (EXDEV/permissions) — never copy+unlink fallback.
declare function moveToTrash(sessionPath: string, cwd: string): string;
// Atomic rename trash file → sessions dir. Returns restored path. Throws on failure.
// MUST never overwrite an existing target.
declare function moveFromTrash(trashedPath: string, cwd: string): string;

// Reads latest verdict for one session file via getEntries(); filters
// customType === "session-scrub/verdict"; orders by data.at; returns
// undefined when none/unparseable. Never throws on malformed entries.
// Live session uses ctx.sessionManager.getEntries() directly (no open()).
declare function readLatestVerdict(sessionPath: string): Promise<Verdict | undefined>;

// POLICY parser (F4). Input = raw AGENTS.md text. Returns undefined when the
// delimited block is absent; returns conservative default PolicyConfig
// (empty ephemeralFlows) when block present but unparseable/placeholder-only.
declare function parsePolicyBlock(agentsMdText: string): PolicyConfig | undefined;

// Once-per-session naming hint. Reads entries for session-scrub/name-hint;
// when absent and session unnamed, derives slug and calls
// ctx.ui.setStatus("scrub-name", "sugerido: /name <slug>"), then appends the
// name-hint custom entry. When present, does nothing.
declare function offerNameHint(args: {
  firstUserText: string;
  hasSessionName: boolean;
  hasPriorHint: boolean;
}): { offered: boolean; slug: string | undefined };

// Model-invoked tool handler. Appends custom entry
// { customType: "session-scrub/verdict", data: VerdictData }.
// Rejects unknown verdict values with a tool error; never writes.
declare function handleScrubMark(input: {
  verdict: Verdict;
  reason?: string;
}): Promise<{ ok: true }>;
```

## Verified deviations (ACCEPTED — normative over prior draft wording)

1. **Interactive gate is `mode === "tui" && hasUI`.** Dist comment states `hasUI` can be true in RPC; unattended RPC must never reach `confirm()`. Both `/scrub-apply` and `/scrub-restore` check the conjunction at entry; otherwise implicit dry-run.
2. **Verdict data lives in `CustomEntry.data`.** Verified against pi 0.85.1 dist `CustomEntry` (L69–73). Read/write/filter use `customType === "session-scrub/verdict"` + `data: { version: 1, verdict, at, reason? }` with shape validation; malformed entries are skipped, never throw.
3. **Per-item `confirm()` loop is the primary TUI path.** Dist `select()` is single-select only, so multi-select is not available in slice 1. `/scrub-apply` and `/scrub-restore` iterate the actionable/trashed set in list order with `confirm(title, detailRow)`; empty selection → `notify("Cancelled.")`.
4. **Dry-run invariance is proven by file-set identity + absent trash dir,** not whole-dir checksums. Live session files grow every turn, so byte checksums cannot match; mutation-freedom holds when the session file set is identical and no trash dir was created.
5. **Live identity is resolved path + session id** (not bare string equality alone), with a synthetic `live` row in audit output so counts reconcile with `/resume`.
6. **Hint delivery uses `agent_end` + in-memory once-set in addition to the `agent_start` gate entry,** fixing the turn-1 blind spot; the gate entry `{ version: 1, slug, offeredAt }` remains the persistent once-per-session guard. The plugin never calls `setSessionName()`.

## Command specifications

### `/scrub` — read-only audit
- Usage: `/scrub` (no flags). MUST NOT mutate any file.
- Lists `SessionManager.list(ctx.cwd)`, reads latest verdict per session, classifies with `classifySession`, emits one `notify(info)` summary line with counts (`total · named · auto-deletable · candidates (by reason) · old-needs-confirm · kept · live`) plus per-session detail rows (name/firstMessage, messageCount, created, verdict, classification).
- Counts MUST exclude nothing silently: live session appears as `live`, never as actionable. Summary total equals sessions listed.

### `/scrub-apply` — dispose with consent
- Usage: `/scrub-apply [--dry-run]`.
- Actionable set = `auto-deletable` + `candidate` + `old-needs-confirm` (old rows carry full `SessionDetail`).
- `dryRun` is true when `--dry-run` passed OR NOT (`mode === "tui" && hasUI`). Dry-run path: `notify(info)` full candidate list, exit, zero mutations.
- TUI path: per-item `confirm()` loop over the actionable set; empty selection → `notify("Cancelled.", info)`, exit; confirmed selection → `moveToTrash` per file (per-file error notify, continue); post-run re-list + `notify(info, "Trashed X … Remaining: Y …")`.
- Execution uses `moveToTrash` (rename, auto-mkdir) with per-file error reporting and no copy/unlink fallback.

### `/scrub-restore` — restore from plugin trash
- Usage: `/scrub-restore` (no flags).
- Lists files in `getTrashDir()` contents; empty/missing dir → `notify(info, "No trashed sessions for this project.")`, exit.
- Non-TUI: notify list only. TUI: per-item `confirm()` loop → `moveFromTrash` per file (mkdir sessions dir, never overwrite existing target, per-file catch + continue) → post-run `notify(info, "Restored X sessions.")`.
- Manual path (README): `mv <trashDir>/<session>.jsonl <sessionsDir>/<session>.jsonl`.

### `/scrub-init` — write POLICY block
- Usage: `/scrub-init` (no flags).
- Reads project-local `AGENTS.md` (create when absent). When `<!-- pi-session-scrub:start -->` block exists → notify + exit (idempotent, never duplicate).
- Otherwise appends the generic commented template (proposal §4.4, F4 grammar) with `<flow-name-1>, <flow-name-2>` placeholders preserved when the user supplies no flows, then notifies success.

## Requirements

### REQ-01 — D2 classification predicate with 7-day constant
The system MUST classify every listed session per the D2 decision tree using `MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000`: live sessions are never actionable; named sessions are actionable ONLY with verdict `trash`; unnamed `trash`/`finished` verdicts are candidates; empty sessions are auto-deletable; old sessions (age ≥ MAX_AGE_MS) surface as `old-needs-confirm` with full detail; everything else is kept.

#### Scenario: named session without trash verdict is protected
- GIVEN a session with `name = "feat/auth"`, no `trash` verdict
- WHEN `classifySession` runs
- THEN the result is `{ kind: "named-protected" }` and `/scrub-apply` never lists it.

#### Scenario: empty session is auto-deletable
- GIVEN an unnamed session with `messageCount === 0`
- WHEN `classifySession` runs (any verdict except `trash`, which takes the candidate path)
- THEN the result is `{ kind: "auto-deletable", reason: "empty" }`.

#### Scenario: old session requires confirm with detail
- GIVEN an unnamed session created 8 days ago with content and no verdict
- WHEN `classifySession` runs
- THEN the result is `old-needs-confirm` carrying name/firstMessage/messageCount/created/modified/verdict.

### REQ-02 — Deterministic ephemeral-flow match only
The system MUST propose `ephemeral` candidates ONLY when `matchesEphemeralFlow` finds an exact invocation of a flow name listed in POLICY `ephemeral-flows:` (or when verdict is `ephemeral`); there MUST be no fuzzy single-task heuristic, and a match MUST only propose — never auto-trash.

#### Scenario: listed flow invocation is a candidate
- GIVEN POLICY `ephemeral-flows: [gentle-main-update]` and a session invoking `/skill:gentle-main-update`
- WHEN classified
- THEN the result is `{ kind: "candidate", reason: "ephemeral" }`.

#### Scenario: unlisted content is never ephemeral
- GIVEN an empty POLICY list and a short single-task session
- WHEN classified
- THEN the result is NOT an ephemeral candidate.

**Verification note:** verdict-path ephemeral was exercised live (T2d PASS); the live skill-log scan path (regex vs real `/skill:` log line) is code-reviewed + `tsc` clean but not yet exercised against a real skill run — one follow-up trial with a real skill invocation is recommended, non-blocking.

### REQ-03 — POLICY grammar and conservative default
The system MUST parse the POLICY block per F4 (`#`/blank ignored; `verdicts:`/`mark-on:`/`ephemeral-flows:` keys; `<...>` placeholders = empty; absent/unparseable = conservative default with empty ephemeral-flows and no agent marking).

#### Scenario: absent block disables ephemeral matching
- GIVEN a project AGENTS.md with no `pi-session-scrub` block
- WHEN `/scrub` runs
- THEN `ephemeralFlows` is `[]` and no session classifies as ephemeral by match.

#### Scenario: placeholders parse as empty
- GIVEN a block containing only `ephemeral-flows: <flow-name-1>, <flow-name-2>`
- WHEN parsed
- THEN `ephemeralFlows` is `[]`.

### REQ-04 — `scrub_mark` verdict tool with versioned data
The system MUST expose a model-invoked `scrub_mark` tool accepting verdict `keep | paused | finished | ephemeral | trash` plus optional `reason`, persisting `{ customType: "session-scrub/verdict", data: { version: 1, verdict, at, reason? } }` as a custom entry that MUST NOT participate in LLM context; latest `at` wins on read.

#### Scenario: agent marks finished with reason
- GIVEN the tool is invoked with `{ verdict: "finished", reason: "PR merged" }`
- WHEN the handler runs
- THEN one versioned custom entry is appended and a later `/scrub` classifies the session as `candidate/finished`.

#### Scenario: invalid verdict rejected
- GIVEN `{ verdict: "done" }`
- WHEN the handler runs
- THEN it returns a tool error and writes nothing.

### REQ-05 — `/scrub` is read-only and cross-checkable
The system MUST implement `/scrub` as a pure audit whose counts reconcile with the `/resume` picker (live shown, never hidden), and it MUST NOT write files, move sessions, or prompt.

#### Scenario: audit leaves filesystem untouched
- GIVEN 12 sessions on disk
- WHEN `/scrub` runs
- THEN the session file set is identical, no trash dir is created, and the summary counts sum to the listed total.

### REQ-06 — `/scrub-apply` with dry-run, consent, and trash move
The system MUST implement `/scrub-apply [--dry-run]` so that dry-run (flag or non-TUI) only notifies, TUI selection requires explicit per-item consent via the `confirm()` loop, execution uses `moveToTrash` (rename, auto-mkdir) with per-file error reporting and no copy/unlink fallback, and a post-run re-list reports trashed/remaining counts.

#### Scenario: dry-run changes nothing
- GIVEN 2 candidates and `--dry-run`
- WHEN `/scrub-apply --dry-run` runs
- THEN it notifies the 2-item detail list and moves zero files.

#### Scenario: confirmed selection moves exactly the selection
- GIVEN TUI per-item confirmation of 2 of 3 candidates
- WHEN confirmed
- THEN exactly those 2 files exist under `getTrashDir()` and the re-list count drops by 2.

### REQ-07 — `/scrub-restore` round-trips trashed sessions
The system MUST implement `/scrub-restore` listing `getTrashDir()` contents, restoring the user's TUI selection via `moveFromTrash` (never overwriting), notifying the restored count, and documenting the manual `mv` recovery path.

#### Scenario: restore returns a session to audit
- GIVEN 1 trashed session for the cwd
- WHEN `/scrub-restore` restores it
- THEN the file exists in the sessions dir again and a subsequent `/scrub` lists it with verdict preserved.

### REQ-08 — `/scrub-init` writes the generic POLICY template once
The system MUST implement `/scrub-init` creating/updating project-local AGENTS.md idempotently with the delimited generic commented template (taxonomy + when-to-mark guidance + `verdicts:`/`mark-on:`/`ephemeral-flows:` keys with placeholders), never duplicating an existing block.

#### Scenario: second init is a no-op
- GIVEN AGENTS.md already contains the delimited block
- WHEN `/scrub-init` runs
- THEN it notifies "already exists" and the file is unchanged.

### REQ-09 — Once-per-session naming hint, user confirms
The system MUST surface a deterministic `deriveSlug` hint via `setStatus("scrub-name", ...)` at most once per unnamed session (gated by a `session-scrub/name-hint` custom entry plus in-memory once-set) and MUST NOT call `setSessionName()` programmatically; naming happens only via the user's `/name`.

#### Scenario: hint appears once
- GIVEN an unnamed session on first `agent_start`/`agent_end`
- WHEN the hint flow runs twice
- THEN the first run sets status + writes the gate entry and the second run does nothing.

### REQ-10 — Plugin-owned trash, reversible, no permanent delete
The system MUST move trashed sessions with atomic rename into `getTrashDir()` (auto-created sibling of the session dir), retain them indefinitely in slice 1, expose restore via command + manual `mv`, and MUST NOT call `unlink`/`rm`, the OS `trash` CLI, or any purge path; there is no `/scrub-empty` in slice 1.

#### Scenario: rename failure never deletes
- GIVEN a cross-filesystem `EXDEV` failure on `renameSync`
- WHEN `moveToTrash` runs
- THEN it throws, the source file remains intact, and the command notifies the per-file error.

### REQ-11 — Non-TUI degradation never blocks
The system MUST treat non-interactive mode (`!(mode === "tui" && hasUI)`, covering `rpc`/`json`/`print`) as implicit `--dry-run` for `/scrub-apply` and `/scrub-restore`: notify the would-be action list and exit without calling `select`/`confirm`/`input`.

#### Scenario: print mode cannot hang
- GIVEN `pi --print` invoking `/scrub-apply`
- WHEN the handler runs
- THEN it completes with a notify-only summary and zero prompts.

### REQ-12 — Strict TypeScript and work-unit budget
The system MUST ship slice 1 as TypeScript strict with const-object enums, flat interfaces, no `any` (use `unknown` + guards), core Pi libs in `peerDependencies: *`, no `session_shutdown`/`session_start` handlers (absence is intentional, T9), no `unlink`/`spawnSync`/`execSync`/`trash-cli` strings, and MUST keep docs/meta in separate commits from code.

#### Scenario: clean typecheck and scoped commit
- GIVEN the finished slice
- WHEN `tsc --strict` runs and grep gates run
- THEN typecheck passes with zero `any`, zero `session_shutdown`/`session_start` hits, zero destructive-string hits.
- **Budget note (verified):** implementation landed at ~738–794 lines vs the 400-line target; `size:exception` was explicitly accepted by the user with ledger reset. Canonical spec records the exception; it does not retroactively change the 400-line review-budget rule.

## Manual test scenarios (numbered, no automated harness yet)

1. **T1 clean boot:** `pi -e ./extensions/session-scrub/index.ts` starts with no errors; `/reload` succeeds.
2. **T2 audit truth:** seed named/unnamed/empty/old sessions; `/scrub` classifications match REQ-01; counts reconcile with `/resume` (live shown as live).
3. **T3 dry-run:** `/scrub-apply --dry-run` lists exactly the actionable set with detail; filesystem file-set identical, no trash dir created.
4. **T4 apply:** TUI per-item confirm 1–2 candidates → files appear in the plugin trash sibling dir; re-list count drops accordingly.
5. **T5 restore:** `/scrub-restore` lists trashed; confirm one → file returns to sessions dir with verdict preserved; `/scrub` shows it again; trash empty.
6. **T6 EXDEV honesty:** by inspection + throwing rename path — per-file error notified; source intact; no fallback copy/unlink (no destructive path exists in code).
7. **T7 non-TUI:** `pi --print` (and `--json`) `/scrub-apply` and `/scrub-restore` complete with notify-only output, exit 0; no hang.
8. **T8 hint once:** fresh unnamed session shows `sugerido: /name <slug>` once; second trigger silent; slug matches `deriveSlug` rules; gate entry `{ version: 1, slug, offeredAt }` on disk.
9. **T9 silent close:** session shutdown produces no keep-vs-trash prompt (no `session_shutdown` handler in source).
10. **T10 init idempotent:** `/scrub-init` writes delimited block; rerun notifies "already exists" with no duplication.
11. **T11 verdict round-trip:** invoke `scrub_mark({ verdict: "finished", reason: "PR merged" })`; entry readable via `getEntries()` with `version: 1`; `/scrub` shows candidate/finished; invalid verdict → tool error, nothing written.
12. **T12 strict + gates:** `tsc --strict` passes, zero `any`, zero `session_shutdown`, zero destructive strings, esbuild bundle clean.

## Out of scope (deferred, not specified here)

Global `listAll()` view, custom `ctx.ui.custom()` picker, compaction-hook summaries, LLM naming / programmatic `setSessionName()`, sidecar verdict files, `/scrub-empty` purge, OS trash integration, close-time prompts.

---

## Slice 2 — triage (`session-scrub-triage`, appended by sdd-sync 2026-09-14)

**Source:** `openspec/changes/session-scrub-triage/spec.md` (TR-01..TR-13) AS-BUILT per `openspec/changes/session-scrub-triage/verify-report.md` (verdict pass, 13/13 REQ, 17/17 scenarios, 0 blockers) + `apply-progress.md` (T1–T12 12/12). Slice-1 content above (REQ-01..REQ-12) is untouched and remains normative.

**Command:** `/scrub-triage [--dry-run]` (phase 1, digest, read-only) + `/scrub-triage --apply <short-id:verdict:"reason"> [...] [--dry-run]` (phase 2, confirmed write). Reason is MANDATORY, stored verbatim; `trash` never suggested/parsed/appended; live file never opened for write.

**Type model (additive, strict, flat, no `any`):** `TRIAGE_VERDICT` const-object `{ keep, paused, finished, ephemeral }` (singular name AS-BUILT; values reuse `VERDICTS` subset, never redefined); `TRIAGE_GRADE` const-object `{ machine, weak, judged }`; bounds `HEAD_DIGEST_CHARS = 300`, `TAIL_DIGEST_CHARS = 300`, `MAX_DIGEST_SESSIONS = 20`; flat `DigestPack`, `WeakGuess`, `MachineFact`, `ApplyAssignment`, `ResolvedAssignment`, `RejectedAssignment` (+ mechanical additive `TriageCandidate`, `OrderedMessage` carrying entries for lazy extraction). Exactly one `registerCommand("scrub-triage")`; no new entry types; no `ctx.ui.custom()`; no `session_shutdown`/`session_start`/`unlink` additions; no POLICY-grammar or trash-layout changes.

### Slice-2 verified deviations (ACCEPTED 2026-09-14 in `bed10e5` — normative over design/spec draft wording)

1. Tail chronological: last-3 assistant + last-2 user merged in file order via `orderedMessageTexts`, front-truncated (`truncateTailFromFront`) — design said assistant-first/back-truncated. Preserves closure order; bound identical.
2. `stripForQuote` also strips U+200B–U+200D + U+FEFF (invisible chars never reach pasted verdict lines).
3. Apply reasons support `\"`/`\\` escapes (`unescapeReason`, symmetric with `escapeQuote`); round-trip tested.
4. `appendVerdictToOther` takes `livePath`, refuses gone files / live session (strictly stronger defence in depth at the write site).
5. Lazy text extraction: `TriageCandidate` carries entries; `orderedMessageTexts` runs only for shown packs (pure perf shape, zero behavior change).
6. Candidate sort key is `modified` (was `created`); named-first tier unchanged; recency-of-touch triage order, documented in README.
7. Pre-append recheck idempotent: identical concurrent verdict counts as triaged (info, no duplicate append); different verdict skips (warning). No duplicate verdict entries.
8. Categorized final summary (applied + already / declined / conflict / error with shortIds); still contains the `Re-run /scrub…` line.

Minor variances (ACCEPT, not gaps): `buildDigestPack` takes `OrderedMessage[]` instead of two arrays (deviation 1/5 consequence); ANSI strip covers SGR-`m` only; head truncation yields bound+1 chars max (`slice(0, 300) + "…"`); phase-2 dry-run notify lists parsed assignments; provenance shows MACHINE/WEAK (the assignment itself is the judged verdict).

### TR-01 — Triage set excludes live, empty, and ephemeral-match sessions

The system MUST define the triage set as sessions with `verdict === undefined` that are NOT live, NOT `messageCount === 0`, and NOT `matchedEphemeralFlow`. Empty sessions MUST be skipped with a counted line (`emptySkipped`). Ephemeral-match sessions MUST be skipped with a counted line (`ephemeralSkipped`). The live session MUST never appear (samePath/id drop).

#### Scenario: verdict-less session with content qualifies
- GIVEN a non-live session with content, no verdict, and no ephemeral match
- WHEN phase 1 builds the triage set
- THEN the session appears as exactly one digest pack.

#### Scenario: empty and ephemeral-match sessions are counted skips
- GIVEN one empty session and one ephemeral-match session, both verdict-less
- WHEN phase 1 runs
- THEN neither appears as a pack and the notify carries two counted skip lines.

### TR-02 — Bounded digest pack schema with deferral notice

The system MUST emit at most 20 packs per run, each with head ≤ 300c (+1 verified variance, `…` U+2026 mark) and tail ≤ 300c (front-truncated AS-BUILT), truncation flagged, plus msgs, age, created, modified, optional named and flow lines, and one weak-guess line. When the triage set exceeds the cap, the system MUST append `+R more deferred — triage these first, then re-run.` and MUST never silently drop sessions. Sort order MUST be machine-grade (named→keep) first, then human-grade by `modified` (deviation 6, recency proxy).

#### Scenario: oversized triage set defers explicitly
- GIVEN 25 verdict-less qualifying sessions
- WHEN phase 1 runs
- THEN exactly 20 packs are emitted plus a `+5 more deferred` notice.

#### Scenario: bounds hold on long sessions
- GIVEN a session whose first user message is 2000 chars
- WHEN its pack is built
- THEN head is ≤ 301 chars ending with `…` and `headTruncated` is true (bound+1 verified variance; token-bounding purpose unaffected).

### TR-03 — Machine-grade facts stay deterministic and minimal

The system MUST state machine-grade rows as facts: named verdict-less → `keep` with rationale `named session — presumed active` rendered as `NAMED → keep (machine)`. The system MUST NOT propose any other deterministic verdict. Empty and ephemeral-match conditions MUST NOT produce proposals.

#### Scenario: named session proposes keep as fact
- GIVEN a named verdict-less session in the triage set
- WHEN phase 1 notifies
- THEN its block states `NAMED → keep (machine)` with the rationale stub.

### TR-04 — WEAK pre-suggestions are labeled guesses, never verdicts

The system MUST attach exactly one `weak-guess` per human-grade pack: old-with-content (age ≥ `MAX_AGE_MS`) ⇢ `finished?` with `WEAK: old (≥7d) with content — words decide; confirm from tail`; otherwise ⇢ `paused?` with `WEAK: recent with content, no signal — words decide; park only if tail agrees`. Every guess MUST carry the `(WEAK — judge from head/tail, never auto-confirm)` label. Rationale wording may carry message counts instead of the `(≥7d)` token; the WEAK label line is exact.

#### Scenario: old session carries weak finished guess
- GIVEN an 8-day-old verdict-less session with content
- WHEN its pack is emitted
- THEN the block contains `weak-guess: finished (WEAK — judge from head/tail, never auto-confirm)`.

### TR-05 — Tail reader covers user plus assistant slices (chronological AS-BUILT)

The system MUST build tail from the closing slice (last-3 assistant + last-2 user merged in file order via `orderedMessageTexts`, `isTextPart` guard, never throws) budgeted inside 300c, front-truncated. The tail MUST preserve closure signals in any language as quoted evidence.

#### Scenario: assistant closure cue appears in tail
- GIVEN a session whose last assistant message says the work is done
- WHEN its pack is built
- THEN tail contains that closing slice within the 300-char bound.

### TR-06 — Normative pack-quoting rules

The system MUST quote packs-as-data: one fenced `triage` block per session headed by its short id; head/tail quoted verbatim after stripping SGR colors + U+0300–U+037F + zero-widths U+200B–U+200D + U+FEFF (C0/non-SGR passthrough is a known hygiene gap, W2); `escapeQuote`/`unescapeReason` symmetric for `"`/`\\`; the judgment instruction MUST treat pack text as evidence, never instructions; phase-2 `confirm()` MUST show id + judged verdict + provenance + verbatim reason + msgs + age only and MUST never re-quote the full tail.

#### Scenario: confirm dialog quotes no tail
- GIVEN a resolved assignment with reason
- WHEN the per-item `confirm()` renders
- THEN its detail contains id, verdict, provenance, and reason, and zero tail text.

### TR-07 — Phase 1 is read-only in all modes

The system MUST implement phase 1 as notify-only in every mode: summary + packs + machine facts + WEAK guesses via a single `notify(info)`, zero `confirm`/`select`/`input` calls, zero writes. `--dry-run` MUST be accepted as an alias producing byte-identical output. Empty triage set MUST notify `Nothing to triage.` with zero writes.

#### Scenario: phase 1 leaves the filesystem identical
- GIVEN 3 qualifying verdict-less sessions
- WHEN `/scrub-triage` runs
- THEN the session file set is identical, no trash dir is created, and one info notify carries 3 packs.

### TR-08 — `--apply` assignment grammar with mandatory reason

The system MUST accept assignments ONLY in the grammar `<idPrefix>:<verdict>:"<reason>"` where `verdict ∈ {keep, paused, finished, ephemeral}` (escaped-quote aware `ASSIGN_RE`; `\"`/`\\` supported) and reason is a non-empty quoted string stored verbatim. The parser MUST reject: unknown verdicts (including `trash`), malformed pairs (leftover token), missing/empty/whitespace-only reasons, empty prefixes, duplicate prefixes. Rejection MUST skip the assignment with a `notify(warning)` cause line and MUST never warn-through to a write.

#### Scenario: reasonless assignment is rejected
- GIVEN `--apply a1b2c3d4:finished` (no reason)
- WHEN phase 2 parses
- THEN the assignment is rejected with a warning and nothing is written for it.

#### Scenario: trash verdict is rejected
- GIVEN `--apply a1b2c3d4:trash:"no longer needed"`
- WHEN phase 2 parses
- THEN the assignment is rejected with a warning and nothing is written.

### TR-09 — Fresh resolution with unambiguous prefix and staleness rejection

The system MUST resolve every parsed assignment against a fresh `gatherTriageCandidates` at `--apply` time: the `idPrefix` MUST match exactly one triage-set session via `startsWith` (unknown → reject; ≥2 → ambiguous reject); the target MUST still be verdict-less (verdict since appeared or session gone → stale reject). Resolution MUST run before any `confirm()`.

#### Scenario: stale assignment is skipped
- GIVEN a digest pack for session X, then a verdict is recorded on X before `--apply`
- WHEN `--apply <X-prefix>:finished:"done"` runs
- THEN the assignment is rejected as stale with a warning and X is untouched.

### TR-10 — Per-item confirm with pre-append freshness recheck and other-file append

The system MUST dispose each resolved assignment via a per-item `confirm(title `Triage <shortId> as <verdict>?`, detail provenance MACHINE/WEAK + verbatim reason + msgs + age, never tail)` loop; chat approval alone MUST NOT write. On yes, the handler MUST re-read the target verdict immediately before appending — identical concurrent verdict counts as triaged-info (no duplicate append, deviation 7); different verdict → skip with warning — then call `appendVerdictToOther` (asserts `verdict !== "trash"` + non-live via `samePath`/id + `livePath`; body `SessionManager.open(path).appendCustomEntry("session-scrub/verdict", { version: 1, verdict, at, reason })`; caller catches per file). On no → skip. Per-file failures MUST notify warning + continue. Empty confirmed set MUST notify `Cancelled.` with zero writes. Post-run MUST re-read each written file and notify the categorized summary (applied + already / declined / conflict / error with shortIds, deviation 8) including `Triaged X of N sessions. Re-run /scrub to see new classifications.`

#### Scenario: confirmed write round-trips
- GIVEN a resolved `keep` assignment confirmed yes in TUI
- WHEN the loop disposes it
- THEN the other session file gains one `session-scrub/verdict` entry with the verbatim reason and `readLatestVerdict` returns `keep`.

#### Scenario: race between confirm and append is caught
- GIVEN a yes answer where another verdict landed after resolution
- WHEN the pre-append recheck runs
- THEN a differing verdict is skipped with a warning and the file is unchanged; an identical verdict counts as triaged-info with no duplicate.

### TR-11 — Dry-run invariance and non-TUI choke for phase 2

The system MUST treat phase 2 as dry-run when `--dry-run` is passed OR NOT (`mode === "tui" && hasUI`) via `resolveDryRun(args, ctx)` at phase-2 entry before any `confirm`: notify the resolved/rejected assignment list (parsed assignments in dry-run, W3 info) and exit with zero prompts and zero writes. Only flags are `--dry-run` and `--apply`; no `--force` exists.

#### Scenario: non-TUI apply writes nothing
- GIVEN `pi --print` invoking `/scrub-triage --apply <valid assignment>`
- WHEN the handler runs
- THEN it completes with a notify-only summary, zero prompts, zero writes.

### TR-12 — Idempotency, live-exclusion, and never-trash invariants

The system MUST guarantee: re-running phase 1 after all sessions carry verdicts notifies `Nothing to triage.`; the live file is never opened for write (excluded by construction plus non-live assert in `appendVerdictToOther`); `trash` is never proposed, never parsed (rejected at parse + re-asserted at append), never appended from triage; post-triage `/scrub` reflects the new verdicts.

#### Scenario: second run is a no-op
- GIVEN all former triage sessions now carry verdicts
- WHEN phase 1 re-runs
- THEN it notifies `Nothing to triage.` with zero writes.

### TR-13 — Strict TypeScript, flat types, no new surfaces

The system MUST ship triage as TypeScript strict with const-object verdict/grade maps, flat interfaces (no inline nested objects), no `any` (use `unknown` + guards), core Pi libs in `peerDependencies: *`, exactly one `registerCommand("scrub-triage")` addition, no new entry types, no `ctx.ui.custom()` picker, no `session_shutdown`/`session_start`/`unlink` additions, and no POLICY-grammar or trash-layout changes.

#### Scenario: clean typecheck and grep gates
- GIVEN the finished slice
- WHEN `tsc --strict` runs and grep gates run
- THEN typecheck passes with zero `any` and zero new `session_shutdown`/`session_start`/`unlink` hits.

### Slice-2 manual test scenarios (TT1–TT12, triage only — slice-1 T1…T12 still apply)

1. TT1 clean boot · 2. TT2 digest truth (3 packs named-first + 2 counted skips, live absent) · 3. TT3 bounds + deferral (20 packs + `+R more deferred`, `…` marks) · 4. TT4 WEAK labels · 5. TT5 phase-1 invariance (file-set identical, no trash dir, `--dry-run` byte-identical) · 6. TT6 reason-mandatory · 7. TT7 stale/ambiguous · 8. TT8 confirmed write (verbatim reason round-trip) · 9. TT9 race recheck (idempotent-skip) · 10. TT10 post-triage reconcile (`Nothing to triage.` + `/scrub` reflects) · 11. TT11 non-TUI (`pi --print` both phases notify-only, exit 0, no hang) · 12. TT12 strict + gates (`tsc` clean, zero `any`, zero new lifecycle/unlink; budget `size:exception` accepted at commit time for `f5d4940` +486/-4, see verify-report W5).

---

## Slice 3 — triage UX (`session-scrub-triage-ux`, appended by sdd-sync 2026-09-14)

**Source:** `openspec/changes/session-scrub-triage-ux/spec.md` (legacy flat delta, UX-01..UX-08) AS-BUILT per `openspec/changes/session-scrub-triage-ux/verify-report.md` (verdict pass, 8/8 REQ, 15/15 scenarios, 0 blockers, 0 critical) + `tasks.md` (T1–T12 12/12) + code `dcf567c` (+457/-112) + meta `1002e04`. Slice-1 (REQ-01..REQ-12) and Slice-2 (TR-01..TR-13) content above is untouched and remains normative. This section is additive only; no Slice-1/2 requirement was modified or removed in the canonical file.

**Command:** `/scrub-triage [--verbose] [--dry-run]` (phase 1) + `/scrub-triage --apply <assignment> [...] [--verbose] [--dry-run]` (phase 2). Only flags are `--apply`, `--dry-run`, `--verbose`; no `--force` exists. Triage set unchanged (TR-01): verdict-less AND non-live AND non-empty AND non-ephemeral-match. Named-exclusion explicitly OUT — named sessions stay in the triage set; only their confirm path is fast-laned.

**Type model (additive, strict, flat, no `any`):** `MachineKeepBulk { shortIds: string[]; rationale: string }` (confirm-time view only, not persisted), `RenameAssignment { idPrefix: string; slug: string }`, `ResolvedRename { assignment: RenameAssignment; targetPath: string; shortId: string; existingName: string | undefined }`, `RejectedRename { raw: string; cause: string }`. Slice-2 maps/bounds reused verbatim (`TRIAGE_VERDICT`, `TRIAGE_GRADE`, `HEAD_DIGEST_CHARS = 300`, `TAIL_DIGEST_CHARS = 300`, `MAX_DIGEST_SESSIONS = 20`). Still exactly one `registerCommand("scrub-triage")`; no new entry types beyond `session-scrub/verdict` + `session_info`; no `ctx.ui.custom()`; no `session_shutdown`/`session_start`/`unlink` additions.

**AS-BUILT deviations (ACCEPTED in verify-report, normative):** (1) Phase-1 visual order is WEAK-packs-then-machine-table (spec UX-01 scenario + TU1 govern over design §7 machine-first listing; machine rows stay compact-only by default either way). (2) Dry-run choke lives post-resolve inside phase 2 (design §7 provenance/existing→proposed/bulk-date preview needs resolution; non-TUI notify-only preserved). W1 (no TDD Cycle Evidence table; manual TU1–TU8 + 45-check harness convention, same as Slice-2) is a warning, not a blocker. W2 (`size:exception` +457/-112 accepted by user, recorded in `dcf567c` commit message) is a process note, not a correctness blocker.

### UX-01 — WEAK-first page composition with machine fill to cap 20

The system MUST compose phase-1 page 1 as WEAK-first + machine fill to cap `MAX_DIGEST_SESSIONS` (20, unchanged): in-memory `partitionTriageCandidates` over the already-gathered list (machine-keep ⟺ `info.name` non-blank after trim; rest → weakQueue; no second `list()`/`open()`), `weakQueue` by `modified` descending first, then `machineKeeps` in gather order stable; `page = ordered.slice(0, 20)`, `deferred = ordered.slice(20)`. Deferred membership changes by design: machine-keeps defer, not WEAK packs. Supersedes TR-02 named-first display order for page composition; `gatherTriageCandidates` internal behavior unchanged.

#### Scenario: WEAK packs lead page 1 in a 27-session run
- GIVEN 27 qualifying sessions (7 WEAK + 20 named machine-keeps)
- WHEN phase 1 composes page 1
- THEN all 7 WEAK rows appear before any machine row and the page holds at most 20 rows total.

#### Scenario: machine-keeps defer, not WEAK
- GIVEN 25 qualifying sessions (5 WEAK + 20 machine-keeps, cap 20)
- WHEN phase 1 runs
- THEN all 5 WEAK rows are shown and the deferred line (UX-06) lists only machine-keep shortIds.

### UX-02 — Compact table default with `--verbose` full packs

The system MUST render phase 1 as a compact table by default with schema `<short> · <msgs>msgs · <age>d · [named "<name>" | unnamed] · <weak-guess> · <head-first-~120c>` (prefix of the already-built head sliced to 120 chars + `…` when longer, `escapeQuote` on render; name via `named "<escapeQuote(name)>"`, else literal `unnamed`). Default (no flag): compact rows for shown machine sessions + full `formatDigestPack` blocks for shown WEAK sessions only, zero machine full packs. `--verbose`: compact table always present + full packs for every shown session. Full-pack-only content (full 300c head, 300c chronological tail, ISO created/modified, rationale stubs) MUST never appear in compact rows. Flag parsed as `verbose = args.split(/\s+/).includes("--verbose")`, threaded into phase 1 and phase-2 echo; `--verbose` added to the parse-cleaning strip list. Supersedes TR-02/TR-06 full-pack-per-session default.

#### Scenario: default run shows machine table plus WEAK packs
- GIVEN 3 machine-keeps and 2 WEAK sessions
- WHEN `/scrub-triage` runs without flags
- THEN one notify carries 3 compact machine rows plus 2 WEAK full packs, and zero machine full packs.

#### Scenario: verbose restores full packs
- GIVEN the same 5 sessions
- WHEN `/scrub-triage --verbose` runs
- THEN the notify carries full packs for all 5 shown sessions plus the compact table.

### UX-03 — Machine-keep fast-lane bulk confirm with fixed dated default rationale

The system MUST fast-lane the machine-keep subset (`resolved.filter(provenance === MACHINE && verdict === KEEP)`) through exactly ONE bulk `confirm()`: title `Keep <N> machine sessions? (<short1>, <short2>, …)`, detail shared rationale + per-file msgs/age fragments, never tail. Rationale MUST be the fixed string `machine keep, bulk-confirmed <YYYY-MM-DD>` where `<YYYY-MM-DD>` is the UTC date of the `--apply` run (`toISOString().slice(0, 10)`), computed once, stored verbatim as `reason` per file in each `session-scrub/verdict { version: 1, verdict: "keep", at, reason }` entry. On yes: per-file body identical to Slice-2 (pre-append `readLatestVerdict` recheck, try/catch append, post-write re-read, shared counters); on no: all bulk shortIds → `declined`, zero writes. Mixed sets MUST bulk-confirm machine first, then the WEAK per-item loop. Bulk confirm MUST never include WEAK rows.

#### Scenario: one confirm writes the default rationale verbatim to every machine file
- GIVEN 5 resolved machine-keep `keep` assignments confirmed yes in the single bulk confirm (TUI)
- WHEN the loop disposes them
- THEN each of the 5 files gains one `session-scrub/verdict` entry with `reason` exactly `machine keep, bulk-confirmed <today-UTC-date>` and `readLatestVerdict` returns `keep` for each.

#### Scenario: bulk confirm never covers WEAK
- GIVEN a mixed set of 2 machine-keeps + 1 WEAK assignment
- WHEN phase 2 confirms
- THEN the bulk confirm lists only the 2 machine shortIds and the WEAK assignment is disposed via its own per-item confirm.

### UX-04 — Reason stays mandatory for WEAK and judged verdicts

The system MUST keep `reason` mandatory for every WEAK/judged assignment (`<idPrefix>:<verdict>:"<reason>"`, `verdict ∈ {keep, paused, finished, ephemeral}`, non-empty quoted reason stored verbatim). Parser accepts bare `<prefix>:keep` provisionally (`reason: ""`) for the UX-03 bulk path only; bare `paused|finished|ephemeral` stays rejected (`missing judged rationale`), bare `trash` rejected (`trash never appliable`). Post-resolve provenance gate: reasonless keep on MACHINE inherits the bulk rationale; on WEAK/unknown/ambiguous/stale → rejected (`reasonless keep is machine-only — WEAK needs id:keep:"reason"`), warning, zero writes.

#### Scenario: reasonless WEAK assignment is rejected
- GIVEN `--apply a1b2c3d4:finished` targeting a WEAK session
- WHEN phase 2 parses/resolves
- THEN the assignment is rejected with a warning and nothing is written for it.

#### Scenario: whitespace-only reason is rejected
- GIVEN `--apply a1b2c3d4:paused:"   "`
- WHEN phase 2 parses
- THEN the assignment is rejected with a warning and nothing is written for it.

### UX-05 — Inline rename in triage flow

The system MUST accept renames as own lines `id:name:"slug"`, parallel to verdict triples, parsed alongside via `RENAME_RE = /(\S+?):name:"((?:[^"\\]|\\.)*)"/g` with shared-cursor merge (rename tokens never surface as verdict `malformed pair` leftovers and vice versa). Slug norm: `unescapeReason(raw).replace(/[\r\n]+/g, " ").trim()`; empty-after-trim → rejected `empty rename slug`, never writes (clear-by-empty NOT exposed in triage). Duplicate `idPrefix` across rename ok-list or verdict/rename collision → second rejected `duplicate assignment`; first proceeds. No charset/length/uniqueness checks — duplicates allowed, last-write-wins per file, identity stays path (mirrors `/name`). Writer `appendRenameToOther(sessionPath, slug, livePath?)` (throwing; mirrors `appendVerdictToOther`: `existsSync` gone-file refusal + live refusal via `samePath`/id; slug non-empty re-assert; body `SessionManager.open(path).appendSessionInfo(slug)`, append-only) + existing-name surfacing (`existingName` from resolve-time `info.name`) + post-write re-read (`getSessionName()` equality, mismatch → warning + error bucket). Confirm is per-item `confirm(title Rename <short> to "<slug>"?, detail existing="<existing ?? (unnamed)>" → proposed="<slug>" · msgs · age)` even when verdicts bulk-confirm. Resolve reuses fresh-resolve order (unknown/ambiguous/stale reject before any confirm).

#### Scenario: rename round-trips to /resume
- GIVEN `--apply a1b2c3d4:name:"auth-flow"` confirmed yes in TUI
- WHEN the rename loop disposes it
- THEN the target file gains one `session_info` entry and a fresh open reads `getSessionName()` as `auth-flow`, visible in `/resume`.

#### Scenario: duplicate slugs allowed, identity stays path
- GIVEN two sessions renamed to the same slug `"auth-flow"`, both confirmed
- WHEN both appends complete
- THEN both files read `auth-flow` and each remains addressable by its own shortId/path.

#### Scenario: empty slug rejected, overwrite visible
- GIVEN `--apply a1b2c3d4:name:"   "` and a rename targeting a session already named `"old-name"`
- WHEN phase 2 parses and confirms
- THEN the empty slug is rejected with a warning and zero writes, and the valid rename's confirm detail contains both the new slug and the existing name `old-name`.

### UX-06 — Transparent deferred shortId list

The system MUST replace the opaque `+R more deferred` line with `deferred (<R>): <short1>, <short2>, …` listing `ordered.slice(20)` shortIds in UX-01 page order (+ optional msgs/age only if bounded; no packs, no guesses; deferred rows never reach `buildDigestPack`/`suggestTriageWeak`). The system MUST never silently drop sessions; every candidate is either paged or listed. Supersedes TR-02 `+R more deferred — triage these first, then re-run.` line.

#### Scenario: deferred identities are visible
- GIVEN 25 qualifying sessions (cap 20)
- WHEN phase 1 runs
- THEN the notify ends with a deferred line listing exactly the 5 deferred shortIds in page order.

### UX-07 — Slice-2 safety invariants restated (untouched)

The system MUST preserve all Slice-2 safety invariants unchanged under the UX layer: fresh resolve at `--apply` time (`startsWith` prefix, unknown/ambiguous/stale reject before any confirm); WEAK per-item `confirm()` retained (title `Triage <shortId> as <verdict>?`, detail provenance MACHINE/WEAK + verbatim reason + msgs + age, never tail); pre-append recheck immediately before each append (identical concurrent verdict counts as triaged-info with no duplicate, different verdict skips with warning); `trash` never suggested, never parsed (rejected at parse + re-asserted at append), never appended; dry-run choke + non-TUI notify-only with zero prompts and zero writes; live-exclusion (live never opened for write, asserted at write site); append-only writes with post-write re-read and categorized summary; per-file try/catch + continue; empty confirmed set notifies `Cancelled.` with zero writes.

#### Scenario: race between confirm and append is caught under bulk
- GIVEN a bulk-confirmed machine `keep` where another verdict landed after resolution
- WHEN the per-file pre-append recheck runs
- THEN a differing verdict is skipped with a warning and the file is unchanged; an identical verdict counts as triaged-info with no duplicate append.

#### Scenario: non-TUI apply writes nothing
- GIVEN `pi --print` invoking `/scrub-triage --apply <valid assignment>`
- WHEN the handler runs
- THEN it completes with a notify-only summary, zero prompts, zero writes.

### UX-08 — Strict TypeScript, flat types, no new surfaces, budget

The system MUST ship the UX layer as TypeScript strict with const-object verdict/grade maps, flat interfaces (no inline nested objects), no `any` (zero code `any`; 3 `any` hits are English comment words only), core Pi libs in `peerDependencies: *`, still exactly one `registerCommand("scrub-triage")` (5 commands total, unchanged), no new entry types beyond `session-scrub/verdict` + `session_info`, no `ctx.ui.custom()` picker, no `session_shutdown`/`session_start`/`unlink` additions, and no POLICY-grammar, trash-layout, triage-set, or scope changes. Docs/meta in a separate commit from code (T12 `1002e04`). Budget: code `dcf567c` +457/-112 (net new ≈ 345); `size:exception` accepted by the user (preflight + commit message), recorded here; it does not change the 400-line review-budget rule.

#### Scenario: clean typecheck and grep gates
- GIVEN the finished change
- WHEN `tsc --strict` runs and grep gates run
- THEN typecheck passes with zero code `any` and zero new `session_shutdown`/`session_start`/`unlink`/`ctx.ui.custom` hits.

### Slice-3 manual test scenarios (TU1–TU8, UX only — Slice-1 T1…T12 and Slice-2 TT1…TT12 still apply)

1. TU1 WEAK-first page (7 WEAK + 20 machine → WEAK first, cap 20; 5 WEAK + 20 machine → deferred lists machine shortIds only; 45/45 harness re-run PASS). 2. TU2 compact default schema (machine one-liners + WEAK packs, zero machine full packs). 3. TU3 verbose (adds machine packs, table always present). 4. TU4 bulk machine round-trip (reasonless keeps → ONE confirm → verbatim rationale per file, append-only, `readLatestVerdict` returns `keep`). 5. TU5 WEAK reason-mandatory (reasonless WEAK `finished` rejected zero-write; with reason per-item; mixed bulk-first). 6. TU6 rename round-trip (round-trips to `/resume`; duplicates coexist with path identity; `:name:"   "` rejected zero-write; confirm shows existing name; T1 trial-file round-trip re-confirmed). 7. TU7 deferred transparency (25 qualifying → 5 shortIds in page order; 27/27 listed, nothing dropped). 8. TU8 invariants (stale/ambiguous pre-confirm reject, trash rejected, reasonless-unknown rejected, live absent, non-TUI notify-only zero-write, race skip-warning zero overwrite, dry-run previews zero-write).

