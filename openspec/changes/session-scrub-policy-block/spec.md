# Spec delta — session-scrub-policy-block

**Change ID:** `session-scrub-policy-block` · **Date:** 2026-10-26
**Against:** canonical `openspec/specs/session-scrub/spec.md` (F4, REQ-03, REQ-08) and `docs/behavior.md` (Layer A § POLICY keys, Layer B § `/scrub:init`)
**Status:** written before implementation, from a measured read of the code. Every claim below about current behaviour was verified in source, not recalled.

## What this delta changes

| target | action |
| --- | --- |
| **F4 / REQ-03** POLICY grammar | **modified.** One machine key: `ephemeral-flows:`. `verdicts:` and `mark-on:` are guidance for the agent, parsed by nothing — the implementation never had them, and inventing a marking engine nobody asked for is the wrong repair |
| POLICY block delimitation | **added** (PB-01, PB-02). Today the markers are a switch, not a region |
| **REQ-08** `/scrub:init` | **modified** (PB-03, PB-04). It becomes the last write path without a net, and gets one |
| Parser location | **added** (PB-05). `parsePolicyBlock` lives in `index.ts`, which no test can load; it moves to a host-free module |

## Why this change exists

`parsePolicyBlock` requires both markers to appear *anywhere*, then scans **every line of the whole file** for `ephemeral-flows:`. `POLICY_END` never bounds the region. Consequences, all reachable today:

- another tool's policy block in the same `AGENTS.md` with an `ephemeral-flows:` line is **merged** into this plugin's config;
- a template pasted as an example — a fenced quote in the project's own docs — is read as live policy, and `/scrub:init` refuses that project forever because its guard is `text.includes(POLICY_START)`;
- a file with a stray `end` satisfies a malformed `start`-without-`end`.

Invented ephemeral flows make sessions `ephemeral` candidates. `apply` still asks per item, so nothing is destroyed automatically, but the proposal lies — and a lying proposal is how a wrong `confirm` gets clicked.

## PB-01 — The block is a region, not a switch

`parsePolicyBlock` MUST bound every key read to the region from the **first** `POLICY_START` to the **first** `POLICY_END` that follows it. Both markers MUST be present and in that order; otherwise the block is absent and the conservative default applies (`ephemeralFlows: []`). A line outside the region MUST NOT contribute a key, under any circumstance.

#### Scenario: another block's flows are not mine
- GIVEN an `AGENTS.md` whose own `pi-session-scrub` block lists no flows, and a different tool's block elsewhere listing `ephemeral-flows: other-flow`
- WHEN the policy is parsed
- THEN `ephemeralFlows` is empty and no session becomes an ephemeral candidate by that name.

#### Scenario: an unterminated start is not a block
- GIVEN an `AGENTS.md` with `POLICY_START`, no `POLICY_END`, and an `ephemeral-flows: x` line after it, plus a stray `POLICY_END` **before** the start
- WHEN the policy is parsed
- THEN the block is absent and `ephemeralFlows` is empty.

## PB-02 — A marker inside a fenced code block is text, not a marker

While scanning for the region, the parser MUST track triple-backtick fences and MUST NOT treat `POLICY_START` or `POLICY_END` occurring inside a fence as opening or closing the region. A quoted template in documentation is the ordinary case: it MUST NOT become policy, and it MUST NOT make `/scrub:init` refuse.

#### Scenario: a quoted template stays a quote
- GIVEN an `AGENTS.md` that documents the template inside a fence and has a real block below it
- WHEN the policy is parsed
- THEN the region is the real block, the fenced copy contributes nothing, and `/scrub:init` reports that the block already exists.

#### Scenario: a quoted template with no real block
- GIVEN an `AGENTS.md` whose only occurrence of the markers is inside a fence
- WHEN `/scrub:init` runs
- THEN it writes the real block instead of refusing.

## PB-03 — `/scrub:init` never writes without showing what it will write

`/scrub:init` MUST accept `--dry-run`, MUST treat a non-interactive mode as a dry run exactly like every other write path (REQ-11), and MUST show the exact text it would append before appending it. In the TUI it MUST confirm. When a block already exists it MUST say so and report where — the line number — instead of only "already exists".

#### Scenario: dry-run appends nothing
- GIVEN an `AGENTS.md` with no block
- WHEN `/scrub:init --dry-run` runs
- THEN the file is byte-identical afterwards and the preview contains the template.

#### Scenario: an existing block reports its position
- GIVEN an `AGENTS.md` with a block starting on line 41
- WHEN `/scrub:init` runs
- THEN it refuses, names line 41, and writes nothing.

## PB-04 — A failed write is notified, never thrown

An unwritable `AGENTS.md` MUST produce a warning notification and zero mutation. The command MUST NOT reject outward: every other error path in this plugin notifies, and a command that throws is a command whose failure the user cannot read.

#### Scenario: read-only file
- GIVEN an `AGENTS.md` without write permission
- WHEN `/scrub:init --apply` runs
- THEN a warning is notified, the command returns normally, and the file is unchanged.

## PB-05 — The parser is testable without the host

The POLICY region scan and parse MUST live in a host-free module (`policy.ts`) with no import of the Pi runtime, so `node --test` can exercise it. `index.ts` MUST delegate to it. This is the same extraction `classify.ts`, `render.ts`, `adopt.ts`, `ids.ts` and `sessionfs.ts` already went through; the reason is unchanged: a behaviour nothing can test is a behaviour that drifts.

#### Scenario: the module loads without the host
- GIVEN a test file that imports `policy.ts`
- WHEN `node --test` runs it
- THEN it loads with no Pi type dependency and the region cases above are asserted in it.

## Out of scope

Implementing `verdicts:`/`mark-on:` as parsed keys, a marking engine, rewriting an existing block in place, editing a block that is present but wrong (the human edits it), and any migration of existing `AGENTS.md` files.
