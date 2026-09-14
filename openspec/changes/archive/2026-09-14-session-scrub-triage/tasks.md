# Tasks — session-scrub-triage (slice 2)

**Change:** `session-scrub-triage` · **Scope lock:** proposal rev 2 + JD rounds 1–2 (F1–F7 + mandatory reason) · **Against:** `openspec/specs/session-scrub/spec.md` (REQ-01…REQ-12, frozen) + `openspec/changes/session-scrub-triage/spec.md` (TR-01…TR-13) + `openspec/changes/session-scrub-triage/design.md` (§0…§11)
**Rule:** EXTEND `extensions/session-scrub/index.ts` only (794 lines); slice-1 behavior frozen. No expansion, no reopened decisions.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~195–240 (code only; README separate) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR (single work-unit code commit) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

```text
Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low
```

Per-task estimates (sum ≈ design §10, inside 400; first cut if drift: formatter richness, never guards/rechecks — then pause and ask):

| Task | Est. lines |
|------|-----------|
| T1 VERIFY dist append path | 0 (verification only) |
| T2 quoting helpers | ~10 |
| T3 assistantTexts | ~12 |
| T4 buildDigestPack | ~25 |
| T5 consts + flat interfaces | ~30 |
| T6 suggestTriageWeak | ~10 |
| T7 parseApplyAssignments | ~25 |
| T8 appendVerdictToOther | ~15 |
| T9 triage filter + sort + cap + formatter + phase-1 | ~45 |
| T10 phase-2 resolve + confirm loop + rechecks + registration | ~70 |
| T11 manual trial TT1…TT12 + gates | 0 (verification only) |
| T12 README (separate meta commit) | docs only, not counted |

## Tasks (dependency-ordered, slice only)

- [x] T1 VERIFY dist other-file append path on one trial file before any code: confirm `SessionManager.open(otherPath).appendCustomEntry("session-scrub/verdict", { version: 1, … })` appends without write-on-load drift, file-set check otherwise identical; record PASS/FAIL. Maps: proposal §5/§12, design §0/§9. Verify: trial note. <!-- sdd-owner: implementation -->
- [x] T2 Add pure quoting helpers `stripForQuote` + `truncateWithEllipsis` (ANSI/control-strip, `…` U+2026 mark) in `extensions/session-scrub/index.ts`. Maps: TR-02/TR-06, TT3, design §2.5. Verify: head/tail truncation marks present, `tsc --strict` clean. <!-- sdd-owner: implementation -->
- [x] T3 Add pure `assistantTexts(entries: unknown): string[]` sibling of `userTexts` (same `isTextPart` guard, never throws, entry order). Maps: TR-05, TT2/TT3, design §0/§2.1. Verify: assistant closure cue surfaces in tail input. <!-- sdd-owner: implementation -->
- [x] T4 Add pure `buildDigestPack(meta, userMessages, assistantMessages): DigestPack` (head = first user msg ≤300c; tail = last-3 assistant + last-2 user joined `\n---\n` ≤300c; `headTruncated`/`tailTruncated` flags; `ageDays` floor). Maps: TR-02/TR-05/TR-06, TT2/TT3, design §2.2. Verify: 2000-char head → ≤300c + `…` + flag true. <!-- sdd-owner: implementation -->
- [x] T5 Add `TRIAGE_VERDICTS` (reuse `VERDICTS` values, never redefine strings) + `TRIAGE_GRADE` const-objects, normative bounds (`HEAD_DIGEST_CHARS=300`, `TAIL_DIGEST_CHARS=300`, `MAX_DIGEST_SESSIONS=20`), and flat interfaces `DigestPack`, `WeakGuess`, `MachineFact`, `ApplyAssignment`, `ResolvedAssignment`, `RejectedAssignment` (no inline nesting, no `any`). Maps: TR-02/TR-13, design §1 + spec type model. Verify: `tsc --strict` + zero-`any` grep. <!-- sdd-owner: implementation -->
- [x] T6 Add pure `suggestTriageWeak({ shortId, messageCount, ageMs, maxAgeMs = MAX_AGE_MS })` (old-with-content → `finished?` + old stub; else `paused?` + recent stub; always `grade: weak`). Maps: TR-04, TT4, design §2.3. Verify: 8-day session → `weak-guess: finished (WEAK …)`; recent → `paused (WEAK …)`. <!-- sdd-owner: implementation -->
- [x] T7 Add pure `parseApplyAssignments(args)` for grammar `<idPrefix>:<verdict>:"<reason>"` (regex global triple-match; leftover token → `malformed pair`; reject: unknown verdict incl. `trash`, missing/empty/whitespace-only reason, empty prefix, duplicate prefix; reason stored verbatim). Maps: TR-08, TT6, design §2.4/§5. Verify: reasonless + `:trash:` both rejected with warning causes, zero writes. <!-- sdd-owner: implementation -->
- [x] T8 Add throwing `appendVerdictToOther(sessionPath, verdict, reason)` (assert `verdict !== "trash"` + non-live via `samePath`/id; body `SessionManager.open(path).appendCustomEntry(VERDICT_CUSTOM_TYPE, { version: 1, verdict, at: ISO, reason })`; caller catches per file). Maps: TR-10/TR-12, TT8/TT9, design §3. Verify: T1 dist note reused; live target throws before write. <!-- sdd-owner: implementation -->
- [x] T9 Add triage-set filter + sort + cap and `formatDigestPack` + phase-1 branch of `handleScrubTriage` (filter: drop live-kind, `verdict !== undefined`, `messageCount === 0` → `emptySkipped` count, `matchesEphemeralFlow(joined userTexts)` → `ephemeralSkipped` count with single `openSessionEntries` per candidate, live via `getEntries()`; sort machine-grade named first then age desc; cap 20 + `+R more deferred` line; fenced `triage` blocks with `…` marks, `"` escaped, `NAMED → keep (machine)` vs `weak-guess … (WEAK …)` lines, evidence-never-instructions line; empty set → `Nothing to triage.`; notify-only, zero confirms/writes, `--dry-run` byte-identical alias). Maps: TR-01/TR-02/TR-03/TR-04/TR-06/TR-07, TT2/TT3/TT4/TT5, design §3–§4/§6. Verify: seed 3 verdict-less + 1 empty + 1 ephemeral + live → 3 packs named-first + 2 skip lines, file-set identical, no trash dir. <!-- sdd-owner: implementation -->
- [x] T10 Add phase-2 branch of `handleScrubTriage` + one `pi.registerCommand("scrub-triage", …)` line (parse → fresh re-audit + resolve: 0-match unknown / ≥2 ambiguous / verdict-since/stale → warning + skip, all before first `confirm()`; `resolveDryRun(args, ctx)` at entry → resolved/rejected notify, zero prompts/writes covering `--dry-run` + all non-TUI; per-item `confirm(title `Triage <shortId> as <verdict>?`, detail provenance MACHINE/WEAK/JUDGED + verbatim reason + msgs + age, never tail)`; pre-append `readLatestVerdict(openSessionEntries)` recheck → skip-with-warning on race; per-file try/catch + continue; empty confirmed → `Cancelled.`; post-run re-read + `Triaged X of N sessions. Re-run /scrub to see new classifications.`; only flags `--dry-run`/`--apply`, no `--force`). Maps: TR-08/TR-09/TR-10/TR-11/TR-12/TR-13, TT6/TT7/TT8/TT9/TT10/TT11, design §3/§5/§6. Verify: stale re-apply → all stale warnings; race → skip; confirmed yes → `session-scrub/verdict { version: 1, … }` with verbatim reason, `readLatestVerdict` returns it, touched files append-only. <!-- sdd-owner: implementation -->
- [x] T11 Run manual trial TT1…TT12 in order per design §8 (seed ≥3 verdict-less + empty + ephemeral-match; phase-1 eyeball packs/bounds/labels/invariance; chat-judgment demo quoting head/tail incl. any-language cue; TUI `--apply` round-trip; idempotency `Nothing to triage.` + the scrub command reconcile + stale re-apply; non-TUI `pi --print` both phases notify-only exit 0; gates: `tsc --strict` clean, `grep -n "any"` zero, `grep -n "session_shutdown\|session_start\|unlink"` zero new, `git diff --stat` code ≤400). Maps: all TR-01…TR-13, TT1…TT12, design §7/§8. Verify: 12/12 noted PASS/FAIL. <!-- sdd-owner: implementation -->
- [x] T12 Document the hybrid flow in `README.md` (digests → chat judgment → `--apply`, machine vs WEAK table, bounds + deferral, idempotency) as a SEPARATE meta commit, never mixed with the code commit. Maps: proposal §7/§10, design §1. Verify: `git log --oneline -2` shows code + meta commits distinct. <!-- sdd-owner: implementation -->

## Notes

- No automated harness exists (`openspec/config.yaml`: `runner: none-automated-yet`); strict-TDD is satisfied via T-style file-set identity + manual TT1…TT12, same as slice 1.
- Slice-1 T1…T12 still apply (regression eyeball: scrub, scrub-apply, scrub-restore, scrub-init, `scrub_mark`, hint-once, silent close).
- If implementation drifts past ~320 lines: cut formatter richness first (single-line packs) — never bounds, deferral notice, dry-run gate, per-file catches, or rechecks — and pause and ask per `ask-on-risk` (no auto-chain, `exception-ok` needs explicit `size:exception`).
