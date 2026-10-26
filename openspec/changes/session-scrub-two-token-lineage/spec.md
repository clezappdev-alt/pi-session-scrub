# Change — the lineage head carries two tokens

**Against:** canonical `openspec/specs/session-scrub/spec.md` (2026-10-26) — NB-04 (the handoff forms the
pair), NB-10..NB-13 (the population-derived marker, preserved by a close, stripped at any width, one
marker and the parent's).

**Why now:** the owner's model of the lineage, stated after `v0.4.1`, exposes a hole the previous change
did not touch.

## Specs

**S1 — the owner's model (verbatim).**

> "1. el nombre de las sesiones solo muestran ID si se ha usado /scrub_handoff. 2. si se usa
> /scrub_handoff, la sesion orignen "A" se renombra mostrando su ID, y la sesion hija "B" mostrara el
> ID de sus sesion padre. 3. Si en la sesion "B" vuelve a existri /scrub_handoff, "B" se renombrara
> mostrando el ID de su padre y su propio ID para enlace con su sesion hija, la sesion C solo contendra
> el ID de referencia hacio su sesion padre B"

**S2 — the hole.** `handoff.ts:planHandoffNames` rewrites the origin as `traspaso: <self> · <text>` and
does not re-emit the `desde <parent>` it inherited. So in `A → B → C`, **A disappears from the picker the
moment B hands off** — the same class of defect `scrub_close` had (NB-11), on the handoff path. Both
halves are needed: B must keep saying it came from A, and B must show its own id so that C's
`pausa: desde <B> · …` can be resolved by eye against a row.

**S3 — the grammar.** A name is `state: <lineage-head> <free text>`, and the head is at most two
tokens, parent first:

```
[desde <parent> · ][<self> · ]<free text>
```

| Situation | Name |
| --- | --- |
| A, handed off | `traspaso: <A> · texto` |
| B, child of A, not handed off | `pausa: desde <A> · texto` |
| B, handed off to C | `traspaso: desde <A> · <B> · texto` |
| C, child of B | `pausa: desde <B> · texto` |

No name ever carries a grandparent: C says B, B says A and itself. No sigil is introduced — the first
token is a parent only when the literal `desde` precedes it, and the second is the session's own
abbreviation, written by the plugin at handoff time.

**S4 — every existing name keeps parsing.** Names already on disk are `traspaso: <self> · …` and
`pausa: desde <parent> · …`; both are heads this grammar already covers. The names this change starts
writing must be stripped, preserved and re-emitted by the same helper, so no caller open-codes the
pattern.

**S5 — the text carried forward is the text.** Whatever a name's head holds, the next step derived from
it never includes any part of the head, and a head token appearing later in the text is the human's
words.

**S6 — `scrub_close` preserves the head whole** (extends NB-11): a middle session closed as `espera`
keeps both tokens (`espera: desde <A> · <B> · texto`), because dropping either one loses a link that
exists nowhere else in the picker.

**S7 — budget, stated.** The middle session pays `traspaso: ` + `desde <A> · ` + `<B> · ` ≈ 37 characters
where a plain close pays 24, leaving ~40 visible characters of next step where the picker truncates
around 77. `scrub_close`'s description says so (the previous change already states the ~53 case).

**Out of scope:** what the middle session's own id means beyond display; any change to
`parentSession`; rewriting names already on disk; and the marker's width rule (NB-10 stays as shipped).

## Tasks

- **T1 — NB-15: one helper splits and re-emits the head.** `name.ts` owns `splitLineage` /
  `formatLineageHead`, TDD'd against both legacy shapes and the two-token shape.
- **T2 — NB-14: the handoff re-emits the inherited parent and adds its own abbreviation.**
  `planHandoffNames` builds the origin name from the origin's current head, not from an empty one.
- **T3 — NB-16: `closeName` preserves both tokens.** Marker-only preservation today would drop the
  own id.
- **T4 — the chain, asserted.** `A → B → C`: B carries `desde A` and `B`, C carries `desde B`, no name
  carries a grandparent, and neither the name nor the seeded text repeats a head token.
- **T5 — docs.** `behavior.md` Layer B for `/scrub:handoff` and `scrub_close`; NB-14..NB-16 in the
  canonical spec.
