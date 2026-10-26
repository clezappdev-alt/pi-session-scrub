# Tasks — session-scrub-lineage-marker

The requirement delta is `spec.md` in this directory (S1–S7). This file is the one task ledger.

- [ ] **T1 — NB-10: the handoff marker is population-derived, not eight hex characters.**
  `planHandoffNames` stops slicing `SHORT_ID_LENGTH` and takes the origin's abbreviation as an
  input; the caller computes it with `uniqueAbbreviations` over the project's sessions plus the
  origin, as `/scrub:audit` and `/scrub:triage` already do. Tests: a population where the origin
  shares its first eight characters with another session yields a longer marker; a lone origin keeps
  eight.

- [ ] **T2 — NB-11: `scrub_close` preserves an inherited marker and never invents one.**
  Marker present → the new name keeps it and replaces only the free text. No marker → none added.
  Tests: both directions, plus the text budget applying to the text.

- [ ] **T3 — NB-12: `stripLineage` accepts a variable-width marker.** Nine and fifteen hex
  characters strip like eight do; a marker appearing later in the text is still left alone; a name
  already on disk with eight characters keeps parsing.

- [ ] **T4 — NB-13: exactly one marker, and it is the parent's.** A three-session chain
  (`A → B → C`) yields `pausa: desde A · …` then `pausa: desde B · …`, with `A` absent from `C`'s
  name and from the seeded text; closing a session that already carries a marker never produces two.

- [ ] **T5 — docs.** `docs/behavior.md` Layer B for `scrub_close` and `/scrub:handoff`, and
  NB-10..NB-13 in the canonical spec with the residual (S7) written down.

## Notes

- `strict_tdd: true`: each of T1–T4 starts from a failing test.
- The marker lives inside the free text (`formatName(state, text)`), which is why T2 and T3 are the
  same channel as T1 and not separate features.
- Do not rewrite names already on disk: the old eight-character markers stay valid (T3).
