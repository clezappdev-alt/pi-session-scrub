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

/** How many green checks the gate printed. */
function greenCount(stdout) {
  // `?? []`: a gate that prints no green at all is the regression these assertions guard
  // against, and `.match` would answer `null` — a TypeError instead of the stdout shown.
  return (stdout.match(/✅/g) ?? []).length;
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
  assert.equal(greenCount(run.stdout), 3, run.stdout);
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
  assert.equal(greenCount(run.stdout), 3, run.stdout);
});

// ---------------------------------------------------------------------------
// fetchPullRequest — the network is not allowed to decide alone
// ---------------------------------------------------------------------------
//
// The one network call on the required path had no retry: a transient 5xx or a rate limit
// blocked the merge until somebody re-ran the job by hand (native review R4-001). The
// retry is bounded on purpose — an outage that outlives three attempts is a failure of the
// gate, said out loud, and never a green check nobody verified.

const { fetchPullRequest, sizeOf, stderrPrefix } = require("./fetch-pull-request.cjs");

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

// ---------------------------------------------------------------------------
// The failures that used to be untested or misreported (issue #59)
// ---------------------------------------------------------------------------
//
// Eight advisory findings from the review of #58. Three of them are a failure the code
// could produce and no test or message named: a read with no time limit, a response over
// the size cap, an answer that is empty. One is a raw scalar reported as an empty file.

test("a raw scalar is refused as a scalar, not described as an empty file", () => {
  for (const raw of [42, true]) {
    const result = parsePullRequest(raw);
    assert.equal(result.ok, false, String(raw));
    assert.match(result.message, new RegExp(`got ${raw}`));
    // "the file is empty" would send a maintainer looking for a file that was never empty.
    assert.doesNotMatch(result.message, /is empty/, String(raw));
  }
});

test("the reason a file cannot be parsed travels in the message", () => {
  // The JSON parser's own words are the only clue about what is wrong with the file.
  const result = parsePullRequest("{");
  assert.equal(result.ok, false);
  assert.match(result.message, /not valid JSON \(.+/);
});

test("an empty answer is a failure, not an empty file", async () => {
  let attempt = 0;
  const delays = [];
  const result = await fetchPullRequest({
    ...FETCH_ARGS,
    gh: () => {
      attempt += 1;
      return "  \n";
    },
    sleep: async (ms) => delays.push(ms),
  });
  assert.equal(result.ok, false);
  assert.equal(attempt, 3);
  assert.deepEqual(delays, [1000, 2000]);
  assert.match(result.message, /empty response/);
});

test("a response bigger than the read accepts says so, not just that it failed", async () => {
  // A real child that floods stdout past a real cap: the code and the empty stderr are
  // observed here, not assumed from an error object built to match.
  const result = await withAsyncGhStub(`#!/bin/sh\nyes 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'\n`, async (_dir, bin) => {
    const saved = process.env.PATH;
    process.env.PATH = `${bin}:${saved}`;
    try {
      return await fetchPullRequest({...FETCH_ARGS, attempts: 1, maxBufferBytes: 1024});
    } finally {
      process.env.PATH = saved;
    }
  });
  assert.equal(result.ok, false);
  // The cap that applied, not the default one: 1 KiB here, 32 MiB in CI.
  assert.match(result.message, /larger than the 1024 bytes/);
  // The child process's own words are not a diagnosis a maintainer can act on.
  assert.doesNotMatch(result.message, /spawnSync/);
});

// The one that can block a merge in silence: a `gh` that never answers. The real child is
// killed for real, with a short timeout, so this is the syscall and not a simulation.
async function withAsyncGhStub(script, run) {
  const dir = mkdtempSync(join(tmpdir(), "pr-fetch-"));
  try {
    const bin = join(dir, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "gh"), script, { mode: 0o755 });
    return await run(dir, bin);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a read that hangs is killed, and the failure names how long it waited", async () => {
  const result = await withAsyncGhStub(`#!/bin/sh\nsleep 5\n`, async (_dir, bin) => {
    const saved = process.env.PATH;
    process.env.PATH = `${bin}:${saved}`;
    try {
      // One attempt, so the backoff branch is never reached: this test is about the kill.
      return await fetchPullRequest({...FETCH_ARGS, attempts: 1, timeoutMs: 200});
    } finally {
      process.env.PATH = saved;
    }
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /timed out after 200ms/);
  assert.doesNotMatch(result.message, /spawnSync/);
});

// ---------------------------------------------------------------------------
// The classifier's edges — the six suggestions of the third review of #60
// ---------------------------------------------------------------------------
//
// Each one is a sentence a maintainer has to act on, so each one is fixed where the fact
// is known: the reader that applied a limit names it, and the code namespace of an
// `execFileSync` error is never read from an error somebody else produced.

/** A throwaway directory with a `bin` that holds nothing: no `gh` anywhere on PATH. */
async function withEmptyBin(run) {
  const dir = mkdtempSync(join(tmpdir(), "pr-fetch-"));
  try {
    const bin = join(dir, "bin");
    mkdirSync(bin);
    return await run(bin);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a runner without gh says so, instead of repeating the syscall", async () => {
  const result = await withEmptyBin(async (bin) => {
    const saved = process.env.PATH;
    // Nothing to spawn: the failure is the environment, not the pull request.
    process.env.PATH = bin;
    try {
      return await fetchPullRequest({ ...FETCH_ARGS, attempts: 1 });
    } finally {
      process.env.PATH = saved;
    }
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /no `gh` on PATH/);
  // `spawnSync gh ENOENT` and a bare `ENOENT` name the syscall, not the thing to install.
  assert.doesNotMatch(result.message, /spawnSync|ENOENT/);
});

test("a killed read keeps what it had already printed", async () => {
  const result = await withAsyncGhStub(
    `#!/bin/sh\necho "waiting on the proxy handshake" >&2\nsleep 5\n`,
    async (_dir, bin) => {
      const saved = process.env.PATH;
      process.env.PATH = `${bin}:${saved}`;
      try {
        return await fetchPullRequest({ ...FETCH_ARGS, attempts: 1, timeoutMs: 200 });
      } finally {
        process.env.PATH = saved;
      }
    },
  );
  assert.equal(result.ok, false);
  assert.match(result.message, /timed out after 200ms/);
  // The deadline is not the whole story: `gh` had already said something useful.
  assert.match(result.message, /waiting on the proxy handshake/);
  assert.doesNotMatch(result.message, /spawnSync/);
});

test("an injected reader's code namespace is not read as the reader's diagnosis", async () => {
  const injected = new Error("the mirror said 429");
  // `ETIMEDOUT` is Node's word for `execFileSync`'s own timeout, nothing more: a read that
  // was handed in can carry the same code for its own reason.
  injected.code = "ETIMEDOUT";
  const result = await fetchPullRequest({
    ...FETCH_ARGS,
    attempts: 1,
    timeoutMs: 15_000,
    gh: () => {
      throw injected;
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /the mirror said 429/);
  // The configured deadline must not be invented into a failure that never waited on it.
  assert.doesNotMatch(result.message, /timed out/);
});

test("every attempt that hangs is killed, and the retries still count", async () => {
  const delays = [];
  const result = await withAsyncGhStub(`#!/bin/sh\nsleep 5\n`, async (_dir, bin) => {
    const saved = process.env.PATH;
    process.env.PATH = `${bin}:${saved}`;
    try {
      return await fetchPullRequest({
        ...FETCH_ARGS,
        attempts: 2,
        timeoutMs: 150,
        sleep: async (ms) => delays.push(ms),
      });
    } finally {
      process.env.PATH = saved;
    }
  });
  assert.equal(result.ok, false);
  // The two attempts are separate waits, and both are bounded.
  assert.deepEqual(delays, [1000]);
  assert.match(result.message, /after 2 attempts/);
  assert.match(result.message, /timed out after 150ms/);
});

test("a byte count reads as bytes below a MiB and as one decimal at or above", () => {
  // The threshold and the format are a decision, not the arithmetic's leftover.
  assert.equal(sizeOf(1), "1 bytes");
  assert.equal(sizeOf(1023), "1023 bytes");
  assert.equal(sizeOf(1024 * 1024), "1.0 MiB");
  assert.equal(sizeOf(1024 * 1024 + 1), "1.0 MiB");
  assert.equal(sizeOf(1512 * 1024), "1.5 MiB");
  assert.equal(sizeOf(32 * 1024 * 1024), "32.0 MiB");
});

// ---------------------------------------------------------------------------
// A failure that cannot fix itself is not retried
// ---------------------------------------------------------------------------
//
// The classifier knows two of these by name: a runner without `gh`, and a response above the
// size the read accepts. Neither changes between attempts, so spending the backoff on them
// only delays a red check that already knew the answer.

test("an environment failure is reported on its first attempt, not retried", async () => {
  const noGh = await withEmptyBin(async (bin) => {
    const saved = process.env.PATH;
    process.env.PATH = bin;
    try {
      const delays = [];
      const result = await fetchPullRequest({
        ...FETCH_ARGS,
        attempts: 3,
        sleep: async (ms) => delays.push(ms),
      });
      return { result, delays };
    } finally {
      process.env.PATH = saved;
    }
  });
  assert.equal(noGh.result.ok, false);
  assert.deepEqual(noGh.delays, []);
  assert.match(noGh.result.message, /on attempt 1 of 3/);
  assert.match(noGh.result.message, /no `gh` on PATH/);
  // The reader of this message must not be sent to press "re-run" for nothing.
  assert.doesNotMatch(noGh.result.message, /re-run the check/);

  const tooBig = await withAsyncGhStub(
    `#!/bin/sh\nyes 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'\n`,
    async (_dir, bin) => {
      const saved = process.env.PATH;
      process.env.PATH = `${bin}:${saved}`;
      try {
        const delays = [];
        const result = await fetchPullRequest({
          ...FETCH_ARGS,
          attempts: 3,
          maxBufferBytes: 1024,
          sleep: async (ms) => delays.push(ms),
        });
        return { result, delays };
      } finally {
        process.env.PATH = saved;
      }
    },
  );
  assert.equal(tooBig.result.ok, false);
  assert.deepEqual(tooBig.delays, []);
  assert.match(tooBig.result.message, /on attempt 1 of 3/);
  assert.match(tooBig.result.message, /larger than the 1024 bytes/);
});

// ---------------------------------------------------------------------------
// What a killed read is allowed to say
// ---------------------------------------------------------------------------

test("a stderr prefix is one line's worth, and says how much it cut", () => {
  // Absent is absent, in both of the shapes Node and a test can produce.
  assert.equal(stderrPrefix(undefined), "");
  assert.equal(stderrPrefix(null), "");
  assert.equal(stderrPrefix("  \n\t"), "");
  assert.equal(stderrPrefix("HTTP 502: Bad Gateway"), "HTTP 502: Bad Gateway");

  const many = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join("\n");
  const prefix = stderrPrefix(many);
  assert.match(prefix, /^line 1 \| line 2 \| line 3/);
  // How much was cut, not just that something was: 3 of 40 reads differently from 3 of 4.
  assert.match(prefix, /\(truncated, 3 of 40 lines\)$/);
  // The tail is what gets dropped: a maintainer needs the first error, not the last frame.
  assert.doesNotMatch(prefix, /line 40/);

  const long = "x".repeat(5000);
  assert.match(stderrPrefix(long), /\(truncated, first 400 characters\)$/);

  const both = Array.from({ length: 40 }, () => "y".repeat(300)).join("\n");
  assert.match(stderrPrefix(both), /\(truncated, 3 of 40 lines, first 400 characters\)$/);
});

test("a chatty read that hangs is reported as a prefix, not as its whole output", async () => {
  const spam = Array.from(
    { length: 40 },
    (_, i) => `line ${i + 1} of the proxy handshake`,
  ).join("\n");
  const result = await withAsyncGhStub(
    `#!/bin/sh\nprintf '%s\\n' '${spam}' >&2\nsleep 5\n`,
    async (_dir, bin) => {
      const saved = process.env.PATH;
      process.env.PATH = `${bin}:${saved}`;
      try {
        return await fetchPullRequest({ ...FETCH_ARGS, attempts: 1, timeoutMs: 200 });
      } finally {
        process.env.PATH = saved;
      }
    },
  );
  assert.equal(result.ok, false);
  assert.match(result.message, /timed out after 200ms/);
  assert.match(result.message, /line 1 of the proxy handshake/);
  // The whole dump in a required check's log is the failure mode this bounds.
  assert.match(result.message, /\(truncated, 3 of 40 lines\)/);
  assert.doesNotMatch(result.message, /line 40 of the proxy handshake/);
  assert.ok(result.message.length < 1000, `message was ${result.message.length} chars`);
});
