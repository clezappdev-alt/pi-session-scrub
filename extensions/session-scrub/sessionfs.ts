// The filesystem boundary: where the extension's own directories live, and how a session
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

import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { readSnapshot, isFresh, type WriteSnapshot } from "./adopt.ts";

/**
 * Pi has already created the sessions directory; these live beside it. Both derive
 * their location from the session dir Pi reports rather than from an invented transform,
 * so the extension never guesses where Pi keeps its state.
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
 * The §9.6 guard: refuse to touch anything that is not a regular file.
 *
 * `copyFileSync` and `writeFileSync` both follow a symlink, so without this check
 * "back up this file" becomes "copy any readable file into a known place", and a project
 * that ships `AGENTS.md` as a link turns `/scrub:init` into an append to whatever that
 * link points at. `lstat` is the whole point: `stat` resolves the link and would answer
 * about the target, which is exactly the question this must not ask.
 *
 * A path that does not exist passes: the caller decides. `/scrub:init` creates
 * `AGENTS.md` when it is absent, and refusing an absent file would break that path.
 */
export function refuseNonRegularFile(path: string, label: string): void {
  let isRegularFile: boolean;
  try {
    isRegularFile = lstatSync(path).isFile();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  if (!isRegularFile) {
    throw new Error(`refusing to write through ${label}: not a regular file (${path})`);
  }
}

/**
 * Copy a file aside before writing to it, and return the backup path.
 *
 * The generic copy: `backupSessionFile` is one caller, `/scrub:init --update` is the
 * other, and the label is passed in because the §9.6 refusal has to name what it
 * refused. Called before every write, so the existing backup is overwritten each time:
 * it always holds the state immediately before the most recent write, which is the one
 * worth restoring. Keeping older copies would need a rotation policy this does not have.
 */
export function backupFileAside(filePath: string, backupDir: string, label: string): string {
  refuseNonRegularFile(filePath, label);
  mkdirSync(backupDir, { recursive: true });
  const backupPath = backupPathFor(filePath, backupDir);
  copyFileSync(filePath, backupPath);
  return backupPath;
}

/**
 * Copy a session file aside before writing to it, and return the backup path.
 *
 * Called before every write, so the existing backup is overwritten each time: it always
 * holds the state immediately before the most recent write, which is the one worth
 * restoring. Keeping older copies would need a rotation policy this does not have.
 */
export function backupSessionFile(sessionPath: string, backupDir: string): string {
  return backupFileAside(sessionPath, backupDir, "the session file");
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

// ---------------------------------------------------------------------------
// The two moves, and the one write into a project file
// ---------------------------------------------------------------------------

/**
 * Move a session file into the trash, and return where it landed.
 *
 * Throwing on purpose: the command catches per file and reports one `Skipped <id>`
 * line, so one unreadable session cannot abort the batch.
 */
export function moveToTrash(sessionPath: string, trashDir: string): string {
  mkdirSync(trashDir, { recursive: true });
  const trashPath = join(trashDir, basename(sessionPath));
  renameSync(sessionPath, trashPath);
  return trashPath;
}

/**
 * Move a trashed session back, refusing to overwrite anything already there.
 *
 * The refusal is the whole safety property of a restore: overwriting would destroy a
 * live session with an older copy of one, and the trash copy must survive the refusal so
 * the human can retry after deciding what to do.
 */
export function moveFromTrash(trashedPath: string, sessionsDir: string): string {
  mkdirSync(sessionsDir, { recursive: true });
  const restoredPath = join(sessionsDir, basename(trashedPath));
  if (existsSync(restoredPath)) {
    throw new Error(`restore target already exists: ${restoredPath}`);
  }
  renameSync(trashedPath, restoredPath);
  return restoredPath;
}

/**
 * `/scrub:init`'s append, behind the §9.6 guard.
 *
 * `existingText` is read and planned by the command (`policy.ts:planInitWrite` decides
 * whether a block already exists); the text is passed in so this write is testable
 * without a host. The guard runs before the write, never after.
 */
export function appendPolicyBlock(
  agentsPath: string,
  existingText: string,
  blockText: string,
): void {
  refuseNonRegularFile(agentsPath, "AGENTS.md");
  writeFileSync(agentsPath, `${existingText}${blockText}`);
}

/**
 * `/scrub:init --update`'s write, behind the same §9.6 guard.
 *
 * The whole file is passed in, already planned by `policy.ts:planInitUpdate`: the
 * command never splices text at the filesystem. `writeFileSync` truncates and rewrites,
 * so the guard has to run before it — after it would be a report about a write that
 * already happened.
 */
export function replacePolicyBlock(agentsPath: string, text: string): void {
  refuseNonRegularFile(agentsPath, "AGENTS.md");
  writeFileSync(agentsPath, text);
}
