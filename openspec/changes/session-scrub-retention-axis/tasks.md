# Tasks — session-scrub-retention-axis

**Change:** `session-scrub-retention-axis` · **Against:** `openspec/changes/session-scrub-retention-axis/spec.md` (RA-01…RA-04)
**Rule:** strict TDD. Every clause observes RED before its GREEN, and no production module outside `name.ts`, `classify.ts`, `render.ts` and `index.ts` is touched.

## Review Workload Forecast

| Field | Value |
| --- | --- |
| Estimated changed lines | ~200 code + tests, ~40 docs, plus this change's own documents |
| 400-line budget risk | Low for the code commit; the change documents are meta and carry no behaviour |
| Chained PRs recommended | No |
| Suggested split | **C1** meta: this change (`spec.md` + `tasks.md`). **C2** code: `name.ts`, `classify.ts`, `render.ts`, `index.ts` + their tests and the `doccheck` gate. **C3** meta: `docs/behavior.md` + `docs/guide.md` |
| Review risk | C2 is **Risk: item 3** — it changes a semantic contract others consume (what a verdict *means*). It gets its own commit, and it is the only candidate for native review |

## Tasks

- [ ] **T1 — RA-01 RED: the retention axis in `resolveVerdict`.** Cases: `ephemeral` and `trash` each over `hecho:`, `pausa:`, `abierto:`, `traspaso:` and `espera:`; the derivable case `("hecho: cerramos", "paused") → finished` stays as it is; the legacy case (no state in the name) stays as it is. Fails now for the retention rows.
- [ ] **T2 — RA-01 RED: `writeTakesEffect`.** Truth table: redundant `paused` on `pausa:`, allowed `ephemeral` on `hecho:`, allowed `keep` clearing an `ephemeral` entry, allowed `trash` over an `ephemeral` entry. Fails now: the function does not exist.
- [ ] **T3 — RA-01 GREEN: `name.ts` + the retention set.** `RETENTION_VERDICTS`/guard lands in `classify.ts` beside `VERDICTS`; `resolveVerdict` resolves retention first; `writeTakesEffect` composes `resolveVerdict` twice. T1, T2 and every existing `name.test.ts` test green.
- [ ] **T4 — RA-02 RED: the classifier's branch order.** Cases: named + `ephemeral` → `candidate:ephemeral`; named + `trash` → `candidate:explicit-trash`; named + `keep` → `named-protected`; named + flow match → `named-protected`; unnamed + flow match → `candidate:ephemeral`. Fails now on the first two.
- [ ] **T5 — RA-02 GREEN: hoist the retention test.** `classifySession` checks `trash` and `ephemeral` above the named branch; the inner `trash` check in the named branch goes; the heuristic stays below. T4 and every existing `classify.test.ts` test green.
- [ ] **T6 — RA-03 RED: the refusal is derived, not read off the name.** `doccheck.test.ts` gate: the refusal fragment `The name is the record; use scrub_close to change it.` is still present in `index.ts` (byte-identical message, RA-03). Fails only if the message is edited; it is written first so the GREEN cannot drift it.
- [ ] **T7 — RA-03 GREEN: `handleScrubMark`.** The handler refuses on a named session only when `writeTakesEffect` is false, reading `readLatestVerdict(ctx.sessionManager.getEntries())`. Unnamed sessions keep today's path.
- [ ] **T8 — RA-04 RED+GREEN: the candidate row names its session.** `render.test.ts` pins `formatCandidateLine` with and without a name, and that the unnamed output is the current string. Then `formatAuditLine` routes its candidate branch through it.
- [ ] **T9 — Gates.** `npm run check` (typecheck + full suite) green. Grep gates from the repo contract: no new `any`, no `unlink`, no `session_start`/`session_shutdown`, no `ctx.ui.custom`.

## Notes

- **Why T6 is not a behaviour test.** `handleScrubMark` lives in `index.ts`, which imports the Pi host and cannot be loaded by the runner. Its logic is therefore expressed as `writeTakesEffect` (host-free, T2) and the handler is thin wiring. The message is pinned by source text, the repo's existing pattern for `index.ts` claims.
- **The amend to REQ-01 is not applied here.** The canonical spec is folded at archive (`sync`), as every previous change in this repo did; this delta carries the text.
- **`docs/behavior.md` states its unreleased work explicitly** in its `Reflects:` header. C3 adds this change to that list rather than moving the tag anchor.
- **Manual trial is the owner's, not a gate.** `pi -e ./extensions/session-scrub/index.ts` + `/reload`, then close a session that carries an `ephemeral` entry and confirm `/scrub` lists it as a candidate with its name. Recorded as a suggestion, not a checkbox that can be silently skipped.
