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
  // plugin targets, and in the 1.3.0 types the typecheck gate resolves — so the object handed
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

/** Cut the raw preview text to PREVIEW_MAX characters, appending the ellipsis only when something was cut. */
function preview(raw: string): string {
  if (raw.length <= PREVIEW_MAX) {
    return raw;
  }
  return raw.slice(0, PREVIEW_MAX) + "…";
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

/** Painted header shared by both call renderers: bold tool name under toolTitle, then the key value under accent. */
function callLine(tool: string, key: string, theme: RenderTheme): string {
  return theme.fg("toolTitle", theme.bold(tool + " ")) + theme.fg("accent", key);
}

/** Quoted preview painted in the given token, or nothing when the text is absent. */
function quotedPreview(token: string, raw: string | undefined, theme: RenderTheme): string {
  // An empty string is treated as absent: empty quotes say nothing a human could read.
  if (raw === undefined || raw === "") {
    return "";
  }
  return " " + theme.fg(token, '"' + preview(raw) + '"');
}

export function renderMarkCall(
  args: { verdict: string; reason?: string },
  theme: RenderTheme,
): RenderedLine {
  return singleLine(callLine("scrub_mark", args.verdict, theme) + quotedPreview("dim", args.reason, theme));
}

export function renderCloseCall(
  args: { state: string; text: string },
  theme: RenderTheme,
): RenderedLine {
  return singleLine(callLine("scrub_close", args.state, theme) + quotedPreview("muted", args.text, theme));
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
  // (an older entry or a foreign producer), which is rendered on the success side:
  // the tool writes ok: false explicitly on every refusal.
  const ok = result.details?.ok !== false;
  const text = first.text;
  const line = ok
    ? theme.fg("success", "✓ ") + theme.fg("muted", text)
    : theme.fg("warning", text);
  return singleLine(line);
}
