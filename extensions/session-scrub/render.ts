// Host-free renderers for the scrub_mark and scrub_close tools (T2, specs S3/S7).
//
// Zero imports, including type-only ones: index.ts cannot be loaded by the test runner
// because it imports the Pi host, so the visible output lives here and is pinned by
// render.test.ts with a fake theme. The structural types below are all the module knows;
// the real host Theme satisfies RenderTheme because its fg/bold are methods, and method
// parameter checking is bivariant, so no cast is needed at the wiring site.

export interface RenderedLine {
  render(width: number): string[];
  // pi-tui's Component declares `invalidate(): void` as REQUIRED — in 1.2.0, the runtime this
  // extension targets, and in the 1.3.0 types the typecheck gate resolves — so the object handed
  // to renderCall/renderResult must carry it or the gate fails.
  // Static one-line output caches nothing, so the implementation supplies a no-op.
  invalidate(): void;
}

export interface RenderTheme {
  fg(token: string, text: string): string;
  bold(text: string): string;
}

/** One-line preview budget. Truncation happens on the RAW string before painting, so no escape sequence is ever measured. */
const PREVIEW_MAX = 60;

/**
 * Longest raw body a result line may print.
 *
 * A result is not a preview. On a refusal it carries the host's validation error, which is
 * multi-line and arbitrarily long; rendered as-is it produced a 283-column frame line and
 * Pi's TUI aborted (measured 2026-10-26 on 1.3.0: "Rendered line 39 exceeds terminal
 * width"). The budget is applied to the RAW text before painting, so no escape sequence is
 * ever measured, and it is clamped by the width the host asks for.
 */
const RESULT_MAX = 120;

/** Painted before a successful result body. Its width is measured, never assumed. */
const RESULT_PREFIX = "✓ ";

/** Marks text this module cut. Its own cell width is charged to the budget, not forgotten. */
const ELLIPSIS = "…";

/** Compact-row head budget: 120 raw characters plus the ellipsis when something was cut. */
const COMPACT_HEAD_MAX = 120;

/**
 * Widest raw session name a candidate row quotes, in cells.
 *
 * A candidate row is printed by `/scrub` and, as the body of the per-item confirm, by
 * `/scrub:apply`. It is the only row in this module whose text a human typed: `MAX_TEXT`
 * bounds what the extension *proposes*, never what `/name` accepted, so an unbounded name
 * here was the one path that could exceed the terminal width this module exists to respect.
 * 60 cells matches `name.ts:MAX_TEXT`, so the row is as wide as the name the convention
 * would have proposed.
 */
export const CANDIDATE_NAME_MAX = 60;

/** Escape backslashes and double quotes so the value cannot close its own quoting. */
export function escapeQuote(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Cut the raw preview text to PREVIEW_MAX CELLS, appending the ellipsis only when something was cut. */
function preview(raw: string): string {
  if (textCells(raw) <= PREVIEW_MAX) {
    return raw;
  }
  return fitCells(raw, PREVIEW_MAX) + ELLIPSIS;
}

/**
 * Cells one code point occupies, read conservatively: the worst case is the safe case.
 *
 * `strip().length` is not a width. A CJK glyph is one UTF-16 unit and two cells, an emoji is
 * two units and two cells, a combining mark takes none — so a length budget fits the string
 * and overflows the frame, which is the crash this module exists to prevent (measured
 * 2026-10-26: Pi aborts when a component returns a line wider than the terminal).
 */
function cellWidth(codePoint: number): number {
  // Combining marks: they ride the glyph before them.
  if (codePoint >= 0x300 && codePoint <= 0x36f) {
    return 0;
  }
  return codePoint < 0x80 ? 1 : 2;
}

/** Cells a whole string occupies, under the same conservative rule (combining marks 0, ASCII 1, everything else 2). */
export function textCells(text: string): number {
  let total = 0;
  for (const ch of text) {
    total += cellWidth(ch.codePointAt(0) ?? 0);
  }
  return total;
}

/** The longest prefix of `text` that fits in `budget` cells. */
function fitCells(text: string, budget: number): string {
  let used = 0;
  let out = "";
  for (const ch of text) {
    const width = cellWidth(ch.codePointAt(0) ?? 0);
    if (used + width > budget) {
      break;
    }
    used += width;
    out += ch;
  }
  return out;
}

/** Wrap one already-painted line in the single-line component the wiring site hands to the host. */
function singleLine(text: string): RenderedLine {
  return {
    // The width parameter is part of the pi-tui Component contract; a one-line row is
    // the same at any width, so the renderer ignores it.
    render: (_width: number) => [text],
    // Static one-line output: nothing is cached, so re-rendering needs no invalidation.
    invalidate: () => {},
  };
}

/** Collapse any run of whitespace — newlines included — into one space. */
function collapseWhitespace(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** Cells the framing around a preview costs: one separating space and two quotes. */
const PREVIEW_OVERHEAD = 3;

/** What a call line says: the tool, its state, and an optional preview painted in one token. */
interface CallLineParts {
  tool: string;
  key: string;
  previewToken: string;
  previewText: string | undefined;
}

/**
 * Render one call line inside the frame.
 *
 * The same contract as the result line (S2): the visible width never exceeds the width the
 * host asks for, measured in cells. Degradation follows S3 — the preview is shortened, then
 * dropped, and only then is the head itself cut, because the tool and its state are the part
 * the line exists to say. `PREVIEW_MAX` still caps the content on a wide terminal; the frame
 * budget only ever cuts further.
 */
function callLine(parts: CallLineParts, theme: RenderTheme): RenderedLine {
  const headRaw = parts.tool + " ";
  const headCells = textCells(headRaw) + textCells(parts.key);
  const previewRaw = collapseWhitespace(parts.previewText ?? "");
  const paintHead = (): string =>
    theme.fg("toolTitle", theme.bold(headRaw)) + theme.fg("accent", parts.key);
  return {
    render: (width: number) => {
      if (headCells > width) {
        const room = Math.max(0, width - textCells(ELLIPSIS));
        return [theme.fg("toolTitle", theme.bold(fitCells(headRaw + parts.key, room) + ELLIPSIS))];
      }
      const head = paintHead();
      // An empty preview is treated as absent: empty quotes say nothing a human could read.
      if (previewRaw === "") {
        return [head];
      }
      const room = width - headCells - PREVIEW_OVERHEAD;
      if (room < textCells(ELLIPSIS) + 1) {
        return [head];
      }
      const capped = preview(previewRaw);
      const body =
        textCells(capped) > room
          ? fitCells(capped, Math.max(0, room - textCells(ELLIPSIS))) + ELLIPSIS
          : capped;
      return [head + " " + theme.fg(parts.previewToken, '"' + body + '"')];
    },
    invalidate: () => {},
  };
}

export function renderMarkCall(
  args: { verdict: string; reason?: string },
  theme: RenderTheme,
): RenderedLine {
  return callLine(
    { tool: "scrub_mark", key: args.verdict, previewToken: "dim", previewText: args.reason },
    theme,
  );
}

export function renderCloseCall(
  args: { state: string; text: string },
  theme: RenderTheme,
): RenderedLine {
  return callLine(
    { tool: "scrub_close", key: args.state, previewToken: "muted", previewText: args.text },
    theme,
  );
}

/** Structural shape of a tool result this module renders; details.ok is the only tone signal. */
export interface RenderedResult {
  content: readonly { type: string; text?: string }[];
  isError?: boolean;
  details?: { ok?: boolean };
}

export function renderToolResultLine(
  result: RenderedResult,
  _options: { expanded: boolean },
  theme: RenderTheme,
): RenderedLine {
  const first = result.content[0];
  if (first === undefined || first.type !== "text" || first.text === undefined) {
    return singleLine("");
  }
  // Tone reads ONLY the structured ok flag. Its absence means a result without details
  // (an older entry or a foreign producer), which is rendered on the success side: the
  // tool writes ok: false explicitly on every refusal. The one exception is the host's own
  // error flag: a call that never reached the handler (a validation failure) carries no
  // details at all, and a green check on a refusal is a lie.
  const ok = result.details?.ok !== false && result.isError !== true;
  const raw = collapseWhitespace(first.text);
  const prefix = ok ? theme.fg("success", RESULT_PREFIX) : "";
  const prefixWidth = ok ? textCells(RESULT_PREFIX) : 0;
  return {
    // The host tells us how wide the frame is, and aborts the whole TUI on a component
    // that returns a wider line than that (measured 283 > 140 on 2026-10-26). Cutting the
    // RAW text here keeps the visible width inside the frame at every terminal size and at
    // every glyph width, and painting afterwards means an escape sequence is never split.
    render: (width: number) => {
      // The prefix alone does not fit: a body beside it would overflow the frame, so the
      // honest answer is nothing rather than a line wider than the terminal.
      if (width <= prefixWidth) {
        return [""];
      }
      const budget = Math.min(RESULT_MAX, width - prefixWidth);
      const body =
        textCells(raw) <= budget
          ? raw
          : fitCells(raw, Math.max(0, budget - textCells(ELLIPSIS))) + ELLIPSIS;
      return [prefix + theme.fg(ok ? "muted" : "warning", body)];
    },
    invalidate: () => {},
  };
}

// --- Operator-facing text (pure, pinned by render.test.ts; index.ts only wires them) ---

/**
 * Compact one-liner per machine-grade session (UX-02 schema, F2). The weak guess is
 * deliberately ABSENT: this row only ever renders machine-grade rows, whose proposal is
 * the fact `keep`, so a guess column could only ever print a misleading guess. The weak
 * guess lives on in the human-grade packs (formatDigestPack's weak branch).
 * head is a prefix of the already-built pack head — no new extraction.
 */
export function formatCompactRow(args: {
  shortId: string;
  messageCount: number;
  ageDays: number;
  sessionName?: string;
  head: string;
}): string {
  const named =
    args.sessionName !== undefined && args.sessionName.trim().length > 0
      ? `named "${escapeQuote(args.sessionName)}"`
      : "unnamed";
  const headSlice =
    args.head.length > COMPACT_HEAD_MAX
      ? `${args.head.slice(0, COMPACT_HEAD_MAX)}…`
      : args.head;
  return (
    `${args.shortId} · ${args.messageCount}msgs · ${args.ageDays}d · ` +
    `${named} · ${escapeQuote(headSlice)}`
  );
}

/**
 * Confirm body for the per-item trash loop (N3). The audit line and the
 * old-session detail stay on the first line; the reversal sentence gets its
 * own line so it can never read as glued to a reason or a detail fragment.
 *
 * The separator between the audit line and the detail is owned here, not by the
 * caller: a fragment that arrives without its own leading space is still
 * separated, so it can never glue onto a reason (`reason=explicit-trashfirst=…`).
 */
export function formatTrashConfirmBody(auditLine: string, detail: string): string {
  const fragment = detail.trim();
  const firstLine = fragment.length === 0 ? auditLine : `${auditLine} ${fragment}`;
  return `${firstLine}\nMove is reversible via /scrub:restore.`;
}

/** The counted noun of the post-run lines (N4): singular only for exactly one. */
function sessions(count: number): string {
  return count === 1 ? "1 session" : `${count} sessions`;
}

/**
 * One audit row for a session the classifier marked as a disposal candidate (RA-04).
 *
 * The reason is the verdict that made it a candidate; the name, when there is one, is the
 * identification. Both matter here and only here: this row is the body of the per-item
 * deletion confirm (`Trash session <shortId>?`), and since RA-02 a candidate can be a NAMED
 * session for the first time — before it, a name always meant named-protected, so a row
 * never needed to say which name it was about. A hex id alone is not consent to delete
 * `hecho: respuesta del Discord entregada`.
 *
 * An absent or blank name renders exactly the row the audit printed before this existed, so
 * no unnamed candidate changes shape. The name is quoted through `escapeQuote`, the same
 * guard `formatCompactRow` uses: a name must not be able to close its own quoting, and the
 * budget is applied to the RAW name before quoting so an escape sequence is never split.
 *
 * Accepted cost of that order: a name made only of quotes escapes to twice its length, so
 * the quoted form can reach `2 x CANDIDATE_NAME_MAX`. That is still far below the 283-column
 * frame that aborted the TUI on 2026-10-26, which is the failure this budget answers.
 */
export function formatCandidateLine(args: {
  shortId: string;
  reason: string;
  name?: string;
}): string {
  const head = `trash-candidate ${args.shortId} reason=${args.reason}`;
  const raw = args.name;
  if (raw === undefined || raw.trim().length === 0) {
    return head;
  }
  const bounded =
    textCells(raw) <= CANDIDATE_NAME_MAX
      ? raw
      : fitCells(raw, CANDIDATE_NAME_MAX - textCells(ELLIPSIS)) + ELLIPSIS;
  return `${head} named "${escapeQuote(bounded)}"`;
}

/**
 * The refusal `scrub_mark` returns when the name already overrides the write (NB-02, RA-03).
 *
 * Its own function, not a literal inside the handler, for the reason the review gave it
 * (R3-2): `index.ts` cannot be loaded by the runner, so a message inlined there can only be
 * pinned by substring matching, which passes while the sentence around it is rewritten. Here
 * the whole string is assertable, and the handler is reduced to calling it.
 */
export function formatMarkRefusal(currentName: string): string {
  return (
    `This session already declares its state as "${currentName}". The name is the record; ` +
    `use scrub_close to change it. Nothing was written.`
  );
}

/** Pluralized post-run line of /scrub-apply (N4): `Trashed <n> session(s). Remaining: <r>.` */
export function formatTrashResult(count: number, remaining: number): string {
  return `Trashed ${sessions(count)}. Remaining: ${remaining}.`;
}

/** Pluralized post-run line of /scrub-restore (N4): `Restored <n> session(s).` */
export function formatRestoreResult(count: number): string {
  return `Restored ${sessions(count)}.`;
}
