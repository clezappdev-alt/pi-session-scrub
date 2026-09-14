# Design — session-scrub-triage-ux

**Change:** `session-scrub-triage-ux` · **Against:** `openspec/changes/session-scrub-triage-ux/spec.md` (UX-01..UX-08) + Slice-2 `extensions/session-scrub/index.ts` triage section (~745–1330)
**Scope lock:** proposal (I1+I2+I3+I4+I5+I7, I6 OUT) + spec UX-01..UX-08. This doc is HOW; the spec is WHAT. No reopened decisions.
**Budget:** 400 lines (preflight `ask-on-risk`).
**skill_resolution:** paths-injected (`pi-plugin-dev` SKILL.md read before work)

## 0. Ground truths from Slice-2 code (reuse, don't duplicate)

Actual shapes in `extensions/session-scrub/index.ts` (authoritative over proposal shorthand):

- `DigestPack { shortId, messageCount, ageDays, created, modified, sessionName?, flowName?, head, tail, headTruncated, tailTruncated }` — built by `buildDigestPack(meta, ordered: OrderedMessage[])` from `orderedMessageTexts(entries)`; `head` = first user text, `tail` = last-3-assistant + last-2-user merged chronologically, `truncateWithEllipsis` (head, `…` suffix) / `truncateTailFromFront` (tail, `…` prefix), bounds `HEAD_DIGEST_CHARS = TAIL_DIGEST_CHARS = 300`, cap `MAX_DIGEST_SESSIONS = 20`.
- `orderedMessageTexts(entries: SessionEntry[]): OrderedMessage[]` — chronological user+assistant texts; phase 1 calls it lazily per *shown* pack only.
- `parseApplyAssignments(args: string): { ok: ApplyAssignment[]; rejected: RejectedAssignment[] }` — regex `ASSIGN_RE = /(\S+?):(keep|paused|finished|ephemeral|trash):"((?:[^"\\]|\\.)*)"/g` over whitespace-joined cleaned args (`--apply`/`--dry-run` tokens stripped); `unescapeReason` (`\\(.) → $1`); trash rejected at parse; empty/whitespace-only reason rejected; duplicate prefix rejected; leftovers re-classified via bare `/^(\S+?):(keep|…|trash)$/` (missing-reason reject) and `LOOSE_ASSIGN_RE` (unknown-verdict vs malformed).
- `appendVerdictToOther(sessionPath, verdict, reason, livePath?)` — throwing writer: refuses trash, refuses gone file (`existsSync`), refuses live (`samePath`); body `SessionManager.open(path).appendCustomEntry("session-scrub/verdict", { version: 1, verdict, at, reason })`.
- `gatherTriageCandidates(ctx)` — live drop (samePath/id) → skip verdict-ed (`readLatestVerdict(entries)`) → skip `messageCount === 0` (counted `emptySkipped`) → skip ephemeral-match (`matchedEphemeralFlow`, counted `ephemeralSkipped`); sort today = **named-first, then `modified` ascending**. Returns `{ candidates: TriageCandidate[] ({ info, entries }), emptySkipped, ephemeralSkipped }`.
- `formatDigestPack(pack, machine: MachineFact | undefined, weak: WeakGuess)` — one fenced `triage <short>` block with msgs/age/ISO/named line + head/tail lines + machine-line or weak-line; `escapeQuote` on render.
- `handleScrubTriagePhase1(ctx)` — slice `candidates[0..20)`, one `notify(info)`, `+R more deferred` counted line, zero writes, zero confirms; takes **no args** today.
- `handleScrubTriagePhase2(assignments, parseRejected, ctx)` — parse-rejects warned → fresh `gatherTriageCandidates` resolve (`startsWith` prefix; unknown/ambiguous warned, stale implicit via 0-match) → per-item `confirm()` loop (`Triage <short> as <verdict>?`, detail `provenance + reason + msgs + age`, never tail) → per-file pre-append recheck (`readLatestVerdict(openSessionEntries)`: different → skip-warning, identical → counted `already`) → try/catch append → post-write re-read → categorized summary.
- `handleScrubTriage(args, ctx)` — `args.includes("--apply")` dispatch; `--dry-run` handled only in phase 2 via `resolveDryRun(args, ctx)`; factory registers exactly one `scrub-triage` command.
- Reused verbatim, never redefined: `TRIAGE_VERDICT`/`TRIAGE_GRADE` const-objects, `MachineFact`/`WeakGuess`/`ApplyAssignment`/`ResolvedAssignment { assignment, targetPath, shortId, provenance }`/`RejectedAssignment`/`TriageCandidate`, `MAX_AGE_MS`, `VERDICT_CUSTOM_TYPE`, `resolveDryRun`/`isInteractive`, `samePath`/`live` identity, `readLatestVerdict(entries)`.

## 1. Placement (one file, additive)

All new code lives in `extensions/session-scrub/index.ts`, in existing section order — no new files, no new deps, no `ctx.ui.custom()`, no new lifecycle handlers:

| Section | Add |
|---|---|
| Constants | `BULK_KEEP_REASON(date: Date): string` helper or inline template (see §3); `RENAME_RE = /(\S+?):name:"((?:[^"\\]\|\\.)*)"/g` beside `ASSIGN_RE`; `--verbose` is a parsed token, not a constant |
| Flat interfaces | `MachineKeepBulk { shortIds: string[]; rationale: string }`, `RenameAssignment { idPrefix, slug }`, `ResolvedRename { assignment, targetPath, shortId, existingName?: string }`, `RejectedRename { raw, cause }` per spec type model (flat, no inline nesting, no `any`) |
| Pure functions | `partitionTriageCandidates`, `formatCompactRow`, `parseRenameAssignments`, `parseReasonlessMachineKeeps` (or one extended `parseApplyAssignments` — see §6) |
| FS helpers | `appendRenameToOther(sessionPath, slug, livePath?)` beside `appendVerdictToOther` |
| Handlers | Extend `handleScrubTriagePhase1(ctx, verbose: boolean)`, `handleScrubTriagePhase2` (bulk fan-in + rename loop), `handleScrubTriage` (flag threading) |
| Factory | No new line: same single `pi.registerCommand("scrub-triage", …)`; description unchanged |

`README.md` update is a separate meta commit (never mixed with the code commit per repo hard rule).

## 2. Partition + WEAK-first sort + cap/deferral (UX-01, normative new order)

New pure `partitionTriageCandidates(candidates: TriageCandidate[]): { weakQueue: TriageCandidate[]; machineKeeps: TriageCandidate[] }`:

- Predicate: machine-keep ⟺ `info.name !== undefined && info.name.trim().length > 0` (same named test as today's sort and phase-2 provenance — reused verbatim, not redefined). Everything else → `weakQueue`. In-memory only, over the already-gathered list; no second `list()`/`open()`.
- Normative page-1 order (replaces the named-first/oldest-first sort for *display*; `gatherTriageCandidates` internal sort stays untouched — ordering happens at composition):
  1. `weakQueue` sorted by `info.modified` **descending** (newest first, per explore recommendation).
  2. Then `machineKeeps` in `gatherTriageCandidates` order (stable; do not re-sort — keeps re-run stability and minimal delta).
  3. `page = ordered.slice(0, MAX_DIGEST_SESSIONS)`; `deferred = ordered.slice(20)`.
- Deferral interaction (by design, spec UX-01/UX-06): deferred membership is `ordered.slice(20)`, so with WEAK-first, **machine-keeps defer, not WEAK packs**. Re-run stability follows from the deterministic within-partition orders (no timestamps in the sort key beyond `modified`).
- Phase-2 consequence: the same partition concept applies at resolve time via the existing `provenance` tag on `ResolvedAssignment` (`named ? MACHINE : WEAK`) — no separate resolve list; grouping is confirm-layer only (§3).

## 3. Compact table vs full-pack rule + `--verbose` flag (UX-02)

New pure `formatCompactRow(args: { shortId; messageCount; ageDays; sessionName?; weakGuess: string; head: string }): string`:

- Schema (normative): `<short> · <msgs>msgs · <age>d · [named "<name>" | unnamed] · <weak-guess> · <head-first-~120c>`.
- `head-first-~120c`: `stripForQuote`-already-applied `pack.head` sliced to 120 chars + `…` when longer (prefix of the already-built head — **no new extraction**, no `orderedMessageTexts` call). `"` escaped via existing `escapeQuote`. Name rendered via `named "<escapeQuote(name)>"`, else literal `unnamed`.
- Phase-1 render rule (normative):
  - **Default (no flag):** one notify carrying (a) compact-table section — one `formatCompactRow` line per shown **machine** session; (b) full `formatDigestPack` blocks for shown **WEAK** sessions only. Zero machine full packs by default.
  - **`--verbose`:** (a) + full packs for **every** shown session (machine packs appended after the table; WEAK packs unchanged). Compact table is always present — verbose adds, never replaces.
  - Full-pack-only content stays full-pack-only: full 300c head, 300c chronological tail, ISO created/modified, rationale stubs never appear in compact rows.
- Flag parsing: `handleScrubTriage(args, ctx)` computes `verbose = args.split(/\s+/).includes("--verbose")` and threads it into `handleScrubTriagePhase1(ctx, verbose)` and the phase-2 dry-run echo. `parseApplyAssignments` cleaning filter gains `"--verbose"` alongside `"--apply"`/`"--dry-run"` so the flag token never becomes a `malformed pair` leftover. No `--force`, no other flags (spec fixed decision 1).

## 4. Machine bulk-confirm fan-in + fixed dated rationale (UX-03) with per-file rechecks (UX-07)

Resolve grouping (no new triage set): phase 2 resolves exactly as today (fresh `gatherTriageCandidates`, `startsWith` prefix, unknown/ambiguous/stale reject **before any confirm**), then splits `resolved` by existing `provenance`:

- `machineKeeps = resolved.filter(r => r.provenance === MACHINE && r.assignment.verdict === KEEP)` — bulk-eligible.
- Everything else (all WEAK rows, any judged non-keep on named sessions) → existing per-item loop unchanged.

Bulk path (only when `machineKeeps.length > 0`):

1. Rationale: fixed string `` `machine keep, bulk-confirmed ${yyyyMmDd(new Date())}` `` where `yyyyMmDd` = UTC `toISOString().slice(0, 10)`. Computed **once** at `--apply` run time, stored **verbatim** as `reason` in each `session-scrub/verdict { version: 1, verdict: "keep", at, reason }` entry. Exact spec string `machine keep, bulk-confirmed <YYYY-MM-DD>`.
2. Exactly ONE `ctx.ui.confirm(title, detail)`: title `Keep <N> machine sessions? (<short1>, <short2>, …)`; detail carries the shared rationale + per-file `msgs/age` fragments (provenance + reason + counts, never tail — same no-tail rule as per-item).
3. On yes: loop over the bulk subset with the **identical per-file body** as today — pre-append recheck (`readLatestVerdict(openSessionEntries(path))`: different verdict → skip-warning, identical → counted `already`, no duplicate), try/catch `appendVerdictToOther(path, "keep", bulkRationale, livePath)`, post-write re-read, categorized counters shared with the WEAK loop. On no: all bulk shortIds → `declined`, zero writes for the subset.
4. Mixed sets: bulk-confirm machine subset **first**, then the existing per-item loop for the WEAK rest (order normative — machine block first in summary too).
5. `MachineKeepBulk { shortIds, rationale }` is the confirm-time view object; it is not persisted (each file gets its own verdict entry with the verbatim rationale).

Per-file rechecks preserved under bulk (normative): the confirm fan-in changes from N→1, but the write path stays per-file — recheck, append, re-read, catch+continue never move inside or outside the bulk loop. Race scenario (verdict landed between bulk-yes and a file's append) resolves per file exactly as UX-07: skip-warning, file unchanged.

## 5. Rename writer (UX-05) — spike-proven path + confirm shape

Grammar + parse: new pure `parseRenameAssignments(cleaned: string): { ok: RenameAssignment[]; rejected: RejectedRename[] }` with `RENAME_RE = /(\S+?):name:"((?:[^"\\]|\\.)*)"/g` applied globally over the same whitespace-joined cleaned string (rename lines are **own lines / own tokens**, parsed **alongside, not inside** verdict triples — one shared cursor/leftover pass so a rename token is never also a verdict leftover). Slug norm: `unescapeReason(raw).replace(/[\r\n]+/g, " ").trim()` (mirrors `appendSessionInfo`); empty-after-trim → `rejected { cause: "empty rename slug" }`, never writes (clear-by-empty NOT exposed in triage). Duplicate `idPrefix` across rename ok-list (and verdict/rename collision on the same prefix — verdict + rename for one session) → second occurrence rejected as `duplicate assignment`; first proceeds. No charset/length/uniqueness checks — duplicates allowed, last-write-wins per file, identity stays path (mirrors `/name`).

Writer `appendRenameToOther(sessionPath: string, slug: string, livePath: string | undefined): Promise<void>` (throwing; caller catches per file):

- Asserts mirror `appendVerdictToOther`: `existsSync` gone-file refusal; `livePath !== undefined && samePath(...)` live refusal (plus session-id equality where available — same `LiveIdentity` the caller already holds). Slug re-asserts non-empty after trim (defence in depth).
- Body: `SessionManager.open(sessionPath).appendSessionInfo(slug)` — spike-proven (`scratch/spike-rename.ts`, PASS: entries +1, lines +1, fresh-open `getSessionName()` re-reads the slug). Append-only; never touches message content.
- Proof obligation at implementation time: one trial-file round-trip `open(other).appendSessionInfo("dup-name")` on two files + fresh-open `getSessionName()` reads back both + `/resume` shows both; plus re-check of `normalizeSessionName`/`appendSessionInfo`/`getSessionName` in the pinned Pi version (dist paths `cli/args.js`, `core/session-manager.js` per explore §2). Any signature drift → pause per §9.

Resolve + confirm: rename resolution reuses the fresh-resolve order (unknown/ambiguous/stale reject before any confirm, UX-07). `ResolvedRename { assignment, targetPath, shortId, existingName? }` where `existingName` is read from the resolve-time candidate (`info.name`, trimmed, `undefined` when blank). Confirm is **per-item `confirm()` per rename even when verdicts bulk-confirm** (normative): title `Rename <shortId> to "<slug>"?`, detail `existing="<existingName ?? "(unnamed)">" → proposed="<slug>" · msgs=N · age=Xd` — existing name always surfaced so overwrites are visible. Pre-append recheck for renames = live/gone re-assert at the write site (verdict recheck does not apply — rename appends `session_info`, not a verdict entry); per-file try/catch + continue; post-write re-read via fresh `SessionManager.open(path)` `getSessionName()` equality check, mismatch → warning + error bucket.

## 6. Parser extension — reasonless machine-keep arm + rejection rules (UX-03/UX-04)

Extended `parseApplyAssignments` (single function, no second parser for verdicts):

- Cleaning: strip `--apply`, `--dry-run`, `--verbose` tokens (verbose addition, §3).
- Pass 1 (existing `ASSIGN_RE` loop): quoted `id:verdict:"reason"` triples unchanged — trash rejected, unknown verdict rejected, empty/whitespace-only reason rejected with `missing judged rationale`, duplicates rejected.
- Pass 2 (new arm, before leftover classification): bare `/^(\S+?):(keep|paused|finished|ephemeral|trash)$/` tokens — today all rejected as missing-reason. New rule: token `<prefix>:keep` with **no quoted reason** is accepted as `ApplyAssignment { idPrefix: prefix, verdict: "keep", reason: "" }` **provisionally** (empty reason = "bulk default applies"); `<prefix>:(paused|finished|ephemeral|trash)` bare stays rejected (`missing judged rationale` / `trash never appliable`). Provisional reasonless keeps resolve normally; after resolution, a reasonless keep whose target provenance is **MACHINE** inherits the bulk rationale (§4); a reasonless keep resolving to a **WEAK** target (or unknown/ambiguous/stale) is rejected with `notify(warning)` cause (`reasonless keep is machine-only — WEAK needs id:keep:"reason"`) and never warn-through to a write. This keeps the reasonless form machine-only even though the parser cannot know provenance before resolve.
- Leftover classification otherwise unchanged (`LOOSE_ASSIGN_RE` unknown-verdict vs malformed).
- Rename tokens are consumed by `parseRenameAssignments` from the same cleaned string with a shared cursor discipline (implementation: run both regexes via `matchAll` with index ordering, or strip rename matches before the verdict passes — either way, a `id:name:"slug"` token must never surface as a verdict `malformed pair` leftover, and a verdict triple must never surface as a rename reject).

## 7. Phase-1/Phase-2 handler deltas (exact touch points)

`handleScrubTriagePhase1(ctx, verbose)`:

- `gatherTriageCandidates` unchanged → `partitionTriageCandidates` + normative order (§2) → `page = ordered.slice(0, 20)`.
- For page machine rows: build `DigestPack` (lazy `orderedMessageTexts` still only for shown sessions — compact rows need `pack.head`, so machine rows now also pay the lazy extraction; WEAK rows unchanged) → `formatCompactRow` lines. For page WEAK rows default: `formatDigestPack` blocks; verbose: + machine blocks.
- Notify lines: summary line (keep Slice-2 wording, counts unchanged) + `— machine keeps (N) —` compact section + WEAK pack blocks (+ verbose machine blocks) + deferred-ID line (§8) + judgment instruction line (extended: mention `id:keep` reasonless machine form, `id:name:"slug"` rename lines, `--verbose`). Empty set → `Nothing to triage.` unchanged.

`handleScrubTriagePhase2(assignments, parseRejected, renameOk, renameRejected, ctx)` (signature gains rename lists; dry-run echo in `handleScrubTriage` gains rename + bulk-rationale preview lines):

- Warn parse rejects (verdict + rename) → fresh resolve verdicts + renames (same candidate set, same prefix rules) → `resolveDryRun` choke (unchanged position: after resolve, before first confirm; dry-run lists would-apply verdicts with provenance, would-apply renames with existing→proposed, and the computed bulk rationale date; zero prompts, zero writes) → bulk machine-keep confirm (§4) → WEAK per-item loop (untouched body) → rename per-item loop (§5) → single categorized summary (verdict counters + rename applied/declined/errored counts, same `Re-run /scrub…` close). Empty confirmed set (no verdict yes + no rename yes) → `Cancelled.` zero writes.

## 8. Deferred-ID line (UX-06)

Replace `+R more deferred — triage these first, then re-run.` with `deferred (<R>): <short1>, <short2>, …` listing `ordered.slice(20)` shortIds **in the §2 page order**, plus optional `(<msgs>msgs, <age>d)` per row only if line length stays bounded (shortIds mandatory, msgs/age opportunistic — spec: shortIds + optional msgs/age). No packs, no guesses for deferred rows (structural: deferred rows never reach `buildDigestPack`/`suggestTriageWeak`). Never silently dropped: every candidate is either paged or listed.

## 9. Risks (design-level residuals)

| Risk | Design answer |
|---|---|
| Bulk confirm leaks to WEAK | §4 filter is `provenance === MACHINE && verdict === KEEP`; WEAK loop untouched; dry-run echo labels provenance per line |
| Reasonless form leaks to WEAK | §6 provisional-accept + post-resolve provenance gate; WEAK reasonless → warning, zero writes |
| Deferral confusion | §8 identities in page order; §2 states machine-keeps defer by design |
| `appendSessionInfo`-on-other drift | §5 proof obligation (trial-file round-trip + dist re-check at implementation time); pause on drift, do not auto-chain |
| Rename overwrite invisibility | §5 confirm detail always carries existing → proposed |
| Budget overrun | §10 estimate + first-cut rule; pause past ~320 per ask-on-risk, never claim `size:exception` unasked |

Untouched invariants restated (UX-07, no code): fresh resolve before any confirm; trash never suggested/parsed/appended (rejected at parse + re-asserted at append); dry-run choke + non-TUI notify-only (zero prompts, zero writes); live-exclusion at write site; append-only + post-write re-read; per-file catch + continue; empty confirmed set → `Cancelled.`

## 10. Line-budget estimate vs 400 + first-cut rule

| Item | Est. |
|---|---|
| `MachineKeepBulk`/`RenameAssignment`/`ResolvedRename`/`RejectedRename` flat interfaces | ~20 |
| `partitionTriageCandidates` + WEAK-first order + deferred slice | ~15 |
| `formatCompactRow` + phase-1 render branches + `--verbose` threading + deferred-ID line | ~45 |
| Bulk fan-in (rationale date + one confirm + grouped loop) | ~30 |
| `RENAME_RE` + `parseRenameAssignments` + shared-cursor merge | ~35 |
| Reasonless machine-keep arm + post-resolve provenance gate | ~20 |
| `appendRenameToOther` + existing-name surfacing + re-read check | ~25 |
| Rename resolve + per-item confirm loop + summary extension + dry-run echo | ~40 |
| Registration/flag plumbing (`--verbose` strip, signature threads) | ~10 |
| **Total** | **~240** |

Inside 400 with headroom. **First-cut rule if implementation drifts past ~320:** cut formatter richness first (drop msgs/age optionals on deferred line, drop per-file msgs/age fragments in bulk detail), then verbose machine-block extras — never bounds, deferral identities, dry-run gate, per-file catches, rechecks, or the WEAK per-item loop. Per `ask-on-risk`: pause and ask before any chain or `size:exception` claim.

## 11. Trial plan (TT-style, mirrors Slice-2 §8 — no harness)

1. **TU-BULK machine round-trip (TUI):** seed ≥3 named verdict-less sessions + 1 WEAK; phase 1 shows WEAK pack(s) first + machine table; `--apply <m1>:keep <m2>:keep <m3>:keep` (reasonless) → exactly ONE bulk confirm → yes → each file gains one `session-scrub/verdict { keep, reason: "machine keep, bulk-confirmed <today-UTC>" }`, `readLatestVerdict` returns `keep` per file; touched files append-only.
2. **TU-WEAK per-item retained:** `--apply <weak>:finished` (no reason) → rejected with warning, zero writes; `--apply <weak>:finished:"<rationale>"` → own per-item confirm (detail provenance + reason, no tail) → yes writes; mixed `--apply` (machine + WEAK) → bulk first, WEAK per-item after.
3. **TU-RENAME round-trip on trial file:** `--apply <id>:name:"trial-slug-<date>"` → per-item confirm showing existing + proposed → yes → fresh `SessionManager.open(other).getSessionName()` reads the slug; `/resume` shows it; duplicate slug on two files → both read back, path identity intact; `:name:"   "` → rejected, zero writes.
4. **TU-VERBOSE output:** default run = machine compact rows + WEAK packs, zero machine full packs; `--verbose` = + full packs for every shown session; compact schema matches `<short> · <msgs>msgs · <age>d · named/unnamed · guess · head-120c`.
5. **TU-IDEMPOTENT re-run:** re-run phase 1 → triaged sessions gone, `Nothing to triage.` when empty; re-`--apply` same ids → all stale warnings, zero writes.
6. **TU-NONTUI notify-only:** `pi --print /scrub-triage` (notify, exit 0) and `pi --print "/scrub-triage --apply <valid>"` (resolved-list notify incl. bulk rationale preview, zero prompts, zero writes, no hang).
7. **Gates:** `tsc --strict` clean; `grep -n "any"` → zero (outside comments); `grep -n "session_shutdown\|session_start\|unlink\|ctx.ui.custom"` → zero new hits; `git diff --stat` → code commit ≤ 400 (README separate).

## 12. Next recommended action

**tasks** (expect: tasks): decompose §§2–8 into ordered work units (partition/order → compact+verbose → parser arms → bulk fan-in → rename writer/loop → deferred line → trials+gates), each mapped to UX-01..UX-08 + §11 trials, sized against the §10 budget with the first-cut rule attached.
