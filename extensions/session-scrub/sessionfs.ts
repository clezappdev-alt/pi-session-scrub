// The filesystem boundary: where the plugin's own directories live, and how a session
// file is snapshot, backed up and measured for freshness.
//
// Extracted from index.ts for the same reason `classify.ts` was: this is the safety
// mechanism for writing a name into ANOTHER session's file, and it had no test at all.
// The order — parse, back up, write, verify — is what makes that write recoverable, and
// an order nobody tests is an order a later edit can quietly break.
//
// No runtime dependency on Pi, so this stays loadable and testable standalone. The
// SessionManager call itself stays in index.ts: it is the one part that needs the host,
// and it is straight-line code whose pieces are tested here.

import { copyFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { readSnapshot, isFresh, type WriteSnapshot } from "./adopt.ts";

/**
 * Pi has already created the sessions directory; these live beside it. Both derive
 * their location from the session dir Pi reports rather than from an invented transform,
 * so the plugin never guesses where Pi keeps its state.
 *
 * Two levels up from the per-project directory is the runtime's own state directory:
 *
 *     <runtime>/sessions/<project>          ← the session dir Pi reports
 *     <runtime>/session-scrub-trash/<project>
 *     <runtime>/session-scrub-backups/<project>
 */
export function getTrashDir(sessionDir: string): string {
  return join(dirname(dirname(sessionDir)), "session-scrub-trash", basename(sessionDir));
}

/**
 * Backups get their own root, a sibling of the trash dir, and never a directory inside it.
 *
 * This is load-bearing, not tidiness. The trash dir holds sessions that were *moved*
 * there and that `/scrub:restore` lists and moves back; a backup copy sitting in that
 * directory would be offered for restore, and restoring it would overwrite the very file
 * it was taken from. Both roots also stay outside `sessions/`, where Pi could otherwise
 * mistake a stray file for a live session.
 */
export function getBackupDir(sessionDir: string): string {
  return join(dirname(dirname(sessionDir)), "session-scrub-backups", basename(sessionDir));
}

/**
 * Where the backup for this target will land — computed without writing, so a
 * confirmation can name the way back before the human is asked to accept the write.
 */
export function backupPathFor(sessionPath: string, backupDir: string): string {
  return join(backupDir, basename(sessionPath));
}

/**
 * Copy a session file aside before writing to it, and return the backup path.
 *
 * Called before every write, so the existing backup is overwritten each time: it always
 * holds the state immediately before the most recent write, which is the one worth
 * restoring. Keeping older copies would need a rotation policy this does not have.
 */
export function backupSessionFile(sessionPath: string, backupDir: string): string {
  mkdirSync(backupDir, { recursive: true });
  const backupPath = backupPathFor(sessionPath, backupDir);
  copyFileSync(sessionPath, backupPath);
  return backupPath;
}

/**
 * Snapshot a session file. A file that cannot be read reads as unparsed rather than
 * throwing: the caller decides, and `parsed: false` is what makes it refuse to write.
 */
export function snapshotFile(path: string): WriteSnapshot {
  try {
    return readSnapshot(readFileSync(path, "utf-8"));
  } catch {
    return { entryCount: 0, name: undefined, parsed: false };
  }
}

/**
 * NM-03's cross-process net: how long ago the file was last written, and whether that
 * puts it inside the freshness window.
 *
 * Sampled before any write and treated as evidence about *other processes*, never as a
 * claim of liveness. A missing or unreadable mtime reads as settled rather than fresh:
 * `statSync` failing means the file is already gone, which the write path refuses outright
 * anyway — the guard must not be the thing that reports it.
 */
export function freshnessOf(
  sessionPath: string,
  now: number = Date.now(),
): { fresh: boolean; ageSeconds: number } {
  try {
    const mtimeMs = statSync(sessionPath).mtimeMs;
    return {
      fresh: isFresh(mtimeMs, now),
      ageSeconds: Math.max(0, Math.round((now - mtimeMs) / 1000)),
    };
  } catch {
    return { fresh: false, ageSeconds: Number.MAX_SAFE_INTEGER };
  }
}
