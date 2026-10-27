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
import { STATE, verdictFromState, type State } from "./name.ts";

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

test("a tilde fence hides markers the same way a backtick fence does", () => {
  const text = [
    "~~~md",
    POLICY_START,
    "ephemeral-flows: tilde-flow",
    POLICY_END,
    "~~~",
    "",
  ].join("\n");
  assert.equal(parsePolicyBlock(text), undefined);
  assert.deepEqual(planInitWrite(text), { kind: "append", text: `${text.length > 0 && !text.endsWith("\n") ? "\n" : ""}\n${POLICY_TEMPLATE}` });
});

test("a marker quoted as inline code is text, not a marker", () => {
  const quoted = `Run \`${POLICY_START}\` in the project root.`;
  assert.equal(parsePolicyBlock(quoted), undefined);
  assert.equal(planInitWrite(quoted).kind, "append");
});

test("a real block after an inline-code quote still parses", () => {
  const text = [
    `Quote: \`${POLICY_START}\` is the marker.`,
    POLICY_START,
    "ephemeral-flows: real-flow",
    POLICY_END,
  ].join("\n");
  assert.deepEqual(parsePolicyBlock(text), { ephemeralFlows: ["real-flow"] });
});

test("the template itself carries both markers, in order, and parses as empty", () => {
  const lines = POLICY_TEMPLATE.split("\n").filter((l) => l.trim().length > 0);
  assert.equal(lines[0], POLICY_START, "the template must open with the start marker");
  assert.equal(lines[lines.length - 1], POLICY_END, "the template must close with the end marker");
  assert.ok(POLICY_TEMPLATE.includes("ephemeral-flows: <flow-name-1>"), "the placeholder must be present");
  assert.deepEqual(parsePolicyBlock(POLICY_TEMPLATE), { ephemeralFlows: [] });
});

// ---------------------------------------------------------------------------
// session-scrub-mark-on-precedence (MP-01, MP-02)
//
// The template is the standing order the agent reads in every session, and
// nothing parses it — so the only thing a test can hold is the agreement between
// what it TELLS an agent to do and what the code actually does. The rename rule
// ordered `keep` unconditionally, while `scrub_mark` refuses exactly that write
// once the name declares a state (NB-02). Measured 2026-10-27: the closing
// session was named and not marked, and the close reported the refusal.
// ---------------------------------------------------------------------------

/** `<#   pausa, espera -> paused>` — the row form the block states its precedence in. */
const PRECEDENCE_ROW = /^#\s+([a-z]+(?:\s*,\s*[a-z]+)*)\s+->\s+([a-z]+)\s*$/;

/** The state → verdict table as the template states it, flattened. */
function statedPrecedence(template: string): Map<string, string> {
  const stated = new Map<string, string>();
  for (const line of template.split("\n")) {
    const match = PRECEDENCE_ROW.exec(line);
    if (match === null) continue;
    for (const state of match[1].split(",")) stated.set(state.trim(), match[2]);
  }
  return stated;
}

test("MP-02: the precedence the block states is the precedence the code implements", () => {
  const stated = statedPrecedence(POLICY_TEMPLATE);
  const states = Object.values(STATE) as State[];
  assert.deepEqual(
    [...stated.keys()].sort(),
    [...states].sort(),
    "the block must name every state exactly once — a sixth state cannot land silently",
  );
  for (const state of states) {
    assert.equal(
      stated.get(state),
      verdictFromState(state),
      `the block claims a different verdict for "${state}" than name.ts:verdictFromState`,
    );
  }
});

test("MP-02: the block says the refusal is deliberate, so a refused mark is not a failure", () => {
  assert.ok(
    POLICY_TEMPLATE.includes("the name is the record"),
    "the precedence must name the rule, not just the exception",
  );
  assert.ok(
    POLICY_TEMPLATE.includes("nothing is missing"),
    "an agent that reads the block must know a refused mark means nothing needs marking",
  );
});

test("MP-01: the rename rule is conditional, never a bare `record keep`", () => {
  const renameLine = POLICY_TEMPLATE.split("\n").find((line) =>
    line.trim().startsWith("#   session_rename"),
  );
  assert.notEqual(renameLine, undefined, "the template must keep a session_rename rule");
  assert.ok(
    renameLine?.includes("ONLY if the new name declares no state"),
    "the rule must carry its condition: a name with a state already is the verdict",
  );
  assert.ok(
    renameLine?.includes("PRECEDENCE"),
    "the rule must point at the precedence section that explains the refusal",
  );
});
