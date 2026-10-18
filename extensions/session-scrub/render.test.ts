// Tests for the host-free renderers (T2, specs S3/S7).
//
// The module is imported host-free on purpose: index.ts cannot be loaded by the test
// runner (it imports the Pi host), so the visible output is pinned here instead, with a
// fake theme that makes every token observable.

import { test } from "node:test";
import assert from "node:assert/strict";

import { renderCloseCall, renderMarkCall, renderToolResultLine } from "./render.ts";

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

test("a mark reason longer than 60 characters is cut at exactly 60 raw characters and ends with the ellipsis", () => {
  const reason = "a".repeat(70);
  const line = renderMarkCall({ verdict: "paused", reason }, theme).render(80);
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

test("a close text longer than 60 characters is cut at exactly 60 raw characters and ends with the ellipsis", () => {
  const text = "c".repeat(61);
  const line = renderCloseCall({ state: "pausa", text }, theme).render(80);
  assert.deepEqual(line, [
    '<toolTitle>**scrub_close **</toolTitle><accent>pausa</accent> <muted>"' +
      "c".repeat(60) +
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
