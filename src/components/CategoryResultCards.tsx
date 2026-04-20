import { Check, Filter, Tag, TrendingUp, TrendingDown, Minus, CheckCircle2, Copy, ChevronDown, ChevronUp, Users } from "lucide-react";
import { cn } from "@/lib/utils";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { usePlatform } from "@/contexts/PlatformContext";
import { supabase } from "@/integrations/supabase/client";
import { ResponsiveContainer, AreaChart, Area, XAxis, Tooltip as RechartsTooltip } from "recharts";
import { loadModelPerformances, formatFollowers, type ModelPerformance, type ModelInfo } from "@/lib/model-performance";
import { mapToActionCategory } from "@/lib/action-categories";
import { ACCOUNT_TIERS, tierForFollowers, type AccountTierId } from "@/lib/account-tiers";

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

interface ChatterLabel {
  id: string;
  label_name: string;
  color: string;
}

interface LabelAssignment {
  chatter_name: string;
  label_id: string;
}

/* ------------------------------------------------------------------ */
/*  HELPERS                                                            */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  WHITELISTED CATEGORIES — the ONLY categories allowed               */
/* ------------------------------------------------------------------ */

const ALLOWED_CATEGORIES = [
  { emoji: "🔵", name: "ONBOARDING TAG 1" },
  { emoji: "🔵", name: "ONBOARDING TAG 2" },
  { emoji: "🔵", name: "ONBOARDING TAG 3" },
  { emoji: "🔵", name: "ONBOARDING TAG 4" },
  { emoji: "🔵", name: "ONBOARDING TAG 5" },
  { emoji: "🆘", name: "SOFORT EINGREIFEN" },
  { emoji: "💬", name: "COACHING NÖTIG" },
  { emoji: "🚀", name: "PUSHEN" },
  { emoji: "🎉", name: "BELOHNEN" },
  { emoji: "📊", name: "RE-ASSIGNEN" },
  { emoji: "👀", name: "BEOBACHTEN" },
] as const;

const ALLOWED_NAMES = new Set(ALLOWED_CATEGORIES.map((c) => c.name));
const MITTELFELD = "BEOBACHTEN";
const MITTELFELD_EMOJI = "👀";

/** Map any AI-returned category name to one of the 6 Action-Categories */
function mapToAllowed(rawName: string): { emoji: string; name: string } {
  return mapToActionCategory(rawName);
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
  "📼": "text-purple-400/70", "⚪": "text-white/50", "⭐": "text-amber-300/70",
  "👀": "text-zinc-400/70", "📊": "text-cyan-400/70", "🔼": "text-emerald-400/70",
};

function isMoneyValue(value: string): boolean {
  return /\d+[\.,]?\d*\s*€|€\s*\d+/i.test(value);
}

function toTitleCase(name: string): string {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizeChatterName(name: string): string {
  return name.toLowerCase().replace(/[_ ]+/g, "_").trim();
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
/*  REVENUE HOVER POPUP                                                */
/* ------------------------------------------------------------------ */

function formatEur(v: number) {
  return v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function RevenueHoverPopup({ history, children }: { history: HistoryEntry[]; children: React.ReactNode }) {
  if (!history.length) return <>{children}</>;

  const sorted = [...history].sort((a, b) => b.analysis_date.localeCompare(a.analysis_date));
  const today = sorted[0]?.revenue_today ?? 0;
  const yesterday = sorted[1]?.revenue_today ?? null;
  const last7 = sorted.slice(0, 7);
  const last14 = sorted.slice(0, 14);
  const last30 = sorted.slice(0, 30);
  const sum7 = last7.reduce((s, r) => s + r.revenue_today, 0);
  const sum14 = last14.reduce((s, r) => s + r.revenue_today, 0);
  const sum30 = last30.reduce((s, r) => s + r.revenue_today, 0);
  const sumAll = sorted.reduce((s, r) => s + r.revenue_today, 0);

  const diffYesterday = yesterday !== null && yesterday > 0
    ? Math.round(((today - yesterday) / yesterday) * 100)
    : null;

  const rows: { label: string; value: number; border?: boolean }[] = [
    { label: "Heute", value: today },
    ...(yesterday !== null ? [{ label: "Gestern", value: yesterday }] : []),
    { label: "7 Tage", value: sum7, border: true },
    ...(last14.length > 7 ? [{ label: "14 Tage", value: sum14 }] : []),
    ...(last30.length > 14 ? [{ label: "30 Tage", value: sum30 }] : []),
    { label: "All Time", value: sumAll, border: last30.length <= 14 },
  ];

  return (
    <TooltipProvider delayDuration={200}>
      <UITooltip>
        <TooltipTrigger asChild onClick={(e) => e.stopPropagation()}>
          {children}
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="end"
          className="bg-zinc-900/95 backdrop-blur-xl border border-white/[0.08] rounded-xl px-5 py-4 shadow-2xl max-w-[220px]"
        >
          <div className="space-y-2">
            {rows.map((row) => (
              <div key={row.label} className={`flex items-center justify-between gap-6 ${row.border ? "border-t border-white/[0.06] pt-2" : ""}`}>
                <span className="text-[10px] uppercase tracking-[0.15em] text-white/30 font-light">{row.label}</span>
                <div className="flex items-center gap-1.5">
                  <span className={`text-sm font-light ${row.label === "Heute" ? "gold-text" : "text-foreground/60"}`}>{formatEur(row.value)}</span>
                  {row.label === "Gestern" && diffYesterday !== null && (
                    <span className={`text-[10px] font-medium ${diffYesterday > 0 ? "text-emerald-400/70" : diffYesterday < 0 ? "text-red-400/70" : "text-white/25"}`}>
                      {diffYesterday > 0 ? "+" : ""}{diffYesterday}%
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </TooltipContent>
      </UITooltip>
    </TooltipProvider>
  );
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
  
   const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());
  const [activeLabelFilters, setActiveLabelFilters] = useState<Set<string>>(new Set());
  const [activeTierFilters, setActiveTierFilters] = useState<Set<AccountTierId>>(new Set());
  const [allCollapsed, setAllCollapsed] = useState(false);
  const [allHistory, setAllHistory] = useState<Record<string, HistoryEntry[]>>({});
  const [videoCoachings, setVideoCoachings] = useState<Record<string, string>>({});
  const [dailyChecks, setDailyChecks] = useState<Set<string>>(new Set());
  const [allLabels, setAllLabels] = useState<ChatterLabel[]>([]);
  const [labelAssignments, setLabelAssignments] = useState<LabelAssignment[]>([]);
  const [modelPerformances, setModelPerformances] = useState<Record<string, ModelPerformance>>({});
  const [followerMap, setFollowerMap] = useState<Map<string, number>>(new Map());

  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // Post-process categories: whitelist mapping, onboarding date lock, dedup
  const categories = useMemo(() => {
    const raw = data?.categories ?? [];
    if (raw.length === 0) return raw;

    // Map all AI categories to whitelisted names and merge into a single map
    const catMap = new Map<string, Category>();

    for (const cat of raw) {
      for (const ch of cat.chatters) {
        const mapped = mapToAllowed(cat.categoryName);

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
        setDailyChecks(new Set((rows as any[]).map((r) => normalizeChatterName(r.chatter_name))));
      });

    // Load labels and assignments
    supabase
      .from("chatter_labels")
      .select("id, label_name, color")
      .eq("platform", platform)
      .then(({ data: rows }) => {
        if (rows) setAllLabels(rows as ChatterLabel[]);
      });

    supabase
      .from("chatter_label_assignments")
      .select("chatter_name, label_id")
      .eq("platform", platform)
      .then(({ data: rows }) => {
        if (rows) setLabelAssignments(rows as LabelAssignment[]);
      });

    // Load model performance comparisons
    const allChattersForModels = categories.flatMap((c) =>
      c.chatters.map((ch) => ({ name: toTitleCase(ch.name), account: ch.account }))
    );
    supabase
      .from("models")
      .select("model_name, follower_count")
      .eq("platform", platform)
      .then(async ({ data: models }) => {
        if (models) {
          // Build followerMap (lowercase account → followers) for tier filtering
          const fmap = new Map<string, number>();
          for (const m of models) {
            fmap.set((m.model_name || "").toLowerCase().trim(), m.follower_count || 0);
          }
          setFollowerMap(fmap);
        }
        if (models && allChattersForModels.length > 0) {
          const perfs = await loadModelPerformances(platform, allChattersForModels, models as ModelInfo[]);
          setModelPerformances(perfs);
        }
      });
  }, [categories, platform]);

  const toggleDailyCheck = useCallback(async (chatterName: string) => {
    const normalizedName = normalizeChatterName(chatterName);
    const isChecked = dailyChecks.has(normalizedName);
    if (isChecked) {
      setDailyChecks((prev) => { const next = new Set(prev); next.delete(normalizedName); return next; });
      await supabase
        .from("daily_chatter_checks")
        .delete()
        .eq("chatter_name", chatterName)
        .eq("platform", platform)
        .eq("check_date", todayStr);
    } else {
      setDailyChecks((prev) => new Set(prev).add(normalizedName));
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

  const chatterLabelsMap = useMemo(() => {
    const map: Record<string, ChatterLabel[]> = {};
    const labelMap = new Map(allLabels.map((l) => [l.id, l]));
    for (const a of labelAssignments) {
      const label = labelMap.get(a.label_id);
      if (label) {
        // Store under normalized key for reliable lookup
        const key = normalizeChatterName(a.chatter_name);
        if (!map[key]) map[key] = [];
        map[key].push(label);
      }
    }
    return map;
  }, [allLabels, labelAssignments]);

  // Single-select: click toggles one filter, clicking active deselects all
  const toggleFilter = (name: string) => {
    setActiveFilters((prev) => {
      if (prev.has(name)) return new Set();
      return new Set([name]);
    });
  };

  const toggleLabelFilter = (labelId: string) => {
    setActiveLabelFilters((prev) => {
      const next = new Set(prev);
      if (next.has(labelId)) next.delete(labelId);
      else next.add(labelId);
      return next;
    });
  };

  const toggleTierFilter = (tierId: AccountTierId) => {
    setActiveTierFilters((prev) => {
      const next = new Set(prev);
      if (next.has(tierId)) next.delete(tierId);
      else next.add(tierId);
      return next;
    });
  };

  // Map: normalized chatter name → tierId (basierend auf seinem Account)
  const chatterTierMap = useMemo(() => {
    const map = new Map<string, AccountTierId>();
    for (const cat of categories) {
      for (const ch of cat.chatters) {
        const acc = (ch.account || "").toLowerCase().trim();
        if (!acc) continue;
        const followers = followerMap.get(acc);
        if (followers == null) continue;
        const tier = tierForFollowers(followers);
        if (tier) map.set(normalizeChatterName(ch.name), tier.id);
      }
    }
    return map;
  }, [categories, followerMap]);

  // Counts pro Tier (über alle Kategorien hinweg)
  const tierCounts = useMemo(() => {
    const counts = new Map<AccountTierId, number>();
    for (const cat of categories) {
      for (const ch of cat.chatters) {
        const tierId = chatterTierMap.get(normalizeChatterName(ch.name));
        if (!tierId) continue;
        counts.set(tierId, (counts.get(tierId) || 0) + 1);
      }
    }
    return counts;
  }, [categories, chatterTierMap]);

  const visibleCategories = useMemo(() => {
    let filtered = activeFilters.size === 0
      ? categories
      : categories.filter((c) => activeFilters.has(c.categoryName));

    if (activeTierFilters.size > 0) {
      filtered = filtered
        .map((cat) => ({
          ...cat,
          chatters: cat.chatters.filter((ch) => {
            const tierId = chatterTierMap.get(normalizeChatterName(ch.name));
            return tierId !== undefined && activeTierFilters.has(tierId);
          }),
        }))
        .filter((cat) => cat.chatters.length > 0);
    }

    if (activeLabelFilters.size > 0) {
      filtered = filtered
        .map((cat) => ({
          ...cat,
          chatters: cat.chatters.filter((ch) => {
            const key = normalizeChatterName(ch.name);
            const labels = chatterLabelsMap[key] || [];
            return labels.some((l) => activeLabelFilters.has(l.id));
          }),
        }))
        .filter((cat) => cat.chatters.length > 0);
    }

    return filtered;
  }, [activeFilters, activeLabelFilters, activeTierFilters, categories, chatterLabelsMap, chatterTierMap]);


  // Tier-aware Kategorien (für Pill-Counts + Progress-Bar): wenn ein Tier aktiv ist,
  // zählen wir NUR Chatters innerhalb der aktiven Tiers — sonst alle.
  const tierScopedCategories = useMemo(() => {
    if (activeTierFilters.size === 0) return categories;
    return categories.map((cat) => ({
      ...cat,
      chatters: cat.chatters.filter((ch) => {
        const tierId = chatterTierMap.get(normalizeChatterName(ch.name));
        return tierId !== undefined && activeTierFilters.has(tierId);
      }),
    }));
  }, [categories, activeTierFilters, chatterTierMap]);

  const tierScopedNames = useMemo(() => {
    const set = new Set<string>();
    for (const cat of tierScopedCategories) {
      for (const ch of cat.chatters) set.add(normalizeChatterName(ch.name));
    }
    return set;
  }, [tierScopedCategories]);

  const checkedCount = useMemo(() => {
    if (activeTierFilters.size === 0) return dailyChecks.size;
    let n = 0;
    for (const name of dailyChecks) if (tierScopedNames.has(name)) n++;
    return n;
  }, [dailyChecks, tierScopedNames, activeTierFilters]);

  if (!data || categories.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-light text-foreground/80 tracking-wide">Ergebnis</h2>
        </div>
        <div className="bg-white/[0.02] border border-white/[0.05] rounded-2xl p-8 backdrop-blur-2xl min-h-40 flex items-center justify-center">
          <p className="text-sm text-white/35 font-light">Keine strukturierte Analyse verfügbar.</p>
        </div>
      </div>
    );
  }

  const totalChatters = tierScopedCategories.reduce((a, c) => a + c.chatters.length, 0);
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
        <button
          onClick={() => setAllCollapsed((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] text-white/40 hover:text-white/70 bg-white/[0.03] border border-white/[0.06] hover:border-white/[0.12] transition-all duration-200"
        >
          {allCollapsed ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
          {allCollapsed ? "Alle aufklappen" : "Alle einklappen"}
        </button>
      </div>

      {/* Mobile Tier-Filter Pills */}
      {tierCounts.size > 0 && (
        <div className="flex sm:hidden w-full gap-1.5 flex-wrap">
          {ACCOUNT_TIERS.map((tier) => {
            const isActive = activeTierFilters.has(tier.id);
            const count = tierCounts.get(tier.id) || 0;
            const isEmpty = count === 0;
            return (
              <button
                key={tier.id}
                onClick={() => !isEmpty && toggleTierFilter(tier.id)}
                disabled={isEmpty}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-normal transition-all border ${
                  isActive
                    ? `${tier.activeBg} ${tier.activeBorder} ${tier.activeText}`
                    : isEmpty
                      ? "bg-transparent border-white/[0.03] text-white/15"
                      : "bg-white/[0.03] border-white/[0.06] text-white/55"
                }`}
              >
                <span>{tier.emoji}</span>
                <span>{tier.label}</span>
                <span className="text-[9px] opacity-60 tabular-nums">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Mobile Filter Dropdowns */}
      <div className="flex sm:hidden w-full gap-2">
        <Select
          value={activeFilters.size === 1 ? [...activeFilters][0] : "all"}
          onValueChange={(val) => {
            if (val === "all") { setActiveFilters(new Set()); }
            else { setActiveFilters(new Set([val])); }
          }}
        >
          <SelectTrigger className={cn("bg-white/[0.02] border-white/[0.06] text-white/60 text-xs h-9", allLabels.length > 0 ? "flex-1" : "w-full")}>
            <div className="flex items-center gap-2">
              <Filter className="h-3 w-3 text-white/25" />
              <SelectValue placeholder="Kategorie" />
            </div>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Kategorien ({totalChatters})</SelectItem>
            {tierScopedCategories.map((cat) => (
              <SelectItem key={cat.categoryName} value={cat.categoryName}>
                {cat.emoji} {cat.categoryName} ({cat.chatters.length})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {allLabels.length > 0 && (
          <Select
            value={activeLabelFilters.size === 1 ? [...activeLabelFilters][0] : "all-labels"}
            onValueChange={(val) => {
              if (val === "all-labels") { setActiveLabelFilters(new Set()); }
              else { setActiveLabelFilters(new Set([val])); }
            }}
          >
            <SelectTrigger className="flex-1 bg-white/[0.02] border-white/[0.06] text-white/60 text-xs h-9">
              <div className="flex items-center gap-2">
                <Tag className="h-3 w-3 text-white/25" />
                <SelectValue placeholder="Label" />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all-labels">Alle Labels</SelectItem>
              {allLabels.map((label) => (
                <SelectItem key={label.id} value={label.id}>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: label.color }} />
                    {label.label_name}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>



      {/* Desktop Filter Pills — Grouped */}
      <div className="hidden sm:block pb-2">
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.015] backdrop-blur-xl p-5 space-y-0.5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Filter className="h-3.5 w-3.5 text-white/20" />
              <span className="text-[11px] text-white/40 font-medium tracking-wider uppercase">Kategorien</span>
            </div>
            {(activeFilters.size > 0 || activeLabelFilters.size > 0 || activeTierFilters.size > 0) && (
              <button
                onClick={() => { setActiveFilters(new Set()); setActiveLabelFilters(new Set()); setActiveTierFilters(new Set()); }}
                className="text-[10px] text-primary/70 hover:text-primary transition-colors font-medium tracking-wide flex items-center gap-1"
              >
                ✕ Zurücksetzen
              </button>
            )}
          </div>

          {/* Tier-Filter (Oberfilter nach Account-Größe) */}
          {tierCounts.size > 0 && (
            <div className="pb-3 mb-3 border-b border-white/[0.06]">
              <div className="flex items-start gap-4 pl-1 border-l-2 border-l-primary/30">
                <div className="flex items-center gap-2 pt-0.5 min-w-[80px] shrink-0">
                  <Users className="h-3 w-3 text-white/30" />
                  <span className="text-[11px] text-white/50 font-semibold tracking-wide">Tier</span>
                  <span className="text-[10px] text-white/20 font-medium">{[...tierCounts.values()].reduce((s, n) => s + n, 0)}</span>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {ACCOUNT_TIERS.map((tier) => {
                    const isActive = activeTierFilters.has(tier.id);
                    const count = tierCounts.get(tier.id) || 0;
                    const isEmpty = count === 0;
                    return (
                      <button
                        key={tier.id}
                        onClick={() => !isEmpty && toggleTierFilter(tier.id)}
                        title={tier.description}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-normal transition-all duration-200 border whitespace-nowrap ${
                          isActive
                            ? `${tier.activeBg} ${tier.activeBorder} ${tier.activeText} shadow-[0_0_10px_-4px] shadow-current`
                            : isEmpty
                              ? "bg-transparent border-white/[0.03] text-white/15 cursor-default"
                              : `bg-white/[0.03] border-white/[0.06] text-white/50 hover:text-white/70 ${tier.hoverBorder} hover:bg-white/[0.05]`
                        }`}
                      >
                        <span className="text-xs leading-none">{tier.emoji}</span>
                        <span>{tier.label}</span>
                        <span className={`text-[10px] tabular-nums font-medium ${isActive ? "opacity-60" : isEmpty ? "text-white/10" : "text-white/25"}`}>{count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

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

          {/* Label Filter Pills */}
          {allLabels.length > 0 && (
            <div className="py-3 border-t border-white/[0.04]">
              <div className="flex items-start gap-4 pl-1 border-l-2 border-l-white/20">
                <div className="flex items-center gap-2 pt-0.5 min-w-[80px] shrink-0">
                  <span className="text-[11px] text-white/50 font-semibold tracking-wide">Labels</span>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {allLabels.map((label) => {
                    const isActive = activeLabelFilters.has(label.id);
                    return (
                      <button
                        key={label.id}
                        onClick={() => toggleLabelFilter(label.id)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-normal transition-all duration-200 border whitespace-nowrap ${
                          isActive
                            ? "shadow-[0_0_10px_-4px] shadow-current"
                            : "bg-white/[0.03] border-white/[0.06] text-white/50 hover:text-white/70 hover:bg-white/[0.05]"
                        }`}
                        style={isActive ? {
                          backgroundColor: label.color + "15",
                          borderColor: label.color + "50",
                          color: label.color,
                        } : undefined}
                      >
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: label.color }} />
                        <span>{label.label_name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
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
              <CategoryCard category={cat} onChatterClick={onChatterSelect} chatterStats={chatterStats} videoCoachings={videoCoachings} dailyChecks={dailyChecks} onToggleCheck={toggleDailyCheck} chatterLabelsMap={chatterLabelsMap} collapsed={allCollapsed} modelPerformances={modelPerformances} />
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

function CategoryCard({ category, onChatterClick, chatterStats, videoCoachings, dailyChecks, onToggleCheck, chatterLabelsMap, collapsed, modelPerformances }: { category: Category; onChatterClick: (name: string) => void; chatterStats: Record<string, ChatterStats>; videoCoachings: Record<string, string>; dailyChecks: Set<string>; onToggleCheck: (name: string) => void; chatterLabelsMap: Record<string, ChatterLabel[]>; collapsed?: boolean; modelPerformances?: Record<string, ModelPerformance> }) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  const [localOpen, setLocalOpen] = useState(false);
  const visible = category.chatters.slice(0, visibleCount);
  const hasMore = visibleCount < category.chatters.length;
  const isOpen = !collapsed || localOpen;

  // Reset localOpen when global collapse changes
  useEffect(() => {
    if (collapsed) setLocalOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed]);

  return (
    <div data-category-name={category.categoryName} className="w-full max-w-full rounded-2xl bg-white/[0.02] border border-white/[0.05] backdrop-blur-2xl overflow-hidden">
      <div
        onClick={() => { if (collapsed && !localOpen) setLocalOpen(true); else if (localOpen) setLocalOpen(false); }}
        className={cn("px-4 sm:px-8 py-4 sm:py-6 border-b border-white/[0.04] flex flex-wrap items-start gap-x-3 gap-y-2 min-w-0", collapsed ? "cursor-pointer hover:bg-white/[0.03] transition-colors" : "")}
      >
        <span className="text-base sm:text-lg">{category.emoji}</span>
        <h3 className="min-w-0 flex-1 text-sm leading-tight sm:text-lg font-medium tracking-wide gold-text break-words">
          {category.categoryName}
        </h3>
        <div className="flex items-center gap-2 w-full pl-7 sm:pl-0 sm:w-auto sm:ml-auto">
          <span className="text-[10px] text-white/20 font-light tracking-wider">
            {category.chatters.length} {category.chatters.length === 1 ? "Eintrag" : "Einträge"}
          </span>
          {collapsed && (
            <ChevronDown className={cn("h-3 w-3 text-white/20 transition-transform duration-200", localOpen && "rotate-180")} />
          )}
        </div>
      </div>
      {isOpen && (
        <>
          <div className="divide-y divide-white/[0.03]">
            {visible.length === 0 ? (
              <div className="px-8 py-6 text-center">
                <p className="text-[11px] text-white/20 font-light tracking-wider">Keine Chatter in dieser Kategorie</p>
              </div>
            ) : visible.map((chatter, i) => (
              <ChatterItem key={i} chatter={chatter} onChatterClick={onChatterClick} stats={chatterStats[toTitleCase(chatter.name)]} videoCoachingSentAt={videoCoachings[toTitleCase(chatter.name)]} isChecked={dailyChecks.has(normalizeChatterName(chatter.name))} onToggleCheck={() => onToggleCheck(toTitleCase(chatter.name))} labels={chatterLabelsMap[normalizeChatterName(chatter.name)]} modelPerf={modelPerformances?.[toTitleCase(chatter.name)]} />
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
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  CHATTER ITEM — Clean grid layout                                   */
/* ------------------------------------------------------------------ */

function ChatterItem({ chatter, onChatterClick, stats, videoCoachingSentAt, isChecked, onToggleCheck, labels, modelPerf }: { chatter: Chatter; onChatterClick: (name: string) => void; stats?: ChatterStats; videoCoachingSentAt?: string; isChecked?: boolean; onToggleCheck?: () => void; labels?: ChatterLabel[]; modelPerf?: ModelPerformance }) {
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
          {modelPerf && modelPerf.followers > 0 && (
            <div className="flex items-center gap-2 mt-1">
              <span className="inline-flex items-center gap-1 text-[10px] text-white/30 font-light">
                <Users className="h-3 w-3 text-white/20" />
                {formatFollowers(modelPerf.followers)}
              </span>
              {modelPerf.status !== "first" && modelPerf.percentChange !== null && (
                <span
                  className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    modelPerf.status === "better"
                      ? "bg-emerald-500/10 text-emerald-400/80 border border-emerald-500/20"
                      : modelPerf.status === "worse"
                      ? "bg-red-500/10 text-red-400/80 border border-red-500/20"
                      : "bg-white/[0.04] text-white/30 border border-white/[0.06]"
                  }`}
                  title={
                    modelPerf.isSplitEstimate
                      ? `Schätzung: ${modelPerf.previousChatterName} hatte bis zu ${modelPerf.previousMaxAccountsPerDay} Accounts/Tag, aktuell bis zu ${modelPerf.currentMaxAccountsPerDay}. Umsatz wurde nach Follower-Anteil aufgeteilt.`
                      : `Vergleich vs. ${modelPerf.previousChatterName}`
                  }
                >
                  {modelPerf.status === "better" ? "↑" : modelPerf.status === "worse" ? "↓" : "→"}
                  {modelPerf.percentChange > 0 ? "+" : ""}{modelPerf.percentChange}% vs. {modelPerf.previousChatterName}
                  {modelPerf.isSplitEstimate && <span className="ml-0.5 opacity-70">≈</span>}
                </span>
              )}
              {modelPerf.isSplitEstimate && (
                <span
                  className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] bg-amber-500/10 text-amber-400/80 border border-amber-500/20"
                  title="Mehrere Accounts gleichzeitig — Umsatz nach Follower-Anteil geschätzt"
                >
                  ⚖️ Multi-Account
                </span>
              )}
              {modelPerf.status === "first" && (
                <span className="text-[10px] text-white/15 font-light">Erster Chatter</span>
              )}
            </div>
          )}
          {videoCoachingSentAt && (() => {
            const days = Math.floor((Date.now() - new Date(videoCoachingSentAt).getTime()) / 86400000);
            return (
              <span className="inline-flex items-center gap-1 mt-1 text-[10px] text-purple-400/70 font-light tracking-wide">
                📼 vor {days === 0 ? "heute" : `${days} Tag${days !== 1 ? "en" : ""}`}
              </span>
            );
          })()}

          {labels && labels.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {labels.map((label) => (
                <span
                  key={label.id}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border"
                  style={{ backgroundColor: label.color + "20", borderColor: label.color + "40", color: label.color }}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: label.color }} />
                  {label.label_name}
                </span>
              ))}
            </div>
          )}

          {revenueEntry && (
            <RevenueHoverPopup history={stats?.history ?? []}>
              <div className="mt-2 flex items-center gap-1.5 sm:hidden min-w-0 cursor-default">
                <span className="text-sm font-light gold-text tracking-tight break-words">{revenueEntry[1]}</span>
                {stats && <TrendIcon trend={stats.trend} />}
              </div>
            </RevenueHoverPopup>
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
          <RevenueHoverPopup history={stats?.history ?? []}>
            <div className="hidden sm:flex shrink-0 items-center gap-1.5 sm:gap-2 min-w-[80px] sm:min-w-[100px] justify-end cursor-default">
              <span className="text-sm sm:text-base font-light gold-text tracking-tight">{revenueEntry[1]}</span>
              {stats && <TrendIcon trend={stats.trend} />}
            </div>
          </RevenueHoverPopup>
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

      {/* Row 3: Inline revenue sparkline — flush, no box */}
      {sparkData.length >= 1 && (
        <div className="ml-[52px] sm:ml-[60px] mr-4 sm:mr-8 mt-1" onClick={(e) => e.stopPropagation()}>
          <ResponsiveContainer width="100%" height={28}>
            <AreaChart data={sparkData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`miniGrad-${formattedName.replace(/\s/g, "")}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#D4AF37" stopOpacity={0.1} />
                  <stop offset="100%" stopColor="#D4AF37" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="analysis_date" hide />
              <RechartsTooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0]?.payload as HistoryEntry;
                  const d = new Date(row.analysis_date);
                  const dateStr = `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.`;
                  const rev = row.revenue_today.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
                  return (
                    <div className="bg-zinc-900/95 backdrop-blur-xl border border-white/[0.08] rounded-lg px-3 py-1.5 shadow-xl">
                      <p className="text-[10px] text-white/30 font-light">{dateStr}</p>
                      <p className="text-xs font-light gold-text">{rev}</p>
                      {row.mass_dms > 0 && <p className="text-[10px] text-white/25 mt-0.5">{row.mass_dms} DMs</p>}
                    </div>
                  );
                }}
                cursor={{ stroke: "rgba(212,175,55,0.1)" }}
              />
              <Area
                type="monotone"
                dataKey="revenue_today"
                stroke="#D4AF37"
                strokeWidth={1.2}
                fill={`url(#miniGrad-${formattedName.replace(/\s/g, "")})`}
                dot={sparkData.length === 1 ? { r: 2, fill: "#D4AF37", strokeWidth: 0 } : false}
                activeDot={{ r: 2.5, fill: "#D4AF37", stroke: "rgba(212,175,55,0.3)", strokeWidth: 3 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}