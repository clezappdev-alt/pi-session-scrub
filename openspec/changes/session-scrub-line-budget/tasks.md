# Tasks — session-scrub-line-budget

The requirement delta is `spec.md` in this directory (S1–S5). This file is the one task ledger.

- [x] **T1 — the bug, pinned.** `renderCloseCall` with a 60-cell preview at `width: 80` exceeds the
  frame today. Test asserts the visible cell width of the whole line, using an independent cell counter.

- [x] **T2 — one budget for every renderer.** `renderMarkCall` / `renderCloseCall` receive the width and
  degrade in the S3 order (shorten preview → drop preview → cut the head with the ellipsis), through the
  same `cellWidth`/`fitCells` helpers the result line already uses.

- [x] **T3 — the narrow-frame cases.** `width` that fits only the head, and one narrower than the head.

- [x] **T4 — docs.** `behavior.md` Layer B for the call renderers; canonical NB-04's `<shortId>` clause
  corrected against NB-10 with a MODIFIED marker.

## Notes

- `strict_tdd: true`: T1–T3 start from a failing test.
- `PREVIEW_MAX` stays 60 **cells of content**; the frame budget only cuts further (S4).
- Out of scope: the compact rows and digest packs, which Pi renders as plain text and this module never
  hands to the frame.

## Delivery record

- `a885a37` — meta: the change opened (S1–S5, T1–T4).
- `f923b16` — code: one frame budget for the call lines, with four new tests and two rewritten
  expectations that had pinned an 81-cell line at width 80.
- (this commit) — docs: the contract in `behavior.md` Layer B and NB-04's `<shortId>` clause corrected
  against NB-10.
- Gates on the tip: **264/264 tests, typecheck exit 0**.
