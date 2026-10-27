// Tests for policy.ts — /scrub:init --update (session-scrub-init-update UD-01…UD-04).
//
// Appended by the change rather than mixed into the block above, so the two
// concerns stay readable: the region scan is PB-01/PB-02's, and everything here
// is about refreshing a block that already exists. The module is host-free by
// contract, so this file imports node:test, node:assert/strict and policy.ts
// only (plus name.ts, which is host-free for the same reason).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  POLICY_START,
  POLICY_END,
  POLICY_TEMPLATE,
  diffPolicyBlock,
  findBlockRegion,
  parsePolicyBlock,
  planInitUpdate,
  planInitWrite,
} from "./policy.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * The template as it shipped up to v0.6.1, inlined on purpose.
 *
 * This is what a real `AGENTS.md` contains today: a stale copy of a template that
 * has since changed. The fixture is frozen even as the shipped template evolves —
 * that is the whole scenario — and every line of it is a `#` comment or one of the
 * three keys, which is what makes it safe to rewrite.
 */
const PREVIOUS_TEMPLATE = `<!-- pi-session-scrub:start -->
# session-scrub policy — project-local, opt-in, one block per project.
# Everything here but one key is written for the AGENT, not for the plugin:
# it is the standing order for when to use scrub_mark and scrub_close.
#
# VERDICTS (record via the scrub_mark tool, with an optional reason):
#   keep      — this session holds work worth preserving; never a trash candidate.
#   paused    — block closure: work stopped but WILL continue later; not a candidate.
#   finished  — session closure: the work is done; the session becomes a trash candidate.
#   ephemeral — this session ran one of the ephemeral flows below; trash candidate.
#   trash     — explicitly condemned; trash candidate even if the session is named.
#
# WHEN TO MARK:
#   session_rename — when this session gets named or renamed (/name), record keep.
#   block_close    — when work pauses with intent to resume, record paused.
#   session_close  — when the work is done, record finished.
#   ephemeral flow — when the session invokes a flow listed in ephemeral-flows, record ephemeral.
#
# EPHEMERAL FLOWS — the only key the plugin itself reads. Exact skill-flow
# names as invoked (the name after /skill:), comma-separated. ONLY these
# flows ever qualify a session as ephemeral. Leave the placeholders if none.
verdicts: keep | paused | finished | ephemeral | trash
mark-on: session_rename, block_close, session_close
ephemeral-flows: <flow-name-1>, <flow-name-2>
<!-- pi-session-scrub:end -->
`;

/** Fill a template fixture's flows line, the way a project would have. */
function withFlows(template: string, value: string): string {
  return template.replace(/^ephemeral-flows:.*$/m, `ephemeral-flows: ${value}`);
}

// ---------------------------------------------------------------------------
// UD-01 — the update planner
// ---------------------------------------------------------------------------

test("UD-01: no block plans exactly the append a first run would write", () => {
  const text = "# project notes\n";
  assert.deepEqual(planInitUpdate(text), planInitWrite(text));
});

test("UD-01: an unterminated block is refused with the start marker's line", () => {
  const text = ["# project", POLICY_START, "# stale", "ephemeral-flows: a"].join("\n");
  assert.deepEqual(planInitUpdate(text), { kind: "unterminated", line: 2 });
});

test("UD-01: a line the template does not own stops the update and is named", () => {
  const text = [
    "# project",
    POLICY_START,
    "# session-scrub policy",
    "notes: read this before triage",
    "ephemeral-flows: a",
    POLICY_END,
  ].join("\n");
  assert.deepEqual(planInitUpdate(text), {
    kind: "foreign",
    line: 4,
    text: "notes: read this before triage",
  });
});

test("UD-01: a key the template does not own is refused too, not just prose", () => {
  const text = [POLICY_START, "trash-after: 30d", POLICY_END].join("\n");
  assert.deepEqual(planInitUpdate(text), { kind: "foreign", line: 2, text: "trash-after: 30d" });
});

test("UD-03: a second ephemeral-flows line is refused by its own line", () => {
  const text = [
    POLICY_START,
    "# session-scrub policy",
    "verdicts: keep | paused | finished | ephemeral | trash",
    "ephemeral-flows: a",
    "ephemeral-flows: b",
    POLICY_END,
  ].join("\n");
  assert.deepEqual(planInitUpdate(text), { kind: "foreign", line: 5, text: "ephemeral-flows: b" });
});

test("UD-01: a block already at the template is current, so nothing is written", () => {
  assert.deepEqual(planInitUpdate(POLICY_TEMPLATE), { kind: "current", line: 1 });
});

test("UD-01: a block whose prose and keys match is current even with flows filled in", () => {
  assert.deepEqual(planInitUpdate(withFlows(POLICY_TEMPLATE, "code-review, spike")), {
    kind: "current",
    line: 1,
  });
});

test("UD-01: the project's flows survive the rewrite, and the stale guidance goes", () => {
  const text = `# project notes\n\n${withFlows(PREVIOUS_TEMPLATE, "code-review, spike")}`;
  const plan = planInitUpdate(text);
  assert.equal(plan.kind, "update");
  if (plan.kind !== "update") return;
  assert.ok(
    plan.text.includes("ephemeral-flows: code-review, spike"),
    "the human's flows are data and must survive",
  );
  assert.ok(
    plan.text.includes("record keep ONLY if the new name declares no state"),
    "the stale unconditional rule must be replaced by the current one",
  );
  assert.ok(
    plan.text.includes("PRECEDENCE"),
    "the block must gain the precedence section it never had",
  );
  assert.ok(
    plan.text.startsWith("# project notes\n"),
    "everything outside the region is preserved byte-for-byte",
  );
  assert.deepEqual(parsePolicyBlock(plan.text), {
    ephemeralFlows: ["code-review", "spike"],
  });
});

test("UD-01: a quoted template in the project's own docs is text, not a block", () => {
  const text = ["# docs", "```md", POLICY_START, "ephemeral-flows: quoted", POLICY_END, "```"].join(
    "\n",
  );
  assert.deepEqual(planInitUpdate(text), planInitWrite(text));
});

test("UD-04: applying the plan once is enough — the second run is a no-op", () => {
  const text = withFlows(PREVIOUS_TEMPLATE, "code-review");
  const first = planInitUpdate(text);
  assert.equal(first.kind, "update");
  if (first.kind !== "update") return;
  assert.deepEqual(planInitUpdate(first.text), { kind: "current", line: 1 });
});

// ---------------------------------------------------------------------------
// UD-04 — one scanner for both planners
// ---------------------------------------------------------------------------

test("UD-04: the scanner reports the region the appending planner refuses on", () => {
  const text = ["# project", POLICY_START, "# x", POLICY_END].join("\n");
  assert.deepEqual(findBlockRegion(text), { startLine: 2, endLine: 4 });
  assert.deepEqual(planInitWrite(text), { kind: "exists", line: 2 });
  assert.deepEqual(planInitUpdate(text).kind === "update", true);
});

test("UD-04: a start without an end has no end line, for either caller", () => {
  const text = [POLICY_START, "# x"].join("\n");
  assert.deepEqual(findBlockRegion(text), { startLine: 1 });
});

// ---------------------------------------------------------------------------
// UD-02 — the diff the confirmation shows
// ---------------------------------------------------------------------------

test("UD-02: the diff shows only the changed lines, removals first", () => {
  const diff = diffPolicyBlock("a\nb\nc", "a\nB\nc");
  assert.equal(diff, "- b\n+ B");
});

test("UD-02: the diff trims the common head and tail it does not need to show", () => {
  assert.equal(diffPolicyBlock("x\ny\nz", "x\nY\nZ"), "- y\n- z\n+ Y\n+ Z");
});

test("UD-02: an unchanged block has an empty diff", () => {
  assert.equal(diffPolicyBlock(POLICY_TEMPLATE, POLICY_TEMPLATE), "");
});

test("UD-02: a pure addition shows only the lines that arrive", () => {
  assert.equal(diffPolicyBlock("a\nc", "a\nb\nc"), "+ b");
});

test("UD-02: a purely prepended line does not swallow the tail", () => {
  assert.equal(diffPolicyBlock("b\nc", "a\nb\nc"), "+ a");
});
