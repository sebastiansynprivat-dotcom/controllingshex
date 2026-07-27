import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, supabaseForUser, textResult } from "../supabase";
import { loadActiveChatterNames, normalizeName } from "./active-roster";

export default defineTool({
  name: "get_top_chatters",
  title: "Chatter-Ranking",
  description:
    "Aggregiertes Ranking aller Chatter einer Plattform über ein Zeitfenster: Gesamtumsatz, Ø pro Tag, bester Tag, aktueller Account und Kategorie. Guter Einstiegspunkt für 'wer performt', 'wer ist im Rückgang'. Beschränkt auf Chatter, die im letzten Report vorkommen.",
  inputSchema: {
    platform: z.string().describe("Plattform, z.B. 'Maloum'."),
    days: z.number().nullable().describe("Zeitfenster in Tagen, Default 14."),
    limit: z.number().nullable().describe("Max. Anzahl Chatter, Default 50."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ platform, days, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    const win = Math.min(days ?? 14, 180);
    const from = new Date();
    from.setDate(from.getDate() - win);

    const supabase = supabaseForUser(ctx);
    const activeNames = await loadActiveChatterNames(supabase, platform);
    const rows: any[] = [];
    for (let offset = 0; offset < 20000; offset += 1000) {
      const { data, error } = await supabase
        .from("chatter_history")
        .select("chatter_name,analysis_date,revenue_today,mass_dms,open_chats,response_delay_days,category,account")
        .eq("platform", platform)
        .gte("analysis_date", from.toISOString().slice(0, 10))
        .order("analysis_date", { ascending: false })
        .range(offset, offset + 999);
      if (error) return errorResult(error.message);
      const page = activeNames
        ? (data ?? []).filter((r) => activeNames.has(normalizeName(r.chatter_name ?? "")))
        : (data ?? []);
      rows.push(...page);
      if (!data || data.length < 1000) break;
    }

    const per = new Map<string, { days: number; total: number; best: number; latest: any }>();
    for (const r of rows) {
      const rev = Number(r.revenue_today) || 0;
      const e = per.get(r.chatter_name) ?? { days: 0, total: 0, best: 0, latest: r };
      e.days += 1;
      e.total += rev;
      e.best = Math.max(e.best, rev);
      if (r.analysis_date > e.latest.analysis_date) e.latest = r;
      per.set(r.chatter_name, e);
    }

    const ranked = [...per.entries()]
      .map(([chatter, e]) => ({
        chatter,
        account: e.latest.account,
        category: e.latest.category,
        days: e.days,
        total_revenue: Math.round(e.total),
        avg_per_day: Math.round((e.total / e.days) * 10) / 10,
        best_day: Math.round(e.best),
        last_open_chats: e.latest.open_chats,
        last_delay_days: e.latest.response_delay_days,
      }))
      .sort((a, b) => b.total_revenue - a.total_revenue)
      .slice(0, Math.min(limit ?? 50, 300));

    return textResult({ platform, window_days: win, count: ranked.length, chatters: ranked });
  },
});
