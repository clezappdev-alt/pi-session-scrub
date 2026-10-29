// Tests for the PR ceremony gate (.github/scripts/pr-ceremony.cjs).
//
// The gate exists because the repo DECLARED a ceremony and enforced none of it: the pull
// request template asked for `Closes #N` and nothing checked it, and the org's `type:*`
// labels were never created here. A rule that is declared and not enforced is skipped in
// silence, and that trains everyone to skip it.
//
// The three checks are the three facts a machine can verify about a PR without reading its
// diff: the title (Conventional Commits), the issue link (well formed and same-repo), and
// exactly one `type:*` label. Everything else stays human.
//
// Pure functions over strings, so they are testable without a host, a token or a network.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { checkTitle, parseIssueRefs, checkTypeLabels, parseLabels } = require("./pr-ceremony.cjs");

// ---------------------------------------------------------------------------
// checkTitle — Conventional Commits
// ---------------------------------------------------------------------------

test("a conventional title passes, with or without a scope and a breaking mark", () => {
  for (const title of [
    "fix(scrub): a retention verdict survives the session name",
    "feat: add a gate",
    "docs(readme): the install line",
    "feat!: redesign the naming block",
    "chore(deps): bump typescript",
  ]) {
    assert.equal(checkTitle(title).ok, true, title);
  }
});

test("a title that is not conventional is refused with the reason", () => {
  for (const title of [
    "A retention verdict survives the name",
    "fix(Scrub): uppercase scope",
    "fix:no space after the colon",
    "fixed(scrub): wrong type",
    "fix(scrub):",
    "",
  ]) {
    const result = checkTitle(title);
    assert.equal(result.ok, false, title);
    assert.match(result.message, /conventional/i);
  }
});

// ---------------------------------------------------------------------------
// parseIssueRefs — the link, and only the link
// ---------------------------------------------------------------------------

test("every closing keyword links an issue, and Refs links without closing it", () => {
  const cases = [
    ["Closes #12", 12, true],
    ["Fixes #7", 7, true],
    ["Resolves #3", 3, true],
    ["Refs #99", 99, false],
    ["closes #12", 12, true],
  ];
  for (const [body, number, closing] of cases) {
    const refs = parseIssueRefs(body);
    assert.equal(refs.length, 1, body);
    assert.equal(refs[0].number, number, body);
    assert.equal(refs[0].closing, closing, body);
  }
});

test("the reference is found in a real PR body, punctuation and prose included", () => {
  const body = [
    "## Problem",
    "",
    "The gate did not exist.",
    "",
    "## Change",
    "",
    "It exists (see #4).",
    "",
    "Closes #42.",
  ].join("\n");
  const refs = parseIssueRefs(body);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].number, 42);
});

test("a body with no link yields nothing, and that is what the gate refuses", () => {
  for (const body of [
    "",
    "## Problem\n\nNo link anywhere.",
    "Closes 12",
    "closes#12",
    "See issue #12",
  ]) {
    assert.deepEqual(parseIssueRefs(body), [], body);
  }
});

test("a cross-repository or truncated reference is not a link to this repository", () => {
  for (const body of ["Closes owner/repo#1", "Closes #12a", "Closes #"]) {
    assert.deepEqual(parseIssueRefs(body), [], body);
  }
});

test("several references are all reported, in the order they appear", () => {
  const refs = parseIssueRefs("Closes #5\nRefs #9");
  assert.deepEqual(
    refs.map((r) => [r.number, r.closing]),
    [
      [5, true],
      [9, false],
    ],
  );
});

// ---------------------------------------------------------------------------
// checkTypeLabels — exactly one, and the label IS the record
// ---------------------------------------------------------------------------

test("exactly one type label passes, and other labels do not count", () => {
  assert.equal(checkTypeLabels(["type:bug"]).ok, true);
  assert.equal(checkTypeLabels(["bug", "type:docs", "size:exception"]).ok, true);
});

test("no type label is refused, because the release notes have nothing to read", () => {
  const result = checkTypeLabels(["bug", "documentation"]);
  assert.equal(result.ok, false);
  assert.match(result.message, /exactly one type:/i);
});

test("two type labels are refused even when they agree on the family", () => {
  const result = checkTypeLabels(["type:bug", "type:chore"]);
  assert.equal(result.ok, false);
  assert.match(result.message, /exactly one type:/i);
});

test("an empty or bare type label does not count as one", () => {
  for (const labels of [["type:"], ["type"], ["type: "]]) {
    assert.equal(checkTypeLabels(labels).ok, false, JSON.stringify(labels));
  }
});

// The check reads labels as the API returns them, which may be objects, and the workflow
// passes them through JSON. Accepting only `string[]` would make the gate fail open on a
// shape change nobody notices.
test("labels may arrive as objects with a name, as the API returns them", () => {
  assert.equal(checkTypeLabels([{ name: "type:feature" }]).ok, true);
  assert.equal(checkTypeLabels([{ name: "type:feature" }, { name: "type:bug" }]).ok, false);
});

// --- Reading the labels the workflow hands over ------------------------------
//
// `PR_LABELS` arrives as JSON text from `toJSON(github.event.pull_request.labels)`.
// The CLI block used `JSON.parse(process.env.PR_LABELS || "[]")` directly, so a
// payload that was not valid JSON killed the gate with a stack trace — a red run
// that says nothing about the pull request, which is the worst way for a gate to
// fail when its whole purpose is to explain itself. Native review of the gate
// itself marked it WARNING (R3-001).

test("labels are read from the JSON the workflow passes, and no payload is no labels", () => {
  assert.deepEqual(parseLabels("[]"), { ok: true, labels: [] });
  assert.deepEqual(parseLabels(undefined), { ok: true, labels: [] });
  assert.deepEqual(parseLabels("  "), { ok: true, labels: [] });
  assert.deepEqual(parseLabels('[{"name":"type:bug"}]'), {
    ok: true,
    labels: [{ name: "type:bug" }],
  });
  // A caller that already has the array is not forced to serialise it first.
  assert.deepEqual(parseLabels([{ name: "type:bug" }]), { ok: true, labels: [{ name: "type:bug" }] });
});

test("a label payload that is not JSON is a gate failure with a message, never a throw", () => {
  const result = parseLabels("type:bug, type:docs");
  assert.equal(result.ok, false);
  assert.match(result.message, /PR_LABELS is not valid JSON/);
  assert.doesNotThrow(() => parseLabels("{"));
});

test("a label payload that is JSON but not an array is refused by name", () => {
  const object = parseLabels('{"name":"type:bug"}');
  assert.equal(object.ok, false);
  assert.match(object.message, /not an array of labels/);

  const nullPayload = parseLabels("null");
  assert.equal(nullPayload.ok, false);
  assert.match(nullPayload.message, /got null/);
});

test("the type-label check reports a malformed payload instead of failing on it", () => {
  const result = checkTypeLabels("{oops");
  assert.equal(result.ok, false);
  assert.match(result.message, /PR_LABELS is not valid JSON/);
});
