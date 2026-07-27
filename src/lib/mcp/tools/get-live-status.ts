import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, supabaseForUser, textResult } from "../supabase";

export default defineTool({
  name: "get_live_status",
  title: "Echtzeit-Status der Chatter",
  description:
    "Echtzeit-Daten pro Chatter: offene Chats, ältester unbeantworteter Chat (Verzug in Tagen), Umsatz heute, Mass-DMs, plus Aufschlüsselung pro Model/Account. Nutze das für Fragen zu Verzug, offenen Chats und aktueller Auslastung. Verzug zählt erst ab 3 Tagen.",
  inputSchema: {
    platform: z.string().describe("Plattform, z.B. 'Maloum' oder 'Brezzels'."),
    chatter_name: z.string().nullable().describe("Optionaler Chatter-Filter (Teilstring)."),
    min_delay_days: z.number().nullable().describe("Nur Chatter mit ältestem Chat >= N Tage."),
    sort: z.enum(["delay", "unread", "revenue"]).nullable().describe("Sortierung, Default 'delay'."),
    limit: z.number().nullable().describe("Max. Anzahl Zeilen, Default 40."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ platform, chatter_name, min_delay_days, sort, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    let q = supabaseForUser(ctx)
      .from("chatter_history_live")
      .select("chatter_name,unread_chats,oldest_chat,revenue,mass_dms,stats_details,updated_at")
      .ilike("platform", platform);
    if (chatter_name) q = q.ilike("chatter_name", `%${chatter_name}%`);
    if (typeof min_delay_days === "number") q = q.gte("oldest_chat", min_delay_days);
    const col = sort === "unread" ? "unread_chats" : sort === "revenue" ? "revenue" : "oldest_chat";
    const { data, error } = await q
      .order(col, { ascending: false, nullsFirst: false })
      .limit(Math.min(limit ?? 40, 200));
    if (error) return errorResult(error.message);
    return textResult({ count: data?.length ?? 0, rows: data });
  },
});
