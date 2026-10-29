# Change — every rendered line fits the frame

**Against:** canonical `openspec/specs/session-scrub/spec.md` (2026-10-26) — NB-03/NB-04 as amended by
`session-scrub-handoff-promise` (the bounded result line, S8), NB-10 (the population-derived
abbreviation).

**Why now:** the fourth review of `session-scrub-handoff-promise` left two items declared rather than
fixed, and the owner asked to correct them before continuing. One is a live crash path; the other is a
requirement that has been contradicted by a later one since long before this change.

## Specs

**S1 — the residual crash.** `renderMarkCall` and `renderCloseCall` build their line from a painted tool
name, a painted state, and a quoted preview, and pass it to a component that **ignores `width`**. Pi
aborts the whole TUI when a component returns a line wider than the frame. With the preview capped at 60
cells and a `scrub_close` head of roughly 25, a terminal of 80 columns can still be exceeded, so the
crash the result line no longer has is still reachable from the call line.

**S2 — the contract.** Every renderer in this module MUST return a line whose visible width, measured in
cells under the same conservative rule the result line already uses (combining marks 0, ASCII 1,
everything else 2), is at most the `width` the host asks for. The rule applies to the call lines and the
result line alike, so a future renderer added here inherits one budget instead of inventing another.

**S3 — degradation order.** When the whole line does not fit, the preview is shortened first, then
dropped entirely; the tool name and the state are what a human needs to know what was called. If even
those do not fit, the line is cut with the ellipsis. The line is never padded to the frame and never
returns more than one line.

**S4 — the preview keeps its own cap.** `PREVIEW_MAX` stays a content budget (60 cells) so a long text
cannot crowd out the state on a wide terminal; S2's frame budget only ever cuts further.

**S5 — `NB-04` stops contradicting `NB-10`.** The canonical requirement still says `<shortId>` is "the
first 8 hex characters of the session id", which NB-10 superseded: the abbreviation is population-derived
and wider when two ids collide. The clause MUST be corrected in place with a MODIFIED marker, not
silently dropped, because a reader who trusts it would reintroduce the measured defect (`v0.4.0`: two
handoffs four seconds apart shared their first eight characters, and the child's marker pointed at the
child itself).

**Out of scope:** the compact rows and the digest packs (`formatCompactRow`, `formatDigestPack`) — they
are command output rendered by Pi's own text renderer, not components this module hands to the frame, and
they have no width to respect. Any re-layout of the call line (multi-line, columns) is out: one line is
the contract.

## Tasks

- **T1 — the bug, pinned.** A test that builds a `scrub_close` call with a 60-cell preview, renders it at
  80 columns, and asserts the visible cell width of the whole line. RED first.
- **T2 — one budget for every renderer.** The call renderers take `width` and degrade in the S3 order,
  through the same `cellWidth`/`fitCells` helpers the result line uses.
- **T3 — the narrow-frame cases.** A frame where only the head fits, and one where even the head does
  not, both pinned.
- **T4 — docs.** `behavior.md` Layer B states the width contract for the call lines; NB-04's
  `<shortId>` clause is corrected against NB-10 in the canonical spec.
