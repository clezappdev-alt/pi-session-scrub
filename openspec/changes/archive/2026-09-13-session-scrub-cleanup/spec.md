# Specification — session-scrub-cleanup (slice 1)

**Change:** `session-scrub-cleanup` · **Revision:** spec v1 (2026-09-11, retry)
**Inputs:** proposal.md rev 2 (+D5/D6), research.md rev 2 + addendum, PRD.md v0.1, AGENTS.md, openspec/config.yaml (pi 0.85.1)
**Scope:** first product slice, one work-unit commit ≤ 400 changed lines. No canonical spec exists for domain `session-scrub`; this file is the full domain spec for the change (written flat at `openspec/changes/session-scrub-cleanup/spec.md` per explicit retry instruction, deviating from `specs/{domain}/spec.md` layout — see Risks).

## Purpose

Keep the per-project Pi `/resume` list clean and descriptive at zero token cost by default: opt-in audit (`/scrub`), explicit user-disposed trash (`/scrub-apply`, reversible via `/scrub-restore`), project-local verdict policy (`/scrub-init` + `scrub_mark`), and a once-per-session deterministic naming hint. Nothing runs unless the user invokes a command; the live session is never touched; nothing is permanently deleted in slice 1.

## Fixed decisions (from proposal — recorded, not reopened)

- **F1** `MAX_AGE_MS` is the constant `7 * 24 * 60 * 60 * 1000` (7 days). No configuration surface in slice 1.
- **F2** No `--force` flag exists. Every destructive path requires explicit per-item selection (TUI) or is dry-run only (non-TUI).
- **F3** Custom entry types: `session-scrub/name-hint` and `session-scrub/verdict`. Verdict payload shape: `{ version: 1, verdict, at, reason? }`.
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

// SessionInfo mirrors Pi 0.85.1 SessionManager.list (research C1, re-verified on 0.85.1).
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

interface VerdictPayload {
  version: 1;
  verdict: Verdict;
  at: string;
  reason?: string;
}

interface NameHintPayload {
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

// Trash layout. getTrashDir mirrors Pi's per-project keying:
// <piAgentDir>/session-scrub-trash/--<cwd>--/ (slash→"-", see VERIFY-3).
declare function getTrashDir(cwd: string): string;
// Atomic rename session file → trash dir (auto-mkdir recursive). Returns trash path.
// MUST throw on failure (EXDEV/permissions) — never copy+unlink fallback.
declare function moveToTrash(sessionPath: string, cwd: string): string;
// Atomic rename trash file → sessions dir. Returns restored path. Throws on failure.
declare function moveFromTrash(trashedPath: string, cwd: string): string;

// Reads latest verdict for one session file via getEntries(); filters
// customType === "session-scrub/verdict"; orders by payload.at; returns
// undefined when none/unparseable. Never throws on malformed entries.
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
// { customType: "session-scrub/verdict", payload: VerdictPayload }.
// Rejects unknown verdict values with a tool error; never writes.
declare function handleScrubMark(input: {
  verdict: Verdict;
  reason?: string;
}): Promise<{ ok: true }>;
```

**VERIFY steps for apply phase** (Pi 0.85.1 dist could not be re-read from this session; specify most-probable shape, verify before coding):

- **VERIFY-1** `registerCommand` / `registerTool` / event names: most probable per research C7/C8 + proposal §8 — `pi.registerCommand(name, handler)`, `pi.registerTool({ name: "scrub_mark", ... })`, `pi.on("agent_start", handler)`. At apply start, open `dist/core/extensions/types.d.ts` and confirm exact names/signatures; if `registerTool` takes `(name, def)` positionally, adapt handler registration, not the spec behavior.
- **VERIFY-2** `ui.select` multi-select: proposal assumes a multi-select list. Most probable shape is single-select or `(message, options)` returning one value. If no multi-select exists, specify per-item `confirm()` loop as the compliant fallback (still explicit per-item consent; no behavior change).
- **VERIFY-3** cwd→`--<cwd>--` keying: most probable is Pi's `session-manager` `dirFor(cwd)` transform (slashes/specials → `-`, wrapped in `--`). At apply start, read the transform from dist and reuse it verbatim for `getTrashDir`; never invent a parallel scheme.
- **VERIFY-4** custom-entry write path: most probable is `ctx.sessionManager.appendCustomEntry({ customType, payload })` and read via `getEntries()` filtering `type === "custom"` (proposal §8, research addendum). Confirm `appendCustomEntry` signature and the `CustomEntry` field names in dist; keep `customType` strings and `version: 1` payload regardless.

## Command specifications

### `/scrub` — read-only audit
- Usage: `/scrub` (no flags). MUST NOT mutate any file.
- Lists `SessionManager.list(ctx.cwd)`, reads latest verdict per session, classifies with `classifySession`, emits one `notify(info)` summary line with counts (`total · named · auto-deletable · candidates (by reason) · old-needs-confirm · kept · live`) plus per-session detail rows (name/firstMessage, messageCount, created, verdict, classification).
- Counts MUST exclude nothing silently: live session appears as `live`, never as actionable.

### `/scrub-apply` — dispose with consent
- Usage: `/scrub-apply [--dry-run]`.
- Actionable set = `auto-deletable` + `candidate` + `old-needs-confirm` (old rows carry full `SessionDetail`).
- `dryRun` is true when `--dry-run` passed OR `ctx.hasUI === false`. Dry-run path: `notify(info)` full candidate list, exit, zero mutations.
- TUI path (`ctx.hasUI === true`): interactive selection over the actionable set (multi-select when available, else VERIFY-2 per-item confirm loop); empty selection → `notify("Cancelled.", info)`, exit; confirmed selection → `moveToTrash` per file (per-file error notify, continue); post-run re-list + `notify(info, "Trashed X … Remaining: Y …")`.

### `/scrub-restore` — restore from plugin trash
- Usage: `/scrub-restore` (no flags).
- Lists files in `getTrashDir(ctx.cwd)`; empty/missing dir → `notify(info, "No trashed sessions for this project.")`, exit.
- Non-TUI: notify list only. TUI: interactive selection → `moveFromTrash` per file → post-run `notify(info, "Restored X sessions.")`.
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

### REQ-04 — `scrub_mark` verdict tool with versioned payload
The system MUST expose a model-invoked `scrub_mark` tool accepting verdict `keep | paused | finished | ephemeral | trash` plus optional `reason`, persisting `{ customType: "session-scrub/verdict", payload: { version: 1, verdict, at, reason? } }` as a custom entry that MUST NOT participate in LLM context; latest `at` wins on read.

#### Scenario: agent marks finished with reason
- GIVEN the tool is invoked with `{ verdict: "finished", reason: "PR merged" }`
- WHEN the handler runs
- THEN one versioned custom entry is appended and a later `/scrub` classifies the session as `candidate/finished`.

#### Scenario: invalid verdict rejected
- GIVEN `{ verdict: "done" }`
- WHEN the handler runs
- THEN it returns a tool error and writes nothing.

### REQ-05 — `/scrub` is read-only and cross-checkable
The system MUST implement `/scrub` as a pure audit whose counts reconcile with the `/resume` picker minus nothing (live shown, never hidden), and it MUST NOT write files, move sessions, or prompt.

#### Scenario: audit leaves filesystem untouched
- GIVEN 12 sessions on disk
- WHEN `/scrub` runs
- THEN all 12 files remain byte-identical and the summary counts sum to 12.

### REQ-06 — `/scrub-apply` with dry-run, consent, and trash move
The system MUST implement `/scrub-apply [--dry-run]` so that dry-run (flag or `!hasUI`) only notifies, TUI selection requires explicit per-item consent, execution uses `moveToTrash` (rename, auto-mkdir) with per-file error reporting and no copy/unlink fallback, and a post-run re-list reports trashed/remaining counts.

#### Scenario: dry-run changes nothing
- GIVEN 2 candidates and `--dry-run`
- WHEN `/scrub-apply --dry-run` runs
- THEN it notifies the 2-item detail list and moves zero files.

#### Scenario: confirmed selection moves exactly the selection
- GIVEN TUI selection of 2 of 3 candidates
- WHEN confirmed
- THEN exactly those 2 files exist under `getTrashDir(cwd)` and the re-list count drops by 2.

### REQ-07 — `/scrub-restore` round-trips trashed sessions
The system MUST implement `/scrub-restore` listing `getTrashDir(cwd)` contents, restoring the user's TUI selection via `moveFromTrash`, notifying the restored count, and documenting the manual `mv` recovery path.

#### Scenario: restore returns a session to audit
- GIVEN 1 trashed session for the cwd
- WHEN `/scrub-restore` restores it
- THEN the file exists in the sessions dir again and a subsequent `/scrub` lists it.

### REQ-08 — `/scrub-init` writes the generic POLICY template once
The system MUST implement `/scrub-init` creating/updating project-local AGENTS.md idempotently with the delimited generic commented template (taxonomy + when-to-mark guidance + `verdicts:`/`mark-on:`/`ephemeral-flows:` keys with placeholders), never duplicating an existing block.

#### Scenario: second init is a no-op
- GIVEN AGENTS.md already contains the delimited block
- WHEN `/scrub-init` runs
- THEN it notifies "already exists" and the file is unchanged.

### REQ-09 — Once-per-session naming hint, user confirms
The system MUST surface a deterministic `deriveSlug` hint via `setStatus("scrub-name", ...)` at most once per unnamed session (gated by a `session-scrub/name-hint` custom entry) and MUST NOT call `setSessionName()` programmatically; naming happens only via the user's `/name`.

#### Scenario: hint appears once
- GIVEN an unnamed session on first `agent_start`
- WHEN the hint flow runs twice
- THEN the first run sets status + writes the gate entry and the second run does nothing.

### REQ-10 — Plugin-owned trash, reversible, no permanent delete
The system MUST move trashed sessions with atomic rename into `getTrashDir(cwd)` (auto-created), retain them indefinitely in slice 1, expose restore via command + manual `mv`, and MUST NOT call `unlink`/`rm`, the OS `trash` CLI, or any purge path; there is no `/scrub-empty` in slice 1.

#### Scenario: rename failure never deletes
- GIVEN a cross-filesystem `EXDEV` failure on `renameSync`
- WHEN `moveToTrash` runs
- THEN it throws, the source file remains intact, and the command notifies the per-file error.

### REQ-11 — Non-TUI degradation never blocks
The system MUST treat `ctx.hasUI === false` (`rpc`/`json`/`print`) as implicit `--dry-run` for `/scrub-apply` and `/scrub-restore`: notify the would-be action list and exit without calling `select`/`confirm`/`input`.

#### Scenario: print mode cannot hang
- GIVEN `pi --print` invoking `/scrub-apply`
- WHEN the handler runs
- THEN it completes with a notify-only summary and zero prompts.

### REQ-12 — Strict TypeScript and work-unit budget
The system MUST ship slice 1 as TypeScript strict with const-object enums, flat interfaces, no `any` (use `unknown` + guards), core Pi libs in `peerDependencies: *`, and MUST keep the code commit ≤ 400 changed lines with meta/docs in separate commits.

#### Scenario: clean typecheck and scoped commit
- GIVEN the finished slice
- WHEN `tsc --strict` runs and the code commit is measured
- THEN typecheck passes with zero `any` and the code commit touches ≤ 400 lines excluding docs/meta.

## Manual test scenarios (numbered, no automated harness yet)

1. **T1 clean boot:** `pi -e ./extensions/session-scrub/index.ts` starts with no errors; `/reload` succeeds.
2. **T2 audit truth:** seed named/unnamed/empty/old sessions; `/scrub` classifications match REQ-01; counts reconcile with `/resume` (live excluded from actionable, shown as live).
3. **T3 dry-run:** `/scrub-apply --dry-run` lists exactly the actionable set with detail; filesystem unchanged (checksums before/after equal).
4. **T4 apply:** TUI select 1–2 candidates → confirm → files appear in `~/.pi/agent/session-scrub-trash/--<cwd>--/`; re-list count drops accordingly.
5. **T5 restore:** `/scrub-restore` lists trashed; select one → confirm → file returns to sessions dir; `/scrub` shows it again.
6. **T6 EXDEV honesty:** simulate cross-filesystem failure (or mock rename to throw EXDEV); per-file error notified; source intact; no fallback copy/unlink.
7. **T7 non-TUI:** `pi --print` (and `--json`) `/scrub-apply` and `/scrub-restore` complete with notify-only output; no hang waiting for input.
8. **T8 hint once:** fresh unnamed session shows `sugerido: /name <slug>` once; second `agent_start` silent; slug matches `deriveSlug` rules (lowercase, diacritics stripped, ≤60 chars).
9. **T9 silent close:** session shutdown produces no keep-vs-trash prompt (no `session_shutdown` handler).
10. **T10 init idempotent:** `/scrub-init` writes delimited block; rerun notifies "already exists" with no duplication.
11. **T11 verdict round-trip:** invoke `scrub_mark({ verdict: "finished", reason: "PR merged" })`; entry readable via `getEntries()` with `version: 1`; `/scrub` shows candidate/finished.
12. **T12 strict + budget:** `tsc --strict` passes, no `any` in diff, code commit ≤ 400 lines (docs/meta separate).

## Out of scope (deferred, not specified here)

Global `listAll()` view, custom `ctx.ui.custom()` picker, compaction-hook summaries, LLM naming / programmatic `setSessionName()`, sidecar verdict files, `/scrub-empty` purge, OS trash integration, close-time prompts.
