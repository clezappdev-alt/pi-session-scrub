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