# Tasks — session-scrub-naming

**Change:** `session-scrub-naming` · **Against:** `openspec/specs/session-scrub/spec.md` (REQ-01…REQ-12, TR-01…TR-13, UX-01…UX-08) + `openspec/changes/session-scrub-naming/spec.md` (NM-01…NM-05)

> **RECONSTRUCTED 2026-10-26, at reconciliation — this file did not exist during execution.**
> The change was executed from 2026-10-07 to 2026-10-10 without a `tasks.md`: execution was
> tracked in the plugin's local ODD records (`odd/tasks/session-naming-redesign.md`,
> `odd/tasks/slice-d-bulk-sanitization.md`). Every task below is a delivered slice with the
> commits that carried it, transcribed from those records and verified against `master`
> history. Nothing here is a plan made after the fact; nothing is invented. The checkboxes
> record delivery, and the provenance of each line is the commit it names.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | not estimated at planning time (no tasks file existed) |
| 400-line budget risk | high by hindsight — the delivered chain is 36 commits / ~5 533 insertions |
| Chained PRs recommended | **yes**, and it is what happened: six chained PRs (#1–#6) |
| Delivery strategy | stacked-to-main chain, merged by the owner |

## Tasks

- [x] **T1 — open the change and withdraw the stale REQ-09 clause.** `c34b1d6` (proposal), the `.gitignore` for local ODD records in a separate commit `07d2e34`. Accepted by the change's own §7 acceptance list.
- [x] **T2 — document current behaviour before changing the predicate.** `3dd6361` (`docs/behavior.md` snapshot at `v0.3.0`).
- [x] **T3 — resolve the three open questions: guard, `--force`, classification criterion.** `8930698`, `f486e60`; recorded in proposal §5 and NM-03/NM-04/NM-05.
- [x] **T3b — build the test harness and the strict typecheck gate.** `6fe1f77`, `86b7c94`. Before this, the repo had no automated runner; NM-04/NM-05 would have been unverifiable.
- [x] **T4 — implement NM-04 (verdict precedence) and NM-05 (conversation-turn floor).** `3b0f588`, with the predicate extracted to `classify.ts`.
- [x] **T5 — design the naming slice.** Slice A `8c2cb3e` (convention), slice B `2ce8947` (`scrub_close`), slice C `710b9e5` + `bd22623` (traspaso / `/scrub:handoff`), recorded in `design.md` §Slices.
- [x] **T6 — implement NM-01…NM-03 by path and apply them in bulk.** `c423b9f` (pure `adopt.ts`), `a72c1d9` (NM-02 backup + parse-before + one-entry assertion), `b2c9604` (NM-03 120 s guard), `d26b56a` (`/scrub:adopt` command). Delivered as slice D.
- [x] **T7 — display ids and the triage-eligibility repair.** `0705e17` (PR #5: the session id becomes addressable in a burst; `/scrub:restore` shows the id instead of the date; the live row stops reading its verdict raw) and `06309a1` (PR #6: triage stops offering sessions whose name already declares their state; `scrub_close` states that declaring `traspaso` obliges telling the user to run the handoff).

## Manual trials (no automated harness covered the write path at the time)

- [x] **MT1 — read path measured live** in the `_scrub-fixture` bench, two read-only passes, every expectation PASS; recorded in the plugin's local `odd/tasks/live-measurement-fixture.md`.
- [x] **MT2 — write path measured live** in the same bench: O1–O5 and O7 PASS, O6 not observable in that configuration, bench restored byte- and mtime-identical; recorded in `odd/tasks/write-path-fixture.md`.

## Delivery

- [x] Six chained PRs #1–#6 opened and merged (`a01b1ff`, `38579af`, `6fd9f4c`, `656f00c`, `0705e17`, `06309a1`); then #9 and #10 followed on the same product.

## Sync

- [x] Canonical spec reconciled and this change archived on 2026-10-26 — see `sync-report.md` and `archive-report.md`. The change shipped one requirement set (NM-01…NM-05) and five delivered surfaces with no requirement; the reconciliation specified the latter **as built** instead of pretending they were planned.
