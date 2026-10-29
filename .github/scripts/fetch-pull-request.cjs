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

/** Attempts in total, and the wait before attempt n+1 (n × this). */
const ATTEMPTS = 3;
const BACKOFF_MS = 1000;

/** What a failed read said, in the most useful words available. */
function reasonOf(err) {
  if (err instanceof Error) {
    // `execFileSync` puts the command's own stderr on the error: `gh` says HTTP 502 there,
    // and that sentence is the only part a maintainer can act on.
    const stderr = err.stderr === undefined ? "" : String(err.stderr).trim();
    if (stderr !== "") return stderr;
    return err.message;
  }
  return String(err);
}

/** The real read: `gh` with the job's token, from the environment. */
function readFromApi(args) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
  });
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
 * @param {(args: string[]) => string} [options.gh] The read, injected so it can be tested.
 * @returns {Promise<{ ok: true, json: string } | { ok: false, message: string }>}
 */
async function fetchPullRequest({
  repository,
  number,
  gh = readFromApi,
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
      reason = reasonOf(err);
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
 * One exit code per outcome: 0 when the file was written, 1 when the read failed, 2 for
 * misuse. The caller (the workflow step) is the only thing that has to know.
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

module.exports = { fetchPullRequest, reasonOf, ATTEMPTS, BACKOFF_MS };
