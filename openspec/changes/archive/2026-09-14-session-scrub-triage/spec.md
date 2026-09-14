# Delta for session-scrub — triage (`session-scrub-triage`, proposal rev 2 + JD rounds 1–2)

**Change:** `session-scrub-triage` · **Domain:** `session-scrub` · **Against canonical:** `openspec/specs/session-scrub/spec.md` (REQ-01…REQ-12)
**Scope lock:** proposal rev 2 + JD round 1 [F1–F7] + round 2 [mandatory reason]. No expansion, no reopened decisions.
**Shape note:** this change writes the legacy flat path `openspec/changes/session-scrub-triage/spec.md` per explicit task instruction (not `specs/{domain}/spec.md`).

## Fixed decisions (recorded, not reopened)

1. One command, two invocations: `/scrub-triage [--dry-run]` (phase 1, digest) + `/scrub-triage --apply <id:verdict:"reason"> [...] [--dry-run]` (phase 2, confirmed write).
2. `reason` is MANDATORY in every `--apply` assignment; missing/empty reason → assignment rejected, never warned-through (JD round 2).
3. Triage set = verdict-less AND non-live AND non-empty AND non-ephemeral-match.
4. Machine-grade deterministic: named verdict-less → `keep` only. Empty and ephemeral-match are skips with counted lines, never proposals.
5. Human-grade (`finished` vs `paused` vs `keep` for the rest) is model judgment over digest packs in chat, never code heuristics.
6. WEAK pre-suggestions are labeled guesses, never verdicts.
7. Quoting rules are normative (§ pack schema): fenced per-session blocks, ANSI/control-strip, `…` truncation marks, `confirm()` never re-quotes full tail.
8. Per-item freshness recheck immediately before EACH append; stale → skip with warning.
9. `trash` is never suggested and rejected in `--apply`. Live file is never opened for write.
10. Interactive gate is `mode === "tui" && hasUI` (canonical deviation 1, reused). Phase 2 in non-TUI → implicit dry-run, zero prompts, zero writes.
11. Bounds are normative defaults: `HEAD_DIGEST_CHARS = 300`, `TAIL_DIGEST_CHARS = 300`, `MAX_DIGEST_SESSIONS = 20`; remainder deferred with explicit counted notice.

## Type model (TypeScript strict, flat interfaces, no `any`)

```ts
const TRIAGE_VERDICT = {
  KEEP: "keep",
  PAUSED: "paused",
  FINISHED: "finished",
  EPHEMERAL: "ephemeral",
} as const;
type TriageVerdict = (typeof TRIAGE_VERDICT)[keyof typeof TRIAGE_VERDICT];

const TRIAGE_GRADE = {
  MACHINE: "machine",
  WEAK: "weak",
  JUDGED: "judged",
} as const;
type TriageGrade = (typeof TRIAGE_GRADE)[keyof typeof TRIAGE_GRADE];

// Normative bounds (tunable only via a follow-up spec change).
const HEAD_DIGEST_CHARS = 300;
const TAIL_DIGEST_CHARS = 300;
const MAX_DIGEST_SESSIONS = 20;

interface DigestPack {
  shortId: string;
  messageCount: number;
  ageDays: number;
  created: string;
  modified: string;
  sessionName: string | undefined;
  flowName: string | undefined;
  head: string;
  tail: string;
  headTruncated: boolean;
  tailTruncated: boolean;
}

interface WeakGuess {
  shortId: string;
  grade: typeof TRIAGE_GRADE.WEAK;
  guess: TriageVerdict;
  rationale: string;
}

interface MachineFact {
  shortId: string;
  grade: typeof TRIAGE_GRADE.MACHINE;
  proposal: typeof TRIAGE_VERDICT.KEEP;
  rationale: string;
}

interface ApplyAssignment {
  idPrefix: string;
  verdict: TriageVerdict;
  reason: string;
}

interface ResolvedAssignment {
  assignment: ApplyAssignment;
  targetPath: string;
  shortId: string;
  provenance: TriageGrade;
}

interface RejectedAssignment {
  raw: string;
  cause: string;
}
```

## Function signatures (WHAT, not HOW)

```ts
// Pure: bounded digest pack over user + assistant texts. Head = first user
// message; tail = closing user/assistant slice. Both truncated to their
// bound with truncation flags; ANSI/control chars stripped.
declare function buildDigestPack(
  args: { shortId: string; messageCount: number; created: Date; modified: Date; sessionName?: string; flowName?: string },
  userMessages: string[],
  assistantMessages: string[],
): DigestPack;

// Pure reader over entries: assistant message texts in order (userTexts
// sibling for the closing slice; F1-F2). Never throws on malformed entries.
declare function assistantTexts(entries: unknown): string[];

// Pure: WEAK pre-suggestion only. old-with-content → finished?; else paused?.
// Always labeled WEAK; never a verdict, never auto-confirmed.
declare function suggestTriageWeak(
  args: { shortId: string; messageCount: number; ageMs: number; maxAgeMs: number },
): WeakGuess;

// Pure: parses "--apply" assignments of grammar
//   <idPrefix>:<verdict>:"<reason>"  (reason MANDATORY, stored verbatim).
// Rejects unknown verdicts (incl. trash), malformed pairs, missing/empty
// reason. Resolution against the fresh triage set happens in the handler.
declare function parseApplyAssignments(args: string): { ok: ResolvedAssignment["assignment"][]; rejected: RejectedAssignment[] };

// Appends a versioned verdict entry to a NON-LIVE session file. Append-only.
// Throws on failure (caller catches per file); asserts non-live; never trash.
declare function appendVerdictToOther(
  sessionPath: string,
  verdict: TriageVerdict,
  reason: string,
): Promise<void>;

// Two-mode handler. Phase 1 (no --apply): read-only digest notify, zero
// confirms, zero writes, all modes. Phase 2 (--apply): fresh re-audit →
// resolve → per-item confirm() loop → append → summary. Non-TUI phase 2 →
// implicit dry-run notify, zero writes.
declare function handleScrubTriage(args: string, ctx: unknown): Promise<void>;
```

## ADDED Requirements

### Requirement: TR-01 — Triage set excludes live, empty, and ephemeral-match sessions

The system MUST define the triage set as sessions with `verdict === undefined` that are NOT live, NOT `messageCount === 0`, and NOT `matchesEphemeralFlow(userTexts, ephemeralFlows)`. Empty sessions MUST be skipped with a counted line (already auto-deletable). Ephemeral-match sessions MUST be skipped with a counted line (already candidates via `/scrub-apply`). The live session MUST never appear in the triage set.

#### Scenario: verdict-less session with content qualifies

- GIVEN a non-live session with content, no verdict, and no ephemeral match
- WHEN phase 1 builds the triage set
- THEN the session appears as exactly one digest pack.

#### Scenario: empty and ephemeral-match sessions are counted skips

- GIVEN one empty session and one ephemeral-match session, both verdict-less
- WHEN phase 1 runs
- THEN neither appears as a pack and the notify carries two counted skip lines.

### Requirement: TR-02 — Bounded digest pack schema with deferral notice

The system MUST emit at most `MAX_DIGEST_SESSIONS` (20) packs per run, each with `head` ≤ `HEAD_DIGEST_CHARS` (300) and `tail` ≤ `TAIL_DIGEST_CHARS` (300), truncation flagged with `…`, plus `msgs`, `age`, `created`, `modified`, optional `named` and `flow` lines, and one `weak-guess` line. When the triage set exceeds the cap, the system MUST append an explicit counted remainder notice (`+R more deferred — triage these first, then re-run.`) and MUST never silently drop sessions. Sort order MUST be machine-grade (named→keep) first, then human-grade by age descending.

#### Scenario: oversized triage set defers explicitly

- GIVEN 25 verdict-less qualifying sessions
- WHEN phase 1 runs
- THEN exactly 20 packs are emitted plus a `+5 more deferred` notice.

#### Scenario: bounds hold on long sessions

- GIVEN a session whose first user message is 2000 chars
- WHEN its pack is built
- THEN `head` is ≤ 300 chars ending with `…` and `headTruncated` is true.

### Requirement: TR-03 — Machine-grade facts stay deterministic and minimal

The system MUST state machine-grade rows as facts: named verdict-less → `keep` with rationale `named session — presumed active`. The system MUST NOT propose any other deterministic verdict (no fixed finished/paused rows). Empty and ephemeral-match conditions MUST NOT produce proposals.

#### Scenario: named session proposes keep as fact

- GIVEN a named verdict-less session in the triage set
- WHEN phase 1 notifies
- THEN its block states `NAMED → keep (machine)` with the rationale stub.

### Requirement: TR-04 — WEAK pre-suggestions are labeled guesses, never verdicts

The system MUST attach exactly one `weak-guess` per human-grade pack: `old-needs-confirm` (age ≥ `MAX_AGE_MS`, has content) ⇢ `finished?` with rationale `WEAK: old (≥7d) with content — words decide; confirm from tail`; otherwise ⇢ `paused?` with rationale `WEAK: recent with content, no signal — words decide; park only if tail agrees`. Every guess MUST carry the `(WEAK — judge from head/tail, never auto-confirm)` label in every surface.

#### Scenario: old session carries weak finished guess

- GIVEN an 8-day-old verdict-less session with content
- WHEN its pack is emitted
- THEN the block contains `weak-guess: finished (WEAK — judge from head/tail, never auto-confirm)`.

### Requirement: TR-05 — Tail reader covers user plus assistant slices

The system MUST build `tail` from the closing slice of both user and assistant message texts (via `userTexts` + `assistantTexts`), budgeted inside `TAIL_DIGEST_CHARS`. The tail MUST preserve closure signals in any language as quoted evidence.

#### Scenario: assistant closure cue appears in tail

- GIVEN a session whose last assistant message says the work is done
- WHEN its pack is built
- THEN `tail` contains that closing slice within the 300-char bound.

### Requirement: TR-06 — Normative pack-quoting rules

The system MUST quote packs-as-data: one fenced block per session headed by its short id; `head`/`tail` quoted verbatim after stripping ANSI/control chars, truncated only with `…`; the judgment instruction MUST treat pack text as evidence, never instructions; phase-2 `confirm()` MUST show id + judged verdict + provenance + reason only and MUST never re-quote the full tail.

#### Scenario: confirm dialog quotes no tail

- GIVEN a resolved assignment with reason
- WHEN the per-item `confirm()` renders
- THEN its detail contains id, verdict, provenance, and reason, and zero tail text.

### Requirement: TR-07 — Phase 1 is read-only in all modes

The system MUST implement phase 1 (`/scrub-triage` without `--apply`) as notify-only in every mode: summary + packs + machine facts + WEAK guesses via a single `notify(info)`, zero `confirm`/`select`/`input` calls, zero writes. `--dry-run` MUST be accepted as an alias producing byte-identical output. Empty triage set MUST notify `Nothing to triage.` with zero writes.

#### Scenario: phase 1 leaves the filesystem identical

- GIVEN 3 qualifying verdict-less sessions
- WHEN `/scrub-triage` runs
- THEN the session file set is identical, no trash dir is created, and one info notify carries 3 packs.

### Requirement: TR-08 — `--apply` assignment grammar with mandatory reason

The system MUST accept assignments ONLY in the grammar `<idPrefix>:<verdict>:"<reason>"` where `verdict ∈ {keep, paused, finished, ephemeral}` and `reason` is a non-empty quoted string stored verbatim. The parser MUST reject: unknown verdicts (including `trash`), malformed pairs, and missing/empty reasons. Rejection MUST skip the assignment with a `notify(warning)` cause line and MUST never warn-through to a write.

#### Scenario: reasonless assignment is rejected

- GIVEN `--apply a1b2c3d4:finished` (no reason)
- WHEN phase 2 parses
- THEN the assignment is rejected with a warning and nothing is written for it.

#### Scenario: trash verdict is rejected

- GIVEN `--apply a1b2c3d4:trash:"no longer needed"`
- WHEN phase 2 parses
- THEN the assignment is rejected with a warning and nothing is written.

### Requirement: TR-09 — Fresh resolution with unambiguous prefix and staleness rejection

The system MUST resolve every parsed assignment against a fresh `auditSessions` at `--apply` time: the `idPrefix` MUST match exactly one triage-set session (unknown or ambiguous → reject with warning + skip); the target MUST still be verdict-less (verdict since appeared or session gone/trashed → reject with warning + skip). Resolution MUST run before any `confirm()`.

#### Scenario: stale assignment is skipped

- GIVEN a digest pack for session X, then a verdict is recorded on X before `--apply`
- WHEN `--apply <X-prefix>:finished:"done"` runs
- THEN the assignment is rejected as stale with a warning and X is untouched.

### Requirement: TR-10 — Per-item confirm with pre-append freshness recheck and other-file append

The system MUST dispose each resolved assignment via a per-item `confirm(title, detailRow)` loop showing short id + judged verdict + `MACHINE`/`WEAK`/`JUDGED` provenance + verbatim reason; chat approval alone MUST NOT write. On yes, the handler MUST re-read the target verdict immediately before appending — changed since resolution → skip with warning (no blind overwrite) — then call `appendVerdictToOther` (non-live assert; `session-scrub/verdict` `{ version: 1, verdict, at, reason }`). On no → skip. Per-file failures MUST notify warning + continue. Empty confirmed set MUST notify `Cancelled.` with zero writes. Post-run MUST re-read each written file and notify `Triaged X of N sessions. Re-run /scrub to see new classifications.`

#### Scenario: confirmed write round-trips

- GIVEN a resolved `keep` assignment confirmed yes in TUI
- WHEN the loop disposes it
- THEN the other session file gains one `session-scrub/verdict` entry with the verbatim reason and `readLatestVerdict` returns `keep`.

#### Scenario: race between confirm and append is caught

- GIVEN a yes answer where another verdict landed after resolution
- WHEN the pre-append recheck runs
- THEN the append is skipped with a warning and the file is unchanged.

### Requirement: TR-11 — Dry-run invariance and non-TUI choke for phase 2

The system MUST treat phase 2 as dry-run when `--dry-run` is passed OR NOT (`mode === "tui" && hasUI`): notify the resolved/rejected assignment list and exit with zero prompts and zero writes. Phase 2 MUST call `resolveDryRun(args, ctx)` at entry before any `confirm`. Only flags are `--dry-run` and `--apply`; no `--force` exists.

#### Scenario: non-TUI apply writes nothing

- GIVEN `pi --print` invoking `/scrub-triage --apply <valid assignment>`
- WHEN the handler runs
- THEN it completes with a notify-only summary, zero prompts, zero writes.

### Requirement: TR-12 — Idempotency, live-exclusion, and never-trash invariants

The system MUST guarantee: re-running phase 1 after all sessions carry verdicts notifies `Nothing to triage.`; the live file is never opened for write (excluded by construction plus non-live assert in `appendVerdictToOther`); `trash` is never proposed, never parsed, never appended from triage; post-triage `/scrub` reflects the new verdicts.

#### Scenario: second run is a no-op

- GIVEN all former triage sessions now carry verdicts
- WHEN phase 1 re-runs
- THEN it notifies `Nothing to triage.` with zero writes.

### Requirement: TR-13 — Strict TypeScript, flat types, no new surfaces

The system MUST ship triage as TypeScript strict with const-object verdict/grade maps, flat interfaces (no inline nested objects), no `any` (use `unknown` + guards), core Pi libs in `peerDependencies: *`, exactly one `registerCommand("scrub-triage", …)` addition, no new entry types, no `ctx.ui.custom()` picker, no `session_shutdown`/`session_start`/`unlink` additions, and no POLICY-grammar or trash-layout changes.

#### Scenario: clean typecheck and grep gates

- GIVEN the finished slice
- WHEN `tsc --strict` runs and grep gates run
- THEN typecheck passes with zero `any` and zero new `session_shutdown`/`session_start`/`unlink` hits.

## Manual test scenarios (numbered, triage only — slice-1 T1…T12 still apply)

1. **TT1 clean boot:** `pi -e ./extensions/session-scrub/index.ts` starts clean; `/reload` succeeds; `/scrub-triage` is listed.
2. **TT2 digest truth:** seed 3 verdict-less sessions (1 named, 1 old-with-content, 1 recent-with-content) + 1 empty + 1 ephemeral-match + live; phase 1 shows exactly 3 packs (named first), 2 counted skip lines, live absent.
3. **TT3 bounds + deferral:** seed 22 qualifying sessions; phase 1 emits 20 packs (head/tail ≤ 300c, `…` marks) + `+2 more deferred` notice.
4. **TT4 WEAK labels:** old-with-content pack shows `weak-guess: finished (WEAK …)`; recent pack shows `weak-guess: paused (WEAK …)`; named pack shows `NAMED → keep (machine)`, no weak-guess verdict.
5. **TT5 phase-1 invariance:** run phase 1 twice; session file set identical both times, no trash dir, `--dry-run` output byte-identical.
6. **TT6 reason-mandatory:** `--apply <id>:finished` (no reason) → rejected with warning, zero writes; `--apply <id>:trash:"x"` → rejected, zero writes.
7. **TT7 stale/ambiguous:** verdict a target after the digest, then `--apply` it → skipped stale with notice; two sessions sharing an `idPrefix` → ambiguous reject with notice.
8. **TT8 confirmed write:** TUI `--apply a:finished:"merged PR" b:paused:"waiting on review"` → per-item confirms → yes-items carry new `session-scrub/verdict { version: 1, … }` with verbatim reasons; no-items unchanged; touched files append-only.
9. **TT9 race recheck:** approve an item, land a verdict on its file before its append (or simulate via re-mark), confirm the handler skips with warning.
10. **TT10 post-triage reconcile:** `/scrub` reflects new verdicts; re-run phase 1 → `Nothing to triage.`
11. **TT11 non-TUI:** `pi --print /scrub-triage` notifies packs; `pi --print /scrub-triage --apply …` notifies resolved list, zero writes, exit 0, no hang.
12. **TT12 strict + gates:** `tsc --strict` passes, zero `any`, zero new lifecycle/unlink strings, single work-unit code commit ≤ 400 lines (~150–190 estimated).

## Out of scope (locked non-goals, not specified here)

Second command name, in-handler model judgment (single-run show+confirm), full-log judging, dedicated bulk-confirm path, custom `ctx.ui.custom()` picker, auto-suggesting `trash`, touching empties, cross-project triage, close-time prompt, `/scrub-empty`.
