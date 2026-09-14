// pi-session-scrub — slice 1 implementation (SDD change session-scrub-cleanup).
//
// Rules: zero tokens by default (opt-in commands only, no before_agent_start
// injection), explicit + reversible destruction (plugin-owned trash dir, never
// destructive deletion), live session never touched, silent close (no shutdown handler
// handler registered — the absence is intentional, spec T9).

import { dirname, join, basename } from "node:path";
import {
  renameSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  realpathSync,
} from "node:fs";
import { Type, type Static } from "typebox";
import {
  SessionManager,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  type SessionEntry,
  type SessionInfo,
} from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Age gate: sessions >= 7 days old need confirmation with detail (never auto). */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const VERDICTS = {
  keep: "keep",
  paused: "paused",
  finished: "finished",
  ephemeral: "ephemeral",
  trash: "trash",
} as const;
type Verdict = (typeof VERDICTS)[keyof typeof VERDICTS];

const CLASS_KIND = {
  live: "live",
  namedProtected: "named-protected",
  autoDeletable: "auto-deletable",
  candidate: "candidate",
  oldNeedsConfirm: "old-needs-confirm",
  kept: "kept",
} as const;

const CANDIDATE_REASON = {
  explicitTrash: "explicit-trash",
  finished: "finished",
  ephemeral: "ephemeral",
  empty: "empty",
} as const;
type CandidateReason =
  (typeof CANDIDATE_REASON)[keyof typeof CANDIDATE_REASON];

const VERDICT_CUSTOM_TYPE = "session-scrub/verdict";
const HINT_CUSTOM_TYPE = "session-scrub/name-hint";
const POLICY_START = "<!-- pi-session-scrub:start -->";
const POLICY_END = "<!-- pi-session-scrub:end -->";
const STATUS_KEY = "scrub-name";

const POLICY_TEMPLATE = `<!-- pi-session-scrub:start -->
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
// Flat interfaces (strict-typed, no nested unions beyond Classification)
// ---------------------------------------------------------------------------

interface VerdictData {
  version: number;
  verdict: Verdict;
  at: string;
  reason?: string;
}

interface SessionDetail {
  name?: string;
  firstMessage: string;
  messageCount: number;
  created: Date;
  modified: Date;
  verdict?: Verdict;
}

interface LiveClassification {
  kind: typeof CLASS_KIND.live;
}
interface NamedProtectedClassification {
  kind: typeof CLASS_KIND.namedProtected;
  name: string;
  verdict?: Verdict;
}
interface AutoDeletableClassification {
  kind: typeof CLASS_KIND.autoDeletable;
  reason: typeof CANDIDATE_REASON.empty;
}
interface CandidateClassification {
  kind: typeof CLASS_KIND.candidate;
  reason: CandidateReason;
  verdict?: Verdict;
}
interface OldNeedsConfirmClassification {
  kind: typeof CLASS_KIND.oldNeedsConfirm;
  detail: SessionDetail;
}
interface KeptClassification {
  kind: typeof CLASS_KIND.kept;
  reason: string;
}
type Classification =
  | LiveClassification
  | NamedProtectedClassification
  | AutoDeletableClassification
  | CandidateClassification
  | OldNeedsConfirmClassification
  | KeptClassification;

interface PolicyConfig {
  ephemeralFlows: string[];
}

interface AuditedSession {
  info: SessionInfo;
  verdict?: Verdict;
  classification: Classification;
}

interface AuditSummary {
  total: number;
  named: number;
  autoDeletable: number;
  candidates: number;
  oldNeedsConfirm: number;
  kept: number;
}

// ---------------------------------------------------------------------------
// Pure functions (no ctx, no fs)
// ---------------------------------------------------------------------------

function isVerdict(value: unknown): value is Verdict {
  return (
    typeof value === "string" &&
    (Object.values(VERDICTS) as string[]).includes(value)
  );
}

function asVerdictData(data: unknown): VerdictData | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const d = data as { version?: unknown; verdict?: unknown; at?: unknown };
  if (typeof d.version !== "number") return undefined;
  if (!isVerdict(d.verdict)) return undefined;
  if (typeof d.at !== "string") return undefined;
  return { version: d.version, verdict: d.verdict, at: d.at };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Exact `/skill:<flow>` token match. No substring/fuzzy matching. */
function matchesEphemeralFlow(text: string, flows: string[]): boolean {
  return flows.some((flow) => {
    if (flow.length === 0) return false;
    const re = new RegExp(`(?:^|\\s)/skill:${escapeRegExp(flow)}(?:\\s|$)`);
    return re.test(text);
  });
}

function deriveSlug(firstUserText: string): string {
  return firstUserText
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** D2 decision tree verbatim: live → named-trash-only → candidates → empty → old → kept. */
interface LiveIdentity {
  path?: string;
  id?: string;
}

/** Same file even if one side is a symlink or relative: compare resolved paths. */
function samePath(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

function classifySession(
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

/** F4 grammar: skip `#`/blank lines; `<...>` placeholders read as empty. */
function parsePolicyBlock(text: string): PolicyConfig | undefined {
  if (!text.includes(POLICY_START) || !text.includes(POLICY_END)) {
    return undefined;
  }
  const flows: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
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
  return { ephemeralFlows: flows };
}

/**
 * Interactive only in the TUI with dialog UI. Deviation note: Pi reports
 * hasUI true in RPC mode too, but an unattended caller cannot answer, so
 * every non-TUI mode degrades to dry-run (never blocks).
 */
function isInteractive(ctx: { mode: string; hasUI: boolean }): boolean {
  return ctx.mode === "tui" && ctx.hasUI;
}

function resolveDryRun(args: string, ctx: { mode: string; hasUI: boolean }): boolean {
  return args.includes("--dry-run") || !isInteractive(ctx);
}

function formatAuditLine(a: AuditedSession): string {
  const short = a.info.id.slice(0, 8);
  switch (a.classification.kind) {
    case CLASS_KIND.live:
      return a.info.path === ""
        ? `live ${short} (current session, unsaved, never touched)`
        : `live ${short} (current session, never touched)`;
    case CLASS_KIND.namedProtected:
      return `kept ${short} named "${a.classification.name}"`;
    case CLASS_KIND.autoDeletable:
      return `auto ${short} empty`;
    case CLASS_KIND.candidate:
      return `trash-candidate ${short} reason=${a.classification.reason}`;
    case CLASS_KIND.oldNeedsConfirm: {
      const d = a.classification.detail;
      return `review ${short} msgs=${d.messageCount} modified=${d.modified.toISOString()} first="${d.firstMessage.slice(0, 60)}"`;
    }
    case CLASS_KIND.kept:
      return `kept ${short} ${a.classification.reason}`;
  }
}

// ---------------------------------------------------------------------------
// Entry readers (never throw outward: malformed entries are skipped)
// ---------------------------------------------------------------------------

interface TextPart {
  type: string;
  text: string;
}

function isTextPart(part: unknown): part is TextPart {
  if (typeof part !== "object" || part === null) return false;
  const p = part as { type?: unknown; text?: unknown };
  return p.type === "text" && typeof p.text === "string";
}

/** User message texts of a session, in order. */
function userTexts(entries: SessionEntry[]): string[] {
  const out: string[] = [];
  for (const e of entries) {
    if (e.type !== "message") continue;
    const msg = (e as unknown as { message?: unknown }).message;
    if (typeof msg !== "object" || msg === null) continue;
    const m = msg as { role?: unknown; content?: unknown };
    if (m.role !== "user" || !Array.isArray(m.content)) continue;
    const text = m.content
      .filter(isTextPart)
      .map((p) => p.text)
      .join(" ");
    if (text.length > 0) out.push(text);
  }
  return out;
}

function openSessionEntries(path: string): SessionEntry[] {
  try {
    return SessionManager.open(path).getEntries();
  } catch {
    return [];
  }
}

function readLatestVerdict(entries: SessionEntry[]): Verdict | undefined {
  let latest: VerdictData | undefined;
  for (const e of entries) {
    if (e.type !== "custom") continue;
    const c = e as unknown as { customType?: unknown; data?: unknown };
    if (c.customType !== VERDICT_CUSTOM_TYPE) continue;
    const v = asVerdictData(c.data);
    if (v === undefined) continue;
    if (latest === undefined || v.at > latest.at) latest = v;
  }
  return latest?.verdict;
}

function hasCustomType(entries: SessionEntry[], customType: string): boolean {
  return entries.some((e) => {
    if (e.type !== "custom") return false;
    return (e as unknown as { customType?: unknown }).customType === customType;
  });
}

function readPolicyConfig(cwd: string): PolicyConfig {
  try {
    const text = readFileSync(join(cwd, "AGENTS.md"), "utf-8");
    return parsePolicyBlock(text) ?? { ephemeralFlows: [] };
  } catch {
    return { ephemeralFlows: [] };
  }
}

// ---------------------------------------------------------------------------
// FS helpers (throwing atomic moves; callers catch per file)
// ---------------------------------------------------------------------------

/** Trash dir as sibling of Pi's `sessions/` root (two levels up from the
 * per-project dir) — never an invented transform, and never inside
 * `sessions/` where Pi could mistake trashed files for live sessions. */
function getTrashDir(sessionDir: string): string {
  return join(
    dirname(dirname(sessionDir)),
    "session-scrub-trash",
    basename(sessionDir),
  );
}

function moveToTrash(sessionPath: string, trashDir: string): string {
  mkdirSync(trashDir, { recursive: true });
  const trashPath = join(trashDir, basename(sessionPath));
  renameSync(sessionPath, trashPath);
  return trashPath;
}

function moveFromTrash(trashedPath: string, sessionsDir: string): string {
  mkdirSync(sessionsDir, { recursive: true });
  const restoredPath = join(sessionsDir, basename(trashedPath));
  if (existsSync(restoredPath)) {
    throw new Error(`restore target already exists: ${restoredPath}`);
  }
  renameSync(trashedPath, restoredPath);
  return restoredPath;
}

function listTrash(trashDir: string): string[] {
  try {
    return readdirSync(trashDir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => join(trashDir, f));
  } catch {
    return [];
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Shared audit
// ---------------------------------------------------------------------------

async function auditSessions(ctx: ExtensionCommandContext): Promise<{
  audited: AuditedSession[];
  summary: AuditSummary;
}> {
  const policy = readPolicyConfig(ctx.cwd);
  const live: LiveIdentity = {
    path: ctx.sessionManager.getSessionFile(),
    id: ctx.sessionManager.getSessionId(),
  };
  const sessions = await SessionManager.list(ctx.cwd);
  const audited: AuditedSession[] = sessions.map((info) => {
    const isLive =
      (live.path !== undefined && samePath(info.path, live.path)) ||
      (live.id !== undefined && info.id === live.id);
    const entries = isLive
      ? ctx.sessionManager.getEntries()
      : openSessionEntries(info.path);
    const verdict = readLatestVerdict(entries);
    const ephemeralFlow =
      verdict !== VERDICTS.trash &&
      matchesEphemeralFlow(userTexts(entries).join("\n"), policy.ephemeralFlows);
    return { info, verdict, classification: classifySession(info, live, verdict, ephemeralFlow) };
  });
  if (
    live.id !== undefined &&
    !audited.some((a) => a.classification.kind === CLASS_KIND.live)
  ) {
    const liveEntries = ctx.sessionManager.getEntries();
    const liveTexts = userTexts(liveEntries);
    const now = new Date();
    const liveInfo: SessionInfo = {
      path: live.path ?? "",
      id: live.id,
      cwd: ctx.cwd,
      name: ctx.sessionManager.getSessionName(),
      created: now,
      modified: now,
      messageCount: liveEntries.length,
      firstMessage: liveTexts[0] ?? "",
      allMessagesText: liveTexts.join("\n"),
    };
    audited.unshift({
      info: liveInfo,
      verdict: readLatestVerdict(liveEntries),
      classification: { kind: CLASS_KIND.live },
    });
  }
  const summary: AuditSummary = {
    total: audited.length,
    named: audited.filter((a) => a.classification.kind === CLASS_KIND.namedProtected).length,
    autoDeletable: audited.filter((a) => a.classification.kind === CLASS_KIND.autoDeletable).length,
    candidates: audited.filter((a) => a.classification.kind === CLASS_KIND.candidate).length,
    oldNeedsConfirm: audited.filter((a) => a.classification.kind === CLASS_KIND.oldNeedsConfirm).length,
    kept: audited.filter((a) => a.classification.kind === CLASS_KIND.kept).length,
  };
  return { audited, summary };
}

function summaryLine(summary: AuditSummary): string {
  return (
    `scrub: ${summary.total} sessions (${summary.named} named, ` +
    `${summary.autoDeletable} auto-deletable, ${summary.candidates} candidates, ` +
    `${summary.oldNeedsConfirm} to review, ${summary.kept} kept).`
  );
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

async function handleScrub(args: string, ctx: ExtensionCommandContext): Promise<void> {
  void args;
  const { audited, summary } = await auditSessions(ctx);
  const lines = [summaryLine(summary), ...audited.map(formatAuditLine)];
  ctx.ui.notify(lines.join("\n"), "info");
}

function isActionable(a: AuditedSession): boolean {
  return (
    a.classification.kind === CLASS_KIND.autoDeletable ||
    a.classification.kind === CLASS_KIND.candidate ||
    a.classification.kind === CLASS_KIND.oldNeedsConfirm
  );
}

async function handleScrubApply(args: string, ctx: ExtensionCommandContext): Promise<void> {
  const { audited, summary } = await auditSessions(ctx);
  const actionable = audited.filter(isActionable);
  if (actionable.length === 0) {
    ctx.ui.notify(`${summaryLine(summary)} Nothing to trash.`, "info");
    return;
  }
  if (resolveDryRun(args, ctx)) {
    const lines = [
      `${summaryLine(summary)} Dry-run — nothing moved.`,
      ...actionable.map(formatAuditLine),
    ];
    ctx.ui.notify(lines.join("\n"), "info");
    return;
  }
  const trashDir = getTrashDir(ctx.sessionManager.getSessionDir());
  let trashed = 0;
  for (const a of actionable) {
    const detail =
      a.classification.kind === CLASS_KIND.oldNeedsConfirm
        ? ` first="${a.classification.detail.firstMessage.slice(0, 80)}" modified=${a.classification.detail.modified.toISOString()}`
        : "";
    const ok = await ctx.ui.confirm(
      `Trash session ${a.info.id.slice(0, 8)}?`,
      `${formatAuditLine(a)}${detail} Move is reversible via /scrub-restore.`,
    );
    if (!ok) continue;
    try {
      moveToTrash(a.info.path, trashDir);
      trashed += 1;
    } catch (err) {
      ctx.ui.notify(`Skipped ${a.info.id.slice(0, 8)}: ${errorMessage(err)}`, "warning");
    }
  }
  const relisted = await SessionManager.list(ctx.cwd);
  ctx.ui.notify(`Trashed ${trashed} sessions. Remaining: ${relisted.length}.`, "info");
}

async function handleScrubRestore(args: string, ctx: ExtensionCommandContext): Promise<void> {
  void args;
  const sessionsDir = ctx.sessionManager.getSessionDir();
  const trashed = listTrash(getTrashDir(sessionsDir));
  if (trashed.length === 0) {
    ctx.ui.notify("No trashed sessions for this project.", "info");
    return;
  }
  if (!isInteractive(ctx)) {
    ctx.ui.notify(
      `Dry-run — nothing restored:\n${trashed.map((p) => basename(p)).join("\n")}`,
      "info",
    );
    return;
  }
  let restored = 0;
  for (const p of trashed) {
    const ok = await ctx.ui.confirm(
      `Restore session ${basename(p, ".jsonl").slice(0, 8)}?`,
      "Moves the session file back so /resume shows it again.",
    );
    if (!ok) continue;
    try {
      moveFromTrash(p, sessionsDir);
      restored += 1;
    } catch (err) {
      ctx.ui.notify(`Skipped ${basename(p)}: ${errorMessage(err)}`, "warning");
    }
  }
  ctx.ui.notify(`Restored ${restored} sessions.`, "info");
}

async function handleScrubInit(args: string, ctx: ExtensionCommandContext): Promise<void> {
  void args;
  const agentsPath = join(ctx.cwd, "AGENTS.md");
  let existing = "";
  try {
    existing = readFileSync(agentsPath, "utf-8");
  } catch {
    existing = "";
  }
  if (existing.includes(POLICY_START)) {
    ctx.ui.notify("Policy block already exists.", "info");
    return;
  }
  const sep = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  writeFileSync(agentsPath, `${existing}${sep}\n${POLICY_TEMPLATE}`);
  ctx.ui.notify("Policy block written to AGENTS.md. Fill ephemeral-flows for this project.", "info");
}

// ---------------------------------------------------------------------------
// scrub_mark tool + naming hint
// ---------------------------------------------------------------------------

const ScrubMarkParams = Type.Object({
  verdict: Type.Union([
    Type.Literal(VERDICTS.keep),
    Type.Literal(VERDICTS.paused),
    Type.Literal(VERDICTS.finished),
    Type.Literal(VERDICTS.ephemeral),
    Type.Literal(VERDICTS.trash),
  ]),
  reason: Type.Optional(Type.String()),
});

function toolResult(text: string): {
  content: [{ type: "text"; text: string }];
  details: Record<string, never>;
} {
  return { content: [{ type: "text" as const, text }], details: {} };
}

async function handleScrubMark(
  params: Static<typeof ScrubMarkParams>,
  ctx: ExtensionContext,
): Promise<{ content: [{ type: "text"; text: string }]; details: Record<string, never> }> {
  if (!isVerdict(params.verdict)) {
    return toolResult(`Invalid verdict. Use one of: keep, paused, finished, ephemeral, trash.`);
  }
  const liveFile = ctx.sessionManager.getSessionFile();
  if (liveFile === undefined) {
    return toolResult("No live session file; verdict not recorded.");
  }
  try {
    SessionManager.open(liveFile).appendCustomEntry(VERDICT_CUSTOM_TYPE, {
      version: 1,
      verdict: params.verdict,
      at: new Date().toISOString(),
      reason: params.reason,
    });
    return toolResult(`Recorded verdict: ${params.verdict}.`);
  } catch (err) {
    return toolResult(`Could not record verdict: ${errorMessage(err)}`);
  }
}

/** Sessions already offered the hint in this process (gate file may not exist yet). */
const hintedSessions = new Set<string>();

/** Returns true when the hint was offered. Never throws outward. */
async function maybeOfferHint(
  ctx: ExtensionContext,
  texts: string[],
): Promise<boolean> {
  try {
    const sessionId = ctx.sessionManager.getSessionId();
    if (hintedSessions.has(sessionId)) return false;
    if (ctx.sessionManager.getSessionName() !== undefined) return false;
    if (hasCustomType(ctx.sessionManager.getEntries(), HINT_CUSTOM_TYPE)) {
      hintedSessions.add(sessionId);
      return false;
    }
    const slug = deriveSlug(texts[0] ?? "");
    if (slug.length === 0) return false;
    ctx.ui.setStatus(STATUS_KEY, `sugerido: /name ${slug}`);
    hintedSessions.add(sessionId);
    const liveFile = ctx.sessionManager.getSessionFile();
    if (liveFile === undefined) return true;
    SessionManager.open(liveFile).appendCustomEntry(HINT_CUSTOM_TYPE, {
      version: 1,
      slug,
      offeredAt: new Date().toISOString(),
    });
    return true;
  } catch {
    // never break the session for a hint
    return false;
  }
}

/** Texts of user messages from an AgentMessage array (unknown shape, narrowed). */
function agentMessageTexts(messages: unknown): string[] {
  if (!Array.isArray(messages)) return [];
  const out: string[] = [];
  for (const m of messages) {
    if (typeof m !== "object" || m === null) continue;
    const msg = m as { role?: unknown; content?: unknown };
    if (msg.role !== "user" || !Array.isArray(msg.content)) continue;
    const text = msg.content
      .filter(isTextPart)
      .map((p) => p.text)
      .join(" ");
    if (text.length > 0) out.push(text);
  }
  return out;
}

async function handleAgentStart(ctx: ExtensionContext): Promise<void> {
  await maybeOfferHint(ctx, userTexts(ctx.sessionManager.getEntries()));
}

async function handleAgentEnd(
  event: { messages: unknown },
  ctx: ExtensionContext,
): Promise<void> {
  await maybeOfferHint(ctx, agentMessageTexts(event.messages));
}

const TRIAGE_VERDICT = {
  KEEP: "keep",
  PAUSED: "paused",
  FINISHED: "finished",
  EPHEMERAL: "ephemeral",
} as const;
type TriageVerdict = (typeof TRIAGE_VERDICT)[keyof typeof TRIAGE_VERDICT];

const TRIAGE_GRADE = {
  MACHINE: "machine",
  WEAK: "weak",
  JUDGED: "judged",
} as const;
type TriageGrade = (typeof TRIAGE_GRADE)[keyof typeof TRIAGE_GRADE];

const HEAD_DIGEST_CHARS = 300;
const TAIL_DIGEST_CHARS = 300;
const MAX_DIGEST_SESSIONS = 20;

interface DigestPack {
  shortId: string;
  messageCount: number;
  ageDays: number;
  created: string;
  modified: string;
  sessionName: string | undefined;
  flowName: string | undefined;
  head: string;
  tail: string;
  headTruncated: boolean;
  tailTruncated: boolean;
}

interface WeakGuess {
  shortId: string;
  grade: typeof TRIAGE_GRADE.WEAK;
  guess: TriageVerdict;
  rationale: string;
}

interface MachineFact {
  shortId: string;
  grade: typeof TRIAGE_GRADE.MACHINE;
  proposal: typeof TRIAGE_VERDICT.KEEP;
  rationale: string;
}

interface ApplyAssignment {
  idPrefix: string;
  verdict: TriageVerdict;
  reason: string;
}

interface ResolvedAssignment {
  assignment: ApplyAssignment;
  targetPath: string;
  shortId: string;
  provenance: TriageGrade;
}

interface RejectedAssignment {
  raw: string;
  cause: string;
}

interface TriageCandidate {
  info: SessionInfo;
  entries: SessionEntry[];
}

function isTriageVerdict(value: string): value is TriageVerdict {
  return (
    value === TRIAGE_VERDICT.KEEP ||
    value === TRIAGE_VERDICT.PAUSED ||
    value === TRIAGE_VERDICT.FINISHED ||
    value === TRIAGE_VERDICT.EPHEMERAL
  );
}

function stripForQuote(text: string): string {
  return text
    .replace(/\[[0-9;]*m/g, "")
    .replace(/[̀-ͯ]/g, "")
    // Zero-width invisibles (ZWSP/ZWNJ/ZWJ/BOM): strip so quoted
    // packs never carry invisible chars into pasted verdict lines.
        .replace(/[\u200B-\u200D\uFEFF]/g, "");
}

function truncateWithEllipsis(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  return { text: `${text.slice(0, max)}…`, truncated: true };
}

function truncateTailFromFront(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  return { text: `…${text.slice(-(max - 1))}`, truncated: true };
}

interface OrderedMessage {
  role: "user" | "assistant";
  text: string;
}

/**
 * User+assistant message texts in chronological (file) order.
 * Empty texts are skipped, mirroring userTexts.
 */
function orderedMessageTexts(entries: SessionEntry[]): OrderedMessage[] {
  const out: OrderedMessage[] = [];
  for (const e of entries) {
    if (e.type !== "message") continue;
    const msg = (e as unknown as { message?: unknown }).message;
    if (typeof msg !== "object" || msg === null) continue;
    const m = msg as { role?: unknown; content?: unknown };
    if ((m.role !== "user" && m.role !== "assistant") || !Array.isArray(m.content)) continue;
    const text = m.content
      .filter(isTextPart)
      .map((part) => part.text)
      .join(" ");
    if (text.length > 0) out.push({ role: m.role as "user" | "assistant", text });
  }
  return out;
}

function buildDigestPack(
  args: {
    shortId: string;
    messageCount: number;
    created: Date;
    modified: Date;
    sessionName?: string;
    flowName?: string;
  },
  ordered: OrderedMessage[],
): DigestPack {
  const headRaw = stripForQuote(ordered.find((m) => m.role === "user")?.text ?? "");
  // Same voices as before (last 3 assistant + last 2 user) but merged in
  // true chronological order instead of assistant-first.
  const lastAssistant = new Set(
    ordered
      .map((m, i) => (m.role === "assistant" ? i : -1))
      .filter((i) => i >= 0)
      .slice(-3),
  );
  const lastUser = new Set(
    ordered
      .map((m, i) => (m.role === "user" ? i : -1))
      .filter((i) => i >= 0)
      .slice(-2),
  );
  const tailRaw = stripForQuote(
    ordered
      .filter((_, i) => lastAssistant.has(i) || lastUser.has(i))
      .map((m) => m.text)
      .join("\n---\n"),
  );
  const head = truncateWithEllipsis(headRaw, HEAD_DIGEST_CHARS);
  const tail = truncateTailFromFront(tailRaw, TAIL_DIGEST_CHARS);
  return {
    shortId: args.shortId,
    messageCount: args.messageCount,
    ageDays: Math.floor((Date.now() - args.created.getTime()) / 86400000),
    created: args.created.toISOString(),
    modified: args.modified.toISOString(),
    sessionName: args.sessionName,
    flowName: args.flowName,
    head: head.text,
    tail: tail.text,
    headTruncated: head.truncated,
    tailTruncated: tail.truncated,
  };
}

function suggestTriageWeak(args: {
  shortId: string;
  messageCount: number;
  ageMs: number;
  maxAgeMs: number;
}): WeakGuess {
  if (args.ageMs >= args.maxAgeMs) {
    return {
      shortId: args.shortId,
      grade: TRIAGE_GRADE.WEAK,
      guess: TRIAGE_VERDICT.FINISHED,
      rationale: `WEAK: old with ${args.messageCount} msgs — words decide; confirm from tail`,
    };
  }
  return {
    shortId: args.shortId,
    grade: TRIAGE_GRADE.WEAK,
    guess: TRIAGE_VERDICT.PAUSED,
    rationale: `WEAK: recent with ${args.messageCount} msgs, no signal — words decide; park only if tail agrees`,
  };
}

/** Exact `/skill:<flow>` token match. No substring/fuzzy matching. */
function matchedEphemeralFlow(text: string, flows: string[]): string | undefined {
  return flows.find((flow) => {
    if (flow.length === 0) return false;
    return new RegExp(`(?:^|\\s)/skill:${escapeRegExp(flow)}(?:\\s|$)`).test(text);
  });
}

// Reason supports backslash escapes (\" and \\) so quoted session text can be
// cited verbatim; symmetric with escapeQuote on the render side.
function unescapeReason(raw: string): string {
  return raw.replace(/\\(.)/g, "$1");
}

const ASSIGN_RE = /(\S+?):(keep|paused|finished|ephemeral|trash):"((?:[^"\\]|\\.)*)"/g;
const LOOSE_ASSIGN_RE = /(\S+?):([^:\s]+):/;

function parseApplyAssignments(args: string): {
  ok: ApplyAssignment[];
  rejected: RejectedAssignment[];
} {
  const cleaned = args
    .split(/\s+/)
    .filter((t) => t !== "--apply" && t !== "--dry-run" && t.length > 0)
    .join(" ");
  const ok: ApplyAssignment[] = [];
  const rejected: RejectedAssignment[] = [];
  const seen = new Set<string>();
  let cursor = 0;
  const leftovers: string[] = [];
  for (const m of cleaned.matchAll(ASSIGN_RE)) {
    const start = m.index ?? 0;
    const gap = cleaned.slice(cursor, start).trim();
    if (gap.length > 0) leftovers.push(gap);
    cursor = start + m[0].length;
    const prefix = m[1] ?? "";
    const verdictRaw = m[2] ?? "";
    const reason = unescapeReason(m[3] ?? "");
    if (prefix.length === 0) {
      rejected.push({ raw: m[0], cause: "empty id prefix" });
      continue;
    }
    if (verdictRaw === VERDICTS.trash) {
      rejected.push({ raw: m[0], cause: "trash is never appliable from triage" });
      continue;
    }
    if (!isTriageVerdict(verdictRaw)) {
      rejected.push({ raw: m[0], cause: `unknown verdict "${verdictRaw}"` });
      continue;
    }
    if (reason.trim().length === 0) {
      rejected.push({
        raw: m[0],
        cause: 'missing judged rationale (id:verdict:"reason" required)',
      });
      continue;
    }
    if (seen.has(prefix)) {
      rejected.push({ raw: m[0], cause: `duplicate prefix "${prefix}"` });
      continue;
    }
    seen.add(prefix);
    ok.push({ idPrefix: prefix, verdict: verdictRaw, reason });
  }
  const tail = cleaned.slice(cursor).trim();
  if (tail.length > 0) leftovers.push(tail);
  for (const raw of leftovers) {
    const bare = /^(\S+?):(keep|paused|finished|ephemeral|trash)$/.exec(raw);
    if (bare !== null) {
      rejected.push({ raw, cause: 'missing judged rationale (id:verdict:"reason" required)' });
      continue;
    }
    const loose = LOOSE_ASSIGN_RE.exec(raw);
    if (loose !== null && !isTriageVerdict(loose[2] ?? "") && (loose[2] ?? "") !== VERDICTS.trash) {
      rejected.push({ raw, cause: `unknown verdict "${loose[2] ?? ""}"` });
    } else {
      rejected.push({ raw, cause: 'malformed pair (expected id:verdict:"reason")' });
    }
  }
  return { ok, rejected };
}

async function appendVerdictToOther(
  sessionPath: string,
  verdict: TriageVerdict,
  reason: string,
  livePath: string | undefined,
): Promise<void> {
  if ((verdict as string) === (VERDICTS.trash as string)) {
    throw new Error("refusing trash verdict from triage");
  }
  // Defense in depth: resolve ran before the human confirm, so re-assert
  // liveness here — never write into a gone file or the live session.
  if (!existsSync(sessionPath)) {
    throw new Error("refusing verdict: session file is gone");
  }
  if (livePath !== undefined && samePath(sessionPath, livePath)) {
    throw new Error("refusing verdict: target is the live session");
  }
  SessionManager.open(sessionPath).appendCustomEntry(VERDICT_CUSTOM_TYPE, {
    version: 1,
    verdict,
    at: new Date().toISOString(),
    reason,
  });
}

function escapeQuote(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function formatDigestPack(
  pack: DigestPack,
  machine: MachineFact | undefined,
  weak: WeakGuess,
): string {
  const lines = [
    "```triage " + pack.shortId,
    `msgs=${pack.messageCount} · age=${pack.ageDays}d · created=${pack.created} · modified=${pack.modified}` +
      (pack.sessionName !== undefined ? ` · named "${escapeQuote(pack.sessionName)}"` : ""),
    `head(≤${HEAD_DIGEST_CHARS}c): "${escapeQuote(pack.head)}"`,
    `tail(≤${TAIL_DIGEST_CHARS}c): "${escapeQuote(pack.tail)}"`,
  ];
  if (machine !== undefined) {
    lines.push(`NAMED → keep (machine) · ${machine.rationale}`);
  } else {
    lines.push(`weak-guess: ${weak.guess} (WEAK — judge from head/tail, never auto-confirm) · ${weak.rationale}`);
  }
  lines.push("```");
  return lines.join("\n");
}

async function gatherTriageCandidates(ctx: ExtensionCommandContext): Promise<{
  candidates: TriageCandidate[];
  emptySkipped: number;
  ephemeralSkipped: number;
}> {
  const policy = readPolicyConfig(ctx.cwd);
  const live: LiveIdentity = {
    path: ctx.sessionManager.getSessionFile(),
    id: ctx.sessionManager.getSessionId(),
  };
  const sessions = await SessionManager.list(ctx.cwd);
  const candidates: TriageCandidate[] = [];
  let emptySkipped = 0;
  let ephemeralSkipped = 0;
  for (const info of sessions) {
    const isLive =
      (live.path !== undefined && samePath(info.path, live.path)) ||
      (live.id !== undefined && info.id === live.id);
    if (isLive) continue;
    const entries = openSessionEntries(info.path);
    if (readLatestVerdict(entries) !== undefined) continue;
    if (info.messageCount === 0) {
      emptySkipped += 1;
      continue;
    }
    const userMessages = userTexts(entries);
    if (matchedEphemeralFlow(userMessages.join("\n"), policy.ephemeralFlows) !== undefined) {
      ephemeralSkipped += 1;
      continue;
    }
    // Texts are extracted lazily per shown pack (orderedMessageTexts);
    // classification here only needs entries + user text for ephemeral.
    candidates.push({ info, entries });
  }
  candidates.sort((a, b) => {
    const aNamed = a.info.name !== undefined && a.info.name.trim().length > 0 ? 0 : 1;
    const bNamed = b.info.name !== undefined && b.info.name.trim().length > 0 ? 0 : 1;
    if (aNamed !== bNamed) return aNamed - bNamed;
    return a.info.modified.getTime() - b.info.modified.getTime();
  });
  return { candidates, emptySkipped, ephemeralSkipped };
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

async function handleScrubTriagePhase1(ctx: ExtensionCommandContext): Promise<void> {
  const { candidates, emptySkipped, ephemeralSkipped } = await gatherTriageCandidates(ctx);
  if (candidates.length === 0) {
    ctx.ui.notify(
      `Nothing to triage. (${emptySkipped} empty skipped, ${ephemeralSkipped} ephemeral already candidates.)`,
      "info",
    );
    return;
  }
  const shown = candidates.slice(0, MAX_DIGEST_SESSIONS);
  const deferred = candidates.length - shown.length;
  const blocks = shown.map((c) => {
    const pack = buildDigestPack(
      {
        shortId: shortId(c.info.id),
        messageCount: c.info.messageCount,
        created: c.info.created,
        modified: c.info.modified,
        sessionName: c.info.name,
        flowName: undefined,
      },
      // Lazy text extraction: only shown packs pay for it.
      orderedMessageTexts(c.entries),
    );
    const named = c.info.name !== undefined && c.info.name.trim().length > 0;
    const machine: MachineFact | undefined = named
      ? {
          shortId: pack.shortId,
          grade: TRIAGE_GRADE.MACHINE,
          proposal: TRIAGE_VERDICT.KEEP,
          rationale: "named session — presumed active",
        }
      : undefined;
    const weak = suggestTriageWeak({
      shortId: pack.shortId,
      messageCount: c.info.messageCount,
      ageMs: Date.now() - c.info.created.getTime(),
      maxAgeMs: MAX_AGE_MS,
    });
    return formatDigestPack(pack, machine, weak);
  });
  const lines = [
    `triage: ${candidates.length} sessions need verdicts (${emptySkipped} empty skipped, ${ephemeralSkipped} ephemeral already candidates).`,
    ...blocks,
  ];
  if (deferred > 0) {
    lines.push(`+${deferred} more deferred — triage these first, then re-run.`);
  }
  lines.push("Packs are quoted-as-data: judge the words, then approve in chat; nothing is written by this command.");
  ctx.ui.notify(lines.join("\n"), "info");
}

async function handleScrubTriagePhase2(
  assignments: ApplyAssignment[],
  parseRejected: RejectedAssignment[],
  ctx: ExtensionCommandContext,
): Promise<void> {
  for (const r of parseRejected) {
    ctx.ui.notify(`Rejected ${r.raw}: ${r.cause}`, "warning");
  }
  const { candidates } = await gatherTriageCandidates(ctx);
  const resolved: ResolvedAssignment[] = [];
  for (const a of assignments) {
    const matches = candidates.filter((c) => c.info.id.startsWith(a.idPrefix));
    if (matches.length === 0) {
      ctx.ui.notify(`Rejected ${a.idPrefix}: unknown session (stale or out of triage set)`, "warning");
      continue;
    }
    if (matches.length > 1) {
      ctx.ui.notify(`Rejected ${a.idPrefix}: ambiguous prefix (${matches.length} sessions)`, "warning");
      continue;
    }
    const target = matches[0] as TriageCandidate;
    const named = target.info.name !== undefined && target.info.name.trim().length > 0;
    resolved.push({
      assignment: a,
      targetPath: target.info.path,
      shortId: shortId(target.info.id),
      provenance: named ? TRIAGE_GRADE.MACHINE : TRIAGE_GRADE.WEAK,
    });
  }
  if (resolved.length === 0) {
    ctx.ui.notify("Cancelled.", "info");
    return;
  }
  const livePath = ctx.sessionManager.getSessionFile();
  let applied = 0;
  let already = 0;
  const declined: string[] = [];
  const conflicted: string[] = [];
  const errored: string[] = [];
  for (const r of resolved) {
    const info = candidates.find((c) => c.info.path === r.targetPath) as TriageCandidate | undefined;
    const ageDays =
      info === undefined
        ? 0
        : Math.floor((Date.now() - info.info.created.getTime()) / 86400000);
    const ok = await ctx.ui.confirm(
      `Triage ${r.shortId} as ${r.assignment.verdict}?`,
      `provenance=${r.provenance} reason="${r.assignment.reason}"` +
        (info === undefined ? "" : ` msgs=${info.info.messageCount} age=${ageDays}d`) +
        ` (pack text not repeated — see phase-1 output)`,
    );
    if (!ok) {
      declined.push(r.shortId);
      continue;
    }
    const current = readLatestVerdict(openSessionEntries(r.targetPath));
    if (current !== undefined && current !== r.assignment.verdict) {
      ctx.ui.notify(`Skipped ${r.shortId}: verdict appeared meanwhile (${current})`, "warning");
      conflicted.push(r.shortId);
      continue;
    }
    if (current !== undefined) {
      ctx.ui.notify(`Already ${r.shortId}: verdict ${current} present and matching - counted.`, "info");
      already += 1;
      continue;
    }
    try {
      await appendVerdictToOther(r.targetPath, r.assignment.verdict, r.assignment.reason, livePath);
      const check = readLatestVerdict(openSessionEntries(r.targetPath));
      if (check === r.assignment.verdict) {
        applied += 1;
      } else {
        ctx.ui.notify(`Skipped ${r.shortId}: post-write re-read mismatch`, "warning");
        errored.push(r.shortId);
      }
    } catch (err) {
      ctx.ui.notify(`Skipped ${r.shortId}: ${errorMessage(err)}`, "warning");
      errored.push(r.shortId);
    }
  }
  const triaged = applied + already;
  const parts = [`Triaged ${triaged} of ${resolved.length} (${applied} applied + ${already} already)`];
  if (declined.length > 0) parts.push(`${declined.length} declined [${declined.join(", ")}]`);
  if (conflicted.length > 0) parts.push(`${conflicted.length} conflict [${conflicted.join(", ")}]`);
  if (errored.length > 0) parts.push(`${errored.length} error [${errored.join(", ")}]`);
  parts.push("Re-run /scrub to see new classifications.");
  ctx.ui.notify(parts.join("; ") + ".", "info");
}

async function handleScrubTriage(args: string, ctx: ExtensionCommandContext): Promise<void> {
  if (!args.includes("--apply")) {
    await handleScrubTriagePhase1(ctx);
    return;
  }
  const parsed = parseApplyAssignments(args);
  if (resolveDryRun(args, ctx)) {
    const lines = ["Dry-run — nothing written."];
    for (const a of parsed.ok) {
      lines.push(`would apply ${a.idPrefix} as ${a.verdict}: "${a.reason}"`);
    }
    for (const r of parsed.rejected) {
      lines.push(`rejected ${r.raw}: ${r.cause}`);
    }
    ctx.ui.notify(lines.join("\n"), "info");
    return;
  }
  await handleScrubTriagePhase2(parsed.ok, parsed.rejected, ctx);
}

// ---------------------------------------------------------------------------
// Factory: commands + tool + agent_start only.
// ---------------------------------------------------------------------------
// Factory: commands + tool + agent_start only.
// Deliberately absent: start/shutdown lifecycle handlers (silent close, T9).
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI): void {
  pi.registerCommand("scrub", {
    description: "Audit this project's sessions (read-only)",
    handler: async (args, ctx) => {
      await handleScrub(args, ctx);
    },
  });
  pi.registerCommand("scrub-apply", {
    description: "Trash actionable sessions (dry-run first, reversible via /scrub-restore)",
    handler: async (args, ctx) => {
      await handleScrubApply(args, ctx);
    },
  });
  pi.registerCommand("scrub-restore", {
    description: "Restore trashed sessions for this project",
    handler: async (args, ctx) => {
      await handleScrubRestore(args, ctx);
    },
  });
  pi.registerCommand("scrub-init", {
    description: "Write the opt-in session-scrub policy block into AGENTS.md",
    handler: async (args, ctx) => {
      await handleScrubInit(args, ctx);
    },
  });
  pi.registerCommand("scrub-triage", {
    description: "Assisted triage of verdict-less sessions (digests, then confirmed writes)",
    handler: async (args, ctx) => {
      await handleScrubTriage(args, ctx);
    },
  });
  pi.registerTool({
    name: "scrub_mark",
    label: "Record session verdict",
    description:
      "Record a session-scrub verdict (keep, paused, finished, ephemeral, trash) for the current session.",
    parameters: ScrubMarkParams,
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      return handleScrubMark(params, ctx);
    },
  });
  pi.on("agent_start", async (_event, ctx) => {
    await handleAgentStart(ctx);
  });
  pi.on("agent_end", async (event, ctx) => {
    await handleAgentEnd(event, ctx);
  });
}
