# Explore — session-scrub-triage-ux

**Change:** `session-scrub-triage-ux` · **Date:** 2026-09-14 · **Phase:** explore (no code, no specs, no tasks)
**Store:** openspec repo-local · **skill_resolution:** paths-injected (`pi-plugin-dev` SKILL.md read before work)

## Executive summary

The current triage (Slice 2, TR-01..TR-13) is functionally correct but UX-inverted for the real-world shape (27 sessions, 20 packs shown): machine-obvious keeps demand one-by-one confirms, WEAK packs sort last, full packs are a wall of text, bulk verdicts demand mandatory reasons, deferral is a counted line with no identities, and rename forces leaving to `/resume` + `/name`. The agreed redesign keeps the Slice-2 safety invariants (never-trash, live-exclusion, per-item confirm before write, `resolveDryRun` choke, `MAX_AGE_MS`, POLICY grammar, trash layout) and changes only the triage UX layer: single bulk confirm for machine-keeps + WEAK-first ordering + compact table + inline rename + optional machine-keep reason + transparent deferred list. OUT: excluding named sessions from the triage set.

## Current-behavior map (authoritative code points)

- `gatherTriageCandidates` (index.ts, triage section): live drop (samePath/id) → skip verdict-ed → skip `messageCount===0` (counted) → skip ephemeral-match (counted) → sort **named-first, then `modified` ascending**. This sort is the inversion: with 27 sessions the 20 shown packs are machine-keeps first, WEAK packs (the ones needing judgment) fall into the deferred tail.
- Phase 1 `handleScrubTriagePhase1`: slices `candidates[0..20)`, renders one fenced `formatDigestPack` block per session (head ≤300c + tail ≤300c + msgs/age/created/modified + machine-line or weak-guess line), single `notify(info)`, zero writes. Deferral = `+R more deferred` counted line, no identities.
- Phase 2 `handleScrubTriagePhase2`: parse (`parseApplyAssignments`, reason MANDATORY, trash rejected) → fresh resolve (`startsWith` prefix, unknown/ambiguous/stale reject) → **per-item `confirm()` loop** (title `Triage <short> as <verdict>?`, detail provenance+reason+msgs+age, never tail) → pre-append recheck → `appendVerdictToOther` (refuses trash/gone/live) → categorized summary. Every machine-keep therefore costs one confirm + one mandatory reason today.
- Append primitive: `SessionManager.open(path).appendCustomEntry("session-scrub/verdict", {version:1, verdict, at, reason})` — proven append-only on other files. Rename primitive: spike evidence (`scratch/spike-rename.ts`, git-ignored) proves `SessionManager.open(other).appendSessionInfo` round-trips append-only (entries +1, lines +1, name re-readable on fresh open); `/resume` reads the same `session_info` entry, so zero friction by construction.

## Explore answers

### 1. Where the machine-vs-WEAK split belongs

- **Phase-1 format:** partition the already-gathered candidate list in memory into `machineKeeps` (named, `info.name` non-blank) vs `weakQueue` (rest) *after* `gatherTriageCandidates`, before rendering. Render two sections in one notify: (a) compact machine table (one row per session, §3), (b) WEAK packs (reordered WEAK-first, compact-by-default). No second `list()`/`open()` pass; lazy `orderedMessageTexts` stays per-shown-pack.
- **Resolve grouping:** `handleScrubTriagePhase2` already re-resolves against a fresh `gatherTriageCandidates`; the split is a *presentation/confirm* grouping, not a separate triage set. Tag each `ResolvedAssignment` with its existing `provenance` (`machine` vs `weak`) and group confirms: **one bulk `confirm()` for the whole machine-keep set** (title lists count + shortIds, detail carries the shared rationale), then the existing per-item loop for WEAK assignments only. Stale/ambiguous/unknown rejection stays before any confirm (unchanged order guarantee).
- **Phase-2 loop:** minimal delta shape — `if (all resolved are machine-keep) → single bulk confirm → append each with pre-append recheck inside the loop (recheck stays per-file even under one confirm)`; mixed sets → bulk-confirm machine subset first, per-item the rest. The per-file try/catch + pre-append recheck + post-write re-read must not move; only the confirm fan-in changes.

### 2. What `/name` validates today (Pi 0.85.1 dist, observed)

Directly observed in dist (`dist/cli/args.js`, `dist/core/session-manager.js`):

- `normalizeSessionName(value)` = `value.trim()`, returns `undefined` iff empty after trim. Used for `--name`; empty → hard error exit.
- `SessionManager.appendSessionInfo(name)`: `name.replace(/[\r\n]+/g, " ").trim()`, stored as a `session_info` entry; `getSessionName()` returns latest `session_info` entry's `name?.trim() || undefined` (empty explicitly clears).
- **No slug charset, no length cap, no uniqueness check across sessions** anywhere on this path. Duplicate display names are structurally allowed (identity is file path/id, not name).

**Rename collision policy consequence:** proposal must decide (recommend: allow duplicates, last-write-wins per file like verdicts; surface the existing name in the rename confirm detail so overwrites are visible; empty input clears per dist semantics — confirm whether clear is exposed or rejected in triage). Verify at proposal time by: (a) re-checking `normalizeSessionName` + `appendSessionInfo`/`getSessionName` in the Pi version pinned at implementation time (path pattern above, 0.85.1 observed); (b) one trial-file round-trip `open(other).appendSessionInfo("dup-name")` on two files + `/resume` shows both (spike pattern in `scratch/spike-rename.ts` is reusable).

### 3. Compact format: one-liner vs full-pack

Judgment-sufficient one-liner per session (all derivable without new reads):

```
<short> · <msgs>msgs · <age>d · [named "<name>" | unnamed] · <weak-guess> · <head-first-~120c>
```

- `short/msgs/age/named` come from `SessionInfo`; `weak-guess` from existing `suggestTriageWeak`; head-first-~120c is a prefix of the already-built `head` (no new extraction).
- **What stays full-pack-only:** full 300c head, 300c chronological tail, created/modified ISO, weak rationale stub, machine rationale. Rationale: intent disambiguation and closure cues (any-language) live in the tail slice; the table is a triage index, not evidence. Proposal should make full packs on-demand (e.g. shown for WEAK packs only, or behind an explicit flag) — not removed, just not the default wall.

### 4. Deferred transparency: cheapest listing shape

Today: `+R more deferred` with no identities (sessions beyond `MAX_DIGEST_SESSIONS=20` are re-derived on re-run, order-dependent). Cheapest shape that fixes opacity without new reads: append a **deferred-ID line** listing shortIds (+ optional msgs/age) of `candidates.slice(20)` — data already in hand, one line, bounded (~8 chars + separator per session; 7 deferred ≈ 70 chars). No packs, no guesses for deferred rows. Re-run stability follows from the unchanged sort; proposal should note whether WEAK-first reordering changes *which* sessions defer (it should: defer machine-keeps, not WEAK packs — or defer by the new order, explicitly stated).

### 5. Non-goals confirmation

- **Second command name:** OUT — stay one command, two invocations (`--apply` mode), per locked Slice-2 decision.
- **Bulk-confirm picker UI (`ctx.ui.custom()`):** OUT — bulk = single `confirm()` over the machine set, same primitive as today, no new TUI surface (keeps TR-13 intact).
- **Touching empties:** OUT — `emptySkipped` counted line unchanged; empties stay on the `/scrub-apply` auto-deletable path.
- **Cross-project:** OUT — `SessionManager.list(ctx.cwd)` scope unchanged.
- **Excluding named sessions from triage:** explicitly OUT per idea scope (named sessions stay in the triage set; only their confirm path gets fast-laned).

## Risks / proposal-time decisions

1. Bulk-confirm scope creep → cap the single confirm to machine-keeps only; WEAK stays per-item (else WEAK guesses get confirmed blindly, the exact failure Slice-2 JD rounds prevented).
2. Optional reason for machine-keep vs TR-08 mandatory-reason grammar → parser must accept a reasonless machine-keep form (e.g. default rationale stub stored verbatim) while keeping reason-mandatory for WEAK/judged assignments; spec must state the stored default string.
3. WEAK-first reorder changes deferral membership → state the new sort + cap interaction normatively (recommend: WEAK by `modified` desc first, machine-keeps table un-capped or capped separately, deferred line lists deferred shortIds).
4. Inline rename write path is `appendSessionInfo` on *other* files (spike-proven) but Slice-2 only verified `appendCustomEntry` on others → proposal must require a trial-file round-trip for rename (same TT8 pattern) since it appends a different entry type; per-file catch + live-exclusion assert mirror `appendVerdictToOther`.
5. Review budget 400 lines: split (machine-bulk + reorder + table) + rename + deferred-IDs in one slice risks overflow; proposal should size and, per ask-on-risk, pause if implementation drifts past ~320 rather than claim `size:exception`.

## Next recommended

**proposal** — with: machine-bulk confirm shape + stored default rationale; WEAK-first sort + cap/deferral interaction; compact table schema vs full-pack-on-demand rule; inline rename grammar + collision/empty policy (§2); deferred-ID line format; unchanged safety invariants restated; line estimate vs 400.
