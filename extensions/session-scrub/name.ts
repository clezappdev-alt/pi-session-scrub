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
 * may retype a name the plugin already proposed.
 */
export function formatName(state: State, text: string): string {
  // Route through parseName so an already-prefixed text loses its old prefix instead
  // of stacking a second one on top.
  const body = parseName(text).text.trim();
  return body.length === 0 ? `${state}:` : `${state}: ${body}`;
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