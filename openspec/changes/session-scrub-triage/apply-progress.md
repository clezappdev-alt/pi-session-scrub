# Apply progress — session-scrub-triage (RECONCILE mode)

**Change:** `session-scrub-triage` · **Mode:** reconcile (implementation pre-exists, committed, user-reviewed) · **Date:** 2026-09-14
**Commits reconciled:** `f5d4940` (code, +486/-4), `bed10e5` (fixup, +97/-36), `325dcc7` (meta README, +31)
**Tasks:** T1–T12 all ticked `- [x]` in `tasks.md`. No code written by this phase (ticks + this file only).

## Per-task evidence (code refs in `extensions/session-scrub/index.ts`)

- **T1** — dist other-file append path VERIFIED on trial files pre-commit (no write-on-load drift); carried by `appendVerdictToOther` (L1025, `SessionManager.open(path).appendCustomEntry(VERDICT_CUSTOM_TYPE, { version: 1, … })`, append-only).
- **T2** — `stripForQuote` (L827) + `truncateWithEllipsis` (L836) + `truncateTailFromFront` (L841) present; `…` U+2026 mark; zero-width strip per deviation 2.
- **T3** — via `orderedMessageTexts` (L855, chronological user+assistant merge, `isTextPart` guard, never throws); supersedes standalone `assistantTexts` per deviations 1/5 (ACCEPT).
- **T4** — `buildDigestPack` (L872): head = first user msg ≤300c, tail = last-3-assistant + last-2-user in file order ≤300c, truncation flags, `ageDays` floor.
- **T5** — `TRIAGE_VERDICT` (L748, values identical to `VERDICTS` subset) + `TRIAGE_GRADE` (L756), bounds 300/300/20 (L763–765), flat `DigestPack`/`WeakGuess`/`MachineFact`/`ApplyAssignment`/`ResolvedAssignment`/`RejectedAssignment` (+ additive `TriageCandidate`, `OrderedMessage`); `grep any` → zero.
- **T6** — `suggestTriageWeak` (L921, `maxAgeMs = MAX_AGE_MS` at L1159, always `grade: weak`).
- **T7** — `parseApplyAssignments` (L960): global triple-match `ASSIGN_RE`, mandatory verbatim reason, rejects trash/unknown/missing-reason/empty-prefix/duplicate + leftover `malformed pair`.
- **T8** — `appendVerdictToOther` (L1025): throws on trash, gone file, live target (`livePath` + `samePath`, deviation 4).
- **T9** — `gatherTriageCandidates` (L1082: live/verdict/empty/ephemeral filter + named-first + `modified` sort per deviation 6) + `formatDigestPack` (L1054, fenced `triage` blocks, escaped quotes, MACHINE vs WEAK lines) + `handleScrubTriagePhase1` (L1122: cap 20 + `+R more deferred`, `Nothing to triage.`, notify-only, `--dry-run` same path).
- **T10** — `handleScrubTriagePhase2` (L1174) + `handleScrubTriage` (L1263, `resolveDryRun` choke L1269) + `pi.registerCommand("scrub-triage", …)` (L1315): fresh resolve (unknown/ambiguous/stale → warning + skip, before first `confirm`), per-item `confirm` (id + verdict + provenance + verbatim reason, no tail), idempotent pre-append recheck (deviation 7), per-file try/catch, `Cancelled.`, categorized summary (deviation 8), only `--dry-run`/`--apply` flags.
- **T11** — manual TT1–TT12 ran 12/12 PASS pre-fixup on seed sessions (phase-1 packs, TUI `--apply` round-trip, idempotency, stale re-apply, non-TUI notify-only, gates); post-fixup functional tests PASS on bundled code (chronological merge, front truncation, zero-width strip, escaped-quote parse + unescape). `openspec/config.yaml` runner is `none-automated-yet`; manual TT evidence counts per tasks.md Notes.
- **T12** — README `## Triage` section (hybrid flow, grade table, bounds + deferral, escapes, categorized summary, idempotency) in standalone meta commit `325dcc7`.

## Accepted deviations (user-decided 2026-09-14, in `bed10e5`)

1. Tail chronological (last-3 assistant + last-2 user in file order via `orderedMessageTexts`), front-truncated (`truncateTailFromFront`) — design §2.2 said assistant-first/back-truncated.
2. `stripForQuote` also strips U+200B–U+200D + U+FEFF.
3. Apply reasons support `\"`/`\\` escapes (`unescapeReason`, symmetric with `escapeQuote`).
4. `appendVerdictToOther` takes `livePath`, refuses gone files / live session.
5. Lazy text extraction: `TriageCandidate` carries entries; `orderedMessageTexts` runs only for shown packs.
6. Candidate sort key is `modified` (was `created`); named-first tier unchanged.
7. Pre-append recheck idempotent: identical concurrent verdict counts as triaged (info), different verdict skips (warning).
8. Categorized final summary (applied + already / declined / conflict / error with shortIds).

Minor variances noted (ACCEPT, not gaps): `TRIAGE_VERDICT` singular vs task's `TRIAGE_VERDICTS`; `buildDigestPack` takes `OrderedMessage[]` instead of two arrays; ANSI strip covers SGR-`m` only; head truncation yields bound+1 chars max (`slice(0, max)+…`); phase-2 provenance shows `MACHINE`/`WEAK` (assignment itself is the judged verdict, no bare `JUDGED` label). `size:exception` for the `f5d4940` +486 delta was accepted at commit time (noted in its message).

## Verification re-run by this phase

- `tsc -p /tmp/scrub-typecheck/tsconfig.json --noEmit` → exit 0 (re-run 2026-09-14).
- `grep -n "any"` (non-comment) → zero; `grep session_shutdown|session_start|unlink` → zero new (re-run).
- esbuild bundle + bundled functional tests: PASS per pre-existing evidence (not re-run; binaries unchanged since).
- Plain repo-local `tsc` shows 26 pre-existing environmental errors (missing `node_modules`) — identical pre/post change, not regressions.

## Remaining

None. All T1–T12 complete. No genuine gaps found (nothing under/over the ~30-line fix threshold arose).
