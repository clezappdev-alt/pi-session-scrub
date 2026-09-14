# Proposal — session-scrub-triage (slice 2)

> **Revision note — rev 2, 2026-09-13.** User-mandated design correction (hybrid judgment), accepted. What changed and why: (1) the deterministic suggestion table is split — machine-grade signals (exact `/skill:<flow>` match, `messageCount===0`, name presence) stay deterministic as specified, because they are exact facts; human-grade (finished vs paused vs keep for old-with-content) moves to model judgment, because a fixed metadata table is deterministic in process but arbitrary in accuracy across personal styles/languages; (2) the old fixed rows (old-with-content→finished, rest→paused) are demoted to WEAK pre-suggestions, clearly labeled, never verdicts; (3) a bounded digest pack per session (first-user-message head ~300 chars + closing tail ~300 chars + counts + age; max ~20 sessions/run, remainder deferred with explicit notice) is added as the model's judgment input, reusing `userTexts`/`auditSessions`/`readLatestVerdict`; (4) the open plumbing problem is decided as flow (a) — digest-notify → chat judgment → `--apply` confirmed write (one command, two invocations; §4) — because the model cannot judge mid-handler; (5) budget re-estimated for digest builder + assignment parser + writer. Everything else (locked decisions, triage set, write primitive shape, reversibility, dry-run/`hasUI` choke, never-`trash`, non-goals) is unchanged.

> **Judgment Day round 2 (2026-09-13, JD-B-004 only).** Mandatory reason in `--apply` grammar (reject-without-reason replaces warn-through); residual (agent-invented rationales) recorded as known model-conduct limitation, not design.

**Judgment Day round 1 (2026-09-13, 10 rows, 0 CRITICAL).** Fixes applied: (F1) `--apply` assignments carry the judged rationale (`id:verdict:"reason"`, stored verbatim; missing reason warns in confirm); (F2) tail reader covers user+assistant slices (new `assistantTexts` pure, budgeted); (F3) normative pack-quoting rules (fences, control-strip, truncation marks; confirm never re-quotes full tail); (F4) ephemeral-match sessions excluded from triage (already candidates via `/scrub-apply`, counted line); (F5) confirm MUST show provenance + reason; (F6) per-item freshness recheck before each append; (F7) budget re-estimated ~150–190 lines.

**Change ID:** `session-scrub-triage`
**Status:** proposed
**Date:** 2026-09-13 (rev 2)
**Parent change:** `session-scrub-cleanup` slice 1 (archived; canonical `openspec/specs/session-scrub/spec.md`)
**Author:** SDD proposer (gentle-ai orchestrator)
**Input artifacts:** rev-1 draft (revised in place), canonical `openspec/specs/session-scrub/spec.md` (REQ-01…REQ-12), archived `design.md`, `extensions/session-scrub/index.ts` (`userTexts`, `auditSessions`, `readLatestVerdict` reused), `PRD.md`, `AGENTS.md`, `openspec/config.yaml`, plus the user correction brief (authoritative).

**Locked decisions (not reopened):**

1. New command `/scrub-triage` (name agreed; UX shape is this proposal's work).
2. Read path exists (`SessionManager.open(path)` + `getEntries()`); missing piece is **writing verdicts onto other sessions** — `open(path).appendCustomEntry("session-scrub/verdict", …)` on non-live files (append-only, never touches content).
3. Confirmation is per-item (or bulk for the obvious) BEFORE any write; same reversibility contract as slice 1 (plugin trash dir, restore, no unlink).
4. No scope beyond onboarding triage: no auto-marking of old sessions without user confirmation, ever.

---

## 1. Intent

Give pre-existing (pre-POLICY) session lists an **assisted first pass with hybrid judgment**: one opt-in command surfaces every session that carries no verdict as a **bounded digest pack** (intent head + closure tail + counts + age) plus the deterministic machine-grade facts where they exist; the **model judges the human-grade calls** (finished vs paused vs keep) in the following conversational turn from those packs; and — only after the user approves in chat **and** confirms per item in a write step — the confirmed verdicts are recorded as namespaced custom entries on those *other* session files. After that pass, old sessions play by the normal slice-1 rules (`classifySession`, `/scrub`, `/scrub-apply`).

This closes the cold-start gap **without** pretending a fixed table can read intent across personal styles and languages: exact signals stay exact, everything else is judged from words, not metadata.

## 2. Validation of the draft-input against slice-1 artifacts

Same validation as rev 1 (all five rows hold — read path, live-only write, append-only shape, reversibility, slice-1 invariants), plus one new row:

| Draft claim | Slice-1 check | Verdict |
|---|---|---|
| "Deterministic suggestion table suffices for triage" | Rejected by user correction (accepted): fixed rows are process-deterministic but accuracy-arbitrary across styles/languages | ❌ superseded — hybrid judgment (machine-grade stays, human-grade judges from digests); fixed finished/paused rows demoted to WEAK pre-suggestions |

No locked decision conflicts with any fixed decision (F1–F4), requirement (REQ-01…REQ-12), or verified deviation. This revision only re-decides the suggestion source and the UX flow.

## 3. Scope (first slice — one work-unit commit ≤ 400 lines)

### In scope

| Item | Decision | Mechanics |
|---|---|---|
| **Command** | `/scrub-triage [--dry-run]` (digest phase) + `/scrub-triage --apply <id:verdict>…` (write phase) — one command, two invocations (§4) | Phase 1: list → verdicts → classify (shared `auditSessions`) → triage set = non-live, non-empty, non-ephemeral-match, `verdict === undefined` → digest packs + machine-grade facts + WEAK guesses → read-only notify, zero confirms, zero writes. Ephemeral-match sessions are already candidates via `/scrub-apply`; triage skips them with a counted line. Chat: model judges, user approves. Phase 2: `--apply` resolves assignments against a fresh audit → per-item `confirm()` loop → `appendCustomEntry` on confirmed other-files → summary notify |
| **Triage set** | Verdict-less, non-live, non-empty, non-ephemeral-match (`named-protected` without verdict, `kept(has-content-no-verdict)`, `old-needs-confirm` without verdict) | Empty sessions skipped with counted line (already auto-deletable); ephemeral-match sessions skipped with counted line (already candidates via `/scrub-apply`) |
| **Digest pack (new)** | Per-session bounded pack built in code from `userTexts` + `assistantTexts` entries: head = first user message (intent), tail = closing user/assistant slice (closure signals, any language), plus counts + age (§4 schema). Bounds (defaults, tunable in spec): HEAD_CHARS ~300, TAIL_CHARS ~300, MAX_DIGEST_SESSIONS ~20/run; remainder deferred with explicit notice | Token-bounded by construction: worst case ≈ 20 × (600 + ~150 overhead) chars ≈ 15k chars ≈ 3.5–4k tokens; typical runs far smaller. Full logs stay one `open()` away if the user asks the agent to elaborate |
| **Suggestion source (revised)** | Split: **MACHINE-GRADE** deterministic in code (named verdict-less → `keep`; empty/ephemeral-match → skip with counted lines) + **HUMAN-GRADE** model judgment over packs (finished vs paused vs keep for the rest) + **WEAK pre-suggestions** (old-with-content ⇢ `finished?`, otherwise ⇢ `paused?`, always labeled `WEAK`, never verdicts) | The agent role is satisfied in chat, not in code: phase-1 notify carries packs + facts + weak guesses; the model narrates judged proposals with rationales quoting head/tail signals; no fuzzy heuristics in code, no auto-write — code *proposes facts*, the model *judges*, the user *disposes* |
| **Confirmation** | Unchanged rule, two gates: (1) user approves judged proposals in chat (natural language, selects/edits); (2) phase-2 per-item `confirm()` loop disposes each write (same primary path as `/scrub-apply`, spec deviation 3). "Bulk for the obvious" without a separate path: machine-grade items sort first for rapid yes-answers | Chat "yes" is NOT write consent — only `confirm()` yes writes. Empty confirmed set → `notify("Cancelled.", "info")`, zero writes |
| **Write per confirmation** | Unchanged primitive: `SessionManager.open(sessionPath).appendCustomEntry("session-scrub/verdict", { version: 1, verdict: <confirmed>, at: <now ISO>, reason: <judged rationale> })` on the OTHER file; per-file try/catch, `notify(warning)` + continue | `--apply` assignments validate `verdict ∈ {keep,paused,finished,ephemeral}` (never `trash`); resolve against fresh triage set; reject unknown/ambiguous/stale (verdict since appeared, session gone) with warning + skip. Live file never opened for write (excluded by construction + `samePath`/id assert) |
| **Dry-run** | Phase 1 IS dry-run (read-only always; `--dry-run` accepted as no-op alias, identical output). Phase 2 honors `resolveDryRun`: `--dry-run` flag OR non-interactive → notify resolved assignments, zero mutations | Same `resolveDryRun`/`isInteractive` choke as slice 1 (§6) |
| **Non-TUI** | Phase 1 notifies digests in ALL modes (safe everywhere — never prompts). Phase 2 (`--apply`) in non-TUI → implicit dry-run notify, zero prompts, zero writes | Never blocks on undeliverable `confirm` |
| **Verification** | Post-write re-read (`readLatestVerdict` returns confirmed verdict); counts reconcile in `/scrub`; idempotent: re-running phase 1 finds no verdict-less sessions → "Nothing to triage." | Stale-assignment rejection is itself verified (assign to an already-triaged session → skipped with notice) |

### Explicit non-goals (deferred, with WHY)

Same as rev 1 (dedicated bulk-confirm path, custom `ctx.ui.custom()` picker, auto-suggesting `trash`, touching empties, cross-project triage, close-time prompt, `/scrub-empty`), plus:

| Non-goal | Why deferred |
|---|---|
| Second command name (`/scrub-triage-apply`) | One command with `--apply` keeps the surface minimal; the two phases are modes, not products |
| Model judgment inside the handler (single-run show+confirm) | Impossible: the handler runs to completion before the next conversational turn, so the model would have nothing to judge from yet — single-run confirm would consecrate WEAK guesses blindly |
| Full-log judging (whole session content to the model) | Unbounded tokens; packs are the bounded contract. Full logs remain available on explicit user request |

## 4. Command shape & behaviors — `/scrub-triage` (DECIDED flow)

```
Usage: /scrub-triage [--dry-run]                              # phase 1: digests, read-only
       /scrub-triage --apply <short-id:verdict:"reason"> [...] [--dry-run]  # phase 2: confirmed writes (reason MANDATORY, stored verbatim; missing/empty reason → assignment rejected, never warned-through)
```

**Flow (decided: option (a) — digest-notify → chat judgment → confirmed write):**

1. **Phase 1 — digest (read-only, all modes):** `auditSessions(ctx)` (same preamble: live identity, POLICY `ephemeralFlows`) → triage-set filter (`verdict === undefined`, NOT `live`, NOT `auto-deletable`, NOT ephemeral-match) → sort named-keep first, then human-grade by age desc → build ≤ MAX_DIGEST_SESSIONS packs → `notify(info)` summary + packs + machine facts + WEAK guesses → return. **Never calls `confirm`/`select`/`input`; never writes.** `--dry-run` is an accepted alias producing byte-identical output.
2. **Chat — judgment (no code):** the phase-1 notify surfaces into the conversation (same mechanism as slice-1's agent-summary-plus-proposal). The model judges each human-grade session from its pack (intent head + closure tail in whatever language + counts + age), states machine-grade facts as facts, marks WEAK guesses as superseded where the words say otherwise, and proposes one verdict per session with a one-line rationale quoting the signal. The user approves/edits in chat ("mark A finished, B paused, skip C").
3. **Phase 2 — confirmed write (TUI only for writes):** user or agent invokes `/scrub-triage --apply a1b2c3d4:finished:"work done, merged" e5f6a7b8:paused …`. Handler re-audits (freshness), resolves each assignment against the current triage set (prefix match, must be unambiguous; verdict must be appliable; target must still be verdict-less), rejects the rest with `notify(warning)` + skip, then runs the per-item `confirm()` loop showing id + judged verdict + MACHINE/WEAK provenance + reason (stored verbatim on yes; missing/empty reason → assignment rejected up front, so the dialog always shows a rationale); yes → append; no → skip. Immediately before EACH append, re-reads the target verdict — changed since resolution → skip with warning (no blind overwrite). `--dry-run` or non-interactive → resolved-assignment notify, zero writes.
4. **Post-run verification:** re-read each written file; `notify(info, "Triaged X of N sessions. Re-run /scrub to see new classifications.")`.

**Digest pack schema (per session, one block):**

```
triage <short-id> · msgs=N · age=Xd · created=ISO · modified=ISO [· named "<name>"] [· flow "<flow>" → EPHEMERAL (machine)]
  head(≤300c): "<first user message, truncated>"
  tail(≤300c): "<closing user/assistant slice, truncated, `…` marks cuts>"
  weak-guess: <finished|paused> (WEAK — judge from head/tail, never auto-confirm) · <one-line weak rationale>
```

- Machine-grade lines are stated as facts (`EPHEMERAL (machine)`, `NAMED → keep (machine)`); human-grade lines carry only `weak-guess … (WEAK …)` plus the pack itself — the model is the judge.
- Remainder notice when triage set exceeds the cap: `+R more deferred — triage these first, then re-run.` (explicit, counted, never silent).
- **Quoting rules (normative):** each pack is one fenced block headed by its session id; head/tail are quoted-as-data (strip ANSI/control chars, truncate with `…`); the judgment instruction treats pack text as evidence, never instructions; `confirm()` shows id + judged verdict + provenance + reason only — never re-quotes full tail.

**Machine-grade table (deterministic, unchanged semantics):**

| Condition (in order) | Verdict-grade proposal | Rationale stub (`reason`) |
|---|---|---|
| ~~`matchesEphemeralFlow(userTexts, ephemeralFlows)` → `ephemeral`~~ | EXCLUDED from triage (JD round 1): ephemeral-match sessions are already `candidate` via `/scrub-apply`; proposing an `ephemeral` verdict for them is double-queueing | counted skip line instead |
| Named (`named-protected`, no verdict) | `keep` | `named session — presumed active` |
| Empty (`messageCount === 0`) | skip | counted line only, never proposed |

**WEAK pre-suggestions (demoted, never verdicts):**

| Condition | WEAK guess | Rationale stub |
|---|---|---|
| `old-needs-confirm` (age ≥ `MAX_AGE_MS`, has content) | `weak-guess: finished` | `WEAK: old (≥7d) with content — words decide; confirm from tail` |
| Otherwise (recent, content, no signal) | `weak-guess: paused` | `WEAK: recent with content, no signal — words decide; park only if tail agrees` |

**Why (a) over (b):** a single-invocation show-packs-then-confirm loop gives the model no turn in which to judge — the handler must finish before the model speaks, so its confirms would dispose WEAK guesses blindly, defeating the correction. Two invocations of one command cost no new surface, keep phase 1 usable in every mode (including non-TUI previews), and preserve the F2 consent choke exactly where slice 1 proved it.

**First-slice boundary:** digest builder (~25 lines over `userTexts`), assignment parser (~15 pure), `appendVerdictToOther` (~15), two-mode `handleScrubTriage` (~50 reusing `auditSessions`/`resolveDryRun`/`isInteractive`), formatters (~20). Estimated delta **~150–190 lines** (JD round 1: +assistant reader, reason plumbing, quoting) — inside the 400-line budget (§11).

## 5. Write-path design (same primitive + assignment gate)

```ts
// Appends a versioned verdict entry to a NON-LIVE session file. Append-only.
// Throws on failure (caller catches per file); never touches live.
declare function appendVerdictToOther(
  sessionPath: string,
  verdict: Verdict,   // keep | paused | finished | ephemeral (never trash from triage)
  reason: string,     // the judged one-line rationale from chat
): Promise<void>;

// Pure: parses "--apply" assignments (short-id-or-prefix:verdict[:"reason"]).
// Rejects unknown verdicts (incl. trash), malformed pairs; resolution
// against the fresh triage set happens in the handler (freshness).
// The reason travels in the assignment (mandatory) and is stored verbatim.
// Missing/empty reason → reject the assignment (JD round 2: forces a visible
// rationale per write; fabrication stays possible but exposed, never silent).
declare function parseApplyAssignments(
  args: string,
): { idPrefix: string; verdict: Verdict; reason: string }[];
```

Implementation notes (for spec/design, not decisions): same `appendCustomEntry` shape as `handleScrubMark` redirected at the other file; `VERDICT_CUSTOM_TYPE` + F3 payload reused; non-live assert (`samePath`/id); latest-`at`-wins means triage verdicts are naturally superseded by later marks and vice versa; apply phase re-verifies `open(path)` performs no writes on load (T-style file-set check for triage writes too).

## 6. Non-TUI degradation (same choke as slice 1)

`isInteractive(ctx) = ctx.mode === "tui" && ctx.hasUI` (spec deviation 1). Phase 1 never needs the choke (notify-only in every mode). Phase 2 (`--apply`) calls `resolveDryRun(args, ctx)` at entry, before any `confirm`: non-interactive → full resolved-assignment notify, zero prompts, zero writes. Only flags: `--dry-run`, `--apply` (F2: no `--force`).

## 7. Affected areas

| File | Change type |
|---|---|
| `extensions/session-scrub/index.ts` | **Extend** — add `buildDigestPack` (pure over `userTexts`), `suggestTriageWeak` (pure WEAK guesses), `parseApplyAssignments` (pure), `appendVerdictToOther`, `handleScrubTriage` (two-mode), one `registerCommand("scrub-triage", …)` line; reuse `auditSessions`, `matchesEphemeralFlow`, `userTexts`, `readLatestVerdict`, `resolveDryRun`, `isInteractive`; no trash helpers touched |
| `README.md` | Document the hybrid flow (digests → chat judgment → `--apply`), machine vs WEAK table, bounds + deferral, idempotency (separate meta commit) |
| `package.json` | No change expected |
| `openspec/changes/session-scrub-triage/spec.md` | To be written in Spec phase |
| `openspec/changes/session-scrub-triage/design.md` | To be written in Design phase |

**No changes to:** container repo, other plugins, global skills, slice-1 commands/tool, POLICY grammar (F4), trash layout (REQ-10).

## 8. Risks & mitigations (rev 2 deltas)

| Risk | Concrete failure scenario | Likelihood / Impact | Mechanical mitigation |
|---|---|---|---|
| Cross-session content in packs | Head/tail quotes leak one session's words into chat context | Certain / Low | Packs are ≤300+300c slices by construction (bounded); never full logs; phase 1 is an explicit opt-in triage command |
| Prompt-injection via pack text | Closure tail contains imperative language; model follows it instead of judging it | Medium / Medium | Spec: packs are quoted-as-data; judgment prompt treats head/tail as evidence, never instructions; confirm dialogs quote verbatim |
| Stale/wrong `--apply` assignments | Verdict appeared since digest; prefix ambiguous; session trashed meanwhile | Medium / Low | Fresh re-audit at `--apply`; reject unknown/ambiguous/stale with warning + skip; per-item `confirm()` shows current state |
| WEAK guesses confirmed blindly | User yes-throughs without reading chat judgment | Medium / Medium | Guesses labeled WEAK in every surface; model judgment + chat approval precede the loop; `finished` still needs a second confirm at `/scrub-apply` before any move; latest-`at` overwrite |
| `open(other).appendCustomEntry` misbehaves | Target log corrupted | Low / High | Apply-phase dist re-verify + file-set check on one trial file; append-only API; per-file catch |
| Triage-set size (packs + confirms) | 30+ verdict-less sessions → fatigue | Low / Medium | Cap 20/run with explicit deferral notice; obvious-first sort; dry-run preview |
| Non-TUI hang on `--apply` | `confirm` reached in `print`/`json`/`rpc` | Low / High | `resolveDryRun` at `--apply` entry; T-procedure in non-TUI mandatory |
| Live file written by mistake | Identity confusion | Low / High | Triage set excludes live; `appendVerdictToOther` asserts non-live |
| Budget overrun | Digest + parser sprawl | Low / Low | Delta ~150–190 lines, additive on reused helpers; cut formatters' richness first, never guards or error handling |

## 9. Rollback plan

Unchanged from rev 1: bad verdicts re-marked (later `at` wins; nothing moved/deleted); plugin disabled/uninstalled safely (verdict entries inert); single work-unit commit revert removes `scrub-triage`; slice-1 untouched by construction.

## 10. Success criteria (slice definition of done)

1. Clean boot; `/reload` works.
2. Phase 1 on verdict-less sessions lists exactly the triage set as bounded packs (head ≤300c, tail ≤300c, ≤20 blocks, remainder counted) with machine facts + labeled WEAK guesses; file-set identical, no trash dir.
3. Chat judgment demo: model proposes verdicts quoting pack signals (any-language closure cue handled from words, not metadata).
4. Phase-2 TUI: `--apply` with chat-approved assignments → per-item `confirm()` → yes-items carry new `session-scrub/verdict` `{ version: 1, … }`; no-items unchanged; touched files append-only.
5. Post-triage `/scrub` reflects new verdicts; re-run phase 1 → "Nothing to triage." Stale assignment → skipped with notice.
6. Empties skipped with counted line; `trash` never suggested and rejected in `--apply`; live never appears, never written.
7. Non-TUI: phase 1 notifies; `--apply` notify-only, prompt exit, zero writes.
8. `tsc --strict` passes; zero `any`; const-object verdicts; flat interfaces; zero `session_shutdown`/`session_start`/`unlink` hits.
9. Code commit ≤ 400 changed lines (estimate ~150–190); README separate.

## 11. Budget check (mandatory, rev 2 re-estimate)

- New: `buildDigestPack` (~25) + `assistantTexts` (~10) + `suggestTriageWeak` (~10) + `parseApplyAssignments` (~20, reason plumbing) + `appendVerdictToOther` (~15) + `handleScrubTriage` two-mode (~60, reuses `auditSessions`) + pack/proposal formatters (~20) + registration/types (~10) ≈ **~150–190 lines**, no new deps, no new entry types, no TUI toolkit.
- Inside the 400-line work-unit budget; no cut list needed. First cut if flagged: WEAK-guess richness/formatter detail — never the bounds, the deferral notice, the dry-run guard, or per-file error handling.

## 12. Delivery strategy

**ask-on-risk** (per SDD preflight). Single work-unit commit expected; if implementation surfaces dist-signature drift on the other-file append path, pause and ask — do not auto-chain. `exception-ok` requires explicit `size:exception` acceptance.

## 13. Skill resolution

**skill_resolution: paths-injected** — all five parent-injected skills read before work (paths in session preflight). No fallback. Slice-1 spec/design/`index.ts` treated as authoritative constraints (pi-sessions hard rules: `SessionManager` over hand-parsing, never touch live, entry semantics intact).

## 14. Next recommended action

Proceed to **Spec phase** with: pack schema + bound constants (HEAD/TAIL/MAX, tunable) as normative behavior, machine-grade vs WEAK-guess rows, `--apply` assignment grammar + resolution/rejection rules, phase-1/phase-2 notify/confirm text shapes, dry-run invariance, idempotency, live-exclusion, never-trash, skip-empty, deferral-notice — each GIVEN/WHEN/THEN per REQ style.
