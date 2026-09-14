# Delta for session-scrub — triage UX (`session-scrub-triage-ux`)

**Change:** `session-scrub-triage-ux` · **Domain:** `session-scrub` · **Against canonical:** `openspec/specs/session-scrub/spec.md` (Slice 2 TR-01..TR-13)
**Predecessor (read-only, do not modify):** `openspec/changes/archive/2026-09-14-session-scrub-triage/spec.md` (TR-01..TR-13)
**Shape note:** this change writes the legacy flat path `openspec/changes/session-scrub-triage-ux/spec.md` per explicit task instruction (not `specs/{domain}/spec.md`).
**Scope lock:** confirmed rules handoff — fast-lane machine bulk, WEAK-first + machine fill to cap 20, compact default + `--verbose`, `id:name:"slug"` rename, transparent deferred IDs, named-exclusion OUT, Slice-2 safety invariants untouched. No new command, no new TUI surface, no new triage set.

## Fixed decisions (recorded, not reopened)

1. One command, two invocations stays: `/scrub-triage [--verbose] [--dry-run]` (phase 1) + `/scrub-triage --apply <assignment> [...] [--verbose] [--dry-run]` (phase 2). Only flags are `--apply`, `--dry-run`, `--verbose`; no `--force` exists.
2. Triage set is unchanged (TR-01): verdict-less AND non-live AND non-empty AND non-ephemeral-match. Named-exclusion is explicitly OUT — named sessions stay in the triage set; only their confirm path is fast-laned.
3. Bulk rationale is a fixed dated default string stored verbatim per file (UX-03). Reason stays mandatory for all WEAK/judged verdict assignments (UX-04).
4. Rename grammar is own-line `id:name:"slug"`, parallel to verdict triples, writer `SessionManager.open(other).appendSessionInfo` (UX-05). Slug policy mirrors `/name`: trim + non-empty; duplicates allowed; identity stays file path.
5. Page-1 composition is WEAK-first + machine fill to cap `MAX_DIGEST_SESSIONS = 20` unchanged (UX-01). Deferred membership changes by design: machine-keeps defer, not WEAK packs.
6. Slice-2 safety invariants are untouched and restated normatively (UX-07): fresh resolve, WEAK per-item confirm, pre-append recheck, trash never appliable, dry-run choke, live-exclusion, append-only + re-read, per-file catch.

## Type model (additive, TypeScript strict, flat interfaces, no `any`)

```ts
// Existing Slice-2 maps/bounds reused verbatim, never redefined:
// TRIAGE_VERDICT { keep, paused, finished, ephemeral }, TRIAGE_GRADE { machine, weak, judged },
// HEAD_DIGEST_CHARS = 300, TAIL_DIGEST_CHARS = 300, MAX_DIGEST_SESSIONS = 20.

interface MachineKeepBulk {
  shortIds: string[];
  rationale: string; // fixed default, stored verbatim per file (UX-03)
}

interface RenameAssignment {
  idPrefix: string;
  slug: string; // trimmed, non-empty (UX-05)
}

interface ResolvedRename {
  assignment: RenameAssignment;
  targetPath: string;
  shortId: string;
  existingName: string | undefined;
}

interface RejectedRename {
  raw: string;
  cause: string;
}
```

## Function signatures (WHAT, not HOW)

```ts
// Pure: in-memory partition of the already-gathered candidate list.
// machineKeeps = named (info.name non-blank); weakQueue = rest. No new reads.
declare function partitionTriageCandidates(candidates: unknown): { machineKeeps: unknown[]; weakQueue: unknown[] };

// Pure: one-line compact row per session (UX-02 schema). Prefix of already-built head, no new extraction.
declare function formatCompactRow(args: { shortId: string; messageCount: number; ageDays: number; sessionName?: string; weakGuess: string; head: string }): string;

// Pure: parses rename lines `id:name:"slug"` (own line, parallel to verdict triples).
// Rejects empty/whitespace-only slugs; trims; newlines collapse to space.
declare function parseRenameAssignments(args: string): { ok: RenameAssignment[]; rejected: RejectedRename[] };

// Appends a session_info entry to a NON-LIVE session file. Append-only.
// Throws on failure (caller catches per file); asserts non-live; surfaces existing name at confirm time.
declare function appendRenameToOther(sessionPath: string, slug: string): Promise<void>;
```

## MODIFIED Requirements

### Requirement: UX-01 — WEAK-first page composition with machine fill to cap 20

The system MUST compose phase-1 page 1 as WEAK-first + machine fill to cap `MAX_DIGEST_SESSIONS` (20, unchanged): `weakQueue` sorted by `modified` descending first, then `machineKeeps` (named, `info.name` non-blank) to fill to 20. The partition MUST happen in memory over the already-gathered candidate list after `gatherTriageCandidates`, before rendering, with no second `list()`/`open()` pass. Deferred membership therefore changes by design: machine-keeps defer, not WEAK packs.
(Previously: TR-02 sorted machine-grade named-first, then human-grade by `modified`; WEAK packs fell into the deferred tail.)

#### Scenario: WEAK packs lead page 1 in a 27-session run

- GIVEN 27 qualifying sessions (7 WEAK + 20 named machine-keeps)
- WHEN phase 1 composes page 1
- THEN all 7 WEAK rows appear before any machine row and the page holds at most 20 rows total.

#### Scenario: machine-keeps defer, not WEAK

- GIVEN 25 qualifying sessions (5 WEAK + 20 machine-keeps, cap 20)
- WHEN phase 1 runs
- THEN all 5 WEAK rows are shown and the deferred line (UX-06) lists only machine-keep shortIds.

### Requirement: UX-02 — Compact table default with `--verbose` full packs

The system MUST render phase 1 as a compact table by default with schema `<short> · <msgs>msgs · <age>d · [named "<name>" | unnamed] · <weak-guess> · <head-first-~120c>` (head prefix of the already-built head, no new extraction). The system MUST show full packs (300c head / 300c tail / ISO created-modified / rationale stubs) for WEAK rows by default, and MUST show everything-full only behind `--verbose`. Full-pack-only content (full 300c head, 300c chronological tail, ISO dates, rationale stubs) MUST never be the default wall for machine rows.
(Previously: TR-02/TR-06 rendered one fenced full `formatDigestPack` block per session as the default.)

#### Scenario: default run shows machine table plus WEAK packs

- GIVEN 3 machine-keeps and 2 WEAK sessions
- WHEN `/scrub-triage` runs without flags
- THEN one notify carries 3 compact machine rows plus 2 WEAK full packs, and zero machine full packs.

#### Scenario: verbose restores full packs

- GIVEN the same 5 sessions
- WHEN `/scrub-triage --verbose` runs
- THEN the notify carries full packs for all 5 shown sessions plus the compact table.

### Requirement: UX-06 — Transparent deferred shortId list

The system MUST replace the opaque `+R more deferred` counted line with a deferred-ID line listing the shortIds of `candidates.slice(20)` in the UX-01 page order, plus optional msgs/age per row. Deferred rows MUST carry no packs, no guesses. The system MUST never silently drop sessions; re-run stability follows from the unchanged sort within each partition.
(Previously: TR-02 appended `+R more deferred — triage these first, then re-run.` with no identities.)

#### Scenario: deferred identities are visible

- GIVEN 25 qualifying sessions (cap 20)
- WHEN phase 1 runs
- THEN the notify ends with a deferred line listing exactly the 5 deferred shortIds in page order.

## ADDED Requirements

### Requirement: UX-03 — Machine-keep fast-lane bulk confirm with fixed dated default rationale

The system MUST fast-lane the machine-keep subset through exactly ONE bulk `confirm()` for the whole subset: title lists the count + shortIds, detail carries the shared rationale. The bulk rationale MUST be the fixed string `machine keep, bulk-confirmed <YYYY-MM-DD>` where `<YYYY-MM-DD>` is the UTC date of the `--apply` run, stored verbatim as `reason` per file in each `session-scrub/verdict` entry (`{ version: 1, verdict: "keep", at, reason }`). The parser MUST accept the reasonless machine-keep form `<idPrefix>:keep` (no quoted reason) ONLY for machine-provenance targets; the bulk confirm MUST cover machine-keeps only and MUST never include WEAK rows. Pre-append recheck MUST stay per-file even under one confirm (UX-07). Mixed sets MUST bulk-confirm the machine subset first, then per-item the WEAK rest.

#### Scenario: one confirm writes the default rationale verbatim to every machine file

- GIVEN 5 resolved machine-keep `keep` assignments confirmed yes in the single bulk confirm (TUI)
- WHEN the loop disposes them
- THEN each of the 5 files gains one `session-scrub/verdict` entry with `reason` exactly `machine keep, bulk-confirmed <today-UTC-date>` and `readLatestVerdict` returns `keep` for each.

#### Scenario: bulk confirm never covers WEAK

- GIVEN a mixed set of 2 machine-keeps + 1 WEAK assignment
- WHEN phase 2 confirms
- THEN the bulk confirm lists only the 2 machine shortIds and the WEAK assignment is disposed via its own per-item confirm.

### Requirement: UX-04 — Reason stays mandatory for WEAK and judged verdicts

The system MUST keep `reason` mandatory for every WEAK/judged assignment: grammar `<idPrefix>:<verdict>:"<reason>"` with `verdict ∈ {keep, paused, finished, ephemeral}` and non-empty quoted reason stored verbatim. The parser MUST reject reasonless, missing-reason, or whitespace-only-reason WEAK/judged assignments with a `notify(warning)` cause line and MUST never warn-through to a write. The reasonless form is accepted ONLY for machine-keep targets under UX-03.

#### Scenario: reasonless WEAK assignment is rejected

- GIVEN `--apply a1b2c3d4:finished` targeting a WEAK session
- WHEN phase 2 parses
- THEN the assignment is rejected with a warning and nothing is written for it.

#### Scenario: whitespace-only reason is rejected

- GIVEN `--apply a1b2c3d4:paused:"   "`
- WHEN phase 2 parses
- THEN the assignment is rejected with a warning and nothing is written for it.

### Requirement: UX-05 — Inline rename in triage flow

The system MUST accept renames as own lines `id:name:"slug"`, parallel to verdict triples, parsed alongside (not inside) verdict assignments. The slug MUST be `trim()`med with `\r\n` runs collapsed to a single space (mirroring `appendSessionInfo`); empty-after-trim MUST be rejected with a `notify(warning)` cause line and MUST never write (clear-by-empty is NOT exposed in triage, though empty explicitly clears per dist semantics outside triage). Duplicate slugs MUST be allowed like `/name` today (no charset / length / uniqueness checks); last-write-wins per file; session identity stays the file path, never the name. The writer MUST be `SessionManager.open(other).appendSessionInfo` on the non-live target with per-file try/catch and a live-exclusion assert mirroring `appendVerdictToOther` (refuses gone files / live session). The rename confirm MUST surface the existing name in the detail (so overwrites are visible) and MUST be a per-item `confirm()` per rename even when verdicts bulk-confirm. Rename resolution MUST reuse the fresh-resolve order (unknown/ambiguous/stale reject before any confirm, UX-07).

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

### Requirement: UX-07 — Slice-2 safety invariants restated (untouched)

The system MUST preserve all Slice-2 safety invariants unchanged under the UX layer: fresh resolve at `--apply` time (`startsWith` prefix, unknown/ambiguous/stale reject before any confirm); WEAK per-item `confirm()` retained (title `Triage <shortId> as <verdict>?`, detail provenance MACHINE/WEAK + verbatim reason + msgs + age, never tail); pre-append recheck immediately before each append (identical concurrent verdict counts as triaged-info with no duplicate, different verdict skips with warning); `trash` never suggested, never parsed (rejected at parse + re-asserted at append), never appended; dry-run choke via `resolveDryRun` at `--apply` entry + non-TUI notify-only with zero prompts and zero writes; live-exclusion (live never opened for write, asserted at the write site); append-only writes with post-write re-read and categorized summary; per-file try/catch + continue; empty confirmed set notifies `Cancelled.` with zero writes.

#### Scenario: race between confirm and append is caught under bulk

- GIVEN a bulk-confirmed machine `keep` where another verdict landed after resolution
- WHEN the per-file pre-append recheck runs
- THEN a differing verdict is skipped with a warning and the file is unchanged; an identical verdict counts as triaged-info with no duplicate append.

#### Scenario: non-TUI apply writes nothing

- GIVEN `pi --print` invoking `/scrub-triage --apply <valid assignment>`
- WHEN the handler runs
- THEN it completes with a notify-only summary, zero prompts, zero writes.

### Requirement: UX-08 — Strict TypeScript, flat types, no new surfaces, budget

The system MUST ship the UX layer as TypeScript strict with const-object verdict/grade maps, flat interfaces (no inline nested objects), no `any` (use `unknown` + guards), core Pi libs in `peerDependencies: *`, still exactly one `registerCommand("scrub-triage")`, no new entry types beyond `session-scrub/verdict` + `session_info`, no `ctx.ui.custom()` picker, no `session_shutdown`/`session_start`/`unlink` additions, and no POLICY-grammar, trash-layout, triage-set, or scope changes. The code commit MUST stay ≤ 400 changed lines (README in a separate meta commit per repo rules).

#### Scenario: clean typecheck and grep gates

- GIVEN the finished change
- WHEN `tsc --strict` runs and grep gates run
- THEN typecheck passes with zero `any` and zero new `session_shutdown`/`session_start`/`unlink`/`ctx.ui.custom` hits.

## Manual test scenarios (numbered, UX only — Slice-2 TT1…TT12 still apply)

1. **TU1 WEAK-first page:** seed 7 WEAK + 20 machine-keeps; phase 1 shows WEAK rows first, cap 20, deferred line lists machine shortIds only.
2. **TU2 compact default:** default run shows machine one-liners matching `<short> · <msgs>msgs · <age>d · named/unnamed · guess · head-120c`; no machine full packs; WEAK full packs present.
3. **TU3 verbose:** `--verbose` shows full packs for every shown session.
4. **TU4 bulk machine:** TUI `--apply` with 5 reasonless machine `keep` lines → ONE bulk confirm → yes writes all 5 with verbatim `machine keep, bulk-confirmed <date>`; no-items unchanged.
5. **TU5 WEAK reason-mandatory:** `--apply <weak>:finished` (no reason) → rejected with warning, zero writes; with reason → per-item confirm as before.
6. **TU6 rename round-trip:** TUI `--apply <id>:name:"slug"` → per-item confirm showing existing name → `/resume` shows the slug; duplicate slugs on two files both read back; empty slug rejected.
7. **TU7 deferred transparency:** 25 qualifying sessions → deferred line lists exactly 5 shortIds in page order, no packs/guesses for deferred.
8. **TU8 invariants hold:** stale/ambiguous reject before confirm; trash rejected; `pi --print --apply` notify-only; live never written; pre-append race skip verified.

## Out of scope (locked non-goals, not specified here)

Excluding named sessions from the triage set (explicitly OUT — named stay in set); second command name; `ctx.ui.custom()` picker; touching empties (`emptySkipped` line unchanged, empties stay on `/scrub-apply`); cross-project triage (`SessionManager.list(ctx.cwd)` unchanged); auto-trash; POLICY-grammar or trash-layout changes.
