# Proposal — session-scrub-triage-ux

**Change ID:** `session-scrub-triage-ux`
**Status:** proposed
**Date:** 2026-09-14
**Parent / predecessor:** `openspec/changes/archive/2026-09-14-session-scrub-triage/` (Slice-2 TR-01..TR-13 + 8 deviations, read-only input — not reopened)
**Store:** openspec repo-local
**Input artifacts:** `explore.md` (this change dir), spike evidence (git-ignored `scratch/spike-rename.ts`, PASS), `PRD.md` (problem only), `extensions/session-scrub/index.ts` (Slice-2 implementation)
**skill_resolution:** paths-injected (`pi-plugin-dev` SKILL.md read before work)

> All product decisions below are CONFIRMED pre-proposal handoff. This proposal encodes them; it does not re-ask.

## 1. Intent

The Slice-2 triage (`/scrub-triage`) is functionally correct but UX-inverted for the real-world shape observed in a user-validated run (27 sessions, 20 packs shown). This change fixes only the triage UX layer — presentation + confirm fan-in + rename writer — over untouched Slice-2 safety invariants. No new command, no new TUI surface, no new triage set.

## 2. Problem (user-validated)

1. **Ceremony on the obvious:** judging machine-obvious keeps one by one (one confirm + one mandatory reason each).
2. **Inverted priority:** WEAK packs (needing judgment) sort last (positions 19–20), machine-keeps fill the page, rest deferred.
3. **Wall of text:** full packs (300c head + 300c tail × 20) as the default rendering.
4. **Mandatory reasons for bulk:** per-item rationale demanded even where the rationale is "machine-obvious keep".
5. **Opaque deferral:** `+7 more deferred` with no identities.
6. **Rename forces exit:** renaming requires leaving to `/resume` + `/name`.

## 3. Scope

### In scope (I1+I2+I3+I4+I5+I7)

| ID | Item | Decided shape |
|---|---|---|
| I1 | Fast-lane machine bulk confirm | Phase 1 partitions the already-gathered candidate list in memory into `machineKeeps` (named, `info.name` non-blank) vs `weakQueue`; Phase 2 runs ONE bulk `confirm()` for the whole machine-keep subset, then the existing per-item loop for WEAK only. Pre-append recheck stays per-file even under one confirm. |
| I2 | WEAK-first ordering | Page 1 = WEAK-first (by `modified` desc, per explore recommendation) + machine fill to cap 20. Deferred membership therefore changes by design: machine-keeps defer, not WEAK packs. |
| I3 | Compact table format | Compact one-liner per session is the default (schema §4); full packs for WEAK only by default; everything-full only behind the detail flag (§4, decided rule 2). |
| I4 | Inline rename in triage flow | Rename grammar = own line `id:name:"slug"`, parallel to verdict triples (decided rule 3). Writer = `SessionManager.open(other).appendSessionInfo` (spike-proven append-only round-trip; `/resume` reads the same `session_info` entry). Per-file catch + live-exclusion assert mirror `appendVerdictToOther`. |
| I5 | Optional reason for machine-keep | Bulk rationale = fixed default string with date, e.g. `machine keep, bulk-confirmed <date>`, stored verbatim per file (decided rule 1). Parser accepts reasonless machine-keep form; reason stays mandatory for WEAK/judged assignments. |
| I7 | Transparent deferred list | Deferred = shortId list line for `candidates.slice(20)` (shortIds + optional msgs/age, no packs, no guesses — data already in hand). |

### Explicitly OUT (I6 + non-goals)

| Out | Why |
|---|---|
| I6: excluding named sessions from the triage set | Explicitly out per handoff — named sessions stay in the triage set; only their confirm path is fast-laned. |
| Second command name | Stay one command, two invocations (`--apply` mode), per locked Slice-2 decision. |
| Picker UI (`ctx.ui.custom()`) | Bulk = single `confirm()` over the machine set, same primitive as today; TR-13 intact. |
| Touching empties | `emptySkipped` counted line unchanged; empties stay on the `/scrub-apply` path. |
| Cross-project triage | `SessionManager.list(ctx.cwd)` scope unchanged. |
| Auto-trash | `trash` never appliable, never suggested; rejected in `--apply`. |

## 4. Decided product rules (normative for spec)

1. **Bulk rationale:** fixed default string with date (e.g. `"machine keep, bulk-confirmed <date>"`) stored verbatim as `reason` per file. Spec must state the exact string.
2. **Detail flag:** `--verbose` controls full packs. Compact table always; WEAK full packs shown by default; everything-full only on flag. (Compact schema from explore §3: `<short> · <msgs>msgs · <age>d · [named "<name>" | unnamed] · <weak-guess> · <head-first-~120c>`; full 300c head / 300c tail / ISO dates / rationale stubs stay full-pack-only.)
3. **Rename grammar:** own line `id:name:"slug"`, parallel to verdict triples (`id:verdict:"reason"`). Collision/empty policy per evidence: `/name` validates trim + non-empty only (`normalizeSessionName`, `appendSessionInfo` replace-newlines + trim, `getSessionName` latest-wins); no charset / length / uniqueness checks exist — duplicate slugs structurally allowed like `/name` today; last-write-wins per file. Spec must state whether empty (clear per dist semantics) is exposed or rejected in triage, and require surfacing the existing name in the rename confirm detail so overwrites are visible.
4. **Page-1 composition:** WEAK-first + machine fill to cap 20 (`MAX_DIGEST_SESSIONS=20` unchanged). Spec must state the new sort + cap/deferral interaction normatively.

## 5. First-slice boundary

Presentation + confirm layer + rename writer over **untouched Slice-2 safety invariants**: fresh resolve at `--apply` (prefix, unknown/ambiguous/stale reject before any confirm), per-item confirm retained for WEAK, pre-append recheck before each append, trash never appliable, dry-run choke (`resolveDryRun` at `--apply` entry + non-TUI notify-only), live-exclusion (`samePath`/id assert), append-only writes, per-file try/catch + post-write re-read.

## 6. Affected areas

| File | Change type |
|---|---|
| `extensions/session-scrub/index.ts` | Extend — in-memory machine/WEAK partition + WEAK-first sort + compact table formatter + `--verbose` flag + bulk-confirm fan-in (machine subset) + reasonless machine-keep parser arm with default rationale + `id:name:"slug"` rename parser + `appendSessionInfo`-on-other writer + deferred shortId line. No triage-set, trash, POLICY, or scope changes. |
| `README.md` | Document new flow (separate meta commit per repo rules) |
| `openspec/changes/session-scrub-triage-ux/spec.md` | Next phase |
| `openspec/changes/session-scrub-triage-ux/design.md` | Next phase |

**No changes to:** container repo, other plugins, global skills, Slice-2 verdict entry shape, POLICY grammar, trash layout, `package.json` (no new deps expected).

## 7. Risks

| Risk | Failure | Mitigation (spec must state) |
|---|---|---|
| WEAK confirmed blindly | Bulk confirm extended to WEAK guesses | Cap single confirm to machine-keeps only; WEAK stays per-item. |
| Mandatory-reason regression | Reasonless form leaks to WEAK | Parser accepts reasonless form for machine-keep only; WEAK/judged stays reject-without-reason. |
| Deferral confusion | Users assume deferred = done | Deferred line lists shortIds; spec states new sort + cap interaction (machine-keeps defer). |
| Rename entry-type risk | Slice-2 verified only `appendCustomEntry` on others; rename appends `session_info` | Trial-file round-trip for rename required (TT8 pattern, spike reusable) + Pi-version re-check of `normalizeSessionName`/`appendSessionInfo`/`getSessionName` at implementation time. |
| Overwrite invisibility | Rename silently replaces an existing name | Rename confirm detail surfaces the existing name. |
| Budget overrun (400) | Presentation + rename + bulk in one slice overflows | Size in spec; per ask-on-risk pause if implementation drifts past ~320 rather than claim `size:exception`. |

## 8. Rollback plan

Bad verdicts re-marked (later `at` wins; nothing moved/deleted); bad renames re-renamed (latest `session_info` wins; empty explicitly clears per dist semantics); plugin disabled/uninstalled safely (verdict + name entries inert); single work-unit commit revert removes the UX layer; Slice-2 behavior restored by construction.

## 9. Success criteria

1. 27-session shape: WEAK packs on page 1, machine-keeps as one-line-per-session table + ONE bulk confirm, deferred shortIds visible.
2. Machine-keep bulk write stores the fixed default rationale verbatim per file; WEAK reasonless assignment still rejected.
3. Compact default; `--verbose` restores full packs.
4. `id:name:"slug"` renames round-trip to `/resume`; confirm shows existing name; duplicate slugs behave like `/name` (allowed, path-identity).
5. All Slice-2 invariants hold: fresh resolve, WEAK per-item confirm, pre-append recheck, trash rejected, dry-run/non-TUI notify-only, live never written, append-only + re-read.
6. `tsc --strict` passes; code commit ≤ 400 changed lines (README separate).

## 10. Budget / delivery

**ask-on-risk** (per preflight). Single work-unit commit expected; if implementation surfaces dist-signature drift on the other-file append path or drifts past ~320 lines, pause and ask — do not auto-chain, do not claim `size:exception` without explicit acceptance. Chain strategy deferred.

## 11. Next recommended

**spec + design** (expect: spec+design): compact table schema vs full-pack-on-demand rule, WEAK-first sort + cap/deferral, bulk-confirm shape + stored default rationale string, `--verbose` semantics, `id:name:"slug"` grammar + collision/empty policy, deferred-ID line format, unchanged safety invariants restated — each GIVEN/WHEN/THEN per Slice-2 REQ style.
