// Short identifiers for display.
//
// Session ids are uuid v7, so their first twelve hex characters are a millisecond
// timestamp plus a small random field. Sessions created in a burst — a loop launching
// `pi` once per candidate, a subagent fan-out, anything automated — therefore share far
// more than the eight characters the extension used to show. Observed on real data: twelve
// sessions whose first eight characters were `01a1444a`, and no fixed width would have
// separated them either, because they agreed on the first twelve.
//
// So the width is derived from the set in play, the way `git log --abbrev` does it, rather
// than assumed. A listing that cannot tell two sessions apart is worse than a longer one:
// the whole point is to be able to say which one you mean.
//
// No runtime dependency on Pi, so this stays loadable and testable standalone.

import { basename } from "node:path";

/** The width a listing should not go below, so ordinary output stays short. */
export const MIN_ABBREV = 8;

/**
 * Minimal unique abbreviation per id, never shorter than `min`.
 *
 * Ids are assumed to be uniform in length, which uuid v7 guarantees. If one id were a
 * genuine prefix of another they could not be separated by widening alone; the function
 * would then return the full shorter id, which is the honest answer for that input.
 */
export function uniqueAbbreviations(
  ids: readonly string[],
  min: number = MIN_ABBREV,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const id of ids) {
    let width = Math.max(min, 1);
    while (
      width < id.length &&
      ids.some((other) => other !== id && other.slice(0, width) === id.slice(0, width))
    ) {
      width += 1;
    }
    out.set(id, id.slice(0, width));
  }
  return out;
}

/**
 * Look up an abbreviation, falling back to the plain short form.
 *
 * Callers that already hold the map use it directly; this exists so a call site that
 * cannot reach the session set still shows something stable rather than throwing.
 */
export function abbrevOf(map: Map<string, string>, id: string): string {
  return map.get(id) ?? id.slice(0, MIN_ABBREV);
}

/**
 * The session id inside a session filename, which Pi writes as `<timestamp>_<uuid>.jsonl`.
 *
 * The id is not at the front of the name. `/scrub:restore` took the first eight characters
 * of the basename, which are the **date**: every session trashed the same day rendered as
 * `2026-10-`, so the prompt asking whether to restore a file could not say which file. The
 * id follows the separator.
 *
 * Falls back to the whole stem when there is no separator, so an unexpected filename is
 * shown as itself rather than silently truncated.
 */
export function idFromFilename(path: string): string {
  const stem = basename(path, ".jsonl");
  const sep = stem.lastIndexOf("_");
  return sep === -1 ? stem : stem.slice(sep + 1);
}