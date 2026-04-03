import { Copy, Check, Filter, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { usePlatform } from "@/contexts/PlatformContext";
import { supabase } from "@/integrations/supabase/client";

/* ------------------------------------------------------------------ */
/*  TYPES                                                              */
/* ------------------------------------------------------------------ */

interface Chatter {
  name: string;
  startDate?: string;
  account?: string;
  kpis: Record<string, string>;
  recommendation?: string;
}

interface Category {
  emoji: string;
  categoryName: string;
  chatters: Chatter[];
}

interface AnalysisResult {
  categories: Category[];
}

interface HistoryEntry {
  analysis_date: string;
  revenue_today: number;
  mass_dms: number;
  open_chats: number;
  response_delay_days: number;
}

interface ChatterStats {
  avgChats: number;
  avgDelay: number;
  history: HistoryEntry[];
  trend: "up" | "down" | "stable";
  score: number;
}

/* ------------------------------------------------------------------ */
/*  HELPERS                                                            */
/* ------------------------------------------------------------------ */

const emojiAccent: Record<string, string> = {
  "⚠️": "text-amber-400/80", "🔴": "text-red-400/70", "📉": "text-red-400/60",
  "🔵": "text-blue-400/70", "🌟": "text-yellow-300/70", "🟢": "text-emerald-400/70",
  "🔄": "text-violet-400/70", "❌": "text-rose-400/70", "🟡": "text-yellow-400/70",
  "💰": "text-emerald-300/70", "🚀": "text-sky-400/70",
};

function isMoneyValue(value: string): boolean {
  return /\d+[\.,]?\d*\s*€|€\s*\d+/i.test(value);
}

function toTitleCase(name: string): string {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function calcTrend(history: HistoryEntry[]): "up" | "down" | "stable" {
  if (history.length < 4) return "stable";
  const sorted = [...history].sort((a, b) => a.analysis_date.localeCompare(b.analysis_date));
  const last7 = sorted.slice(-7);
  if (last7.length < 4) return "stable";
  const recentLen = Math.min(3, last7.length);
  const recent = last7.slice(-recentLen);
  const older = last7.slice(0, last7.length - recentLen);
  if (older.length === 0) return "stable";
  const avgRecent = recent.reduce((s, r) => s + r.revenue_today, 0) / recent.length;
  const avgOlder = older.reduce((s, r) => s + r.revenue_today, 0) / older.length;
  const pctChange = avgOlder > 0 ? (avgRecent - avgOlder) / avgOlder : 0;
  if (pctChange > 0.05) return "up";
  if (pctChange < -0.05) return "down";
  return "stable";
}

function calcScore(history: HistoryEntry[]): number {
  if (history.length === 0) return 0;
  const last = history[history.length - 1];
  const avgRev = history.reduce((s, r) => s + r.revenue_today, 0) / history.length;
  const avgDMs = history.reduce((s, r) => s + r.mass_dms, 0) / history.length;
  const avgDelay = history.reduce((s, r) => s + r.response_delay_days, 0) / history.length;
  // Revenue score (0-40): normalized against 500€ as "excellent"
  const revScore = Math.min(40, (avgRev / 500) * 40);
  // MassDMs score (0-30): higher is better, 20+ is excellent
  const dmScore = Math.min(30, (avgDMs / 20) * 30);
  // Delay penalty (0-30): 0 delay = 30 points, 7+ days = 0
  const delayScore = Math.max(0, 30 - (avgDelay / 7) * 30);
  return Math.round(revScore + dmScore + delayScore);
}

function buildClipboardTSV(categories: Category[]): string {
  const allHeaders = new Set<string>();
  categories.forEach((cat) =>
    cat.chatters.forEach((c) => Object.keys(c.kpis).forEach((k) => allHeaders.add(k)))
  );
  const kpiCols = Array.from(allHeaders);
  const header = ["Kategorie", "Chatter", "Startdatum", "Account", ...kpiCols, "Empfehlung"].join("\t");
  const rows = categories.flatMap((cat) =>
    cat.chatters.map((c) =>
      [`${cat.emoji} ${cat.categoryName}`, c.name, c.startDate || "", c.account || "", ...kpiCols.map((k) => c.kpis[k] || ""), c.recommendation || ""].join("\t")
    )
  );
  return [header, ...rows].join("\n");
}

/* ------------------------------------------------------------------ */
/*  SPARKLINE (SVG)                                                    */
/* ------------------------------------------------------------------ */

function Sparkline({ data, width = 80, height = 28 }: { data: number[]; width?: number; height?: number }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  });
  return (
    <svg width={width} height={height} className="shrink-0 opacity-60">
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke="#D4AF37"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  SCORE RING                                                         */
/* ------------------------------------------------------------------ */

function ScoreRing({ score, initials }: { score: number; initials: string }) {
  const radius = 20;
  const stroke = 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 70 ? "#D4AF37" : score >= 40 ? "rgba(255,255,255,0.25)" : "rgba(183,110,100,0.6)";

  return (
    <div className="relative shrink-0 w-11 h-11 flex items-center justify-center">
      <svg width={44} height={44} className="absolute inset-0 -rotate-90">
        <circle cx={22} cy={22} r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
        <circle
          cx={22} cy={22} r={radius} fill="none"
          stroke={color} strokeWidth={stroke}
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.8s ease" }}
        />
      </svg>
      <span className="text-[11px] font-medium text-white/50 z-10">{initials}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  TREND ICON                                                         */
/* ------------------------------------------------------------------ */

function TrendIcon({ trend }: { trend: "up" | "down" | "stable" }) {
  if (trend === "up") return <TrendingUp className="h-3.5 w-3.5 text-primary/70" style={{ filter: "drop-shadow(0 0 4px rgba(212,175,55,0.4))" }} />;
  if (trend === "down") return <TrendingDown className="h-3.5 w-3.5 text-[#B76E64]/70" />;
  return <Minus className="h-3 w-3 text-white/20" />;
}

/* ------------------------------------------------------------------ */
/*  MAIN COMPONENT                                                     */
/* ------------------------------------------------------------------ */

interface CategoryResultCardsProps {
  data: AnalysisResult | null;
  raw?: string;
  onChatterSelect: (name: string) => void;
}

export default function CategoryResultCards({ data, raw, onChatterSelect }: CategoryResultCardsProps) {
  const { platform } = usePlatform();
  const [copied, setCopied] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());
  const [allHistory, setAllHistory] = useState<Record<string, HistoryEntry[]>>({});

  const categories = data?.categories ?? [];

  // Fetch full history for all chatters in one query
  useEffect(() => {
    if (categories.length === 0) return;
    const allNames = categories.flatMap((c) => c.chatters.map((ch) => toTitleCase(ch.name)));
    const uniqueNames = [...new Set(allNames)];
    if (uniqueNames.length === 0) return;

    supabase
      .from("chatter_history")
      .select("chatter_name, analysis_date, revenue_today, mass_dms, open_chats, response_delay_days")
      .eq("platform", platform)
      .in("chatter_name", uniqueNames)
      .order("analysis_date", { ascending: true })
      .then(({ data: rows }) => {
        if (!rows) return;
        const grouped: Record<string, HistoryEntry[]> = {};
        for (const r of rows as any[]) {
          const n = r.chatter_name;
          if (!grouped[n]) grouped[n] = [];
          grouped[n].push({
            analysis_date: r.analysis_date,
            revenue_today: Number(r.revenue_today) || 0,
            mass_dms: Number(r.mass_dms) || 0,
            open_chats: Number(r.open_chats) || 0,
            response_delay_days: Number(r.response_delay_days) || 0,
          });
        }
        setAllHistory(grouped);
      });
  }, [categories, platform]);

  // Compute stats per chatter
  const chatterStats = useMemo(() => {
    const stats: Record<string, ChatterStats> = {};
    for (const [name, hist] of Object.entries(allHistory)) {
      stats[name] = {
        avgChats: hist.length ? hist.reduce((s, r) => s + r.open_chats, 0) / hist.length : 0,
        avgDelay: hist.length ? hist.reduce((s, r) => s + r.response_delay_days, 0) / hist.length : 0,
        history: hist,
        trend: calcTrend(hist),
        score: calcScore(hist),
      };
    }
    return stats;
  }, [allHistory]);

  const toggleFilter = (name: string) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const visibleCategories = activeFilters.size === 0
    ? categories
    : categories.filter((c) => activeFilters.has(c.categoryName));

  const copyToClipboard = async () => {
    const text = categories.length > 0 ? buildClipboardTSV(categories) : raw || "";
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("Tabelle kopiert!");
    setTimeout(() => setCopied(false), 2000);
  };

  if (!data || categories.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-light text-foreground/80 tracking-wide">Ergebnis</h2>
          <CopyButton copied={copied} onClick={copyToClipboard} />
        </div>
        <div className="bg-white/[0.02] border border-white/[0.05] rounded-2xl p-8 backdrop-blur-2xl overflow-x-auto">
          <pre className="whitespace-pre-wrap text-sm text-white/50 font-light">{raw || "Keine Daten."}</pre>
        </div>
      </div>
    );
  }

  const totalChatters = categories.reduce((a, c) => a + c.chatters.length, 0);

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-extralight text-foreground tracking-tight">Analyse-Ergebnis</h2>
          <p className="text-[11px] text-white/25 mt-1 font-light tracking-wider">
            {totalChatters} Einträge · {categories.length} Kategorien
          </p>
        </div>
        <CopyButton copied={copied} onClick={copyToClipboard} />
      </div>

      {/* Filter Pills */}
      <div className="flex flex-wrap gap-2 items-center">
        <Filter className="h-3 w-3 text-white/15 mr-1" />
        {categories.map((cat) => {
          const isActive = activeFilters.has(cat.categoryName);
          return (
            <button
              key={cat.categoryName}
              onClick={() => toggleFilter(cat.categoryName)}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-light transition-all duration-500 border tracking-wide ${
                isActive
                  ? "bg-primary/8 border-primary/15 text-primary/90"
                  : "bg-white/[0.02] border-white/[0.05] text-white/30 hover:text-white/55 hover:border-white/[0.08]"
              }`}
            >
              <span className="text-xs">{cat.emoji}</span>
              <span>{cat.categoryName}</span>
              <span className="text-white/15 ml-0.5">{cat.chatters.length}</span>
            </button>
          );
        })}
        {activeFilters.size > 0 && (
          <button onClick={() => setActiveFilters(new Set())} className="text-[10px] text-white/25 hover:text-white/50 ml-2 transition-colors duration-500 tracking-wider uppercase">Reset</button>
        )}
      </div>

      {/* Category Cards */}
      <div className="grid gap-8">
        <AnimatePresence mode="popLayout">
          {visibleCategories.map((cat, idx) => (
            <motion.div
              key={cat.categoryName} layout
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ duration: 0.45, delay: idx * 0.04, ease: [0.16, 1, 0.3, 1] }}
            >
              <CategoryCard category={cat} onChatterClick={onChatterSelect} chatterStats={chatterStats} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  CATEGORY CARD                                                      */
/* ------------------------------------------------------------------ */

function CategoryCard({ category, onChatterClick, chatterStats }: { category: Category; onChatterClick: (name: string) => void; chatterStats: Record<string, ChatterStats> }) {
  return (
    <div className="rounded-2xl bg-white/[0.02] border border-white/[0.05] backdrop-blur-2xl overflow-hidden">
      <div className="px-10 py-7 border-b border-white/[0.04] flex items-center gap-4">
        <span className="text-2xl">{category.emoji}</span>
        <h3 className="text-2xl font-semibold tracking-wide gold-text">{category.categoryName}</h3>
        <span className="ml-auto text-xs text-white/25 font-light tracking-wider">
          {category.chatters.length} {category.chatters.length === 1 ? "Eintrag" : "Einträge"}
        </span>
      </div>
      <div className="divide-y divide-white/[0.03]">
        {category.chatters.map((chatter, i) => (
          <ChatterItem key={i} chatter={chatter} onChatterClick={onChatterClick} stats={chatterStats[toTitleCase(chatter.name)]} />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  CHATTER ITEM                                                       */
/* ------------------------------------------------------------------ */

function ChatterItem({ chatter, onChatterClick, stats }: { chatter: Chatter; onChatterClick: (name: string) => void; stats?: ChatterStats }) {
  const kpiEntries = Object.entries(chatter.kpis);
  const [nameCopied, setNameCopied] = useState(false);
  const formattedName = toTitleCase(chatter.name || "—");
  const initials = formattedName.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const sparkData = stats?.history.slice(-14).map((r) => r.revenue_today) ?? [];

  const copyName = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(formattedName);
    setNameCopied(true);
    toast.success(`Copied: ${formattedName}`);
    setTimeout(() => setNameCopied(false), 1500);
  };

  return (
    <div
      className="px-10 py-8 hover:bg-white/[0.015] transition-colors duration-500 cursor-pointer"
      onClick={() => onChatterClick(formattedName)}
    >
      <div className="flex flex-col lg:flex-row lg:items-start gap-6 lg:gap-8">
        {/* Left: Score Ring + Name */}
        <div className="shrink-0 lg:w-64 flex gap-4 items-start">
          <ScoreRing score={stats?.score ?? 0} initials={initials} />
          <div className="min-w-0">
            <button onClick={copyName} className="group flex items-center gap-2 text-left">
              <span className="text-xl font-semibold text-foreground/95 tracking-wide group-hover:underline underline-offset-4 decoration-primary/30 transition-all duration-300">
                {formattedName}
              </span>
              {nameCopied ? (
                <Check className="h-3.5 w-3.5 text-emerald-400/70 shrink-0" />
              ) : (
                <Copy className="h-3.5 w-3.5 text-white/15 group-hover:text-white/40 transition-colors duration-300 shrink-0" />
              )}
            </button>
            {chatter.startDate && (
              <p className="text-sm text-white/25 mt-1 font-light tracking-wide">{chatter.startDate}</p>
            )}
            {chatter.account && (
              <span className="inline-block mt-2 text-xs font-light px-3 py-1 rounded-full bg-white/[0.03] text-white/45 border border-white/[0.06] tracking-wider">
                {chatter.account}
              </span>
            )}
            {stats && (stats.avgChats > 0 || stats.avgDelay > 0) && (
              <div className="flex gap-4 mt-2">
                <span className="text-xs text-white/30 font-light">Ø Chats: {stats.avgChats.toFixed(1)}</span>
                <span className="text-xs text-white/30 font-light">Ø Verzug: {stats.avgDelay.toFixed(1)}d</span>
              </div>
            )}
          </div>
        </div>

        {/* Sparkline */}
        {sparkData.length >= 2 && (
          <div className="shrink-0 flex items-center pt-1">
            <Sparkline data={sparkData} />
          </div>
        )}

        {/* KPIs with trend */}
        {kpiEntries.length > 0 && (
          <div className="flex flex-wrap gap-x-8 gap-y-4 flex-1 min-w-0">
            {kpiEntries.map(([label, value], idx) => (
              <div key={label} className="flex flex-col">
                <span className="text-[10px] uppercase tracking-[0.2em] text-white/25 font-light">{label}</span>
                {isMoneyValue(value) ? (
                  <span className="flex items-center gap-2 mt-1">
                    <span className="text-2xl font-extralight tracking-tight gold-text">{value}</span>
                    {idx === 0 && stats && <TrendIcon trend={stats.trend} />}
                  </span>
                ) : (
                  <span className="text-base font-light text-foreground/75 mt-1">{value}</span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Recommendation */}
        {chatter.recommendation && (
          <div className="lg:max-w-sm shrink-0 border-l-2 border-primary/20 pl-5">
            <p className="text-base leading-relaxed text-white/40 font-light italic">{chatter.recommendation}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  COPY BUTTON                                                        */
/* ------------------------------------------------------------------ */

function CopyButton({ copied, onClick }: { copied: boolean; onClick: () => void }) {
  return (
    <Button
      onClick={onClick} variant="outline" size="sm"
      className="bg-white/[0.02] border-white/[0.06] text-white/40 hover:text-white/70 hover:border-white/[0.1] hover:bg-white/[0.03] transition-all duration-500 text-[11px] font-light tracking-wider h-8"
    >
      {copied ? <Check className="h-3 w-3 mr-1.5 text-emerald-400/60" /> : <Copy className="h-3 w-3 mr-1.5" />}
      {copied ? "Kopiert" : "Kopieren"}
    </Button>
  );
}
