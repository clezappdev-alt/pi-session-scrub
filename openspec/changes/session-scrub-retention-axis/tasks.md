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

- [x] **T1 — RA-01 RED: the retention axis in `resolveVerdict`.** Cases: `ephemeral` and `trash` each over `hecho:`, `pausa:`, `abierto:`, `traspaso:` and `espera:`; the derivable case `("hecho: cerramos", "paused") → finished` stays as it is; the legacy case (no state in the name) stays as it is. Fails now for the retention rows.
- [x] **T2 — RA-01 RED: `writeTakesEffect`.** Truth table: redundant `paused` on `pausa:`, allowed `ephemeral` on `hecho:`, allowed `keep` clearing an `ephemeral` entry, allowed `trash` over an `ephemeral` entry. Fails now: the function does not exist.
- [x] **T3 — RA-01 GREEN: `name.ts` + the retention set.** `RETENTION_VERDICTS`/guard lands in `classify.ts` beside `VERDICTS`; `resolveVerdict` resolves retention first; `writeTakesEffect` composes `resolveVerdict` twice. T1, T2 and every existing `name.test.ts` test green.
- [x] **T4 — RA-02 RED: the classifier's branch order.** Cases: named + `ephemeral` → `candidate:ephemeral`; named + `trash` → `candidate:explicit-trash`; named + `keep` → `named-protected`; named + flow match → `named-protected`; unnamed + flow match → `candidate:ephemeral`. Fails now on the first two.
- [x] **T5 — RA-02 GREEN: hoist the retention test.** `classifySession` checks `trash` and `ephemeral` above the named branch; the inner `trash` check in the named branch goes; the heuristic stays below. T4 and every existing `classify.test.ts` test green.
- [x] **T6 — RA-03 RED: the refusal is derived, not read off the name.** `doccheck.test.ts` gate: the refusal fragment `The name is the record; use scrub_close to change it.` is still present in `index.ts` (byte-identical message, RA-03). Fails only if the message is edited; it is written first so the GREEN cannot drift it.
- [x] **T7 — RA-03 GREEN: `handleScrubMark`.** The handler refuses on a named session only when `writeTakesEffect` is false, reading `readLatestVerdict(ctx.sessionManager.getEntries())`. Unnamed sessions keep today's path.
- [x] **T8 — RA-04 RED+GREEN: the candidate row names its session.** `render.test.ts` pins `formatCandidateLine` with and without a name, and that the unnamed output is the current string. Then `formatAuditLine` routes its candidate branch through it.
- [x] **T9 — Gates.** `npm run check` (typecheck + full suite) green. Grep gates from the repo contract: no new `any`, no `unlink`, no `session_start`/`session_shutdown`, no `ctx.ui.custom`.

## Slice boundary (recorded, per `review_budget_lines: 400`)

Authored changed lines across the three commits: **533** (C1 meta 194, C2 code 300, C3 docs 39).
The code commit alone is 300, inside the review budget; the change documents are what pushed the
running total past 400. Observed RED→GREEN: `name.test.ts` 47/48 → 50/50, `classify.test.ts` 30/31
→ 81/81 across both modules, `doccheck.test.ts` 15/17 → 17/17 (the two failing gates were the
deliberate RA-03 RED and a glossary citation the header edit displaced), full suite 314 → 317 pass.
Delivery (push, PR, merge) is the owner's decision and was not taken.

## Post-review advisories (native review `review-7f0edc64867a330a`, approved)

The review closed approved and left five advisory, non-blocking findings. Consequence of the
approved closure: **the finding texts are not recoverable afterwards** — the frozen candidate
view is removed, the terminal-consumption receipt records only target/lineage, `inspect-authority`
exposes no artifact payload, and `review capabilities` offers no artifact-read operation. So the
three carried below were reconstructed from id + lens + severity + location, which map 1:1 to
the reviewed tree.

| id | severity | location | carried |
| --- | --- | --- | --- |
| R3-1 | SUGGESTION | `render.ts` candidate row | **yes** — the quoted name is now bounded to 60 cells; a name is free text with no bound, and this was the one row in the module without a budget |
| R3-2 | SUGGESTION | `doccheck.test.ts` RA-03 gate | **yes** — the refusal moved to `render.ts:formatMarkRefusal` and the whole message is asserted; the source gate now checks the handler *calls* it and that the text is not inlined again |
| R2-002 | SUGGESTION | `classify.ts` retention branches | **yes** — collapsed into `isRetentionVerdict` + `retentionReason`; the predicate now narrows, so no cast |
| R2-001 | WARNING | `index.ts` mark handler | no — split into `declaredState`/`writeIsInert` and the entry read made lazy; carried in the same commit because it was three lines |
| R2-003 | SUGGESTION | `render.ts` name alias | no — resolved as a side effect of R3-1's rewrite; a separate styling pass would buy nothing |

Delivered on `fix/retention-axis-advisories`, one code commit plus one meta commit.

## Notes

- **Why T6 is not a behaviour test.** `handleScrubMark` lives in `index.ts`, which imports the Pi host and cannot be loaded by the runner. Its logic is therefore expressed as `writeTakesEffect` (host-free, T2) and the handler is thin wiring. The message is pinned by source text, the repo's existing pattern for `index.ts` claims.
- **The amend to REQ-01 is not applied here.** The canonical spec is folded at archive (`sync`), as every previous change in this repo did; this delta carries the text.
- **`docs/behavior.md` states its unreleased work explicitly** in its `Reflects:` header. C3 adds this change to that list rather than moving the tag anchor.
- **Manual trial is the owner's, not a gate.** `pi -e ./extensions/session-scrub/index.ts` + `/reload`, then close a session that carries an `ephemeral` entry and confirm `/scrub` lists it as a candidate with its name. Recorded as a suggestion, not a checkbox that can be silently skipped.
