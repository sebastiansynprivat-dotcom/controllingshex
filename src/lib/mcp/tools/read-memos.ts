import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, supabaseForUser, textResult } from "../supabase";

export default defineTool({
  name: "read_memos",
  title: "Memos lesen",
  description:
    "Liest gespeicherte Memos und Vereinbarungen zu Chattern (inkl. Fristen / Follow-up-Datum). Nutze das vor Empfehlungen zu einem Chatter, um bereits angestoßene Maßnahmen nicht zu wiederholen.",
  inputSchema: {
    platform: z.string().describe("Plattform, z.B. 'Maloum'."),
    chatter_name: z.string().nullable().describe("Optionaler Chatter-Filter (Teilstring)."),
    status: z.enum(["open", "resolved", "all"]).nullable().describe("Default 'open'."),
    due_only: z.boolean().nullable().describe("Nur heute fällige oder überfällige Memos."),
    limit: z.number().nullable().describe("Max. Anzahl, Default 30."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ platform, chatter_name, status, due_only, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    let q = supabaseForUser(ctx)
      .from("chatter_memos")
      .select("id,chatter_name,text,topic,follow_up_at,status,created_at,resolved_at")
      .eq("platform", platform);
    if (chatter_name) q = q.ilike("chatter_name", `%${chatter_name}%`);
    const effectiveStatus = status ?? "open";
    if (effectiveStatus !== "all") q = q.eq("status", effectiveStatus);
    if (due_only) q = q.lte("follow_up_at", new Date().toISOString());
    const { data, error } = await q
      .order("created_at", { ascending: false })
      .limit(Math.min(limit ?? 30, 100));
    if (error) return errorResult(error.message);
    return textResult({ count: data?.length ?? 0, memos: data });
  },
});
