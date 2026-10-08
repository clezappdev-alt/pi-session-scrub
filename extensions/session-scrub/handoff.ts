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
 * Compose what the destination session starts with.
 *
 * This goes into a `custom_message` with `display: false`, which means it reaches the
 * agent on its first token while rendering nothing in the transcript. It is therefore
 * context the agent carries for the rest of the session — which is why it is capped and
 * why it carries pointers rather than content. The memory holds the detail; this only
 * says where to find it.
 *
 * Pure, so the wording is testable and the message is deterministic.
 */
export function buildHandoffMessage(origin: HandoffOrigin): string {
  const originId = origin.sessionId.length > 8 ? origin.sessionId.slice(0, 8) : origin.sessionId;
  const lines: string[] = [
    `Continuación de la sesión ${originId}.`,
  ];
  const name = readString(origin.name);
  if (name !== undefined) lines.push(`Quedó como: "${name}".`);
  lines.push(`Pendiente: ${origin.next}`);
  const memory = origin.memory;
  if (memory?.topicKey !== undefined) {
    const id = memory.id !== undefined ? ` (id ${memory.id})` : "";
    lines.push(`Contexto en memoria: ${memory.topicKey}${id}.`);
  }
  return lines.join(" ");
}