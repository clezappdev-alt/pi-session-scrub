# Design — session continuity

**Change ID:** `session-scrub-naming` · **Date:** 2026-10-07
**Status:** approved in conversation, not yet built. Slices below.

## The problem, restated

The owner's need is **continuity**, not labelling: given a session in `/resume`, what was
last done, what is next, and whether it ended intending to continue elsewhere.

That data already exists — `scrub_mark` verdicts carry a verdict and a reason — but it is
invisible where the owner looks. And the picker cannot be extended: `session-selector.js`
builds its label as `(session.name ?? session.firstMessage)` and there is **no extension
hook for per-session labels**. Renderers exist for messages, entries and tools, not for
picker rows.

**Therefore the session name is the only channel.** Everything below follows from that.

## The organizing rule

One question partitions all states:

> **Where does what comes next live?**

| state | the next step lives… | example |
|---|---|---|
| `pausa:` | here, and you know it | `falta escribir el spec de naming` |
| `abierto:` | here, but you don't | `revisando el parser de triage` |
| `espera:` | somewhere you don't control | `veredicto de F2, decisión del owner` |
| `traspaso:` | **in another session** | `naming slice · falta NM-01..03` |
| `hecho:` | nowhere | `triage UX 0.3.0 instalado y verificado` |
| *(no prefix)* | nobody declared anything | dirty |

**Exclusivity test:** if two states can hold at once, the boundary is wrong.
`pausa`+`espera` cannot (the step is yours and known vs. not yours). `pausa`+`traspaso`
cannot (same session vs. another). `traspaso`+`hecho` cannot (continues vs. ends).

This is what `pausa` and `abierto` were missing. They looked identical because they were
split on nothing; they are split on whether the next step is known.

## Single carrier, on purpose

The verdict entry and the session name could both hold the state. They must not.

Two write paths exist: the plugin's tool, and Pi's own `/name`. If both write, the name is
a denormalised copy of the entry and they diverge the moment one write is skipped — leaving
a stale promise visible in `/resume`, which is worse than no name because it is trusted.

So: **the name is the record.** The plugin derives the verdict by parsing the prefix when
`/scrub` runs. Divergence is impossible because there is one writer — a human, typing
`/name`, which is native Pi.

**Cost, stated plainly:** the reason must live inside the name, and the name is what the
picker renders. `session-selector.js` applies no length limit (truncation is terminal-width
visual), so long reasons survive in the file but get cut on screen.

## Naming the live session

`ExtensionAPI.setSessionName(name)` exists — `core/extensions/types.d.ts:1239`, documented
*"Set the session display name (shown in session selector)"*, and exposed again on
`ExtensionActions`. It delegates to `AgentSession.setSessionName` → `appendSessionInfo`.

**This is the same call `/name` makes, so it is safe on a live session**: Pi updates memory
and disk together, so there is no flush race. The by-path write to *other* sessions is the
one that needs NM-01..NM-03, and it stays.

## Traspaso: executable, not decorative

`ctx.newSession({ parentSession?, setup?, withSession? })` is available to extension
commands. `setup` receives a **mutable** `SessionManager` (not the read-only one on `ctx`),
so the destination can be seeded and named at creation.

### The context tier nobody expects

`sessionEntryToContextMessages` (`core/session-manager.js`) decides what the model sees:

| entry type | reaches the LLM | visible in TUI |
|---|---|---|
| `message` | yes | yes |
| **`custom_message`** | **yes** | via `display: boolean` |
| `branch_summary`, `compaction` | yes | yes |
| plain `custom` | **no** — `return []` | via renderer |

The source comment is explicit: *"Plain custom entries are display/state entries and do not
participate in context."*

`CustomMessageEntry` is `{ customType, content, details?, display }` and `appendMessage`
accepts it. So a `custom_message` with `display: false` gives the new session's agent the
handoff context on its first token **without** rendering anything in the transcript.

That resolves the false dilemma between "silent but needs re-injection later" (custom
plain) and "immediate but permanent and visible" (normal message). This is neither: the
agent knows, the human sees nothing, nothing is re-injected.

**Accepted cost:** the message stays in that session's context for every later turn. It is
a few lines, not the ~400 tokens/turn that killed `session-hygiene`. The magnitudes are not
comparable, and the constraint `zero-tokens-by-default-no-before_agent_start-injection`
is not violated because nothing is injected per turn.

## The memory key: deterministic, no model in the loop

The agent already saves what remains before closing — that is in the Engram session-close
protocol every session receives. The owner only adds the nuance: *"we'll continue in a new
session."*

The plugin never calls Engram (it cannot; separate packages). It **observes**:

- `tool_call` carries `toolName` and `input`.
- `tool_result` carries `input`, `content` and `structuredContent` — the created id and
  `topic_key`.

> **Rule: the last memory written before a `traspaso:` is the traspaso.**

No scoring, no ranking, no agent judgment. Deterministic, zero tokens, one sentence to
justify.

The handoff message carries: origin session id, the memory's id and `topic_key`, and the
next step. The new session's agent retrieves with `mem_get_observation`.

**Bonus:** the handoff survives compaction of the origin session, because the memory
outlives the context.

**Coupling is soft:** tools are matched by the `mem_` prefix. If Engram is absent the
feature no-ops. This dependency is declared, not hidden.

## Sanitization

Applies the convention to sessions that predate the plugin or drifted from it. Because
sanitising means renaming sessions a human wrote, **the human layer is never rewritten**:

- the plugin **proposes** a prefix for unprefixed sessions
- the human accepts, or types `/name` directly
- machine-derivable states may be filled without a prompt (e.g. an existing `finished`
  verdict maps to `hecho:`); invented states may not — a session that is merely older than
  seven days is **not** `pausa:`

## Slices

| slice | delivers | needs |
|---|---|---|
| **A — convention** | prefix parse/format, verdict derivation, proposal text from `topic_key` | nothing |
| **B — name the live session** | close a block, set the name | A |
| **C — traspaso** | `newSession` + seeded `custom_message` + memory observation | A, B, memory hook |
| **D — bulk sanitization** | the existing NM-01..NM-03 by-path path, applied in bulk | A, B |

A is the smallest thing that delivers value and unblocks the rest. B is nearly trivial once
A exists. C is where the risk is. D is already specified.

## Explicitly not doing

- No `before_agent_start` injection. The owner asks the agent, so the agent acts; nothing
  is injected per turn.
- No model call inside the plugin. Facts are deterministic; the agent chooses text when the
  owner asks it to.
- No rewriting of the human text portion of a name. Ever.