# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.1] - 2026-10-27

### Fixed

- Session listings read the directory the plugin actually uses. Every
  `SessionManager.list` call now passes the resolved session dir, so a custom
  `--session-dir` is the directory `/scrub:audit`, `/scrub:apply` and
  `/scrub:triage` read *and* the one the trash and backups write to. Found in the
  v0.6.0 manual trial: the audit reported the live session only, because a
  listing without that argument falls back to the default directory. A
  structural gate now fails when a call site omits it.

## [0.6.0] - 2026-10-26

### Added

- `LICENSE` (MIT), `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, and
  this changelog — the external face a stranger needs before sending a patch.
- Issue templates, a pull request template, and a CI workflow that runs the
  documented check on every pull request, on the compatibility floor and on the
  current LTS.
- A committed lockfile and pinned devDependencies, so a fresh clone verifies
  itself with `npm ci --ignore-scripts && npm run check` and nothing
  pre-installed.
- `refuseNonRegularFile`: no write follows a symlink any more. The backup copy
  and the `/scrub:init` append to `AGENTS.md` both `lstat` first and refuse
  anything that is not a regular file, instead of writing through it.

### Changed

- The typecheck gate no longer resolves types out of a global package store and
  no longer downloads a compiler at verification time: it runs a local `tsc`
  against the checked-in `tsconfig.json`.
- `engines.node` declares the compatibility floor the code needs.
- `moveToTrash` and `moveFromTrash` live in `sessionfs.ts`, host-free and
  testable. Behavior is unchanged.

### Fixed

- The restore's overwrite guard is pinned by a test: it refuses, and both files
  keep their own bytes. The guard existed and had never been tested.
- Three `index.ts:move*` citations in `docs/behavior.md` pointed at code that had
  moved; they now name `sessionfs.ts`.

## [0.5.1] - 2026-10-26

### Fixed

- A tool **call** line is budgeted by cells like a result line, so a wide preview
  on a narrow frame can no longer overflow it.

### Changed

- The width contract has its own requirement number, and NB-04 no longer
  contradicts NB-10 about when a preview is dropped.

## [0.5.0] - 2026-10-26

### Added

- The handoff promise: `/scrub:handoff` creates the continuation, names it, and
  writes `traspaso:` on the origin only after the destination exists.
- `scrub_close` writes the four `CLOSE_STATES` and never offers `traspaso`, which
  only the handoff can assert.
- The close state is named by its type instead of a cast.

### Fixed

- A tool result line stays inside the frame, and the frame is budgeted in cells
  rather than string length, so wide characters cannot overflow it.
- A frame narrower than the check prefix is cut instead of overflowing.

## [0.4.2] - 2026-10-26

### Fixed

- The two-token lineage head: a middle session keeps its parent's token and shows
  its own, and its own token can never be read as the inherited one.

## [0.4.1] - 2026-10-26

### Fixed

- The lineage marker survives a close instead of dangling a separator when the
  close carries no text.

## [0.4.0] - 2026-10-26

### Added

- The naming convention, `/scrub:adopt` to apply it to sessions that predate it,
  and `/scrub:handoff`.
- `/scrub:init` writes the policy block as one delimited region, and refuses when
  a block already exists instead of writing a second one.

### Changed

- The as-built specification is split into surface, contract and evidence, with a
  machine-readable surface inventory checked against the code.

## [0.3.0] - 2026-09-14

### Added

- Bulk confirmation of machine keeps, storing one dated rationale per file.
- Inline renames during triage, with a per-item confirm showing existing and
  proposed names.
- Deferred candidates listed by short id, and a verbose mode printing full packs.

### Changed

- Triage slots are ordered WEAK-first, and the default output is a compact table.

## [0.2.0] - 2026-09-14

### Added

- `/scrub:triage` and `--apply`: digest packs first (read-only), the human's
  judgment in chat, then verdicts written with per-item confirmation.

## [0.1.0] - 2026-09-13

### Added

- `/scrub:audit` — read-only classification of the project's sessions.
- `/scrub:apply` — dry-run first, then per-item confirmation, then a reversible
  move into a plugin-owned trash directory.
- `/scrub:restore` — move trashed sessions back.
- The `scrub_mark` tool, storing verdicts as custom entries inside the session
  file so they never reach LLM context.

[Unreleased]: https://github.com/clezappdev-alt/pi-session-scrub/compare/v0.6.1...master
[0.6.1]: https://github.com/clezappdev-alt/pi-session-scrub/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/clezappdev-alt/pi-session-scrub/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/clezappdev-alt/pi-session-scrub/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/clezappdev-alt/pi-session-scrub/compare/v0.4.2...v0.5.0
[0.4.2]: https://github.com/clezappdev-alt/pi-session-scrub/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/clezappdev-alt/pi-session-scrub/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/clezappdev-alt/pi-session-scrub/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/clezappdev-alt/pi-session-scrub/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/clezappdev-alt/pi-session-scrub/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/clezappdev-alt/pi-session-scrub/releases/tag/v0.1.0
