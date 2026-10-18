// Tests for the handoff payload (continuity slice C).
//
// The traspaso is executable: `ctx.newSession({ setup })` creates the destination and
// `setup` receives a mutable SessionManager, so the destination can be seeded and named
// at creation. This module holds the two pure pieces — recognising a memory write, and
// composing the message the new session starts with.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  extractMemoryRef,
  extractMemoryId,
  findLastMemoryWrite,
  stripLineage,
  planHandoffNames,
  buildHandoffMessage,
  MEMORY_WRITE_TOOLS,
} from "./handoff.ts";

const ORIGIN = {
  sessionId: "01a10e25-aaaa-7bbb-8ccc-ddddeeeeffff",
  name: "traspaso: naming continuity — falta el traspaso",
  next: "implementar el traspaso con newSession",
};

// ---------------------------------------------------------------------------
// extractMemoryRef — only writes count
// ---------------------------------------------------------------------------

test("mem_save is recognised and yields its topic key and title", () => {
  const ref = extractMemoryRef("mem_save", {
    title: "Continuidad: slice A y B listos",
    topic_key: "session-scrub:continuity-slice-ab",
  });
  assert.ok(ref);
  assert.equal(ref.topicKey, "session-scrub:continuity-slice-slice-ab".replace("slice-slice", "slice"));
  assert.equal(ref.title, "Continuidad: slice A y B listos");
});

test("mem_save without a topic key still yields a reference", () => {
  const ref = extractMemoryRef("mem_save", { title: "sin topic key" });
  assert.ok(ref);
  assert.equal(ref.topicKey, undefined);
  assert.equal(ref.title, "sin topic key");
});

test("mem_session_summary is a write and yields a reference", () => {
  // The close protocol asks for mem_session_summary, so the last memory before a
  // traspaso is often this one rather than a mem_save.
  const ref = extractMemoryRef("mem_session_summary", {
    content: "Goal: implementar el traspaso\nNext: newSession",
  });
  assert.ok(ref);
  assert.equal(ref.title, "Goal: implementar el traspaso");
});

test("memory reads are not writes and do not count", () => {
  // The rule is "the last memory WRITTEN before a traspaso". A session that only
  // read memory never wrote one, so its last read is not a handoff record.
  for (const tool of ["mem_search", "mem_get_observation", "mem_update", "mem_pin"]) {
    assert.equal(
      extractMemoryRef(tool, { id: 1, query: "x" }),
      undefined,
      `${tool} is a read, not a write`,
    );
  }
});

test("non-memory tools never yield a reference", () => {
  for (const tool of ["bash", "read", "edit", "scrub_close", "web_search"]) {
    assert.equal(extractMemoryRef(tool, { title: "looks like a memory" }), undefined);
  }
});

test("a malformed or empty memory write is skipped rather than throwing", () => {
  assert.equal(extractMemoryRef("mem_save", undefined), undefined);
  assert.equal(extractMemoryRef("mem_save", null), undefined);
  assert.equal(extractMemoryRef("mem_save", {}), undefined);
  assert.equal(extractMemoryRef("mem_save", { title: "" }), undefined);
  assert.equal(extractMemoryRef("mem_save", { title: 42 }), undefined);
  assert.equal(extractMemoryRef("mem_save", "a string"), undefined);
  assert.equal(extractMemoryRef(undefined as unknown as string, {}), undefined);
});

test("the id from the tool result is attached, and is optional", () => {
  // The id only exists in the result, never in the call arguments.
  const ref = extractMemoryRef("mem_save", { title: "t" });
  assert.ok(ref);
  assert.equal(ref.id, undefined);
});

test("the write-tool list is explicit, so a new mem_* read cannot silently count", () => {
  assert.deepEqual([...MEMORY_WRITE_TOOLS].sort(), [
    "mem_save",
    "mem_session_summary",
  ]);
});

// ---------------------------------------------------------------------------
// extractMemoryId — the id only exists in the result
// ---------------------------------------------------------------------------

test("the id is found at the top level of the result", () => {
  assert.equal(extractMemoryId({ id: 1591, sync_id: "obs-abc" }), 1591);
});

test("the id is found inside an observations list", () => {
  assert.equal(extractMemoryId({ observations: [{ id: 1589, title: "x" }] }), 1589);
});

test("the id is found inside a candidates list", () => {
  assert.equal(extractMemoryId({ candidates: [{ id: 42, judgement_id: "j" }] }), 42);
});

test("a result without a usable id yields undefined rather than throwing", () => {
  for (const value of [undefined, null, {}, "text", 42, []]) {
    assert.equal(extractMemoryId(value), undefined, `input ${JSON.stringify(value)}`);
  }
});

test("a non-numeric id is rejected", () => {
  assert.equal(extractMemoryId({ id: "obs-abc" }), undefined);
  assert.equal(extractMemoryId({ observations: [{ id: null }] }), undefined);
  assert.equal(extractMemoryId({ observations: [] }), undefined);
});

test("a non-finite id is rejected", () => {
  // A NaN would render as "id NaN" in the handoff message, which the agent would read
  // as a real pointer.
  assert.equal(extractMemoryId({ id: Number.NaN }), undefined);
  assert.equal(extractMemoryId({ id: Number.POSITIVE_INFINITY }), undefined);
});

// ---------------------------------------------------------------------------
// findLastMemoryWrite — derived from the file, not from process state
// ---------------------------------------------------------------------------

/** Build a session-shaped message entry holding toolCall parts. */
function callEntry(parts: unknown[]): unknown {
  return { type: "message", message: { role: "assistant", content: parts } };
}
const call = (name: string, args: unknown, id = "c1"): unknown => ({
  type: "toolCall",
  id,
  name,
  arguments: args,
});
const result = (id: string, structured: unknown): unknown => ({
  type: "toolCallResult",
  id,
  content: [],
  structuredContent: structured,
});

test("the last memory write is found even when later calls are reads", () => {
  const entries = [
    callEntry([call("mem_save", { title: "primera", topic_key: "p:uno" }, "c1")]),
    callEntry([call("bash", { command: "ls" }, "c2")]),
    callEntry([call("mem_save", { title: "la ultima", topic_key: "p:dos" }, "c3")]),
    callEntry([call("mem_search", { query: "algo" }, "c4")]),
    callEntry([call("mem_get_observation", { id: 5 }, "c5")]),
  ];
  const ref = findLastMemoryWrite(entries);
  assert.ok(ref);
  assert.equal(ref.title, "la ultima");
  assert.equal(ref.topicKey, "p:dos");
});

test("the observation id is recovered by pairing the call with its result", () => {
  const entries = [
    callEntry([call("mem_save", { title: "con id", topic_key: "p:tres" }, "c9")]),
    callEntry([result("c9", { id: 1592 })]),
  ];
  const ref = findLastMemoryWrite(entries);
  assert.equal(ref?.id, 1592);
});

test("a write whose result never arrived yields a reference without an id", () => {
  const entries = [callEntry([call("mem_save", { title: "sin resultado" }, "c9")])];
  const ref = findLastMemoryWrite(entries);
  assert.ok(ref);
  assert.equal(ref.id, undefined);
  assert.equal(ref.title, "sin resultado");
});

test("scanning survives malformed entries", () => {
  const entries = [
    null,
    undefined,
    "not an object",
    { type: "message" },
    { type: "message", message: null },
    { type: "message", message: { content: "not a list" } },
    { type: "message", message: { content: [null, 42, {}, { type: "toolCall" }] } },
    callEntry([call("mem_save", { title: "sobrevive" }, "c1")]),
  ];
  const ref = findLastMemoryWrite(entries);
  assert.equal(ref?.title, "sobrevive");
});

test("a session with no memory write yields nothing rather than a guess", () => {
  assert.equal(findLastMemoryWrite([]), undefined);
  assert.equal(findLastMemoryWrite([callEntry([call("bash", {})])]), undefined);
  assert.equal(findLastMemoryWrite([callEntry([call("mem_search", {})])]), undefined);
});

// ---------------------------------------------------------------------------
// stripLineage — names must not accumulate ancestry
// ---------------------------------------------------------------------------

test("a lineage marker is stripped so the text never grows", () => {
  // Without this, each handoff re-embeds the previous one's marker and the name becomes
  // a wall of 'desde' clauses after a few rounds.
  assert.equal(stripLineage("desde 01a11719 · falta probar"), "falta probar");
  assert.equal(stripLineage("01a11719 · falta probar"), "falta probar");
});

test("only the leading marker is stripped", () => {
  assert.equal(
    stripLineage("desde 01a11719 · ver el id 01a11719 otra vez"),
    "ver el id 01a11719 otra vez",
  );
});

test("text that merely looks like an id is left alone", () => {
  // Eight hex characters are the marker. A year, a four-digit count, or a longer word
  // that begins with hex is not.
  assert.equal(stripLineage("2026 revisar el spec"), "2026 revisar el spec");
  assert.equal(stripLineage("deadbeefZZ algo"), "deadbeefZZ algo");
  assert.equal(stripLineage("falta probar"), "falta probar");
});

test("stripping is idempotent", () => {
  const once = stripLineage("desde 01a11719 · desde 01a11c59 · falta probar");
  assert.equal(once, "desde 01a11c59 · falta probar");
  assert.equal(stripLineage(once), "falta probar");
});

test("the marker forms match what planHandoffNames writes", () => {
  // A round-trip guard: whatever the plan emits, stripping must put it back.
  const plan = planHandoffNames("pausa: revisar", "", "01a11719-aaaa-7bbb-8ccc-ddddeeeeffff");
  assert.ok(plan);
  assert.equal(stripLineage(plan.destinationName.replace(/^pausa:\s*/, "")), "revisar");
});

// ---------------------------------------------------------------------------
// planHandoffNames — the two names of a handoff
// ---------------------------------------------------------------------------

test("the origin is marked as handed off and the destination as received", () => {
  const plan = planHandoffNames("traspaso: falta probar el traspaso", "", "01a11719");
  assert.ok(plan);
  assert.equal(plan.originName, "traspaso: 01a11719 · falta probar el traspaso");
  assert.equal(plan.destinationName, "pausa: desde 01a11719 · falta probar el traspaso");
});

test("both names carry the id, so the pair can be matched in the picker", () => {
  // The destination says which session it inherited from; the origin says its own id so
  // that id can be found again without opening anything.
  const plan = planHandoffNames("pausa: falta el spec", "", "01a11719-aaaa-7bbb");
  assert.ok(plan);
  assert.ok(plan.originName.includes("01a11719"));
  assert.ok(plan.destinationName.includes("01a11719"));
});

test("a long session id is shortened", () => {
  const plan = planHandoffNames("pausa: x", "", "01a11719-aaaa-7bbb-8ccc-ddddeeeeffff");
  assert.ok(plan);
  assert.ok(!plan.originName.includes("aaaa"), "full uuid must not leak into the name");
});

test("a handoff from a pausa session still marks the origin as handed off", () => {
  const plan = planHandoffNames("pausa: falta el spec", "", "01a11719");
  assert.equal(plan?.originName, "traspaso: 01a11719 · falta el spec");
  assert.equal(plan?.destinationName, "pausa: desde 01a11719 · falta el spec");
});

test("a chain does not accumulate ancestry", () => {
  // Handing off from a session that already carries a marker must produce exactly one.
  const first = planHandoffNames("traspaso: falta probar", "", "01a11719");
  const second = planHandoffNames(first!.destinationName, "", "01a11c59");
  assert.equal(
    second!.originName,
    "traspaso: 01a11c59 · falta probar",
    "the previous marker must not be re-embedded",
  );
  assert.equal(second!.destinationName, "pausa: desde 01a11c59 · falta probar");
});

test("the two names never collide, whatever the origin was called", () => {
  for (const origin of [
    "traspaso: falta probar el traspaso",
    "pausa: falta el spec",
    "abierto: reescribiendo el parser",
    "espera: veredicto de F2",
    "hecho: triage instalado",
    "nombre sin prefijo",
    // An unnamed-free session whose name is the only description available: the name is
    // the text, and there is nothing else to carry.
    "sin prefijo ni texto",
  ]) {
    const plan = planHandoffNames(origin, "", "01a11719");
    assert.ok(plan, `expected a plan for ${JSON.stringify(origin)}`);
    assert.notEqual(
      plan.originName,
      plan.destinationName,
      `origin and destination must differ for ${JSON.stringify(origin)}`,
    );
  }
});

test("the next step comes from the argument when the name has none", () => {
  const plan = planHandoffNames("nombre sin prefijo", "  escribir el spec  ", "01a11719");
  assert.equal(plan?.originName, "traspaso: 01a11719 · escribir el spec");
  assert.equal(plan?.destinationName, "pausa: desde 01a11719 · escribir el spec");
});

test("with no next step anywhere there is no handoff to plan", () => {
  // A session with no state and no name carries nothing, so there is nothing to hand
  // over. A session whose *name* is the text does carry something — the name is the only
  // description that exists — which is why "sin prefijo ni texto" is not in this list.
  assert.equal(planHandoffNames("", "", "01a11719"), undefined);
  assert.equal(planHandoffNames("pausa:", "   ", "01a11719"), undefined);
  assert.equal(planHandoffNames("espera:", "", "01a11719"), undefined);
});

// ---------------------------------------------------------------------------
// buildHandoffMessage — what the destination session starts with
// ---------------------------------------------------------------------------

test("the message names the origin so the new session knows where it came from", () => {
  const message = buildHandoffMessage({ ...ORIGIN, memory: undefined });
  assert.ok(message.includes("01a10e25"), "origin id must be present");
  assert.ok(message.includes(ORIGIN.next), "next step must be present");
});

test("the message carries the memory key so the agent can retrieve it", () => {
  const message = buildHandoffMessage({
    ...ORIGIN,
    memory: { topicKey: "session-scrub:continuity-slice-ab", title: "t", id: 1591 },
  });
  assert.ok(message.includes("session-scrub:continuity-slice-ab"));
  // The id is intentionally absent: tool results are not persisted in the session file,
  // so it cannot survive a reload, and mem_search resolves the topic_key on its own.
  assert.ok(!message.includes("1591"), "must not claim an id the destination cannot verify");
});

test("the message carries the memory title, the only summary that travels", () => {
  // The title is captured from the mem_save arguments and travels in the session file, so
  // it survives a reload. The first handoff dropped it, and the destination agent spent
  // three git commands reconstructing what the previous block had done.
  const message = buildHandoffMessage({
    ...ORIGIN,
    memory: {
      topicKey: "session-scrub:continuity-traspaso-estado",
      title: "slices A-C listas, falta probar el traspaso y slice D",
    },
  });
  assert.ok(message.includes("slices A-C listas"));
});

test("the message does not tell the model how to look things up", () => {
  // The topic_key is already in the message and mem_search's signature is in the tool
  // list. Naming the tool adds no information, costs context in every later turn, and
  // would make the plugin dictate the agent's process — which is the opposite of the
  // design's division of labour.
  const message = buildHandoffMessage({
    ...ORIGIN,
    memory: { topicKey: "session-scrub:continuity-traspaso-estado", title: "t" },
  });
  assert.ok(!message.includes("mem_search"));
  assert.ok(!message.includes("mem_get_observation"));
});

test("the message separates its clauses, so nothing runs together", () => {
  const message = buildHandoffMessage({
    ...ORIGIN,
    memory: { topicKey: "session-scrub:continuity-traspaso-estado", title: "t" },
  });
  // The first handoff shipped "sanitización en lote Contexto en memoria" — two clauses
  // with no terminator between them.
  assert.ok(!/[a-z] Contexto/.test(message), `clauses ran together: ${message}`);
  assert.ok(message.includes(`${ORIGIN.next}.`), `next step must be terminated: ${message}`);
});

test("the message still reads when there is no memory", () => {
  const message = buildHandoffMessage({ ...ORIGIN, memory: undefined });
  assert.equal(typeof message, "string");
  assert.ok(message.length > 0);
  assert.ok(!message.includes("undefined"), "must not leak undefined into the context");
});

test("the message stays short enough to cost almost nothing per turn", () => {
  const message = buildHandoffMessage({
    ...ORIGIN,
    memory: {
      topicKey: "session-scrub:continuity-slice-ab",
      title: "Continuidad: slice A y B listos",
      id: 1591,
    },
  });
  assert.ok(
    message.length <= 600,
    `handoff message is context that stays in every later turn, got ${message.length} chars`,
  );
});

test("the message does not claim a memory it does not have", () => {
  const message = buildHandoffMessage({ ...ORIGIN, memory: undefined });
  assert.ok(!/memoria/i.test(message), "must not mention memory when none was written");
});