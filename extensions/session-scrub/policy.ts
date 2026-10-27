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
# session-scrub policy — project-local, opt-in, one block per project.
# Everything here but one key is written for the AGENT, not for the plugin:
# it is the standing order for when to use scrub_mark and scrub_close.
#
# VERDICTS (record via the scrub_mark tool, with an optional reason):
#   keep      — this session holds work worth preserving; never a trash candidate.
#   paused    — block closure: work stopped but WILL continue later; not a candidate.
#   finished  — session closure: the work is done; the session becomes a trash candidate.
#   ephemeral — this session ran one of the ephemeral flows below; trash candidate.
#   trash     — explicitly condemned; trash candidate even if the session is named.
#
# WHEN TO MARK:
#   session_rename — when this session gets named or renamed (/name), record keep ONLY if the new name declares no state (see PRECEDENCE).
#   block_close    — when work pauses with intent to resume, record paused.
#   session_close  — when the work is done, record finished.
#   ephemeral flow — when the session invokes a flow listed in ephemeral-flows, record ephemeral.
#
# PRECEDENCE — the name is the record. A name that starts with a state already IS
# that session's verdict, so scrub_mark refuses there on purpose: nothing is missing
# and nothing needs marking. Record a verdict only when the name declares no state.
# What each state already resolves:
#   pausa, espera   -> paused
#   abierto         -> keep
#   hecho, traspaso -> finished
#
# EPHEMERAL FLOWS — the only key the plugin itself reads. Exact skill-flow
# names as invoked (the name after /skill:), comma-separated. ONLY these
# flows ever qualify a session as ephemeral. Leave the placeholders if none.
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

/**
 * Fence openers and closers, as Markdown defines them: three or more backticks,
 * or three or more tildes. A `~~~` block is a code block to every renderer, so it
 * has to be one here too — otherwise the exact bug this module fixes (a quoted
 * template read as live policy) comes back one doc-format away.
 */
function isFenceLine(trimmed: string): boolean {
  return /^(?:`{3,}|~{3,})/.test(trimmed);
}

/**
 * Drop inline code spans before looking for markers.
 *
 * A marker quoted as `` `<!-- pi-session-scrub:start -->` `` is documentation,
 * not a block. Span-splitting happens before the marker test and never touches
 * fence lines, which are handled first.
 */
function withoutInlineCode(line: string): string {
  return line.replace(/`[^`]*`/g, "");
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
    const text = withoutInlineCode(line);
    if (!inBlock) {
      if (text.includes(POLICY_START)) inBlock = true;
      continue;
    }
    if (text.includes(POLICY_END)) return { ephemeralFlows: flows };
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
// Block location — ONE scanner, so the writer and the updater can never disagree
// ---------------------------------------------------------------------------

/**
 * Where the block actually is, by 1-based line.
 *
 * `endLine` is absent when a start marker has no closing marker after it: the region has
 * no known end, and a caller that needs to replace it must refuse rather than invent one.
 */
export interface BlockRegion {
  startLine: number;
  endLine?: number;
}

/**
 * Locate the block: first unfenced `start`, first unfenced `end` after it.
 *
 * The fence and inline-code rules are PB-02's, and they live here rather than in each
 * caller: `planInitWrite` answering "a block exists at line N" and `planInitUpdate`
 * answering "the region is lines N..M" must be two readings of one scan, or a project with
 * a quoted template gets told the block exists by one path and does not by the other.
 */
export function findBlockRegion(text: string): BlockRegion | undefined {
  let inFence = false;
  let startLine: number | undefined;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (isFenceLine(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const bare = withoutInlineCode(line);
    if (startLine === undefined) {
      if (bare.includes(POLICY_START)) startLine = i + 1;
      continue;
    }
    if (bare.includes(POLICY_END)) return { startLine, endLine: i + 1 };
  }
  return startLine === undefined ? undefined : { startLine };
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
  const region = findBlockRegion(existing);
  if (region !== undefined) return { kind: "exists", line: region.startLine };
  return { kind: "append", text: appendText(existing) };
}

/**
 * The exact bytes a first run appends, separators included.
 *
 * One builder for both planners: `/scrub:init --update` on a blockless project must
 * create the same block a plain `/scrub:init` would, byte for byte, or the two paths
 * would produce two shapes of "the same" file.
 */
function appendText(existing: string): string {
  // Keep the historical spacing: one blank line before the block when the
  // file ends mid-line or is empty, none when it already ends with a newline.
  const sep = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  return `${sep}\n${POLICY_TEMPLATE}`;
}

// ---------------------------------------------------------------------------
// /scrub:init --update planner (UD-01…UD-04)
// ---------------------------------------------------------------------------

/**
 * The one key the plugin reads, and therefore the one line inside the block that
 * belongs to the human: its value is project data, never template text.
 */
const HUMAN_KEY = "ephemeral-flows:";

/** Guidance keys the template emits and therefore owns, rewritten on every update. */
const GUIDANCE_KEYS = ["verdicts:", "mark-on:"];

export type InitUpdatePlan =
  | { kind: "append"; text: string }
  | { kind: "unterminated"; line: number }
  | { kind: "foreign"; line: number; text: string }
  | { kind: "current"; line: number }
  | { kind: "update"; line: number; diff: string; text: string };

/** The template's region with the human's flows value in it, no trailing newline. */
function regionWithFlows(flows: string | undefined): string {
  const body = POLICY_TEMPLATE.replace(/\n$/, "");
  if (flows === undefined) return body;
  return body.replace(new RegExp(`^${HUMAN_KEY}.*$`, "m"), `${HUMAN_KEY} ${flows}`.trimEnd());
}

/**
 * Pure decision behind `/scrub:init --update`: the handler does I/O and UI.
 *
 * Ownership is what makes an automated rewrite safe enough to offer:
 *
 *   - blank lines and `#` comments are the template's prose — rewritten;
 *   - `verdicts:` and `mark-on:` are guidance the template owns — rewritten;
 *   - `ephemeral-flows:` is the human's data — its VALUE survives verbatim;
 *   - any other non-blank line belongs to nobody the plugin can identify, so the
 *     update REFUSES and names it. Deleting a line the plugin does not recognize
 *     because it was caught inside two markers is how a project loses its notes.
 *
 * A second `ephemeral-flows:` line is refused for the same reason: the parser
 * unions them today, and collapsing two lines into one is a merge decision about
 * the human's data, not a normalization.
 */
export function planInitUpdate(existing: string): InitUpdatePlan {
  const region = findBlockRegion(existing);
  if (region === undefined) return { kind: "append", text: appendText(existing) };
  const { startLine, endLine } = region;
  if (endLine === undefined) return { kind: "unterminated", line: startLine };
  const lines = existing.split("\n");
  // Lines strictly between the markers: the markers themselves are the block's
  // identity and are re-emitted byte-for-byte by the template.
  const inner = lines.slice(startLine, endLine - 1);
  let flows: string | undefined;
  for (let i = 0; i < inner.length; i++) {
    const line = inner[i].trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    if (GUIDANCE_KEYS.some((key) => line.startsWith(key))) continue;
    if (line.startsWith(HUMAN_KEY)) {
      if (flows !== undefined) return { kind: "foreign", line: startLine + 1 + i, text: line };
      flows = line.slice(HUMAN_KEY.length).trim();
      continue;
    }
    return { kind: "foreign", line: startLine + 1 + i, text: line };
  }
  const before = lines.slice(startLine - 1, endLine).join("\n");
  const after = regionWithFlows(flows);
  if (before === after) return { kind: "current", line: startLine };
  return {
    kind: "update",
    line: startLine,
    diff: diffPolicyBlock(before, after),
    text: [...lines.slice(0, startLine - 1), after, ...lines.slice(endLine)].join("\n"),
  };
}

/**
 * The changed hunks, with the interior the two sides share kept as context.
 *
 * The first live trial is why this is a real diff and not a common-prefix trim:
 * trimming a shared head and tail leaves everything between them looking
 * changed, so three lines the update keeps were shown as a `-`/`+` pair of
 * identical text. A human reading that concludes the tool is rewriting lines it
 * does not need to touch — and they are right to conclude it. A diff that lies
 * about what changes is worse than a longer diff.
 *
 * So: longest common subsequence over lines, `-` leaves, `+` arrives, `  ` is
 * context (two spaces, so the prefixes line up). The shared head and tail of the
 * BLOCK are still trimmed — that is the part the human already knows — but an
 * interior line that survives keeps its ` ` and is never reported as a rewrite.
 */
export function diffPolicyBlock(before: string, after: string): string {
  const a = before.split("\n");
  const b = after.split("\n");
  // lcs[i][j] = length of the longest common subsequence of a[i..] and b[j..].
  // The block is tens of lines, so the quadratic table is the cheap, obvious choice.
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops: { kind: "same" | "del" | "add"; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ kind: "same", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ kind: "del", text: a[i] });
      i++;
    } else {
      ops.push({ kind: "add", text: b[j] });
      j++;
    }
  }
  for (; i < a.length; i++) ops.push({ kind: "del", text: a[i] });
  for (; j < b.length; j++) ops.push({ kind: "add", text: b[j] });
  let head = 0;
  while (head < ops.length && ops[head].kind === "same") head++;
  let tail = ops.length;
  while (tail > head && ops[tail - 1].kind === "same") tail--;
  return ops
    .slice(head, tail)
    .map((op) =>
      op.kind === "same" ? `  ${op.text}` : op.kind === "del" ? `- ${op.text}` : `+ ${op.text}`,
    )
    .join("\n");
}
