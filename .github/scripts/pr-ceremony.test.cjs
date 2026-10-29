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

const {
  checkTitle,
  parseIssueRefs,
  checkTypeLabels,
  parseLabels,
  checkPullRequest,
  parsePullRequest,
} = require("./pr-ceremony.cjs");

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

// --- Reading the labels the gate is handed --------------------------------
//
// `PR_LABELS` is the local fallback: a JSON array of labels, the shape an env var can
// carry. The CLI block used `JSON.parse(process.env.PR_LABELS || "[]")` directly, so a
// payload that was not valid JSON killed the gate with a stack trace — a red run that says
// nothing about the pull request, which is the worst way for a gate to fail when its whole
// purpose is to explain itself. In CI the labels arrive inside the pull request file
// (`parsePullRequest`); the fallback keeps the same refusal-to-throw rule.

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

// ---------------------------------------------------------------------------
// parsePullRequest — one pull request, one instant
// ---------------------------------------------------------------------------
//
// The gate used to take its three facts from three variables with two origins: the title
// and the body from the event payload, the labels from the API. Two moments of the pull
// request in one verdict (native review R4-002), and a multiline body crossing the shell
// to get there. The workflow now reads the pull request once and hands the gate the file
// that came back.

// A golden sample of what `gh api repos/{owner}/{repo}/pulls/{n}` returns, cut down to
// the fields the gate reads plus a few it must ignore.
const API_PULL_REQUEST = {
  number: 57,
  state: "open",
  title: "fix(ci): the gate reads one instant",
  body: "## Problem\n\nThe gate mixed two moments.\n\nCloses #123.\n",
  labels: [{ name: "type:bug", color: "d73a4a" }],
  head: { sha: "0d48c7c" },
};

test("the pull request is read from the JSON the fetch step wrote", () => {
  const result = parsePullRequest(JSON.stringify(API_PULL_REQUEST));
  assert.deepEqual(result, {
    ok: true,
    title: API_PULL_REQUEST.title,
    body: API_PULL_REQUEST.body,
    labels: API_PULL_REQUEST.labels,
  });
});

test("an empty body is an empty body, and the other two checks still report", () => {
  const parsed = parsePullRequest({ ...API_PULL_REQUEST, body: null });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.body, "");
  const results = checkPullRequest(parsed);
  assert.deepEqual(
    results.map((r) => r.ok),
    [true, false, true],
  );
});

test("a payload that is not a pull request is refused by name, never thrown", () => {
  for (const payload of [
    "",
    "   ",
    "{",
    "null",
    "[]",
    '{"message":"Not Found"}',
  ]) {
    const result = parsePullRequest(payload);
    assert.equal(result.ok, false, payload);
    assert.match(result.message, /not .*pull request|no pull request/i, payload);
  }
  assert.doesNotThrow(() => parsePullRequest(undefined));
});

// --- The command line, end to end ------------------------------------------
//
// The file is the input the workflow passes, so the wiring from file to exit code is what
// CI runs. A `PR_JSON_PATH` that wins over the environment variables is the whole point:
// a stale payload cannot outvote the instant that was read.

const { spawnSync } = require("node:child_process");
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");

const GATE = join(__dirname, "pr-ceremony.cjs");

function runGate(env) {
  return spawnSync(process.execPath, [GATE], {
    encoding: "utf8",
    // A minimal environment: the gate must not depend on anything but what it is given.
    env: { PATH: process.env.PATH, ...env },
  });
}

function withTempDir(run) {
  const dir = mkdtempSync(join(tmpdir(), "pr-ceremony-"));
  try {
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the file wins over the environment, so a stale payload cannot outvote it", () => {
  const run = withTempDir((dir) => {
    const file = join(dir, "pull-request.json");
    writeFileSync(file, JSON.stringify(API_PULL_REQUEST));
    return runGate({
      PR_JSON_PATH: file,
      // Everything the old path read, all of it wrong: the file is the answer.
      PR_TITLE: "not a conventional title",
      PR_BODY: "no link here",
      PR_LABELS: "",
    });
  });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.equal(run.stdout.match(/✅/g).length, 3, run.stdout);
});

test("a file that fails the ceremony fails the gate, with the gate's message", () => {
  const run = withTempDir((dir) => {
    const file = join(dir, "pull-request.json");
    writeFileSync(file, JSON.stringify({ ...API_PULL_REQUEST, title: "A vague title" }));
    return runGate({ PR_JSON_PATH: file });
  });
  assert.equal(run.status, 1);
  assert.match(run.stdout, /❌ title: "A vague title" is not a Conventional Commit/);
  assert.match(run.stdout, /1 ceremony check\(s\) failed\./);
  // The point of refusing instead of throwing: a red run that explains itself.
  assert.equal(run.stderr, "");
});

test("a file that cannot be read is reported as the gate's own input failure", () => {
  const run = withTempDir((dir) =>
    runGate({ PR_JSON_PATH: join(dir, "missing.json") }),
  );
  assert.equal(run.status, 1);
  assert.match(run.stdout, /❌.*missing\.json/);
  assert.equal(run.stderr, "");
});

test("a local run with no file reads the three variables, as before", () => {
  const run = runGate({
    PR_TITLE: "fix(scrub): a retention verdict survives the session name",
    PR_BODY: "Closes #42",
    PR_LABELS: '[{"name":"type:bug"}]',
  });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.equal(run.stdout.match(/✅/g).length, 3, run.stdout);
});

// ---------------------------------------------------------------------------
// fetchPullRequest — the network is not allowed to decide alone
// ---------------------------------------------------------------------------
//
// The one network call on the required path had no retry: a transient 5xx or a rate limit
// blocked the merge until somebody re-ran the job by hand (native review R4-001). The
// retry is bounded on purpose — an outage that outlives three attempts is a failure of the
// gate, said out loud, and never a green check nobody verified.

const { fetchPullRequest } = require("./fetch-pull-request.cjs");

const FETCH_ARGS = { repository: "owner/repo", number: 57 };

test("a read that works is one call, and the JSON comes back as it arrived", async () => {
  const calls = [];
  const result = await fetchPullRequest({
    ...FETCH_ARGS,
    gh: (args) => {
      calls.push(args);
      return '{"number":57}';
    },
    sleep: async () => {
      throw new Error("a successful read must not wait");
    },
  });
  assert.deepEqual(result, { ok: true, json: '{"number":57}' });
  assert.deepEqual(calls, [["api", "repos/owner/repo/pulls/57"]]);
});

test("a transient failure is retried, and the retry is the answer", async () => {
  let attempt = 0;
  const delays = [];
  const result = await fetchPullRequest({
    ...FETCH_ARGS,
    gh: () => {
      attempt += 1;
      if (attempt === 1) throw new Error("HTTP 502: Bad Gateway");
      return '{"number":57}';
    },
    sleep: async (ms) => delays.push(ms),
  });
  assert.equal(result.ok, true);
  assert.equal(attempt, 2);
  assert.deepEqual(delays, [1000]);
});

test("the retries are bounded, and an exhausted read says what failed", async () => {
  let attempt = 0;
  const delays = [];
  const result = await fetchPullRequest({
    ...FETCH_ARGS,
    gh: () => {
      attempt += 1;
      throw new Error("HTTP 502: Bad Gateway");
    },
    sleep: async (ms) => delays.push(ms),
  });
  assert.equal(result.ok, false);
  assert.equal(attempt, 3);
  assert.deepEqual(delays, [1000, 2000]);
  assert.match(result.message, /could not read pull request #57/);
  assert.match(result.message, /3 attempts/);
  // The reason travels: a gate that fails without saying why is a red run nobody can act on.
  assert.match(result.message, /HTTP 502/);
  assert.doesNotMatch(result.message, /^Error/);
});

// --- The step that runs in CI ----------------------------------------------

const FETCH = join(__dirname, "fetch-pull-request.cjs");

/** A throwaway `gh` on PATH: the step's real contract, with no network and no token. */
function withGhStub(script, run) {
  const dir = mkdtempSync(join(tmpdir(), "pr-fetch-"));
  try {
    const bin = join(dir, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "gh"), script, { mode: 0o755 });
    return run(dir, bin);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the fetch step writes the pull request to the path it is given", () => {
  const payload = JSON.stringify(API_PULL_REQUEST);
  const run = withGhStub(`#!/bin/sh\nprintf '%s\\n' '${payload}'\n`, (dir, bin) => {
    const out = join(dir, "pull-request.json");
    const result = spawnSync(process.execPath, [FETCH, "owner/repo", "57", out], {
      encoding: "utf8",
      env: { PATH: `${bin}:${process.env.PATH}` },
    });
    return { result, written: existsSync(out) ? readFileSync(out, "utf8") : null };
  });
  assert.equal(run.result.status, 0, run.result.stdout + run.result.stderr);
  assert.equal(run.written.trim(), payload);
});

test("a read that never succeeds fails the step with the gate's message, and writes nothing", () => {
  const run = withGhStub(`#!/bin/sh\necho "HTTP 502: Bad Gateway" >&2\nexit 1\n`, (dir, bin) => {
    const out = join(dir, "pull-request.json");
    const result = spawnSync(process.execPath, [FETCH, "owner/repo", "57", out], {
      encoding: "utf8",
      env: { PATH: `${bin}:${process.env.PATH}` },
    });
    return { result, written: existsSync(out) };
  });
  assert.equal(run.result.status, 1);
  // The step's stderr IS the gate's message — never `gh`'s stderr alone, never a silent pass.
  assert.match(run.result.stderr, /❌ could not read pull request #57 after 3 attempts/);
  assert.match(run.result.stderr, /HTTP 502/);
  assert.equal(run.written, false);
});
