# Spec delta — session-scrub-init-update

**Change ID:** `session-scrub-init-update` · **Date:** 2026-10-27
**Against:** canonical `openspec/specs/session-scrub/spec.md` (REQ-08, F4) and `docs/behavior.md` (Layer A § POLICY keys, Layer B § `/scrub:init`)
**Status:** written before implementation, from a measured read of the code.

## What this delta changes

| target | action |
| --- | --- |
| **REQ-08** `/scrub:init` | **modified** (UD-01…UD-03). It gains `--update`, which refreshes an existing block instead of refusing |
| **F4** block ownership | **added** (UD-01). The template owns the block's prose and its guidance keys; `ephemeral-flows:` is the human's |
| `/scrub:init` safety net | **extended** (UD-02). A refresh shows a diff, asks, backs the file up, and writes behind the §9.6 guard |
| `policy.ts` | **modified** (UD-04). One region scanner shared by the writer and the updater, so the two can never disagree about what a block is |

## Why this change exists

`/scrub:init` writes the block once and then refuses forever. A project that already has a block can never receive a template fix — and template fixes are not hypothetical: on 2026-10-27 the block's rename rule was corrected (`session-scrub-mark-on-precedence`), and the only way to deliver it to an existing `AGENTS.md` was a hand edit. That hand edit is the bug.

The failure is quiet by construction: the block looks authoritative, the agent obeys the copy that is written there, and nothing in the plugin ever compares it to the template. The stale block wins forever.

## UD-01 — `--update` refreshes the region, and ownership decides what may change

`/scrub:init --update` MUST locate the block the same way the parser does — the first unfenced `POLICY_START` and the first unfenced `POLICY_END` after it (PB-01, PB-02) — and MUST replace the region between the markers with the current `POLICY_TEMPLATE`.

Ownership is the rule that makes this safe enough to automate:

| line inside the markers | owner | what `--update` does |
| --- | --- | --- |
| blank | template | rewritten |
| `#`-comment (the guidance prose) | template | rewritten |
| `verdicts:` , `mark-on:` | template | rewritten |
| `ephemeral-flows:` | **human** | the value is preserved verbatim, the key line is re-emitted by the template |
| anything else non-blank | nobody | **refuse**, naming the 1-based line and its text |

A refusal MUST write nothing and MUST tell the human what to do: `Move it outside the markers.` A line the plugin does not recognize is not the plugin's to delete, and guessing that a human wants it gone is exactly the class of mistake this table exists to prevent.

#### Scenario: a stale block gets the new guidance and keeps the project's flows
- GIVEN an `AGENTS.md` whose block carries the previous template's `session_rename` rule and `ephemeral-flows: code-review, spike`
- WHEN `/scrub:init --update` is accepted
- THEN the block carries the current rule and the precedence section, and its `ephemeral-flows:` line still reads `code-review, spike`.

#### Scenario: a human line inside the markers stops the update
- GIVEN a block containing `notes: read this before triage`
- WHEN `/scrub:init --update` runs
- THEN it notifies the refusal naming that line, and `AGENTS.md` is byte-for-byte unchanged.

#### Scenario: an unterminated block is refused, not repaired
- GIVEN a start marker with no end marker after it
- WHEN `/scrub:init --update` runs
- THEN it refuses naming the start line and writes nothing: the region has no known end, so the plugin does not invent one.

#### Scenario: no block means it is a first run
- GIVEN an `AGENTS.md` with no block
- WHEN `/scrub:init --update` runs
- THEN it appends the template exactly as a plain `/scrub:init` would, with the same message.

## UD-02 — A refresh shows what changes, asks, backs up, and writes behind the guard

`--dry-run` and any non-interactive mode (REQ-11) MUST report the same text the confirmation would show and MUST write nothing. In the TUI the command MUST show the diff — the changed lines only, `-` for what leaves and `+` for what arrives — and MUST ask before writing. Before the write it MUST copy `AGENTS.md` into the backups root (`sessionfs.ts:getBackupDir`) and MUST name that path in the success message. The write MUST go through the §9.6 guard, so a symlinked or non-regular `AGENTS.md` is refused with `Could not write AGENTS.md: refusing to write through AGENTS.md: not a regular file (<path>)` and the link target stays byte-for-byte unchanged. Every failure MUST be notified, never thrown outward (PB-04).

#### Scenario: dry-run changes nothing
- GIVEN a stale block
- WHEN `/scrub:init --update --dry-run` runs
- THEN the diff is reported and `AGENTS.md` is unchanged.

#### Scenario: a symlinked AGENTS.md is refused
- GIVEN `AGENTS.md` as a symlink to a file outside the project
- WHEN the update is accepted
- THEN the refusal names the path and the target file is byte-for-byte unchanged.

## UD-03 — Two `ephemeral-flows:` lines stop the update

A block with more than one `ephemeral-flows:` line MUST be refused by the line number of the second one. The parser unions such lines today; collapsing them into one line is a merge decision, and the plugin MUST NOT make it silently on the human's data.

## UD-04 — The update is idempotent, and the scanner is shared

Applying the update and planning it again MUST report `current` and write nothing: the first run normalizes the region to the template, the second finds it already there. `planInitWrite` and `planInitUpdate` MUST share one region scanner, so "a block exists at line N" can never mean two different things to the two paths.

#### Scenario: the second run is a no-op
- GIVEN a block just refreshed by `--update`
- WHEN the update is planned again
- THEN the plan is `current` and nothing is written.

## Non-goals

- No merge of human-edited guidance: the diff is the record of what leaves, and the human accepts it or does not run the command.
- No version marker inside the block: `current` is decided by comparing text, not by trusting a version the block declares about itself.
- No automatic invocation: the command stays human-typed (opt-in, no hooks).
