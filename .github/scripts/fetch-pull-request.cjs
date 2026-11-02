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
 * limit knows which limit it was.
 */
class ReadFailure extends Error {
  constructor(message) {
    super(message);
    this.name = "ReadFailure";
  }
}

/**
 * What the real read says when it fails, in the words a maintainer needs to act on it.
 *
 * This runs inside `readFromApi` and nowhere else, which is the whole point: `err.code` is
 * Node's contract for `execFileSync`'s own errors, `timeoutMs` and `maxBufferBytes` are the
 * values that child was actually given, and `PROGRAM ENOENT` — a runner without `gh` — is
 * an environment fact rather than a pull request one.
 */
function describeReadFailure(err, timeoutMs, maxBufferBytes) {
  const stderr = err && err.stderr === undefined ? "" : String(err.stderr).trim();
  if (err && err.code === "ENOENT") {
    return (
      "there is no `gh` on PATH, so nothing could read the pull request: this runner is " +
      "missing the GitHub CLI, not the pull request"
    );
  }
  if (err && err.code === "ETIMEDOUT") {
    // A killed read may already have printed the useful part of the diagnosis; the deadline
    // is what ended it, not everything it said.
    const printed = stderr === "" ? "" : `; it had printed: ${stderr}`;
    return `the read timed out after ${timeoutMs}ms${printed}`;
  }
  if (err && err.code === "ENOBUFS") {
    return `the response was larger than the ${sizeOf(maxBufferBytes)} this read accepts`;
  }
  return reasonOf(err);
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
    throw new ReadFailure(describeReadFailure(err, timeoutMs, maxBufferBytes));
  }
}

/**
 * What a failed attempt says, in the words a maintainer needs to act on it.
 *
 * A failure the real read diagnosed passes through untouched. Anything else came from a read
 * that was handed in — a test stub, another client — and speaks with its own words: its
 * `err.code` is not Node's, so reading it here would invent a diagnosis about a limit this
 * process never applied.
 */
function readFailure(err) {
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
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const json = gh(args);
      // An empty body is not an answer: writing it out would hand the gate an empty file.
      if (typeof json === "string" && json.trim() !== "") return { ok: true, json };
      reason = "the API returned an empty response";
    } catch (err) {
      reason = readFailure(err);
    }
    if (attempt < attempts) {
      const delay = backoffMs * attempt;
      log(`read attempt ${attempt} of ${attempts} failed (${reason}); retrying in ${delay}ms`);
      await sleep(delay);
    }
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
  readFailure,
  sizeOf,
  ATTEMPTS,
  BACKOFF_MS,
  READ_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
};
