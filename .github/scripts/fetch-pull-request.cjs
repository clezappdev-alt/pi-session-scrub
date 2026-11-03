#!/usr/bin/env node
// One read of the pull request, from the API, with a bounded retry.
//
// Why this file exists: the gate used to read the labels inline, in the workflow's shell,
// from `repos/{repo}/issues/{n}/labels`, while the title and the body came from the event
// payload. Two moments of the pull request in one verdict, and that single network call had
// no retry: a transient 5xx or a rate limit failed a required check and the merge waited for
// a human to press "re-run" (native review R4-001, R4-002).
//
// The step reads `repos/{owner}/{repo}/pulls/{n}` once and writes the JSON to a file. The
// gate reads that file, so it decides on one instant of the pull request — and the body,
// which is multiline by nature, never crosses a shell to get there.
//
// Three attempts, one and two seconds apart. Bounded on purpose: an outage that outlives
// three attempts is a failure of the check, said out loud, and never a green run — a gate
// that passes when it could not read its input enforces nothing.
//
// CommonJS for the same reason as the gate: plain `node`, no build step, no dependency.

"use strict";

const { execFileSync } = require("node:child_process");
const { writeFileSync } = require("node:fs");

// The gate is the pure half of this pair; `reasonOf` lives there so a failure reads the same
// whether the gate or the read produced it. It is imported, not re-exported: one home for the
// wording, so an edit here cannot silently diverge from the definition.
const { reasonOf } = require("./pr-ceremony.cjs");

/** Attempts in total, and the wait before attempt n+1 (n × this). */
const ATTEMPTS = 3;
const BACKOFF_MS = 1000;

/**
 * How long one attempt may take before it is killed.
 *
 * Without it, a `gh` that never answers — a black-holed socket, a stalled proxy — keeps this
 * required check pending until the job-level timeout, with no diagnostic. Fifteen seconds is
 * not a guess: three reads of one pull request on this repository measured 0.66s, 0.67s and
 * 0.74s end to end, so the cap sits about twenty times above the latency it must tolerate. A
 * read that needs more than fifteen seconds is not going to succeed on the next two either.
 */
const READ_TIMEOUT_MS = 15_000;

/**
 * The largest response one pull request may be.
 *
 * This is a real limit on what the gate accepts, not boilerplate: a body over the cap fails
 * the read, so the number is named and reported instead of surfacing as a buffer error from
 * the child process.
 */
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

/**
 * A byte count the way a message should say it: bytes below a MiB, one decimal of a MiB at
 * or above it.
 *
 * Both the threshold and the format are chosen here, once. The arithmetic's own leftovers
 * are neither: an unrounded quotient prints fifteen digits of a number nobody can act on,
 * and a rounded whole MiB reports 1.4 MiB as "1 MiB". One decimal is wrong by less than the
 * reader cares about and never needs a second look.
 */
function sizeOf(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MiB` : `${bytes} bytes`;
}

/**
 * A failed read whose sentence is already composed, because only the layer that applied the
 * limit knows which limit it was — and, with it, whether trying again could say anything new.
 */
class ReadFailure extends Error {
  constructor(message, { retryable = true } = {}) {
    super(message);
    this.name = "ReadFailure";
    this.retryable = retryable;
  }
}

/**
 * The useful head of a killed read's stderr, as one line — or `""` when it printed nothing.
 *
 * Keeping the stderr at all was the point of the previous change; keeping all of it is not.
 * A hung child can have printed anything up to the buffer it was handed, and this sentence
 * goes to a required check's log, so the debug detail is bounded on purpose: three lines is
 * an error and its context, and 400 characters fits a log viewer without a second look. Both
 * `undefined` and `null` mean "nothing": a child that never wrote has no stderr to quote.
 *
 * The marker says how much was dropped, not just that something was: "3 of 40 lines" and
 * "first 400 characters" are the two ways this cuts, and a reader who knows which one fired
 * can tell a child that printed one line too many from one that buried the diagnosis.
 */
const STDERR_PREFIX_LINES = 3;
const STDERR_PREFIX_CHARS = 400;

function stderrPrefix(stderr) {
  const text = String(stderr ?? "").trim();
  if (text === "") return "";
  const lines = text.split(/\r?\n/);
  const kept = lines.slice(0, STDERR_PREFIX_LINES).join(" | ").trim();
  const cut = [];
  if (lines.length > STDERR_PREFIX_LINES) cut.push(`${STDERR_PREFIX_LINES} of ${lines.length} lines`);
  if (kept.length > STDERR_PREFIX_CHARS) cut.push(`first ${STDERR_PREFIX_CHARS} characters`);
  const head =
    kept.length > STDERR_PREFIX_CHARS ? kept.slice(0, STDERR_PREFIX_CHARS).trimEnd() : kept;
  return cut.length === 0 ? head : `${head} (truncated, ${cut.join(", ")})`;
}

/**
 * What the real read says when it fails, and whether trying again could say anything else.
 *
 * This runs inside `readFromApi` and nowhere else, which is the whole point: `err.code` is
 * Node's contract for `execFileSync`'s own errors, `timeoutMs` and `maxBufferBytes` are the
 * values that child was actually given, and `PROGRAM ENOENT` — a runner without `gh` — is
 * an environment fact rather than a pull request one.
 *
 * Two of these facts cannot change between attempts: the runner either has the binary or it
 * does not, and a response over the cap will be over the cap next time. Those are marked
 * unrecoverable, so the retry loop spends no backoff on them.
 */
function describeReadFailure(err, timeoutMs, maxBufferBytes) {
  // One guarded read of the code, and then a field per branch: the guards and the extraction
  // say the same thing, so nobody has to wonder whether a null was ever possible here.
  const code = err === null || err === undefined ? undefined : err.code;
  if (code === "ENOENT") {
    return {
      retryable: false,
      message:
        "there is no `gh` on PATH, so nothing could read the pull request: this runner is " +
        "missing the GitHub CLI, not the pull request",
    };
  }
  if (code === "ETIMEDOUT") {
    // A killed read may already have printed the useful part of the diagnosis; the deadline
    // is what ended it, not everything it said — and not everything is worth carrying.
    const printed = stderrPrefix(err.stderr);
    return {
      retryable: true,
      message:
        `the read timed out after ${timeoutMs}ms` +
        (printed === "" ? "" : `; it had printed: ${printed}`),
    };
  }
  if (code === "ENOBUFS") {
    return {
      retryable: false,
      message: `the response was larger than the ${sizeOf(maxBufferBytes)} this read accepts`,
    };
  }
  return { retryable: true, message: reasonOf(err) };
}

/** The real read: `gh` with the job's token, from the environment. */
function readFromApi(args, timeoutMs, maxBufferBytes) {
  try {
    return execFileSync("gh", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: maxBufferBytes,
      timeout: timeoutMs,
    });
  } catch (err) {
    const { message, retryable } = describeReadFailure(err, timeoutMs, maxBufferBytes);
    throw new ReadFailure(message, { retryable });
  }
}

/**
 * What a failed attempt says, in the words a maintainer needs to act on it.
 *
 * A failure the real read diagnosed passes through untouched. Anything else came from a read
 * that was handed in — a test stub, another client — and speaks with its own words: its
 * `err.code` is not Node's, so reading it here would invent a diagnosis about a limit this
 * process never applied. The name says what it returns, because the classifier ten lines
 * above is the other thing a search for "readFailure" used to find.
 */
function readFailureMessage(err) {
  if (err instanceof ReadFailure) return err.message;
  return reasonOf(err);
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Read the pull request, retrying a bounded number of times.
 *
 * @param {object} options
 * @param {string} options.repository `owner/repo`, as `$GITHUB_REPOSITORY` has it.
 * @param {string|number} options.number The pull request number.
 * @param {number} [options.timeoutMs] How long one attempt may take before it is killed.
 * @param {number} [options.maxBufferBytes] How large one answer may be.
 *   Both bound the default reader, and only the default reader names them: an injected `gh`
 *   owns its own limits and its own failures, so its error is reported in its own words.
 * @param {(args: string[]) => string} [options.gh] The read, injected so it can be tested.
 * @returns {Promise<{ ok: true, json: string } | { ok: false, message: string }>}
 */
async function fetchPullRequest({
  repository,
  number,
  timeoutMs = READ_TIMEOUT_MS,
  maxBufferBytes = MAX_RESPONSE_BYTES,
  gh = (args) => readFromApi(args, timeoutMs, maxBufferBytes),
  attempts = ATTEMPTS,
  backoffMs = BACKOFF_MS,
  sleep = defaultSleep,
  log = () => {},
}) {
  const args = ["api", `repos/${repository}/pulls/${number}`];
  let reason = "no attempt was made";
  let attempt = 0;
  let unrecoverable = false;
  for (attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const json = gh(args);
      // An empty body is not an answer: writing it out would hand the gate an empty file.
      if (typeof json === "string" && json.trim() !== "") return { ok: true, json };
      reason = "the API returned an empty response";
    } catch (err) {
      reason = readFailureMessage(err);
      if (err instanceof ReadFailure && !err.retryable) {
        unrecoverable = true;
        break;
      }
    }
    if (attempt < attempts) {
      const delay = backoffMs * attempt;
      log(`read attempt ${attempt} of ${attempts} failed (${reason}); retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
  if (unrecoverable) {
    return {
      ok: false,
      message:
        `could not read pull request #${number} on attempt ${attempt} of ${attempts} ` +
        `(${reason}). Nothing about this changes between tries, so it was not retried: ` +
        `re-running the check changes nothing either, until the runner does. The pull ` +
        `request is not what failed here.`,
    };
  }
  return {
    ok: false,
    message:
      `could not read pull request #${number} after ${attempts} attempts (${reason}). ` +
      `This is the network or the API, not a pull request: re-run the check. Reading the ` +
      `pull request is how the gate sees it at all, so a read that failed cannot be ` +
      `reported as a pass.`,
  };
}

/**
 * `node fetch-pull-request.cjs <owner/repo> <number> <output-file>`
 *
 * Exit 0 when the file was written. Exit 1 when the pull request could not be read, **or**
 * when it was read but the file could not be written — either way the gate has nothing to
 * check. Exit 2 for misuse (a missing argument), which is a broken call, not a failed read.
 * The caller (the workflow step) is the only thing that has to know.
 */
async function main(argv) {
  const [repository, number, output] = argv;
  if (!repository || !number || !output) {
    console.error(
      "usage: node .github/scripts/fetch-pull-request.cjs <owner/repo> <number> <output-file>",
    );
    return 2;
  }
  const result = await fetchPullRequest({ repository, number, log: (line) => console.log(line) });
  if (!result.ok) {
    console.error(`❌ ${result.message}`);
    return 1;
  }
  try {
    writeFileSync(output, result.json);
  } catch (err) {
    console.error(
      `❌ read pull request #${number} but could not write it to ${output} ` +
        `(${reasonOf(err)}). Without that file the gate has nothing to check.`,
    );
    return 1;
  }
  console.log(`✅ read pull request ${repository}#${number} into ${output}`);
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(`❌ ${reasonOf(err)}`);
      process.exitCode = 1;
    },
  );
}

module.exports = {
  fetchPullRequest,
  readFailureMessage,
  sizeOf,
  stderrPrefix,
  ATTEMPTS,
  BACKOFF_MS,
  READ_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  STDERR_PREFIX_LINES,
  STDERR_PREFIX_CHARS,
};
