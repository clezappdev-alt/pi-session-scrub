// Characterization tests for classify.ts — the pure session classification
// predicate. They pin today's behavior for everything NOT scheduled to change
// in the next task (verdict reordering / conversation-turn count), so any
// unintended movement is caught before it lands.
//
// Deliberately NOT pinned here:
//   - explicit keep/paused verdict combined with empty or old-with-content
//   - any threshold derived from size, line count, or messageCount semantics
// Both are about to be altered; a test encoding today's output would pin the bug.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SessionInfo } from "@earendil-works/pi-coding-agent";

import { classifySession, samePath, VERDICTS } from "./classify.ts";

const NOW = Date.now();
const FRESH = new Date(NOW - 60_000);
const OLD = new Date(NOW - 30 * 24 * 60 * 60 * 1000);

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

test("live session matched by path classifies as live", () => {
  const result = classifySession(
    session({}),
    { path: "/sessions/abc.jsonl" },
    undefined,
    false,
  );
  assert.deepEqual(result, { kind: "live" });
});

test("live session matched by id (no path) classifies as live", () => {
  const result = classifySession(
    session({}),
    { id: "abcdef0123456789" },
    undefined,
    false,
  );
  assert.deepEqual(result, { kind: "live" });
});

test("named session is named-protected and surfaces its name", () => {
  const result = classifySession(session({ name: "cleanup-slices" }), {}, undefined, false);
  assert.deepEqual(result, {
    kind: "named-protected",
    name: "cleanup-slices",
    verdict: undefined,
  });
});

test("named session with trash verdict is an explicit-trash candidate", () => {
  const result = classifySession(
    session({ name: "cleanup-slices" }),
    {},
    VERDICTS.trash,
    false,
  );
  assert.deepEqual(result, {
    kind: "candidate",
    reason: "explicit-trash",
    verdict: VERDICTS.trash,
  });
});

test("unnamed session with trash verdict is an explicit-trash candidate", () => {
  const result = classifySession(session({}), {}, VERDICTS.trash, false);
  assert.deepEqual(result, {
    kind: "candidate",
    reason: "explicit-trash",
    verdict: VERDICTS.trash,
  });
});

test("finished verdict makes an unnamed session a candidate", () => {
  const result = classifySession(session({}), {}, VERDICTS.finished, false);
  assert.deepEqual(result, {
    kind: "candidate",
    reason: "finished",
    verdict: VERDICTS.finished,
  });
});

test("ephemeral verdict makes an unnamed session a candidate", () => {
  const result = classifySession(session({}), {}, VERDICTS.ephemeral, false);
  assert.deepEqual(result, {
    kind: "candidate",
    reason: "ephemeral",
    verdict: VERDICTS.ephemeral,
  });
});

test("ephemeral flow match alone makes an unnamed session a candidate", () => {
  const result = classifySession(session({}), {}, undefined, true);
  assert.deepEqual(result, {
    kind: "candidate",
    reason: "ephemeral",
    verdict: undefined,
  });
});

test("empty unnamed session is auto-deletable", () => {
  const result = classifySession(session({ messageCount: 0 }), {}, undefined, false);
  assert.deepEqual(result, { kind: "auto-deletable", reason: "empty" });
});

test("old session with content and no verdict needs confirmation and carries detail", () => {
  const name = undefined;
  const result = classifySession(
    session({ created: OLD, modified: OLD, firstMessage: "old work", messageCount: 9 }),
    {},
    undefined,
    false,
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
  const result = classifySession(session({}), {}, undefined, false);
  assert.deepEqual(result, { kind: "kept", reason: "has-content-no-verdict" });
});

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