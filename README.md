# pi-session-scrub

Keep your Pi `/resume` list clean, descriptive and honest. Zero tokens by default,
opt-in commands only, and nothing deleted by surprise.

<img src="https://img.shields.io/badge/status-beta-2F7A6F?style=flat-square" alt="Status: beta"> · `v0.6.1` · MIT · Node `>=22.19.0` · Pi `>=1.2.0`

[Install](#install) · [First ten minutes](#first-ten-minutes) ·
[Working with the agent](#working-with-the-agent) · [Commands](#commands) ·
[Tools](#tools) · [Handoffs](#handoffs) ·
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

## First ten minutes

No setup step is required. Install it, reload, and the plugin is already usable — the first
few commands are a loop you can guess:

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
| `/scrub:init` | You want the agent to mark and close sessions **without being asked every time**. See [Working with the agent](#working-with-the-agent) |

## Working with the agent

The plugin injects nothing into the model's context, so the agent will not reach for its two
tools unless something tells it to. Two things can: **you, in chat**, or **the project's
policy block**, written once with `/scrub:init`.

The split between what the agent can do and what only you can do is the host's shape, not a
preference:

| | Who can run it | Why |
| :--- | :--- | :--- |
| `scrub_mark`, `scrub_close` | the agent, inside the session | they are tools |
| `/scrub:handoff` | **only you** | creating a session needs `ExtensionCommandContext`; a tool gets `ExtensionToolContext`, which cannot create one |
| `/scrub:audit`, `/scrub:triage`, `/scrub:apply`, `/scrub:restore`, `/scrub:adopt`, `/scrub:init` | **only you** | they are slash commands |

A handoff is therefore always two actors. **"Prepare the handoff" is a request to the agent;
the handoff itself is your command.**

### What to say

| You say | The agent calls | What you get |
| :--- | :--- | :--- |
| "close this block as `pausa:` review the diff of `render.ts`" | `scrub_close` with `state:"pausa"` | the `/resume` line says where the work continues |
| "mark this session finished" | `scrub_mark` with `verdict:"finished"` | a trash candidate, not an inference |
| "that was an ephemeral flow, mark it" | `scrub_mark` with `verdict:"ephemeral"` | the same, with the reason recorded |
| **"prepare the handoff"** | `scrub_close` with `state:"pausa"` and the next step, then tells you to run `/scrub:handoff` | the next step now lives in the session's name |
| "let's triage" | nothing — you run `/scrub:triage` and read the packs together | verdicts you decided, written per item |

### Three ordering traps

1. **Do not `/name` before asking for a verdict.** `scrub_mark` refuses when the name already
   declares a state — two records that disagree are worse than none — and points you at
   `scrub_close`, which is the only writer of names.
2. **Run `/scrub:handoff` with no argument when the agent already named the session.** It takes
   the next step from the name; the argument is only the shortcut for a name that carries none.
3. **The closing memory is the handoff's payload.** Only the last memory's topic key and title
   travel — never the conversation. That is why `scrub_close` insists the title describe the
   block's **state** (what is built, what is verified, what is next) and not the finding that
   started it.

### The policy block is a standing order, not configuration

`/scrub:init` appends one delimited block to the project's `AGENTS.md`. Pi loads that file as
project instructions, so the block reaches the model on **every** session of that project.
That is what "zero tokens by default" leaves in your hands: the plugin injects nothing, and
the file costs context because Pi loads it anyway.

The plugin itself reads exactly **one** key from the block:

| Key | Read by | Effect |
| :--- | :--- | :--- |
| `ephemeral-flows:` | the plugin | a `/skill:<flow>` mention makes that session `ephemeral` |
| `verdicts:`, `mark-on:`, the `#` lines | the **agent** | when to mark, and with which verdict |

Without the block the plugin falls back to no ephemeral flows, and the agent has no standing
order. The command runs once: a second `/scrub:init` reports the block's line and writes
nothing, so editing it afterwards is your job by hand.

## Commands

Every one of them is explicit. None runs on its own. The table is ordered by **when** you
reach for a command, not by importance:

| When | Command | What it does |
| :--- | :--- | :--- |
| **Once per project** | `/scrub:adopt [--apply]` | Give sessions from before the naming convention a state prefix. Never rewrites the text after it |
| | `/scrub:init [--dry-run]` | Append the opt-in policy block to the project's `AGENTS.md`. Idempotent, and refuses if a block is already there |
| **When the list has grown** | `/scrub:audit` | Read-only table of this project's sessions: which are live, named, kept, or actionable. Never mutates, never prompts |
| | `/scrub:triage [--apply …]` | Assisted triage: read-only digest packs, your judgment in chat, then verdicts written with per-item confirmation |
| | `/scrub:apply [--dry-run]` | Move the actionable ones to the trash, one confirmation per session |
| **When you regret it** | `/scrub:restore` | Move trashed sessions back. Never overwrites a file that reappeared in the meantime |
| **When a block closes** | `/scrub:handoff [next step]` | Create the continuation this session promised — see [Handoffs](#handoffs) |

Two safety rules hold on every write path, and neither is a convenience you can skip:

- **Non-TUI is always dry-run.** Under `--mode rpc`, `print` or `json` nobody can answer a
  confirmation, so `/scrub:apply`, `/scrub:triage --apply`, `/scrub:restore`, `/scrub:init`
  and `/scrub:adopt` all stop before writing. There is no flag to bypass it.
- **`--dry-run` before the real thing.** `/scrub:apply`, `/scrub:triage` and `/scrub:init`
  accept it; `/scrub:adopt` is dry-run until you pass `--apply`.

A naming hint runs alongside: once per unnamed session, the status bar suggests a slug
from your first message (`suggested: /name <slug>`). It never renames anything by itself.

## Tools

Two tools, for the agent to use when you ask it to judge or close a session — see
[Working with the agent](#working-with-the-agent) for the phrases that trigger them. Both
write through Pi's own session API, so the `/resume` picker and the file update together.

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

Two actors, two steps: **you ask the agent to prepare it**, the agent names this session
`pausa: <next step>` with `scrub_close`, and **then you run `/scrub:handoff`** — with no
argument, because the name now carries the step. It cannot be a tool: creating a session
needs the command context.

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
