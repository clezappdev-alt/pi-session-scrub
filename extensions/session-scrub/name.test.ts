// Tests for the session-name convention (slice A).
//
// One question partitions the states: where does what comes next live? The test is
// that no two states can hold at once — if they could, the boundary is wrong.
//
// The name is the single carrier on purpose. The plugin derives the verdict from the
// prefix rather than keeping a second copy, because two writers diverge the moment one
// write is skipped, and a stale promise in /resume is worse than no name at all.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  STATE,
  parseName,
  formatName,
  verdictFromState,
  verdictFromName,
  resolveVerdict,
  proposeNameFromTopicKey,
  closeName,
  splitLineage,
  formatLineageHead,
  CLOSE_STATES,
} from "./name.ts";

const ALL_STATES = [
  STATE.pausa,
  STATE.abierto,
  STATE.espera,
  STATE.traspaso,
  STATE.hecho,
];

// ---------------------------------------------------------------------------
// parse
// ---------------------------------------------------------------------------

test("an unprefixed name is dirty, not an error", () => {
  const parsed = parseName("sys nueva gentle-knowled");
  assert.equal(parsed.state, undefined);
  assert.equal(parsed.text, "sys nueva gentle-knowled");
  assert.equal(parsed.dirty, true);
});

test("a prefixed name parses into state and text", () => {
  const parsed = parseName("pausa: falta escribir el spec de naming");
  assert.equal(parsed.state, STATE.pausa);
  assert.equal(parsed.text, "falta escribir el spec de naming");
  assert.equal(parsed.dirty, false);
});

test("prefix matching is case-insensitive and normalises on parse", () => {
  assert.equal(parseName("PAUSA: algo").state, STATE.pausa);
  assert.equal(parseName("Hecho: algo").state, STATE.hecho);
});

test("a prefix with no text is still declared, not dirty", () => {
  // Declared state with an empty next-step is a real state: the human said where
  // the work lives, they just didn't say what. That is different from saying nothing.
  const parsed = parseName("abierto:");
  assert.equal(parsed.state, STATE.abierto);
  assert.equal(parsed.text, "");
  assert.equal(parsed.dirty, false);
});

test("an unknown prefix is text, not a state", () => {
  // "nota: algo" must not be read as a state. If the vocabulary grows, old names
  // must keep parsing as free text rather than silently becoming stateful.
  const parsed = parseName("nota: algo");
  assert.equal(parsed.state, undefined);
  assert.equal(parsed.dirty, true);
});

test("a word that merely contains a state is not a prefix", () => {
  assert.equal(parseName("reabierto: algo").state, undefined);
  assert.equal(parseName("esperando datos").state, undefined);
});

test("an empty name is dirty", () => {
  assert.equal(parseName("").dirty, true);
  assert.equal(parseName("   ").dirty, true);
});

// ---------------------------------------------------------------------------
// format + round-trip
// ---------------------------------------------------------------------------

test("format emits the prefix verbatim and trims the text", () => {
  assert.equal(formatName(STATE.pausa, "  falta el spec  "), "pausa: falta el spec");
  assert.equal(formatName(STATE.hecho, "triage instalado"), "hecho: triage instalado");
});

test("format round-trips every state", () => {
  for (const state of ALL_STATES) {
    const name = formatName(state, "texto de prueba");
    assert.equal(parseName(name).state, state, `${state} must round-trip`);
    assert.equal(parseName(name).text, "texto de prueba");
  }
});

test("format does not produce a double prefix when text already starts with one", () => {
  // Idempotency matters because the human may type the prefixed name back in.
  const once = formatName(STATE.pausa, "falta el spec");
  assert.equal(formatName(STATE.pausa, once), once);
});

// ---------------------------------------------------------------------------
// verdict derivation
// ---------------------------------------------------------------------------

test("states that mean 'hold' derive a holding verdict, not a disposal one", () => {
  // Any state whose work still lives here must not make the session a deletion
  // candidate. NM-04 protects explicit verdicts; deriving the wrong one here would
  // hand it the wrong kind of protection.
  for (const state of [STATE.pausa, STATE.abierto, STATE.espera]) {
    const verdict = verdictFromState(state);
    assert.ok(
      verdict === "paused" || verdict === "keep",
      `${state} must derive a non-disposal verdict, got ${verdict}`,
    );
  }
});

test("states that mean 'ended' derive a disposal verdict", () => {
  for (const state of [STATE.hecho, STATE.traspaso]) {
    assert.equal(verdictFromState(state), "finished", `${state} means ended`);
  }
});

test("no prefix derives no verdict at all", () => {
  // Absent opinion must stay absent. Inventing one here is what NM-04 forbids.
  assert.equal(verdictFromState(undefined), undefined);
});

test("derived verdicts are distinct from ephemeral and trash", () => {
  // Those two carry different meanings and are never inferred from a name.
  for (const state of ALL_STATES) {
    const verdict = verdictFromState(state);
    assert.notEqual(verdict, "ephemeral");
    assert.notEqual(verdict, "trash");
  }
});

// ---------------------------------------------------------------------------
// verdictFromName — the single-carrier rule
// ---------------------------------------------------------------------------

test("verdictFromName reads the state a name declares", () => {
  assert.equal(verdictFromName("pausa: falta el spec"), "paused");
  assert.equal(verdictFromName("hecho: triage instalado"), "finished");
  assert.equal(verdictFromName("PAUSA: algo"), "paused");
});

test("verdictFromName on a name that declares nothing stays undefined", () => {
  assert.equal(verdictFromName("sys nueva gentle-knowled"), undefined);
  assert.equal(verdictFromName(""), undefined);
  assert.equal(verdictFromName("   "), undefined);
  assert.equal(verdictFromName("nota: prefijo desconocido"), undefined);
});

test("the name outranks a verdict entry when both exist", () => {
  // Single carrier: the name is the record. A session declared `hecho:` must not be
  // resurrected as paused because an older verdict entry disagrees.
  assert.equal(resolveVerdict("hecho: cerramos", "paused"), "finished");
  assert.equal(resolveVerdict("pausa: falta", "finished"), "paused");
});

test("a verdict entry is still honoured when the name declares nothing", () => {
  // Sessions written before the convention exist only as entries. Ignoring those would
  // silently drop every historical verdict.
  assert.equal(resolveVerdict("sys nueva gentle-knowled", "finished"), "finished");
  assert.equal(resolveVerdict("sin prefijo", "trash"), "trash");
});

test("neither carrier present yields no opinion at all", () => {
  assert.equal(resolveVerdict("", undefined), undefined);
  assert.equal(resolveVerdict("nombre suelto", undefined), undefined);
});

test("resolveVerdict never invents a verdict from a name alone", () => {
  for (const state of ALL_STATES) {
    const verdict = resolveVerdict(formatName(state, "algo"), undefined);
    assert.ok(
      verdict === "paused" || verdict === "keep" || verdict === "finished",
      `${state} must resolve to a real verdict, got ${verdict}`,
    );
  }
});

// ---------------------------------------------------------------------------
// proposal from an Engram topic key
// ---------------------------------------------------------------------------

test("a topic key becomes readable proposal text", () => {
  // The namespace is dropped when it merely repeats the project you are already in.
  assert.equal(
    proposeNameFromTopicKey("session-scrub:naming-traspaso", "session-scrub"),
    "naming traspaso",
  );
});

test("a foreign namespace is kept, because it carries meaning", () => {
  assert.equal(
    proposeNameFromTopicKey("pi:sessioninfo-messagecount-semantics", "session-scrub"),
    "pi sessioninfo messagecount semantics",
  );
});

test("a topic key with an awkward shape still yields usable text", () => {
  for (const key of [
    "session-scrub:T3-decisions",
    "session-scrub:advance.7.35e0",
    "session-scrub:feature-naming-redesign",
    "session-scrub",
    "",
  ]) {
    const proposal = proposeNameFromTopicKey(key, "session-scrub");
    assert.equal(typeof proposal, "string", `proposal must be a string for ${key}`);
    assert.ok(proposal.length <= 60, `proposal must stay short for ${key}: ${proposal}`);
  }
});

test("an empty topic key yields an empty proposal, not a broken name", () => {
  assert.equal(proposeNameFromTopicKey("", "session-scrub"), "");
  assert.equal(proposeNameFromTopicKey(":::", "session-scrub"), "");
});

test("a long topic key is truncated rather than left unbounded", () => {
  const long = "session-scrub:" + "palabra-".repeat(30);
  const proposal = proposeNameFromTopicKey(long, "session-scrub");
  assert.equal(proposal.length, 60);
});

// ---------------------------------------------------------------------------
// splitLineage / formatLineageHead — the lineage head (NB-15)
// ---------------------------------------------------------------------------

test("a legacy origin head is a bare self token", () => {
  // Names already on disk (S4): `traspaso: <self> · …` parses as self only, no parent.
  const split = splitLineage("01a17881 · falta el spec");
  assert.equal(split.parent, undefined);
  assert.equal(split.self, "01a17881");
  assert.equal(split.rest, "falta el spec");
});

test("a legacy child head is a desde marker with no self token", () => {
  const split = splitLineage("desde 01a177dc · falta el spec");
  assert.equal(split.parent, "01a177dc");
  assert.equal(split.self, undefined);
  assert.equal(split.rest, "falta el spec");
});

test("a two-token head parses parent first, then self", () => {
  // S3: `traspaso: desde <A> · <B> · texto` — B came from A and hands off to C.
  const split = splitLineage("desde 01a177dc · 01a17881 · falta el spec");
  assert.equal(split.parent, "01a177dc");
  assert.equal(split.self, "01a17881");
  assert.equal(split.rest, "falta el spec");
});

test("formatLineageHead re-emits the head splitLineage found", () => {
  // S4: the same helper that strips the head writes it back, so no caller open-codes
  // the pattern.
  for (const head of ["01a17881 · ", "desde 01a177dc · ", "desde 01a177dc · 01a17881 · "]) {
    const split = splitLineage(`${head}texto`);
    assert.equal(formatLineageHead(split.parent, split.self), head, `head: ${head}`);
  }
});

test("a text with no head is returned whole and formats to nothing", () => {
  const split = splitLineage("falta probar el traspaso");
  assert.equal(split.parent, undefined);
  assert.equal(split.self, undefined);
  assert.equal(split.rest, "falta probar el traspaso");
  assert.equal(formatLineageHead(split.parent, split.self), "");
});

test("a head token later in the text is the human's words, not the head (S5)", () => {
  // The head matches at position 0 only.
  const split = splitLineage("ver el id 01a11719 otra vez");
  assert.equal(split.parent, undefined);
  assert.equal(split.self, undefined);
  assert.equal(split.rest, "ver el id 01a11719 otra vez");
});

test("a token without the separator is text, at any width", () => {
  // What makes a head token is the `·`, not the length: a hex-looking word without it
  // is the human's words.
  assert.equal(splitLineage("deadbeefZZ algo").self, undefined);
  assert.equal(splitLineage("2026 revisar el spec").self, undefined);
});

test("a token wider than eight characters parses like an eight-character one", () => {
  // NB-10 stays as shipped: the width comes from the population; eight is only the floor
  // the names already on disk use (NB-12).
  const split = splitLineage("desde 01a177dc1 · 01a1788103a1 · falta");
  assert.equal(split.parent, "01a177dc1");
  assert.equal(split.self, "01a1788103a1");
  assert.equal(split.rest, "falta");
});

// ---------------------------------------------------------------------------
// closeName — scrub_close honours the lineage head
// ---------------------------------------------------------------------------

test("closeName keeps the inherited marker and replaces only the free text", () => {
  // Owner report (S1): scrub_close rewrote the whole text, and the marker — the only
  // thing in the picker pointing at the parent — was gone four minutes after the handoff
  // wrote it. The rule is keep-verbatim, replace-text-only (NB-11).
  assert.equal(
    closeName(
      "pausa: desde 01a177dc · falta el spec",
      STATE.hecho,
      "spec entregado y mergeado",
    ),
    "hecho: desde 01a177dc · spec entregado y mergeado",
  );
});

test("closeName never invents a marker", () => {
  // A rename tool has no way to know where the work came from (S4): no marker in, no
  // marker out — and the text goes in exactly as given.
  assert.equal(
    closeName(
      "espera: instalar v0.4.0 y correr la mitad interactiva",
      STATE.espera,
      "instalar v0.4.0 ya taggeado y pusheado",
    ),
    "espera: instalar v0.4.0 ya taggeado y pusheado",
  );
});

test("the close text budget applies to the text, never to the marker", () => {
  const long = "palabra ".repeat(20);
  const closed = closeName("pausa: desde 01a177dc · falta", STATE.pausa, long);
  assert.ok(closed.startsWith("pausa: desde 01a177dc · "), `marker must survive: ${closed}`);
  assert.ok(
    closed.length <= "pausa: desde 01a177dc · ".length + 60,
    `text must be budgeted, got ${closed.length} chars: ${closed}`,
  );
});

test("the close text budget applies without a marker too", () => {
  const long = "palabra ".repeat(20);
  const closed = closeName("pausa: falta", STATE.pausa, long);
  assert.equal(closed, "pausa: " + long.slice(0, 60).trim());
});

test("closing a session that already carries a marker never produces two (NB-13)", () => {
  // The human may retype the old name wholesale — the same reason formatName is
  // idempotent. Preserving one marker must not stack a second behind it (S6).
  const closed = closeName(
    "pausa: desde 01a177dc · falta el spec",
    STATE.pausa,
    "desde 01a177dc · falta el spec",
  );
  assert.equal(closed, "pausa: desde 01a177dc · falta el spec");
  assert.equal((closed.match(/desde/g) ?? []).length, 1);
});
test("closeName preserves the whole two-token head, not just the marker (S6 / NB-16)", () => {
  // Dropping the self token would lose the id C's `pausa: desde <B> · …` points at —
  // the same class of loss the marker-only fix closed for the parent token.
  assert.equal(
    closeName(
      "traspaso: desde 01a177dc · 01a17881 · falta el spec",
      STATE.espera,
      "instalar v0.4.0 y correr la mitad interactiva",
    ),
    "espera: desde 01a177dc · 01a17881 · instalar v0.4.0 y correr la mitad interactiva",
  );
});

test("closeName never invents a token, not even from text that looks like one", () => {
  // A rename tool has no way to know where the work came from (S4): a hex word in the
  // incoming text stays text when the session carries no head.
  assert.equal(
    closeName("pausa: falta", STATE.pausa, "01a17881 falta el spec"),
    "pausa: 01a17881 falta el spec",
  );
});

test("closing over retyped text never stacks a second two-token head (NB-13)", () => {
  // The human may retype the old name wholesale; one head in, one head out.
  const closed = closeName(
    "traspaso: desde 01a177dc · 01a17881 · falta el spec",
    STATE.pausa,
    "desde 01a177dc · 01a17881 · falta el spec",
  );
  assert.equal(closed, "pausa: desde 01a177dc · 01a17881 · falta el spec");
  assert.equal((closed.match(/desde/g) ?? []).length, 1);
});

test("closing a two-token head with no text keeps both tokens, no dangling separator", () => {
  // The empty-text rule from the marker-only change still holds with two tokens: only
  // the trailing separator goes, never a token.
  assert.equal(
    closeName("traspaso: desde 01a177dc · 01a17881 · algo", STATE.hecho, ""),
    "hecho: desde 01a177dc · 01a17881",
  );
  assert.equal(
    closeName("traspaso: desde 01a177dc · 01a17881 · algo", STATE.hecho, "   "),
    "hecho: desde 01a177dc · 01a17881",
  );
});

test("the close budget still applies to the text, never to the two-token head", () => {
  const long = "palabra ".repeat(20);
  const head = "pausa: desde 01a177dc · 01a17881 · ";
  const closed = closeName("pausa: desde 01a177dc · 01a17881 · falta", STATE.pausa, long);
  assert.ok(closed.startsWith(head), `head must survive: ${closed}`);
  assert.ok(
    closed.length <= head.length + 60,
    `text must be budgeted, got ${closed.length} chars: ${closed}`,
  );
});

// ---------------------------------------------------------------------------
// CLOSE_STATES — the states the plugin may write on its own initiative (NB-03)
// ---------------------------------------------------------------------------

test("the close states are every state whose meaning is a fact about this session", () => {
  // The partition, restated as a set: a close reports where the work is with respect to
  // THIS session. `traspaso` is the one state that asserts something about another
  // session, and only /scrub:handoff can know it, because only the handoff creates it.
  const factual = ALL_STATES.filter((s) => s !== STATE.traspaso);
  assert.deepEqual([...CLOSE_STATES].sort(), [...factual].sort());
});

test("no close state can assert a continuation in another session", () => {
  assert.equal(CLOSE_STATES.includes(STATE.traspaso as never), false);
});

test("every close state round-trips through the convention", () => {
  // A state the schema accepts but the parser cannot read back would be written into
  // /resume as free text, which is the one thing a state prefix exists to prevent.
  for (const state of CLOSE_STATES) {
    assert.equal(parseName(formatName(state, "próximo paso")).state, state);
  }
});

test("closing with no text keeps the marker without a dangling separator", () => {
  // A state-only close is legitimate (`hecho:`), and so is keeping the lineage. What is
  // not legitimate is a marker that ends in ` ·`, which reads as a truncated name.
  assert.equal(closeName("pausa: desde 01a177dc · algo", STATE.hecho, ""), "hecho: desde 01a177dc");
  assert.equal(closeName("pausa: desde 01a177dc · algo", STATE.hecho, "   "), "hecho: desde 01a177dc");
  assert.equal(closeName("pausa: algo", STATE.hecho, ""), "hecho:");
});
