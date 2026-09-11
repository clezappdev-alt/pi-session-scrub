# Pre-Proposal — session-scrub-cleanup

Revision: 1
Date: 2026-09-11

## Exploration Reference

openspec/changes/session-scrub-cleanup/explore.md

## Research Request (preserved)

Change: session-scrub-cleanup
Questions:
1. What is the exact `SessionInfo` field shape returned by `SessionManager.list(cwd)` — specifically the presence and type of `name`, `file`, `id`, and any other fields? What is the comparison key for `getSessionFile()`?
2. What are the exact semantics of `setSessionName()`, `confirm()`, `select()`, and `setStatus()` — including return types, side effects (events fired), and behavior in non-TUI modes?
3. What is the `trash` CLI availability and reversibility semantics across platforms (Linux, macOS, Windows)? What are the exact confirmation/selection behaviors in non-TUI modes (`rpc`, `json`, `print`)?

Source Classes Selected:
- documentation: official Pi docs via fetch_content + installed pi dist types
- open-web: trash CLI + non-TUI confirm/select via web_search + source_check + fetch_content + get_search_content

## Admission Outcome

Blocked — No evidence grants available for any selected source class.

| Source Class | Admission |
|--------------|-----------|
| documentation | denied (missing fetch_content) |
| open-web | denied (missing web_search, source_check, fetch_content, get_search_content) |

## Evidence References

None — admission denied for all selected source classes.

## Product Decisions

All pending — no research evidence to inform decisions.

| Decision | Status |
|----------|--------|
| Exact SessionInfo field shape and comparison key | pending |
| setSessionName/confirm/select/setStatus semantics | pending |
| trash CLI availability/reversibility | pending |
| Non-TUI confirm/select behavior | pending |

## Proposal Readiness

`proposal_ready: false` — Research blocked on all selected lanes. Cannot proceed to proposal without evidence.