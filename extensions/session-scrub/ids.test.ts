// Tests for ids.ts — display abbreviations for session ids.
//
// The ids in the collision cases are the real ones from a burst of model smoke tests that
// all ran inside five and a half minutes. They are used verbatim because the shape is the
// point: uuid v7 puts a millisecond timestamp in the first twelve hex characters, so a
// burst agrees well past the eight the plugin used to show.

import { test } from "node:test";
import assert from "node:assert/strict";

import { uniqueAbbreviations, abbrevOf, idFromFilename, MIN_ABBREV } from "./ids.ts";

// Twelve sessions from 2026-10-16, all sharing `01a1444a`.
const BURST = [
  "01a1444a-03c3-7582-9275-9790bf518960",
  "01a1444a-1abb-7731-81a4-de6acc709b88",
  "01a1444a-4010-7683-95b7-91ea460ff92b",
  "01a1444a-5619-75c2-9939-aedce61761d6",
  "01a1444a-5a88-743d-81a8-8c28f7798ed7",
  "01a1444a-61f8-7197-a9f1-02ae9494632c",
  "01a1444a-87cd-7403-9cbf-0bf1272a9f5f",
  "01a1444a-9e36-7390-8c3c-9bbe088af7ac",
  "01a1444a-b8f2-71ea-b318-4e314c639c42",
  "01a1444a-c5a8-72ab-aa6d-cc0ab808b40c",
  "01a1444a-d87a-75f1-becb-8f1e2c49711c",
  "01a1444a-f405-71e2-852f-2aecd434e1f6",
];

// The other burst prefix, which needs two different widths within itself.
const BURST_46 = [
  "01a14446-05b5-732c-b3f0-e266977e9bbc",
  "01a14446-1a06-7157-a421-a0ea46496e98",
  "01a14446-1ebc-74a2-ba71-19f07a36f433",
  "01a14446-2463-713f-9c03-1277742cd5cd",
  "01a14446-284a-7644-8bc9-54273e682522",
  "01a14446-2c98-7375-af34-71955b8c6034",
  "01a14446-308f-70d5-aef0-c973cd891ebf",
  "01a14446-34af-706f-ac9c-4c1ea8e114aa",
  "01a14446-38a5-75e8-8e2d-96864bf8ad45",
  "01a14446-db17-7283-b1b8-d0d99bce923a",
];

test("ids with distinct eight-character prefixes keep the minimum width", () => {
  const map = uniqueAbbreviations([
    "01a14127-e748-7695-9cda-dbaa7db986d3",
    "01a1448c-f6fe-77ad-97f0-4c4e38dbb6d8",
    "01a1453f-aaaa-bbbb-cccc-ddddeeeeffff",
  ]);
  assert.equal(map.get("01a14127-e748-7695-9cda-dbaa7db986d3"), "01a14127");
  assert.equal(map.get("01a1448c-f6fe-77ad-97f0-4c4e38dbb6d8"), "01a1448c");
  assert.equal(map.get("01a1453f-aaaa-bbbb-cccc-ddddeeeeffff"), "01a1453f");
});

test("a burst sharing eight characters widens until each id is distinct", () => {
  const map = uniqueAbbreviations(BURST);
  const shown = [...map.values()];
  assert.equal(new Set(shown).size, BURST.length, `expected ${BURST.length} distinct, got ${new Set(shown).size}`);
  for (const s of shown) {
    assert.ok(s.length >= MIN_ABBREV, `${s} is shorter than the minimum`);
    assert.ok(s.length <= 11, `${s} is wider than this set needs`);
  }
  // Index 8 is the uuid's first dash, so a nine-character prefix is `01a1444a-` for every
  // one of them — it separates nothing. The width therefore jumps from eight to ten.
  assert.equal(map.get(BURST[0]!), "01a1444a-0");
  assert.equal(map.get(BURST[1]!), "01a1444a-1");
  // Two of the twelve share a first suffix character, so those two need eleven.
  assert.equal(map.get(BURST[3]!), "01a1444a-56");
  assert.equal(map.get(BURST[4]!), "01a1444a-5a");
});

test("one set can need two different widths", () => {
  // `1a06`/`1ebc` and the `24`/`28`/`2c` group agree through the tenth character and only
  // separate at the eleventh, while `05b5` and `db17` separate at the tenth. A single
  // fixed width cannot serve both.
  const map = uniqueAbbreviations(BURST_46);
  const shown = [...map.values()];
  assert.equal(new Set(shown).size, BURST_46.length);
  assert.equal(map.get(BURST_46[0]!), "01a14446-0");
  assert.equal(map.get(BURST_46[1]!), "01a14446-1a");
  assert.equal(map.get(BURST_46[2]!), "01a14446-1e");
  assert.equal(map.get(BURST_46[9]!), "01a14446-d");
});

test("every abbreviation is a prefix of its own id", () => {
  // The abbreviation is what a human types back, and the resolver matches by prefix — so
  // it has to be a prefix of the id it stands for, not a re-encoding of it.
  for (const id of [...BURST, ...BURST_46]) {
    const ab = uniqueAbbreviations([...BURST, ...BURST_46]).get(id)!;
    assert.ok(id.startsWith(ab), `${ab} is not a prefix of ${id}`);
  }
});

test("all twelve burst ids are mutually distinguishable in one set", () => {
  const all = [...BURST, ...BURST_46];
  const shown = [...uniqueAbbreviations(all).values()];
  assert.equal(new Set(shown).size, all.length);
});

test("the result does not depend on input order", () => {
  const a = uniqueAbbreviations(BURST);
  const b = uniqueAbbreviations([...BURST].reverse());
  for (const id of BURST) assert.equal(a.get(id), b.get(id));
});

test("an empty set is an empty map", () => {
  assert.equal(uniqueAbbreviations([]).size, 0);
});

test("an id shorter than the minimum is returned whole", () => {
  const map = uniqueAbbreviations(["abc"]);
  assert.equal(map.get("abc"), "abc");
});

test("a wider minimum is honoured even when nothing collides", () => {
  const map = uniqueAbbreviations(["01a14127-e748-7695"], 12);
  assert.equal(map.get("01a14127-e748-7695"), "01a14127-e74");
});

test("abbrevOf falls back to the plain short form for an unknown id", () => {
  // A call site that cannot reach the session set must still show something stable.
  const map = uniqueAbbreviations(BURST);
  assert.equal(abbrevOf(map, BURST[0]!), "01a1444a-0");
  assert.equal(abbrevOf(map, "deadbeef-0000-0000-0000-000000000000"), "deadbeef");
});

// ---------------------------------------------------------------------------
// idFromFilename — the id is not at the front of a session filename
// ---------------------------------------------------------------------------

const FILENAME = "2026-10-16T10-33-22-101Z_01a14446-05b5-732c-b3f0-e266977e9bbc.jsonl";

test("the id comes from after the separator, not from the front of the name", () => {
  // The bug this pins: `/scrub-restore` used the first eight characters of the basename,
  // which are the date. Every session trashed the same day rendered as `2026-10-`.
  assert.equal(idFromFilename(FILENAME), "01a14446-05b5-732c-b3f0-e266977e9bbc");
  assert.equal(
    idFromFilename("/some/trash/" + FILENAME).startsWith("2026-10"),
    false,
    "the id must not be the date",
  );
});

test("two sessions trashed the same day get different ids", () => {
  const a = idFromFilename(FILENAME);
  const b = idFromFilename("2026-10-16T10-38-57-548Z_01a1444b-240c-75d8-86f4-127c3145db88.jsonl");
  assert.notEqual(a, b);
  assert.equal(uniqueAbbreviations([a, b]).size, 2);
});

test("a name with no separator is returned whole rather than truncated", () => {
  // Defensive: an unexpected filename must show as itself, not as a silent slice.
  assert.equal(idFromFilename("no-separator.jsonl"), "no-separator");
});

test("a path without the .jsonl suffix still yields the id", () => {
  assert.equal(idFromFilename("2026-10-16T10-33-22-101Z_01a14446-05b5"), "01a14446-05b5");
});

test("a trash set from one day abbreviates to distinct labels", () => {
  // The real trash contents, all from 2026-10-08 — the case the old code collapsed.
  const trashed = [
    "2026-10-08T16-30-20-174Z_01a11c59-f60e-71ef-95a5-05201208dad1.jsonl",
    "2026-10-08T16-58-27-231Z_01a11c73-b41f-73a8-a5a1-c6b6958032eb.jsonl",
    "2026-10-08T17-27-16-438Z_01a11c8e-16d6-729d-ac10-2278dfdb8efd.jsonl",
    "2026-10-08T17-28-22-413Z_01a11c8f-188d-700c-ad4a-450a33f37643.jsonl",
  ];
  const shown = trashed.map((p) => abbrevOf(uniqueAbbreviations(trashed.map(idFromFilename)), idFromFilename(p)));
  assert.equal(new Set(shown).size, 4, `expected 4 distinct labels, got ${JSON.stringify(shown)}`);
  assert.deepEqual(shown, ["01a11c59", "01a11c73", "01a11c8e", "01a11c8f"]);
});