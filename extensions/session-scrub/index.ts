// pi-session-scrub — v2 minimal stub.
//
// Rules: zero tokens by default (no before_agent_start injection),
// opt-in commands only, deterministic audit via SessionManager.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export default function (pi: ExtensionAPI) {
  // Silent by design: no notify storm on startup.
  // If you want a dirty-delta hint, add a status widget here later.
  pi.on("session_start", async (_event, _ctx) => {});

  // Suggest a deterministic /name from the first user message.
  // The model is NOT in the loop; the user confirms with /name.
  pi.on("agent_start", async (_event, ctx) => {
    try {
      const entries = ctx.sessionManager.getEntries() as any[];
      const firstUser = entries.find(
        (e) => e.type === "message" && e.message?.role === "user",
      );
      const text: string =
        firstUser?.message?.content
          ?.filter((p: any) => p.type === "text")
          ?.map((p: any) => p.text)
          ?.join(" ")
          ?.slice(0, 80) ?? "";
      if (!text) return;
      const slug = slugify(text);
      if (!slug) return;
      ctx.ui.setStatus("scrub-name", `sugerido: /name ${slug}`);
    } catch {
      // never break the session for a hint
    }
  });

  pi.registerCommand("scrub", {
    description: "Audit this project's sessions (read-only)",
    handler: async (_args, ctx) => {
      const sessions = await SessionManager.list(ctx.cwd);
      const named = sessions.filter((s: any) => s.name).length;
      ctx.ui.notify(
        `scrub: ${sessions.length} sesiones, ${named} nombradas. /resume para gestionar.`,
        "info",
      );
    },
  });

  pi.registerCommand("scrub-apply", {
    description: "Trash closed trashables (dry-run first, reversible)",
    handler: async (_args, ctx) => {
      const sessions = await SessionManager.list(ctx.cwd);
      // v0: conservative — only unnamed, never the live session.
      const live = ctx.sessionManager.getSessionFile();
      const candidates = sessions.filter(
        (s: any) => !s.name && (s as any).file !== live,
      );
      if (candidates.length === 0) {
        ctx.ui.notify("scrub-apply: nada para borrar.", "info");
        return;
      }
      const ok = await ctx.ui.confirm(
        `Borrar ${candidates.length} sesiones sin nombre?`,
        "Se usa trash (reversible). La sesión actual nunca se toca.",
      );
      if (!ok) return;
      ctx.ui.notify(
        "scrub-apply: dry-run OK en v0 — borrado real llega en el próximo paso.",
        "info",
      );
    },
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    // Keep-vs-trash verdict without spending model tokens.
    // v0: silent — uncomment to ask explicitly on close.
    // await ctx.ui.confirm("Guardar esta sesión?", "keep = la conservás");
    void ctx;
  });
}
