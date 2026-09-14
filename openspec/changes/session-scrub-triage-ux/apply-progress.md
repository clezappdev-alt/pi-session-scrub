# Apply progress — session-scrub-triage-ux

**Change:** `session-scrub-triage-ux` · **Store:** openspec repo-local · **Executor:** SDD apply phase (T1–T11; T12 explicitly OUT — parent handles)
**Skill:** `pi-plugin-dev` SKILL.md read before work (paths-injected) + `references/`-level API knowledge (no new APIs used)
**Attempt:** continued active attempt token `sha256:8fd40c65…9770df` (acquire → `state: proceed`, work-unit `triage-ux-implement`, max 400 lines)
**Files touched (allowed):** `extensions/session-scrub/index.ts` (code), `openspec/changes/session-scrub-triage-ux/tasks.md` (T1–T11 ticked), this file. No commit (parent commits). No README/spec/archive changes.

## Completed

- [x] T1 — PASS. Trial-file round-trip on `/tmp/scrub-t1/trial-{a,b}.jsonl` (copies of a real session, real sessions untouched) via pinned Pi 0.85.1 dist `SessionManager`: `open(other).appendSessionInfo("dup-name")` on both → entries 101→102, lines 102→103, append-only prefix check true, fresh-open `getSessionName()` reads `dup-name` on both (duplicate slugs coexist, path identity intact). Dist re-check, no drift vs explore §2: `normalizeSessionName` = trim/undefined-if-empty (`dist/cli/args.js:10`); `appendSessionInfo` = `\r\n→space` + trim, appends `session_info` (`dist/core/session-manager.js:848`); `getSessionName` = latest `session_info`, trim, empty clears (`:861`).
- [x] T2 — flat `MachineKeepBulk` / `RenameAssignment` / `ResolvedRename` / `RejectedRename` added; const-object maps reused verbatim. `tsc --strict` clean, zero-`any` (remaining `any` hits are English words in comments).
- [x] T3 — `partitionTriageCandidates` (named-test verbatim, weakQueue modified-desc, machineKeeps gather-order stable) + `ordered = weak+machine`, `page = slice(0,20)`, `deferred = slice(20)`. Verified: 7 WEAK + 20 machine seed → page holds 7 WEAK first, cap 20.
- [x] T4 — `formatCompactRow` (normative schema, 120c head prefix + `…`, `escapeQuote` on render) + phase-1 branches (default WEAK packs → machine table; `--verbose` appends machine full packs; table always present) + `verbose` threading + `--verbose` in `cleanTriageArgs` strip list. Verified: default = 3 compact rows + 2 WEAK packs, zero `NAMED → keep`; `--verbose` adds machine packs.
- [x] T5 — `deferred (<R>): <shorts>` in §2 page order; deferred rows never reach pack/guess builders. Verified: 25 qualifying → deferred line lists exactly 5 shortIds.
- [x] T6 — `RENAME_RE` + `parseRenameAssignments` via unified `parseTriageInput` (single index-ordered stream, one shared `seen`: second occurrence of any prefix in either class → `duplicate assignment`). Verified: `:name:"   "` → `empty rename slug`, zero writes; rename tokens never verdict leftovers.
- [x] T7 — bare `<prefix>:keep` provisionally accepted (`reason: ""`); bare paused/finished/ephemeral → `missing judged rationale`, bare trash → `trash never appliable`; post-resolve provenance gate (`rejectReasonless`: WEAK/unknown/ambiguous/stale → warning, zero writes; MACHINE → bulk). Verified: WEAK bare keep rejected; bare `finished` stays missing-rationale.
- [x] T8 — bulk fan-in: `bulkKeeps` filter (`MACHINE && KEEP`), `bulkKeepRationale` computed once (`machine keep, bulk-confirmed <UTC-date>`), exactly ONE confirm (`Keep <N> machine sessions? (<shorts>)`, detail rationale + per-file msgs/age/reason, never tail); per-file body factored as `disposeVerdict` (identical recheck/append/re-read/counters); no → all `declined`; mixed bulk-first. Verified: 3 reasonless keeps → 1 confirm → verbatim rationale per file, append-only (+1 line each), summary `Triaged 3 of 3 (3 applied + 0 already)`.
- [x] T9 — throwing `appendRenameToOther(sessionPath, slug, livePath?)` mirroring `appendVerdictToOther` (empty-slug/gone-file/live refusals; body `SessionManager.open(path).appendSessionInfo(slug)`) + `existingName` at resolve + post-write `getSessionName()` equality re-read. T1 note reused.
- [x] T10 — rename resolve (fresh order, unknown/ambiguous/stale pre-confirm) + per-item rename confirms (`Rename <short> to "<slug>"?`, `existing → proposed · msgs · age`) + single categorized summary (verdict counters + `renamed X of Y (declined, error)`) + dry-run choke moved post-resolve with provenance/bulk-date/rename previews + `Cancelled.` on empty confirmed set + flag plumbing; still exactly one `registerCommand("scrub-triage")` (5 commands total, unchanged). Verified: rename round-trips, duplicates both read back, stale re-apply warns zero-write.
- [x] T11 — 45/45 harness checks green (see evidence) + gates: `tsc --strict` clean, zero-`any`, zero new `session_shutdown|session_start|unlink|ctx.ui.custom`, headless `pi -ne -e … -p` loads clean (`smoke-ok`). `pi -p "/scrub-triage"` returned empty output — inconclusive slash-in-print plumbing (environmental; handler itself proven via harness).

## Trial evidence (T11)

Harness `/tmp/scrub-t1/` (ephemeral, outside repo): esbuild-bundled extension + pinned-dist `SessionManager`, isolated `PI_CODING_AGENT_DIR`, crafted sessions, fake ctx with scripted confirms. `run.mjs`: **45 passed, 0 failed** — TU1 WEAK-first (incl. 27-seed: 7 WEAK + 13 machine = cap 20), TU2 compact schema, TU3 verbose, TU4 bulk ONE-confirm + verbatim rationale + append-only, TU5 reason-mandatory/bare-judged/per-item/mixed-bulk-first, TU6 rename round-trip/duplicates/empty-reject/existing-name, TU7 deferred-7 + 25→5 variant + nothing-dropped (27/27 listed), TU8 stale/ambiguous/trash/reasonless-unknown/live-exclusion/non-TUI notify-only, race skip-warning with zero overwrite (`1 conflict`), dry-run previews with zero writes/confirms.

## Deviations from design (2, both spec-faithful)

1. Phase-1 visual order WEAK-packs-then-machine-table (spec UX-01 scenario + design §11 TU1 + tasks T3 verify line win over design §7's listing order, which put the machine section first).
2. Dry-run choke lives post-resolve inside phase 2 (design §7 requires provenance/existing→proposed/bulk-date in the echo, which needs resolution); non-TUI notify-only preserved via `resolveDryRun`.

## Remaining

- [ ] T12 README — SEPARATE meta task, parent handles. NOT done here.

## Workload / PR boundary — ⚠️ DELIVERY DECISION NEEDED (ask-on-risk)

`git diff --numstat`: **457 insertions / 112 deletions** in `extensions/session-scrub/index.ts` (net new ≈ 345). Over the 400 budget and past the ~320 pause line. First-cut richness savings inventoried (≈ 26 lines: verbose machine blocks ~8, bulk per-file fragments ~8, dry-run verbose extras ~10) — insufficient alone, and cutting further would touch required behaviors (bulk detail per design §4, dry-run previews per §7). The slice is cohesively safety-critical: splitting parser (T6/T7) from its provenance gate/bulk fan-in (T7/T8) would land unsafe intermediates (reasonless keep accepted with no gate). **Recommendation: `size:exception` single PR** — or parent-directed chain. No exception claimed; no commit made; attempt left running (not settled).
**Structured status consumed:** authoritative openspec status (`applyState: ready`, `nextRecommended: apply`, 12 tasks, 0 complete at start); `actionContext` repo-local with allowed edit roots honored (trial artifacts in `/tmp`, repo edits limited to the 3 allowed files).
