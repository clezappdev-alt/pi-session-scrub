// pi-session-scrub — the POLICY block of AGENTS.md.
//
// This module has NO runtime dependency on Pi: it parses strings and plans
// writes as pure functions. That makes it loadable (and testable) outside the
// host — the same extraction classify.ts, render.ts, adopt.ts, ids.ts and
// sessionfs.ts went through. The single outward reference is a type-free
// surface: no Pi import at all, not even type-only.
//
// Owns: marker constants, the policy template, the block parser, and the
// /scrub:init write planner (decision here; I/O + UI stay in index.ts).

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const POLICY_START = "<!-- pi-session-scrub:start -->";
export const POLICY_END = "<!-- pi-session-scrub:end -->";

export const POLICY_TEMPLATE = `<!-- pi-session-scrub:start -->
# session-scrub policy — project-local, opt-in.
# Lines starting with \`#\` are guidance FOR THE AGENT; the plugin only
# reads the \`key: value\` lines below. The user fills the <placeholders>.
#
# VERDICTS (record via the scrub_mark tool, with an optional reason):
#   keep      — this session holds work worth preserving; never a trash candidate.
#   paused    — block closure: work stopped but WILL continue later; not a candidate.
#   finished  — session closure: the work is done; the session becomes a trash candidate.
#   ephemeral — this session ran one of the ephemeral flows below; trash candidate.
#   trash     — explicitly condemned; trash candidate even if the session is named.
#
# WHEN TO MARK:
#   session_rename — when this session gets named or renamed (/name), record keep.
#   block_close    — when work pauses with intent to resume, record paused.
#   session_close  — when the work is done, record finished.
#   ephemeral flow — when the session invokes a flow listed in ephemeral-flows, record ephemeral.
#
# EPHEMERAL FLOWS for this project: exact skill-flow names as invoked
# (the name after /skill:), comma-separated. ONLY these flows ever qualify
# a session as ephemeral. Leave the placeholders if none apply.
verdicts: keep | paused | finished | ephemeral | trash
mark-on: session_rename, block_close, session_close
ephemeral-flows: <flow-name-1>, <flow-name-2>
<!-- pi-session-scrub:end -->
`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PolicyConfig {
  ephemeralFlows: string[];
}

// ---------------------------------------------------------------------------
// Pure functions (no ctx, no fs)
// ---------------------------------------------------------------------------

function isFenceLine(trimmed: string): boolean {
  return trimmed.startsWith("```");
}
/** F4 grammar, bounded (PB-01) and fence-aware (PB-02):
 *
 *  - The block is the REGION from the first unfenced `start` marker to the
 *    first unfenced `end` marker after it. Both markers must be present and
 *    in that order, otherwise the block is absent (undefined) and the caller
 *    applies the conservative default.
 *  - Lines inside triple-backtick fences are quoted text, never markers and
 *    never keys, so a template pasted as an example cannot become policy.
 *  - Inside the region: skip `#`/blank lines; `<...>` placeholders read as
 *    empty.
 */
export function parsePolicyBlock(text: string): PolicyConfig | undefined {
  const flows: string[] = [];
  let inFence = false;
  let inBlock = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (isFenceLine(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (!inBlock) {
      if (line.includes(POLICY_START)) inBlock = true;
      continue;
    }
    if (line.includes(POLICY_END)) return { ephemeralFlows: flows };
    if (line.length === 0 || line.startsWith("#")) continue;
    if (line.startsWith("ephemeral-flows:")) {
      const value = line.slice("ephemeral-flows:".length).trim();
      if (value.length === 0 || value.includes("<")) continue;
      for (const part of value.split(",")) {
        const flow = part.trim();
        if (flow.length > 0 && !flow.includes("<")) flows.push(flow);
      }
    }
  }
  // Start without a following end (or no start at all): not a block.
  return undefined;
}

// ---------------------------------------------------------------------------
// /scrub:init write planner (PB-03/PB-04)
// ---------------------------------------------------------------------------

export type InitWritePlan =
  | { kind: "exists"; line: number }
  | { kind: "append"; text: string };

/**
 * Pure decision behind /scrub:init: the handler does I/O and UI, this decides.
 *
 *  - Any UNFENCED start marker means a block exists (or was at least started):
 *    refuse with its 1-based line so the human can find and edit it. A fenced
 *    quote of the template in the project's own docs is text, not a block.
 *  - Otherwise the returned `text` is the EXACT string to append to the file
 *    (separators included), so the handler can preview it byte-for-byte before
 *    writing and dry-run stays a true no-op.
 */
export function planInitWrite(existing: string): InitWritePlan {
  let inFence = false;
  const lines = existing.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (isFenceLine(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (line.includes(POLICY_START)) return { kind: "exists", line: i + 1 };
  }
  // Keep the historical spacing: one blank line before the block when the
  // file ends mid-line or is empty, none when it already ends with a newline.
  const sep = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  return { kind: "append", text: `${sep}\n${POLICY_TEMPLATE}` };
}
