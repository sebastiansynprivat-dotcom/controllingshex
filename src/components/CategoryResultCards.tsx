import { Copy, Check, Filter, TrendingUp, TrendingDown, Minus, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { usePlatform } from "@/contexts/PlatformContext";
import { supabase } from "@/integrations/supabase/client";
import { ResponsiveContainer, AreaChart, Area, XAxis, Tooltip } from "recharts";

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
  { emoji: "🟢", name: "ACCOUNT UPGRADE (TRAFFIC TEST)" },
  { emoji: "📉", name: "0€ UMSATZ TAG 1" },
  { emoji: "📉", name: "0€ UMSATZ TAG 2" },
  { emoji: "📉", name: "0€ UMSATZ TAG 3" },
  { emoji: "📉", name: "0€ UMSATZ TAG 4" },
  { emoji: "📉", name: "0€ UMSATZ TAG 5" },
  { emoji: "📉", name: "0€ UMSATZ TAG 6" },
  { emoji: "📉", name: "0€ UMSATZ TAG 7+" },
  { emoji: "🟠", name: "WARNUNG" },
  { emoji: "📼", name: "VIDEO-COACHING" },
  { emoji: "🟡", name: "COACHING / ENGERE KONTROLLE" },
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
  if (/TRAFFIC.?TEST/i.test(rawName)) return { emoji: "🟢", name: "ACCOUNT UPGRADE (TRAFFIC TEST)" };
  if (/COACHING.*KONTROLLE|ENGERE/i.test(rawName)) return { emoji: "🟡", name: "COACHING / ENGERE KONTROLLE" };
  if (/VIDEO.?COACHING/i.test(rawName)) return { emoji: "📼", name: "VIDEO-COACHING" };
  if (/WARNUNG/i.test(rawName)) return { emoji: "🟠", name: "WARNUNG" };
  if (/MITTELFELD|WEITER\s*SO/i.test(rawName)) return { emoji: "⚪", name: MITTELFELD };

  // 0€ Umsatz with day number
  const zeroMatch = rawName.match(/0\s*€.*?TAG\s*(\d+\+?)/i);
  if (zeroMatch) {
    const tag = zeroMatch[1];
    if (tag.includes("+") || parseInt(tag) >= 7) return { emoji: "📉", name: "0€ UMSATZ TAG 7+" };
    const num = parseInt(tag);
    if (num >= 1 && num <= 6) return { emoji: "📉", name: `0€ UMSATZ TAG ${num}` };
  }
  if (/0\s*€.*FOLGE|FOLGE.*0\s*€|KÜNDIGUNG/i.test(rawName)) return { emoji: "📉", name: "0€ UMSATZ TAG 7+" };

  // Onboarding with tag number
  const onboardingMatch = rawName.match(/ONBOARDING.*?TAG\s*(\d+)/i);
  if (onboardingMatch) {
    const tag = parseInt(onboardingMatch[1], 10);
    if (tag >= 1 && tag <= 5) return { emoji: "🔵", name: `ONBOARDING TAG ${tag}` };
    return { emoji: MITTELFELD_EMOJI, name: MITTELFELD };
  }
  if (/ONBOARDING/i.test(rawName)) return { emoji: "🔵", name: "ONBOARDING TAG 1" };

  // Fallback
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

function Sparkline({ data, width = 72, height = 32, showFill = false }: { data: number[]; width?: number; height?: number; showFill?: boolean }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  });
  const fillPoints = `0,${height} ${points.join(" ")} ${width},${height}`;
  const id = `sparkFill-${width}-${height}`;
  return (
    <svg width={width} height={height} className="shrink-0">
      {showFill && (
        <>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#D4AF37" stopOpacity={0.15} />
              <stop offset="100%" stopColor="#D4AF37" stopOpacity={0} />
            </linearGradient>
          </defs>
          <polygon points={fillPoints} fill={`url(#${id})`} />
        </>
      )}
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
  const [videoCoachings, setVideoCoachings] = useState<Record<string, string>>({});
  const [dailyChecks, setDailyChecks] = useState<Set<string>>(new Set());

  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

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

    // Return ALL categories in order, even if empty (static filter list)
    const ordered: Category[] = [];
    for (const ac of ALLOWED_CATEGORIES) {
      const entry = catMap.get(ac.name);
      ordered.push(entry || { emoji: ac.emoji, categoryName: ac.name, chatters: [] });
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

    // Load latest video coaching per chatter
    supabase
      .from("video_coachings")
      .select("chatter_name, sent_at")
      .eq("platform", platform)
      .order("sent_at", { ascending: false })
      .then(({ data: rows }) => {
        if (!rows) return;
        const latest: Record<string, string> = {};
        for (const r of rows as any[]) {
          if (!latest[r.chatter_name]) latest[r.chatter_name] = r.sent_at;
        }
        setVideoCoachings(latest);
      });

    // Load daily checks for today
    supabase
      .from("daily_chatter_checks")
      .select("chatter_name")
      .eq("platform", platform)
      .eq("check_date", new Date().toISOString().slice(0, 10))
      .then(({ data: rows }) => {
        if (!rows) return;
        setDailyChecks(new Set((rows as any[]).map((r) => r.chatter_name)));
      });
  }, [categories, platform]);

  const toggleDailyCheck = useCallback(async (chatterName: string) => {
    const isChecked = dailyChecks.has(chatterName);
    if (isChecked) {
      setDailyChecks((prev) => { const next = new Set(prev); next.delete(chatterName); return next; });
      await supabase
        .from("daily_chatter_checks")
        .delete()
        .eq("chatter_name", chatterName)
        .eq("platform", platform)
        .eq("check_date", todayStr);
    } else {
      setDailyChecks((prev) => new Set(prev).add(chatterName));
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase
        .from("daily_chatter_checks")
        .insert({ chatter_name: chatterName, platform, check_date: todayStr, user_id: user.id });
    }
  }, [dailyChecks, platform, todayStr]);

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
  const checkedCount = dailyChecks.size;
  const checkProgress = totalChatters > 0 ? Math.round((checkedCount / totalChatters) * 100) : 0;

  return (
    <div className="space-y-10 animate-fade-in w-full max-w-full overflow-hidden">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-extralight text-foreground tracking-tight">Analyse-Ergebnis</h2>
          <p className="text-[11px] text-white/25 mt-1.5 font-light tracking-wider">
            {totalChatters} Einträge · {categories.length} Kategorien
            {checkedCount > 0 && (
              <span className="ml-2 text-emerald-400/60">
                · ✓ {checkedCount}/{totalChatters} erledigt ({checkProgress}%)
              </span>
            )}
          </p>
        </div>
        <CopyButton copied={copied} onClick={copyToClipboard} />
      </div>

      {/* Mobile Filter Dropdown */}
      <div className="flex sm:hidden w-full">
        <Select
          value={activeFilters.size === 1 ? [...activeFilters][0] : "all"}
          onValueChange={(val) => {
            if (val === "all") setActiveFilters(new Set());
            else setActiveFilters(new Set([val]));
          }}
        >
          <SelectTrigger className="w-full bg-white/[0.02] border-white/[0.06] text-white/60 text-xs h-9">
            <div className="flex items-center gap-2">
              <Filter className="h-3 w-3 text-white/25" />
              <SelectValue placeholder="Alle Kategorien" />
            </div>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle anzeigen ({totalChatters})</SelectItem>
            {categories.map((cat) => (
              <SelectItem key={cat.categoryName} value={cat.categoryName}>
                {cat.emoji} {cat.categoryName} ({cat.chatters.length})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Desktop Filter Pills — Grouped */}
      <div className="hidden sm:block pb-2">
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.015] backdrop-blur-xl p-5 space-y-0.5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Filter className="h-3.5 w-3.5 text-white/20" />
              <span className="text-[11px] text-white/40 font-medium tracking-wider uppercase">Kategorien</span>
            </div>
            {activeFilters.size > 0 && (
              <button
                onClick={() => setActiveFilters(new Set())}
                className="text-[10px] text-primary/70 hover:text-primary transition-colors font-medium tracking-wide flex items-center gap-1"
              >
                ✕ Zurücksetzen
              </button>
            )}
          </div>
          {(() => {
            const filterGroups: { label: string; dotClass: string; borderAccent: string; activeBg: string; activeBorder: string; activeText: string; hoverBorder: string; regex: RegExp }[] = [
              { label: "Kritisch", dotClass: "bg-red-400", borderAccent: "border-l-red-500/40", activeBg: "bg-red-500/10", activeBorder: "border-red-400/40", activeText: "text-red-300", hoverBorder: "hover:border-red-500/20", regex: /WARNUNG|0€ UMSATZ/ },
              { label: "Achtung", dotClass: "bg-amber-400", borderAccent: "border-l-amber-500/40", activeBg: "bg-amber-500/10", activeBorder: "border-amber-400/40", activeText: "text-amber-300", hoverBorder: "hover:border-amber-500/20", regex: /EINBRUCH|KONTROLLE/ },
              { label: "Info", dotClass: "bg-blue-400", borderAccent: "border-l-blue-500/40", activeBg: "bg-blue-500/10", activeBorder: "border-blue-400/40", activeText: "text-blue-300", hoverBorder: "hover:border-blue-500/20", regex: /ONBOARDING|MODEL-TAUSCH|VIDEO/ },
              { label: "Positiv", dotClass: "bg-emerald-400", borderAccent: "border-l-emerald-500/40", activeBg: "bg-emerald-500/10", activeBorder: "border-emerald-400/40", activeText: "text-emerald-300", hoverBorder: "hover:border-emerald-500/20", regex: /BREAKOUT|UPGRADE|WEITER SO|KURZ VOR/ },
            ];

            return filterGroups.map((group, gi) => {
              const groupCats = categories.filter((c) => group.regex.test(c.categoryName));
              if (groupCats.length === 0) return null;
              const groupTotal = groupCats.reduce((s, c) => s + c.chatters.length, 0);

              return (
                <div key={group.label} className={`py-3 ${gi > 0 ? "border-t border-white/[0.04]" : ""}`}>
                  <div className={`flex items-start gap-4 pl-1 border-l-2 ${group.borderAccent}`}>
                    <div className="flex items-center gap-2 pt-0.5 min-w-[80px] shrink-0">
                      <span className={`w-2 h-2 rounded-full ${group.dotClass} shadow-sm`} />
                      <span className="text-[11px] text-white/50 font-semibold tracking-wide">{group.label}</span>
                      <span className="text-[10px] text-white/20 font-medium">{groupTotal}</span>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {groupCats.map((cat) => {
                        const isActive = activeFilters.has(cat.categoryName);
                        const isEmpty = cat.chatters.length === 0;
                        return (
                          <button
                            key={cat.categoryName}
                            onClick={() => toggleFilter(cat.categoryName)}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-normal transition-all duration-200 border whitespace-nowrap ${
                              isActive
                                ? `${group.activeBg} ${group.activeBorder} ${group.activeText} shadow-[0_0_10px_-4px] shadow-current`
                                : isEmpty
                                  ? "bg-transparent border-white/[0.03] text-white/15 cursor-default"
                                  : `bg-white/[0.03] border-white/[0.06] text-white/50 hover:text-white/70 ${group.hoverBorder} hover:bg-white/[0.05]`
                            }`}
                          >
                            <span className="text-xs leading-none">{cat.emoji}</span>
                            <span>{cat.categoryName}</span>
                            <span className={`text-[10px] tabular-nums font-medium ${isActive ? "opacity-60" : isEmpty ? "text-white/10" : "text-white/25"}`}>{cat.chatters.length}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            });
          })()}
        </div>
      </div>

      {/* Category Cards */}
      <div className="grid gap-10 w-full max-w-full overflow-hidden">
        <AnimatePresence mode="popLayout">
          {visibleCategories.map((cat, idx) => (
            <motion.div
              key={cat.categoryName} layout
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ duration: 0.45, delay: idx * 0.04, ease: [0.16, 1, 0.3, 1] }}
            >
              <CategoryCard category={cat} onChatterClick={onChatterSelect} chatterStats={chatterStats} videoCoachings={videoCoachings} dailyChecks={dailyChecks} onToggleCheck={toggleDailyCheck} />
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

function CategoryCard({ category, onChatterClick, chatterStats, videoCoachings, dailyChecks, onToggleCheck }: { category: Category; onChatterClick: (name: string) => void; chatterStats: Record<string, ChatterStats>; videoCoachings: Record<string, string>; dailyChecks: Set<string>; onToggleCheck: (name: string) => void }) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  const visible = category.chatters.slice(0, visibleCount);
  const hasMore = visibleCount < category.chatters.length;

  return (
    <div data-category-name={category.categoryName} className="w-full max-w-full rounded-2xl bg-white/[0.02] border border-white/[0.05] backdrop-blur-2xl overflow-hidden">
      <div className="px-4 sm:px-8 py-4 sm:py-6 border-b border-white/[0.04] flex flex-wrap items-start gap-x-3 gap-y-2 min-w-0">
        <span className="text-base sm:text-lg">{category.emoji}</span>
        <h3 className="min-w-0 flex-1 text-sm leading-tight sm:text-lg font-medium tracking-wide gold-text break-words">
          {category.categoryName}
        </h3>
        <span className="w-full pl-7 sm:pl-0 sm:w-auto sm:ml-auto text-[10px] text-white/20 font-light tracking-wider">
          {category.chatters.length} {category.chatters.length === 1 ? "Eintrag" : "Einträge"}
        </span>
      </div>
      <div className="divide-y divide-white/[0.03]">
        {visible.length === 0 ? (
          <div className="px-8 py-6 text-center">
            <p className="text-[11px] text-white/20 font-light tracking-wider">Keine Chatter in dieser Kategorie</p>
          </div>
        ) : visible.map((chatter, i) => (
          <ChatterItem key={i} chatter={chatter} onChatterClick={onChatterClick} stats={chatterStats[toTitleCase(chatter.name)]} videoCoachingSentAt={videoCoachings[toTitleCase(chatter.name)]} isChecked={dailyChecks.has(toTitleCase(chatter.name))} onToggleCheck={() => onToggleCheck(toTitleCase(chatter.name))} />
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

function ChatterItem({ chatter, onChatterClick, stats, videoCoachingSentAt, isChecked, onToggleCheck }: { chatter: Chatter; onChatterClick: (name: string) => void; stats?: ChatterStats; videoCoachingSentAt?: string; isChecked?: boolean; onToggleCheck?: () => void }) {
  const kpiEntries = Object.entries(chatter.kpis || {});
  const [nameCopied, setNameCopied] = useState(false);
  const sparkContainerRef = useRef<HTMLDivElement>(null);
  const [sparkWidth, setSparkWidth] = useState(200);
  const formattedName = toTitleCase(chatter.name || "—");
  const initials = formattedName.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const sparkData = stats?.history.slice(-14) ?? [];
  const sparkRevenues = sparkData.map((r) => r.revenue_today);
  useEffect(() => {
    if (!sparkContainerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) setSparkWidth(Math.floor(e.contentRect.width) - 24);
    });
    obs.observe(sparkContainerRef.current);
    return () => obs.disconnect();
  }, []);

  const revenueEntry = kpiEntries.find(([, v]) => isMoneyValue(v));
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

  const handleCheck = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleCheck?.();
  };

  return (
      <div
        data-chatter-name={formattedName}
        className={`w-full max-w-full overflow-hidden px-4 sm:px-8 py-4 sm:py-6 hover:bg-white/[0.015] transition-all duration-500 cursor-pointer group ${isChecked ? "opacity-40" : ""}`}
      onClick={() => onChatterClick(formattedName)}
    >
      {/* Row 1: Main info */}
      <div className="flex items-start gap-3 sm:gap-5 w-full min-w-0">
        {/* Daily Check */}
        <button
          onClick={handleCheck}
          className={`mt-0.5 shrink-0 w-5 h-5 rounded-full border transition-all duration-300 flex items-center justify-center ${
            isChecked
              ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400"
              : "border-white/10 hover:border-white/25 text-transparent hover:text-white/15"
          }`}
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
        </button>
        {/* Score Ring */}
        <ScoreRing score={stats?.score ?? 0} initials={initials} />

        {/* Name block */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2 min-w-0">
            <button onClick={copyName} className="group/name min-w-0 flex items-center gap-1.5 text-left">
              <span className="text-sm font-medium text-foreground/90 tracking-wide group-hover/name:underline underline-offset-4 decoration-primary/30 transition-all duration-300 truncate">
                {formattedName}
              </span>
              {nameCopied ? (
                <Check className="h-3 w-3 text-emerald-400/70 shrink-0" />
              ) : (
                <Copy className="h-3 w-3 text-white/10 group-hover/name:text-white/30 transition-colors duration-300 shrink-0" />
              )}
            </button>
          </div>
          <p className="text-[11px] text-white/20 mt-0.5 font-light break-words">
            {chatter.account || "Kein Account zugewiesen"}
            {chatter.startDate && ` · ${chatter.startDate}`}
          </p>
          {videoCoachingSentAt && (() => {
            const days = Math.floor((Date.now() - new Date(videoCoachingSentAt).getTime()) / 86400000);
            return (
              <span className="inline-flex items-center gap-1 mt-1 text-[10px] text-purple-400/70 font-light tracking-wide">
                📼 vor {days === 0 ? "heute" : `${days} Tag${days !== 1 ? "en" : ""}`}
              </span>
            );
          })()}

          {revenueEntry && (
            <div className="mt-2 flex items-center gap-1.5 sm:hidden min-w-0">
              <span className="text-sm font-light gold-text tracking-tight break-words">{revenueEntry[1]}</span>
              {stats && <TrendIcon trend={stats.trend} />}
            </div>
          )}
        </div>

        {/* Sparkline — compact, hidden on mobile (shown full-width below) */}
        {sparkRevenues.length >= 2 && (
          <div className="hidden lg:block">
            <Sparkline data={sparkRevenues} width={64} height={28} />
          </div>
        )}

        {/* Revenue + Trend */}
        {revenueEntry && (
          <div className="hidden sm:flex shrink-0 items-center gap-1.5 sm:gap-2 min-w-[80px] sm:min-w-[100px] justify-end">
            <span className="text-sm sm:text-base font-light gold-text tracking-tight">{revenueEntry[1]}</span>
            {stats && <TrendIcon trend={stats.trend} />}
          </div>
        )}

        {/* Ghost-Chat stat — hidden on mobile */}
        {ghostChats && (
          <div className="shrink-0 hidden lg:block">
            <span className="text-[11px] text-white/25 font-light tracking-wide">{ghostChats}</span>
          </div>
        )}
      </div>

      {/* Row 2: KPIs + Recommendation */}
      <div className="ml-[52px] sm:ml-[60px] mt-3 sm:mt-4 flex flex-col lg:flex-row lg:items-start gap-3 sm:gap-4 min-w-0">
        {/* Other KPIs */}
        <div className="flex flex-wrap gap-x-4 sm:gap-x-6 gap-y-1.5 sm:gap-y-2 flex-1 min-w-0">
          {kpiEntries
            .filter(([, v]) => !isMoneyValue(v))
            .map(([label, value]) => (
              <div key={label} className="flex flex-wrap items-baseline gap-1.5 max-w-full">
                <span className="text-[10px] uppercase tracking-[0.15em] text-white/20 font-light break-words">{label}</span>
                <span className="text-xs font-light text-foreground/60 break-words">{value}</span>
              </div>
            ))}
        </div>

        {/* Recommendation */}
        {chatter.recommendation && (
          <div className="lg:max-w-xs shrink-0 min-w-0 border-l border-primary/15 pl-3 sm:pl-4">
            <p className="text-xs leading-relaxed text-white/35 font-light italic break-words">{chatter.recommendation}</p>
          </div>
        )}
      </div>

      {/* Row 3: Full-width revenue sparkline */}
      {sparkData.length >= 2 && (
        <div className="ml-[52px] sm:ml-[60px] mt-3" ref={sparkContainerRef}>
          <div className="rounded-lg bg-white/[0.015] border border-white/[0.04] px-3 py-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] uppercase tracking-[0.15em] text-white/15 font-light">Umsatz (14 Tage)</span>
              {stats && (
                <div className="flex items-center gap-1">
                  <TrendIcon trend={stats.trend} />
                  <span className={`text-[10px] font-light ${stats.trend === "up" ? "text-primary/60" : stats.trend === "down" ? "text-[#B76E64]/60" : "text-white/20"}`}>
                    {stats.trend === "up" ? "Aufwärts" : stats.trend === "down" ? "Abwärts" : "Stabil"}
                  </span>
                </div>
              )}
            </div>
            <Sparkline data={sparkData} width={sparkWidth > 50 ? sparkWidth : 200} height={36} showFill />
          </div>
        </div>
      )}
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
