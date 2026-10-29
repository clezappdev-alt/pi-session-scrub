// Tests for the host-free renderers (T2, specs S3/S7).
//
// The module is imported host-free on purpose: index.ts cannot be loaded by the test
// runner (it imports the Pi host), so the visible output is pinned here instead, with a
// fake theme that makes every token observable.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  formatCandidateLine,
  formatCompactRow,
  formatRestoreResult,
  formatTrashConfirmBody,
  formatTrashResult,
  renderCloseCall,
  renderMarkCall,
  renderToolResultLine,
} from "./render.ts";

// A fake theme whose fg wraps the text in the token name, so each assertion can see
// exactly which token painted what and no raw escape can hide inside the output.
const theme = {
  fg: (token: string, text: string) => `<${token}>${text}</${token}>`,
  bold: (text: string) => `**${text}**`,
};

test("the mark call paints its title through the toolTitle token and the verdict through accent", () => {
  const line = renderMarkCall({ verdict: "keep" }, theme).render(80);
  assert.deepEqual(line, ["<toolTitle>**scrub_mark **</toolTitle><accent>keep</accent>"]);
});

test("a mark reason is cut to the frame at 80 columns, and says so", () => {
  // 60 characters of content were one cell too many at width 80: the head is 17, the quotes
  // and the space are 3, so the frame leaves 60 and the ellipsis pays two of them.
  const reason = "a".repeat(70);
  const line = renderMarkCall({ verdict: "paused", reason }, theme).render(80);
  assert.deepEqual(line, [
    '<toolTitle>**scrub_mark **</toolTitle><accent>paused</accent> <dim>"' +
      "a".repeat(58) +
      '…"</dim>',
  ]);
});

test("on a wide terminal the preview keeps its own 60-cell cap", () => {
  // PREVIEW_MAX is a content budget, not a frame budget: the frame only ever cuts further.
  const reason = "a".repeat(70);
  const line = renderMarkCall({ verdict: "paused", reason }, theme).render(200);
  assert.deepEqual(line, [
    '<toolTitle>**scrub_mark **</toolTitle><accent>paused</accent> <dim>"' +
      "a".repeat(60) +
      '…"</dim>',
  ]);
});

test("a mark reason at exactly 60 characters is not cut", () => {
  const reason = "b".repeat(60);
  const line = renderMarkCall({ verdict: "keep", reason }, theme).render(80);
  assert.deepEqual(line, [
    '<toolTitle>**scrub_mark **</toolTitle><accent>keep</accent> <dim>"' +
      "b".repeat(60) +
      '"</dim>',
  ]);
});

test("the close call paints its title through the toolTitle token and the state through accent", () => {
  const line = renderCloseCall({ state: "hecho", text: "shipped the renderer" }, theme).render(80);
  assert.deepEqual(line, [
    '<toolTitle>**scrub_close **</toolTitle><accent>hecho</accent> <muted>"shipped the renderer"</muted>',
  ]);
});

test("a close text is cut to the frame at 80 columns, and says so", () => {
  const text = "c".repeat(61);
  const line = renderCloseCall({ state: "pausa", text }, theme).render(80);
  assert.deepEqual(line, [
    '<toolTitle>**scrub_close **</toolTitle><accent>pausa</accent> <muted>"' +
      "c".repeat(58) +
      '…"</muted>',
  ]);
});

test("a successful result line carries the success tone", () => {
  const result = {
    content: [{ type: "text", text: "Recorded verdict: keep." }],
    details: { ok: true },
  };
  const line = renderToolResultLine(result, { expanded: false }, theme).render(80);
  assert.deepEqual(line, ["<success>✓ </success><muted>Recorded verdict: keep.</muted>"]);
});

test("a failed result line carries the warning tone", () => {
  const result = {
    content: [{ type: "text", text: "Could not record verdict: disk full" }],
    details: { ok: false },
  };
  const line = renderToolResultLine(result, { expanded: false }, theme).render(80);
  assert.deepEqual(line, ["<warning>Could not record verdict: disk full</warning>"]);
});

test("the expanded and collapsed result lines are identical, because there is nothing further to reveal", () => {
  const result = {
    content: [{ type: "text", text: "Session name set: hecho: done" }],
    details: { ok: true },
  };
  const collapsed = renderToolResultLine(result, { expanded: false }, theme).render(80);
  const expanded = renderToolResultLine(result, { expanded: true }, theme).render(80);
  assert.deepEqual(collapsed, expanded);
});

test("a result with no first content block renders one empty line", () => {
  const line = renderToolResultLine({ content: [], details: { ok: true } }, { expanded: false }, theme).render(80);
  assert.deepEqual(line, [""]);
});

test("a result whose first content block is not text renders one empty line", () => {
  const result = {
    content: [{ type: "image" }],
    details: { ok: true },
  };
  const line = renderToolResultLine(result, { expanded: true }, theme).render(80);
  assert.deepEqual(line, [""]);
});

test("no rendered line ever contains a raw escape character", () => {
  const lines = [
    ...renderMarkCall({ verdict: "keep", reason: "why" }, theme).render(80),
    ...renderCloseCall({ state: "hecho", text: "done" }, theme).render(80),
    ...renderToolResultLine(
      { content: [{ type: "text", text: "ok" }], details: { ok: true } },
      { expanded: false },
      theme,
    ).render(80),
    ...renderToolResultLine(
      { content: [{ type: "text", text: "no" }], details: { ok: false } },
      { expanded: true },
      theme,
    ).render(80),
  ];
  for (const line of lines) {
    assert.ok(!line.includes("\u001b"), `line contains a raw escape: ${JSON.stringify(line)}`);
  }
});

// --- Compact machine row (UX-02 schema, F2: the weak guess is gone) ---

test("the compact machine row renders the four fields with exact separators and no weak-guess field", () => {
  const row = formatCompactRow({
    shortId: "01a14ce0",
    messageCount: 12,
    ageDays: 3,
    sessionName: "ship the renderer",
    head: "hello world",
  });
  assert.equal(row, '01a14ce0 · 12msgs · 3d · named "ship the renderer" · hello world');
});

test("the compact machine row prints unnamed for an absent or blank name", () => {
  const absent = formatCompactRow({ shortId: "aabbccdd", messageCount: 1, ageDays: 0, head: "h" });
  assert.equal(absent, "aabbccdd · 1msgs · 0d · unnamed · h");
  const blank = formatCompactRow({
    shortId: "aabbccdd",
    messageCount: 1,
    ageDays: 0,
    sessionName: "   ",
    head: "h",
  });
  assert.equal(blank, "aabbccdd · 1msgs · 0d · unnamed · h");
});

// --- Candidate row (RA-04: a deletion consent names the session it deletes) ---

test("a named candidate row carries the name it is about", () => {
  // RA-02 makes a named session reachable as a candidate for the first time. The confirm
  // reads `Trash session <shortId>?` with this row as its body, so without the name a human
  // confirms deleting `hecho: respuesta del Discord entregada` while seeing a hex id.
  const row = formatCandidateLine({
    shortId: "01a18214",
    reason: "ephemeral",
    name: "hecho: respuesta del Discord entregada",
  });
  assert.equal(
    row,
    'trash-candidate 01a18214 reason=ephemeral named "hecho: respuesta del Discord entregada"',
  );
});

test("an unnamed candidate row is byte-identical to the line the audit already printed", () => {
  for (const name of [undefined, "", "   "]) {
    assert.equal(
      formatCandidateLine({ shortId: "01a18214", reason: "explicit-trash", name }),
      "trash-candidate 01a18214 reason=explicit-trash",
    );
  }
});

test("a name that could close its own quoting is escaped", () => {
  const row = formatCandidateLine({ shortId: "aabbccdd", reason: "ephemeral", name: 'a "b" c' });
  assert.equal(row, 'trash-candidate aabbccdd reason=ephemeral named "a \\"b\\" c"');
});

test("the compact machine row truncates a head longer than 120 characters to 120 plus the ellipsis, and leaves a head at exactly 120 untouched", () => {
  const long = formatCompactRow({
    shortId: "aabbccdd",
    messageCount: 1,
    ageDays: 0,
    head: "h".repeat(121),
  });
  assert.equal(long, `aabbccdd · 1msgs · 0d · unnamed · ${"h".repeat(120)}…`);
  const exact = formatCompactRow({
    shortId: "aabbccdd",
    messageCount: 1,
    ageDays: 0,
    head: "h".repeat(120),
  });
  assert.equal(exact, `aabbccdd · 1msgs · 0d · unnamed · ${"h".repeat(120)}`);
});

// --- Trash confirm body (N3: the reversal sentence stands on its own line) ---

test("the trash confirm body for a candidate puts the reversal sentence on its own line right after the audit line", () => {
  const body = formatTrashConfirmBody("trash-candidate 01a14ce0 reason=explicit-trash", "");
  assert.equal(
    body,
    "trash-candidate 01a14ce0 reason=explicit-trash\nMove is reversible via /scrub:restore.",
  );
});

test("the trash confirm body for an old session keeps its detail on the audit line and the reversal sentence on its own line", () => {
  const body = formatTrashConfirmBody(
    'review 01a14ce0 msgs=9 modified=2026-01-01T00:00:00.000Z first="old chat"',
    ' first="old chat, extended" modified=2026-01-02T00:00:00.000Z',
  );
  assert.equal(
    body,
    'review 01a14ce0 msgs=9 modified=2026-01-01T00:00:00.000Z first="old chat"' +
      ' first="old chat, extended" modified=2026-01-02T00:00:00.000Z' +
      "\nMove is reversible via /scrub:restore.",
  );
});

// --- Result lines (N4: pluralization) ---

test("the trash result line is singular for one session and plural otherwise, keeping the remaining count", () => {
  assert.equal(formatTrashResult(1, 4), "Trashed 1 session. Remaining: 4.");
  assert.equal(formatTrashResult(3, 2), "Trashed 3 sessions. Remaining: 2.");
});

test("the restore result line is singular for one session and plural otherwise", () => {
  assert.equal(formatRestoreResult(1), "Restored 1 session.");
  assert.equal(formatRestoreResult(2), "Restored 2 sessions.");
});

// --- R2-confirm-body-delimiter: the function owns the separator, so a detail fragment
// that arrives without its own leading space can never glue to the audit line ---

test("the trash confirm body inserts the separator itself when the detail fragment has no leading space", () => {
  const body = formatTrashConfirmBody('review 01a14ce0 msgs=9', 'first="old chat"');
  assert.equal(
    body,
    'review 01a14ce0 msgs=9 first="old chat"\nMove is reversible via /scrub:restore.',
  );
});

// --- R3-coverage-escape-quote: the compact row quotes its name and its head as data ---

test("the compact machine row escapes quotes and backslashes in the name and the head", () => {
  const row = formatCompactRow({
    shortId: "01a14ce0",
    messageCount: 3,
    ageDays: 1,
    sessionName: 'ship the "renderer"',
    head: 'say "hi" \\ now',
  });
  assert.equal(
    row,
    '01a14ce0 · 3msgs · 1d · named "ship the \\"renderer\\"" · say \\"hi\\" \\\\ now',
  );
});

// --- R3-coverage-zero-count: zero is plural, and the remaining count is kept ---

test("the result lines pluralize zero sessions", () => {
  assert.equal(formatTrashResult(0, 9), "Trashed 0 sessions. Remaining: 9.");
  assert.equal(formatRestoreResult(0), "Restored 0 sessions.");
});

// --- Result lines are bounded: a tool error must never break the frame -------------

/**
 * Visible characters of a painted line: the fake theme's `<token>` wrappers and its `**` bold
 * markers are structural, not text, so neither counts toward the frame.
 */
function visible(text: string): string {
  return text.replace(/<[^>]+>/g, "").replace(/\*\*/g, "");
}

const VALIDATION_FAILURE =
  'Validation failed for tool "scrub_close":\n' +
  "  - state: must be equal to constant\n" +
  "  - state: must be equal to constant\n" +
  "  - state: must be equal to constant\n" +
  "  - state: must be equal to constant\n" +
  "  - state: must match a schema in anyOf\n" +
  "\nReceived arguments:\n{\n" +
  '  "state": "traspaso",\n' +
  '  "text": "x"\n}';

test("a multiline refusal renders as one bounded line, not a 283-character frame line", () => {
  // Measured on 2026-10-26: this exact payload rendered 283 columns wide and Pi's TUI
  // aborts when a component emits a line wider than the terminal.
  const line = renderToolResultLine(
    { content: [{ type: "text", text: VALIDATION_FAILURE }], isError: true },
    { expanded: false },
    theme,
  ).render(140);
  assert.equal(line.length, 1, "a result line is always exactly one frame line");
  assert.equal(line[0].includes("\n"), false, "a newline inside a frame line breaks the renderer");
  assert.ok(visible(line[0]).length <= 140, `too wide: ${visible(line[0]).length}`);
  assert.ok(line[0].includes("Validation failed"), "the first sentence is the part worth reading");
});

test("a narrow terminal still gets one line, cut with the ellipsis", () => {
  const line = renderToolResultLine(
    { content: [{ type: "text", text: "x".repeat(300) }], details: { ok: true } },
    { expanded: false },
    theme,
  ).render(40);
  assert.equal(line.length, 1);
  assert.ok(visible(line[0]).length <= 40, `too wide: ${visible(line[0]).length}`);
  assert.ok(visible(line[0]).endsWith("…"), "a cut line says so");
});

test("a host-flagged error result takes the warning tone even without details", () => {
  // A validation failure never reaches the handler, so it carries no details.ok; the
  // host still marks it as an error, and a green check on a refusal is a lie.
  const line = renderToolResultLine(
    { content: [{ type: "text", text: "invalid arguments" }], isError: true },
    { expanded: false },
    theme,
  ).render(80);
  assert.deepEqual(line, ["<warning>invalid arguments</warning>"]);
});

test("a frame narrower than the check prefix renders nothing instead of overflowing", () => {
  // At width 2 there is no room for a body beside "✓ ", and any body would push the line
  // past the frame — the same abort this budget exists to prevent. Report-only finding
  // R4-001 from the review of the handoff-promise candidate.
  const line = renderToolResultLine(
    { content: [{ type: "text", text: "anything" }], details: { ok: true } },
    { expanded: false },
    theme,
  ).render(2);
  assert.deepEqual(line, [""]);
});

/**
 * Cell width, counted conservatively: combining marks take none, everything outside ASCII
 * takes two, ASCII takes one. This is the oracle for the budget, and it is deliberately
 * stricter than the implementation so a wide character can never sneak past a frame.
 */
function cells(text: string): number {
  let total = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x300 && cp <= 0x36f) continue;
    total += cp < 0x80 ? 1 : 2;
  }
  return total;
}

test("a body of wide characters is budgeted by cells, not by string length", () => {
  // 40 CJK glyphs are 40 UTF-16 units and 80 cells: a length-based budget fits the data
  // and overflows the frame, which is the crash this budget exists to prevent
  // (report-only finding R4-001 from the second review).
  const line = renderToolResultLine(
    { content: [{ type: "text", text: "漢".repeat(40) }], details: { ok: true } },
    { expanded: false },
    theme,
  ).render(40);
  assert.equal(line.length, 1);
  assert.ok(cells(visible(line[0])) <= 40, `too wide: ${cells(visible(line[0]))} cells`);
});

test("the check prefix is budgeted by cells too", () => {
  // "✓" is East Asian Ambiguous: two cells in a conservative reading, plus the space.
  const line = renderToolResultLine(
    { content: [{ type: "text", text: "x" }], details: { ok: true } },
    { expanded: false },
    theme,
  ).render(3);
  assert.deepEqual(line, [""], "three cells are exactly the prefix; no body fits");
});

// --- The call line is a frame line too (change session-scrub-line-budget) ----------

test("a call line with a wide preview is cut to the frame, not left at 82 cells", () => {
  // Measured before this change: head 19 cells plus a 60-cell preview plus quotes and a
  // space is 82, and Pi aborts the TUI on a component line wider than the frame.
  const line = renderCloseCall({ state: "abierto", text: "漢".repeat(60) }, theme).render(60);
  assert.equal(line.length, 1);
  assert.ok(cells(visible(line[0])) <= 60, `too wide: ${cells(visible(line[0]))} cells`);
});

test("when the preview cannot fit, it is dropped and the head stays readable", () => {
  const line = renderCloseCall({ state: "abierto", text: "algo" }, theme).render(20);
  assert.deepEqual(line, ["<toolTitle>**scrub_close **</toolTitle><accent>abierto</accent>"]);
});

test("when even the head does not fit, the line is cut with the ellipsis", () => {
  const line = renderMarkCall({ verdict: "paused", reason: "why" }, theme).render(10);
  assert.equal(line.length, 1);
  assert.ok(cells(visible(line[0])) <= 10, `too wide: ${cells(visible(line[0]))} cells`);
  assert.ok(visible(line[0]).endsWith("…"), "a cut line says so");
});

test("a call line that fits is untouched at any width above it", () => {
  const wide = renderCloseCall({ state: "hecho", text: "done" }, theme).render(120);
  const exact = renderCloseCall({ state: "hecho", text: "done" }, theme).render(80);
  assert.deepEqual(wide, exact);
  assert.deepEqual(wide, ['<toolTitle>**scrub_close **</toolTitle><accent>hecho</accent> <muted>"done"</muted>']);
});
