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
  return {
    kind: CLASS_KIND.kept,
    reason: verdict === VERDICTS.keep ? "has-verdict-keep" : "has-content-no-verdict",
  };
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
