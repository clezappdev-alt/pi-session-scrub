// Tests for classify.ts — the pure session classification predicate.
//
// Round 1 (characterization) pinned today's behavior for everything not scheduled to
// change. Round 2 adds NM-04 and NM-05.
//
// NM-04: an explicit verdict short-circuits the empty and age checks.
// NM-05: conversation turns, not size or messageCount, floor deletion candidacy.
//
// Types are erased by the type stripper, so a "required" parameter can still arrive
// undefined at runtime. Because this predicate decides what gets deleted, an unknown
// turn count must fail toward protection. That case is tested explicitly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SessionInfo } from "@earendil-works/pi-coding-agent";

import { classifySession, countConversationTurns, samePath, VERDICTS } from "./classify.ts";

const NOW = Date.now();
const FRESH = new Date(NOW - 60_000);
const OLD = new Date(NOW - 30 * 24 * 60 * 60 * 1000);

const NOT_LIVE = {};
const NO_VERDICT = undefined;
const NOT_EPHEMERAL = false;

function session(overrides: {
  path?: string;
  id?: string;
  name?: string;
  messageCount?: number;
  firstMessage?: string;
  created?: Date;
  modified?: Date;
}): SessionInfo {
  return {
    path: "/sessions/abc.jsonl",
    id: "abcdef0123456789",
    cwd: "/projects/demo",
    created: FRESH,
    modified: FRESH,
    messageCount: 4,
    firstMessage: "hello there",
    allMessagesText: "hello there",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Live
// ---------------------------------------------------------------------------

test("live session matched by path classifies as live", () => {
  const result = classifySession(
    session({}),
    { path: "/sessions/abc.jsonl" },
    NO_VERDICT,
    NOT_EPHEMERAL,
    2,
  );
  assert.deepEqual(result, { kind: "live" });
});

test("live session matched by id (no path) classifies as live", () => {
  const result = classifySession(
    session({}),
    { id: "abcdef0123456789" },
    NO_VERDICT,
    NOT_EPHEMERAL,
    2,
  );
  assert.deepEqual(result, { kind: "live" });
});

// ---------------------------------------------------------------------------
// Named
// ---------------------------------------------------------------------------

test("named session is named-protected and surfaces its name", () => {
  const result = classifySession(
    session({ name: "cleanup-slices" }),
    NOT_LIVE,
    NO_VERDICT,
    NOT_EPHEMERAL,
    2,
  );
  assert.deepEqual(result, {
    kind: "named-protected",
    name: "cleanup-slices",
    verdict: undefined,
  });
});

test("named session with trash verdict is an explicit-trash candidate", () => {
  const result = classifySession(
    session({ name: "cleanup-slices" }),
    NOT_LIVE,
    VERDICTS.trash,
    NOT_EPHEMERAL,
    2,
  );
  assert.deepEqual(result, {
    kind: "candidate",
    reason: "explicit-trash",
    verdict: VERDICTS.trash,
  });
});

// ---------------------------------------------------------------------------
// Explicit verdicts that mean "dispose"
// ---------------------------------------------------------------------------

test("unnamed session with trash verdict is an explicit-trash candidate", () => {
  const result = classifySession(
    session({}),
    NOT_LIVE,
    VERDICTS.trash,
    NOT_EPHEMERAL,
    2,
  );
  assert.deepEqual(result, {
    kind: "candidate",
    reason: "explicit-trash",
    verdict: VERDICTS.trash,
  });
});

test("finished verdict makes an unnamed session a candidate", () => {
  const result = classifySession(
    session({}),
    NOT_LIVE,
    VERDICTS.finished,
    NOT_EPHEMERAL,
    2,
  );
  assert.deepEqual(result, {
    kind: "candidate",
    reason: "finished",
    verdict: VERDICTS.finished,
  });
});

test("ephemeral verdict makes an unnamed session a candidate", () => {
  const result = classifySession(
    session({}),
    NOT_LIVE,
    VERDICTS.ephemeral,
    NOT_EPHEMERAL,
    2,
  );
  assert.deepEqual(result, {
    kind: "candidate",
    reason: "ephemeral",
    verdict: VERDICTS.ephemeral,
  });
});

test("ephemeral flow match alone makes an unnamed session a candidate", () => {
  const result = classifySession(
    session({}),
    NOT_LIVE,
    NO_VERDICT,
    true,
    2,
  );
  assert.deepEqual(result, {
    kind: "candidate",
    reason: "ephemeral",
    verdict: undefined,
  });
});

// ---------------------------------------------------------------------------
// Structural checks, for sessions with no opinion from anyone
// ---------------------------------------------------------------------------

test("empty unnamed session is auto-deletable", () => {
  const result = classifySession(
    session({ messageCount: 0 }),
    NOT_LIVE,
    NO_VERDICT,
    NOT_EPHEMERAL,
    0,
  );
  assert.deepEqual(result, { kind: "auto-deletable", reason: "empty" });
});

test("old session with content and no verdict needs confirmation and carries detail", () => {
  const name = undefined;
  const result = classifySession(
    session({ created: OLD, modified: OLD, firstMessage: "old work", messageCount: 9 }),
    NOT_LIVE,
    NO_VERDICT,
    NOT_EPHEMERAL,
    4,
  );
  assert.equal(result.kind, "old-needs-confirm");
  if (result.kind !== "old-needs-confirm") return;
  assert.deepEqual(result.detail, {
    name,
    firstMessage: "old work",
    messageCount: 9,
    created: OLD,
    modified: OLD,
    verdict: undefined,
  });
});

test("fresh session with content and no verdict is kept", () => {
  const result = classifySession(
    session({}),
    NOT_LIVE,
    NO_VERDICT,
    NOT_EPHEMERAL,
    2,
  );
  assert.deepEqual(result, { kind: "kept", reason: "has-content-no-verdict" });
});

// ---------------------------------------------------------------------------
// NM-04 — an explicit verdict short-circuits the structural checks
// ---------------------------------------------------------------------------

test("NM-04: keep protects an old unnamed session with content", () => {
  const result = classifySession(
    session({ created: OLD, modified: OLD, messageCount: 80 }),
    NOT_LIVE,
    VERDICTS.keep,
    NOT_EPHEMERAL,
    40,
  );
  assert.deepEqual(result, { kind: "kept", reason: "has-verdict-keep" });
});

test("NM-04: paused protects an old unnamed session with content", () => {
  const result = classifySession(
    session({ created: OLD, modified: OLD, messageCount: 80 }),
    NOT_LIVE,
    VERDICTS.paused,
    NOT_EPHEMERAL,
    40,
  );
  assert.deepEqual(result, { kind: "kept", reason: "has-verdict-paused" });
});

test("NM-04: keep protects an empty unnamed session (accepted cost)", () => {
  const result = classifySession(
    session({ messageCount: 0 }),
    NOT_LIVE,
    VERDICTS.keep,
    NOT_EPHEMERAL,
    0,
  );
  assert.deepEqual(result, { kind: "kept", reason: "has-verdict-keep" });
});

test("NM-04: dispose verdicts still win over the protection", () => {
  // The reorder must not swallow trash/finished/ephemeral: they are evaluated
  // before the kept branch and must remain candidates.
  for (const verdict of [VERDICTS.trash, VERDICTS.finished, VERDICTS.ephemeral]) {
    const result = classifySession(
      session({ created: OLD, modified: OLD, messageCount: 80 }),
      NOT_LIVE,
      verdict,
      NOT_EPHEMERAL,
      40,
    );
    assert.equal(result.kind, "candidate", `${verdict} must remain a candidate`);
  }
});

// ---------------------------------------------------------------------------
// NM-05 — conversation turns floor deletion candidacy
// ---------------------------------------------------------------------------

test("NM-05: a 778-turn unnamed session is kept regardless of age", () => {
  // 01a10e25 from the 2026-10-07 sweep: the real case that broke the heuristic.
  const result = classifySession(
    session({ created: OLD, modified: OLD, messageCount: 1479 }),
    NOT_LIVE,
    NO_VERDICT,
    NOT_EPHEMERAL,
    778,
  );
  assert.deepEqual(result, { kind: "kept", reason: "has-content-no-verdict" });
});

test("NM-05: a 4-turn unnamed session still needs confirmation when old", () => {
  const result = classifySession(
    session({ created: OLD, modified: OLD, messageCount: 7 }),
    NOT_LIVE,
    NO_VERDICT,
    NOT_EPHEMERAL,
    4,
  );
  assert.equal(result.kind, "old-needs-confirm");
});

test("NM-05: the turn floor sits at 5", () => {
  const at4 = classifySession(
    session({ created: OLD, modified: OLD }), NOT_LIVE, NO_VERDICT, NOT_EPHEMERAL, 4,
  );
  const at5 = classifySession(
    session({ created: OLD, modified: OLD }), NOT_LIVE, NO_VERDICT, NOT_EPHEMERAL, 5,
  );
  assert.equal(at4.kind, "old-needs-confirm");
  assert.deepEqual(at5, { kind: "kept", reason: "has-content-no-verdict" });
});

test("NM-05: the outcome does not depend on size in bytes", () => {
  // Size is not part of SessionInfo and must not be consulted. Two sessions that
  // differ only in messageCount (the closest proxy for size) must still be decided
  // by turns alone: 40 turns kept, 4 turns not.
  const smallBigWork = classifySession(
    session({ created: OLD, modified: OLD, messageCount: 9 }),
    NOT_LIVE, NO_VERDICT, NOT_EPHEMERAL, 40,
  );
  const bigTrivial = classifySession(
    session({ created: OLD, modified: OLD, messageCount: 1479 }),
    NOT_LIVE, NO_VERDICT, NOT_EPHEMERAL, 4,
  );
  assert.deepEqual(smallBigWork, { kind: "kept", reason: "has-content-no-verdict" });
  assert.equal(bigTrivial.kind, "old-needs-confirm");
});

test("NM-05: messageCount is not the turn count", () => {
  // Verified against Pi 1.0.4: messageCount counts message entries across all roles,
  // including toolResult, and inflated 2 conversation turns to 3. A tool-heavy session
  // must not be protected by its inflated messageCount.
  const result = classifySession(
    session({ created: OLD, modified: OLD, messageCount: 1479 }),
    NOT_LIVE,
    NO_VERDICT,
    NOT_EPHEMERAL,
    2,
  );
  assert.equal(result.kind, "old-needs-confirm");
});

test("NM-05: an unknown turn count protects rather than deletes", () => {
  // Types are erased by the stripper, so a caller can pass undefined at runtime.
  // Failing open here would let a plumbing mistake delete real work.
  const asUndefined = classifySession(
    session({ created: OLD, modified: OLD, messageCount: 80 }),
    NOT_LIVE, NO_VERDICT, NOT_EPHEMERAL,
    undefined as unknown as number,
  );
  const asNaN = classifySession(
    session({ created: OLD, modified: OLD, messageCount: 80 }),
    NOT_LIVE, NO_VERDICT, NOT_EPHEMERAL, Number.NaN,
  );
  assert.deepEqual(asUndefined, { kind: "kept", reason: "has-content-no-verdict" });
  assert.deepEqual(asNaN, { kind: "kept", reason: "has-content-no-verdict" });
});

// ---------------------------------------------------------------------------
// countConversationTurns
// ---------------------------------------------------------------------------

/** Entry shapes as they appear on disk, plus deliberately hostile ones. */
function msg(role: string): unknown {
  return { type: "message", id: `m-${role}`, message: { role, content: "x" } };
}

test("countConversationTurns counts user and assistant messages", () => {
  assert.equal(countConversationTurns([msg("user"), msg("assistant"), msg("user")]), 3);
});

test("countConversationTurns ignores system and toolResult roles", () => {
  // Verified against Pi 1.0.4: SessionInfo.messageCount counts message entries across
  // ALL roles, which is why it cannot be used as the turn count. 778 real turns
  // reported as 1479.
  const entries = [msg("system"), msg("user"), msg("toolResult"), msg("assistant")];
  assert.equal(countConversationTurns(entries), 2);
});

test("countConversationTurns ignores non-message entries", () => {
  const entries: unknown[] = [
    { type: "session", id: "s", cwd: "/x" },
    { type: "model_change", id: "m", provider: "p" },
    { type: "thinking_level_change", id: "t", thinkingLevel: "medium" },
    { type: "session_info", id: "i", name: "renamed" },
    { type: "custom", customType: "session-scrub/name-hint", data: { slug: "x" } },
    msg("user"),
  ];
  assert.equal(countConversationTurns(entries), 1);
});

test("countConversationTurns survives malformed entries without throwing", () => {
  const entries: unknown[] = [
    null,
    undefined,
    "not an object",
    42,
    { type: "message" },
    { type: "message", message: null },
    { type: "message", message: "a string" },
    { type: "message", message: { role: 7 } },
    msg("user"),
  ];
  assert.equal(countConversationTurns(entries), 1);
});

test("countConversationTurns on an empty list is zero", () => {
  assert.equal(countConversationTurns([]), 0);
});

// ---------------------------------------------------------------------------
// samePath
// ---------------------------------------------------------------------------

test("samePath accepts identical paths and symlink-equivalent paths", () => {
  const dir = mkdtempSync(join(tmpdir(), "scrub-samepath-"));
  try {
    const real = join(dir, "session.jsonl");
    const link = join(dir, "link.jsonl");
    writeFileSync(real, "{}\n");
    symlinkSync(real, link);

    assert.equal(samePath(real, real), true);
    assert.equal(samePath(real, link), true);
    assert.equal(samePath(link, real), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("samePath rejects different paths and unresolvable paths", () => {
  const dir = mkdtempSync(join(tmpdir(), "scrub-samepath-"));
  try {
    const a = join(dir, "a.jsonl");
    const b = join(dir, "b.jsonl");
    const missing = join(dir, "missing.jsonl");
    writeFileSync(a, "{}\n");
    writeFileSync(b, "{}\n");

    assert.equal(samePath(a, b), false);
    assert.equal(samePath(a, missing), false);
    assert.equal(samePath(missing, missing), true, "identical strings short-circuit before realpath");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});