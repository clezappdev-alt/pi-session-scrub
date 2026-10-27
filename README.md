<div align="center">

# pi-session-scrub

**Keep your Pi `/resume` list clean, descriptive and honest — with zero tokens spent
and nothing deleted by surprise.**

<p>
<a href="https://github.com/clezappdev-alt/pi-session-scrub/releases"><img src="https://img.shields.io/github/v/release/clezappdev-alt/pi-session-scrub?style=for-the-badge&labelColor=1A1218&color=F095C8" alt="Latest release"></a>
<a href="https://github.com/clezappdev-alt/pi-session-scrub/actions/workflows/ci.yml"><img src="https://github.com/clezappdev-alt/pi-session-scrub/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
<img src="https://img.shields.io/badge/node-%E2%89%A522.19.0-D7A0B8?style=for-the-badge&labelColor=1A1218" alt="Node 22.19.0 or newer">
<a href="LICENSE"><img src="https://img.shields.io/badge/MIT-D7A0B8?style=for-the-badge&labelColor=1A1218" alt="License: MIT"></a>
<img src="https://img.shields.io/badge/status-beta-F095C8?style=for-the-badge&labelColor=1A1218" alt="Status: beta">
</p>

<p>
<a href="#install"><strong>Install</strong></a> &bull;
<a href="#commands"><strong>Commands</strong></a> &bull;
<a href="#what-it-touches"><strong>What it touches</strong></a> &bull;
<a href="SECURITY.md"><strong>Security</strong></a> &bull;
<a href="CONTRIBUTING.md"><strong>Contributing</strong></a>
</p>

<a href="https://github.com/Gentleman-Programming/gentle-ai">
  <img width="220" src="https://raw.githubusercontent.com/Gentleman-Programming/gentle-ai/main/docs/assets/brand/built-with-gentle-ai.png" alt="Built with Gentle-AI" />
</a>

</div>

---

## Why

Pi keeps every session you ever ran. Some are finished work, some are experiments you
abandoned in ten minutes, and `/resume` shows them as an undifferentiated wall of
timestamps.

The usual answer is a hook that injects a state script into every session — around 400
tokens, on the first turn, forever. This plugin takes the opposite bet:

- **Zero tokens by default.** No `before_agent_start` injection, ever.
- **Opt-in only.** Commands run when you ask; closing a session asks nothing.
- **Reversible.** Nothing is deleted. Closed sessions move to a plugin-owned trash
  directory, with a byte-for-byte backup taken before any write, and come back with one
  command.

## Requirements

| | |
| :--- | :--- |
| **Pi** | `>=1.2.0` |
| **Node.js** | `>=22.19.0` (the floor in `engines`; the [security baseline](SECURITY.md#supported-runtime) is higher) |
| **Runtime dependencies** | none — Pi already provides the libraries |

## Install

```bash
pi install git:github.com/clezappdev-alt/pi-session-scrub@v0.6.1
```

Then enable it in `pi config` and reload. Install a **tag**, never `master`: a git ref is
pinned, and `pi update --extensions` reconciles the checkout without moving the ref you
chose.

To try it without installing anything:

```bash
pi -e ./extensions/session-scrub/index.ts    # from a clone, then /reload
```

## Commands

Every one of them is explicit. None runs on its own.

| Command | What it does |
| :--- | :--- |
| `/scrub:audit` | Read-only table of this project's sessions: which are live, named, kept, or actionable. Never mutates, never prompts |
| `/scrub:apply [--dry-run]` | Move the actionable ones to the trash, one confirmation per session. Dry-run first. Non-TUI modes are always dry-run |
| `/scrub:restore` | Move trashed sessions back. Never overwrites a file that reappeared in the meantime |
| `/scrub:triage [--apply]` | Assisted triage: read-only digest packs, your judgment in chat, then verdicts written with per-item confirmation |
| `/scrub:adopt [--apply]` | Give sessions from before the naming convention a state prefix. Never rewrites the text after it |
| `/scrub:init` | Append the opt-in policy block to the project's `AGENTS.md`. Idempotent, and refuses if a block is already there |
| `/scrub:handoff` | Create the continuation this session promised: a new session, named and seeded |
| `scrub_mark` (tool) | Record a verdict on this session. Stored as a custom entry, never in the model's context |
| `scrub_close` (tool) | Name this session in one glanceable line: `pausa`, `abierto`, `espera`, `hecho` |
| naming hint | Once per unnamed session the status bar suggests a slug from your first message. It never renames anything by itself |

## How a session is judged

A verdict is evidence, and `scrub_mark` records it. What each one unlocks:

| Verdict | Meaning | Trashable |
| :--- | :--- | :--- |
| `keep` | Work worth preserving | Never |
| `paused` | Stopped, will continue | No |
| `finished` | The work is done | Yes |
| `ephemeral` | Ran one of the project's ephemeral flows | Yes |
| `trash` | Explicitly condemned, even if named | Yes |

Three rules hold regardless of the table:

- **An unnamed session is never inferred trashable.** A session that is merely old is not
  `pausa:`; it is old.
- **The live session is never a target.** Name it with `scrub_close` instead.
- **`traspaso:` has one writer.** Only `/scrub:handoff` writes it, and only after the
  continuation exists.

## What it touches

| | Path | What |
| :--- | :--- | :--- |
| reads | `<pi-runtime>/sessions/--<project>--/*.jsonl` | session files: names, counts, first and last text, its own custom entries |
| writes | the same files | one appended entry per name or verdict — never a rewrite |
| writes | `<pi-runtime>/session-scrub-backups/--<project>--/` | a byte-for-byte copy taken immediately before each write |
| writes | `<pi-runtime>/session-scrub-trash/--<project>--/` | sessions moved out of Pi's directory by `/scrub:apply` |
| writes | `<project>/AGENTS.md` | only on `/scrub:init`, appending one delimited block |

**No network. No `child_process`. No `eval`.** Moves are `rename`, so a restored session
keeps its inode and mtime. Nothing is ever purged — and because the trash holds ordinary
`.jsonl` files, you can always recover one by hand with `mv`. [`SECURITY.md`](SECURITY.md)
has the full data map, the guards, and how to report a vulnerability privately.

## Development

```bash
npm ci --ignore-scripts    # from the committed lockfile; dependency scripts never run
npm run check              # strict typecheck, then the test suite
pi -e ./extensions/session-scrub/index.ts   # iterate, then /reload
```

One command verifies everything, on the compatibility floor and the current LTS, with no
globally installed toolchain. Setup, the fork flow and what a pull request must contain
are in [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Support

- **Bugs and feature requests:** the [issue tracker](https://github.com/clezappdev-alt/pi-session-scrub/issues).
  A reproduction is what moves an issue fastest.
- **Security problems:** privately, through
  [GitHub Security Advisories](https://github.com/clezappdev-alt/pi-session-scrub/security/advisories/new) —
  never a public issue.
- **Response:** best effort, no SLA. This is a personal project kept in the open.

## Status and license

> Anchored to the released tag `v0.6.1`.

**Beta.** The command surface is usable daily and still changes between minor versions;
install a tag and read the [`CHANGELOG`](CHANGELOG.md) before updating.

MIT — see [`LICENSE`](LICENSE). The plugin is built with
[Gentle-AI](https://github.com/Gentleman-Programming/gentle-ai).

Owner-facing guides, in Spanish: [`docs/guide.md`](docs/guide.md) (usage),
[`docs/behavior.md`](docs/behavior.md) (as-built specification),
[`docs/glossary.md`](docs/glossary.md) (vocabulary).
