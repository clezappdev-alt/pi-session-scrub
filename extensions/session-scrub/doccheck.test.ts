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
 * Tools registered as `pi.registerTool<...>({ ... name: "<name>"` — the tool
 * name is the first `name:` property inside each registerTool block, so the
 * first match after each call's start is taken.
 */
function registeredTools(source: string): string[] {
  const starts = [...source.matchAll(/pi\.registerTool\b/g)].map((m) => m.index);
  return starts.map((start) => {
    const rest = source.slice(start);
    const match = rest.match(/name:\s*"([^"]+)"/);
    if (!match) {
      throw new Error(
        `registerTool call at offset ${start} has no name: "<name>" property`,
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
 * Result of resolving the version anchor. `skip` is set when git or tags are
 * unavailable — an unavailable tool must never fail the suite.
 */
type DescribeResult = { skip?: string; output?: string };

function gitDescribe(): DescribeResult {
  const run = spawnSync("git", ["describe", "--tags"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (run.error && (run.error as NodeJS.ErrnoException).code === "ENOENT") {
    return { skip: "git is not on PATH — version anchor cannot be checked" };
  }
  if (run.status !== 0) {
    // "fatal: No names found for..." — a repo with no tags.
    if (/no names found/i.test(run.stderr)) {
      return { skip: "repo has no tags — version anchor cannot be checked" };
    }
    return { skip: `git describe --tags failed: ${run.stderr.trim()}` };
  }
  return { output: run.stdout.trim() };
}

/** The base tag of `git describe --tags` output (`v0.3.0-59-ged2fb6a` → `v0.3.0`). */
function baseTag(describeOutput: string): string {
  const m = describeOutput.match(/^([^-]+)-\d+-g[0-9a-f]+$/);
  return m ? m[1] : describeOutput;
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

test("doccheck version anchor: declared tag is the base tag of git describe --tags", () => {
  const declared = declaredTag(BEHAVIOR_MD);
  const describe = gitDescribe();
  if (describe.skip) {
    // Skips carry an explicit reason in the test output.
    assert.ok(true, `skipped: ${describe.skip}`);
    return;
  }
  const actual = baseTag(describe.output!);
  assert.equal(
    declared,
    actual,
    `docs/behavior.md reflects ${declared} but git describe --tags anchors to ${actual}`,
  );
});
