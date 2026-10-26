# Change — the traspaso is written by the handoff, last

**Against:** canonical `openspec/specs/session-scrub/spec.md` (2026-10-26) — NB-03 (`scrub_close` over
the five states, and `traspaso` obliging more than a name), NB-04 (the origin renamed **before**
`newSession`), NB-01 (the closed vocabulary), NB-08 (the by-path write stack).

**Why now:** the owner asked what `/quit` does to this plugin. The answer exposed the only lie the
plugin can tell on its own initiative: the `traspaso:` it writes *before* the continuation it announces
exists. A probe confirmed that writing it last is equivalent in end state, so the order was a choice,
not a constraint.

## Specs

**S1 — the owner's decision (verbatim).**

> "¿tu que opinas, vamos con A, con B o las dos? ¿mejorarria en algo la extension?"
>
> "pruebalo y trae la respuesta con el resultado. y antes de iniciar ningun trabajo, contesta a mi
> pregunta ¿esto mejoraria en algo sesion-scrubs o lo empeoraria?"
>
> "adelante, procede como mejor consideres, A1 + A2, o solo A1"

Decided: **A1 + A2**. A2 rests on a probe, not on a preference: creating the child first and renaming
the origin by path afterwards produced a byte-identical `/resume` listing, and the picker loads its
rows lazily when the human opens it (`interactive-mode.js:4759`), so the order is invisible — while the
current order has a reachable failure (a `session_before_switch` cancelled by another extension returns
`cancelled` with the promise already written).

**S2 — the class of lie this closes.** `traspaso` asserts a continuation in another session. Written
before that session exists, the assertion is unverifiable, carries no pointer (`closeName` never
invents a token, so an un-headed close writes `traspaso: <text>` and nothing else), and is then
protected forever: `classifySession` marks every named session `namedProtected`, so it is never a trash
candidate. The mistake is permanent and only a human can undo it.

**S3 — A1: `scrub_close` writes four states.** The tool's parameter schema MUST offer `pausa`,
`abierto`, `espera`, `hecho` and MUST NOT offer `traspaso`; the state list is a host-free constant in
`name.ts` (`CLOSE_STATES`) so a test can assert it and the schema cannot drift from it. `pausa` is the
honest word while a handoff is pending — the work is here and the next step is known — and
`/scrub:handoff` promotes it to `traspaso:` once the continuation exists. The closed vocabulary keeps
all five states (parsing, `/scrub:adopt`, verdict derivation), so names already on disk read exactly as
before.

**S4 — A2: the promise is the last write.** `/scrub:handoff` MUST create, seed and name the destination
first, and only then write `traspaso: <head><next>` into the origin — by path, through
`index.ts:appendNameToOther` (the NB-08 stack), with the new session as the live path to refuse.
Consequences, all intended: a cancelled `newSession` writes nothing (today it leaves the promise and
says "cancelled"); a `setup` that throws leaves the origin's previous, honest name; a failed origin
write is reported as a warning naming what to do, never as success.

**S5 — the boundary, stated.** `/name` and `/scrub:adopt` keep writing `traspaso:`. The first is the
human's own hands — the documented trigger for the handoff (`docs/guide.md` §6.4) — and the second is a
migration of sessions that already happened. A1 closes the path where the *plugin* asserts an outcome
on its own; it does not forbid a human from announcing an intention.

**S6 — what does not change.** The five-state vocabulary; `closeName` and its head preservation
(NB-11..NB-16); verdict derivation; the destination name (`pausa: desde …`, always); the seeded message
payload; the picker rendering; and the absence of lifecycle handlers (REQ-12 — the fix is an order, not
a `session_shutdown` hook).

**S7 — the budget.** `scrub_close`'s description loses the `traspaso`-obligation paragraph and gains one
sentence of redirect, so the per-turn token cost goes down. `docs/behavior.md` quotes the description
literal; the tool name and surface inventory are unchanged, so `doccheck.test.ts` keeps passing without
an inventory edit.

**S8 — a rejected call must not break the frame** (found by the bench, not by the brief). A1 makes the schema reject a state, and the host's rejection is a multi-line, arbitrarily wide message. `render.ts:renderToolResultLine` passed the result text into a one-line component untouched, so the TUI emitted a 283-column frame line — and Pi aborts when a component returns a line wider than the terminal (measured 2026-10-26 on 1.3.0). The result line MUST collapse whitespace, MUST budget the raw text by the width the host asks for, and MUST stay inside that width at every terminal size, while the model still receives the full error in its context.

**Out of scope:** detecting promises already on disk (the rejected option B), a
`/scrub:handoff --existing <id>` for a continuation built outside scrub, and any change to `adopt`.

## Tasks

- **T1 — A1 in the type model.** `CLOSE_STATES` in `name.ts` (host-free, so node:test can read it), the
  tool's union built from it in `index.ts`, and the tests that assert the set is "every state whose
  meaning is a fact about *this* session".
- **T2 — A1 in the description.** Four states, the redirect to `/scrub:handoff`, and `pausa` named as
  the pending-handoff word.
- **T3 — A2 in the handler.** The origin write moves after `newSession`, by path, with the child as
  live; cancellation and failure paths reported honestly; a source-order gate so a later edit cannot
  quietly move it back.
- **T5 — the frame survives a rejection.** `renderToolResultLine` collapses the result to one line and
  budgets it by the host's width, with tests for the measured 283-column payload, a narrow terminal,
  and the host's own error flag.
