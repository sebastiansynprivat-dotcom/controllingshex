import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, supabaseForUser, textResult } from "../supabase";
import { loadActiveChatterNames, normalizeName } from "./active-roster";

export default defineTool({
  name: "get_account_history",
  title: "Account-Chronologie",
  description:
    "Chronologie eines Accounts/Models: welche aktuellen Chatter saßen wann darauf, mit Umsatz pro Tag, Durchschnitt und bestem Tag. Für 'lief der Account früher besser' sowie Besetzungs- und Tausch-Fragen. Nur Chatter aus dem letzten Report.",
  inputSchema: {
    platform: z.string().describe("Plattform, z.B. 'Maloum'."),
    account: z.string().describe("Account-/Model-Name (Teilstring reicht)."),
    days: z.number().nullable().describe("Zeitfenster in Tagen, Default 90."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ platform, account, days }, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    const win = Math.min(days ?? 90, 365);
    const from = new Date();
    from.setDate(from.getDate() - win);
    const supabase = supabaseForUser(ctx);
    const activeNames = await loadActiveChatterNames(supabase, platform);
    const { data, error } = await supabase
      .from("chatter_history")
      .select("analysis_date,chatter_name,account,revenue_today,open_chats,response_delay_days")
      .eq("platform", platform)
      .ilike("account", `%${account}%`)
      .gte("analysis_date", from.toISOString().slice(0, 10))
      .order("analysis_date", { ascending: false })
      .limit(1500);
    if (error) return errorResult(error.message);

    const rows = activeNames
      ? (data ?? []).filter((r) => activeNames.has((r.chatter_name ?? "").trim().toLowerCase().replace(/\s+/g, "_")))
      : (data ?? []);

    const per = new Map<string, { days: number; total: number; best: number; first: string; last: string }>();
    for (const r of rows) {
      const rev = Number(r.revenue_today) || 0;
      const e = per.get(r.chatter_name) ?? { days: 0, total: 0, best: 0, first: r.analysis_date, last: r.analysis_date };
      e.days += 1;
      e.total += rev;
      e.best = Math.max(e.best, rev);
      if (r.analysis_date < e.first) e.first = r.analysis_date;
      if (r.analysis_date > e.last) e.last = r.analysis_date;
      per.set(r.chatter_name, e);
    }
    const chatters = [...per.entries()]
      .map(([chatter, e]) => ({
        chatter,
        days: e.days,
        total: Math.round(e.total),
        avg_per_day: Math.round((e.total / e.days) * 10) / 10,
        best_day: Math.round(e.best),
        from: e.first,
        to: e.last,
      }))
      .sort((a, b) => b.avg_per_day - a.avg_per_day);

    return textResult({ chatters, rows: rows.slice(0, 300) });
  },
});
