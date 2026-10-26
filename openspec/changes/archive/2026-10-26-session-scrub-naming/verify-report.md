# Verify report — session-scrub-naming (reconciliation)

Date: 2026-10-26 · Change: `session-scrub-naming` · Executor: reconciliation by the plugin session
Store: openspec · Root: `/home/cleceta/AI_projects_V3/PI_Agent-MyPlugins/session-scrub`

## Status

**status: pass** (reconciliation verification) · **blockers: 0** · **critical: 0**

This is **not** the verification the change never ran at execution time; it is the verification performed when reconciling an already-delivered change against its own requirement set and against the code that shipped. Both facts are stated because the difference matters: NM-01…NM-05 were verified here for the first time as *requirements*, while the five surfaces listed in §"Delivered but unspecified" never had a requirement to be verified against.

## Method

Read the change's `spec.md` (NM-01…NM-05), `proposal.md` §4–§5, `design.md` §"The organizing rule"/§Slices, then the shipped modules named by each requirement. Every verdict below is anchored to a symbol, never to a line number, because the file has grown by ~22 % since the change was written.

## NM-01…NM-05

| REQ | Verdict | Evidence |
|---|---|---|
| NM-01 naming boundary / own home only | **IMPLEMENTED AS WRITTEN** | `adopt.ts:appendNameToOther` refuses the live path and a missing file; `sessionfs.ts` resolves the runtime's own session directory only; no cross-home listing exists. |
| NM-02 append-only + backup + validate | **IMPLEMENTED, one deviation** | `adopt.ts:readSnapshot` parses before write (header check mirrors Pi's acceptance rule), `verifyAdoption` asserts still-parses + exactly one entry gained + name match; `sessionfs.ts:backupSessionFile` writes into `getBackupDir()`. Deviation: the backup directory is the plugin's own `session-scrub-backups/`, not `getTrashDir()` as NM-02's wording says — the design (§I-5) says "the plugin's existing trash directory", and the implementation separated backups from trash deliberately, because restoring a backup into the trash directory would be a confusing second recovery path. Recorded as an accepted deviation, not silent. |
| NM-03 liveness guard, no bypass | **IMPLEMENTED AS WRITTEN** | `classify.ts`/`index.ts:fileMtimeMs` + `adopt.ts:freshnessOf` treat an unstat-able file as settled; `adopt.ts:findBypassAttempt` refuses `--force`, `-f`, `--yes`, `-y`, `--skip-guard`, `--no-confirm` and their `=`-suffixed forms by name; `freshnessWarning` carries elapsed time, the interleaving risk and the backup path. |
| NM-04 verdict precedence | **IMPLEMENTED AS WRITTEN** | `classify.ts:classifySession`: `trash`/`finished`/`ephemeral` first, then `if (verdict !== undefined) return kept` **before** the empty and age checks. |
| NM-05 conversation-turn floor | **IMPLEMENTED AS WRITTEN** | `classify.ts:countConversationTurns` counts `role: user|assistant`; `MIN_CONVERSATION_TURNS = 5`; a non-finite count falls toward protection (`kept`), and `SessionInfo.messageCount` is never used as a turn proxy. |

## Delivered but unspecified (specified AS-BUILT in Slice 4)

`/scrub:adopt` (NB-05), `/scrub:handoff` (NB-04), `scrub_close` (NB-03), display ids (NB-06), triage-set exclusion (NB-09), the by-path write stack (NB-08), the name/verdict precedence (NB-01, NB-02), and the classification predicate as shipped (NB-07). Each was read from source and written down with the strings the operator actually sees.

## Gates

| Gate | Result |
|---|---|
| `node --test "extensions/session-scrub/*.test.ts"` | **191 / 191 pass, 0 fail** (Node v24) |
| `./scripts/typecheck.sh` (strict tsc against host types) | **exit 0** |
| Test distribution by module | `adopt` 50 · `handoff` 40 · `classify` 29 · `name` 25 · `render` 21 · `ids` 15 · `sessionfs` 11 |
| Canonical spec coverage before | `adopt` 0 · `handoff` 0 · `scrub_close` 0 mentions |
| Canonical spec coverage after | NB-01…NB-09 present; 849 lines (was 652) |

## Findings

- **F1 — the failure that motivated this reconciliation (closed here).** The canonical spec described the plugin as of 2026-09-14 while `master` shipped three capabilities that appear nowhere in it. A spec that is silent about shipped behaviour is not conservative; it is wrong in the direction that matters, because design decisions were then taken against it. Closed by Slice 4.
- **F2 — no `tasks.md` existed at execution time (closed here).** Delivery was tracked in local ODD records. Reconstructed in `tasks.md`, explicitly labelled, with each task carrying the commits that delivered it.
- **F3 — NM-02's backup location wording (accepted deviation).** See the table; recorded in Slice 4 as an accepted deviation rather than reworded retroactively.
- **F4 — `docs/behavior.md` is still a `v0.3.0` snapshot** (456 `index.ts:<line>` citations, source 1682 lines vs 2046 today). Out of scope for this change's reconciliation; it is the next block, with its own design already decided.

## Not verified here

Live-host behaviour of the naming block was measured earlier in the `_scrub-fixture` bench (`odd/tasks/live-measurement-fixture.md`, `odd/tasks/write-path-fixture.md`), not re-measured for this report. No source change was made by this reconciliation, so nothing new required a live run; the manual scenarios NS1–NS8 in Slice 4 exist so a future measurement has a checklist instead of an ad-hoc idea.
