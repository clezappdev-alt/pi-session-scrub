#!/usr/bin/env node
// The PR ceremony gate: the three facts a machine can verify about a pull request without
// reading its diff.
//
// It exists because this repo DECLARED a ceremony and enforced none of it. The pull request
// template asks for `Closes #N`; nothing checked it. The org's `type:*` labels are the ones
// its release notes read; they were never created here. A rule declared and not enforced is
// skipped in silence, and that trains everyone to skip it — including the maintainer, who is
// the one most tempted at 2am with an urgent diff.
//
// What the gate deliberately does NOT check: the diff, the tests, the wording, or whether the
// linked issue is "approved". With one human, self-approving an issue is theatre; the human
// checks stay human, and they become gates the day a second pair of eyes exists.
//
// CommonJS on purpose: `.cjs` runs under plain `node` with no build step, no tsconfig and no
// dependency, so the gate cannot rot the way a toolchain does.

"use strict";

const { readFileSync } = require("node:fs");

/** Conventional Commits types (spec v1.0.0). */
const TYPES = ["build", "chore", "ci", "docs", "feat", "fix", "perf", "refactor", "revert", "style", "test"];

const TITLE_RE = new RegExp(`^(${TYPES.join("|")})(\\([a-z0-9._-]+\\))?!?: \\S.*$`);

/**
 * GitHub's closing keywords, plus `Refs` as the non-closing link this repo accepts.
 *
 * `\s+#\d+` and the trailing guard are the whole point: `Closes owner/repo#1` links another
 * repository (silently, and to an issue this PR cannot reach) and `Closes #12a` is not an
 * issue number. Both must fail rather than pass as a reference to this repo.
 */
const REF_RE = /\b(closes|fixes|resolves|refs)\s+#(\d+)(?![\w/])/gi;

/** Whether a title is a Conventional Commit. Returns the reason on refusal. */
function checkTitle(title) {
  const value = typeof title === "string" ? title.trim() : "";
  if (TITLE_RE.test(value)) {
    return { ok: true, message: `title: ${value}` };
  }
  return {
    ok: false,
    message:
      `title: ${JSON.stringify(value)} is not a Conventional Commit. It must be ` +
      `"type: description" or "type(scope): description", with type one of ` +
      `${TYPES.join(", ")} — lowercase, one space after the colon, no empty description.`,
  };
}

/** Every issue reference in a body, in the order it appears. */
function parseIssueRefs(body) {
  const value = typeof body === "string" ? body : "";
  const refs = [];
  for (const match of value.matchAll(REF_RE)) {
    refs.push({ number: Number(match[2]), closing: match[1].toLowerCase() !== "refs" });
  }
  return refs;
}

/**
 * The pull request's labels, from the JSON text the workflow passes or from an array.
 *
 * `PR_LABELS` is a JSON array of labels (`[{name}]`) and it is only the local fallback: a
 * string, because that is all an env var can be. The CI path passes no variables at all —
 * the workflow reads the pull request once and hands over the file (`parsePullRequest`).
 * Parsing the fallback inline made a malformed payload throw a stack trace out of the gate:
 * a red run that says nothing about the pull request, when explaining itself is the entire
 * job. A payload the gate cannot read is reported as a failure of the gate's own input,
 * which is what it is.
 *
 * @returns {{ ok: true, labels: unknown[] } | { ok: false, message: string }}
 */
function parseLabels(raw) {
  if (Array.isArray(raw)) return { ok: true, labels: raw };
  const text = typeof raw === "string" ? raw.trim() : "";
  // An absent payload is the local run: no labels to check, and the other two checks
  // still report. Refusing here would make the gate unusable off CI.
  if (text === "") return { ok: true, labels: [] };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      message:
        `PR_LABELS is not valid JSON (${reason}), so the type label cannot be read. ` +
        `PR_LABELS is the local fallback for running the gate by hand: a JSON array of ` +
        `labels such as '[{"name":"type:bug"}]'. In CI the labels come from the pull ` +
        `request file, so a malformed PR_LABELS is a local mistake, not a pull request ` +
        `one.`,
    };
  }
  if (!Array.isArray(parsed)) {
    return {
      ok: false,
      message:
        `PR_LABELS is JSON but not an array of labels (got ` +
        `${parsed === null ? "null" : typeof parsed}). It is the local fallback, so it ` +
        `must be a JSON array: '[{"name":"type:bug"}]'.`,
    };
  }
  return { ok: true, labels: parsed };
}

/** Whether the labels carry exactly one `type:*` with a value. */
function checkTypeLabels(raw) {
  const parsed = parseLabels(raw);
  if (!parsed.ok) return parsed;
  const names = parsed.labels
    .map((label) => (typeof label === "string" ? label : label && label.name))
    .filter((name) => typeof name === "string");
  const typeLabels = names.filter((name) => /^type:\S/.test(name.trim()));
  if (typeLabels.length === 1) {
    return { ok: true, message: `type label: ${typeLabels[0]}` };
  }
  return {
    ok: false,
    message:
      `labels: found ${typeLabels.length} type:* label(s) (${typeLabels.join(", ") || "none"}). ` +
      `Exactly one type:* label is required — it is the record the release notes read, so a ` +
      `checkbox in the body would only be a second writer that can disagree.`,
  };
}

/** The pull request, from the JSON the workflow's read step wrote to `PR_JSON_PATH`. */

const PULL_REQUEST_SHAPE =
  "an object with a title (string) and labels (array), the shape of " +
  "`repos/{owner}/{repo}/pulls/{n}`";

/** What a payload actually carries, for a message somebody has to read at 2am. */
function describeField(payload, field) {
  if (!(field in payload)) return `no ${field}`;
  const value = payload[field];
  if (value === null) return `${field} is null`;
  return `${field} is ${Array.isArray(value) ? "an array" : typeof value}`;
}

/** Shape one payload the gate can read, or say why it cannot be read. */
function toPullRequest(payload) {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      ok: false,
      message:
        `there is no pull request in the file: expected ${PULL_REQUEST_SHAPE}, ` +
        `got ${Array.isArray(payload) ? "an array" : String(payload)}.`,
    };
  }
  if (typeof payload.title !== "string" || !Array.isArray(payload.labels)) {
    return {
      ok: false,
      message:
        `there is no pull request in the file: expected ${PULL_REQUEST_SHAPE}, got ` +
        `${describeField(payload, "title")} and ${describeField(payload, "labels")}.`,
    };
  }
  return {
    ok: true,
    title: payload.title,
    // The API sends `null` for a body nobody wrote. That is a pull request, not a defect.
    body: typeof payload.body === "string" ? payload.body : "",
    labels: payload.labels,
  };
}

/**
 * The whole pull request, from the one read the workflow does.
 *
 * The gate used to take its three facts from three env vars with two origins: the title and
 * the body from the event payload, the labels from the API — two moments of the pull request
 * in one verdict, and a multiline body crossing the shell to get there (native review
 * R4-002). CI now reads `repos/{owner}/{repo}/pulls/{n}` once, with a bounded retry, and
 * hands this function the file. One instant, one verdict, and the body never touches a
 * shell.
 *
 * @returns {{ ok: true, title: string, body: string, labels: unknown[] } | { ok: false, message: string }}
 */
function parsePullRequest(raw) {
  if (raw === undefined || raw === null) {
    return {
      ok: false,
      message: `there is no pull request in the file: nothing was read. Expected ${PULL_REQUEST_SHAPE}.`,
    };
  }
  // A caller that already parsed the file is not forced to serialise it first.
  if (typeof raw === "object") return toPullRequest(raw);

  const text = typeof raw === "string" ? raw.trim() : "";
  if (text === "") {
    return {
      ok: false,
      message: `there is no pull request in the file: it is empty. Expected ${PULL_REQUEST_SHAPE}.`,
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      message:
        `there is no pull request in the file: it is not valid JSON (${reason}). ` +
        `Expected ${PULL_REQUEST_SHAPE}.`,
    };
  }
  return toPullRequest(parsed);
}

/** The whole gate, as a list of results. */
function checkPullRequest({ title, body, labels }) {
  const titleResult = checkTitle(title);
  const refs = parseIssueRefs(body);
  const issueResult =
    refs.length > 0
      ? {
          ok: true,
          message: `issue: ${refs
            .map((ref) => `#${ref.number} (${ref.closing ? "closes on merge" : "non-closing"})`)
            .join(", ")}`,
        }
      : {
          ok: false,
          message:
            "issue: the body links no issue. Add `Closes #<n>` (closes it on merge) or " +
            "`Refs #<n>` (non-closing). Every PR here is linked to an issue, and the issue " +
            "carries the problem the PR claims to solve.",
        };
  return [titleResult, issueResult, checkTypeLabels(labels)];
}

/**
 * Where the gate's input comes from.
 *
 * `PR_JSON_PATH` is the CI path: the file the read step wrote, one instant of the pull
 * request. Without it the gate reads `PR_TITLE`, `PR_BODY` and `PR_LABELS`, which is the
 * local run — reproducing the gate in a terminal, with no token and no network, is the
 * whole point of that path.
 */
function readPullRequestInputs() {
  const jsonPath = (process.env.PR_JSON_PATH || "").trim();
  if (jsonPath === "") {
    return {
      ok: true,
      title: process.env.PR_TITLE,
      body: process.env.PR_BODY,
      // Raw: `checkTypeLabels` parses it, so one function owns "read the labels".
      labels: process.env.PR_LABELS,
    };
  }
  let text;
  try {
    text = readFileSync(jsonPath, "utf8");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      message:
        `there is no pull request in the file: PR_JSON_PATH (${jsonPath}) cannot be read ` +
        `(${reason}). Expected ${PULL_REQUEST_SHAPE}. The workflow's read step writes it, ` +
        `and a run that cannot read its own input has not checked the pull request either way.`,
    };
  }
  return parsePullRequest(text);
}

if (require.main === module) {
  const inputs = readPullRequestInputs();
  // A payload the gate cannot read is a failure of the gate's input, reported like any
  // other result: one red run that explains itself.
  const results = inputs.ok ? checkPullRequest(inputs) : [inputs];
  for (const result of results) {
    console.log(`${result.ok ? "✅" : "❌"} ${result.message}`);
  }
  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    console.log(`\n${failed.length} ceremony check(s) failed.`);
    process.exitCode = 1;
  }
}

module.exports = {
  checkTitle,
  parseIssueRefs,
  parseLabels,
  checkTypeLabels,
  parsePullRequest,
  checkPullRequest,
  TYPES,
};
