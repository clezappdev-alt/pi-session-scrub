# Tasks — session-scrub-two-token-lineage

The requirement delta is `spec.md` in this directory (S1–S7). This file is the one task ledger.

- [ ] **T1 — NB-15: one helper splits and re-emits the head.** `name.ts` owns the grammar
  (`splitLineage`, `formatLineageHead`); `stripLineage` and `closeName` route through it instead of
  matching their own patterns. Tests: legacy `traspaso: <self> · x` and `pausa: desde <parent> · x`
  parse as before; the two-token head parses; a head token later in the text is left alone.

- [ ] **T2 — NB-14: the handoff re-emits the inherited parent and adds its own abbreviation.**
  `planHandoffNames` builds the origin name from the head the origin already carries, not from an
  empty one. Tests: first-generation origin unchanged (`traspaso: <self> · x`); middle session becomes
  `traspaso: desde <parent> · <self> · x`.

- [ ] **T3 — NB-16: `scrub_close` preserves the head whole.** Tests: `espera` on a middle session
  keeps both tokens; a marker-only head still behaves as it does today; nothing is invented.

- [ ] **T4 — the chain, asserted.** `A → B → C`: B carries `desde A` and `B`, C carries `desde B`, no
  grandparent appears, and the text carried forward contains no head token.

- [ ] **T5 — docs.** `behavior.md` Layer B for `/scrub:handoff` and `scrub_close`, and NB-14..NB-16 in
  the canonical spec, plus the budget note in `scrub_close`'s description.

## Notes

- `strict_tdd: true`: each of T1–T4 starts from a failing test.
- NB-10 stays as shipped: the width of an abbreviation still comes from the population.
- No sigil, no new delimiter (S3): the literal `desde` marks a parent, the bare token is the session's
  own id, and every name already on disk fits that reading.
