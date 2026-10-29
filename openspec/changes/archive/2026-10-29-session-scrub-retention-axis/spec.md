# Spec delta — session-scrub-retention-axis

**Change ID:** `session-scrub-retention-axis` · **Date:** 2026-10-29
**Against:** canonical `openspec/specs/session-scrub/spec.md` (NB-02, NB-07, REQ-01) and `docs/behavior.md`
**Status:** written before implementation, from a measured read of the code. Every claim about current behaviour below was reproduced on the host-free modules, not inferred from a comment.

## What this delta changes

| target | action |
| --- | --- |
| `name.ts:resolveVerdict` | **modified** (RA-01). A retention verdict outranks the verdict derived from the name |
| `name.ts:writeTakesEffect` | **added** (RA-01). One host-free predicate replacing "does the name declare a state?" as the refusal test |
| `classify.ts` | **modified, branch order only** (RA-02). The retention test moves above the named branch; the flow heuristic stays below it |
| `index.ts:handleScrubMark` | **modified** (RA-03). Refuses a write that cannot take effect instead of any write on a named session; the refusal text is **unchanged, byte for byte** |
| `index.ts:formatAuditLine` + `render.ts` | **added** (RA-04). A candidate row carries its name, because RA-02 makes a named session reachable as a candidate |
| `POLICY_TEMPLATE` | **unchanged, on purpose.** The state → verdict table (MP-02) keeps agreeing with `verdictFromState` |
| triage grammar and triage exclusion | **unchanged, on purpose.** Retraction is out of scope (non-goal N-1) |
| the five-state vocabulary | **unchanged, on purpose** (non-goal N-2) |

## Why this change exists

`Verdict` is not one scale. Three of its values are continuation facts and two are retention facts, and `adopt.ts:stateFromVerdict` already says so in a comment:

> `keep`, `ephemeral` and `trash` answer a different question (is this worth retaining) and carry no continuation claim.

`resolveVerdict` applies one precedence to both axes, so a name — which can answer the continuation question and *cannot* answer the retention one (NB-02 forbids deriving `ephemeral`/`trash` from a name, for exactly that reason) — wins the retention question too. Measured on 2026-10-29 against `name.ts` + `classify.ts`:

| recorded entry | name | resolved | classification |
| --- | --- | --- | --- |
| — | `hecho: x` | `finished` | `named-protected` |
| `ephemeral` | `hecho: x` | `finished` | `named-protected` |
| `trash` | `hecho: x` | `finished` | `named-protected` |
| `keep` | `hecho: x` | `finished` | `named-protected` |
| `ephemeral` | (none) | `ephemeral` | `candidate:ephemeral` |

Three consequences, all of them permanent, because `gatherTriageCandidates` skips any session whose *resolved* verdict exists:

1. Closing a session that was correctly marked `ephemeral` protects it forever. The only honest close state for a finished session is `hecho:`, so **the complete ritual destroys the classification**.
2. An explicitly condemned `trash` session is resurrected by a later rename. That contradicts REQ-01's own sentence — *named sessions are actionable ONLY with verdict `trash`* — which the named branch can never reach, because `resolveVerdict` already replaced `trash` with `finished`.
3. `scrub_mark` cannot repair either case: NB-02 refuses any write once the name declares a state. Order of the two calls decides the outcome, and the wrong order is silent.

The same defect was already fixed once in the adjacent surface: `session-scrub-mark-on-precedence` found that the policy block ordered a write the tool must refuse, and removed the order, not the guard. This change removes the second instance of the same pattern: a carrier answering a question it cannot answer.

## RA-01 — A retention verdict outranks the name; a name can never clear one

`name.ts:resolveVerdict(name, entryVerdict)` MUST resolve in this order:

1. If `entryVerdict` is `ephemeral` or `trash`, it MUST be returned. These two are the retention axis, and a name cannot express either (NB-02), so a name MUST NOT cancel one, however recently it was written.
2. Otherwise the name wins when it declares a state (`verdictFromName`), as today.
3. Otherwise the entry is used, so verdicts written before the convention existed are still honoured, as today.

`name.ts:writeTakesEffect(name, latestEntryVerdict, nextVerdict)` MUST return whether a write of `nextVerdict` would change the resolution for this session: `resolveVerdict(name, latestEntryVerdict) !== resolveVerdict(name, nextVerdict)`. The rule is not new — it is NB-02's own words (*"a record that cannot take effect"*) computed from the resolution function instead of read off the name.

The retention set MUST be owned by `classify.ts` (`RETENTION_VERDICTS`, or a guard over it) beside `VERDICTS`, so the two modules cannot disagree about which values are retention.

#### Scenario: the close no longer buries the mark
- GIVEN an entry `ephemeral` and a name `hecho: respuesta entregada`
- WHEN the verdict is resolved
- THEN it is `ephemeral`, and the session is a candidate, not protected.

#### Scenario: a condemned session survives a rename
- GIVEN an entry `trash` and a name `pausa: desde 01a17881 · retomo mañana`
- WHEN the verdict is resolved
- THEN it is `trash`, and REQ-01's named-trash sentence becomes reachable.

#### Scenario: derivable verdicts keep the old precedence
- GIVEN an entry `paused` and a name `hecho: cerramos`
- WHEN the verdict is resolved
- THEN it is `finished` — unchanged, and `name.test.ts`'s existing assertion stays green.

#### Scenario: a write that cannot take effect is identified as such
- GIVEN a name `pausa: falta el spec` and a recorded `paused`
- WHEN `writeTakesEffect(name, "paused", "keep")` runs
- THEN it is false: both resolve to `paused`.
- AND given a name `hecho: x` and a recorded `ephemeral`, `writeTakesEffect(name, "ephemeral", "keep")` is true: `ephemeral` → `finished`.

## RA-02 — Explicit retention outranks a name; a text heuristic never does

`classifySession` MUST apply its branches in this order:

1. live → `live` (unchanged).
2. `verdict === trash` → `candidate`, reason `explicit-trash` (moved up beside `ephemeral`; today it sits inside the named branch, and the upstream mask means the composed pipeline never delivers `trash` there — so for `trash` the reorder is behaviour-neutral and the load-bearing half is `resolveVerdict`).
3. `verdict === ephemeral` → `candidate`, reason `ephemeral` (new position; same reason the unnamed path already uses).
4. named → `named-protected` (unchanged for every non-retention verdict).
5. everything below unchanged: unnamed trunks of `finished`, the NM-04 verdict precedence, empty, turn floor, age, kept.

The `ephemeralFlow` heuristic MUST stay **below** the named branch, and this MUST be pinned by a test. A flow match is text evidence; a name is a human record. A heuristic MUST NOT turn a session a human named into a deletion candidate. Preserved invariant, not a change: today's named branch already precedes the heuristic.

REQ-01's sentence MUST be amended to read that named sessions are actionable **only with a retention verdict (`trash`, `ephemeral`)**, because both are explicit records and neither is expressible in the name.

#### Scenario: a marked ephemeral closed as hecho is a candidate
- GIVEN a session named `hecho: respuesta del Discord entregada` with entry `ephemeral`
- WHEN it is classified
- THEN it is `candidate` with reason `ephemeral`.

#### Scenario: a named session with a protection verdict is still protected
- GIVEN a session named `hecho: guía + PR mergeado` with entry `keep`
- WHEN it is classified
- THEN it is `named-protected` — the name is the record on the continuation axis.

#### Scenario: the heuristic does not outrank a name
- GIVEN a session named `abierto: sigo con esto` whose messages match an `ephemeral-flows` entry
- WHEN it is classified
- THEN it is `named-protected`, because a match only proposes.

#### Scenario: an unnamed flow match is unchanged
- GIVEN an unnamed session whose messages match an `ephemeral-flows` entry
- WHEN it is classified
- THEN it is `candidate` with reason `ephemeral` — unchanged.

## RA-03 — `scrub_mark` refuses only a write that cannot take effect

For a session whose name declares a state, `handleScrubMark` MUST refuse exactly when `writeTakesEffect` is false, and MUST answer with the **same text** it answers today (*"This session already declares its state as … The name is the record; use scrub_close to change it. Nothing was written."*). For a session whose name declares no state, behaviour MUST be unchanged: every verdict is accepted.

#### Scenario: marking after closing is accepted
- GIVEN a session named `hecho: respuesta entregada` with no entry
- WHEN `scrub_mark` is called with `ephemeral`
- THEN the entry is written and the session becomes a candidate — the order of close and mark stops deciding the outcome.

#### Scenario: a redundant write is still refused
- GIVEN a session named `pausa: falta el spec`, no entry
- WHEN `scrub_mark` is called with `keep`
- THEN it is refused with today's text and nothing is written.

#### Scenario: retraction on the live session works
- GIVEN a session named `hecho: x` with entry `ephemeral`
- WHEN `scrub_mark` is called with `keep`
- THEN it is accepted, and the session resolves `finished` and is protected again.

## RA-04 — A candidate row shows the name it is about

RA-02 makes a named session reachable as a candidate for the first time. `formatAuditLine` (shared by `/scrub` and `/scrub-apply`) and therefore the per-item confirm body MUST carry the candidate's name when it has one, so a deletion consent identifies the session it deletes. Without this, the confirm reads `trash-candidate 01a18214 reason=ephemeral` for `hecho: respuesta del Discord entregada`.

The row text MUST be produced by a host-free, import-free formatter in `render.ts` (`formatCandidateLine`), pinned by `render.test.ts`, so the claim is testable — `formatAuditLine` itself lives in `index.ts`, which the runner cannot load.

#### Scenario: a named candidate says its name
- GIVEN `{ shortId: "01a18214", reason: "ephemeral", name: "hecho: respuesta entregada" }`
- WHEN the row is formatted
- THEN it names the session, and the reason is still visible.

#### Scenario: an unnamed candidate is unchanged
- GIVEN `{ shortId: "01a18214", reason: "explicit-trash" }`
- WHEN the row is formatted
- THEN the output is the current `trash-candidate 01a18214 reason=explicit-trash`.

## Non-goals

- **N-1 — Retraction of a retention verdict on a session that is not live.** Out of scope, and *not* a regression: the path does not exist today either. `scrub_mark` writes only the live session; `/scrub-triage` excludes every session with a resolved verdict, and `appendVerdictToOther` refuses `trash` outright. The only escape that exists is the masking bug this change removes. Extending triage would add a row flavour (it cannot show a session's current verdict) and reopen a measured surface — a separate change if the owner misses it.
- **N-2 — No new state, no marker in the name.** `cerrado:` is `hecho:` with one more syllable; a retention marker in the picker would be a second writer of a fact the entry owns and would go stale on retraction. Measured pressure, 2026-10-29: an agent already improvised `hecho: cerrado: respuesta del Discord entregada` — the closed vocabulary invites improvisation in the free text, and the answer is to make the existing state sufficient, not to add a sixth.
- **N-3 — No `POLICY_TEMPLATE` change.** The block's state → verdict table still agrees with `verdictFromState`; only the resolution changed. MP-02's table test stays green, which is the signal that the fix lands in the right layer.
- **N-4 — No triage grammar, exclusion, or row-shape change.**
- **N-5 — No change to the picker.** Pi renders `session.name ?? session.firstMessage`; retention stays in `/scrub`, which already lists every session with its verdict.

## Preserved invariants (each pinned by a test)

- Named + `keep`/`paused`/`finished` → `named-protected` (REQ-01 as amended).
- Unnamed + any verdict → accepted by `scrub_mark`, unchanged.
- `trash` is never written by triage (`appendVerdictToOther`'s refusal stays).
- A name never derives `ephemeral`/`trash` (NB-02's other half, untouched).
- `formatName`/`parseName` round-trip, lineage head handling, and `closeName` are untouched by this change.
- The refusal text in `handleScrubMark` is byte-identical; this change alters *when* it fires, never what it says.
