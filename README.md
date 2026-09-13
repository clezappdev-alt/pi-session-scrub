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
