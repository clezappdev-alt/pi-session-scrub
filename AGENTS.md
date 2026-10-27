# pi-session-scrub — AGENTS.md

Micro-extension for Pi. Keeps the `/resume` list clean and descriptive
with **zero ceremony and zero tokens by default**.

Authoritative plugin knowledge is the global skill `pi-plugin-dev`, distilled from
https://pi.dev/docs/latest — read that before changing extension code or
packaging. If you do not have the skill, the upstream docs are the same source.

The problem to solve lives in `PRD.md` — input for this project’s SDD flow,
not decisions. This file is the working contract: repo layout and workflow.

## Structure

```
session-scrub/                  ← this repo, its own git root
├── AGENTS.md                   ← THIS file
├── README.md                   ← external face: install, commands, support
├── CONTRIBUTING.md             ← setup, the check command, the fork flow
├── SECURITY.md                 ← disclosure channel, data map, runtime baseline
├── LICENSE, CODE_OF_CONDUCT.md, CHANGELOG.md
├── PRD.md                      ← product requirements (problem + context, no decisions)
├── .github/                    ← CI workflow, issue templates, PR template
├── .gitignore                  ← local-only: .agents/ scratch/ odd/ *.local.md
├── tsconfig.json               ← strict typecheck, no build step
└── extensions/
    └── session-scrub/
        ├── index.ts            ← the extension entry point (Pi host)
        └── *.ts, *.test.ts     ← host-free modules and their tests
```

## Conventions

- Code, comments, identifiers, commits: **English**. Human docs: neutral Spanish ok.
- Personal projects created by the user sign author as `clezapp` in any author field (`package.json`, manifests, headers, docs). Never use `cleceta`.
- TypeScript strict, no new runtime deps without reason.
  Core Pi libs in `peerDependencies: *`, never bundled (skill `pi-packages`).

## Hard rules

- Meta and code NEVER share a commit: meta changes and implementation changes
  go in SEPARATE commits (work-unit-commits), so gentle-ai reviews see code only.

## Artifact store — who owns what

Two stores, one owner each. They never duplicate each other:

| Question | Lives in | Rule |
| --- | --- | --- |
| What must the product do? Requirements, accepted deviations, decisions | `openspec/` (tracked, reviewed, archived) | the only authority |
| What is this change delivering, and in what order? | `openspec/changes/<change>/tasks.md` | the one task ledger |
| What was asked, what was measured, what was committed — the session journal | `odd/tasks/` (git-ignored) | pointers only: never a copied requirement, never a second task list |

A change opens with **`spec.md` (the requirement delta) and `tasks.md`**. Proposal, design,
verify-report, sync-report and archive-report are for changes big enough to earn them, not
the default. `openspec/changes/archive/` is frozen history and is never maintained.

### Tracked config vs machine config

`openspec/config.yaml` is tracked, so it carries **only facts that are true in every
clone**: the project, the paths relative to the repo root, the exact verification
commands, the constraints. A machine-scoped pointer — an absolute root, a path under
a home directory, a list of locally installed skills — belongs in
`openspec/config.local.yaml`, which is git-ignored. A stranger cloning this repo gets
nothing about someone else's machine, and nothing here breaks when the repo moves.

**Why requirements stay tracked.** The naming block once shipped with no requirement at all
and nobody noticed for twelve days; the canonical spec is what later let a read find
`REQ-03`, a requirement that described a parser the code never had. A requirement that
lives only in an ignored file cannot be diffed, reviewed or blamed — and its only copy is
a local database.

## Decision gates

| Situation | Action |
| --- | --- |
| Pi API doubt | Re-read global skill `references/`, never guess from memory |
| Behavior change vs hint tweak | Behavior → SDD flow (`PRD.md` is the input); hint → iterate with `/reload` |

## How to work here

1. Read the global `pi-plugin-dev` skill first (or the upstream docs it distills), then the matching `references/`.
2. Iterate without installing:
   `pi -e ./extensions/session-scrub/index.ts`, then `/reload`.
3. Verify as a stranger would: `npm ci --ignore-scripts && npm run check`.
4. Install for real (global) only on tagged versions:
   `pi install git:github.com/clezappdev-alt/pi-session-scrub@<tag>`; toggle with `pi config`.

<!-- pi-session-scrub:start -->
# session-scrub policy — project-local, opt-in, one block per project.
# Everything here but one key is written for the AGENT, not for the extension:
# it is the standing order for when to use scrub_mark and scrub_close.
#
# VERDICTS (record via the scrub_mark tool, with an optional reason):
#   keep      — this session holds work worth preserving; never a trash candidate.
#   paused    — block closure: work stopped but WILL continue later; not a candidate.
#   finished  — session closure: the work is done; the session becomes a trash candidate.
#   ephemeral — this session ran one of the ephemeral flows below; trash candidate.
#   trash     — explicitly condemned; trash candidate even if the session is named.
#
# WHEN TO MARK:
#   session_rename — when this session gets named or renamed (/name), record keep ONLY if the new name declares no state (see PRECEDENCE).
#   block_close    — when work pauses with intent to resume, record paused.
#   session_close  — when the work is done, record finished.
#   ephemeral flow — when the session invokes a flow listed in ephemeral-flows, record ephemeral.
#
# PRECEDENCE — the name is the record. A name that starts with a state already IS
# that session's verdict, so scrub_mark refuses there on purpose: nothing is missing
# and nothing needs marking. Record a verdict only when the name declares no state.
# What each state already resolves:
#   pausa, espera   -> paused
#   abierto         -> keep
#   hecho, traspaso -> finished
#
# EPHEMERAL FLOWS — the only key the extension itself reads. Exact skill-flow
# names as invoked (the name after /skill:), comma-separated. ONLY these
# flows ever qualify a session as ephemeral. Leave the placeholders if none.
verdicts: keep | paused | finished | ephemeral | trash
mark-on: session_rename, block_close, session_close
ephemeral-flows: <flow-name-1>, <flow-name-2>
<!-- pi-session-scrub:end -->
