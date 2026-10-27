# Spec delta — session-scrub-mark-on-precedence

**Change ID:** `session-scrub-mark-on-precedence` · **Date:** 2026-10-27
**Against:** canonical `openspec/specs/session-scrub/spec.md` (REQ-03, F4) and `docs/behavior.md` (Layer A § POLICY keys)
**Status:** written before implementation, from a measured read of the code. Every claim about current behaviour was verified in source.

## What this delta changes

| target | action |
| --- | --- |
| `POLICY_TEMPLATE` guidance (`policy.ts`) | **modified** (MP-01). The `session_rename` rule becomes conditional on the name declaring no state |
| `POLICY_TEMPLATE` guidance (`policy.ts`) | **added** (MP-02). The block states the precedence, with a state → verdict table the tests hold to the code |
| `scrub_mark` (`index.ts:handleScrubMark`) | **unchanged, on purpose.** The NB-02 refusal is correct and stays byte-for-byte |
| Delivery to projects that already have the block | **out of scope.** `/scrub:init --update` is the next change (`session-scrub-init-update`); today the block is corrected by hand, exactly once |

## Why this change exists

The policy block is the standing order the agent reads in every session. It said, in one list with no conditions:

    session_rename — when this session gets named or renamed (/name), record keep.

Two real renames, two different outcomes:

| rename | what the name resolves to | `scrub_mark keep` | needed? |
| --- | --- | --- | --- |
| `/name refactor del parser` | nothing (`name.ts:parseName` finds no state) | accepted | yes — `index.ts:gatherTriageCandidates` excludes a session only when its *resolved* verdict exists, and a state-less name resolves none |
| `/name pausa: …`, or `scrub_close` | `paused` (`name.ts:verdictFromState`) | **refused** (NB-02) | no — the name already is the verdict |

So the order asked for a write the tool must refuse, and the agent either reported a failure that is not one or spent a turn finding out. Measured on 2026-10-27: the closing session was named and not marked, and the close reported the refusal.

The defect is in the ORDER, not in the guard. NB-02 keeps one carrier per fact — the name — because two records diverge the moment one write is skipped, and the picker then shows a stale promise nobody audits. `only the order is wrong` is the whole finding.

## MP-01 — The rename rule is conditional

The `session_rename` line in `POLICY_TEMPLATE` MUST state that `keep` is recorded only when the new name declares no state, and MUST point at the precedence section (MP-02). It MUST NOT be a bare `record keep`.

#### Scenario: a state-less rename is still ordered
- GIVEN a session renamed with free text only (`/name refactor del parser`)
- WHEN the agent reads the policy block
- THEN the block orders `keep` for that rename, because the name declares no state.

#### Scenario: a state-carrying rename orders no mark
- GIVEN a session renamed `pausa: …` or closed with `scrub_close`
- WHEN the agent reads the policy block
- THEN the block orders no `keep` for it, and says the name already is the record.

## MP-02 — The block states the precedence, and the tests hold it to the code

The block MUST name the precedence explicitly — the name is the record; a name that starts with a state already IS the verdict, so `scrub_mark` refuses there on purpose and nothing is missing — and MUST carry the state → verdict table in a form a test can read.

#### Scenario: the stated table agrees with the code
- GIVEN the state → verdict table written in `POLICY_TEMPLATE`
- WHEN the table is compared with `name.ts:verdictFromState` for every `STATE` value
- THEN every state appears exactly once, no other token appears, and every verdict agrees with the code.

#### Scenario: a new state cannot land silently
- GIVEN a sixth value added to `name.ts:STATE`
- WHEN the test suite runs
- THEN the table test fails, because the block would be describing a vocabulary the code no longer has.

## Non-goals

- No change to `handleScrubMark`, its schema, or its refusal text. The refusal is a hard stop and reads correctly to the agent; softening it would only mitigate a symptom this change removes at the origin.
- No `scrub_mark`-writes-the-name path: a verdict is not a state (`trash` has no state; `keep` covers only `abierto:`), and a tool call must not rename what the picker reads.
- No removal of the rename rule: a state-less rename is the one case where `keep` is both writable and load-bearing.
