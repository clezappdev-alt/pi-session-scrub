# Tasks — session-scrub-mark-on-precedence

**Change:** `session-scrub-mark-on-precedence` · **Against:** `openspec/changes/session-scrub-mark-on-precedence/spec.md` (MP-01, MP-02)
**Rule:** the template text and its test. No production module other than `policy.ts` is touched; `index.ts` is frozen.

## Review Workload Forecast

| Field | Value |
| --- | --- |
| Estimated changed lines | ~55 (template + tests), docs and meta in separate commits — actual: 3 files, 58 added / 8 removed |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | one code commit (`policy.ts` + `policy.test.ts`), one meta commit (`AGENTS.md` block), docs with the code commit's PR body |

## Tasks

- [x] **T1 — MP-02 RED: the table test.** Test parses the state → verdict rows out of `POLICY_TEMPLATE` and compares them with `verdictFromState` for every `STATE` value; asserts full coverage, no stray token, and agreement. Fails now: the template has no table.
- [x] **T2 — MP-01 RED: the conditional rename rule.** Test extracts the `session_rename` line and asserts it carries the condition, not a bare `record keep`. Fails now.
- [x] **T3 — MP-01/MP-02 GREEN: rewrite the guidance.** `POLICY_TEMPLATE` gains the conditional rename rule and the precedence paragraph with the table. Both tests green, every existing `policy.test.ts` test still green.
- [x] **T4 — meta: the live block.** `AGENTS.md`'s block gets the same text (the previous session corrected it by hand; this is the same correction, now specified). Separate commit, no code in it.
- [x] **T5 — docs.** `docs/behavior.md` Layer A § POLICY keys states the precedence and that the guidance is not parsed; `docs/guide.md` §3.2 tells the reader what to do when they rename with and without a state.
- [x] **T6 — gates.** `node --test "extensions/session-scrub/*.test.ts"` and `npm run typecheck` green.

## Notes

- Strict TDD applies: T1 and T2 observe RED before T3.
- `mark-on` and `verdicts` are read by nothing (`policy.ts:parsePolicyBlock` reads exactly one key), so this change cannot alter runtime behaviour — which is why the only testable claim is the agreement between the stated table and `verdictFromState`.
- The delivery gap is real and stays open: a project that already wrote its block does not get this text. That is `session-scrub-init-update`, the next change.
