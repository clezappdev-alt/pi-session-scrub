# Change — the lineage marker in a session name

**Against:** canonical `openspec/specs/session-scrub/spec.md` (2026-10-26) — NB-04 (`/scrub:handoff`
is the pair-forming command), NB-06 (display ids are minimal-unique) and NB-09 (a declared state is
final). Slice-4 scenario NS2 is the one this change repairs.

**Why now:** measured live on the released `v0.4.0`, 2026-10-26, in the `_scrub-fixture` bench
(evidence in `odd/tasks/measurement-ns.md`, findings F1 and the closing rename).

## Specs

**S1 — the owner's report (verbatim).**

> "al modificarl el estado con scrub_close, se pierde la referencia de id a la sesion padre y por
> tanto la referencia visual de /resume"

Measured in the same session that received the report, from its own `session_info` entries:

```
13:42:48  pausa: desde 01a177dc · spec y doc entregados y mergeados; falta el `runner:` …   ← seeded by /scrub:handoff
13:46:57  espera: Instalar v0.4.0 (ya taggeado y pusheado) y correr la mitad interactiva …   ← written by scrub_close
```

The marker `desde 01a177dc ·` is the only thing in the picker that says where the work came from,
and `scrub_close` rewrote the whole free text, so it was gone.

**S2 — the second defect, measured while running NS2.** Two `/scrub:handoff` runs four seconds
apart produced the destination ids `01a17881-6e43-77bd-…` and `01a17881-f553-77bd-…`. `handoff.ts`
writes `SHORT_ID_LENGTH = 8` characters, so the child's name read
`pausa: desde 01a17881 · medicion NS2 paso uno` — where `01a17881` is **also the child's own
abbreviation**. A reader looking the parent up by that marker finds two rows, one of them the child.

**S3 — the marker must be derived from the population, never from a fixed width.** `ids.ts` already
settles this argument for listings ("twelve sessions whose first eight characters were `01a1444a`,
and no fixed width would have separated them either, because they agreed on the first twelve"). The
handoff is the one place that still assumes a width. It must use `uniqueAbbreviations` over the
sessions that exist in the project (plus the origin), exactly as `/scrub:audit` and `/scrub:triage`
do.

**S4 — `scrub_close` preserves an inherited marker; it never invents one.** When the current name
carries a leading lineage marker, the new name keeps it and replaces only the free text. When it
does not, the new name has no marker: a marker is a fact about where the work came from, and the
tool that renames has no way to know one.

**S5 — old names keep working.** `stripLineage` currently accepts exactly eight hex characters. It
must accept a variable-width marker, because after this change a name can carry nine or fifteen, and
the names already written carry eight.

**S6 — one marker, and it is the parent's, never the grandparent's** (owner, verbatim):

> "solo debe mostrar el marcador del padre, no del abuelo :D"

A name carries **at most one** lineage marker. It always names the session the work came from
immediately — or, under `traspaso:`, that session's own id — and it never accumulates. In a chain
`A → B → C`, `B` reads `pausa: desde A · …` and `C` reads `pausa: desde B · …`; nothing in `C`
mentions `A`. The free text a handoff carries forward is the previous text **with its marker
stripped**, which is what keeps the line one marker long however long the chain gets, and
`scrub_close` must obey the same rule: preserving an inherited marker never adds a second one.

**S7 — the residual is accepted, and written down instead of hidden** (decision, 2026-10-26). A name is
static text written at one instant; a session created *later* can share the origin's abbreviation, and
then the stored marker is ambiguous even though every listing stays unambiguous. The guarantee this
change delivers is therefore: *the marker is unique among the sessions that exist when the name is
written*. Anything stronger means either creating the destination before naming the origin (which
trades a proven ordering property for an unproven one) or widening every marker to twelve hex
characters, which pays name budget forever for a gain that `ids.ts` already measured as not certain
("twelve sessions … agreed on the first twelve"). Neither is worth it to fix a stale label.

**S8 — the marker syntax stays `desde`, and the visible budget is acknowledged.** The overhead is
`pausa: ` (7) + `desde <abbr> · ` (6 + width + 3), so with an eight-character abbreviation about 53
characters of the free text are visible where Pi truncates a picker row (~77, measured). `←` would
save four characters at the cost of a second syntax on disk forever and a glyph that renders
differently per terminal; the marker also has to strip from names already written with `desde`.
So: keep `desde`, keep the marker in front (pairing beats the tail), and tell the human — through
`scrub_close`'s own description — to keep the text short enough to survive the truncation.

**Out of scope:** rewriting names already on disk, a new name syntax for the lineage, any change to
`parentSession` usage, and every command that is not `/scrub:handoff` or `scrub_close`.

## Tasks

- **T1 — NB-10: the handoff marker is population-derived.** `planHandoffNames` stops slicing 8
  characters and takes the origin's abbreviation as an input, computed by the caller from the
  project population plus the origin. Tests: a population where the origin shares its first eight
  characters with another session yields a longer marker; a lone origin keeps eight.
- **T2 — NB-11: `scrub_close` preserves the inherited marker.** Marker present → kept, text
  replaced; no marker → none added; the text budget applies to the text, not to the marker.
- **T3 — NB-12: `stripLineage` accepts a variable-width marker.** A nine-character marker strips
  like an eight-character one; a marker appearing later in the text is still left alone.
- **T4 — NB-13: exactly one marker, always the parent's.** A three-session chain produces
  `pausa: desde A · …` then `pausa: desde B · …`, with the older marker absent from both the name
  and the seeded text; `scrub_close` on a session that already carries a marker never produces two.
- **T5 — docs.** `docs/behavior.md` Layer B for `scrub_close` and `/scrub:handoff`, and the
  canonical spec gains NB-10..NB-13 with the S7 residual written down.
- **T6 — the visible budget reaches the human.** `scrub_close`'s tool description says the text must
  survive the picker's truncation (~53 characters once the marker is there), and its tests pin the
  guidance rather than the wording.
