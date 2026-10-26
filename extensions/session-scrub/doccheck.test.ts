// doccheck tests — S2.1/S2.2 of spec-doc-reconciliation.
//
// Two automated sanitization checks the owner asked for by name:
//  1. Surface parity: the machine-readable inventory block in docs/behavior.md
//     must match, in both directions, the surfaces index.ts actually registers
//     (commands, tools, hooks).
//  2. Version anchor: the doc declares which tag it reflects, and that tag must
//     be the base tag of `git describe --tags`.
//
// Host-free: index.ts is read as source text, never imported, so no Pi host
// types and no node_modules are involved. The version-anchor test is the only
// test in the repo allowed to consult git; an unavailable git or a repo with
// no tags must skip, never fail.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const INDEX_TS = readFileSync(join(HERE, "index.ts"), "utf8");
const BEHAVIOR_MD = readFileSync(join(REPO_ROOT, "docs", "behavior.md"), "utf8");

// --- Extraction from the code ------------------------------------------------

/** Commands registered as `pi.registerCommand("<name>"`. */
function registeredCommands(source: string): string[] {
  return [...source.matchAll(/pi\.registerCommand\("([^"]+)"/g)].map((m) => m[1]);
}

/**
 * Tool names, anchored on the property indentation.
 *
 * The earlier version took the first `name:` after `registerTool`, which would
 * silently borrow the name of any other property renamed or added above it. Pi's
 * registration object is formatted with its own properties at four spaces, so
 * anchoring there turns a formatting drift into a loud failure instead of a
 * quietly wrong surface.
 */
function registeredTools(source: string): string[] {
  const starts = [...source.matchAll(/pi\.registerTool\b/g)].map((m) => m.index);
  return starts.map((start) => {
    const rest = source.slice(start);
    const match = rest.match(/\n {4}name: "([^"]+)"/);
    if (!match) {
      throw new Error(
        `registerTool call at offset ${start} has no 4-space-indented name: "<name>" property`,
      );
    }
    return match[1];
  });
}

/** Hooks registered as `pi.on("<event>"`. */
function registeredHooks(source: string): string[] {
  return [...source.matchAll(/pi\.on\("([^"]+)"/g)].map((m) => m[1]);
}

// --- Extraction from the doc -------------------------------------------------

const INVENTORY_START = "<!-- doccheck:surface:start -->";
const INVENTORY_END = "<!-- doccheck:surface:end -->";

type Surface = { kind: "command" | "tool" | "hook"; name: string };

function key(s: Surface): string {
  return `${s.kind} ${s.name}`;
}

/** The delimited machine-readable inventory block, one surface per line. */
function docInventory(doc: string): Surface[] {
  const start = doc.indexOf(INVENTORY_START);
  assert.notEqual(start, -1, "docs/behavior.md has no doccheck:surface start marker");
  const end = doc.indexOf(INVENTORY_END, start);
  assert.notEqual(end, -1, "docs/behavior.md has no doccheck:surface end marker");

  const block = doc.slice(start + INVENTORY_START.length, end);
  return block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const m = line.match(/^(command|tool|hook): (\S+)$/);
      assert.ok(
        m,
        `inventory line "${line}" does not match "<command|tool|hook>: <name>"`,
      );
      return { kind: m[1] as Surface["kind"], name: m[2] };
    });
}

// --- Version anchor ----------------------------------------------------------

/** Declared tag: first backticked token after `**Reflects:**`. */
function declaredTag(doc: string): string {
  const m = doc.match(/\*\*Reflects:\*\*[^`]*`([^`]+)`/);
  assert.ok(m, "docs/behavior.md declares no tag after **Reflects:**");
  return m[1];
}

/**
 * Result of resolving the version anchor.
 *
 * `skip` is reserved for genuine unavailability — git not installed, no tags, or
 * a checkout that is not a git repository at all (an installed package has no
 * `.git`). Any other non-zero exit is a real failure and is thrown: treating it
 * as `skip` would turn a broken gate into a silent pass, which is the failure
 * mode this whole file exists to prevent.
 */
type DescribeResult = { skip?: string; output?: string };

const UNAVAILABLE_PATTERNS = [
  /no names found/i,
  /no tags can describe/i,
  /cannot describe anything/i,
  /not a git repository/i,
];

function gitDescribe(): DescribeResult {
  const run = spawnSync("git", ["describe", "--tags"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (run.error && (run.error as NodeJS.ErrnoException).code === "ENOENT") {
    return { skip: "git is not on PATH — version anchor cannot be checked" };
  }
  if (run.error) {
    throw new Error(`could not run git describe --tags: ${run.error.message}`);
  }
  if (run.status !== 0) {
    const stderr = run.stderr.trim();
    if (UNAVAILABLE_PATTERNS.some((p) => p.test(stderr))) {
      return { skip: `version anchor unavailable: ${stderr}` };
    }
    throw new Error(`git describe --tags failed with exit ${run.status}: ${stderr}`);
  }
  return { output: run.stdout.trim() };
}

/**
 * The base tag of `git describe --tags` output.
 *
 * The tag itself may contain dashes (`v1.0.0-rc1`), so the count-and-sha suffix is
 * matched from the end: `-<n>-g<sha>`, digits and hex only. Cutting at the first
 * dash would have returned `v1.0.0` for a pre-release tag and reported a false
 * mismatch against a correct document.
 */
function baseTag(describeOutput: string): string {
  const m = describeOutput.match(/^(.*)-\d+-g[0-9a-f]+$/);
  return m ? m[1] : describeOutput;
}

// --- Source-order and schema gates -------------------------------------------

/** Source slice from `startMarker` up to the next `endMarker`. */
function sourceSlice(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `index.ts has no ${JSON.stringify(startMarker)}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(
    end,
    -1,
    `index.ts has no ${JSON.stringify(endMarker)} after ${JSON.stringify(startMarker)}`,
  );
  return source.slice(start, end);
}

// --- Tests -------------------------------------------------------------------

test("doccheck surface: docs inventory matches registered surfaces in both directions", () => {
  const registered: Surface[] = [
    ...registeredCommands(INDEX_TS).map((name) => ({ kind: "command" as const, name })),
    ...registeredTools(INDEX_TS).map((name) => ({ kind: "tool" as const, name })),
    ...registeredHooks(INDEX_TS).map((name) => ({ kind: "hook" as const, name })),
  ];
  const listed = docInventory(BEHAVIOR_MD);

  const registeredKeys = new Set(registered.map(key));
  const listedKeys = new Set(listed.map(key));

  const missing = registered.filter((s) => !listedKeys.has(key(s)));
  const extra = listed.filter((s) => !registeredKeys.has(key(s)));

  const problems: string[] = [];
  if (missing.length > 0) {
    problems.push(`registered but not listed: ${missing.map(key).join(", ")}`);
  }
  if (extra.length > 0) {
    problems.push(`listed but not registered: ${extra.map(key).join(", ")}`);
  }
  assert.ok(problems.length === 0, `doc surface inventory out of sync — ${problems.join("; ")}`);
});

test("doccheck version anchor: declared tag is the base tag of git describe --tags", (t) => {
  const declared = declaredTag(BEHAVIOR_MD);
  const describe = gitDescribe();
  if (describe.skip) {
    // A skip is reported as a skip, never as a pass: a gate that silently counts
    // "not evaluated" as "green" is worse than no gate.
    t.skip(describe.skip);
    return;
  }
  const actual = baseTag(describe.output!);
  assert.equal(
    declared,
    actual,
    `docs/behavior.md reflects ${declared} but git describe --tags anchors to ${actual}`,
  );
});

// --- NB-03 / NB-04: writers and write order (change session-scrub-handoff-promise) ---

test("NB-03: scrub_close offers CLOSE_STATES and never offers traspaso", () => {
  // `traspaso` asserts a continuation in another session, and only /scrub:handoff can
  // know that, because only the handoff creates it. The schema is built from the
  // host-free constant, so the model-facing enum and the tested set cannot drift.
  const schema = sourceSlice(INDEX_TS, "const ScrubCloseParams", "\n});");
  assert.ok(
    schema.includes("CLOSE_STATES"),
    "ScrubCloseParams must build its state union from CLOSE_STATES, not from a literal list",
  );
  assert.equal(
    schema.includes("STATE.traspaso"),
    false,
    "ScrubCloseParams must not offer traspaso: /scrub:handoff is its only writer",
  );
});

test("NB-04: the origin's traspaso is written after the destination is named", () => {
  // The promise is the last write. A cancelled newSession must write nothing, and a
  // handoff cannot announce a continuation by rename before the destination exists.
  // The end marker is the function's own closing brace at column 0: a neighbouring comment
  // would silently re-scope this gate the day it is reworded (report-only finding
  // R2-gate-marker from the second review).
  const handler = sourceSlice(INDEX_TS, "async function handleScrubHandoff(", "\n}\n");
  assert.equal(
    handler.includes("pi.setSessionName(plan.originName)"),
    false,
    "the origin must not be renamed through the live-session call: after the switch it is not the live session",
  );
  const namedDestination = handler.indexOf("appendSessionInfo(plan.destinationName)");
  const wroteOrigin = handler.indexOf("appendNameToOther(");
  assert.notEqual(namedDestination, -1, "the destination must still be named in setup");
  assert.notEqual(
    wroteOrigin,
    -1,
    "the origin's traspaso must be written through appendNameToOther (NB-08 stack)",
  );
  assert.ok(
    namedDestination < wroteOrigin,
    "the origin's promise must be written after the destination is named",
  );
});

// --- WG-03: the /scrub:init write goes through the §9.6 guard ---

test("WG-03: /scrub:init writes through appendPolicyBlock, never a bare writeFileSync", () => {
  // The handler needs a Pi host, so its behavior cannot be a unit test — this is the
  // structural net instead. `appendPolicyBlock` is where the `lstat` refusal runs, and a
  // handler that wrote directly would drop the guard with no test noticing.
  const handler = sourceSlice(INDEX_TS, "async function handleScrubInit(", "\n}\n");
  assert.equal(
    handler.includes("writeFileSync"),
    false,
    "/scrub:init must write AGENTS.md through appendPolicyBlock, not writeFileSync",
  );
  assert.ok(
    handler.includes("appendPolicyBlock("),
    "/scrub:init must write the policy block through appendPolicyBlock",
  );
});
