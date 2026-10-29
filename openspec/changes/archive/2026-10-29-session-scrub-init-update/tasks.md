# Tasks — session-scrub-init-update

**Change:** `session-scrub-init-update` · **Against:** `openspec/changes/session-scrub-init-update/spec.md` (UD-01…UD-04)
**Rule:** EXTEND the plugin only. `appendPolicyBlock` and the plain `/scrub:init` path keep their behaviour; `classify.ts`, `render.ts`, `adopt.ts`, `handoff.ts`, `ids.ts` and `name.ts` are frozen.

## Review Workload Forecast

| Field | Value |
| --- | --- |
| Estimated changed lines | ~230 (planner + diff + handler + tests), docs in a separate commit — actual: ~330 across code, tests and docs |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | one code commit (`policy.ts` + `sessionfs.ts` + `index.ts` + tests), one docs commit, one openspec commit |

## Tasks

- [x] **T1 — UD-04 RED: one scanner, two planners.** `findRegion` extracts start/end with the PB-02 fence and inline-code rules; `planInitWrite` delegates to it. Existing `policy.test.ts` tests stay green — that is the proof the extraction changed nothing.
- [x] **T2 — UD-01 RED: the planner.** `planInitUpdate` returns `append` / `unterminated` / `foreign` / `current` / `update`. Tests: no block, unterminated, human line refused with its line, foreign key refused, flows preserved, current on a fresh block.
- [x] **T3 — UD-01/UD-03 RED: the ownership edges.** Tests: the previous template's block (unconditional rename rule) is upgraded and keeps its flows; a second `ephemeral-flows:` line is refused by line; a block with the human's flows already in place plans `current`.
- [x] **T4 — UD-04 RED: idempotence.** Apply the plan's text, plan again, expect `current`. Proves the normal form is stable.
- [x] **T5 — GREEN: the planner and the diff.** `planInitUpdate` + `diffPolicyBlock` (common prefix/suffix trimmed, `-`/`+` lines only) in `policy.ts`. Test the diff: removal, addition, and the empty case.
- [x] **T6 — UD-02: the write path.** `sessionfs.ts` gains `replacePolicyBlock` (behind `refuseNonRegularFile`) and `backupFileAside` (the generic copy `backupSessionFile` now delegates to). `handleScrubInit` routes `--update`: dry-run/no-UI reports the diff, TUI confirms, backup is taken, success names the backup path, failure notifies with zero mutation. A `doccheck.test.ts` gate pins that the update path writes through `replacePolicyBlock`, never `writeFileSync`.
- [x] **T7 — docs.** `behavior.md` Layer B § `/scrub:init` (the update path, its messages and its refusals), Layer A § POLICY keys (the ownership table), `guide.md` §3.2 and the command table (`--update`).
- [x] **T8 — gates.** `node --test "extensions/session-scrub/*.test.ts"` and `npm run typecheck` green; RED observed before each behaviour lands.

## Notes

- Strict TDD applies: T1–T4 observe RED before T5.
- The interactive paths (confirm, backup, real write) cannot be unit-tested without a host, like every other write path here: they are pinned structurally in `doccheck.test.ts` and measured manually with `/reload` against a scratch project.
- The previous change (`session-scrub-mark-on-precedence`) is the first real payload: the block this change ships is the one that change corrected.
