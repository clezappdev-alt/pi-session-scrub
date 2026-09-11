# pi-session-scrub — PRD (Product Requirements Document)

Status: draft · Version: 0.1 · Date: 2026-09-11

Problem requirements for the gentle-ai orchestrator of this project. This
document presents the PROBLEM and the context — nothing else. The SOLUTION
(proposal → spec → design → tasks) is the orchestrator's work.

## Problem

1. The `/resume` session list rots: unnamed sessions pile up, finished work is
   indistinguishable from open work, and finding anything gets slower over time.
2. The previous attempt (`session-hygiene` hook) made it worse: ~400 tokens of
   ceremony injected into every first turn, blocking real work. It was disabled.
3. Any mechanism living inside the session loop risks repeating that mistake:
   whatever runs by default competes with the user's actual task for attention
   and tokens.
4. Cleanup is risky by nature: the live session and valuable closed sessions
   must never be destroyed by automation.

## Target platform

Pi Agent (`@earendil-works/pi-coding-agent`): the plugin runs inside Pi as a
TypeScript extension. Everything Pi loads — extensions, host APIs, UI toolkit
— is TypeScript executed via jiti (no compilation step).

## Implementation requirements

- Language: TypeScript strict. Entry point: default-exported factory
  `extensions/<name>/index.ts` receiving `ExtensionAPI`.
- No compilation: code runs through jiti; only `.ts`/`.js` loadable, no build step.
- Pi core libraries (`@earendil-works/pi-coding-agent`, `typebox`,
  `@earendil-works/pi-tui`, …) are host-provided: `peerDependencies: "*"`,
  never bundled. Third-party runtime deps go in `dependencies`.
- Distribution: standard pi-package (`package.json` `pi` manifest +
  `pi-package` keyword), installable via `pi install` (npm / git / path).

## Goal

The `/resume` list stays clean and descriptive over time, at zero cost to the
user when they don't ask for it.

## Context

- Prior art in this repo: `extensions/session-scrub/index.ts` (v0 stub only —
  reference of what was tried, not direction).
- Knowledge: global skill `pi-plugin-dev` (`/skill:pi-plugin-dev`) — extensions,
  packages, session format, distilled from https://pi.dev/docs/latest (2026-09-11).

## Open questions (orchestrator's work)

- How is cleanup triggered, and what is it called?
- What qualifies as cleanable, and what must never be touched?
- How is destruction kept explicit and reversible?
- Who names sessions, and how are names confirmed?
- Should closing a session ask anything?
- Per-project scope only, or also a global view?

## Non-goals

- No registries, no batch bash scripts, no startup ritual — ever again.
- No duplicated Pi API docs (live in the global skill).
