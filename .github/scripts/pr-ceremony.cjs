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

/** Whether the labels carry exactly one `type:*` with a value. */
function checkTypeLabels(labels) {
  const names = (Array.isArray(labels) ? labels : [])
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

if (require.main === module) {
  const results = checkPullRequest({
    title: process.env.PR_TITLE,
    body: process.env.PR_BODY,
    labels: JSON.parse(process.env.PR_LABELS || "[]"),
  });
  for (const result of results) {
    console.log(`${result.ok ? "✅" : "❌"} ${result.message}`);
  }
  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    console.log(`\n${failed.length} ceremony check(s) failed.`);
    process.exitCode = 1;
  }
}

module.exports = { checkTitle, parseIssueRefs, checkTypeLabels, checkPullRequest, TYPES };
