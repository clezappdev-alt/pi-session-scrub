# Tasks — session-scrub-handoff-promise

The requirement delta is `spec.md` in this directory (S1–S7). This file is the one task ledger.

- [ ] **T1 — A1 in the type model.** `name.ts` exports `CLOSE_STATES` (host-free) and `index.ts` builds
  `ScrubCloseParams.state` from it, so the schema cannot drift from the constant. Tests: the set is
  exactly "every state whose meaning is a fact about *this* session" (all five minus `traspaso`), every
  element parses back out of a name, and `traspaso` is absent.

- [ ] **T2 — A1 in the description.** `scrub_close`'s description offers four states, names `pausa` as
  the pending-handoff word, and points at `/scrub:handoff` as the only writer of `traspaso`. Gate: a
  doccheck-style source assertion that `ScrubCloseParams` builds its union from `CLOSE_STATES` and does
  not name `STATE.traspaso`.

- [ ] **T3 — A2 in the handler.** `/scrub:handoff` creates, seeds and names the destination first; the
  origin's `traspaso:` is written afterwards by path (`appendNameToOther`), with the new session as the
  live path. Tests: a source-order gate (the write appears after `await ctx.newSession`, and the origin
  is not renamed through `pi.setSessionName`), plus the cancellation and failure paths through their
  notify text.

- [ ] **T4 — docs.** `behavior.md` Layer B for `/scrub:handoff` and `scrub_close`; canonical NB-03 and
  NB-04 amended in place with a MODIFIED marker; `docs/guide.md` state table, `scrub_close` section, §6
  recipe and decision table; `README.md`.

## Notes

- `strict_tdd: true`: T1–T3 each start from a failing test.
- A2 is the same write `appendNameToOther` already performs for `/scrub:triage` and `/scrub:adopt`
  (NB-08 stack). The change is *when* it runs, never *how*.
- `/name` and `/scrub:adopt` still write `traspaso:` on purpose (S5).
- The absence of a `session_shutdown` handler is untouched: REQ-12 stands (S6).

## Delivery record

- (pending) — meta: the change opened (S1–S7).
- (pending) — code + tests + tool description: A1 and A2.
- (pending) — docs: `behavior.md`, canonical spec, `guide.md`, `README.md`.
