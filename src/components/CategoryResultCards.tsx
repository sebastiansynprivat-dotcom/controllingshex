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

/* ------------------------------------------------------------------ */
/*  WHITELISTED CATEGORIES — the ONLY categories allowed               */
/* ------------------------------------------------------------------ */

const ALLOWED_CATEGORIES = [
  { emoji: "⚠️", name: "ACCOUNT-EINBRUCH" },
  { emoji: "🔄", name: "MODEL-TAUSCH" },
  { emoji: "🔵", name: "ONBOARDING TAG 1" },
  { emoji: "🔵", name: "ONBOARDING TAG 2" },
  { emoji: "🔵", name: "ONBOARDING TAG 3" },
  { emoji: "🔵", name: "ONBOARDING TAG 4" },
  { emoji: "🔵", name: "ONBOARDING TAG 5" },
  { emoji: "🌟", name: "BREAKOUT-STAR" },
  { emoji: "🟢", name: "ACCOUNT UPGRADE (UMSATZ-STREAK)" },
  { emoji: "🚀", name: "KURZ VOR UPGRADE" },
  { emoji: "📉", name: "0€ UMSATZ IN FOLGE" },
  { emoji: "🟠", name: "WARNUNG" },
  { emoji: "📼", name: "VIDEO-COACHING" },
  { emoji: "⚪", name: "WEITER SO / MITTELFELD" },
] as const;

const ALLOWED_NAMES = new Set(ALLOWED_CATEGORIES.map((c) => c.name));
const MITTELFELD = "WEITER SO / MITTELFELD";
const MITTELFELD_EMOJI = "⚪";

/** Map an AI-returned category name to the closest whitelisted name */
function mapToAllowed(rawName: string): { emoji: string; name: string } {
  const upper = rawName.replace(/^[^\w]*/, "").trim().toUpperCase();

  // Direct match
  for (const ac of ALLOWED_CATEGORIES) {
    if (upper === ac.name || upper.includes(ac.name)) return { emoji: ac.emoji, name: ac.name };
  }

  // Fuzzy keyword matching
  if (/EINBRUCH/i.test(rawName)) return { emoji: "⚠️", name: "ACCOUNT-EINBRUCH" };
  if (/MODEL.?TAUSCH/i.test(rawName)) return { emoji: "🔄", name: "MODEL-TAUSCH" };
  if (/BREAKOUT/i.test(rawName)) return { emoji: "🌟", name: "BREAKOUT-STAR" };
  if (/UPGRADE.*STREAK|STREAK.*UPGRADE/i.test(rawName)) return { emoji: "🟢", name: "ACCOUNT UPGRADE (UMSATZ-STREAK)" };
  if (/KURZ.*UPGRADE/i.test(rawName)) return { emoji: "🚀", name: "KURZ VOR UPGRADE" };
  if (/0\s*€.*FOLGE|FOLGE.*0\s*€/i.test(rawName)) return { emoji: "📉", name: "0€ UMSATZ IN FOLGE" };
  if (/WARNUNG/i.test(rawName)) return { emoji: "🟠", name: "WARNUNG" };
  if (/VIDEO.?COACHING/i.test(rawName)) return { emoji: "📼", name: "VIDEO-COACHING" };
  if (/MITTELFELD|WEITER\s*SO/i.test(rawName)) return { emoji: "⚪", name: MITTELFELD };

  // Onboarding with tag number
  const onboardingMatch = rawName.match(/ONBOARDING.*?TAG\s*(\d+)/i);
  if (onboardingMatch) {
    const tag = parseInt(onboardingMatch[1], 10);
    if (tag >= 1 && tag <= 5) return { emoji: "🔵", name: `ONBOARDING TAG ${tag}` };
    return { emoji: MITTELFELD_EMOJI, name: MITTELFELD }; // Tag > 5 → Mittelfeld
  }
  if (/ONBOARDING/i.test(rawName)) return { emoji: "🔵", name: "ONBOARDING TAG 1" };

  // Fallback: everything unknown → Mittelfeld
  return { emoji: MITTELFELD_EMOJI, name: MITTELFELD };
}

/** Sanitize delay: anything > 100 is a parsing error */
function sanitizeDelayValue(raw: number, revenue?: number): number {
  const val = Math.round(raw);
  if (val < 0 || val > 100) return 0;
  if (revenue !== undefined && (val === Math.round(revenue) || val === Math.round(revenue * 100))) return 0;
  return val;
}

const emojiAccent: Record<string, string> = {
  "⚠️": "text-amber-400/80", "🔴": "text-red-400/70", "📉": "text-red-400/60",
  "🔵": "text-blue-400/70", "🌟": "text-yellow-300/70", "🟢": "text-emerald-400/70",
  "🔄": "text-violet-400/70", "❌": "text-rose-400/70", "🟡": "text-yellow-400/70",
  "💰": "text-emerald-300/70", "🚀": "text-sky-400/70", "🟠": "text-orange-400/70",
  "📼": "text-purple-400/70", "⚪": "text-white/50",
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
  const avgRev = history.reduce((s, r) => s + r.revenue_today, 0) / history.length;
  const avgDMs = history.reduce((s, r) => s + r.mass_dms, 0) / history.length;
  const avgDelay = history.reduce((s, r) => s + r.response_delay_days, 0) / history.length;
  // Revenue: 60% weight, target 30€/day
  const revScore = Math.min(60, (avgRev / 30) * 60);
  // MassDMs: 20% weight, target 2/day
  const dmScore = Math.min(20, (avgDMs / 2) * 20);
  // Discipline: 20% weight, 0 delay = full points
  const delayScore = Math.max(0, 20 - (avgDelay / 3) * 20);
  return Math.round(revScore + dmScore + delayScore);
}

function buildClipboardTSV(categories: Category[]): string {
  const allHeaders = new Set<string>();
  categories.forEach((cat) =>
    cat.chatters.forEach((c) => Object.keys(c.kpis || {}).forEach((k) => allHeaders.add(k)))
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
/*  SPARKLINE (SVG) — minimal, no axes                                 */
/* ------------------------------------------------------------------ */

function Sparkline({ data, width = 72, height = 32 }: { data: number[]; width?: number; height?: number }) {
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
    <svg width={width} height={height} className="shrink-0 opacity-50">
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
  const radius = 18;
  const stroke = 1.5;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 70 ? "#D4AF37" : score >= 40 ? "rgba(255,255,255,0.25)" : "rgba(183,110,100,0.6)";

  return (
    <div className="relative shrink-0 w-10 h-10 flex items-center justify-center">
      <svg width={40} height={40} className="absolute inset-0 -rotate-90">
        <circle cx={20} cy={20} r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
        <circle
          cx={20} cy={20} r={radius} fill="none"
          stroke={color} strokeWidth={stroke}
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.8s ease" }}
        />
      </svg>
      <span className="text-[10px] font-medium text-white/40 z-10">{initials}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  TREND ICON                                                         */
/* ------------------------------------------------------------------ */

function TrendIcon({ trend }: { trend: "up" | "down" | "stable" }) {
  if (trend === "up") return <TrendingUp className="h-3 w-3 text-primary/70" style={{ filter: "drop-shadow(0 0 4px rgba(212,175,55,0.4))" }} />;
  if (trend === "down") return <TrendingDown className="h-3 w-3 text-[#B76E64]/70" />;
  return <Minus className="h-2.5 w-2.5 text-white/15" />;
}

/* ------------------------------------------------------------------ */
/*  MAIN COMPONENT                                                     */
/* ------------------------------------------------------------------ */

interface CategoryResultCardsProps {
  data: AnalysisResult | null;
  onChatterSelect: (name: string) => void;
}

export default function CategoryResultCards({ data, onChatterSelect }: CategoryResultCardsProps) {
  const { platform } = usePlatform();
  const [copied, setCopied] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());
  const [allHistory, setAllHistory] = useState<Record<string, HistoryEntry[]>>({});

  // Post-process categories: whitelist mapping, onboarding date lock, dedup
  const categories = useMemo(() => {
    const raw = data?.categories ?? [];
    if (raw.length === 0) return raw;

    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    // Map all AI categories to whitelisted names and merge into a single map
    const catMap = new Map<string, Category>();

    for (const cat of raw) {
      for (const ch of cat.chatters) {
        let mapped = mapToAllowed(cat.categoryName);

        // Onboarding hard-cap: if startDate > 5 days ago → Mittelfeld
        if (mapped.name.startsWith("ONBOARDING")) {
          if (ch.startDate) {
            const start = new Date(ch.startDate.split(".").reverse().join("-"));
            if (!isNaN(start.getTime()) && start < fiveDaysAgo) {
              mapped = { emoji: MITTELFELD_EMOJI, name: MITTELFELD };
            }
          }
        }

        const key = mapped.name;
        if (!catMap.has(key)) {
          catMap.set(key, { emoji: mapped.emoji, categoryName: key, chatters: [] });
        }
        catMap.get(key)!.chatters.push(ch);
      }
    }

    // Sort chatters within each category by revenue (descending)
    const parseRevenue = (ch: Chatter): number => {
      const kpis = ch.kpis || {};
      const key = Object.keys(kpis).find((k) => /umsatz|revenue/i.test(k));
      if (!key) return 0;
      const val = kpis[key].replace(/[^\d,.\-]/g, "").replace(",", ".");
      return parseFloat(val) || 0;
    };

    for (const [, cat] of catMap) {
      cat.chatters.sort((a, b) => parseRevenue(b) - parseRevenue(a));
    }

    // Return only categories with chatters, ordered by ALLOWED_CATEGORIES order
    const ordered: Category[] = [];
    for (const ac of ALLOWED_CATEGORIES) {
      const entry = catMap.get(ac.name);
      if (entry && entry.chatters.length > 0) ordered.push(entry);
    }
    return ordered;
  }, [data]);

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
          const rawDelay = Number(r.response_delay_days) || 0;
          const rev = Number(r.revenue_today) || 0;
          const safeDelay = sanitizeDelayValue(rawDelay, rev);
          grouped[n].push({
            analysis_date: r.analysis_date,
            revenue_today: rev,
            mass_dms: Number(r.mass_dms) || 0,
            open_chats: Number(r.open_chats) || 0,
            response_delay_days: safeDelay,
          });
        }
        setAllHistory(grouped);
      });
  }, [categories, platform]);

  const chatterStats = useMemo(() => {
    const stats: Record<string, ChatterStats> = {};
    for (const [name, hist] of Object.entries(allHistory)) {
      const withDelay = hist.filter((r) => r.response_delay_days > 0);
      stats[name] = {
        avgChats: hist.length ? hist.reduce((s, r) => s + r.open_chats, 0) / hist.length : 0,
        avgDelay: withDelay.length ? withDelay.reduce((s, r) => s + r.response_delay_days, 0) / withDelay.length : 0,
        history: hist,
        trend: calcTrend(hist),
        score: calcScore(hist),
      };
    }
    return stats;
  }, [allHistory]);

  // Single-select: click toggles one filter, clicking active deselects all
  const toggleFilter = (name: string) => {
    setActiveFilters((prev) => {
      if (prev.has(name)) return new Set();
      return new Set([name]);
    });
  };

  const visibleCategories = activeFilters.size === 0
    ? categories
    : categories.filter((c) => activeFilters.has(c.categoryName));

  const copyToClipboard = async () => {
    const text = categories.length > 0
      ? buildClipboardTSV(categories)
      : JSON.stringify(data ?? { categories: [] });
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
        <div className="bg-white/[0.02] border border-white/[0.05] rounded-2xl p-8 backdrop-blur-2xl min-h-40 flex items-center justify-center">
          <p className="text-sm text-white/35 font-light">Keine strukturierte Analyse verfügbar.</p>
        </div>
      </div>
    );
  }

  const totalChatters = categories.reduce((a, c) => a + c.chatters.length, 0);

  return (
    <div className="space-y-10 animate-fade-in">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-extralight text-foreground tracking-tight">Analyse-Ergebnis</h2>
          <p className="text-[11px] text-white/25 mt-1.5 font-light tracking-wider">
            {totalChatters} Einträge · {categories.length} Kategorien
          </p>
        </div>
        <CopyButton copied={copied} onClick={copyToClipboard} />
      </div>

      {/* Filter Pills — only show categories with chatters, single-select */}
      <div className="flex flex-wrap gap-2 items-center">
        <Filter className="h-3 w-3 text-white/15 mr-1" />
        {categories
          .filter((cat) => cat.chatters.length > 0)
          .map((cat) => {
            const isActive = activeFilters.has(cat.categoryName);
            return (
              <button
                key={cat.categoryName}
                onClick={() => toggleFilter(cat.categoryName)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[11px] font-light transition-all duration-500 border tracking-wide ${
                  isActive
                    ? "bg-primary/10 border-primary/30 text-primary shadow-[0_0_12px_-3px_hsl(var(--primary)/0.25)]"
                    : "bg-white/[0.02] border-white/[0.05] text-white/30 hover:text-white/55 hover:border-white/[0.08]"
                }`}
              >
                <span className="text-xs">{cat.emoji}</span>
                <span>{cat.categoryName}</span>
                <span className={`ml-0.5 ${isActive ? "text-primary/50" : "text-white/15"}`}>{cat.chatters.length}</span>
              </button>
            );
          })}
      </div>

      {/* Category Cards */}
      <div className="grid gap-10">
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

const INITIAL_VISIBLE = 10;

function CategoryCard({ category, onChatterClick, chatterStats }: { category: Category; onChatterClick: (name: string) => void; chatterStats: Record<string, ChatterStats> }) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  const visible = category.chatters.slice(0, visibleCount);
  const hasMore = visibleCount < category.chatters.length;

  return (
    <div className="rounded-2xl bg-white/[0.02] border border-white/[0.05] backdrop-blur-2xl overflow-hidden">
      <div className="px-8 py-6 border-b border-white/[0.04] flex items-center gap-3">
        <span className="text-lg">{category.emoji}</span>
        <h3 className="text-lg font-medium tracking-wide gold-text">{category.categoryName}</h3>
        <span className="ml-auto text-[10px] text-white/20 font-light tracking-wider">
          {category.chatters.length} {category.chatters.length === 1 ? "Eintrag" : "Einträge"}
        </span>
      </div>
      <div className="divide-y divide-white/[0.03]">
        {visible.map((chatter, i) => (
          <ChatterItem key={i} chatter={chatter} onChatterClick={onChatterClick} stats={chatterStats[toTitleCase(chatter.name)]} />
        ))}
      </div>
      {hasMore && (
        <button
          onClick={() => setVisibleCount((v) => v + 20)}
          className="w-full py-4 text-[11px] text-primary/50 hover:text-primary/80 font-light tracking-wider uppercase transition-colors duration-500 border-t border-white/[0.03]"
        >
          Weitere {Math.min(20, category.chatters.length - visibleCount)} von {category.chatters.length - visibleCount} anzeigen
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  CHATTER ITEM — Clean grid layout                                   */
/* ------------------------------------------------------------------ */

function ChatterItem({ chatter, onChatterClick, stats }: { chatter: Chatter; onChatterClick: (name: string) => void; stats?: ChatterStats }) {
  const kpiEntries = Object.entries(chatter.kpis || {});
  const [nameCopied, setNameCopied] = useState(false);
  const formattedName = toTitleCase(chatter.name || "—");
  const initials = formattedName.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const sparkData = stats?.history.slice(-14).map((r) => r.revenue_today) ?? [];

  // Find the primary revenue value
  const revenueEntry = kpiEntries.find(([, v]) => isMoneyValue(v));
  // Ghost-chat stats from history
  const ghostChats = stats && stats.avgChats > 0
    ? `Ø ${Math.round(stats.avgChats)} Chats / ${stats.avgDelay.toFixed(1)} Tage`
    : null;

  const copyName = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(formattedName);
    setNameCopied(true);
    toast.success(`Copied: ${formattedName}`);
    setTimeout(() => setNameCopied(false), 1500);
  };

  return (
    <div
      className="px-8 py-6 hover:bg-white/[0.015] transition-colors duration-500 cursor-pointer group"
      onClick={() => onChatterClick(formattedName)}
    >
      {/* Row 1: Main info in a clean grid */}
      <div className="flex items-center gap-5">
        {/* Score Ring */}
        <ScoreRing score={stats?.score ?? 0} initials={initials} />

        {/* Name block */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <button onClick={copyName} className="group/name flex items-center gap-1.5 text-left">
              <span className="text-sm font-medium text-foreground/90 tracking-wide group-hover/name:underline underline-offset-4 decoration-primary/30 transition-all duration-300">
                {formattedName}
              </span>
              {nameCopied ? (
                <Check className="h-3 w-3 text-emerald-400/70 shrink-0" />
              ) : (
                <Copy className="h-3 w-3 text-white/10 group-hover/name:text-white/30 transition-colors duration-300 shrink-0" />
              )}
            </button>
          </div>
          <p className="text-[11px] text-white/20 mt-0.5 font-light">
            {chatter.account || "Kein Account zugewiesen"}
            {chatter.startDate && ` · ${chatter.startDate}`}
          </p>
        </div>

        {/* Sparkline — tiny, no axes */}
        {sparkData.length >= 2 && (
          <Sparkline data={sparkData} width={64} height={28} />
        )}

        {/* Revenue + Trend */}
        {revenueEntry && (
          <div className="shrink-0 flex items-center gap-2 min-w-[100px] justify-end">
            <span className="text-base font-light gold-text tracking-tight">{revenueEntry[1]}</span>
            {stats && <TrendIcon trend={stats.trend} />}
          </div>
        )}

        {/* Ghost-Chat stat */}
        {ghostChats && (
          <div className="shrink-0 hidden md:block">
            <span className="text-[11px] text-white/25 font-light tracking-wide">{ghostChats}</span>
          </div>
        )}
      </div>

      {/* Row 2: KPIs (excluding revenue already shown) + Recommendation */}
      <div className="ml-[60px] mt-4 flex flex-col lg:flex-row lg:items-start gap-4">
        {/* Other KPIs */}
        <div className="flex flex-wrap gap-x-6 gap-y-2 flex-1">
          {kpiEntries
            .filter(([, v]) => !isMoneyValue(v))
            .map(([label, value]) => (
              <div key={label} className="flex items-baseline gap-1.5">
                <span className="text-[10px] uppercase tracking-[0.15em] text-white/20 font-light">{label}</span>
                <span className="text-xs font-light text-foreground/60">{value}</span>
              </div>
            ))}
        </div>

        {/* Recommendation */}
        {chatter.recommendation && (
          <div className="lg:max-w-xs shrink-0 border-l border-primary/15 pl-4">
            <p className="text-xs leading-relaxed text-white/35 font-light italic">{chatter.recommendation}</p>
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
