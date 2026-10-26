# Change — the write guards (§9.6)

**Against:** canonical `openspec/specs/session-scrub/spec.md` (2026-10-26) — REQ-07
(restore) and REQ-08 (`/scrub:init`), plus the file-handling floor this repository
applies to itself.

**Why now:** the repository-standard change (`v0.5.1`+) declared one gap instead of
implying a threat model the code meets. This change closes it: two writes followed a
symlink, and the restore-overwrite guard had no test. Issue #21.

## Specs

**WG-01 — no write follows a symlink.** `sessionfs.ts:refuseNonRegularFile` runs
`lstat` and refuses any path that exists and is not a regular file. `lstat` is the
requirement, not an implementation detail: `stat` resolves the link and answers about
the target, which is the question that must not be asked. A path that does not exist
passes — the caller decides, and `/scrub:init` creates an absent `AGENTS.md`.

**WG-02 — the backup copy is guarded.** `sessionfs.ts:backupSessionFile` calls the
guard before `copyFileSync`. Without it, a symlinked session file turns "back up this
file" into "copy any readable file into a known place".

**WG-03 — the `/scrub:init` append is guarded.** The write goes through
`sessionfs.ts:appendPolicyBlock`, which calls the guard before `writeFileSync`. A
project that ships `AGENTS.md` as a symlink can no longer have the policy block
appended through it. The refusal is reported the way every other failure of that
command is reported — `Could not write AGENTS.md: <message>` at `warning`, no outward
throw, nothing written.

**WG-04 — a restore refuses an existing target, and a test says so.** The guard in
`sessionfs.ts:moveFromTrash` predates this change; its test did not exist. The test
asserts both halves: the refusal, and that neither file moves.

**Testability, not scope.** `moveToTrash` and `moveFromTrash` move from `index.ts`
into `sessionfs.ts` so WG-04 can be a unit test at all. Behavior is unchanged: same
`mkdirSync`, same `renameSync`, same message, same per-file `Skipped <id>` handling
in the command.

**Out of scope:** the guards that already hold (path components through `basename`,
the parse → back up → write → verify order, the trash and backup roots staying
outside Pi's `sessions/`). Moving a symlink is not "writing through" one — `rename`
moves the link itself — so the moves keep their behavior and only the restore
refusal is pinned.

## Scenarios

#### Scenario: a symlinked session file is never backed up

- GIVEN a session path that is a symlink to another readable file
- WHEN the write path asks for a backup
- THEN it throws `refusing to write through the session file: not a regular file`
- AND no file is created in the backup directory

#### Scenario: a symlinked project AGENTS.md is never appended

- GIVEN `<ctx.cwd>/AGENTS.md` is a symlink to a file outside the project
- WHEN `/scrub:init` is confirmed
- THEN the write is refused, the command notifies the reason, and the link target is
  byte-for-byte unchanged

#### Scenario: a restore never overwrites

- GIVEN a trash copy and a file of the same name already in the sessions directory
- WHEN the restore runs
- THEN it refuses with `restore target already exists: <path>`
- AND both files keep their own bytes
