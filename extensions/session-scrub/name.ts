// pi-session-scrub — the session-name convention.
//
// The session name is the ONLY channel to Pi's /resume picker: session-selector.js
// builds its label as `(session.name ?? session.firstMessage)` and no extension hook
// exists for picker rows. So whatever the owner needs to know at a glance has to be
// encoded here.
//
// One question partitions every state:
//
//     where does what comes next live?
//
//   pausa:   here, and you know it
//   abierto: here, but you don't
//   espera:  somewhere you don't control
//   traspaso: in another session
//   hecho:   nowhere
//   (none):  nobody declared anything — dirty
//
// The name is the single carrier by design. A separate verdict entry would be a second
// writer, and two writers diverge the moment one write is skipped — leaving a stale
// promise in /resume, which is worse than no name because a stale promise is trusted.
//
// No runtime dependency on Pi. Types are erased by the stripper, so this module is
// loadable and testable standalone, like classify.ts.

import { VERDICTS, type Verdict } from "./classify.ts";

export const STATE = {
  pausa: "pausa",
  abierto: "abierto",
  espera: "espera",
  traspaso: "traspaso",
  hecho: "hecho",
} as const;
export type State = (typeof STATE)[keyof typeof STATE];

/**
 * The states `scrub_close` may write.
 *
 * Every one of these is a fact about THIS session. `traspaso` is the one state that
 * asserts something about another session, and only `/scrub:handoff` can know it,
 * because only the handoff creates that session (NB-04). `pausa` is the honest word
 * while a handoff is pending: the work is here and the next step is known.
 */
export const CLOSE_STATES = [STATE.pausa, STATE.abierto, STATE.espera, STATE.hecho] as const;
export type CloseState = (typeof CLOSE_STATES)[number];

const STATE_VALUES: readonly string[] = Object.values(STATE);

/** Upper bound on the free-text portion of a proposal. Names render in a terminal. */
const MAX_TEXT = 60;

export interface ParsedName {
  state: State | undefined;
  text: string;
  /** True when no state prefix is present: nobody declared anything about this session. */
  dirty: boolean;
}

/**
 * The lineage head (NB-15): at most two tokens at position 0, parent first, then the
 * session's own abbreviation (S3):
 *
 *     [desde <parent> · ][<self> · ]<free text>
 *
 * The literal `desde` is what marks a parent — a bare leading hex token is the session's
 * own id, written by the extension at handoff time. No sigil and no second delimiter: every
 * name already on disk (`traspaso: <self> · …`, `pausa: desde <parent> · …`) already fits
 * this reading, so legacy names parse under the same pattern (S4).
 *
 * The abbreviation has no fixed width — NB-10 derives it from the session population, and
 * measured uuid v7 bursts agree past eight and even past twelve characters — so the floor
 * stays at the eight characters the names already on disk use and the ceiling is open.
 * A token appearing later in the text is the human's words, never the head (S5).
 */
export const LINEAGE_HEAD = /^(?:(desde\s+)([0-9a-f]{8,})\s*·\s*)?(?:([0-9a-f]{8,})\s*·\s*)?/;

/** The head of a text, split into its tokens and the free text that follows. */
export interface LineageSplit {
  /** Inherited parent token — present only when the literal `desde` precedes it (S3). */
  parent: string | undefined;
  /** The session's own abbreviation, present only when followed by a separator. */
  self: string | undefined;
  /** The free text after the head. */
  rest: string;
}

/**
 * Split the lineage head off the front of a free text.
 *
 * The one helper that owns the grammar (NB-15): `stripLineage` (handoff.ts) and
 * `closeName` route through it instead of matching their own patterns, so a head can
 * never be stripped by one caller and written back differently by another.
 */
export function splitLineage(text: string): LineageSplit {
  const match = LINEAGE_HEAD.exec(text);
  return {
    parent: match?.[2],
    self: match?.[3],
    rest: match !== null && match[0].length > 0 ? text.slice(match[0].length) : text,
  };
}

/**
 * Re-emit a head from its two optional tokens, in grammar order (S3).
 *
 * Empty parts are simply absent, and an empty head formats to "" — the caller decides
 * whether that means "no lineage to show".
 */
export function formatLineageHead(
  parent: string | undefined,
  self: string | undefined,
): string {
  const parentPart = parent !== undefined ? `desde ${parent} · ` : "";
  return parentPart + (self !== undefined ? `${self} · ` : "");
}

/**
 * Parse a session name into state and free text.
 *
 * Only a prefix at position 0 followed by `:` counts. "reabierto:" must not read as
 * `abierto:`, and an unknown prefix must stay free text — if the vocabulary grows later,
 * names written under the old vocabulary keep parsing as text instead of silently
 * becoming stateful.
 *
 * Round-trip contract, relied on by `formatName` and by anything that proposes a name
 * the human may retype: `parseName(formatName(state, text))` yields that same `state`
 * and that same `text`. It holds for every state, and `formatName` is idempotent, so a
 * prefixed text fed back in loses its old prefix instead of stacking a second one.
 */
export function parseName(name: string): ParsedName {
  const trimmed = name.trim();
  const colon = trimmed.indexOf(":");
  if (colon > 0) {
    const candidate = trimmed.slice(0, colon).trim().toLowerCase();
    if ((STATE_VALUES as string[]).includes(candidate)) {
      return {
        state: candidate as State,
        text: trimmed.slice(colon + 1).trim(),
        dirty: false,
      };
    }
  }
  return { state: undefined, text: trimmed, dirty: true };
}

/**
 * Render a name from a state and its free text.
 *
 * Idempotent: feeding a formatted name back in returns it unchanged, because the human
 * may retype a name the extension already proposed.
 */
export function formatName(state: State, text: string): string {
  // Route through parseName so an already-prefixed text loses its old prefix instead
  // of stacking a second one on top.
  const body = parseName(text).text.trim();
  return body.length === 0 ? `${state}:` : `${state}: ${body}`;
}

/**
 * Compose the name scrub_close writes, honouring the lineage head.
 *
 * A `/scrub:handoff` writes lineage tokens into the free text (`pausa: desde <abbr> · …`,
 * and after NB-14 the origin carries `desde <parent> · <self> · …`). Rewriting that whole
 * text — what handleScrubClose did before — erased the head, and the head is the only
 * thing in the picker that says where the work came from and where it continues (owner
 * report, measured 13:42 vs 13:46 in the same session's own file).
 *
 * The rule is therefore: a head the current name carries is kept WHOLE — both tokens
 * (S6 / NB-16) — and only the free text is replaced; a rename tool has no way to know
 * where the work came from, so it never invents a token (S4 / NB-11). The text budget
 * applies to the new text, never to the head. When a head is preserved, a head-shaped
 * start on the incoming text is stripped instead of stacked: the human may retype the old
 * name wholesale — the same reason formatName is idempotent — and a name carries at most
 * one head, parent first (S6 / NB-13). Without an inherited head the text is left
 * untouched: stripping there would delete the human's own words to enforce a rule the
 * session has no head under in the first place.
 */
export function closeName(currentName: string, state: State, text: string): string {
  const split = splitLineage(parseName(currentName).text.trim());
  const hasHead = split.parent !== undefined || split.self !== undefined;
  const head = formatLineageHead(split.parent, split.self);
  const body = hasHead ? text.replace(LINEAGE_HEAD, "") : text;
  const clipped = body.trim().slice(0, MAX_TEXT).trim();
  // With no text to carry, a preserved head would end in a dangling separator
  // (`hecho: desde 01a17881 ·`), which reads as a truncated name rather than a short one.
  // The head alone still says where the work came from, so only the separator goes —
  // never a token.
  const carried = clipped === "" ? head.replace(/\s*·\s*$/, "") : head;
  return formatName(state, `${carried}${clipped}`);
}

/**
 * Derive the verdict a state implies.
 *
 * States whose work still lives here must not derive a disposal verdict — NM-04 protects
 * explicit verdicts, so deriving the wrong one here would hand a live workstream the
 * wrong kind of protection. `epemeral` and `trash` are never inferred from a name: they
 * mean something a name cannot assert.
 */
export function verdictFromState(state: State | undefined): Verdict | undefined {
  switch (state) {
    case STATE.pausa:
    case STATE.espera:
      return VERDICTS.paused;
    case STATE.abierto:
      return VERDICTS.keep;
    case STATE.hecho:
    case STATE.traspaso:
      return VERDICTS.finished;
    case undefined:
      return undefined;
  }
}

/**
 * Derive the verdict a full session name implies, or undefined if it declares none.
 *
 * Thin composition of parseName + verdictFromState, kept separate because callers
 * almost always hold a name rather than an already-parsed state.
 */
export function verdictFromName(name: string): Verdict | undefined {
  return verdictFromState(parseName(name).state);
}

/**
 * Resolve which verdict applies to a session, given both carriers.
 *
 * The name is the record and outranks the verdict entry. Two writers would diverge the
 * moment one write was skipped, and the divergence would be visible as a stale promise
 * in /resume — worse than no name, because a stale promise gets trusted.
 *
 * The entry is still consulted when the name declares no state, because sessions
 * written before the convention exist only as entries. Dropping those would silently
 * discard every historical verdict.
 */
export function resolveVerdict(
  name: string,
  entryVerdict: Verdict | undefined,
): Verdict | undefined {
  const derived = verdictFromName(name);
  return derived !== undefined ? derived : entryVerdict;
}

/**
 * Turn an Engram topic key into readable proposal text.
 *
 * The namespace is dropped only when it repeats the project you are already in —
 * "session-scrub:naming-traspaso" inside session-scrub is just noise. A foreign
 * namespace is kept, because it carries meaning the key otherwise loses.
 *
 * Deterministic and free: no model call, and the same key always yields the same text,
 * so a proposal never costs tokens and never wanders between runs.
 */
export function proposeNameFromTopicKey(
  topicKey: string,
  currentProject: string,
): string {
  if (typeof topicKey !== "string" || topicKey.length === 0) return "";
  const parts = topicKey
    .split(":")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) return "";
  if (parts.length > 1 && currentProject.length > 0 && parts[0] === currentProject) {
    parts.shift();
  }
  const text = parts
    .join(" ")
    .replace(/[-_]+/g, " ")
    .replace(/[^\p{L}\p{N}. ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, MAX_TEXT).trim();
}