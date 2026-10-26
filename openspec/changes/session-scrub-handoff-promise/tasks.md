# Tasks — session-scrub-handoff-promise

The requirement delta is `spec.md` in this directory (S1–S8). This file is the one task ledger.

- [x] **T1 — A1 in the type model.** `name.ts` exports `CLOSE_STATES` (host-free) and `index.ts` builds
  `ScrubCloseParams.state` from it, so the schema cannot drift from the constant. Tests: the set is
  exactly "every state whose meaning is a fact about *this* session" (all five minus `traspaso`), every
  element parses back out of a name, and `traspaso` is absent.

- [x] **T2 — A1 in the description.** `scrub_close`'s description offers four states, names `pausa` as
  the pending-handoff word, and points at `/scrub:handoff` as the only writer of `traspaso`. Gate: a
  doccheck-style source assertion that `ScrubCloseParams` builds its union from `CLOSE_STATES` and does
  not name `STATE.traspaso`. The `/scrub:handoff` command description also stopped telling the human to
  name the session `traspaso:` first.

- [x] **T3 — A2 in the handler.** `/scrub:handoff` creates, seeds and names the destination first; the
  origin's `traspaso:` is written afterwards by path (`appendNameToOther`), with the new session as the
  live path. Tests: a source-order gate (the write appears after the destination is named, and the
  origin is not renamed through `pi.setSessionName`) — lexical, so it catches a write moved back
  before the destination is named and it cannot catch a `setup` that throws — plus the cancellation
  and failure paths through their notify text.

- [x] **T5 — the frame survives a rejection.** Found by the bench, not by the brief: the rejected call
  rendered a 283-column frame line and Pi aborted. `renderToolResultLine` now collapses whitespace and
  budgets the raw text by the host's width, with tests for the measured payload, a narrow terminal, and
  the host's `isError` flag.

- [x] **T4 — docs.** `behavior.md` Layer B for `/scrub:handoff` and `scrub_close`; canonical NB-03 and
  NB-04 amended in place with a MODIFIED marker plus `## Slice 5`; `docs/guide.md` state table,
  `scrub_close` section, §6 recipe and decision table; `README.md`.

## Notes

- `strict_tdd: true`: T1–T3 and T5 each started from a failing test.
- A2 is the same write `appendNameToOther` already performs for `/scrub:triage` and `/scrub:adopt`
  (NB-08 stack). The change is *when* it runs, never *how*.
- `/name` and `/scrub:adopt` still write `traspaso:` on purpose (S5).
- The absence of a `session_shutdown` handler is untouched: REQ-12 stands (S6).

## Delivery record

- `5d66c0d` — meta: the change opened (S1–S8) and the ledger.
- `000083d` — code: A1 (`CLOSE_STATES`, four-state schema, tool and command descriptions) and A2 (the
  promise is the last write, by path), with the three new name tests and the two doccheck gates.
- `75a5c9e` — code: the result line stays inside the frame (S8), found by the live bench.
- (this commit) — docs: `behavior.md` Layer B, canonical NB-03/NB-04 amended plus `## Slice 5`,
  `docs/guide.md` state table and §6, `README.md`.
- `b323f98` — docs: two pointers still counted seven specs after S8 joined the delta.
- `64f86fb` — code: R4-001 (a frame narrower than the prefix overflowed), R2-3 (the prefix
  width was a magic 2) and R2-4 (the assertion cast to `never`) — the report-only findings
  from the review of this candidate, taken as separate later work.
- Gates on the tip: **257/257 tests, typecheck exit 0**.
- Live bench (Pi 1.3.0, tmux, scratch project, pinned `--session-dir`, removed afterwards):
  `/resume` showed the pair `pausa: desde 01a178fb · …` / `traspaso: 01a178fb · …`; the child header
  carried `parentSession`; the NB-08 backup was written beside the pinned session dir; the seeded
  message reached the child; and a `scrub_close state=traspaso` call was refused by the schema, which
  is where the 283-column crash was found and then fixed.
