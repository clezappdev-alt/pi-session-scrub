# pi-session-scrub

Keep your Pi `/resume` list clean and descriptive — without the per-session opening ceremony.

## Why

The old `session-hygiene` hook injected ~400 tokens on every first turn
(state script + registry read + Door A/B question). This package does the
opposite:

- **Zero tokens by default.** No `before_agent_start` injection, ever.
- **Opt-in only.** Two commands, explicit user action.
- **Deterministic first.** Uses `SessionManager.list()` — no bash JSONL parsing,
  no LLM in the loop for mechanical work.

## Commands

- `/scrub` — read-only audit of this project's sessions (counts + trashables).
- `/scrub-apply` — dry-run first, then trash closed trashables via `trash` CLI (reversible 30d).

## Design rules (v2)

1. Never name automatically with the LLM. Suggest a deterministic slug from the
   first user message; user confirms with `/name`.
2. Never delete at startup. Delete only via explicit `/scrub-apply` on CLOSED sessions.
3. `session_shutdown` asks keep-vs-trash via `ctx.ui.confirm` — no model tokens.
4. No registry files. Source of truth is the session dir itself.

## Dev

```bash
# iterate locally without installing
pi -e /home/cleceta/AI_projects_V3/PI_Agent-MyPlugins/session-scrub/extensions/session-scrub/index.ts

# install for real (global)
pi install /home/cleceta/AI_projects_V3/PI_Agent-MyPlugins/session-scrub
```
