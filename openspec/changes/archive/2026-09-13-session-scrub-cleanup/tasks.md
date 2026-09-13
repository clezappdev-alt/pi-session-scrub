# Tasks — session-scrub-cleanup (slice 1 only)

**Change:** `session-scrub-cleanup` · **Scope guard:** slice 1 per proposal §2 + spec REQ-01…REQ-12 + design §1…§7. No scope expansion: no `listAll()`, no `ctx.ui.custom()` picker, no compaction hooks, no LLM naming, no sidecars, no `/scrub-empty`, no OS trash, no close-time prompt.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~370 (range 340–390); code commit only, meta/docs separate |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR (code commit ≤ 400 lines; README/package.json in separate meta commit) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |
| Standing rule | If implementation exceeds budget during apply, `/scrub-restore` slices to slice 2 first (manual `mv` covers recovery) |

```text
Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low
```

**Per-task line estimates** (sum ≈ 370; shared `auditSessions()` dedup per design §7):

| Task | Est. lines |
|------|-----------|
| 01 VERIFY dist checks | 0 (read-only, no code) |
| 02 Pure classifier + ephemeral match + slug | ~70 |
| 03 Policy parser + formatters + dry-run choke | ~50 |
| 04 FS helpers + verdict/policy readers | ~60 |
| 05 `/scrub` handler | ~30 |
| 06 `/scrub-apply` handler | ~45 |
| 07 `/scrub-restore` handler | ~40 |
| 08 `/scrub-init` handler | ~30 |
| 09 `scrub_mark` tool + `agent_start` hint | ~45 |
| 10 Factory registration + shutdown-absence + strict check | ~20 (net, incl. stub deletion) |
| 11 Manual trial T1…T12 | 0 (verification only) |
| 12 README + package.json meta | ~40 (separate commit, not counted toward 400) |

---

## Tasks

- [x] **01 — VERIFY dist signatures before coding (VERIFY-1…VERIFY-4, design §3).** Open `dist/core/extensions/types.d.ts` (`registerCommand`, `registerTool`, `on("agent_start")`, `ExtensionUIContext.select`/`confirm` shapes) and `dist/core/session-manager.d.ts` (`appendCustomEntry`, `getSessionFile`, `getSessionDir`, `static list`, `static open`, `CustomEntry` field names) in the installed pi 0.85.1 package; record actual signatures and confirm: single-object `registerTool`, single-select only (per-item `confirm()` loop is primary), trash-dir sibling-derivation from `getSessionDir()`, custom-entry write/read field names. Adapt call shapes only — no behavior change. <!-- sdd-owner: implementation -->
- [x] **02 — Pure classifier + ephemeral match + slug (REQ-01, REQ-02; spec type model + `classifySession`/`matchesEphemeralFlow`/`deriveSlug`; design §1 pure block).** In `extensions/session-scrub/index.ts`: add `MAX_AGE_MS` constant (F1), `VERDICT`/`CLASSIFICATION_KIND`/`CANDIDATE_REASON` const-objects, flat interfaces (`SessionInfo` mirror, 6 `Classification` variants + union, `SessionDetail`), and implement `classifySession` (D2 tree verbatim: live → named-trash-only → trash/finished/ephemeral candidates → empty auto-deletable → old-needs-confirm → kept), `matchesEphemeralFlow` (exact `/skill:<flow>` token match against `ephemeralFlows`, no substring/fuzzy), `deriveSlug` (lowercase, NFKD strip, `[^a-z0-9]+`→`-`, trim, slice 60). Verify by eye against spec REQ-01/REQ-02 scenarios. <!-- sdd-owner: implementation -->
- [x] **03 — Policy parser + formatters + dry-run choke (REQ-03, REQ-11; `parsePolicyBlock`, `formatAuditLine`/`formatDetailRow`, `resolveDryRun`; design §1, §5).** In `extensions/session-scrub/index.ts`: implement `parsePolicyBlock` (F4 grammar: skip `#`/blank, read `verdicts:`/`mark-on:`/`ephemeral-flows:` keys, `<...>` placeholders → empty, absent/unparseable → `undefined`/conservative default), one-line-per-session formatters, and `resolveDryRun(args, ctx)` (`includes("--dry-run") || !ctx.hasUI`). No `ctx` or fs writes in these functions. Verify: placeholder-only block → `ephemeralFlows: []`; `hasUI === false` → dry-run true. <!-- sdd-owner: implementation -->
- [x] **04 — FS helpers + verdict/policy readers (REQ-10, REQ-04-read, REQ-03-read; `getTrashDir`/`getSessionsDir`/`moveToTrash`/`moveFromTrash`/`readPolicyConfig`/`readLatestVerdict`; design §2, §3 VERIFY-3/4, §4).** In `extensions/session-scrub/index.ts`: derive `getTrashDir` as sibling of `ctx.sessionManager.getSessionDir()` (`join(dirname, "session-scrub-trash", basename)`, never an invented cwd transform; sessions dir = `getSessionDir()` directly); `moveToTrash`/`moveFromTrash` as throwing atomic `renameSync` with auto-`mkdirSync(recursive)`, no copy+unlink fallback, no `unlink`/`rm`/`trash` strings; `readLatestVerdict` via `SessionManager.open(path)` + `getEntries()` filtered on `customType === "session-scrub/verdict"`, latest `at` wins, never throws on malformed entries (live session uses `ctx.sessionManager.getEntries()`); `readPolicyConfig` returns `ephemeralFlows` or `[]` on absent/unparseable. Verify: grep shows no `unlink`/`rm`/`trash CLI` strings. <!-- sdd-owner: implementation -->
- [x] **05 — `/scrub` read-only audit (REQ-05; design §2 `/scrub`).** In `extensions/session-scrub/index.ts`: implement `handleScrub` (+ shared `auditSessions(ctx)` helper returning classified list + `AuditSummary`): `list(ctx.cwd)` → per-session `readLatestVerdict` → `classifySession` → single `notify(info)` summary (`total · named · auto-deletable · candidates by reason · old-needs-confirm · kept · live`) + per-session detail rows; zero writes, zero prompts; live shown as `live`, never actionable. Covers T2-audit and T3-checksum-invariant (spec T2, T3). <!-- sdd-owner: implementation -->
- [x] **06 — `/scrub-apply` dispose with consent (REQ-06, REQ-10, REQ-11; design §2 `/scrub-apply`, §4, §5).** In `extensions/session-scrub/index.ts`: implement `handleScrubApply` reusing `auditSessions(ctx)`: `resolveDryRun` at entry (flag or `!hasUI` → notify full actionable detail list, exit, zero mutations); TUI path = per-item `ctx.ui.confirm()` loop over actionable set (`auto-deletable` + `candidate` + `old-needs-confirm` with full `SessionDetail`), empty selection → `notify("Cancelled.")`; confirmed → per-file `moveToTrash` in try/catch (per-file error notify, continue, source intact); post-run re-list + `notify("Trashed X … Remaining: Y …")`. Covers spec T3, T4, T6, T7-apply. <!-- sdd-owner: implementation -->
- [x] **07 — `/scrub-restore` round-trip (REQ-07, REQ-10, REQ-11; design §2 `/scrub-restore`, §4).** In `extensions/session-scrub/index.ts`: implement `handleScrubRestore`: `readdir(getTrashDir)` with ENOENT → `[]`; empty → `notify("No trashed sessions for this project.")`; non-TUI → notify list only; TUI → per-item `confirm()` loop → per-file `moveFromTrash` (mkdir sessions dir, never overwrite existing target, per-file catch + continue) → `notify("Restored X sessions.")`. First cut to slice 2 if over budget (manual `mv` covers recovery). Covers spec T5, T7-restore. <!-- sdd-owner: implementation -->
- [x] **08 — `/scrub-init` idempotent POLICY write (REQ-08, F4; design §2 `/scrub-init`).** In `extensions/session-scrub/index.ts`: implement `handleScrubInit`: read `join(ctx.cwd, "AGENTS.md")` (ENOENT → `""`); if includes `<!-- pi-session-scrub:start -->` → notify "already exists", exit unchanged; else append proposal §4.4 generic commented template verbatim (taxonomy + when-to-mark `#` guidance, `verdicts:`/`mark-on:`/`ephemeral-flows:` keys, `<flow-name-1>, <flow-name-2>` placeholders) in a single write + success notify. Covers spec T10. <!-- sdd-owner: implementation -->
- [x] **09 — `scrub_mark` tool + once-per-session naming hint (REQ-04, REQ-09; `handleScrubMark`, `offerNameHint`/`handleAgentStart`; design §1, §2 hint flow).** In `extensions/session-scrub/index.ts`: implement `handleScrubMark` (validate verdict against `VERDICT` const-object → tool error + no write on invalid; else `appendCustomEntry("session-scrub/verdict", { version: 1, verdict, at: ISO, reason? })`) and `handleAgentStart` (whole body try/catch: `hasName` via `getSessionName()` / `hasPriorHint` via `session-scrub/name-hint` entry → silent return; else first-user-text → `deriveSlug` → `setStatus("scrub-name", "sugerido: /name <slug>")` → append gate entry `{ version: 1, slug, offeredAt }`; never call `setSessionName()`). Covers spec T8, T11. <!-- sdd-owner: implementation -->
- [x] **10 — Factory registration + shutdown-absence + strict gate (REQ-12; design §1 registration order, §4 grep gates).** In `extensions/session-scrub/index.ts`: rewrite default-export factory to register `scrub`, `scrub-apply`, `scrub-restore`, `scrub-init`, `scrub_mark` tool, and `agent_start` only — deleting the v2 stub's `session_start` no-op and `session_shutdown` handler entirely; add comment noting the deliberate absence (T9). Run `tsc --strict` (zero errors), grep `any` (zero hits), grep `session_shutdown` (zero hits), grep `unlink|rm |trash` (zero hits). Keep code commit ≤ 400 lines. Covers spec T1-clean-boot (with `/reload`), T9, T12-code. <!-- sdd-owner: implementation -->
- [x] **11 — Manual trial T1…T12 + `/resume` cross-check (all REQs; design §6).** With `pi -e ./extensions/session-scrub/index.ts`: run T1 clean boot + `/reload`; T2 audit truth (seed named/unnamed/empty/old, reconcile with `/resume`); T3 dry-run checksums; T4 apply 1–2 candidates → trash dir + re-list; T5 restore one → sessions dir + `/scrub`; T6 EXDEV mock → per-file error, source intact; T7 `pi --print`/`--json` notify-only no-hang; T8 hint-once + slug rules; T9 silent close; T10 init idempotent; T11 verdict round-trip incl. invalid rejection; T12 strict + budget. Record pass/fail per T. <!-- sdd-owner: implementation -->
- [x] **12 — Meta/docs commit, SEPARATE from code (REQ-05…REQ-08 user-facing docs; work-unit rule; design §1 header).** In `README.md` (rewrite commands: `/scrub`, `/scrub-apply [--dry-run]`, `/scrub-restore`, `/scrub-init`; plugin-owned trash dir layout + manual `mv` recovery; POLICY block usage; non-TUI dry-run note) and `package.json` (verify `pi-package` keyword + `peerDependencies: *` for core libs incl. `@earendil-works/pi-tui` if imported; no version bump unless releasing). Commit alone — never mixed with the code commit. Verify with `git diff --stat` showing docs/meta only. <!-- sdd-owner: implementation -->
