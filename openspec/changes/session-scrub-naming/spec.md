# Spec — session-scrub-naming

**Change ID:** `session-scrub-naming`
**Date:** 2026-10-07
**Against:** canonical `openspec/specs/session-scrub/spec.md` v0.3.0 (`3dd6361`) — REQ-01..12, Slice-2 TR-01..13, Slice-3 UX-01..08
**Status:** T3 resolved the three questions left open by `proposal.md` §5. T4 (command surface, name source, confirmation UX) remains open.

## 0. What this delta changes

| target | action |
|---|---|
| REQ-09 Slice-1 clause | withdrawn as stale (already superseded by Slice-3 UX-05) |
| §Out of scope "LLM naming / programmatic `setSessionName()`" | removed |
| REQ-01 / D2 classification predicate | **modified** by NM-04 and NM-05 |
| F2 (no `--force` flag) | **unchanged**; NM-03 states the boundary that keeps it intact |
| new: naming guard | **added** by NM-03 |

Slice-2 and Slice-3 requirements are not reopened.

---

### NM-01 — Naming boundary

The system MUST write a session name only for a session under the current runtime's own
session directory, MUST NOT open the live session for writing on any automated path, and
MUST NOT write a name outside an explicit user action in the same invocation.

#### Scenario: own home only
- GIVEN a plugin instance in runtime R
- WHEN a naming action targets a session outside R's session directory
- THEN the target is not resolvable through the plugin and is never opened

#### Scenario: no autonomous naming
- GIVEN an unnamed session with a pending `session-scrub/name-hint`
- WHEN no naming command is invoked
- THEN no `session_info` entry is appended

---

### NM-02 — Naming writes are append-only, backed up and validated

The system MUST write names through `SessionManager.open(path).appendSessionInfo(name)`,
MUST NOT rewrite existing entries or compute `parentId` by hand, MUST write a per-file
backup into `getTrashDir()` before each write, and MUST parse the file before writing and
verify afterwards that it still parses and gained exactly one entry.

#### Scenario: append survives a malformed line
- GIVEN a session file whose array already contains a malformed line
- WHEN a name is appended
- THEN the malformed line is untouched and the new entry is the last one

#### Scenario: post-write verification fails
- GIVEN a write whose post-write re-read does not match the requested name
- WHEN verification runs
- THEN the result is surfaced as a warning and bucketed as an error, not reported as applied

---

### NM-03 — Liveness guard: process liveness is primary, mtime is the cross-process net, and a fresh mtime raises the bar instead of blocking

The system MUST refuse to write to the current process's own live session. For any other
session, the system MUST NOT treat a file modified within 120 seconds as *live* — it MUST
raise the confirmation requirement instead of refusing, stating the elapsed time, warning
that writing over a live session can interleave with Pi's own flush, and naming the backup
location. The system MUST NOT provide a `--force` or equivalent bypass.

This leaves F2 intact: there is no flag, and every write still requires explicit per-item
selection or is dry-run only in non-TUI.

**Why `mtime` cannot be a block:** a session closed five seconds ago and a session actively
open in another terminal both satisfy "modified within 120 s". The first is the ordinary
path of the feature; the second is the dangerous one. A block cannot separate them, so the
guard separates by *cost* instead. The only true bypass available to the user is waiting.

**Known limitation, accepted:** the plugin cannot see sessions live in other processes, so
the mtime net is a heuristic, not knowledge. The extra confirmation transfers the residual
risk to an informed human rather than removing it.

#### Scenario: own live session is refused outright
- GIVEN the running session
- WHEN a naming action targets it
- THEN the action is refused with an error and nothing is written

#### Scenario: freshly written file is confirmed, not blocked
- GIVEN a non-live session whose file was modified 8 seconds ago
- WHEN the naming action targets it
- THEN the confirmation states the elapsed time and the backup location, and proceeds only
  on an explicit accept

#### Scenario: no bypass exists
- GIVEN the above
- WHEN the user looks for a flag that skips the warning
- THEN no such flag is accepted by the parser

---

### NM-04 — An explicit verdict short-circuits the structural checks

`classifySession` MUST evaluate explicit verdicts before the empty-session and age checks.
`trash`, `finished` and `ephemeral` remain candidates and are evaluated first as today; any
other explicit verdict MUST yield `kept` and MUST NOT be overridden by the empty-session
check or by the 7-day age check. The empty-session and age checks apply only to sessions
carrying no verdict at all.

This reverses the current order at `index.ts:231-288`, where `messageCount === 0` (269) and
the age check (272) both precede the `verdict !== undefined` branch (285).

**Justification:** an explicit verdict is a decision taken by someone who looked at that
session. An empty check or a 7-day window is a population-level heuristic. A heuristic
overriding a specific decision is backwards. Observed impact on the current population is
zero — no session carries `keep`, and the single `paused` session is named and therefore
protected earlier — so this is preventive, not corrective.

**Accepted cost:** a `keep` verdict on an empty session keeps it indefinitely. The session
is still visible in `/scrub` with its verdict, so the retention is observable.

#### Scenario: keep with old content is protected
- GIVEN an unnamed session with 40 messages, 30 days old, verdict `keep`
- WHEN `/scrub` classifies it
- THEN its kind is kept, and `/scrub-apply` does not offer it

#### Scenario: verdict-less old session still needs confirm
- GIVEN an unnamed session with 3 conversation turns, 30 days old, no verdict
- WHEN `/scrub` classifies it
- THEN its kind is old-needs-confirm and `/scrub-apply` may offer it with the detail view

#### Scenario: empty session without verdict is still auto-deletable
- GIVEN an unnamed empty session, no verdict
- WHEN `/scrub` classifies it
- THEN its kind is auto-deletable, unchanged from today

---

### NM-05 — Conversation turns, not bytes or lines, floor the deletion candidacy

A session carrying no verdict MUST NOT become a deletion candidate solely for being unnamed
once it holds at least five conversation turns, where a conversation turn is a message entry
whose `role` is `user` or `assistant`. Turns MUST be counted independently of file size and
of total entry count.

Grounding, from a read-only sweep of all 75 sessions across both homes (2026-10-07):

- Every trivial session holds 2–4 conversation turns; all real work holds 6 or more, with
  `01a10e25` at 778. The observed gap is between 4 and 6.
- File size is not a usable discriminator and is in fact inverted at the small end: sessions
  of 7 lines weigh 99–116 KB because the system preamble is a fixed ~90–110 KB, so a size
  rule would protect a throwaway.
- Line count is also rejected: `lines` counts non-conversation entries (model changes,
  thinking-level changes, custom entries), which mixes volume with dialogue.

**Field semantics to verify during implementation.** `classifySession` receives
`SessionInfo` and today reads `SessionInfo.messageCount` (`index.ts:269`), a Pi API field
whose exact counting semantics are not verified by this spec. The plugin's synthesized
live record sets `messageCount` to `entries.length` (`index.ts:504`), which counts every
entry type — a different meaning for the same field name. The implementer MUST confirm what
Pi counts in `SessionInfo.messageCount`. If it is not `user`+`assistant` messages, the
threshold MUST be adjusted for the difference or the count plumbed explicitly. **Recorded as
UNVERIFIED at spec time.**

#### Scenario: large unnamed work session is protected
- GIVEN an unnamed session with 778 conversation turns and no verdict
- WHEN `/scrub` classifies it
- THEN its kind is kept, not old-needs-confirm, regardless of its age

#### Scenario: short unnamed session remains a candidate
- GIVEN an unnamed session with 3 conversation turns, 30 days old, no verdict
- WHEN `/scrub` classifies it
- THEN its kind is old-needs-confirm

#### Scenario: size does not influence the outcome
- GIVEN two unnamed verdict-less sessions of 4 and 40 conversation turns, of 1 MB and 100 KB
- WHEN `/scrub` classifies them
- THEN the outcome depends only on turn count, and the 100 KB session with 40 turns is kept

---

## Still open — T4

Not decided by this spec:

1. The command surface: a new command versus extending `/scrub-triage`.
2. The source of names: `deriveSlug` on the first user message (weak for long sessions) versus
   a bounded model pass over digest packs, versus human-typed slugs.
3. The confirmation UX: how many prompts, in what order, and whether a bulk path exists.
4. Whether NM-03's extra confirmation is per-item or once per batch.

## Verification status

No automated harness exists. NM-04 and NM-05 are pure predicate changes and are testable by
unit-level extraction; NM-01 through NM-03 require live session fixtures. Manual scenarios
must be added to the spec's numbered list (§ Manual test scenarios) as part of T4.
