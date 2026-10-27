// Tests for sessionfs.ts — the filesystem boundary around writing a session name.
//
// The order these helpers are used in is the safety mechanism for a write into another
// session's file: parse, back up, write, verify. Each piece is tested here so a later
// reorder breaks something visible instead of corrupting a session file quietly.
//
// The first test is the one that matters most: a backup must never land where
// /scrub:restore would find it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, utimesSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import {
  getTrashDir,
  getBackupDir,
  backupPathFor,
  backupSessionFile,
  snapshotFile,
  freshnessOf,
  refuseNonRegularFile,
  appendPolicyBlock,
  replacePolicyBlock,
  backupFileAside,
  moveToTrash,
  moveFromTrash,
} from "./sessionfs.ts";

const HEADER = '{"type":"session","version":3,"id":"s1","timestamp":"2026-01-01T00:00:00.000Z","cwd":"/tmp"}';

/** A throwaway runtime tree shaped like the real one, so path maths is exercised. */
function runtime() {
  const root = mkdtempSync(join(tmpdir(), "scrub-fs-"));
  const sessionDir = join(root, "runtime", "sessions", "my-project");
  mkdirSync(sessionDir, { recursive: true });
  return { root, sessionDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

// ---------------------------------------------------------------------------
// Where the extension's own directories live
// ---------------------------------------------------------------------------

test("a backup never lands inside the trash directory", () => {
  // The invariant that keeps /scrub:restore honest. If backups lived in the trash dir,
  // restoring one would overwrite the very file it was taken from.
  const r = runtime();
  try {
    const trash = getTrashDir(r.sessionDir);
    const backups = getBackupDir(r.sessionDir);
    assert.notEqual(trash, backups);
    assert.equal(backups.startsWith(trash + "/"), false, "backups must not be inside trash");
    assert.equal(trash.startsWith(backups + "/"), false, "trash must not be inside backups");
  } finally { r.cleanup(); }
});

test("trash and backups are siblings under the runtime's state directory", () => {
  const r = runtime();
  try {
    const trash = getTrashDir(r.sessionDir);
    const backups = getBackupDir(r.sessionDir);
    // Each is <state>/<own-root>/<project>, so the shared grandparent is the state dir
    // that also holds `sessions/`. Comparing the parents would compare the two roots.
    const stateOf = (p: string) => dirname(dirname(p));
    assert.equal(stateOf(trash), stateOf(backups));
    assert.equal(basename(stateOf(trash)), "runtime");
    assert.equal(basename(trash), "my-project");
    assert.equal(basename(backups), "my-project");
  } finally { r.cleanup(); }
});

test("neither directory sits inside the sessions root Pi scans", () => {
  // Pi lists sessions from the sessions directory. A stray .jsonl there would be listed
  // as a live session; neither of our own roots may appear under it.
  const r = runtime();
  try {
    const sessionsRoot = join(r.root, "runtime", "sessions");
    for (const dir of [getTrashDir(r.sessionDir), getBackupDir(r.sessionDir)]) {
      assert.equal(dir.startsWith(sessionsRoot + "/"), false, `${dir} must be outside ${sessionsRoot}`);
    }
  } finally { r.cleanup(); }
});

// ---------------------------------------------------------------------------
// Backing a file up
// ---------------------------------------------------------------------------

test("backing up copies the bytes exactly and creates the directory", () => {
  const r = runtime();
  try {
    const session = join(r.sessionDir, "a.jsonl");
    const body = [HEADER, '{"type":"session_info","name":"viejo"}'].join("\n") + "\n";
    writeFileSync(session, body);
    const backups = join(r.root, "fresh", "nested");
    const written = backupSessionFile(session, backups);
    assert.equal(written, join(backups, "a.jsonl"));
    assert.equal(readFileSync(written, "utf-8"), body);
  } finally { r.cleanup(); }
});

test("the backup path is computable without doing the write", () => {
  // The confirmation names the way back before the human accepts, so the path has to be
  // knowable in advance and agree with where the copy actually lands.
  const r = runtime();
  try {
    const session = join(r.sessionDir, "a.jsonl");
    writeFileSync(session, HEADER + "\n");
    const backups = getBackupDir(r.sessionDir);
    assert.equal(backupPathFor(session, backups), backupSessionFile(session, backups));
  } finally { r.cleanup(); }
});

test("a second backup holds the state before the most recent write, not the first", () => {
  // Overwrite is the intended behaviour: the copy that matters is the one taken just
  // before the write that is about to happen.
  const r = runtime();
  try {
    const session = join(r.sessionDir, "a.jsonl");
    const backups = getBackupDir(r.sessionDir);
    writeFileSync(session, "one\n");
    backupSessionFile(session, backups);
    writeFileSync(session, "one\ntwo\n");
    const second = backupSessionFile(session, backups);
    assert.equal(readFileSync(second, "utf-8"), "one\ntwo\n");
  } finally { r.cleanup(); }
});

// ---------------------------------------------------------------------------
// Snapshotting: what the write path parses before and after
// ---------------------------------------------------------------------------

test("a snapshot of a real session file parses and reads its name", () => {
  const r = runtime();
  try {
    const session = join(r.sessionDir, "a.jsonl");
    writeFileSync(session, [HEADER, '{"type":"session_info","name":"viejo"}'].join("\n") + "\n");
    const snap = snapshotFile(session);
    assert.equal(snap.parsed, true);
    assert.equal(snap.entryCount, 2);
    assert.equal(snap.name, "viejo");
  } finally { r.cleanup(); }
});

test("a missing file reads as unparsed rather than throwing", () => {
  // `parsed: false` is what makes the write path refuse. Throwing here would surface as
  // an unrelated error message instead of the refusal.
  const r = runtime();
  try {
    assert.deepEqual(snapshotFile(join(r.sessionDir, "gone.jsonl")), {
      entryCount: 0, name: undefined, parsed: false,
    });
  } finally { r.cleanup(); }
});

// ---------------------------------------------------------------------------
// Freshness: the NM-03 net
// ---------------------------------------------------------------------------

test("a file written seconds ago is fresh; one written an hour ago is not", () => {
  const r = runtime();
  try {
    const session = join(r.sessionDir, "a.jsonl");
    writeFileSync(session, HEADER + "\n");
    const now = Date.now();
    assert.equal(freshnessOf(session, now).fresh, true);
    assert.equal(freshnessOf(session, now + 3_600_000).fresh, false);
  } finally { r.cleanup(); }
});

test("the reported age matches the file's own mtime", () => {
  const r = runtime();
  try {
    const session = join(r.sessionDir, "a.jsonl");
    writeFileSync(session, HEADER + "\n");
    const then = Date.now() - 30_000;
    utimesSync(session, then / 1000, then / 1000);
    const { ageSeconds } = freshnessOf(session, Date.now());
    assert.ok(ageSeconds >= 29 && ageSeconds <= 32, `expected ~30s, got ${ageSeconds}`);
  } finally { r.cleanup(); }
});

test("a missing file reads as settled, not fresh", () => {
  // The guard must not be what reports a missing file: the write path refuses that case
  // outright. Reading it as fresh would raise the bar on a file that cannot be written.
  const r = runtime();
  try {
    const { fresh, ageSeconds } = freshnessOf(join(r.sessionDir, "gone.jsonl"));
    assert.equal(fresh, false);
    assert.equal(ageSeconds, Number.MAX_SAFE_INTEGER);
  } finally { r.cleanup(); }
});

// ---------------------------------------------------------------------------
// §9.6 — never write through a symlink
//
// `copyFileSync` and `writeFileSync` both follow a symlink. Without an `lstat` first,
// "back up this file" becomes "copy any readable file into a known place", and a
// project that ships AGENTS.md as a link turns `/scrub:init` into an append to whatever
// the link points at. Both guards are asserted here, not assumed.
// ---------------------------------------------------------------------------

const POLICY_BLOCK = "<!-- pi-session-scrub:start -->\nephemeral-flows: x\n<!-- pi-session-scrub:end -->\n";

test("refuseNonRegularFile passes a regular file and a missing path", () => {
  // Missing must pass: the caller decides. `/scrub:init` creates AGENTS.md when it is
  // absent, and refusing an absent file would break the command's normal path.
  const r = runtime();
  try {
    const regular = join(r.sessionDir, "a.jsonl");
    writeFileSync(regular, HEADER + "\n");
    refuseNonRegularFile(regular, "the session file");
    refuseNonRegularFile(join(r.sessionDir, "gone.jsonl"), "the session file");
  } finally { r.cleanup(); }
});

test("refuseNonRegularFile refuses a symlink and a directory", () => {
  const r = runtime();
  try {
    const real = join(r.sessionDir, "real.jsonl");
    writeFileSync(real, HEADER + "\n");
    const link = join(r.sessionDir, "link.jsonl");
    symlinkSync(real, link);
    assert.throws(() => refuseNonRegularFile(link, "the session file"), /not a regular file/);
    assert.throws(() => refuseNonRegularFile(r.sessionDir, "the session file"), /not a regular file/);
  } finally { r.cleanup(); }
});

test("backing up a symlinked session file is refused and writes no backup", () => {
  const r = runtime();
  try {
    const real = join(r.sessionDir, "real.jsonl");
    writeFileSync(real, HEADER + "\n");
    const link = join(r.sessionDir, "link.jsonl");
    symlinkSync(real, link);
    const backups = getBackupDir(r.sessionDir);
    assert.throws(() => backupSessionFile(link, backups), /not a regular file/);
    assert.equal(existsSync(backupPathFor(link, backups)), false, "no backup may be written");
  } finally { r.cleanup(); }
});

test("appending the policy block to a symlinked AGENTS.md is refused and the target is untouched", () => {
  const root = mkdtempSync(join(tmpdir(), "scrub-init-"));
  try {
    const outside = join(root, "outside-agents.md");
    writeFileSync(outside, "original\n");
    const agentsPath = join(root, "AGENTS.md");
    symlinkSync(outside, agentsPath);
    assert.throws(
      () => appendPolicyBlock(agentsPath, "original\n", POLICY_BLOCK),
      /not a regular file/,
    );
    assert.equal(readFileSync(outside, "utf-8"), "original\n", "the link target must not be written");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("appending the policy block still appends to a regular file and creates a missing one", () => {
  // The behaviour `/scrub:init` already had, pinned so the guard cannot narrow it.
  const root = mkdtempSync(join(tmpdir(), "scrub-init-"));
  try {
    const existingPath = join(root, "existing", "AGENTS.md");
    mkdirSync(dirname(existingPath), { recursive: true });
    writeFileSync(existingPath, "# rules\n");
    appendPolicyBlock(existingPath, "# rules\n", POLICY_BLOCK);
    assert.equal(readFileSync(existingPath, "utf-8"), `# rules\n${POLICY_BLOCK}`);

    const freshPath = join(root, "fresh", "AGENTS.md");
    mkdirSync(dirname(freshPath), { recursive: true });
    appendPolicyBlock(freshPath, "", POLICY_BLOCK);
    assert.equal(readFileSync(freshPath, "utf-8"), POLICY_BLOCK);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("replacing the policy block rewrites the whole file, and refuses a symlink", () => {
  // `--update` writes the file the planner produced, not a splice: `writeFileSync`
  // truncates, so the §9.6 guard has to run first. Both halves are pinned here rather
  // than only structurally in doccheck.test.ts.
  const root = mkdtempSync(join(tmpdir(), "scrub-update-"));
  try {
    const agentsPath = join(root, "AGENTS.md");
    writeFileSync(agentsPath, "# rules\nstale block\n");
    replacePolicyBlock(agentsPath, "# rules\nupdated block\n");
    assert.equal(readFileSync(agentsPath, "utf-8"), "# rules\nupdated block\n");

    const outside = join(root, "outside-agents.md");
    writeFileSync(outside, "original\n");
    const link = join(root, "linked", "AGENTS.md");
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(outside, link);
    assert.throws(() => replacePolicyBlock(link, "overwritten\n"), /not a regular file/);
    assert.equal(readFileSync(outside, "utf-8"), "original\n", "the link target must not be written");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("backing AGENTS.md aside before an update lands in the backups root, not the trash", () => {
  // The copy is the way back from an automated rewrite of a file the project owns, so it
  // must hold the bytes BEFORE the write and it must not sit where /scrub:restore looks.
  const r = runtime();
  try {
    const agentsPath = join(r.root, "AGENTS.md");
    writeFileSync(agentsPath, "the state before the update\n");
    const backups = getBackupDir(r.sessionDir);
    const backupPath = backupFileAside(agentsPath, backups, "AGENTS.md");

    assert.equal(backupPath, backupPathFor(agentsPath, backups));
    assert.equal(readFileSync(backupPath, "utf-8"), "the state before the update\n");
    assert.equal(dirname(backupPath), backups);
    assert.notEqual(backups, getTrashDir(r.sessionDir), "a backup inside the trash would be offered for restore");
    assert.equal(existsSync(join(getTrashDir(r.sessionDir), basename(agentsPath))), false);
  } finally { r.cleanup(); }
});

test("a backup that cannot be taken refuses, so the update never writes unguarded", () => {
  const root = mkdtempSync(join(tmpdir(), "scrub-update-"));
  try {
    const outside = join(root, "outside-agents.md");
    writeFileSync(outside, "original\n");
    const link = join(root, "AGENTS.md");
    symlinkSync(outside, link);
    assert.throws(
      () => backupFileAside(link, join(root, "backups"), "AGENTS.md"),
      /not a regular file/,
    );
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// Moves: trash and restore (REQ-07's overwrite guard)
// ---------------------------------------------------------------------------

test("a session moved to trash comes back on restore", () => {
  const r = runtime();
  try {
    const session = join(r.sessionDir, "a.jsonl");
    writeFileSync(session, HEADER + "\n");
    const trashed = moveToTrash(session, getTrashDir(r.sessionDir));
    assert.equal(existsSync(session), false);
    assert.equal(readFileSync(trashed, "utf-8"), HEADER + "\n");

    const restored = moveFromTrash(trashed, r.sessionDir);
    assert.equal(restored, session);
    assert.equal(existsSync(trashed), false);
    assert.equal(readFileSync(restored, "utf-8"), HEADER + "\n");
  } finally { r.cleanup(); }
});

test("restoring over an existing target is refused and neither file moves", () => {
  // REQ-07's guard: implemented before, never tested. A restore that overwrote would
  // destroy a live session with a copy of an older one.
  const r = runtime();
  try {
    const target = join(r.sessionDir, "a.jsonl");
    writeFileSync(target, "already here\n");
    const trashDir = getTrashDir(r.sessionDir);
    mkdirSync(trashDir, { recursive: true });
    const trashed = join(trashDir, "a.jsonl");
    writeFileSync(trashed, "from trash\n");

    assert.throws(() => moveFromTrash(trashed, r.sessionDir), /already exists/);
    assert.equal(readFileSync(target, "utf-8"), "already here\n", "the live file must survive");
    assert.equal(readFileSync(trashed, "utf-8"), "from trash\n", "the trash copy must survive");
  } finally { r.cleanup(); }
});