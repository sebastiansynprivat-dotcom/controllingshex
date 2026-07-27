import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, supabaseForUser, textResult } from "../supabase";
import { loadActiveChatterNames } from "./active-roster";

export default defineTool({
  name: "get_chatter_history",
  title: "Chatter-Verlauf",
  description:
    "Tages-Zeitreihe eines aktuellen Chatters: Umsatz, Mass-DMs, offene Chats, Verzug, Account und Kategorie pro Tag. Für Trend- und Verlaufsfragen zu einer konkreten Person. Nur Chatter aus dem letzten Report.",
  inputSchema: {
    platform: z.string().describe("Plattform, z.B. 'Maloum'."),
    chatter_name: z.string().describe("Name des Chatters (Teilstring reicht)."),
    days: z.number().nullable().describe("Zeitfenster in Tagen, Default 30."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ platform, chatter_name, days }, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    const win = Math.min(days ?? 30, 365);
    const from = new Date();
    from.setDate(from.getDate() - win);
    const supabase = supabaseForUser(ctx);
    const activeNames = await loadActiveChatterNames(supabase, platform);
    const { data, error } = await supabase
      .from("chatter_history")
      .select("chatter_name,analysis_date,account,revenue_today,mass_dms,open_chats,response_delay_days,category")
      .eq("platform", platform)
      .ilike("chatter_name", `%${chatter_name}%`)
      .gte("analysis_date", from.toISOString().slice(0, 10))
      .order("analysis_date", { ascending: false })
      .limit(800);
    if (error) return errorResult(error.message);
    const rows = activeNames
      ? (data ?? []).filter((r) => activeNames.has((r.chatter_name ?? "").trim().toLowerCase().replace(/\s+/g, "_")))
      : (data ?? []);
    return textResult({ count: rows.length, rows });
  },
});
