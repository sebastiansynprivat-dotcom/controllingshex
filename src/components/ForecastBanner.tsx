import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertOctagon, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { loadBenchmarks, findCluster } from "@/lib/peer-benchmarks";
import { computeRiskScores, type ForecastInput, type HistoryPoint } from "@/lib/risk-forecast";

interface AnalysisChatter { name: string; startDate?: string; account?: string }
interface AnalysisCategory { chatters: AnalysisChatter[] }
interface AnalysisResult { categories: AnalysisCategory[] }

function isAnalysisResult(v: unknown): v is AnalysisResult {
  return !!v && typeof v === "object" && Array.isArray((v as AnalysisResult).categories);
}

function daysBetween(start: string | undefined, today: Date): number | null {
  if (!start) return null;
  const d = new Date(start);
  if (isNaN(d.getTime())) return null;
  return Math.floor((today.getTime() - d.getTime()) / 86_400_000);
}

interface Props {
  platform: string;
}

export function ForecastBanner({ platform }: Props) {
  const navigate = useNavigate();
  const [count, setCount] = useState(0);
  const [euroAtRisk, setEuroAtRisk] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const { data: reportRows } = await supabase
        .from("analysis_reports")
        .select("result_json")
        .eq("platform", platform)
        .not("result_json", "is", null)
        .order("analysis_date", { ascending: false })
        .limit(1);

      const result = reportRows?.[0]?.result_json;
      if (!isAnalysisResult(result)) { if (!cancelled) setLoaded(true); return; }

      const today = new Date();
      const activeChatters = result.categories.flatMap(cat =>
        cat.chatters.map(ch => ({
          name: ch.name,
          account: ch.account?.trim() || null,
          daysSinceStart: daysBetween(ch.startDate, today),
        })),
      );

      const since = new Date();
      since.setDate(since.getDate() - 14);
      const sinceStr = since.toISOString().split("T")[0];

      const { data: histRows } = await supabase
        .from("chatter_history")
        .select("chatter_name, account, analysis_date, revenue_today, response_delay_days, mass_dms, open_chats")
        .eq("platform", platform)
        .gte("analysis_date", sinceStr)
        .order("analysis_date", { ascending: true });

      const bm = await loadBenchmarks(platform, 30);

      const byChatter = new Map<string, Map<string, HistoryPoint>>();
      for (const r of histRows || []) {
        const k = r.chatter_name;
        if (!byChatter.has(k)) byChatter.set(k, new Map());
        const dayMap = byChatter.get(k)!;
        const existing = dayMap.get(r.analysis_date);
        const rev = Number(r.revenue_today) || 0;
        if (existing) {
          existing.revenue = Math.max(existing.revenue, rev);
          existing.responseDelay = Math.max(existing.responseDelay, Number(r.response_delay_days) || 0);
          existing.massDms = Math.max(existing.massDms, Number(r.mass_dms) || 0);
          existing.openChats = Math.max(existing.openChats, Number(r.open_chats) || 0);
        } else {
          dayMap.set(r.analysis_date, {
            date: r.analysis_date,
            revenue: rev,
            responseDelay: Number(r.response_delay_days) || 0,
            massDms: Number(r.mass_dms) || 0,
            openChats: Number(r.open_chats) || 0,
          });
        }
      }

      const inputs: ForecastInput[] = [];
      for (const ch of activeChatters) {
        const dayMap = byChatter.get(ch.name);
        if (!dayMap || dayMap.size < 3) continue;
        const sortedDays = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-7);
        const followers = ch.account ? bm.accountBaselines.get(ch.account.toLowerCase().trim())?.followers ?? 0 : 0;
        const cluster = findCluster(bm, followers);
        inputs.push({
          chatter: ch.name,
          account: ch.account,
          followers,
          history: sortedDays,
          daysSinceStart: ch.daysSinceStart,
          peerMedian: cluster?.median ?? bm.globalMedian ?? null,
          peerP25: cluster?.p25 ?? bm.globalP25 ?? null,
        });
      }

      const scores = computeRiskScores(inputs).filter(s => s.score >= 60);
      if (cancelled) return;
      setCount(scores.length);
      setEuroAtRisk(scores.reduce((s, r) => s + r.euroAtRisk, 0));
      setLoaded(true);
    };
    run().catch((e) => { console.error("ForecastBanner", e); setLoaded(true); });
    return () => { cancelled = true; };
  }, [platform]);

  if (!loaded || count === 0) return null;

  return (
    <button
      onClick={() => navigate("/forecast")}
      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-orange-500/25 bg-orange-500/5 text-left transition-all hover:bg-orange-500/10 hover:border-orange-500/40 group"
    >
      <AlertOctagon className="h-4 w-4 text-orange-400/90 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-orange-100/90 text-sm font-light">
          {count} Chatter mit hohem Crash-Risiko in den nächsten 3 Tagen
        </p>
        {euroAtRisk > 0 && (
          <p className="text-orange-300/60 text-xs font-light mt-0.5">
            ~{euroAtRisk}€ Geld-Risiko · jetzt eingreifen
          </p>
        )}
      </div>
      <ChevronRight className="h-4 w-4 text-orange-400/60 group-hover:text-orange-400 group-hover:translate-x-0.5 transition-all" />
    </button>
  );
}
