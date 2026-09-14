# Tasks — session-scrub-triage-ux

**Change:** `session-scrub-triage-ux` · **Scope lock:** proposal (I1+I2+I3+I4+I5+I7, I6 OUT) + spec UX-01..UX-08 + design §§2–8 · **Against:** `extensions/session-scrub/index.ts` (Slice-2 triage section)
**Rule:** EXTEND `extensions/session-scrub/index.ts` only; Slice-1/2 behavior frozen except the specified presentation/confirm-layer changes. No new commands, no new TUI surface, no triage-set change.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~240 (code only; README separate) |
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

Per-task estimates (sum ≈ design §10 ~240, inside 400; first-cut if drift past ~320: formatter richness first, never guards/rechecks — then pause and ask):

| Task | Est. lines |
|------|-----------|
| T1 VERIFY rename append path (trial-first) | 0 (verification only) |
| T2 flat interfaces | ~20 |
| T3 partition + WEAK-first sort + cap | ~15 |
| T4 compact formatter + `--verbose` render | ~35 |
| T5 deferred shortId line | ~10 |
| T6 rename parser + shared-cursor merge | ~35 |
| T7 reasonless machine-keep arm + provenance gate | ~20 |
| T8 bulk fan-in (one confirm + dated rationale) | ~30 |
| T9 appendRenameToOther + existing-name + re-read | ~25 |
| T10 rename resolve + per-item loop + summary + dry-run echo + flag plumbing | ~50 |
| T11 manual trial TU1…TU8 + gates | 0 (verification only) |
| T12 README (separate meta commit) | docs only, not counted |

## Tasks (dependency-ordered, slice only)

- [x] T1 VERIFY rename other-file append path on trial files BEFORE any rename code (TT8 pattern): `SessionManager.open(other).appendSessionInfo("dup-name")` on two trial files → fresh-open `getSessionName()` reads back both slugs + the resume list shows both; re-check `normalizeSessionName`/`appendSessionInfo`/`getSessionName` in the pinned Pi version (dist paths `cli/args.js`, `core/session-manager.js` per explore §2); record PASS/FAIL; any signature drift → pause per ask-on-risk. Maps: UX-05, design §5/§9, explore §2. Verify: trial note PASS. <!-- sdd-owner: implementation -->
- [x] T2 Add flat interfaces `MachineKeepBulk { shortIds, rationale }`, `RenameAssignment { idPrefix, slug }`, `ResolvedRename { assignment, targetPath, shortId, existingName? }`, `RejectedRename { raw, cause }` in `extensions/session-scrub/index.ts` (flat, no inline nesting, no `any`, const-object verdict/grade maps reused verbatim). Maps: UX-03/UX-05/UX-08, design §1 + spec type model. Verify: `tsc --strict` clean + zero-`any` grep. <!-- sdd-owner: implementation -->
- [x] T3 Add pure `partitionTriageCandidates(candidates)` (machine-keep ⟺ `info.name` non-blank after trim, same named test as Slice-2; rest → weakQueue; in-memory, no second `list()`/`open()`) + normative page-1 order (weakQueue by `modified` desc, then machineKeeps in gather order stable) + `page = ordered.slice(0, 20)` / `deferred = ordered.slice(20)`. Maps: UX-01, design §2. Verify: 7 WEAK + 20 machine seed → page holds all 7 WEAK first, cap 20. <!-- sdd-owner: implementation -->
- [x] T4 Add pure `formatCompactRow({ shortId, messageCount, ageDays, sessionName?, weakGuess, head })` (schema `<short> · <msgs>msgs · <age>d · [named "<name>" | unnamed] · <weak-guess> · <head-first-~120c>`, prefix of already-built head, `escapeQuote` on render) + phase-1 render branches (default: machine compact rows + WEAK `formatDigestPack` blocks only, zero machine full packs; `--verbose`: + full packs for every shown session; table always present) + `verbose` flag threading (`args.split(/\s+/).includes("--verbose")` into phase-1 and phase-2 echo; `--verbose` added to the parse-cleaning strip list). Maps: UX-02, design §3. Verify: default run shows machine one-liners + WEAK packs, no machine full packs; `--verbose` adds machine packs. <!-- sdd-owner: implementation -->
- [x] T5 Replace opaque `+R more deferred` line with deferred-ID line `deferred (<R>): <short1>, <short2>, …` listing `ordered.slice(20)` shortIds in §2 page order (+ optional msgs/age only if bounded; no packs, no guesses; deferred rows never reach `buildDigestPack`/`suggestTriageWeak`). Maps: UX-06, design §8. Verify: 25 qualifying → deferred line lists exactly 5 shortIds in page order. <!-- sdd-owner: implementation -->
- [x] T6 Add `RENAME_RE = /(\S+?):name:"((?:[^"\\]|\\.)*)"/g` + pure `parseRenameAssignments(cleaned)` for own-line `id:name:"slug"` (alongside, not inside, verdict triples; slug norm `unescapeReason(raw).replace(/[\r\n]+/g, " ").trim()`; empty-after-trim → rejected `empty rename slug`, never writes; duplicate idPrefix across rename ok-list or verdict/rename collision → second rejected `duplicate assignment`; no charset/length/uniqueness checks) + shared-cursor merge so rename tokens never surface as verdict `malformed pair` leftovers and vice versa. Maps: UX-05, design §5/§6. Verify: `:name:"   "` rejected zero-write; `id:name:"slug"` never appears as verdict leftover. <!-- sdd-owner: implementation -->
- [x] T7 Add reasonless machine-keep parser arm in `parseApplyAssignments` (bare `<prefix>:keep` accepted provisionally as `ApplyAssignment { verdict: "keep", reason: "" }`; bare `paused|finished|ephemeral|trash` stays rejected `missing judged rationale` / `trash never appliable`) + post-resolve provenance gate (reasonless keep on MACHINE inherits bulk rationale; on WEAK/unknown/ambiguous/stale → rejected `reasonless keep is machine-only — WEAK needs id:keep:"reason"`, warning, zero writes). Quoted triples + reason-mandatory for WEAK/judged unchanged. Maps: UX-03/UX-04, design §6. Verify: reasonless WEAK `finished` rejected zero-write; reasonless machine resolves to bulk path. <!-- sdd-owner: implementation -->
- [x] T8 Add bulk fan-in in phase 2 (`machineKeeps = resolved.filter(provenance === MACHINE && verdict === KEEP)`; rationale fixed `` `machine keep, bulk-confirmed ${UTC-yyyyMmDd}` `` computed once, stored verbatim per file; exactly ONE `confirm(title Keep <N> machine sessions? (<shorts>), detail rationale + msgs/age fragments, never tail)`; yes → per-file body identical to today: pre-append `readLatestVerdict` recheck (different → skip-warning, identical → counted `already`), try/catch append, post-write re-read, shared counters; no → all `declined` zero-write; mixed sets bulk-first then WEAK per-item loop untouched). Maps: UX-03/UX-07, design §4. Verify: 5 reasonless machine keeps → ONE confirm → 5 files gain `session-scrub/verdict { keep, reason: "machine keep, bulk-confirmed <today-UTC>" }`, `readLatestVerdict` returns `keep` each. <!-- sdd-owner: implementation -->
- [x] T9 Add throwing `appendRenameToOther(sessionPath, slug, livePath?)` beside `appendVerdictToOther` (asserts mirror: `existsSync` gone-file refusal + live refusal via `samePath`/id; slug re-asserts non-empty after trim; body `SessionManager.open(path).appendSessionInfo(slug)`, append-only) + existing-name surfacing (`existingName` from resolve-time `info.name`) + post-write re-read (`getSessionName()` equality, mismatch → warning + error bucket). Maps: UX-05, design §5. Verify: T1 trial note reused; live target throws before write. <!-- sdd-owner: implementation -->
- [x] T10 Add rename resolve + per-item confirm loop + summary/dry-run extension + flag plumbing (fresh-resolve order reused: unknown/ambiguous/stale reject before any confirm; per-item `confirm(title Rename <short> to "<slug>"?, detail existing="<existing ?? (unnamed)>" → proposed="<slug>" · msgs · age)` even when verdicts bulk-confirm; pre-append live/gone re-assert at write site; per-file try/catch + continue; single categorized summary: verdict counters + rename applied/declined/errored; `resolveDryRun` choke unchanged in position, echo gains would-apply renames existing→proposed + bulk-rationale date preview, zero prompts/writes; empty confirmed set → `Cancelled.`; `--verbose` strip + signature threads; still exactly one `registerCommand("scrub-triage")`). Maps: UX-05/UX-07, design §5/§7. Verify: rename round-trips to the resume list; duplicate slugs on two files both read back; stale re-apply → warnings zero-write. <!-- sdd-owner: implementation -->
- [x] T11 Run manual trials TU1…TU8 in order per design §11 (TU1 WEAK-first page; TU2 compact default schema; TU3 verbose; TU4 bulk machine round-trip ONE confirm + verbatim rationale; TU5 WEAK reason-mandatory reject + per-item retained + mixed bulk-first; TU6 rename round-trip incl. duplicates + empty reject + existing-name in confirm; TU7 deferred transparency; TU8 invariants: stale/ambiguous pre-confirm reject, trash rejected, `pi --print --apply` notify-only zero-write, live never written, race skip; gates: `tsc --strict` clean, `grep -n "any"` zero, `grep -n "session_shutdown\|session_start\|unlink\|ctx.ui.custom"` zero new, `git diff --stat` code ≤400). Slice-2 TT1…TT12 still apply as regression. Maps: UX-01…UX-08, design §11. Verify: 8/8 noted PASS/FAIL. <!-- sdd-owner: implementation -->
- [x] T12 Document the new flow in `README.md` (WEAK-first page, compact default + `--verbose`, bulk machine confirm + fixed rationale, `id:name:"slug"` rename + duplicate/empty policy, deferred-ID line) as a SEPARATE meta commit, never mixed with the code commit. Maps: proposal §6, design §1. Verify: `git log --oneline -2` shows code + meta commits distinct. <!-- sdd-owner: implementation -->

## Notes

- No automated harness exists (`openspec/config.yaml`: `runner: none-automated-yet`); strict-TDD is satisfied via T1 trial-file round-trips + manual TU1…TU8, same as Slice-2.
- First-cut rule if implementation drifts past ~320: cut formatter richness first (deferred msgs/age optionals, bulk-detail msgs/age fragments, verbose machine-block extras) — never bounds, deferral identities, dry-run gate, per-file catches, rechecks, or the WEAK per-item loop — then pause and ask per `ask-on-risk` (no auto-chain, `exception-ok` needs explicit `size:exception`).
