# pi-session-scrub

Keep your Pi `/resume` list clean, descriptive and honest. Zero tokens by default,
opt-in commands only, and nothing deleted by surprise.

<img src="https://img.shields.io/badge/status-beta-2F7A6F?style=flat-square" alt="Status: beta"> · `v0.6.1` · MIT · Node `>=22.19.0` · Pi `>=1.2.0`

[Why](#why) · [Install](#install) · [First ten minutes](#first-ten-minutes) ·
[Commands](#commands) · [The agent's half](#the-agents-half) ·
[Between sessions](#between-sessions) · [What it touches](#what-it-touches) ·
[Development](#development) · [Support](#support) · [Read more](#read-more) ·
[Status](#status-and-license)

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

A session's name carries its state, and that is what you see in the picker:

`pausa: fix the parser` · `hecho: release 0.4.0` · `espera: upstream answer`

## Install

`Pi >=1.2.0` · `Node >=22.19.0` · no runtime dependencies — Pi already provides the
libraries. The floor in `engines` is not the whole story: the
[security baseline](SECURITY.md#supported-runtime) is higher.

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

## First ten minutes

No setup step is required. Install it, reload, and the first few commands are a loop you
can guess:

```bash
/scrub:audit                # what this project's /resume list holds, and how it reads
/scrub:triage               # read the digest packs; judge the sessions that declare nothing
/scrub:triage --apply 01a1:finished:"PR merged"   # write the verdicts you decided
/scrub:apply --dry-run      # what would move — and nothing moves
/scrub:apply                # move it, one confirmation per session
```

`/scrub:restore` undoes any of it. None of that is required, and none of it runs on its own:
if you never type a command, the plugin never writes.

Three rules worth knowing before the first `apply`:

- **Your live session is never a target.** To name it, use `scrub_close` or `/name`.
- **A named session is protected.** Only an explicit `trash` verdict makes it a candidate.
- **An unnamed session is never inferred trashable.** Old is not `pausa:` — it is old.

Two optional, once-per-project steps sit outside the loop:

| Step | When it earns its place |
| :--- | :--- |
| `/scrub:adopt` | You have sessions from before the naming convention. Adds the state prefix, never rewrites the text |
| `/scrub:init` | You want the agent to mark and close sessions **without being asked every time**. See [The agent's half](#the-agents-half) |

## Commands

Every one of them is explicit. None runs on its own. The table is ordered by **when** you
reach for a command, not by importance:

| When | Command | What it does |
| :--- | :--- | :--- |
| **Once per project** | `/scrub:adopt [--apply]` | Give sessions from before the naming convention a state prefix. Never rewrites the text after it |
| | `/scrub:init [--dry-run] [--update]` | Append the opt-in policy block to the project's `AGENTS.md`. A first run appends and refuses when a block is already there; `--update` refreshes that block to the current template, showing the diff and keeping your `ephemeral-flows:` |
| **When the list has grown** | `/scrub:audit` | Read-only table of this project's sessions: which are live, named, kept, or actionable. Never mutates, never prompts |
| | `/scrub:triage [--apply …]` | Assisted triage: read-only digest packs, your judgment in chat, then verdicts written with per-item confirmation |
| | `/scrub:apply [--dry-run]` | Move the actionable ones to the trash, one confirmation per session |
| **When you regret it** | `/scrub:restore` | Move trashed sessions back. Never overwrites a file that reappeared in the meantime |
| **When a block closes** | `/scrub:handoff [next step]` | Create the continuation this session promised — see [Between sessions](#between-sessions) |

Two safety rules hold on every write path, and neither is a convenience you can skip:

- **Non-TUI is always dry-run.** Under `--mode rpc`, `print` or `json` nobody can answer a
  confirmation, so `/scrub:apply`, `/scrub:triage --apply`, `/scrub:restore`, `/scrub:init`
  and `/scrub:adopt` all stop before writing. There is no flag to bypass it.
- **`--dry-run` before the real thing.** `/scrub:apply`, `/scrub:triage` and `/scrub:init`
  accept it; `/scrub:adopt` is dry-run until you pass `--apply`.

A naming hint runs alongside: once per unnamed session, the status bar suggests a slug
from your first message (`suggested: /name <slug>`). It never renames anything by itself.

Flags and edge cases per command, with examples: [`docs/guide.md`](docs/guide.md).

## The agent's half

The plugin injects nothing into the model's context, so the agent will not reach for its
two tools unless something tells it to: **you, in chat**, or **the project's policy block**,
written with `/scrub:init` and refreshed with `/scrub:init --update` when the template
changes.

| Tool | What it does |
| :--- | :--- |
| `scrub_mark` | Records a verdict — `keep`, `paused`, `finished`, `ephemeral`, `trash` — with an optional reason |
| `scrub_close` | Names this session in one glanceable line: `pausa`, `abierto`, `espera`, `hecho` |

The split between what the agent can do and what only you can do is the host's shape, not
a preference: tools act on the current session, while creating a session and running a
command need the command context. A handoff is therefore always two actors — **"prepare
the handoff" is a request to the agent; the handoff itself is your command.**

Two tools also carry the project's only machine-read configuration: `ephemeral-flows:`,
one line in the policy block that names the skill flows you consider disposable. Everything
else in the block is a standing order for the agent, not configuration for the plugin.

## Between sessions

Work rarely ends; it pauses. `/scrub:handoff` creates the continuation instead of asking
you to reconstruct the thread tomorrow:

```
/scrub:handoff finish the migration, then run the suite
```

It reads the next step from the argument or from this session's name, and **no next step
means no new session**. The order is the guarantee: the destination is created, seeded and
named first, and this session becomes `traspaso:` last, so cancelling writes nothing.

Only pointers travel — the origin's short id and name, the next step, and the last memory
you wrote there. **The conversation never travels**, so a long session does not become two
long sessions.

The full chapter — when to use it, what the picker looks like afterwards, and its traps —
is in [`docs/guide.md` §6](docs/guide.md).

## What it touches

| | Path | What |
| :--- | :--- | :--- |
| reads | `<pi-runtime>/sessions/--<project>--/*.jsonl` | session files: names, counts, first and last text, its own custom entries |
| writes | the same files | one appended entry per name, verdict or handoff seed — never a rewrite |
| writes | `<pi-runtime>/session-scrub-backups/--<project>--/` | a byte-for-byte copy taken immediately before each write |
| writes | `<pi-runtime>/session-scrub-trash/--<project>--/` | sessions moved out of Pi's directory by `/scrub:apply` |
| writes | `<project>/AGENTS.md` | only on `/scrub:init`: one delimited block appended, or that block replaced by `--update` after a copy lands in the backups root |

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

## Read more

| Document | Language | What it is |
| :--- | :--- | :--- |
| [`docs/guide.md`](docs/guide.md) | Spanish | The usage manual: every command and flag, the workflows, handoffs, recipes |
| [`docs/behavior.md`](docs/behavior.md) | English | The as-built specification, anchored to the released tag and checked against the code |
| [`docs/glossary.md`](docs/glossary.md) | Spanish | The shared vocabulary, one term per line, with the line of code that backs it |

## Status and license

> Anchored to the released tag `v0.6.1`.

**Beta.** The command surface is usable daily and still changes between minor versions;
install a tag and read the [`CHANGELOG`](CHANGELOG.md) before updating.

MIT — see [`LICENSE`](LICENSE).

<a href="https://github.com/Gentleman-Programming/gentle-ai">
  <img width="180" src="https://raw.githubusercontent.com/Gentleman-Programming/gentle-ai/main/docs/assets/brand/built-with-gentle-ai.png" alt="Built with Gentle-AI" />
</a>
