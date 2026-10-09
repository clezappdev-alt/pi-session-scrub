// Adoption planning for slice D — applying the naming convention to sessions that
// predate it.
//
// Two rules, and both are refusals:
//
//   1. The plugin fills a state only when a machine already asserted one. An explicit
//      verdict qualifies. A file being old does not — "older than seven days" is not
//      `pausa:`, and inventing it puts a promise in /resume that nobody ever made.
//   2. The human text is never rewritten. Adoption supplies a missing prefix and keeps
//      whatever the human wrote; a name that already carries a prefix is left alone.
//
// No runtime dependency on Pi. Types are erased by the stripper, so this module is
// loadable and testable standalone, like classify.ts and name.ts.

import { STATE, parseName, formatName, type State } from "./name.ts";
import { VERDICTS, type Verdict } from "./classify.ts";

/**
 * NM-03: the cross-process liveness window. A file modified within it is not treated
 * as *live* — it raises the confirmation requirement instead of being refused, because
 * a session closed five seconds ago and one open in another terminal are the same file
 * signature. There is no `--force`: the only bypass available to the user is waiting.
 */
export const FRESH_MTIME_MS = 120_000;

const STATE_VALUES: readonly string[] = Object.values(STATE);

/** A session as adoption sees it: identity, display name, and the one asserted fact. */
export interface AdoptionCandidate {
  id: string;
  path: string;
  /** Pi's current display name; undefined when the session has never been named. */
  name: string | undefined;
  verdict: Verdict | undefined;
  /** File mtime in epoch milliseconds, sampled before any write touches it. */
  modifiedMs: number;
}

export type SkipReason = "already-adopted" | "needs-state";

export interface AdoptionPlan {
  id: string;
  path: string;
  /** The name to write, or undefined when nothing is to be written. */
  name: string | undefined;
  /** Why nothing is to be written, whenever `name` is undefined. */
  skip: SkipReason | undefined;
  /** True when the state came from the verdict rather than from a human. */
  derived: boolean;
  /** True when the resulting name carries no readable text after the prefix. */
  textless: boolean;
  /** Seconds since the file was last modified, sampled at plan time. */
  ageSeconds: number;
  /** NM-03: this file needs the extra confirmation before it is written. */
  fresh: boolean;
}

export interface WriteSnapshot {
  entryCount: number;
  /** Last session_info name in the file, or undefined when there is none. */
  name: string | undefined;
  /** False when the file could not be parsed at all. */
  parsed: boolean;
}

export type VerificationResult = { ok: true } | { ok: false; cause: string };

export interface Assignment {
  idPrefix: string;
  state: State;
}

export interface RejectedAssignment {
  raw: string;
  cause: string;
}

/**
 * The state a verdict asserts, if any.
 *
 * Only `paused` and `finished` answer the organizing question — *where does what comes
 * next live?* — and only in one direction each: paused means the step is here and
 * known, finished means it lives nowhere. `keep`, `ephemeral` and `trash` answer a
 * different question (is this worth retaining) and carry no continuation claim, so
 * deriving a state from them would assert something the verdict never said.
 */
export function stateFromVerdict(verdict: Verdict | undefined): State | undefined {
  switch (verdict) {
    case VERDICTS.paused:
      return STATE.pausa;
    case VERDICTS.finished:
      return STATE.hecho;
    default:
      return undefined;
  }
}

/**
 * Whether a file is inside the freshness window.
 *
 * A *future* mtime counts as fresh. Testing `age >= 0` before comparing would let a
 * forward-dated file skip confirmation outright, which is the one direction clock skew
 * must never buy: the cost of a needless confirmation is a keystroke, and the cost of
 * skipping one is interleaving with Pi's own flush.
 */
export function isFresh(modifiedMs: number, now: number): boolean {
  return now - modifiedMs < FRESH_MTIME_MS;
}

/** Resolve one candidate against the human's inline assignments. */
function planOne(
  candidate: AdoptionCandidate,
  assignments: Map<string, State>,
  now: number,
): AdoptionPlan {
  const ageSeconds = Math.max(0, Math.round((now - candidate.modifiedMs) / 1000));
  const base = {
    id: candidate.id,
    path: candidate.path,
    skip: undefined as SkipReason | undefined,
    derived: false,
    textless: false,
    ageSeconds,
    fresh: isFresh(candidate.modifiedMs, now),
  };

  const parsed = parseName(candidate.name ?? "");
  // A name that already carries a prefix is not missing anything. Re-prefixing it
  // would rewrite the human layer, which is the one thing this feature never does.
  if (!parsed.dirty) {
    return { ...base, name: undefined, skip: "already-adopted" };
  }

  const assigned = assignments.get(candidate.id);
  const state = assigned ?? stateFromVerdict(candidate.verdict);
  if (state === undefined) {
    return { ...base, name: undefined, skip: "needs-state" };
  }

  // formatName strips any prefix from the text it is given, so a name that grew a
  // second prefix is normalised rather than stacked.
  const name = formatName(state, parsed.text);
  return {
    ...base,
    name,
    derived: assigned === undefined,
    textless: parseName(name).text.length === 0,
  };
}

/**
 * Plan the adoption of every candidate.
 *
 * `assignments` maps a full session id to the state the human supplied. Prefix
 * resolution is deliberately *not* done here: an abbreviated id that matches two
 * sessions must not resolve to either one silently, so index.ts resolves prefixes
 * against the candidate list and refuses an ambiguous match before building the map.
 */
export function planAdoption(
  candidates: AdoptionCandidate[],
  assignments: Map<string, State>,
  now: number,
): AdoptionPlan[] {
  return candidates.map((c) => planOne(c, assignments, now));
}

/**
 * NM-02 post-write verification: the file still parses, it gained exactly one entry,
 * and that entry carries the name we asked for. Anything else is a warning and an
 * error bucket — never reported as applied.
 */
export function verifyAdoption(
  before: WriteSnapshot,
  after: WriteSnapshot,
  expected: string,
): VerificationResult {
  if (!after.parsed) return { ok: false, cause: "file no longer parses" };
  const gained = after.entryCount - before.entryCount;
  if (gained !== 1) {
    return { ok: false, cause: `expected exactly one entry gained, gained ${gained}` };
  }
  if (after.name !== expected) {
    return { ok: false, cause: `name mismatch: expected "${expected}", found "${after.name ?? "(none)"}"` };
  }
  return { ok: true };
}

/** Human-readable elapsed time for the NM-03 confirmation text. */
export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

const ASSIGNMENT_RE = /([0-9A-Za-z][0-9A-Za-z-]*)\s*:\s*([A-Za-z]+)/g;

/**
 * Parse the inline `id:estado` grammar.
 *
 * Deliberately narrower than the triage grammar: there is no quoted reason here,
 * because adoption takes no new prose. The text after the prefix is whatever the
 * human already wrote — supplying new text is `/name`'s job, not this command's.
 *
 * Unconsumed input is rejected rather than dropped. A bare `01a1` matches no rule, and
 * silently ignoring it would leave the human believing a state was assigned to a
 * session that was then left untouched — the "reported nothing, did nothing" failure.
 */
export function parseAssignments(args: string): {
  ok: Assignment[];
  rejected: RejectedAssignment[];
} {
  const ok: Assignment[] = [];
  const rejected: RejectedAssignment[] = [];
  const seen = new Set<string>();
  let cursor = 0;
  const rejectGap = (gap: string): void => {
    if (gap.trim().length === 0) return;
    rejected.push({ raw: gap.trim(), cause: "not an id:estado assignment" });
  };

  for (const m of args.matchAll(ASSIGNMENT_RE)) {
    rejectGap(args.slice(cursor, m.index ?? 0));
    cursor = (m.index ?? 0) + m[0].length;
    const raw = m[0];
    const idPrefix = m[1] ?? "";
    const stateRaw = (m[2] ?? "").toLowerCase();
    if (idPrefix.length === 0) {
      rejected.push({ raw, cause: "empty id prefix" });
      continue;
    }
    if (!(STATE_VALUES as string[]).includes(stateRaw)) {
      rejected.push({ raw, cause: `unknown state "${stateRaw}" (${STATE_VALUES.join(", ")})` });
      continue;
    }
    if (seen.has(idPrefix)) {
      rejected.push({ raw, cause: `duplicate assignment "${idPrefix}"` });
      continue;
    }
    seen.add(idPrefix);
    ok.push({ idPrefix, state: stateRaw as State });
  }
  rejectGap(args.slice(cursor));
  return { ok, rejected };
}