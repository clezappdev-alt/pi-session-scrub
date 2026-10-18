// Tests for sessionfs.ts — the filesystem boundary around writing a session name.
//
// The order these helpers are used in is the safety mechanism for a write into another
// session's file: parse, back up, write, verify. Each piece is tested here so a later
// reorder breaks something visible instead of corrupting a session file quietly.
//
// The first test is the one that matters most: a backup must never land where
// /scrub-restore would find it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import {
  getTrashDir,
  getBackupDir,
  backupPathFor,
  backupSessionFile,
  snapshotFile,
  freshnessOf,
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
// Where the plugin's own directories live
// ---------------------------------------------------------------------------

test("a backup never lands inside the trash directory", () => {
  // The invariant that keeps /scrub-restore honest. If backups lived in the trash dir,
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