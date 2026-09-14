# pi-session-scrub

Keep your Pi `/resume` list clean and descriptive — without the per-session opening ceremony.

## Why

The old `session-hygiene` hook injected ~400 tokens on every first turn
(state script + registry read + Door A/B question). This package does the
opposite:

- **Zero tokens by default.** No `before_agent_start` injection, ever.
- **Opt-in only.** Commands run on explicit user action; closing a session
  never asks anything.
- **Explicit and reversible.** Nothing is inferred trashable, nothing is
  deleted permanently: closed sessions move to a plugin-owned trash dir
  and can come back.

## Commands

- `/scrub` — read-only audit of this project's sessions. Classifies each one
  (`live`, `kept`, `named`, `candidate`, `auto-deletable`, `to review`).
  Never mutates, never prompts.
- `/scrub-apply [--dry-run]` — dry-run listing first, then per-item `confirm`
  and move to trash. In non-TUI modes (`rpc`, `json`, `print`) it is always
  dry-run: it never blocks waiting for input.
- `/scrub-restore` — list trashed sessions for this project and move selected
  ones back. Restoring does not clear verdicts: a restored `trash` candidate
  shows up as a candidate again until re-marked.
- `/scrub-init` — write the opt-in policy block into the project's `AGENTS.md`
  (idempotent; see below).
- `/scrub-triage [--apply]` — assisted triage of verdict-less sessions:
  bounded digest packs first (read-only), your judgment in chat, then
  `--apply` writes verdicts with per-item `confirm` (see below).

## Triage

Hybrid judgment: the command produces digest packs (quoted data, never
instructions), you judge in chat, then `--apply` writes your verdicts.

Phase 1 (read-only) prints a compact table by default (one line per session:
id, message count, age, name, grade → proposal), WEAK packs in full, and
up to 20 slots ordered WEAK-first with machine-keeps filling the rest.
`--verbose` prints full fenced `triage` packs for every slot (head = first
user message ≤300 chars; tail = last messages in chronological order
≤300 chars, front-truncated so the most recent text survives). Deferred
candidates are listed by shortId (`+N deferred: <ids> — triage these
first, then re-run`). Empty and ephemeral-flow sessions are skipped with
counts.

Each pack carries a grade, never a decision:

| Grade | Meaning |
|-------|---------|
| `machine` | Named session — presumed active, proposes `keep` |
| `WEAK` | Heuristic guess (`finished` if older than 7 days, else `paused`) — judge from the words, never auto-confirm |

Phase 2 (`/scrub-triage --apply <judgments>`) resolves each
`<idPrefix>:<verdict>:"<reason>"` against a fresh scan (unknown or
ambiguous prefixes rejected). WEAK verdicts ask per-item `confirm`;
machine-keeps can be confirmed in bulk with ONE confirm storing a fixed
dated rationale (`machine keep, bulk-confirmed <YYYY-MM-DD>`) in every
file. Reasonless `id:keep` is accepted only for machine-keeps (resolved
provenance); `finished`/`paused`/judged verdicts still require a reason.
Renames are own-line assignments (`<idPrefix>:name:"<slug>"`, trim +
non-empty, duplicates allowed like `/name`) with per-item confirms showing
existing → proposed, written via the same append-only entry `/name` uses
so `/resume` reflects them with zero friction. Every write re-checks for
a concurrent verdict right before appending. `trash` is never appliable
from triage. Reasons support backslash escapes (`\"` and `\\`) so
session text can be quoted verbatim. The summary breaks down the outcome
(`applied` + `already`, `declined`, `conflict`, `error`, renames
applied/declined/errored, with ids). Re-running after everything is
triaged prints `Nothing to triage.`

## Verdicts and the policy block

A session is only trashable when the evidence says so: explicitly marked
`trash`, finished work, an ephemeral skill flow, an empty session, or an old
session you confirm with full context. An unnamed session is **never**
inferred trashable; a named one only goes with an explicit `trash` verdict.

Verdicts (`keep`, `paused`, `finished`, `ephemeral`, `trash`) are recorded with
the `scrub_mark` tool and stored as custom entries inside the session file —
they never pollute LLM context. `/scrub-init` writes a delimited policy block
(`<!-- pi-session-scrub:start -->…end -->`) into the project's `AGENTS.md`
telling the agent when to mark (rename, block pause, session close) and which
skill flows count as ephemeral (`ephemeral-flows:`, filled per project).
No block = conservative defaults (no agent marking, no ephemeral candidates).

## Trash dir and recovery

```
~/.pi/agent/
├── sessions/--<project>--/          # Pi's storage (never touched directly)
└── session-scrub-trash/--<project>--/  # plugin-owned trash (atomic moves)
```

Recovery paths: `/scrub-restore`, or plain `mv` of the `.jsonl` file back at
any time. There is no automatic purge and no OS-trash involved: what the
plugin moves, the plugin (or you, with `mv`) can bring back.

## Naming hint

Once per unnamed session, the status bar suggests a deterministic slug from
your first message (`sugerido: /name <slug>`). You confirm with `/name`;
the plugin never renames anything by itself.

## Dev

```bash
# iterate locally without installing
pi -e ./extensions/session-scrub/index.ts

# install for real (global, tagged versions only)
pi install /home/cleceta/AI_projects_V3/PI_Agent-MyPlugins/session-scrub
```
