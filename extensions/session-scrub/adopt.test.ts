// Tests for slice D adoption planning.
//
// The rule under test is a refusal, not a capability: the plugin may fill a state only
// when a machine already asserted it. An explicit verdict is such an assertion; a file
// being old is not. A session that is merely older than seven days is NOT `pausa:` —
// inventing that state would put a promise in /resume that nobody ever made.
//
// The second rule under test is that the human text is never rewritten. An adopted
// session keeps whatever the human wrote; only the missing prefix is supplied.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FRESH_MTIME_MS,
  stateFromVerdict,
  isFresh,
  planAdoption,
  verifyAdoption,
  readSnapshot,
  formatElapsed,
  freshnessWarning,
  findBypassAttempt,
  resolveAssignments,
  parseAssignments,
  type AdoptionCandidate,
} from "./adopt.ts";
import { VERDICTS } from "./classify.ts";
import { STATE } from "./name.ts";

const NOW = 1_700_000_000_000;

function candidate(over: Partial<AdoptionCandidate> = {}): AdoptionCandidate {
  return {
    id: "01a11719-a2ec-71ef-95a5-051c8e405815",
    path: "/sessions/01a11719.jsonl",
    name: undefined,
    verdict: undefined,
    modifiedMs: NOW - 10 * 86400_000,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// stateFromVerdict — only asserted states are derivable
// ---------------------------------------------------------------------------

test("a paused verdict yields pausa and a finished verdict yields hecho", () => {
  assert.equal(stateFromVerdict(VERDICTS.paused), STATE.pausa);
  assert.equal(stateFromVerdict(VERDICTS.finished), STATE.hecho);
});

test("keep, ephemeral and trash yield no state: they answer a different question", () => {
  // These answer "is this worth keeping / discarding", not "where does what comes next
  // live". Filling a state from them would assert something the verdict never said.
  assert.equal(stateFromVerdict(VERDICTS.keep), undefined);
  assert.equal(stateFromVerdict(VERDICTS.ephemeral), undefined);
  assert.equal(stateFromVerdict(VERDICTS.trash), undefined);
});

test("no verdict yields no state", () => {
  assert.equal(stateFromVerdict(undefined), undefined);
});

// ---------------------------------------------------------------------------
// isFresh — the mtime net
// ---------------------------------------------------------------------------

test("a file written 8 seconds ago is fresh", () => {
  assert.equal(isFresh(NOW - 8_000, NOW), true);
});

test("a file written 119 seconds ago is still fresh; 121 is not", () => {
  assert.equal(isFresh(NOW - (FRESH_MTIME_MS - 1000), NOW), true);
  assert.equal(isFresh(NOW - (FRESH_MTIME_MS + 1000), NOW), false);
});

test("a future mtime counts as fresh — clock skew must raise the bar, not lower it", () => {
  // Guarding on `age >= 0` would let a forward-dated file skip confirmation entirely,
  // which is the one direction a skew must never buy.
  assert.equal(isFresh(NOW + 60_000, NOW), true);
});

// ---------------------------------------------------------------------------
// planAdoption — derivable vs. needs-a-human
// ---------------------------------------------------------------------------

test("a paused verdict with a human name is auto-filled, keeping the text", () => {
  const [plan] = planAdoption([candidate({ name: "sys nueva gentle-knowled", verdict: VERDICTS.paused })], new Map(), NOW);
  assert.equal(plan.name, "pausa: sys nueva gentle-knowled");
  assert.equal(plan.skip, undefined);
  assert.equal(plan.derived, true);
});

test("an already-prefixed name is a no-op: the human text is never rewritten", () => {
  const [plan] = planAdoption([candidate({ name: "hecho: triage instalado", verdict: VERDICTS.paused })], new Map(), NOW);
  assert.equal(plan.name, undefined);
  assert.equal(plan.skip, "already-adopted");
});

test("no verdict and no assignment writes nothing", () => {
  const [plan] = planAdoption([candidate({ name: "algo sin veredicto" })], new Map(), NOW);
  assert.equal(plan.name, undefined);
  assert.equal(plan.skip, "needs-state");
});

test("an inline assignment supplies the state the verdict did not", () => {
  // The map is keyed by FULL session id, not by a prefix. Prefix resolution lives in
  // the caller precisely so that an abbreviation matching two sessions is refused
  // rather than silently resolved to whichever one happened to be listed first.
  const assignments = new Map([["01a11719-a2ec-71ef-95a5-051c8e405815", STATE.abierto]]);
  const [plan] = planAdoption([candidate({ name: "revisando el parser" })], assignments, NOW);
  assert.equal(plan.name, "abierto: revisando el parser");
  assert.equal(plan.derived, false);
  assert.equal(plan.skip, undefined);
});

test("an assignment keyed by a prefix does not apply — the caller resolves ids", () => {
  const assignments = new Map([["01a11719", STATE.abierto]]);
  const [plan] = planAdoption([candidate({ name: "revisando el parser" })], assignments, NOW);
  assert.equal(plan.name, undefined);
  assert.equal(plan.skip, "needs-state");
});

test("a prefix-only adoption is flagged textless so the owner knows to /name it later", () => {
  const [plan] = planAdoption([candidate({ verdict: VERDICTS.finished })], new Map(), NOW);
  assert.equal(plan.name, "hecho:");
  assert.equal(plan.textless, true);
});

test("an assignment never overrides an already-prefixed name", () => {
  // The assignment is about adding a missing prefix. A name that already has one is
  // not missing anything, and silently re-prefixing it would rewrite the human layer.
  const assignments = new Map([["01a11719", STATE.pausa]]);
  const [plan] = planAdoption([candidate({ name: "espera: veredicto de F2" })], assignments, NOW);
  assert.equal(plan.name, undefined);
  assert.equal(plan.skip, "already-adopted");
});

test("freshness is reported per plan so only the risky files raise the bar", () => {
  const plans = planAdoption(
    [
      candidate({ id: "aaaaaaaa-0000-0000-0000-000000000001", verdict: VERDICTS.paused, modifiedMs: NOW - 8_000 }),
      candidate({ id: "bbbbbbbb-0000-0000-0000-000000000002", verdict: VERDICTS.paused, modifiedMs: NOW - 600_000 }),
    ],
    new Map(),
    NOW,
  );
  assert.equal(plans[0]!.fresh, true);
  assert.equal(plans[1]!.fresh, false);
});

test("an ambiguous id prefix leaves every match unassigned rather than guessing", () => {
  const assignments = new Map([["01a1", STATE.pausa]]);
  const plans = planAdoption(
    [
      candidate({ id: "01a10000-0000-0000-0000-000000000000", verdict: VERDICTS.finished }),
      candidate({ id: "01a19999-0000-0000-0000-000000000000", verdict: VERDICTS.finished }),
    ],
    assignments,
    NOW,
  );
  // Both already have a derivable state, so the ambiguity cannot hurt them here — but
  // the point is that a prefix never resolves to a single arbitrary session.
  assert.equal(plans[0]!.name, "hecho:");
  assert.equal(plans[1]!.name, "hecho:");
});

// ---------------------------------------------------------------------------
// verifyAdoption — NM-02 post-write check
// ---------------------------------------------------------------------------

test("a write that parsed, gained exactly one entry and set the name verifies", () => {
  const before = { entryCount: 14, name: "viejo", parsed: true };
  const after = { entryCount: 15, name: "hecho: nuevo", parsed: true };
  assert.equal(verifyAdoption(before, after, "hecho: nuevo").ok, true);
});

test("a file that no longer parses fails verification", () => {
  const result = verifyAdoption(
    { entryCount: 14, name: "viejo", parsed: true },
    { entryCount: 15, name: "hecho: nuevo", parsed: false },
    "hecho: nuevo",
  );
  assert.equal(result.ok, false);
});

test("gaining more than one entry fails verification", () => {
  const result = verifyAdoption(
    { entryCount: 14, name: "viejo", parsed: true },
    { entryCount: 16, name: "hecho: nuevo", parsed: true },
    "hecho: nuevo",
  );
  assert.equal(result.ok, false);
  assert.match(result.cause, /exactly one entry/);
});

test("gaining no entry fails verification", () => {
  const result = verifyAdoption(
    { entryCount: 14, name: "viejo", parsed: true },
    { entryCount: 14, name: "viejo", parsed: true },
    "hecho: nuevo",
  );
  assert.equal(result.ok, false);
});

test("a write that gained one entry but named something else fails verification", () => {
  const result = verifyAdoption(
    { entryCount: 14, name: "viejo", parsed: true },
    { entryCount: 15, name: "otro nombre", parsed: true },
    "hecho: nuevo",
  );
  assert.equal(result.ok, false);
  assert.match(result.cause, /name/);
});

// ---------------------------------------------------------------------------
// parseAssignments — the inline `id:estado` grammar
// ---------------------------------------------------------------------------

test("id:estado pairs parse in string order", () => {
  const { ok } = parseAssignments("01a1:pausa 01a2:hecho");
  assert.deepEqual(ok, [
    { idPrefix: "01a1", state: STATE.pausa },
    { idPrefix: "01a2", state: STATE.hecho },
  ]);
});

test("an unknown state is rejected, naming the bad token", () => {
  const { ok, rejected } = parseAssignments("01a1:pausa 01a2:terminado");
  assert.equal(ok.length, 1);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0]!.cause, /unknown state/);
});

test("a typo'd state reports the whole token once and leaves the id unassigned", () => {
  // The rule consumes the whole `id:state` token, so an unknown state is reported once
  // rather than twice. What matters is that the bad token is visible and nothing was
  // assigned from it — a silent drop would leave the human believing a state landed.
  const { ok, rejected } = parseAssignments("01a2:terminado");
  assert.equal(ok.length, 0);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0]!.cause, /unknown state/);
  assert.match(rejected[0]!.cause, /pausa/);
});

test("a repeated id prefix is rejected as a duplicate assignment", () => {
  const { ok, rejected } = parseAssignments("01a1:pausa 01a1:hecho");
  assert.equal(ok.length, 1);
  assert.match(rejected[0]!.cause, /duplicate/);
});

test("a bare id with no state is rejected", () => {
  const { ok, rejected } = parseAssignments("01a1");
  assert.equal(ok.length, 0);
  assert.equal(rejected.length, 1);
});

test("a flag is not a malformed assignment", () => {
  // Found by running the command for real: `/scrub:adopt --apply 01a0aabb:pausa`
  // answered "Rejected --apply: not an id:estado assignment". Flags belong to the
  // caller, and rejecting them warns on every legitimate invocation. Triage had been
  // stripping them first; adopt was not.
  const { ok, rejected } = parseAssignments("--apply");
  assert.equal(ok.length, 0);
  assert.equal(rejected.length, 0);
});

test("a flag beside a real assignment does not disturb it", () => {
  const { ok, rejected } = parseAssignments("--apply 01a1:pausa");
  assert.deepEqual(ok, [{ idPrefix: "01a1", state: STATE.pausa }]);
  assert.equal(rejected.length, 0);
});

test("a malformed id is still rejected even when a flag is present", () => {
  // The flag must not become a blanket exemption.
  const { ok, rejected } = parseAssignments("--apply 01a1");
  assert.equal(ok.length, 0);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0]!.raw, /01a1/);
});

// ---------------------------------------------------------------------------
// readSnapshot — the parse-before / parse-after measurement (NM-02)
// ---------------------------------------------------------------------------

// Mirrors what Pi's SessionManager.open actually accepts, verified against pi 1.0.4:
// the first entry must be a `session` header carrying a string `id`.
const HEADER = '{"type":"session","version":3,"id":"s1","timestamp":"2026-01-01T00:00:00.000Z","cwd":"/tmp"}';

test("a snapshot counts physical lines and reads the last session name", () => {
  const text = [
    HEADER,
    '{"type":"message","message":{"role":"user"}}',
    '{"type":"session_info","name":"viejo"}',
    '{"type":"message","message":{"role":"assistant"}}',
  ].join("\n");
  const snap = readSnapshot(text);
  assert.equal(snap.parsed, true);
  assert.equal(snap.entryCount, 4);
  assert.equal(snap.name, "viejo");
});

test("the header counts as an entry even though Pi's own getEntries() omits it", () => {
  // Verified against pi 1.0.4: a header-only file yields 0 parsed entries. Counting
  // what getEntries() returns would therefore be off by one from the file on disk, and
  // "gained exactly one entry" would silently measure the wrong quantity.
  assert.equal(readSnapshot(HEADER).entryCount, 1);
});

test("a file whose first entry is not a session header is refused", () => {
  // Pi throws "not a valid pi session" for exactly this shape, leaving the file
  // untouched. Detecting it here reports it as ours, before the write is attempted.
  const text = '{"type":"message","message":{"role":"user"}}';
  assert.equal(readSnapshot(text).parsed, false);
});

test("a session header without a string id is refused", () => {
  assert.equal(readSnapshot('{"type":"session","version":3}').parsed, false);
});

test("a malformed first line is refused", () => {
  assert.equal(readSnapshot('{not json\n{"type":"session_info","name":"x"}').parsed, false);
});

test("a malformed line after the header still counts as an entry and keeps the name", () => {
  // The count is physical on purpose: Pi skips a malformed line, so counting parsed
  // entries would under-report a file that already contains one. What must survive is
  // the ability to write at all — appending never rewrites the malformed line.
  const text = [HEADER, '{not json at all', '{"type":"session_info","name":"viejo"}'].join("\n");
  const snap = readSnapshot(text);
  assert.equal(snap.entryCount, 3);
  assert.equal(snap.name, "viejo");
  assert.equal(snap.parsed, true);
});

test("an empty file is a zero-entry snapshot, not a parse failure", () => {
  const snap = readSnapshot("");
  assert.equal(snap.entryCount, 0);
  assert.equal(snap.name, undefined);
  assert.equal(snap.parsed, true);
});

test("a file with no session_info reports no name", () => {
  assert.equal(readSnapshot([HEADER, '{"type":"message","message":{"role":"user"}}'].join("\n")).name, undefined);
});

test("a session_info without a name does not clear a previously seen one", () => {
  const text = [HEADER, '{"type":"session_info","name":"viejo"}', '{"type":"session_info"}'].join("\n");
  assert.equal(readSnapshot(text).name, "viejo");
});

test("a session_info with a non-string name is ignored rather than trusted", () => {
  const text = [HEADER, '{"type":"session_info","name":"viejo"}', '{"type":"session_info","name":42}'].join("\n");
  assert.equal(readSnapshot(text).name, "viejo");
});

// ---------------------------------------------------------------------------
// resolveAssignments — an ambiguous prefix must never pick a session
// ---------------------------------------------------------------------------

test("a unique prefix resolves to its one session", () => {
  const { assignments, problems } = resolveAssignments(parseAssignments("01a1:pausa"), [
    candidate({ id: "01a11719-aaaa" }),
  ]);
  assert.equal(problems.length, 0);
  assert.equal(assignments.get("01a11719-aaaa"), STATE.pausa);
});

test("a prefix matching two sessions is refused, naming the count", () => {
  const { assignments, problems } = resolveAssignments(parseAssignments("01a1:pausa"), [
    candidate({ id: "01a10000-0000-0000-0000-000000000000" }),
    candidate({ id: "01a19999-0000-0000-0000-000000000000" }),
  ]);
  // Picking either one would write a valid name into the wrong session file, silently.
  assert.equal(assignments.size, 0);
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /ambiguous, matches 2/);
});

test("a prefix matching nothing is refused, not silently dropped", () => {
  const { assignments, problems } = resolveAssignments(parseAssignments("ffffff:hecho"), [
    candidate({ id: "01a11719-aaaa" }),
  ]);
  assert.equal(assignments.size, 0);
  assert.match(problems[0]!, /no session in this project matches/);
});

test("a rejected token is surfaced as a problem even when nothing else was given", () => {
  const parsed = parseAssignments("01a1:terminado");
  const { problems } = resolveAssignments(parsed, [candidate()]);
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /unknown state/);
});

test("one ambiguous assignment does not block a resolvable one", () => {
  const parsed = parseAssignments("01a1:pausa 01a2:hecho");
  const { assignments, problems } = resolveAssignments(parsed, [
    candidate({ id: "01a10000-0000-0000-0000-000000000000" }),
    candidate({ id: "01a19999-0000-0000-0000-000000000000" }),
    candidate({ id: "01a2aaaa-0000-0000-0000-000000000000" }),
  ]);
  assert.equal(problems.length, 1);
  assert.equal(assignments.get("01a2aaaa-0000-0000-0000-000000000000"), STATE.hecho);
});

// ---------------------------------------------------------------------------
// formatElapsed — the confirm text must state the elapsed time (NM-03)
// ---------------------------------------------------------------------------

test("elapsed time reads in seconds, then minutes", () => {
  assert.equal(formatElapsed(8), "8 s");
  assert.equal(formatElapsed(119), "1 min 59 s");
});

// ---------------------------------------------------------------------------
// freshnessWarning — what NM-03 requires the confirmation to state
// ---------------------------------------------------------------------------

test("the fresh-mtime warning states the elapsed time", () => {
  assert.match(freshnessWarning(true, 8, "/backups/x.jsonl"), /8 s/);
});

test("the fresh-mtime warning names the backup location", () => {
  // The human cannot assess a write they cannot undo, so the way back has to be in
  // the same breath as the risk.
  assert.match(freshnessWarning(true, 8, "/backups/x.jsonl"), /\/backups\/x\.jsonl/);
});

test("the fresh-mtime warning explains why mtime is not a block", () => {
  const w = freshnessWarning(true, 8, "/backups/x.jsonl");
  assert.match(w, /flush/);
  assert.match(w, /wait/i);
});

test("a settled file gets no warning at all", () => {
  assert.equal(freshnessWarning(false, 900, "/backups/x.jsonl"), "");
});

// ---------------------------------------------------------------------------
// findBypassAttempt — NM-03 forbids any flag that skips the warning
// ---------------------------------------------------------------------------

test("a force flag is recognised as a bypass attempt", () => {
  for (const arg of ["--force", "-f", "--yes", "--skip-guard"]) {
    assert.equal(findBypassAttempt(arg), arg, `expected ${arg} to be detected`);
  }
});

test("an ordinary flag is not mistaken for a bypass attempt", () => {
  assert.equal(findBypassAttempt("--apply"), undefined);
  assert.equal(findBypassAttempt("--dry-run"), undefined);
  assert.equal(findBypassAttempt("01a1:pausa"), undefined);
  assert.equal(findBypassAttempt(""), undefined);
});