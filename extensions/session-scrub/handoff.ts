// pi-session-scrub — the traspaso payload.
//
// `ctx.newSession({ parentSession?, setup?, withSession? })` is available to extension
// commands. `setup` receives a *mutable* SessionManager — not the read-only one on ctx —
// so the destination can be seeded and named at creation.
//
// How the memory key is obtained without the plugin ever calling Engram: it does not
// call it, it observes. `tool_call` carries toolName and input; `tool_result` carries
// structuredContent with what the tool created. The rule is deliberately blunt:
//
//     the last memory WRITTEN before a traspaso is the traspaso.
//
// No scoring, no ranking, no model call. The agent already saves what remains before
// closing — that is in the Engram close protocol every session receives.
//
// No runtime dependency on Pi, so this stays loadable and testable standalone.

/** Tools that CREATE a memory. Reads deliberately do not count. */
export const MEMORY_WRITE_TOOLS: readonly string[] = ["mem_save", "mem_session_summary"];

import {
  STATE,
  formatLineageHead,
  formatName,
  parseName,
  splitLineage,
} from "./name.ts";

export interface MemoryRef {
  /** From the tool result. Absent until the tool has reported success. */
  id?: number;
  topicKey?: string;
  title?: string;
}

export interface HandoffOrigin {
  sessionId: string;
  name: string;
  next: string;
  memory?: MemoryRef;
}

/** Longest first line of a summary, used as a human-readable title. */
const MAX_TITLE = 120;

function readString(value: unknown, max = MAX_TITLE): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.length > max ? trimmed.slice(0, max).trim() : trimmed;
}

/**
 * Recognise a memory write and capture what identifies it.
 *
 * Only the explicit write-tool list counts. Matching on a `mem_` prefix would silently
 * start counting reads the day a new Engram read tool appears, and the rule that makes
 * the traspaso deterministic depends on "written" meaning exactly one thing.
 *
 * Returns undefined for reads, non-memory tools, and malformed input — never throws.
 * A memory write that cannot be understood is skipped, because the handoff still works
 * without it; it just falls back to the next step alone.
 */
export function extractMemoryRef(
  toolName: string | undefined,
  input: unknown,
): MemoryRef | undefined {
  if (typeof toolName !== "string") return undefined;
  if (!MEMORY_WRITE_TOOLS.includes(toolName)) return undefined;
  if (typeof input !== "object" || input === null) return undefined;
  const args = input as { title?: unknown; topic_key?: unknown; content?: unknown };
  const title =
    readString(args.title) ??
    (typeof args.content === "string" ? readString(args.content.split("\n")[0]) : undefined);
  const topicKey = readString(args.topic_key);
  if (title === undefined && topicKey === undefined) return undefined;
  const ref: MemoryRef = {};
  if (topicKey !== undefined) ref.topicKey = topicKey;
  if (title !== undefined) ref.title = title;
  return ref;
}

/**
 * Pull the created observation id out of a tool result.
 *
 * The id is never in the call arguments — it only exists once the tool has run, in
 * `structuredContent`. Engram's exact shape is not something this plugin should depend
 * on, so the two plausible containers are tried and anything non-numeric is rejected:
 * rendering "id NaN" into the handoff message would hand the agent a pointer that looks
 * real and is not.
 */
export function extractMemoryId(structured: unknown): number | undefined {
  if (typeof structured !== "object" || structured === null) return undefined;
  const asId = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined;
  const root = structured as { id?: unknown };
  const direct = asId(root.id);
  if (direct !== undefined) return direct;
  for (const key of ["observations", "candidates"] as const) {
    const list = (structured as Record<string, unknown>)[key];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const id = asId((item as { id?: unknown } | null)?.id);
      if (id !== undefined) return id;
    }
  }
  return undefined;
}

/**
 * Remove the leading lineage head from free text.
 *
 * A handoff writes its id into both names — the origin carries its own, the destination
 * says which one it inherited from — so the pair can be matched in the picker without
 * opening anything. The cost is that the destination's text now starts with a head, and
 * handing off again would embed the previous one, producing `desde a · desde b · …` that
 * grows without bound.
 *
 * Stripping the leading head keeps the text at exactly one, so a long chain stays one
 * readable line. Only the leading one is removed: a token appearing later in the text is
 * part of the human's words. Since NB-14 the head can carry two tokens
 * (`desde <parent> · <self> · `), and the whole head goes — leaving the own id behind
 * would make the carried text repeat a head token (S5).
 *
 * The grammar itself lives in `splitLineage` (name.ts), the one helper that owns it
 * (NB-15), and accepts a variable width (NB-12): after NB-10 a stored name can carry nine
 * or fifteen hex characters, while the names already on disk carry exactly eight. Raising
 * the ceiling changes nothing for them — the minimum stays at eight, and a hex word
 * without the trailing `·` is still text.
 */
export function stripLineage(text: string): string {
  const split = splitLineage(text);
  const hasHead = split.parent !== undefined || split.self !== undefined;
  return (hasHead ? split.rest : text).trim();
}

/**
 * Widen an origin's own token until it differs from the parent token it inherits.
 *
 * The parent token is inherited verbatim from the current name, while the origin's own
 * token comes from the population (NB-10). When the parent session has no file yet — a
 * handoff run before that session ever spoke — the parent is not in the population, so
 * both can come out identical and the name reads
 * `traspaso: desde 01a178c6 · 01a178c6 · …`. Measured in the bench on 2026-10-26: two
 * tokens the same is worse than a wide one, because it reads as the session pointing at
 * itself. Widening one hex character at a time is enough to tell them apart, and it is all
 * that can be done here: the parent's full id is not recoverable from the token it left.
 */
export function widenSelfToken(
  abbrev: string,
  parent: string | undefined,
  fullId: string,
): string {
  if (parent === undefined) return abbrev;
  let width = abbrev.length;
  let token = abbrev;
  // A uuid's ninth character is the separator dash: a token ending in it is unique but
  // reads like a typo, so keep breathing until it ends in hex as well.
  while ((token === parent || token.endsWith("-")) && width < fullId.length) {
    width += 1;
    token = fullId.slice(0, width);
  }
  return token;
}

/**
 * Plan the two names a handoff produces.
 *
 * The first real handoff produced two byte-identical names because the destination
 * inherited the origin's state and text. Beyond being untidy, it is false: a session
 * named `traspaso:` asserts the work continues in *another* session, and after the handoff
 * the destination is that other session. Copying the state forward contradicts the
 * exclusivity rule the six states are built on.
 *
 * So the origin is always marked `traspaso:` — whatever it was called, after a handoff the
 * work no longer sits there — and the destination is always `pausa:`: the work arrived
 * here, at a known point, with the next step written. The two can never collide.
 *
 * Both carry the short session id, because `parentSession` already records the link but
 * the picker renders nothing but the name; without the id in the name the relation is
 * invisible until a session is opened.
 *
 * The id arrives already abbreviated (NB-10): the caller derives the origin's width from
 * the population in play — `uniqueAbbreviations` over every project session plus the
 * origin, exactly what /scrub:audit and /scrub:triage do — because a fixed slice of eight
 * collides in uuid v7 bursts (measured: two handoffs four seconds apart shared their first
 * eight characters, so the child's marker also pointed at itself). No width is assumed
 * here; the function uses what the caller computed, verbatim.
 *
 * Returns undefined when there is no next step to carry, because a handoff with nothing to
 * hand over is not a handoff.
 *
 * The head the origin already carries is re-emitted, not rebuilt from nothing (NB-14):
 * `desde <parent> ·` survives when the origin inherited one, and `<originAbbrev> ·` is
 * always added as the session's own token — otherwise the parent would vanish from the
 * picker the moment a middle session handed off (S2, the same class of defect NB-11
 * closed for scrub_close). The carried text never contains any part of the head (S5).
 */
export function planHandoffNames(
  originName: string,
  argumentText: string,
  originAbbrev: string,
): { next: string; originName: string; destinationName: string } | undefined {
  const parsed = parseName(originName);
  const fromArgs = argumentText.trim();
  const candidate = fromArgs.length > 0 ? fromArgs : parsed.text;
  const next = stripLineage(candidate);
  if (next.length === 0) return undefined;
  // The own token is the caller's abbreviation (NB-10): a wider population recomputes it,
  // and the fresh width governs over whatever width an earlier handoff stored.
  const head = formatLineageHead(splitLineage(parsed.text).parent, originAbbrev);
  return {
    next,
    originName: formatName(STATE.traspaso, `${head}${next}`),
    destinationName: formatName(STATE.pausa, `desde ${originAbbrev} · ${next}`),
  };
}

/**
 * Derive the last memory written in a session, from its own entries.
 *
 * This replaced an earlier design that kept the reference in a module-level variable
 * populated from `tool_call` events. That was wrong in a way the dogfooding caught
 * immediately: a `/reload` re-imports the extension, the variable resets to undefined,
 * and the handoff then reports "no memory" even though the session plainly wrote one.
 * The tool calls are already persisted in the session file, so the file is the source of
 * truth — and reading it survives a reload, a different process, and a resumed session.
 *
 * The call and its result are paired by tool-call id, because the observation id only
 * exists in the result.
 */
export function findLastMemoryWrite(entries: readonly unknown[]): MemoryRef | undefined {
  let found: MemoryRef | undefined;
  let foundCallId: string | undefined;
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const message = (entry as { message?: unknown }).message;
    if (typeof message !== "object" || message === null) continue;
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (typeof part !== "object" || part === null) continue;
      const shape = part as {
        type?: unknown;
        name?: unknown;
        arguments?: unknown;
        id?: unknown;
        structuredContent?: unknown;
      };
      if (shape.type === "toolCall" && typeof shape.name === "string") {
        const ref = extractMemoryRef(shape.name, shape.arguments);
        if (ref !== undefined) {
          found = ref;
          foundCallId = typeof shape.id === "string" ? shape.id : undefined;
        }
      } else if (shape.type === "toolCallResult" && shape.id === foundCallId) {
        const id = extractMemoryId(shape.structuredContent);
        if (id !== undefined && found !== undefined) found = { ...found, id };
      }
    }
  }
  return found;
}

/**
 * Compose what the destination session starts with.
 *
 * This goes into a `custom_message` with `display: false`, which means it reaches the
 * agent on its first token while rendering nothing in the transcript. It is therefore
 * context the agent carries for the rest of the session — which is why it is capped and
 * why it carries pointers rather than content. The memory holds the detail; this only
 * says where to find it.
 *
 * Pure, so the wording is testable and the message is deterministic.
 *
 * The observation id is deliberately absent. Tool *results* are not persisted in the
 * session file — only the calls are — so the id exists solely in the in-memory event and
 * cannot survive a reload. The `topic_key` travels in the call arguments and is durable,
 * and `mem_search` resolves it, so the id was never needed. The first handoff tried to
 * recover it and shipped a `memoryId: null` because the file had nothing to read.
 */
export function buildHandoffMessage(origin: HandoffOrigin): string {
  const originId = origin.sessionId.length > 8 ? origin.sessionId.slice(0, 8) : origin.sessionId;
  const lines: string[] = [`Continuación de la sesión ${originId}.`];
  const name = readString(origin.name);
  if (name !== undefined) lines.push(`Quedó como: "${name}".`);
  lines.push(`Pendiente: ${origin.next}.`);
  const memory = origin.memory;
  if (memory?.topicKey !== undefined) {
    lines.push(`Contexto en memoria: ${memory.topicKey}.`);
    // The title is the only summary of the block that travels with the handoff, and it is
    // not recoverable from anywhere else. The first run ignored it, lacked a one-line
    // account of what the previous block did, and spent three git commands rebuilding it.
    if (memory.title !== undefined) lines.push(`Último registrado: ${memory.title}.`);
  }
  return lines.join(" ");
}