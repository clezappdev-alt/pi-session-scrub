// pi-session-scrub — pure session classification.
//
// This module has NO runtime dependency on Pi: it operates on an
// already-resolved SessionInfo and compares strings and dates. That makes it
// loadable (and testable) outside the host. The single outward reference is a
// type-only import, erased by the type stripper.
//
// Behavior here is characterization-pinned by classify.test.ts.

import { realpathSync } from "node:fs";

import type { SessionInfo } from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Age gate: sessions >= 7 days old need confirmation with detail (never auto). */
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const VERDICTS = {
  keep: "keep",
  paused: "paused",
  finished: "finished",
  ephemeral: "ephemeral",
  trash: "trash",
} as const;
export type Verdict = (typeof VERDICTS)[keyof typeof VERDICTS];

export const CLASS_KIND = {
  live: "live",
  namedProtected: "named-protected",
  autoDeletable: "auto-deletable",
  candidate: "candidate",
  oldNeedsConfirm: "old-needs-confirm",
  kept: "kept",
} as const;

export const CANDIDATE_REASON = {
  explicitTrash: "explicit-trash",
  finished: "finished",
  ephemeral: "ephemeral",
  empty: "empty",
} as const;
export type CandidateReason =
  (typeof CANDIDATE_REASON)[keyof typeof CANDIDATE_REASON];

// ---------------------------------------------------------------------------
// Flat interfaces (strict-typed, no nested unions beyond Classification)
// ---------------------------------------------------------------------------

export interface VerdictData {
  version: number;
  verdict: Verdict;
  at: string;
  reason?: string;
}

export interface SessionDetail {
  name?: string;
  firstMessage: string;
  messageCount: number;
  created: Date;
  modified: Date;
  verdict?: Verdict;
}

export interface LiveClassification {
  kind: typeof CLASS_KIND.live;
}
export interface NamedProtectedClassification {
  kind: typeof CLASS_KIND.namedProtected;
  name: string;
  verdict?: Verdict;
}
export interface AutoDeletableClassification {
  kind: typeof CLASS_KIND.autoDeletable;
  reason: typeof CANDIDATE_REASON.empty;
}
export interface CandidateClassification {
  kind: typeof CLASS_KIND.candidate;
  reason: CandidateReason;
  verdict?: Verdict;
}
export interface OldNeedsConfirmClassification {
  kind: typeof CLASS_KIND.oldNeedsConfirm;
  detail: SessionDetail;
}
export interface KeptClassification {
  kind: typeof CLASS_KIND.kept;
  reason: string;
}
export type Classification =
  | LiveClassification
  | NamedProtectedClassification
  | AutoDeletableClassification
  | CandidateClassification
  | OldNeedsConfirmClassification
  | KeptClassification;

// ---------------------------------------------------------------------------
// Pure functions (no ctx, no fs beyond path resolution)
// ---------------------------------------------------------------------------

/** D2 decision tree verbatim: live → named-trash-only → candidates → empty → old → kept. */
export interface LiveIdentity {
  path?: string;
  id?: string;
}

/** Same file even if one side is a symlink or relative: compare resolved paths. */
export function samePath(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

export function classifySession(
  s: SessionInfo,
  live: LiveIdentity,
  verdict: Verdict | undefined,
  ephemeralFlow: boolean,
): Classification {
  if (
    (live.path !== undefined && samePath(s.path, live.path)) ||
    (live.id !== undefined && s.id === live.id)
  ) {
    return { kind: CLASS_KIND.live };
  }
  if (s.name !== undefined && s.name.trim().length > 0) {
    if (verdict === VERDICTS.trash) {
      return {
        kind: CLASS_KIND.candidate,
        reason: CANDIDATE_REASON.explicitTrash,
        verdict,
      };
    }
    return { kind: CLASS_KIND.namedProtected, name: s.name, verdict };
  }
  if (verdict === VERDICTS.trash) {
    return {
      kind: CLASS_KIND.candidate,
      reason: CANDIDATE_REASON.explicitTrash,
      verdict,
    };
  }
  if (verdict === VERDICTS.finished) {
    return {
      kind: CLASS_KIND.candidate,
      reason: CANDIDATE_REASON.finished,
      verdict,
    };
  }
  if (verdict === VERDICTS.ephemeral || ephemeralFlow) {
    return {
      kind: CLASS_KIND.candidate,
      reason: CANDIDATE_REASON.ephemeral,
      verdict,
    };
  }
  if (s.messageCount === 0) {
    return { kind: CLASS_KIND.autoDeletable, reason: CANDIDATE_REASON.empty };
  }
  if (Date.now() - s.created.getTime() >= MAX_AGE_MS) {
    return {
      kind: CLASS_KIND.oldNeedsConfirm,
      detail: {
        name: s.name,
        firstMessage: s.firstMessage,
        messageCount: s.messageCount,
        created: s.created,
        modified: s.modified,
        verdict,
      },
    };
  }
  if (verdict !== undefined) {
    return { kind: CLASS_KIND.kept, reason: `has-verdict-${verdict}` };
  }
  return { kind: CLASS_KIND.kept, reason: "has-content-no-verdict" };
}