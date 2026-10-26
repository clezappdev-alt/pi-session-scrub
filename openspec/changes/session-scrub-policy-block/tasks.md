# Tasks — session-scrub-policy-block

**Change:** `session-scrub-policy-block` · **Against:** `openspec/changes/session-scrub-policy-block/spec.md` (PB-01…PB-05)
**Rule:** EXTEND the plugin only. `classify.ts`, `render.ts`, `adopt.ts`, `handoff.ts`, `ids.ts`, `sessionfs.ts` and every existing test are frozen except where PB-05 requires the parser to move.

## Review Workload Forecast

| Field | Value |
| --- | --- |
| Estimated changed lines | ~180–260 (code + tests), docs in separate commits |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | one code commit (parser + init + tests), one meta commit (this change, `AGENTS.md`, `config.yaml`) |
| Delivery strategy | ask-on-risk |

## Tasks

- [ ] **T1 — PB-05: extract the parser.** New host-free `policy.ts` with the region scan and key read; `index.ts` delegates to it. No behaviour change yet beyond the region bound: this is the step that makes the rest testable.
- [ ] **T2 — PB-01: bound the region.** First `start` → first `end` after it; no block when the order fails; keys read only inside. Tests: another block's flows, unterminated start with a stray earlier end.
- [ ] **T3 — PB-02: fence awareness.** Markers inside triple-backtick fences are text. Tests: quoted template plus a real block; quoted template alone.
- [ ] **T4 — PB-03/PB-04: `/scrub:init` gets a net.** `--dry-run`, non-interactive as dry-run, preview of the exact text, TUI confirmation, refusal reporting the line, `try/catch` with a warning notify and zero mutation. Tests where the surface allows; the interactive paths are measured manually (T6).
- [ ] **T5 — sync the canonical spec.** Annotate `REQ-03` (one machine key, guidance keys named as such) and `REQ-08` (dry-run, confirmation, line-number refusal); append a slice section if it does not fit in a marker.
- [ ] **T6 — manual trial NS9.** Live `AGENTS.md` with: a quoted template only, a foreign block with `ephemeral-flows:`, an existing block, a read-only file. Record the outcomes.
- [ ] **T7 — gates.** `node --test "extensions/session-scrub/*.test.ts"` and `./scripts/typecheck.sh` green; RED observed before each behaviour lands.

## Notes

- Strict TDD applies (`openspec/config.yaml`: `strict_tdd: true`): each of T2, T3 and T4 starts from a failing test.
- `docs/behavior.md` Layer A § POLICY keys already states the truth about the two guidance keys; it needs the region/fence behaviour and the `init` net added to Layer B when the code lands.
- The archive is not touched by this change.
