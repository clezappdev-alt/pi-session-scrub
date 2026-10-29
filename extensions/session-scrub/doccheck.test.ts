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

import { POLICY_TEMPLATE, planInitUpdate } from "./policy.ts";

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

test("RA-03: scrub_mark decides with writeTakesEffect and delegates its refusal text", () => {
  // The handler imports the Pi host, so the runner cannot load it; the claim is pinned as a
  // source slice. Two halves, and each is asserted where it can be asserted honestly:
  //   - WHEN it refuses is decided by name.ts:writeTakesEffect, not by asking whether the
  //     name declares a state;
  //   - WHAT it says lives in render.ts:formatMarkRefusal, where render.test.ts compares the
  //     whole message. Inlined here it could only be pinned by substring, which passes while
  //     the sentence around the fragment is rewritten (review R3-2).
  const handler = sourceSlice(INDEX_TS, "async function handleScrubMark(", "\n}\n");
  assert.match(
    handler,
    /writeTakesEffect\(/,
    "handleScrubMark must decide with name.ts:writeTakesEffect, not by asking whether the name declares a state",
  );
  assert.match(
    handler,
    /formatMarkRefusal\(/,
    "the refusal text must come from render.ts:formatMarkRefusal so it can be asserted whole",
  );
  assert.equal(
    handler.includes("The name is the record"),
    false,
    "the refusal text must not be inlined in the handler again",
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
  //
  // The gate follows the write, not the function name: the append moved into a helper so
  // `/scrub:init` and `--update` on a blockless project share it, and pinning the old
  // function would have failed while the guard was intact — or passed while it was gone.
  const handler = sourceSlice(INDEX_TS, "async function handleScrubInit(", "\n}\n");
  assert.equal(
    handler.includes("writeFileSync"),
    false,
    "/scrub:init must not write AGENTS.md itself, in either path",
  );
  const append = sourceSlice(INDEX_TS, "async function appendPlannedPolicyBlock(", "\n}\n");
  assert.equal(
    append.includes("writeFileSync"),
    false,
    "/scrub:init must write AGENTS.md through appendPolicyBlock, not writeFileSync",
  );
  assert.ok(
    append.includes("appendPolicyBlock("),
    "/scrub:init must write the policy block through appendPolicyBlock",
  );
});

// --- UD-02: the --update write goes through replacePolicyBlock ---

test("UD-02: /scrub:init --update writes through replacePolicyBlock, behind the same guard", () => {
  // Same reasoning as WG-03: `replacePolicyBlock` is where `refuseNonRegularFile` runs.
  // An update path that called `writeFileSync` directly would rewrite a symlinked
  // AGENTS.md at its target, which is the §9.6 refusal this extension already paid for.
  const update = sourceSlice(INDEX_TS, "async function handleScrubInitUpdate(", "\n}\n");
  assert.equal(
    update.includes("writeFileSync"),
    false,
    "the update path must not write AGENTS.md directly",
  );
  assert.ok(
    update.includes("replacePolicyBlock("),
    "the update path must write through replacePolicyBlock",
  );
  // A backup that is attempted after the write reports damage instead of preventing it.
  const backedUp = update.indexOf("backupFileAside(");
  const wrote = update.indexOf("replacePolicyBlock(");
  assert.notEqual(backedUp, -1, "the update must back the file up before rewriting it");
  assert.ok(
    backedUp < wrote,
    "the backup must be taken before the write, or it holds the new bytes",
  );
});

// --- R3: this repo's own policy block is a hand-maintained copy --------------
//
// The precedence table lives in two places: `POLICY_TEMPLATE` in `policy.ts` and
// this repo's own `AGENTS.md`. The agreement tests parse the template, so nothing
// asserted the copy — and a copy nothing checks is exactly how the live block went
// stale on 2026-10-27 (fixed by hand, which is what made `/scrub:init --update`
// worth building).
//
// The assertion reuses the shipped planner instead of re-implementing the
// comparison: "the block is current" is the same question `--update` answers, and a
// second definition here could disagree with the command that would fix the drift.

const AGENTS_MD = readFileSync(join(REPO_ROOT, "AGENTS.md"), "utf8");

test("R3: this repo's own policy block is what /scrub:init --update would leave", () => {
  const plan = planInitUpdate(AGENTS_MD);
  assert.equal(
    plan.kind,
    "current",
    `AGENTS.md drifted from POLICY_TEMPLATE (planner says "${plan.kind}"). ` +
      "Run `/scrub:init --update` in this repo and commit the result.",
  );
});

test("R3: the gate bites — a drifted block is not reported as current", () => {
  // A guard nobody has seen fail is not a guard. This half proves the assertion
  // above is load-bearing: without it, a planner weakened to always answer
  // "current" would leave the first test green forever.
  //
  // The fixture drifts the TEMPLATE generically — one guidance line gets a suffix —
  // rather than reverting a sentence of `AGENTS.md`. Naming a sentence would make
  // this test break the day that sentence is legitimately reworded by a future
  // `--update`, and it would then be "fixed" by editing the test instead of reading
  // the failure.
  const lines = POLICY_TEMPLATE.split("\n");
  const index = lines.findIndex((line) => line.startsWith("# ") && line.length > 4);
  assert.notEqual(index, -1, "the template must still carry guidance lines to drift");
  const drifted = [
    ...lines.slice(0, index),
    `${lines[index]} (drifted)`,
    ...lines.slice(index + 1),
  ].join("\n");
  assert.equal(planInitUpdate(drifted).kind, "update", "a drifted block must not read as current");
});

// --- Glossary citations ------------------------------------------------------
//
// `docs/glossary.md` carries the vocabulary and, with each term, the `path:line`
// that backs it. Nothing checked those, so every refactor above a cited line moved
// the evidence somewhere else and the document went on pointing at whatever landed
// there — a comment, a blank line, or a line that is no longer in the file.
//
// The bar is deliberately modest: the file must exist, the line must be inside it,
// and it must not be blank. Proving that a line still *says* what the term claims is
// a different job (a semantic check, not a citation check); this one is what stops
// the document from drifting silently.

const GLOSSARY_MD = readFileSync(join(REPO_ROOT, "docs", "glossary.md"), "utf8");

/** `<name>.ts:<line>` — the citation form the glossary uses, one or more per row. */
const CITATION_RE = /\b([A-Za-z0-9_-]+\.ts):(\d{1,6})\b/g;

type Citation = { file: string; line: number; raw: string };

function extractCitations(text: string): Citation[] {
  return [...text.matchAll(CITATION_RE)].map((m) => ({
    file: m[1],
    line: Number(m[2]),
    raw: m[0],
  }));
}

/**
 * Every citation that does not land on a real, non-blank line of the file it names.
 *
 * `readSource` returns `undefined` for a file that cannot be read, so a renamed or
 * deleted module is reported as stale instead of throwing.
 */
function staleCitations(
  citations: Citation[],
  readSource: (file: string) => string | undefined,
): string[] {
  const problems: string[] = [];
  for (const c of citations) {
    const source = readSource(c.file);
    if (source === undefined) {
      problems.push(`${c.raw} names a file that does not exist`);
      continue;
    }
    const lines = source.split("\n");
    if (c.line < 1 || c.line > lines.length) {
      problems.push(`${c.raw} is past the end of ${c.file} (${lines.length} lines)`);
      continue;
    }
    if (lines[c.line - 1].trim() === "") {
      problems.push(`${c.raw} lands on a blank line`);
    }
  }
  return problems;
}

test("glossary citations: every path:line still lands on a line of the code it names", () => {
  const citations = extractCitations(GLOSSARY_MD);
  // A parser that finds nothing reports every citation correct. Pin the premise.
  assert.ok(citations.length > 0, "docs/glossary.md cites no code at all");

  const stale = staleCitations(citations, (file) => {
    try {
      return readFileSync(join(HERE, file), "utf8");
    } catch {
      return undefined;
    }
  });

  assert.deepEqual(stale, [], `stale citations in docs/glossary.md — ${stale.join("; ")}`);
});

test("the citation check catches a missing file, a line past the end, and a blank line", () => {
  // The three ways a citation rots, each asserted so the check above cannot pass by
  // being vacuous.
  const sources = new Map([
    ["real.ts", "one\ntwo\n\nfour"],
  ]);
  const read = (file: string) => sources.get(file);
  const at = (file: string, line: number): Citation => ({ file, line, raw: `${file}:${line}` });

  assert.deepEqual(staleCitations([at("real.ts", 1), at("real.ts", 4)], read), []);
  assert.deepEqual(staleCitations([at("gone.ts", 1)], read), ["gone.ts:1 names a file that does not exist"]);
  assert.deepEqual(staleCitations([at("real.ts", 9)], read), ["real.ts:9 is past the end of real.ts (4 lines)"]);
  assert.deepEqual(staleCitations([at("real.ts", 3)], read), ["real.ts:3 lands on a blank line"]);
});

// --- Glossary citations II: the symbol must sit on the line it cites --------
//
// The check above proves a citation lands on a real, non-blank line. It does not
// prove the line says what the term claims, and that gap hid ten rotted citations
// at once: the row said `` `formatAuditLine`, `index.ts:216` `` and line 216 was
// `}`. Green suite, wrong document, for however long it had been wrong.
//
// The bar is still modest: when the document writes `` `symbol`, `file.ts:line` `` —
// the form it uses for most terms — the cited line must contain that symbol.
// Citations with no symbol keep the existence-only check above. That is the cheap
// half of the semantic question, and it is the half the drift actually hit.

/** `` `symbol`, `file.ts:line` `` — the symbol-bearing citation form. */
const SYMBOL_CITATION_RE = /`([A-Za-z_][A-Za-z0-9_]*)`,\s*`([A-Za-z0-9_-]+\.ts):(\d{1,6})\b/g;

type SymbolCitation = { symbol: string; file: string; line: number; raw: string };

function extractSymbolCitations(text: string): SymbolCitation[] {
  return [...text.matchAll(SYMBOL_CITATION_RE)].map((m) => ({
    symbol: m[1],
    file: m[2],
    line: Number(m[3]),
    raw: m[0],
  }));
}

/**
 * Symbol citations whose cited line does not contain the symbol they name.
 *
 * A file that cannot be read, or a line past the end, is left to the existence
 * check above instead of being reported twice.
 */
function danglingSymbols(
  citations: SymbolCitation[],
  readSource: (file: string) => string | undefined,
): string[] {
  const problems: string[] = [];
  for (const c of citations) {
    const source = readSource(c.file);
    if (source === undefined) continue;
    const line = source.split("\n")[c.line - 1];
    if (line === undefined) continue;
    if (!line.includes(c.symbol)) {
      problems.push(
        `${c.symbol} is cited at ${c.file}:${c.line} but that line says: ${line.trim().slice(0, 70)}`,
      );
    }
  }
  return problems;
}

test("glossary citations: a cited line contains the symbol it is cited for", () => {
  const citations = extractSymbolCitations(GLOSSARY_MD);
  // A parser that finds nothing reports every citation correct. Pin the premise.
  assert.ok(citations.length > 0, "no symbol-bearing citation was parsed in docs/glossary.md");

  const dangling = danglingSymbols(citations, (file) => {
    try {
      return readFileSync(join(HERE, file), "utf8");
    } catch {
      return undefined;
    }
  });

  assert.deepEqual(dangling, [], `dangling citations in docs/glossary.md — ${dangling.join("; ")}`);
});

test("the symbol check catches a line that no longer names the symbol", () => {
  // Both directions, so the check above cannot pass by rejecting everything.
  const sources = new Map([["real.ts", "export function kept() {}\n}"]]);
  const read = (file: string) => sources.get(file);
  const at = (symbol: string, line: number): SymbolCitation => ({
    symbol,
    file: "real.ts",
    line,
    raw: `\`${symbol}\`, \`real.ts:${line}\``,
  });

  assert.deepEqual(danglingSymbols([at("kept", 1)], read), []);
  assert.equal(danglingSymbols([at("kept", 2)], read).length, 1);
});

// --- Glossary citations III: a bare number must be self-describing -----------
//
// The two checks above still leave one hole, and the hole is where the drift
// actually happened. `SYMBOL_CITATION_RE` matches one written form —
// `` `sym`, `file.ts:N` `` — so a citation written `` `SYM` (`file.ts:N`) `` or a
// table cell that lists bare numbers is checked only for existing on a non-blank
// line. `TRIAGE_GRADE` was cited four times at `index.ts:809` while it is declared
// at 945, and the whole `kind` table cited `classify.ts:41`–`47` — six consecutive
// lines of a doc comment — for six different kinds, because `CLASS_KIND` is
// declared at 71. Every one of those passed.
//
// The rule added here is the cheapest one that is still checkable: a citation is
// either **token-bearing** (some backticked token precedes it on its line, and the
// cited line contains that token) or it points at a **declaration** (the line says
// `const TRIAGE_GRADE = {`, which is a fact a test can verify without a second
// copy of the line numbers). Anything else must name a token, and naming one is
// what turns an unverifiable number into a claim.
//
// What this does NOT prove, stated because the gate must not oversell itself: a
// declaration proves the number will not move, not that it is the *right*
// declaration. §3 of the glossary cited `RETENTION_VERDICTS` for a section about
// `CANDIDATE_REASON` and passed. The token-bearing form is the one that proves
// relevance; the declaration form only buys stability.

/** Every backticked span on a line, in order. */
const SPAN_RE = /`([^`]*)`/g;

/** A span that *is* a citation, and therefore cannot serve as another one's token. */
const CITATION_SPAN_RE = /^[A-Za-z0-9_-]+\.ts:\d{1,6}(?:-\d{1,6})?$/;

/** `formatDigestPack(pack, …)` -> `formatDigestPack`: the identifier a span opens with. */
const LEADING_IDENT_RE = /^([A-Za-z_][A-Za-z0-9_]*)/;

/** A line that declares the symbol it names. The declaration IS the anchor. */
const DECLARATION_RE =
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class|type|interface|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/;

type AnchoredCitation = {
  file: string;
  line: number;
  /** The token the document offers as the citation's subject, when it names one. */
  token: string | undefined;
  raw: string;
};

/**
 * The citations on one document line, each paired with the token that precedes it.
 *
 * Pairing is positional on purpose: it needs no per-form regex, so the three forms
 * the glossary actually writes (`\`sym\`, \`f:N\``, `\`SYM\` (\`f:N\`)`,
 * `\`call(…)\`, \`f:N\``) are all covered by one rule.
 */
function anchoredCitations(line: string): AnchoredCitation[] {
  const spans = [...line.matchAll(SPAN_RE)].map((m) => ({ content: m[1], index: m.index ?? 0 }));
  const citations: AnchoredCitation[] = [];
  for (const span of spans) {
    const citation = /^([A-Za-z0-9_-]+\.ts):(\d{1,6})(?:-(\d{1,6}))?$/.exec(span.content);
    if (citation === null) continue;
    const before = spans.filter((s) => s.index < span.index && !CITATION_SPAN_RE.test(s.content));
    const nearest = before[before.length - 1];
    citations.push({
      file: citation[1],
      line: Number(citation[2]),
      token: nearest === undefined ? undefined : (LEADING_IDENT_RE.exec(nearest.content)?.[1] ?? undefined),
      raw: `\`${span.content}\``,
    });
  }
  return citations;
}

/**
 * Citations that are neither token-bearing nor anchored to a declaration.
 *
 * A file that cannot be read, or a line past the end, is left to the existence
 * check above instead of being reported twice.
 */
function unanchoredCitations(
  line: string,
  readSource: (file: string) => string | undefined,
): string[] {
  const problems: string[] = [];
  for (const c of anchoredCitations(line)) {
    const source = readSource(c.file);
    if (source === undefined) continue;
    const text = source.split("\n")[c.line - 1];
    if (text === undefined) continue;
    if (c.token !== undefined && text.includes(c.token)) continue;
    const declares = DECLARATION_RE.exec(text)?.[1];
    if (declares !== undefined) continue;
    problems.push(
      `${c.raw} at ${c.file}:${c.line} is not anchored — ` +
        (c.token === undefined
          ? "no token precedes it"
          : `its token \`${c.token}\` does not appear on that line`) +
        `, and the line declares nothing: ${text.trim().slice(0, 70)}`,
    );
  }
  return problems;
}

const readGlossarySource = (file: string): string | undefined => {
  try {
    return readFileSync(join(HERE, file), "utf8");
  } catch {
    return undefined;
  }
};

test("glossary citations: every citation names a token its line contains, or points at a declaration", () => {
  const problems = GLOSSARY_MD.split("\n").flatMap((line) => unanchoredCitations(line, readGlossarySource));
  // A checker that finds nothing to check reports every document correct. Pin the premise.
  const checked = GLOSSARY_MD.split("\n").flatMap(anchoredCitations).length;
  assert.ok(checked > 0, "no citation was parsed in docs/glossary.md");
  assert.deepEqual(
    problems,
    [],
    `unanchored citations in docs/glossary.md — ${problems.join("; ")}`,
  );
});

test("the anchoring check catches a bare number and a token its line does not contain", () => {
  const sources = new Map([
    ["real.ts", "const DECLARED = 1;\nusage(DECLARED);\n// prose\n"],
  ]);
  const read = (file: string) => sources.get(file);

  // Declared there: the line is its own anchor.
  assert.deepEqual(unanchoredCitations("`real.ts:1`", read), []);
  // A token the line contains: anchored.
  assert.deepEqual(unanchoredCitations("`DECLARED` (`real.ts:2`)", read), []);
  // A token the line does not contain, and no declaration: reported.
  assert.equal(unanchoredCitations("`DECLARED` (`real.ts:3`)", read).length, 1);
  // No token at all, and no declaration: reported.
  assert.equal(unanchoredCitations("| row | `real.ts:3` |", read).length, 1);
});

// --- README anchor ------------------------------------------------------------
//
// `docs/behavior.md` declares the tag it reflects and the test above compares it
// against `git describe --tags`. The README makes the same promise in prose, and
// nothing checked it: it said `v0.4.2` while the newest tag was `v0.5.1`, and the
// suite was green the whole time. A reader installing from that line installs the
// wrong release.
//
// The README names a version twice — the anchor and the `pi install` line — and a
// release has to move both. Comparing them to each other turns one forgotten line
// into a failure instead of a second silent claim.

const README_MD = readFileSync(join(REPO_ROOT, "README.md"), "utf8");

/** The tag the README says it is anchored to. `undefined` when the line is gone. */
function readmeAnchorTag(readme: string): string | undefined {
  return readme.match(/>\s*Anchored to the released tag `([^`]+)`/)?.[1];
}

/** The tag the README tells a reader to install. `undefined` when the line is gone. */
function readmeInstallTag(readme: string): string | undefined {
  return readme.match(/pi install git:github\.com\/\S*?@(\S+)/)?.[1];
}

/**
 * The mismatch between a document's declared tag and the tag git describes, or
 * `undefined` when they agree.
 *
 * Takes the describe output rather than a tag, so a test can assert the failure
 * without creating a tag: that is the only way to prove the check would catch the
 * drift it exists to catch.
 */
function anchorMismatch(declared: string, describeOutput: string): string | undefined {
  const actual = baseTag(describeOutput);
  return declared === actual
    ? undefined
    : `the document declares ${declared}, but git describe anchors to ${actual}`;
}

test("the anchor check fails a declared tag that disagree with the tag git describes", () => {
  assert.equal(anchorMismatch("v0.6.0", "v0.6.0"), undefined);
  assert.equal(anchorMismatch("v0.6.0", "v0.6.0-3-gabc1234"), undefined, "commits after the tag are not drift");
  assert.match(
    anchorMismatch("v0.4.2", "v0.5.1-2-gabc1234") ?? "",
    /declares v0\.4\.2, but git describe anchors to v0\.5\.1/,
  );
});

test("README anchor: the declared tag, the install tag and git describe agree", (t) => {
  const declared = readmeAnchorTag(README_MD);
  assert.ok(declared, "README.md has no `> Anchored to the released tag ...` line");

  const install = readmeInstallTag(README_MD);
  assert.ok(install, "README.md has no `pi install git:github.com/…@<tag>` line");
  assert.equal(
    install,
    declared,
    `README.md tells a reader to install ${install} while declaring it reflects ${declared}`,
  );

  const describe = gitDescribe();
  if (describe.skip) {
    t.skip(describe.skip);
    return;
  }
  const mismatch = anchorMismatch(declared!, describe.output!);
  assert.equal(mismatch, undefined, `README.md: ${mismatch}`);
});

// --- Session discovery must honour the resolved session dir ------------------
//
// `SessionManager.list(cwd)` without the second argument reads the default
// directory (`~/.pi/agent/sessions/--<encoded-cwd>--`), while the trash and backup
// roots derive from `ctx.sessionManager.getSessionDir()`. Two roots, one command:
// the extension lists one directory and moves files out of another. The live session
// still shows up (it comes from `ctx`, not disk), so the symptom reads as "1
// session" instead of "0" — found in the v0.6.0 manual trial, invisible to a
// host-free unit test because `SessionManager` is absent there, not simulated.

/** The argument list of every `needle(` call, with balanced parentheses. */
function callArguments(source: string, needle: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const at = source.indexOf(needle, from);
    if (at === -1) return out;
    const open = at + needle.length - 1;
    let depth = 0;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === "(") depth += 1;
      else if (source[i] === ")") {
        depth -= 1;
        if (depth === 0) {
          out.push(source.slice(open + 1, i));
          break;
        }
      }
    }
    from = at + needle.length;
  }
}

test("session discovery asks the session manager for its own directory", () => {
  const calls = callArguments(INDEX_TS, "SessionManager.list");
  assert.ok(calls.length > 0, "index.ts has no SessionManager.list call at all");
  const withoutDir = calls.filter((args) => !args.includes("getSessionDir"));
  assert.deepEqual(
    withoutDir,
    [],
    `SessionManager.list called without the resolved session dir — ${withoutDir.map((a) => `list(${a.trim()})`).join("; ")}`,
  );
});

test("version anchor: the commit the tag names declares that version", (t) => {
  // The anchor test above compares a *document* against `git describe --tags`. It
  // cannot see whether the tag itself is honest. It was not: `v0.6.1` was created
  // before its release commit, so the tagged tree still declared `0.6.0` and
  // `git describe` agreed with the document while the tag named the wrong commit.
  // §11 asks for version and tag to agree *at the tag*, so this checks the tree the
  // tag points at, not the working one.
  const describe = gitDescribe();
  if (describe.skip) {
    t.skip(describe.skip);
    return;
  }
  const tag = baseTag(describe.output!);

  const run = spawnSync("git", ["show", `${tag}:package.json`], { cwd: REPO_ROOT, encoding: "utf8" });
  if (run.error) throw new Error(`could not read package.json at ${tag}: ${run.error.message}`);
  if (run.status !== 0) {
    t.skip(`cannot read package.json at ${tag}: ${run.stderr.trim()}`);
    return;
  }

  const declared = (JSON.parse(run.stdout) as { version?: unknown }).version;
  assert.equal(typeof declared, "string", `${tag}:package.json has no version field`);
  assert.equal(
    `v${declared}`,
    tag,
    `the commit ${tag} points at declares version ${declared}; version and tag must agree at the tag itself`,
  );
});
