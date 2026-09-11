# pi-session-scrub — AGENTS.md

Micro-plugin for Pi. Keeps the `/resume` list clean and descriptive
with **zero ceremony and zero tokens by default**.

Authoritative plugin knowledge is the GLOBAL skill `pi-plugin-dev`
(`~/.pi/agent/skills/pi-plugin-dev/`, distilled from https://pi.dev/docs/latest,
2026-09-11, visible from every project). Read it (`/skill:pi-plugin-dev`)
before changing extension code or packaging.

The problem to solve lives in `PRD.md` — input for this project’s SDD flow,
not decisions. This file is the working contract: repo layout and workflow.

## Structure

```
PI_Agent-MyPlugins/              ← container (own repo, this dir EXCLUDED via its .gitignore)
└── session-scrub/               ← INDEPENDENT git root (own Engram project)
    ├── AGENTS.md                ← THIS file
    ├── README.md                ← human-facing install/usage
    ├── package.json             ← pi-package manifest (extensions entry)
    ├── PRD.md                  ← product requirements (problem + context, no decisions)
    ├── .gitignore               ← local-only: .agents/ scratch/ *.local.md
    └── extensions/
        └── session-scrub/
            └── index.ts
```

## Conventions

- Code, comments, identifiers, commits: **English**. Human docs: neutral Spanish ok.
- Personal projects created by the user sign author as `clezapp` in any author field (`package.json`, manifests, headers, docs). Never use `cleceta`.
- TypeScript strict, no new runtime deps without reason.
  Core Pi libs in `peerDependencies: *`, never bundled (skill `pi-packages`).

## Hard rules

- Meta and code NEVER share a commit: meta changes and implementation changes
  go in SEPARATE commits (work-unit-commits), so gentle-ai reviews see code only.

## Decision gates

| Situation | Action |
| --- | --- |
| Pi API doubt | Re-read global skill `references/`, never guess from memory |
| Behavior change vs hint tweak | Behavior → SDD flow (`PRD.md` is the input); hint → iterate with `/reload` |

## How to work here

1. Read the global `pi-plugin-dev` skill first (`/skill:pi-plugin-dev`), then the matching `references/`.
2. Iterate without installing:
   `pi -e <repo>/session-scrub/extensions/session-scrub/index.ts`, then `/reload`.
3. Install for real (global) only on tagged versions:
   `pi install <repo>/session-scrub`; toggle with `pi config`.
