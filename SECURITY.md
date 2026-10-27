# Security

## Reporting a vulnerability

**Never open a public issue for a vulnerability.** Use GitHub Security
Advisories, privately:

<https://github.com/clezappdev-alt/pi-session-scrub/security/advisories/new>

Include what you did, what happened, and the version you are running. If the report is
about data on disk, say which files were involved and what a copy of them would
reveal.

Response is **best effort, with no bounty**: acknowledge within **7 days**, and
fix or publish a mitigation within **30**.

## Supported runtime

The security baseline for running this extension is **Node.js `>=24.22.1` on the
24.x LTS line** — a maintained, patched runtime. That number belongs to whoever
maintains the runtime on your machine, not to this repository; it is restated
here so it is stated somewhere a user will look.

`engines.node` is `>=22.19.0`, which is a **compatibility** floor, not a
security control: it is what the code needs, and it deliberately is not raised
to the baseline, because a range in a manifest does not patch anything.

An unpatched runtime is a real exposure that pi-session-scrub cannot fix: it lives in
Node, and every Pi user carries it with or without this package.

## Affected versions

Every release before the one that carries a fix. Fixes ship as a patch tag, and
the release notes state which versions are affected. There are no long-term
support branches: install the newest tag.

## What this extension touches

It reads and writes Pi session files, which is the whole reason it exists. The
data map:

| | Path | What |
| --- | --- | --- |
| reads | `<pi-runtime>/sessions/--<project>--/*.jsonl` | session files: message counts, first/last text, names, and the extension's own custom entries |
| reads | `<project>/AGENTS.md` | only to detect whether the policy block already exists |
| writes | the same session files | appends one entry: a `session_info` name, or a `session-scrub/verdict` custom entry |
| writes | `<pi-runtime>/session-scrub-backups/--<project>--/<file>.jsonl` | a byte-for-byte copy of a session file, taken immediately before the extension writes to it. One backup per target, overwritten on each write |
| writes | `<pi-runtime>/session-scrub-trash/--<project>--/<file>.jsonl` | sessions moved out of Pi's sessions directory by `/scrub:apply`; moves are `rename`, and `/scrub:restore` moves them back |
| writes | `<project>/AGENTS.md` | only on `/scrub:init`: appends one delimited block. Never rewrites existing text |

`<pi-runtime>` is the directory Pi itself reports for its state (typically
`~/.pi/agent`). Nothing outside those paths is read or written, and the extension
never touches the session it is running in.

**No network. No `child_process`. No `eval`.** The extension is offline by design
and has no runtime dependencies. All three claims are verifiable with one grep
over `extensions/`:

```bash
grep -rnE -e 'node:net' -e 'node:http' -e 'node:dns' -e 'node:tls' \
  -e 'node:child_process' -e 'node:vm' -e 'fetch\(' \
  extensions/ --include='*.ts' --exclude='*.test.ts'
```

## Guards that are already in place

- Every path component taken from session data passes through `basename()`
  before `join()`: a name is data, never a path.
- **No write follows a symlink.** `refuseNonRegularFile` runs `lstat` before the
  backup copy and before the `/scrub:init` append to `AGENTS.md`, and refuses
  anything that exists and is not a regular file. `lstat` is deliberate: `stat`
  would resolve the link and answer about the target.
- A restore refuses to overwrite an existing target; it reports the collision and
  moves nothing. A test asserts the refusal and that both files keep their bytes.
- Destructive writes follow one order: parse, back up, write, verify. A write
  that cannot be verified is reported with the backup path, never counted as
  applied.
- The trash and backup roots are siblings of Pi's `sessions/` directory, never
  inside it, so Pi can never mistake its own file for a live session.

Each guard above has a test in `extensions/session-scrub/*.test.ts`; a security
guard without a test is a comment.

## Out of scope for this repository

Patching Node, npm, the CA store, or any global package store is the job of
whoever maintains your machine. This repository only declares the dependency and
states the baseline above.
