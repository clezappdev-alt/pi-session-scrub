# Proposal — session-scrub-naming

**Change ID:** `session-scrub-naming`
**Status:** proposed
**Date:** 2026-10-07
**Parent / predecessor:** canonical `openspec/specs/session-scrub/spec.md` v0.3.0 (`1d4b836`). Slice-1 REQ-01..12, Slice-2 TR-01..13 and Slice-3 UX-01..08 are read-only input, not reopened.
**Store:** openspec repo-local
**Input artifacts:** owner decisions 2026-10-07 (this session), population scan of 75 sessions (read-only), Pi 1.0.4 source (`interactive-mode.js`), reference script `pi-rename-session.py` (git-ignored, local-only, reference of intent — not of code)
**skill_resolution:** paths-injected (`pi-plugin-dev` read before work)

> This change supersedes the REQ-09 prohibition on programmatic naming. It does not
> yet specify the command surface, the guard mechanism, or the confirmation UX: those
> are specified by this change's own spec delta at task T4. What is decided here is the
> reversal itself and the invariants that survive it.

---

## 1. Intent

Make session naming a capability of the plugin instead of a manual `/resume` + `/name`
round-trip, and fix the classification predicate that currently treats every unnamed
session as a deletion candidate. The picker is where the human resumes work; a session
that has no name is invisible there, and no amount of downstream cleanup makes it
findable.

## 2. Problem

1. **The plugin stops one step short of its purpose.** It offers `sugerido: /name <slug>`
   in a status line, writes a `name-hint` gate entry, and stops. The human must leave,
   resume the session, and type `/name`. The suggestion has no effect on its own.
2. **The slug is weak exactly where it matters.** `deriveSlug` reads the first user
   message. For a 2-turn session that is a good name; for the 778-turn model-alignment
   workstream it produces a generic label.
3. **The classification predicate is disconfirmed by the data.** REQ-01/D2 treats unnamed
   as cleanable. The population scan found `01a10e25` — 6.0 MB, 1671 lines, 778
   user/assistant turns, unnamed — which is real work, not trash. Deleting by
   "unnamed" would have removed it.
4. **The existing criterion is also wrong on small sessions.** Bytes measure context
   payload, not work: 7-line sessions weigh 99–116 KB because the system preamble is a
   fixed ~90–110 KB. A size rule would protect a throwaway and is useless as a
   discriminator. User/assistant turn count separates the population cleanly (trivials
   2–4 turns, real work ≥6).

## 3. Decision — reversal of REQ-09

**REQ-09 currently states:** *"…and MUST NOT call `setSessionName()` programmatically;
naming happens only via the user's `/name`."*

**REVERSED.** Programmatic naming is permitted for sessions in the current runtime's own
home, subject to the invariants below. The existing hint behaviour of REQ-09 (once per
unnamed session, gated by `session-scrub/name-hint`) is unchanged and remains the
default path: the plugin suggests, the human accepts by typing `/name`. Programmatic
naming is an additional opt-in path, never an automatic one.

**`session_info.name` and `session-scrub/name-hint` remain separate entry types with
distinct roles.** `name` is what the human reads to resume; `name-hint` is a pending
name proposal with a dedupe flag. They are not merged, and neither is derived from the
other.

The §Out of scope line *"LLM naming / programmatic `setSessionName()`"* is removed.

### Rationale for the reversal

The prohibition dates from the `session-hygiene` failure recorded in `PRD.md` — a hook
that injected ~400 tokens of ceremony into every first turn and blocked real work. That
concern is real and is not being dismissed; it is addressed by §4 rather than by
keeping a prohibition that no longer matches what is being built.

## 4. Invariants that survive the reversal

- **I-1 Own home only.** A plugin instance in runtime R touches only sessions under R's
  session directory. No cross-home listing, no cross-home write. (Owner decision,
  2026-10-07.)
- **I-2 Never the live session.** The existing invariant holds without exception: the
  running session is never opened for writing by any automated path.
- **I-3 Append-only via the Pi API.** Names are written with
  `SessionManager.open(path).appendSessionInfo(name)`. Pi's own `/resume` rename uses
  the same call (`interactive-mode.js`, `renameSession`). Existing entries are never
  rewritten and `parentId` is never computed by hand.
- **I-4 Reversible by construction.** A later `appendSessionInfo` supersedes an earlier
  name. No undo command is required for correctness; whether one is offered is a UX
  question for T4.
- **I-5 Backup before write.** A per-file backup precedes every write, into the plugin's
  existing trash directory (`getTrashDir`) — not `/tmp`, which workspace hygiene purges.
- **I-6 Explicit invocation, zero cost by default.** Nothing runs unless the user invokes
  a command. No `agent_start` injection, no per-turn tokens. The `constraints` block of
  `openspec/config.yaml` is unchanged.
- **I-7 Validate around the write.** Parse the file before writing; verify afterwards that
  it still parses and has exactly one entry more.

## 5. Open questions — each anchored to its normative artifact

These are **not** decided by this proposal. T3 resolves them.

1. **Guard mechanism (new requirement, no anchor).** The reference script used a
   120-second `mtime` window. The owner reserved this for the plugin, on the reasoning
   that the plugin knows which sessions are live because it watches them close. Note the
   measured cost: only 1 of 75 sessions is within 120 s of a write, but the common
   workflow — close a session, then name it — lands squarely inside that window.
2. **Bypass flag, anchored to F2.** F2 states *"No `--force` flag exists. Every
   destructive path requires explicit per-item selection."* Naming is reversible by
   construction (I-4), so whether it constitutes a "destructive path" under F2 is the
   question. F2 is a fixed decision and is not silently overridden here.
3. **Classification predicate, anchored to D2 / REQ-01.** The 7-day constant and the
   named-is-protected rule are fixed decisions. The scan proposes replacing
   "unnamed ⇒ cleanable" with turn-count discrimination, and supplies the population
   distribution that any threshold must be justified against. D2 is not reopened by this
   proposal.

## 6. Non-goals

- A unified listing across both session homes (owner decision: each runtime owns its home).
- Removing or altering the existing `name-hint` behaviour.
- Any write to a session file belonging to the other runtime.
- Automatic naming without an explicit user action in the same invocation.
- Migrating or bulk-renaming historical sessions without confirmation.

## 7. Acceptance for the reversal (T1)

1. The canonical spec no longer contains the prohibition in REQ-09.
2. The canonical spec no longer lists programmatic `setSessionName()` as out of scope.
3. §4's invariants are present in the spec delta with scenario coverage.
4. §5's open questions are recorded against their artifacts, with no silent resolution.

Remaining tasks in this change: T2 behaviour documentation, T3 open-question
resolution, T4 design, T5 implementation and verification.