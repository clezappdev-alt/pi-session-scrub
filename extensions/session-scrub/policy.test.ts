// Tests for policy.ts — the POLICY block region scan and /scrub:init planner.
//
// Change session-scrub-policy-block (PB-01…PB-05):
//   PB-01  the block is a REGION (first start → first end after it), not a switch;
//   PB-02  markers inside triple-backtick fences are text, not markers;
//   PB-03/04  planInitWrite decides exists-vs-append purely, so /scrub:init can
//          show what it writes, refuse with a line number, and never throw.
//
// The module is host-free by contract (PB-05): this file imports only node:test,
// node:assert/strict and policy.ts.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  POLICY_START,
  POLICY_END,
  POLICY_TEMPLATE,
  parsePolicyBlock,
  planInitWrite,
} from "./policy.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function block(flowsLine: string): string {
  return `${POLICY_START}\n# guidance only\n${flowsLine}\n${POLICY_END}\n`;
}

// ---------------------------------------------------------------------------
// PB-01 — the block is a region, not a switch
// ---------------------------------------------------------------------------

test("another tool's block does not contribute flows", () => {
  // Own block lists nothing; a foreign block elsewhere lists a flow. The old
  // parser scanned the whole file and merged the foreign flow in.
  const text = [
    "# project notes",
    block("ephemeral-flows:"), // own block, no flows
    "<!-- other-tool:start -->",
    "ephemeral-flows: other-flow",
    "<!-- other-tool:end -->",
  ].join("\n");
  const parsed = parsePolicyBlock(text);
  assert.ok(parsed !== undefined);
  assert.deepEqual(parsed.ephemeralFlows, []);
});

test("a key outside the region never contributes", () => {
  // Real block with no flows; a stray key AFTER the end marker must be ignored.
  const text = [
    block("ephemeral-flows:"),
    "ephemeral-flows: after-end-flow",
  ].join("\n");
  const parsed = parsePolicyBlock(text);
  assert.ok(parsed !== undefined);
  assert.deepEqual(parsed.ephemeralFlows, []);
});

test("unterminated start with a stray earlier end is not a block", () => {
  const text = [
    `${POLICY_END} (stray, before any start)`,
    POLICY_START,
    "ephemeral-flows: x",
  ].join("\n");
  assert.equal(parsePolicyBlock(text), undefined);
});

test("flows inside the region are read in order", () => {
  const text = block("ephemeral-flows: flow-a, flow-b");
  const parsed = parsePolicyBlock(text);
  assert.ok(parsed !== undefined);
  assert.deepEqual(parsed.ephemeralFlows, ["flow-a", "flow-b"]);
});

// ---------------------------------------------------------------------------
// PB-02 — a marker inside a fenced code block is text, not a marker
// ---------------------------------------------------------------------------

test("a quoted template stays a quote when a real block exists", () => {
  const text = [
    "# docs quote the template:",
    "```",
    POLICY_START,
    "ephemeral-flows: quoted-flow",
    POLICY_END,
    "```",
    "",
    block("ephemeral-flows: real-flow"),
  ].join("\n");
  const parsed = parsePolicyBlock(text);
  assert.ok(parsed !== undefined);
  assert.deepEqual(parsed.ephemeralFlows, ["real-flow"]);
});

test("a quoted template with no real block is not policy", () => {
  const text = [
    "```",
    POLICY_START,
    "ephemeral-flows: quoted-flow",
    POLICY_END,
    "```",
  ].join("\n");
  assert.equal(parsePolicyBlock(text), undefined);
});

test("an unterminated fence hides everything after it", () => {
  // A fence opened and never closed: the real block below is inside it.
  const text = ["```", block("ephemeral-flows: real-flow")].join("\n");
  assert.equal(parsePolicyBlock(text), undefined);
});

// ---------------------------------------------------------------------------
// Preserved F4 grammar (existing behaviour, pinned)
// ---------------------------------------------------------------------------

test("absent block parses as undefined", () => {
  assert.equal(parsePolicyBlock("# just a normal AGENTS.md\n"), undefined);
});

test("placeholder flows parse as empty", () => {
  const parsed = parsePolicyBlock(block("ephemeral-flows: <flow-name-1>, <flow-name-2>"));
  assert.ok(parsed !== undefined);
  assert.deepEqual(parsed.ephemeralFlows, []);
});

test("comment and blank lines inside the region are skipped", () => {
  const text = [
    POLICY_START,
    "# ephemeral-flows: commented-out",
    "",
    "ephemeral-flows: real-flow",
    POLICY_END,
  ].join("\n");
  const parsed = parsePolicyBlock(text);
  assert.ok(parsed !== undefined);
  assert.deepEqual(parsed.ephemeralFlows, ["real-flow"]);
});

// ---------------------------------------------------------------------------
// PB-03/PB-04 — planInitWrite: the /scrub:init decision, purely
// ---------------------------------------------------------------------------

test("planInitWrite refuses with the 1-based line of the start marker", () => {
  const text = ["# notes", block("ephemeral-flows: real-flow")].join("\n");
  // block() puts POLICY_START on the second line of the file.
  assert.deepEqual(planInitWrite(text), { kind: "exists", line: 2 });
});

test("planInitWrite refuses on the first line", () => {
  assert.deepEqual(planInitWrite(block("ephemeral-flows:")), {
    kind: "exists",
    line: 1,
  });
});

test("planInitWrite ignores a fenced template and reports the real block", () => {
  const text = [
    "```",
    POLICY_START,
    POLICY_END,
    "```",
    "",
    block("ephemeral-flows:"),
  ].join("\n");
  // Fenced quote occupies lines 2-3; the real block starts on line 6.
  assert.deepEqual(planInitWrite(text), { kind: "exists", line: 6 });
});

test("planInitWrite appends the template to an empty file", () => {
  const plan = planInitWrite("");
  assert.deepEqual(plan, { kind: "append", text: `\n${POLICY_TEMPLATE}` });
});

test("planInitWrite appends a separator when the file lacks a trailing newline", () => {
  const plan = planInitWrite("# project notes");
  assert.deepEqual(plan, { kind: "append", text: `\n\n${POLICY_TEMPLATE}` });
});

test("planInitWrite appends with no extra blank line after a trailing newline", () => {
  const plan = planInitWrite("# project notes\n");
  assert.deepEqual(plan, { kind: "append", text: `\n${POLICY_TEMPLATE}` });
});

test("planInitWrite appends when the only markers are inside a fence", () => {
  const text = ["```", POLICY_START, POLICY_END, "```"].join("\n");
  const plan = planInitWrite(text);
  assert.equal(plan.kind, "append");
  assert.ok(plan.kind === "append" && plan.text.includes(POLICY_START));
});
