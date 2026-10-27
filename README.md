# pi-session-scrub

Keep your Pi `/resume` list clean, descriptive and honest. Zero tokens by default,
opt-in commands only, and nothing deleted by surprise.

<img src="https://img.shields.io/badge/status-beta-2F7A6F?style=flat-square" alt="Status: beta"> · `v0.6.1` · MIT · Node `>=22.19.0` · Pi `>=1.2.0`

[Install](#install) · [Commands](#commands) · [Tools](#tools) · [Handoffs](#handoffs) ·
[How a session is judged](#how-a-session-is-judged) · [What it touches](#what-it-touches)

---

## Why

Pi keeps every session you ever ran. Some are finished work, some are experiments you
abandoned in ten minutes, and `/resume` shows them all the same way — a list you scroll
past instead of a list you use.

This plugin gives that list a vocabulary, and it costs nothing until you ask:

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
| `/scrub:handoff` | Create the continuation this session promised — see [Handoffs](#handoffs) |

A naming hint runs alongside: once per unnamed session, the status bar suggests a slug
from your first message. It never renames anything by itself.

## Tools

Two tools, for the agent to use when you ask it to judge or close a session. Both write
through Pi's own session API, so the `/resume` picker and the file update together.

| Tool | What it does |
| :--- | :--- |
| `scrub_mark` | Records a verdict — `keep`, `paused`, `finished`, `ephemeral`, `trash` — with an optional reason |
| `scrub_close` | Names this session in one glanceable line: `pausa`, `abierto`, `espera`, `hecho` |

**`scrub_mark` never rewrites.** Each call appends a `version: 1` entry with an ISO
timestamp, and the latest one wins on read. It lives as a custom entry, so a verdict
never enters the model's context. If the session's name already declares a state, it
refuses — the name is the record, and writing a verdict that could not take effect would
be a lie.

**`scrub_close` keeps the lineage head.** It replaces the free text and preserves the
head whole — `desde <parent> · <self> ·` — because that head is the only thing in the
picker that says where the work came from. It never invents a token, and it strips a
head-shaped prefix from the incoming text instead of stacking two. `traspaso` is
deliberately **not** offered: it asserts a continuation in another session, and only
`/scrub:handoff` can know that, because only the handoff creates it. While a handoff is
pending, the honest state is `pausa`.

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

## Handoffs

Work rarely ends; it pauses. `/scrub:handoff` creates the continuation instead of asking
you to reconstruct the thread tomorrow:

```
/scrub:handoff finish the migration, then run the suite
```

The next step comes from the argument, or from this session's name. **No next step, no
session** — it refuses and creates nothing.

What it does, and the order is the guarantee:

1. **The destination is created, seeded and named first**:
   `pausa: desde <abbr> · <next step>`. The origin's state is never copied forward, because
   the five states are exclusive.
2. **The origin becomes the promise, last**: `traspaso: <abbr> · <next step>`, written by
   path rather than through the live-session call, because after the switch the origin is
   not the live session any more.
3. **Cancelling writes nothing.** A cancelled handoff leaves both sessions exactly as they
   were: no half-marker, no orphan pointing at a session that was never created.

**What travels.** One `display: false` custom message, carrying pointers only: the
origin's short id and name, the next step, and — when the session contains one — the last
memory you wrote there, as topic key and title. **The conversation never travels**, so a
long session does not become two long sessions, and nothing is duplicated.

**The lineage survives.** If this session already came from another, the origin is
re-written as `traspaso: desde <parent> · <abbr> · <next>` so the parent stays visible in
the picker, and the new session points back at the one it came from. `<abbr>` is the
shortest unique abbreviation over the project, not a fixed slice: measured, two handoffs
four seconds apart shared their first eight characters, and a fixed slice would have
pointed the child's marker at the child itself.

## What it touches

| | Path | What |
| :--- | :--- | :--- |
| reads | `<pi-runtime>/sessions/--<project>--/*.jsonl` | session files: names, counts, first and last text, its own custom entries |
| writes | the same files | one appended entry per name, verdict or handoff seed — never a rewrite |
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

MIT — see [`LICENSE`](LICENSE).

<a href="https://github.com/Gentleman-Programming/gentle-ai">
  <img width="180" src="https://raw.githubusercontent.com/Gentleman-Programming/gentle-ai/main/docs/assets/brand/built-with-gentle-ai.png" alt="Built with Gentle-AI" />
</a>

Owner-facing guides, in Spanish: [`docs/guide.md`](docs/guide.md) (usage),
[`docs/behavior.md`](docs/behavior.md) (as-built specification),
[`docs/glossary.md`](docs/glossary.md) (vocabulary).
