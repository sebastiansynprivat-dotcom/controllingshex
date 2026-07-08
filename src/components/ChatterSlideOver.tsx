import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Send,
  Plus,
  Tag,
  TrendingUp,
  TrendingDown,
  Minus,
  Coins,
  Trophy,
  MessageSquare,
  Clock,
  GitCompareArrows,
  Search,
  Mic,
  Loader2,
  Download,
  RefreshCw,
  Trash2,
  Check,
  Eye,
  EyeOff,
  Copy,
  Mail,
  KeyRound,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from "recharts";
import WeekTrendCard from "@/components/WeekTrendCard";
import ChatterActivityHoursCard from "@/components/ChatterActivityHoursCard";
import { onChatterDataUpdated, emitChatterLabelsUpdated } from "@/lib/data-events";

interface HistoryRow {
  analysis_date: string;
  revenue_today: number;
  mass_dms: number;
  open_chats: number;
  response_delay_days: number;
}

interface CoachingNote {
  id: string;
  note_text: string;
  created_at: string;
}

interface ChatterMemo {
  id: string;
  text: string;
  topic: string | null;
  follow_up_at: string | null;
  status: string;
  created_at: string;
}

interface ChatterLabel {
  id: string;
  label_name: string;
  color: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  chatterName: string;
  platform: string;
  inline?: boolean;
  /** Optional: zweiter Chatter, mit dem die Vergleichsansicht direkt geöffnet wird. */
  initialCompareWith?: string | null;
  /** Split-View: rendert das Panel auf der rechten Bildschirmhälfte (nebeneinander mit dem Model-Monitor). */
  splitView?: boolean;
}

function toTitleCase(name: string): string {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function getInitials(name: string): string {
  const clean = name.replace(/_/g, " ").trim();
  const parts = clean.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function SectionHeader({ children, accent = "240 5% 60%" }: { children: React.ReactNode; accent?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="h-3 w-[2px] rounded-full"
        style={{ background: `hsl(${accent} / 0.7)`, boxShadow: `0 0 8px hsl(${accent} / 0.5)` }}
      />
      <p className="text-[10px] uppercase tracking-[0.2em] text-white/40 font-medium">{children}</p>
    </div>
  );
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.`;
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()} — ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatCurrency(v: number) {
  return v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

/* Custom Tooltips */
function RevenueTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as (HistoryRow & { note?: string }) | undefined;
  if (!row) return null;
  return (
    <div className="premium-card rounded-xl px-5 py-3.5 max-w-[240px]">
      <p className="text-[10px] gold-text-subtle font-medium tracking-[0.2em] uppercase mb-2">
        {formatDate(row.analysis_date)}
      </p>
      <p className="text-lg font-extralight gold-text tracking-tight tabular-nums">
        {formatCurrency(row.revenue_today)}
      </p>
      <p className="text-[11px] text-white/45 font-light mt-1 tracking-wide">{row.mass_dms} MassDMs</p>
      {row.note && (
        <p className="text-[11px] text-primary/80 font-light mt-2 border-t border-white/[0.06] pt-2 leading-relaxed">
          📝 {row.note}
        </p>
      )}
    </div>
  );
}

function GhostChatTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as HistoryRow | undefined;
  if (!row) return null;
  return (
    <div className="premium-card rounded-xl px-5 py-3.5">
      <p className="text-[10px] gold-text-subtle font-medium tracking-[0.2em] uppercase mb-2">
        {formatDate(row.analysis_date)}
      </p>
      <p className="text-lg font-extralight tracking-tight tabular-nums" style={{ color: "#E25822" }}>
        {row.open_chats} Offene Chats
      </p>
      <p className="text-[11px] text-white/45 font-light mt-1 tracking-wide">{row.response_delay_days} Tage Verzug</p>
    </div>
  );
}

/* Sanitize delay: must be 0-30, never mirror revenue or revenue×100 */
function sanitizeDelay(raw: number, revenue: number): number {
  const val = Math.round(raw);
  if (val < 0 || val > 30 || val === Math.round(revenue) || val === Math.round(revenue * 100)) return 0;
  return val;
}

/* Premium Skeleton — placeholder layout matching the real profile */
function ProfileSkeleton({ compact = false }: { compact?: boolean }) {
  const spacing = compact ? "space-y-6 sm:space-y-8" : "space-y-8 sm:space-y-12";
  const kpiPad = compact ? "p-3 sm:p-4" : "p-5";
  const kpiGap = compact ? "gap-2.5 sm:gap-3" : "gap-4";
  return (
    <div className={spacing}>
      {/* KPI Grid 2×2 */}
      <div className={`grid grid-cols-2 ${kpiGap}`}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={`premium-skel-card ${kpiPad}`}>
            <div className="flex items-center gap-1.5 mb-3">
              <div className="premium-skel h-3 w-3 rounded-full" />
              <div className="premium-skel h-2.5 w-20 rounded" />
            </div>
            <div className="premium-skel h-7 w-24 rounded mt-2" />
            <div className="premium-skel h-2 w-16 rounded mt-2" />
          </div>
        ))}
      </div>
      {/* Chart */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <div className="premium-skel h-3 w-[2px]" />
          <div className="premium-skel h-2.5 w-32 rounded" />
        </div>
        <div className="premium-skel-card p-5">
          <div className="premium-skel h-40 w-full rounded-lg" />
        </div>
      </div>
      {/* List */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <div className="premium-skel h-3 w-[2px]" />
          <div className="premium-skel h-2.5 w-24 rounded" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="premium-skel-card p-4">
              <div className="premium-skel h-2.5 w-3/4 rounded mb-2" />
              <div className="premium-skel h-2 w-1/2 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ModelLoginRow({
  model,
  onCopy,
}: {
  model: { name: string; email: string | null; password: string | null };
  onCopy: (value: string, label: string) => void;
}) {
  const [showPw, setShowPw] = useState(false);
  return (
    <div className="group flex items-center gap-3 px-4 py-3 hover:bg-white/[0.025] transition-colors min-w-0">
      <div
        className="h-8 w-8 shrink-0 rounded-lg bg-primary/[0.08] border border-primary/20 flex items-center justify-center text-[10px] font-medium tracking-wide text-primary/90"
        title={model.name}
      >
        {getInitials(model.name).slice(0, 2)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] text-foreground/90 font-light tracking-wide truncate">{model.name}</p>
        <div className="mt-1 flex items-center gap-2 text-[11px] font-mono">
          {model.email ? (
            <button
              type="button"
              onClick={() => onCopy(model.email!, "E-Mail")}
              title="E-Mail kopieren"
              className="min-w-0 max-w-[220px] truncate text-white/55 hover:text-primary text-left"
            >
              {model.email}
            </button>
          ) : (
            <span className="italic text-white/20 text-[10px]">keine Mail</span>
          )}
          {model.password ? (
            <>
              <span className="text-white/15">·</span>
              <button
                type="button"
                onClick={() => onCopy(model.password!, "Passwort")}
                title="Passwort kopieren"
                className="tabular-nums text-white/55 hover:text-primary"
              >
                {showPw ? model.password : "•".repeat(Math.min(model.password.length, 10))}
              </button>
            </>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {model.email && (
          <button
            type="button"
            onClick={() => onCopy(model.email!, "E-Mail")}
            title="E-Mail kopieren"
            className="h-8 w-8 flex items-center justify-center rounded-lg text-white/45 hover:text-primary hover:bg-primary/[0.08] border border-transparent hover:border-primary/20 transition-all"
          >
            <Mail className="h-3.5 w-3.5" />
          </button>
        )}
        {model.password && (
          <>
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              title={showPw ? "Passwort verbergen" : "Passwort anzeigen"}
              className="h-8 w-8 flex items-center justify-center rounded-lg text-white/45 hover:text-primary hover:bg-primary/[0.08] border border-transparent hover:border-primary/20 transition-all"
            >
              {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => onCopy(model.password!, "Passwort")}
              title="Passwort kopieren"
              className="h-8 w-8 flex items-center justify-center rounded-lg text-white/45 hover:text-primary hover:bg-primary/[0.08] border border-transparent hover:border-primary/20 transition-all"
            >
              <KeyRound className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function LiveKpiStrip({
  liveKpis,
  isActiveToday,
  compact = false,
}: {
  liveKpis: { label: string; value: string; icon: any; accent: string; gold: boolean }[];
  isActiveToday: boolean;
  compact?: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
        </span>
        <p className="text-[9px] uppercase tracking-[0.2em] text-emerald-300/70 font-medium">Echtzeit · Heute</p>
      </div>
      <div className={`grid grid-cols-2 ${compact ? "gap-2" : "gap-2 sm:gap-3"}`}>
        {liveKpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div
              key={kpi.label}
              className={`relative rounded-xl bg-emerald-500/[0.03] border border-emerald-500/15 overflow-hidden ${compact ? "p-2.5 sm:p-3" : "p-3"}`}
            >
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/[0.04] to-transparent pointer-events-none" />
              <div className="relative flex items-center gap-1">
                <Icon className={`${compact ? "h-2.5 w-2.5" : "h-3 w-3"}`} style={{ color: `hsl(${kpi.accent} / 0.7)` }} />
                <p
                  className={`${compact ? "text-[8px] tracking-[0.12em]" : "text-[9px] tracking-[0.14em]"} uppercase text-white/45 font-medium truncate`}
                >
                  {kpi.label}
                </p>
              </div>
              <p
                className={`relative ${compact ? "text-xs sm:text-sm mt-1" : "text-sm sm:text-base mt-1.5"} font-medium tracking-tight tabular-nums truncate ${kpi.gold ? "gold-text" : "text-foreground/90"}`}
              >
                {kpi.value}
              </p>
            </div>
          );
        })}
      </div>
      <div
        className={`flex items-center justify-between rounded-xl px-3 py-2 border ${isActiveToday ? "bg-emerald-500/[0.05] border-emerald-500/25" : "bg-white/[0.02] border-white/[0.06]"}`}
      >
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            {isActiveToday && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70" />
            )}
            <span className={`relative inline-flex h-2 w-2 rounded-full ${isActiveToday ? "bg-emerald-400" : "bg-white/25"}`} />
          </span>
          <p className="text-[10px] uppercase tracking-[0.2em] text-white/55 font-medium">Heute aktiv</p>
        </div>
        <p className={`text-[11px] font-medium tracking-wide ${isActiveToday ? "text-emerald-300" : "text-white/40"}`}>
          {isActiveToday ? "Aktiv" : "Inaktiv"}
        </p>
      </div>
    </div>
  );
}

function Trend30Block({
  last30,
  trend30,
  compact = false,
  gradientId,
}: {
  last30: HistoryRow[];
  trend30: { pct: number; direction: "up" | "down" | "stable" };
  compact?: boolean;
  gradientId: string;
}) {
  if (last30.length < 4) return null;
  const trendAccent =
    trend30.direction === "up" ? "152 70% 45%" : trend30.direction === "down" ? "0 84% 60%" : "240 5% 60%";
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SectionHeader accent={trendAccent}>30-Tage-Trend</SectionHeader>
          <span
            className={`premium-chip text-[10px] font-medium px-2 py-0.5 rounded-full tabular-nums ${
              trend30.direction === "up"
                ? "bg-emerald-500/12 text-emerald-300 border border-emerald-500/25"
                : trend30.direction === "down"
                  ? "bg-red-500/12 text-red-300 border border-red-500/25"
                  : "bg-white/[0.05] text-white/55 border border-white/[0.08]"
            }`}
          >
            {trend30.direction === "up" ? "↑" : trend30.direction === "down" ? "↓" : "→"} {trend30.pct > 0 ? "+" : ""}
            {trend30.pct}%
          </span>
        </div>
      </div>
      <div className={`premium-card relative ${compact ? "rounded-2xl p-4" : "rounded-2xl p-5"}`}>
        <ResponsiveContainer width="100%" height={compact ? 100 : 120}>
          <AreaChart data={last30}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={trend30.direction === "down" ? "#ef4444" : "#10b981"} stopOpacity={0.25} />
                <stop offset="100%" stopColor={trend30.direction === "down" ? "#ef4444" : "#10b981"} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="analysis_date"
              tickFormatter={formatDate}
              axisLine={false}
              tickLine={false}
              tick={{ fill: "rgba(255,255,255,0.35)", fontSize: compact ? 9 : 10 }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "rgba(255,255,255,0.3)", fontSize: compact ? 9 : 10 }}
              tickFormatter={(v) => `${v}€`}
              width={compact ? 40 : 50}
            />
            <Tooltip content={<RevenueTooltip />} cursor={{ stroke: "rgba(255,255,255,0.08)" }} />
            <Area
              type="monotone"
              dataKey="revenue_today"
              stroke={trend30.direction === "down" ? "#ef4444" : "#10b981"}
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              dot={false}
              activeDot={{
                r: 4,
                fill: trend30.direction === "down" ? "#ef4444" : "#10b981",
                stroke: "rgba(255,255,255,0.15)",
                strokeWidth: 4,
              }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}





export default function ChatterSlideOver({ open, onClose, chatterName, platform, inline = false, initialCompareWith = null, splitView = false }: Props) {
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState<CoachingNote[]>([]);
  const [noteText, setNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [chatterMemos, setChatterMemos] = useState<ChatterMemo[]>([]);
  const [memoInputText, setMemoInputText] = useState("");
  const [memoFollowupDays, setMemoFollowupDays] = useState<string>("");
  const [savingChatterMemo, setSavingChatterMemo] = useState(false);
  const [memoLoading, setMemoLoading] = useState(false);
  const [memoUrl, setMemoUrl] = useState<string | null>(null);
  const [memoText, setMemoText] = useState<string | null>(null);

  const generateMemo = useCallback(async () => {
    setMemoLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-voice-memo", {
        body: { chatterName, platform },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const bin = atob(data.audio);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const blob = new Blob([arr], { type: "audio/mpeg" });
      if (memoUrl) URL.revokeObjectURL(memoUrl);
      setMemoUrl(URL.createObjectURL(blob));
      setMemoText(data.text || null);
    } catch (e: any) {
      toast.error(e?.message || "Memo konnte nicht generiert werden");
    } finally {
      setMemoLoading(false);
    }
  }, [chatterName, platform, memoUrl]);

  // Reset memo wenn Chatter wechselt
  useEffect(() => {
    if (memoUrl) URL.revokeObjectURL(memoUrl);
    setMemoUrl(null);
    setMemoText(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatterName, platform]);

  const [allLabels, setAllLabels] = useState<ChatterLabel[]>([]);
  const [assignedLabelIds, setAssignedLabelIds] = useState<Set<string>>(new Set());
  const [showNewLabel, setShowNewLabel] = useState(false);
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState("#3B82F6");
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastTapRef = useRef<number>(0);

  // Compare-Mode (nur im non-inline Slide-Over verfügbar)
  const [compareWith, setCompareWith] = useState<string | null>(initialCompareWith);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [chatterList, setChatterList] = useState<string[]>([]);
  // Mobile: welche Pane sichtbar ist im Vergleichsmodus
  const [activePane, setActivePane] = useState<"primary" | "compare">("primary");
  const swipeStartXRef = useRef<number | null>(null);

  // Re-init compareWith, wenn der Caller gezielt eine Vergleichsansicht öffnet
  // (Talent, Swap, Account-Tausch). Wichtig: nicht direkt danach über chatterName
  // wieder auf null resetten.
  useEffect(() => {
    if (!open) return;
    setCompareWith(initialCompareWith ?? null);
    setActivePane("primary");
    setPickerOpen(false);
    setPickerQuery("");
  }, [open, chatterName, initialCompareWith]);

  // Models & Logins (Mail/Passwort der vom Chatter betreuten Models)
  const [chatterModels, setChatterModels] = useState<{ name: string; email: string | null; password: string | null }[]>(
    [],
  );
  const [liveProfile, setLiveProfile] = useState<{
    revenue: number | null;
    mass_dms: number | null;
    unread_chats: number | null;
    oldest_chat: number | null;
    updated_at: string | null;
    date: string | null;
  } | null>(null);
  const [isActiveToday, setIsActiveToday] = useState(false);

  // Live-Profile aus chatter_history_live laden, wenn das Panel geöffnet wird
  useEffect(() => {
    if (!open || !chatterName) {
      setLiveProfile(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("chatter_history_live")
        .select("revenue, mass_dms, unread_chats, oldest_chat, updated_at, date")
        .ilike("platform", platform)
        .ilike("chatter_name", chatterName.trim())
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      setLiveProfile(
        data
          ? {
              revenue: data.revenue ?? null,
              mass_dms: data.mass_dms ?? null,
              unread_chats: data.unread_chats ?? null,
              oldest_chat: (data as any).oldest_chat ?? null,
              updated_at: data.updated_at ?? null,
              date: data.date ?? null,
            }
          : null,
      );
      setIsActiveToday(data && data?.mass_dms > 0 ? true : false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, chatterName, platform]);

  const LABEL_COLORS = ["#EF4444", "#3B82F6", "#10B981", "#F59E0B", "#8B5CF6", "#F97316", "#EC4899", "#06B6D4"];

  // Auto-scroll to top when a new chatter is selected
  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [open, chatterName]);

  // Compare-Auswahl zurücksetzen, wenn Slide-Over schließt
  useEffect(() => {
    if (!open) {
      setCompareWith(null);
      setPickerOpen(false);
      setPickerQuery("");
    }
  }, [open]);

  // Liste aller AKTIVEN Chatter-Namen (nur die, die im neuesten Report vorkamen)
  useEffect(() => {
    if (!pickerOpen || inline) return;
    let cancelled = false;
    (async () => {
      // 1) neuestes Analyse-Datum für die Plattform finden
      const { data: latest } = await supabase
        .from("chatter_history")
        .select("analysis_date")
        .eq("platform", platform)
        .order("analysis_date", { ascending: false })
        .limit(1);
      if (cancelled) return;
      const latestDate = latest?.[0]?.analysis_date;
      if (!latestDate) {
        setChatterList([]);
        return;
      }
      // 2) alle Chatter aus diesem Report (paginiert, falls > 1000)
      const all = new Set<string>();
      const pageSize = 1000;
      let from = 0;
      while (!cancelled) {
        const { data, error } = await supabase
          .from("chatter_history")
          .select("chatter_name")
          .eq("platform", platform)
          .eq("analysis_date", latestDate)
          .range(from, from + pageSize - 1);
        if (error || !data || data.length === 0) break;
        for (const r of data) {
          const n = (r as any).chatter_name as string;
          if (n) all.add(n);
        }
        if (data.length < pageSize) break;
        from += pageSize;
      }
      if (cancelled) return;
      const uniq = Array.from(all)
        .filter((n) => n !== chatterName)
        .sort((a, b) => a.localeCompare(b, "de"));
      setChatterList(uniq);
    })();
    return () => {
      cancelled = true;
    };
  }, [pickerOpen, platform, chatterName, inline]);

  // ESC schließt den Picker
  useEffect(() => {
    if (!pickerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setPickerOpen(false);
        setPickerQuery("");
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [pickerOpen]);

  const fetchProfile = useCallback(() => {
    if (!chatterName) return;
    setLoading(true);
    Promise.all([
      supabase
        .from("chatter_history")
        .select("analysis_date, revenue_today, mass_dms, open_chats, response_delay_days")
        .eq("chatter_name", chatterName)
        .eq("platform", platform)
        .order("analysis_date", { ascending: true }),
      supabase
        .from("coaching_notes")
        .select("id, note_text, created_at")
        .eq("chatter_name", chatterName)
        .eq("platform", platform)
        .order("created_at", { ascending: false }),
      supabase
        .from("chatter_memos")
        .select("id, text, topic, follow_up_at, status, created_at")
        .eq("chatter_name", chatterName)
        .eq("platform", platform)
        .order("created_at", { ascending: false }),
    ]).then(([histRes, notesRes, memosRes]) => {
      setHistory(
        (histRes.data || []).map((r: any) => {
          const rev = Number(r.revenue_today) || 0;
          return {
            analysis_date: r.analysis_date,
            revenue_today: rev,
            mass_dms: Number(r.mass_dms) || 0,
            open_chats: Number(r.open_chats) || 0,
            response_delay_days: sanitizeDelay(Number(r.response_delay_days) || 0, rev),
          };
        }),
      );
      setNotes((notesRes.data as CoachingNote[]) || []);
      setChatterMemos((memosRes.data as ChatterMemo[]) || []);
      setLoading(false);
    });
  }, [chatterName, platform]);

  useEffect(() => {
    if (!open || !chatterName) return;
    fetchProfile();
  }, [open, chatterName, platform, fetchProfile]);

  // Auto-refresh after upload completes
  useEffect(() => {
    if (!open) return;
    return onChatterDataUpdated(() => {
      fetchProfile();
    });
  }, [open, fetchProfile]);

  // Fetch zugeordnete Models (über chatter_history.account) inkl. Logindaten
  useEffect(() => {
    if (!open || !chatterName) {
      setChatterModels([]);
      return;
    }
    let cancelled = false;
    (async () => {
      // Nur der letzte Report zählt – sonst sammeln sich alte Model-Zuordnungen an
      const { data: latestRow } = await supabase
        .from("chatter_history")
        .select("analysis_date")
        .eq("chatter_name", chatterName)
        .eq("platform", platform)
        .order("analysis_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (!latestRow?.analysis_date) {
        setChatterModels([]);
        return;
      }
      const { data: histRows } = await supabase
        .from("chatter_history")
        .select("account")
        .eq("chatter_name", chatterName)
        .eq("platform", platform)
        .eq("analysis_date", latestRow.analysis_date);
      if (cancelled) return;
      const accounts = Array.from(
        new Set(
          (histRows || [])
            .flatMap((r: any) =>
              (r.account || "")
                .split(",")
                .map((s: string) => s.trim())
                .filter((s: string) => s.length > 0),
            ),
        ),
      );
      if (accounts.length === 0) {
        setChatterModels([]);
        return;
      }

      const { data: modelRows } = await supabase
        .from("models")
        .select("model_name, email, password")
        .eq("platform", platform)
        .in("model_name", accounts);

      if (cancelled) return;
      const byName = new Map<string, { email: string | null; password: string | null }>();
      for (const m of (modelRows || []) as any[]) {
        byName.set(m.model_name, { email: m.email ?? null, password: m.password ?? null });
      }
      const list = accounts
        .map((name) => ({
          name,
          email: byName.get(name)?.email ?? null,
          password: byName.get(name)?.password ?? null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "de"));
      setChatterModels(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, chatterName, platform]);

  // Fetch labels
  useEffect(() => {
    if (!open) return;
    supabase
      .from("chatter_labels")
      .select("id, label_name, color")
      .eq("platform", platform)
      .order("created_at", { ascending: true })
      .then(({ data }) => setAllLabels((data as ChatterLabel[]) || []));

    if (!chatterName) return;
    supabase
      .from("chatter_label_assignments")
      .select("label_id")
      .eq("chatter_name", chatterName)
      .eq("platform", platform)
      .then(({ data }) => {
        setAssignedLabelIds(new Set((data || []).map((r: any) => r.label_id)));
      });
  }, [open, chatterName, platform]);

  const createLabel = async () => {
    if (!newLabelName.trim()) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase
      .from("chatter_labels")
      .insert({ user_id: user.id, platform, label_name: newLabelName.trim(), color: newLabelColor })
      .select("id, label_name, color")
      .single();
    if (error) {
      toast.error("Label konnte nicht erstellt werden.");
      return;
    }
    if (data) {
      setAllLabels((prev) => [...prev, data as ChatterLabel]);
      setNewLabelName("");
      setShowNewLabel(false);
      toast.success("Label erstellt");
    }
  };

  const toggleLabel = async (labelId: string) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const isAssigned = assignedLabelIds.has(labelId);
    if (isAssigned) {
      setAssignedLabelIds((prev) => {
        const next = new Set(prev);
        next.delete(labelId);
        return next;
      });
      await supabase
        .from("chatter_label_assignments")
        .delete()
        .eq("chatter_name", chatterName)
        .eq("platform", platform)
        .eq("label_id", labelId);
    } else {
      setAssignedLabelIds((prev) => new Set(prev).add(labelId));
      await supabase
        .from("chatter_label_assignments")
        .insert({ user_id: user.id, chatter_name: chatterName, platform, label_id: labelId });
    }
    emitChatterLabelsUpdated({ chatterName });
  };

  const deleteLabel = async (labelId: string) => {
    await supabase.from("chatter_labels").delete().eq("id", labelId);
    setAllLabels((prev) => prev.filter((l) => l.id !== labelId));
    setAssignedLabelIds((prev) => {
      const next = new Set(prev);
      next.delete(labelId);
      return next;
    });
    emitChatterLabelsUpdated({ chatterName });
    toast.success("Label gelöscht");
  };

  const saveNote = async () => {
    if (!noteText.trim()) return;
    setSavingNote(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      toast.error("Nicht eingeloggt.");
      setSavingNote(false);
      return;
    }
    const { data, error } = await supabase
      .from("coaching_notes")
      .insert({ user_id: user.id, chatter_name: chatterName, platform, note_text: noteText.trim() })
      .select("id, note_text, created_at")
      .single();
    if (error) {
      toast.error("Notiz konnte nicht gespeichert werden.");
    } else if (data) {
      setNotes((prev) => [data as CoachingNote, ...prev]);
      setNoteText("");
      toast.success("Notiz gespeichert.");
    }
    setSavingNote(false);
  };

  const saveChatterMemo = async () => {
    const text = memoInputText.trim();
    if (!text) return;
    setSavingChatterMemo(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      toast.error("Nicht eingeloggt.");
      setSavingChatterMemo(false);
      return;
    }
    let followUpAt: string | null = null;
    const days = parseInt(memoFollowupDays, 10);
    if (!isNaN(days) && days > 0) {
      const d = new Date();
      d.setDate(d.getDate() + days);
      d.setHours(8, 0, 0, 0);
      followUpAt = d.toISOString();
    }
    const { data, error } = await supabase
      .from("chatter_memos")
      .insert({
        user_id: user.id,
        chatter_name: chatterName,
        platform,
        text,
        follow_up_at: followUpAt,
      })
      .select("id, text, topic, follow_up_at, status, created_at")
      .single();
    if (error) {
      toast.error("Memo konnte nicht gespeichert werden.");
    } else if (data) {
      setChatterMemos((prev) => [data as ChatterMemo, ...prev]);
      setMemoInputText("");
      setMemoFollowupDays("");
      toast.success(followUpAt ? `Memo gespeichert · Reminder in ${days} Tagen` : "Memo gespeichert.");
    }
    setSavingChatterMemo(false);
  };

  const resolveChatterMemo = async (id: string) => {
    const { error } = await supabase
      .from("chatter_memos")
      .update({ status: "resolved", resolved_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      toast.error("Konnte nicht aktualisiert werden.");
      return;
    }
    setChatterMemos((prev) => prev.map((m) => (m.id === id ? { ...m, status: "resolved" } : m)));
  };

  const deleteChatterMemo = async (id: string) => {
    const { error } = await supabase.from("chatter_memos").delete().eq("id", id);
    if (error) {
      toast.error("Konnte nicht gelöscht werden.");
      return;
    }
    setChatterMemos((prev) => prev.filter((m) => m.id !== id));
  };




  const avgRevenue = history.length ? history.reduce((s, r) => s + r.revenue_today, 0) / history.length : 0;
  const maxRevenue = history.length ? Math.max(...history.map((r) => r.revenue_today)) : 0;
  const avgDMs = history.length ? Math.round(history.reduce((s, r) => s + r.mass_dms, 0) / history.length) : 0;
  const avgChats = history.length ? (history.reduce((s, r) => s + r.open_chats, 0) / history.length).toFixed(1) : "0";

  const avgDelay = history.length
    ? (() => {
        const withDelay = history.filter((r) => r.response_delay_days > 0);
        return withDelay.length
          ? (withDelay.reduce((s, r) => s + r.response_delay_days, 0) / withDelay.length).toFixed(1)
          : "0";
      })()
    : "0";

  const last30 = useMemo(() => history.slice(-30), [history]);
  const trend30 = useMemo(() => {
    if (last30.length < 4) return { pct: 0, direction: "stable" as const };
    const half = Math.floor(last30.length / 2);
    const first = last30.slice(0, half);
    const second = last30.slice(half);
    const avgFirst = first.reduce((s, r) => s + r.revenue_today, 0) / first.length;
    const avgSecond = second.reduce((s, r) => s + r.revenue_today, 0) / second.length;
    if (avgFirst === 0) return { pct: 0, direction: "stable" as const };
    const pct = ((avgSecond - avgFirst) / avgFirst) * 100;
    const direction = pct > 5 ? ("up" as const) : pct < -5 ? ("down" as const) : ("stable" as const);
    return { pct: Math.round(pct), direction };
  }, [last30]);

  const ghostSummary = useMemo(() => {
    if (history.length < 2) return null;
    const last7 = history.slice(-7);
    const avgC = last7.reduce((s, r) => s + r.open_chats, 0) / last7.length;
    const avgD = last7.filter((r) => r.response_delay_days > 0);
    const avgDel = avgD.length ? avgD.reduce((s, r) => s + r.response_delay_days, 0) / avgD.length : 0;
    const half = Math.floor(last7.length / 2);
    const firstHalf = last7.slice(0, half);
    const secondHalf = last7.slice(half);
    const avgFirst = firstHalf.length ? firstHalf.reduce((s, r) => s + r.open_chats, 0) / firstHalf.length : 0;
    const avgSecond = secondHalf.length ? secondHalf.reduce((s, r) => s + r.open_chats, 0) / secondHalf.length : 0;
    let trend = "Stabil";
    if (avgSecond > avgFirst * 1.1) trend = "Verschlechternd ↗";
    else if (avgSecond < avgFirst * 0.9) trend = "Verbessernd ↘";
    return { avgChats: avgC.toFixed(1), avgDelay: avgDel.toFixed(1), trend };
  }, [history]);

  const kpis = [
    { label: "Ø Tagesumsatz", value: formatCurrency(avgRevenue), icon: Coins, accent: "45 75% 55%", gold: true },
    { label: "Höchster Umsatz", value: formatCurrency(maxRevenue), icon: Trophy, accent: "45 75% 55%", gold: true },
    { label: "Ø MassDMs / Tag", value: String(avgDMs), icon: MessageSquare, accent: "212 90% 60%", gold: false },
    { label: "Ø Antwort-Verzug", value: `${avgDelay} Tage`, icon: Clock, accent: "0 84% 60%", gold: false },
  ];

  // Echtzeit-Karten (Heute) — Platzhalter: letzte verfügbare Tageswerte
  const today = history.length ? history[history.length - 1] : null;
  const todayIso = new Date().toISOString().split("T")[0];
  // const isActiveToday =
  // !!today &&
  // today.analysis_date === todayIso &&
  // ((today.revenue_today ?? 0) > 0 || (today.mass_dms ?? 0) > 0 || (today.open_chats ?? 0) > 0);
  const liveKpis = [
    {
      label: "Tagesumsatz",
      value: liveProfile && liveProfile.revenue != null ? formatCurrency(Number(liveProfile.revenue)) : "—",
      icon: Coins,
      accent: "45 75% 55%",
      gold: true,
    },
    {
      label: "MassDMs",
      value: liveProfile && liveProfile.mass_dms != null ? String(liveProfile.mass_dms) : "—",
      icon: MessageSquare,
      accent: "212 90% 60%",
      gold: false,
    },
    {
      label: "Offene Chats",
      value: liveProfile && liveProfile.unread_chats != null ? String(liveProfile.unread_chats) : "—",
      icon: MessageSquare,
      accent: "0 84% 60%",
      gold: false,
    },
    {
      label: "Ältester Chat",
      value: liveProfile && liveProfile.oldest_chat != null ? `${liveProfile.oldest_chat} days` : "—",
      icon: Clock,
      accent: "30 80% 55%",
      gold: false,
    },
  ];

  const displayName = toTitleCase(chatterName);
  const initials = useMemo(() => getInitials(chatterName), [chatterName]);
  // Kompakt-Layout für die Primär-Seite im Vergleich, damit beide Panes symmetrisch aussehen
  const compact = !!compareWith && !inline;
  const trendAccent =
    trend30.direction === "up" ? "152 70% 45%" : trend30.direction === "down" ? "0 84% 60%" : "240 5% 60%";

  const copyToClipboard = (value: string, label: string) => {
    navigator.clipboard.writeText(value).then(
      () => toast.success(`${label} kopiert`),
      () => toast.error(`${label} konnte nicht kopiert werden`),
    );
  };

  const modelsLoginsBlock =
    chatterModels.length > 0 ? (
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-[0.2em] gold-text-subtle font-medium">Models & Logins</p>
          <span className="text-[10px] text-white/25 font-light tracking-wide">
            {chatterModels.length} {chatterModels.length === 1 ? "Account" : "Accounts"}
          </span>
        </div>
        <div className="premium-card rounded-2xl divide-y divide-white/[0.05] overflow-hidden">
          {chatterModels.map((m) => (
            <ModelLoginRow key={m.name} model={m} onCopy={copyToClipboard} />
          ))}
        </div>
      </div>
    ) : null;


  const assignedLabels = useMemo(
    () => allLabels.filter((l) => assignedLabelIds.has(l.id)),
    [allLabels, assignedLabelIds],
  );

  const renderLabelsControl = (variant: "header" | "compact" = "header") => {
    const chipSize =
      variant === "compact"
        ? "px-1.5 py-0.5 text-[9px]"
        : "px-2 py-0.5 text-[10px]";
    return (
      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
        {assignedLabels.slice(0, 4).map((label) => (
          <span
            key={label.id}
            className={`inline-flex items-center gap-1 rounded-full border font-medium tracking-wide max-w-[140px] ${chipSize}`}
            style={{
              backgroundColor: label.color + "22",
              borderColor: label.color + "55",
              color: "rgba(255,255,255,0.85)",
            }}
            title={label.label_name}
          >
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: label.color }} />
            <span className="truncate">{label.label_name}</span>
          </span>
        ))}
        {assignedLabels.length > 4 && (
          <span className="text-[10px] text-white/40 font-light tabular-nums">+{assignedLabels.length - 4}</span>
        )}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={`inline-flex items-center gap-1 rounded-full border border-dashed border-white/15 text-white/45 hover:text-primary hover:border-primary/40 transition-colors font-medium tracking-wide ${chipSize}`}
              title="Labels verwalten"
            >
              <Tag className="h-2.5 w-2.5" />
              <span>{assignedLabels.length === 0 ? "Label" : "+"}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            sideOffset={8}
            className="w-72 p-3 bg-zinc-950/98 border-white/[0.08] backdrop-blur-xl z-[60]"
          >
            <div className="space-y-3">
              <p className="text-[10px] uppercase tracking-[0.2em] text-white/35 font-medium">Labels</p>
              <div className="max-h-56 overflow-y-auto space-y-0.5 -mx-1">
                {allLabels.length === 0 ? (
                  <p className="text-[11px] text-white/25 font-light text-center py-3 italic">
                    Noch keine Labels erstellt.
                  </p>
                ) : (
                  allLabels.map((label) => {
                    const isAssigned = assignedLabelIds.has(label.id);
                    return (
                      <div
                        key={label.id}
                        className="group flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors"
                      >
                        <button
                          type="button"
                          onClick={() => toggleLabel(label.id)}
                          className="flex-1 flex items-center gap-2 text-left min-w-0"
                        >
                          <span
                            className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border transition-all ${
                              isAssigned ? "border-transparent" : "border-white/20"
                            }`}
                            style={isAssigned ? { backgroundColor: label.color } : {}}
                          >
                            {isAssigned && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                          </span>
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: label.color }}
                          />
                          <span className="text-xs text-foreground/85 font-light truncate">
                            {label.label_name}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (
                              window.confirm(
                                `Label "${label.label_name}" workspace-weit löschen? Dies entfernt es bei allen Chattern.`,
                              )
                            ) {
                              deleteLabel(label.id);
                            }
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded text-white/30 hover:text-red-400 transition-all shrink-0"
                          title="Label workspace-weit löschen"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
              <div className="border-t border-white/[0.06] pt-3">
                {!showNewLabel ? (
                  <button
                    type="button"
                    onClick={() => setShowNewLabel(true)}
                    className="w-full text-[11px] text-primary/75 hover:text-primary flex items-center justify-center gap-1 py-1.5 rounded-lg hover:bg-primary/[0.06] transition-colors font-medium tracking-wide"
                  >
                    <Plus className="h-3 w-3" /> Neues Label
                  </button>
                ) : (
                  <div className="space-y-2">
                    <input
                      value={newLabelName}
                      onChange={(e) => setNewLabelName(e.target.value)}
                      placeholder="Label-Name"
                      autoFocus
                      className="w-full bg-white/[0.03] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-foreground/85 font-light placeholder:text-white/20 focus:outline-none focus:border-primary/30"
                      onKeyDown={(e) => e.key === "Enter" && createLabel()}
                    />
                    <div className="flex gap-1.5">
                      {LABEL_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setNewLabelColor(c)}
                          className={`w-5 h-5 rounded-full border-2 transition-all ${
                            newLabelColor === c
                              ? "border-white/70 scale-110"
                              : "border-transparent opacity-60 hover:opacity-100"
                          }`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={createLabel}
                        disabled={!newLabelName.trim()}
                        className="flex-1 py-1.5 rounded-lg bg-primary/12 border border-primary/25 text-primary text-[11px] font-medium hover:bg-primary/18 transition-all disabled:opacity-25 disabled:cursor-not-allowed"
                      >
                        Erstellen
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowNewLabel(false);
                          setNewLabelName("");
                        }}
                        className="px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.08] text-white/55 text-[11px] hover:bg-white/[0.06] transition-colors"
                      >
                        Abbrechen
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    );
  };



  if (inline || splitView) {
    if (!open) return null;
    // Inline/Split mode: compact two-pane layout, reused for the Today comparison view.
    return (
      <div
        className={`${splitView ? "fixed inset-y-0 right-0 z-50 w-1/2 shadow-[-20px_0_60px_-15px_rgba(0,0,0,0.6)]" : "h-full"} min-h-0 flex flex-col border-l border-white/[0.06] bg-zinc-950 backdrop-blur-3xl`}
      >
        {/* ── Hero Header ── */}
        <div className="flex items-center gap-3 px-4 sm:px-6 py-3 sm:py-4 border-b border-white/[0.06] bg-zinc-950 z-10 shrink-0">
          <div
            className="premium-stat flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-light tracking-wide text-primary/80"
            style={{ filter: "drop-shadow(0 0 8px hsl(40 50% 60% / 0.15))" }}
          >
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <h2
              onClick={() => {
                navigator.clipboard.writeText(displayName);
                toast.success("Name kopiert");
              }}
              className="text-lg font-extralight tracking-tight gold-text cursor-pointer hover:opacity-70 transition-opacity duration-200 truncate"
              title="Klicken zum Kopieren"
            >
              {displayName}
            </h2>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-[10px] gold-text-subtle font-medium tracking-[0.2em] uppercase">{platform} · Profil</p>
              {trend30.direction !== "stable" && (
                <span
                  className={`premium-chip inline-flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded-md ${
                    trend30.direction === "up"
                      ? "text-emerald-300 bg-emerald-500/10 border border-emerald-500/20"
                      : "text-red-300 bg-red-500/10 border border-red-500/20"
                  }`}
                >
                  {trend30.direction === "up" ? (
                    <TrendingUp className="h-2.5 w-2.5" />
                  ) : (
                    <TrendingDown className="h-2.5 w-2.5" />
                  )}
                  {trend30.pct > 0 ? "+" : ""}
                  {trend30.pct}%
                </span>
              )}
            </div>
            <div className="mt-1.5">{renderLabelsControl("compact")}</div>
          </div>
          {splitView && (
            <button
              onClick={onClose}
              aria-label="Schließen"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white/55 hover:bg-white/[0.06] hover:text-white transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar-none">
          {loading ? (
            <div className="p-4 sm:p-6 pb-16">
              <ProfileSkeleton compact />
            </div>
          ) : history.length === 0 && !liveProfile ? (
            <div className="p-4 sm:p-6">
              <p className="text-center text-white/25 font-light py-20 text-sm tracking-wide italic">
                Noch keine Daten vorhanden.
              </p>
            </div>
          ) : (
            <div className="p-4 sm:p-6 pb-16 space-y-6 sm:space-y-8">
              {modelsLoginsBlock}

              {/* Live KPI Grid — compact horizontal strip */}
              <LiveKpiStrip liveKpis={liveKpis} isActiveToday={isActiveToday} compact />

              {/* 30-Tage-Trend — compact sparkline */}
              <Trend30Block last30={last30} trend30={trend30} compact gradientId="trend30FillInline" />

              {/* KPI Grid */}
              <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
                {kpis.map((kpi) => {
                  const Icon = kpi.icon;
                  return (
                    <div
                      key={kpi.label}
                      className="premium-card premium-card-interactive rounded-xl p-3 sm:p-4 min-w-0"
                    >
                      <div className="flex items-center gap-1.5">
                        <Icon className="h-3 w-3" style={{ color: `hsl(${kpi.accent} / 0.7)` }} />
                        <p className="text-[9px] sm:text-[10px] uppercase tracking-[0.16em] sm:tracking-[0.2em] text-white/45 font-medium leading-snug truncate">
                          {kpi.label}
                        </p>
                      </div>
                      <p
                        className={`text-base sm:text-lg font-extralight mt-1.5 tracking-tight tabular-nums ${kpi.gold ? "gold-text" : "text-foreground/85"}`}
                      >
                        {kpi.value}
                      </p>
                    </div>
                  );
                })}
              </div>



              {/* Notes — direkt unter Labels */}
              <div className="space-y-4">

                <p className="text-[10px] uppercase tracking-[0.2em] text-white/25 font-light">Management-Logbuch</p>
                <div className="flex gap-2">
                  <textarea
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Was wurde heute besprochen?"
                    rows={2}
                    className="flex-1 bg-white/[0.03] border border-white/[0.06] rounded-xl px-3 py-2.5 text-sm text-foreground/80 font-light placeholder:text-white/15 resize-none focus:outline-none focus:border-primary/20 transition-colors duration-300"
                  />
                  <button
                    onClick={saveNote}
                    disabled={savingNote || !noteText.trim()}
                    className="self-end px-3 py-2.5 rounded-xl bg-primary/10 border border-primary/20 text-primary hover:bg-primary/15 transition-all duration-300 disabled:opacity-20 disabled:cursor-not-allowed"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>
                {notes.length > 0 && (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {notes.map((n) => (
                      <div key={n.id} className="rounded-xl bg-white/[0.015] border border-white/[0.04] px-3 py-2.5">
                        <p className="text-xs text-foreground/70 font-light leading-relaxed">{n.note_text}</p>
                        <p className="text-[10px] text-white/20 font-light mt-1.5">{formatDateTime(n.created_at)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Vereinbarungen & Reminder — chatter_memos */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-white/25 font-light">Vereinbarungen · Reminder</p>
                  {chatterMemos.filter((m) => m.status === "open").length > 0 && (
                    <span className="text-[10px] text-white/40 font-light">
                      {chatterMemos.filter((m) => m.status === "open").length} offen
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <textarea
                    value={memoInputText}
                    onChange={(e) => setMemoInputText(e.target.value)}
                    placeholder='z.B. "Bekommt noch 2 Tage zum Hochfahren Mass-DMs"'
                    rows={2}
                    className="flex-1 bg-white/[0.03] border border-white/[0.06] rounded-xl px-3 py-2.5 text-sm text-foreground/80 font-light placeholder:text-white/15 resize-none focus:outline-none focus:border-primary/20 transition-colors duration-300"
                  />
                  <div className="flex flex-col gap-1.5">
                    <input
                      type="number"
                      min={0}
                      max={60}
                      value={memoFollowupDays}
                      onChange={(e) => setMemoFollowupDays(e.target.value)}
                      placeholder="d"
                      title="Reminder in X Tagen (optional)"
                      className="w-12 bg-white/[0.03] border border-white/[0.06] rounded-lg px-2 py-1.5 text-sm text-foreground/80 font-light placeholder:text-white/15 text-center focus:outline-none focus:border-primary/20"
                    />
                    <button
                      onClick={saveChatterMemo}
                      disabled={savingChatterMemo || !memoInputText.trim()}
                      className="px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20 text-primary hover:bg-primary/15 transition-all duration-300 disabled:opacity-20 disabled:cursor-not-allowed"
                    >
                      <Send className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {chatterMemos.length > 0 && (
                  <div className="space-y-2 max-h-56 overflow-y-auto">
                    {chatterMemos.map((m) => {
                      const isResolved = m.status === "resolved";
                      const due = m.follow_up_at ? new Date(m.follow_up_at) : null;
                      const now = new Date();
                      const overdue = due && !isResolved && due.getTime() < now.getTime();
                      const daysLeft = due
                        ? Math.ceil((due.getTime() - now.getTime()) / 86400000)
                        : null;
                      return (
                        <div
                          key={m.id}
                          className={`group rounded-xl px-3 py-2.5 border ${
                            isResolved
                              ? "bg-white/[0.01] border-white/[0.03] opacity-50"
                              : overdue
                                ? "bg-amber-500/[0.04] border-amber-500/20"
                                : "bg-white/[0.02] border-white/[0.05]"
                          }`}
                        >
                          <p
                            className={`text-xs font-light leading-relaxed ${
                              isResolved ? "line-through text-white/30" : "text-foreground/80"
                            }`}
                          >
                            {m.text}
                          </p>
                          <div className="flex items-center justify-between mt-2">
                            <div className="flex items-center gap-2 text-[10px] font-light">
                              <span className="text-white/25">{formatDateTime(m.created_at)}</span>
                              {due && (
                                <span
                                  className={
                                    isResolved
                                      ? "text-white/25"
                                      : overdue
                                        ? "text-amber-300"
                                        : daysLeft !== null && daysLeft <= 1
                                          ? "text-amber-300/80"
                                          : "text-primary/70"
                                  }
                                >
                                  ·{" "}
                                  {overdue
                                    ? `Frist abgelaufen (${Math.abs(daysLeft!)}d)`
                                    : daysLeft === 0
                                      ? "heute fällig"
                                      : daysLeft === 1
                                        ? "morgen fällig"
                                        : `in ${daysLeft}d fällig`}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              {!isResolved && (
                                <button
                                  onClick={() => resolveChatterMemo(m.id)}
                                  className="text-[10px] px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 hover:bg-emerald-500/15"
                                >
                                  ✓ Erledigt
                                </button>
                              )}
                              <button
                                onClick={() => deleteChatterMemo(m.id)}
                                className="text-[10px] px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.06] text-white/40 hover:bg-white/[0.08]"
                              >
                                Löschen
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>


              {/* Online-Zeiten (Stunden-Profil) */}
              <ChatterActivityHoursCard chatterName={chatterName} platform={platform} compact />


            </div>
          )}
        </div>
      </div>
    );
  }

  // Doppel-Tipp irgendwo im Slide-Over schließt es
  const handleDoubleTapClose = (e: React.PointerEvent) => {
    // Ignoriere Tipps auf interaktive Elemente (Buttons, Inputs, Links)
    const target = e.target as HTMLElement;
    if (target.closest("button, input, textarea, select, a, [role='button'], [contenteditable='true']")) {
      lastTapRef.current = 0;
      return;
    }
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      lastTapRef.current = 0;
      onClose();
    } else {
      lastTapRef.current = now;
    }
  };

  const slideOverContent = (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={{ x: 40, opacity: 0 }}
          animate={{
            x: 0,
            opacity: 1,
            width: splitView ? "50vw" : compareWith ? "100vw" : "min(100vw, 520px)",
            left: splitView ? "50vw" : compareWith ? 0 : "auto",
          }}
          exit={{ x: 40, opacity: 0 }}
          transition={{
            x: { type: "spring", damping: 32, stiffness: 280 },
            opacity: { duration: 0.35, ease: [0.22, 1, 0.36, 1] },
            width: { duration: 0.65, ease: [0.32, 0.72, 0, 1] },
            left: { duration: 0.65, ease: [0.32, 0.72, 0, 1] },
          }}
          onPointerDown={handleDoubleTapClose}
          style={{ willChange: "width, left, transform", backfaceVisibility: "hidden", touchAction: "pan-y" }}
          className="fixed inset-y-0 right-0 z-50 border-l border-white/[0.06] bg-zinc-950/[0.97] backdrop-blur-xl shadow-[-20px_0_60px_-15px_rgba(0,0,0,0.6)] flex flex-col overscroll-contain"
        >
          {/* ── Hero Header (sticky, mit safe-area expanded Hit-Area für Close) ── */}
          <div
            className={`sticky top-0 z-30 flex items-center gap-3 sm:gap-4 ${splitView ? "px-4 pb-3" : compact ? "px-4 sm:px-6 pb-3 sm:pb-4 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)] sm:pt-4" : "px-5 sm:px-10 pb-4 sm:py-5"} border-b border-white/[0.06] bg-zinc-950/95 backdrop-blur-xl shrink-0`}
            style={compact ? undefined : { paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.75rem)" }}
          >

            {compact ? (
              // Im Vergleich sitzt der Primär-Name unten in der linken Spalte (symmetrisch zur rechten Compare-Seite)
              <div className="flex-1 min-w-0" />
            ) : (
              <>
                <div
                  className={`premium-stat flex ${compact ? "h-11 w-11 text-sm" : "h-12 w-12 sm:h-14 sm:w-14 text-base sm:text-lg"} shrink-0 items-center justify-center rounded-2xl font-light tracking-wide text-primary/85`}
                  style={{ filter: "drop-shadow(0 0 10px hsl(40 50% 60% / 0.18))" }}
                >
                  {initials}
                </div>
                <div className="min-w-0 flex-1">
                  <h2
                    onClick={() => {
                      navigator.clipboard.writeText(displayName);
                      toast.success("Name kopiert");
                    }}
                    className={`${compact ? "text-lg" : "text-xl sm:text-[26px]"} font-extralight tracking-tight gold-text cursor-pointer hover:opacity-70 transition-opacity duration-200 truncate`}
                    title="Klicken zum Kopieren"
                  >
                    {displayName}
                  </h2>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-[10px] gold-text-subtle font-medium tracking-[0.2em] uppercase">
                      {platform} · Profil
                    </p>
                    {trend30.direction !== "stable" && (
                      <span
                        className={`premium-chip inline-flex items-center gap-0.5 text-[10px] font-medium px-2 py-0.5 rounded-md tabular-nums ${
                          trend30.direction === "up"
                            ? "text-emerald-300 bg-emerald-500/10 border border-emerald-500/25"
                            : "text-red-300 bg-red-500/10 border border-red-500/25"
                        }`}
                      >
                        {trend30.direction === "up" ? (
                          <TrendingUp className="h-2.5 w-2.5" />
                        ) : (
                          <TrendingDown className="h-2.5 w-2.5" />
                        )}
                        {trend30.pct > 0 ? "+" : ""}
                        {trend30.pct}% / 30T
                      </span>
                    )}
                  </div>
                  <div className="mt-2">{renderLabelsControl("header")}</div>
                </div>
              </>
            )}

            {/* Vergleichen-mit Button (nur im non-inline Mode) — icon-only, spart Platz für Name */}
            {!inline && (
              <button
                type="button"
                onClick={() => {
                  if (compareWith) setCompareWith(null);
                  else setPickerOpen(true);
                }}
                title={compareWith ? "Vergleich beenden" : "Mit anderem Chatter vergleichen"}
                className={`premium-chip shrink-0 inline-flex items-center justify-center h-11 w-11 rounded-xl border transition-all duration-300 active:scale-[0.97] ${
                  compareWith
                    ? "border-primary/30 bg-primary/[0.08] text-primary hover:bg-primary/[0.12]"
                    : "border-white/[0.08] bg-white/[0.02] text-white/55 hover:text-primary hover:border-primary/25 hover:bg-primary/[0.04]"
                }`}
              >
                <GitCompareArrows className="h-4 w-4" />
              </button>
            )}

            {/* Close-Button: 44x44px (Apple HIG), erweiterte Hit-Area über safe-area */}
            <button
              onClick={onClose}
              aria-label="Schließen"
              className="relative flex items-center justify-center h-11 w-11 rounded-xl hover:bg-white/[0.05] active:bg-white/[0.08] text-white/55 hover:text-white transition-colors duration-200 shrink-0 active:scale-[0.95]"
            >
              {/* Unsichtbare Hit-Area-Erweiterung nach oben in die safe-area */}
              <span
                aria-hidden
                className="absolute inset-x-[-8px] bottom-0 -top-3"
                style={{ marginTop: "calc(-1 * env(safe-area-inset-top, 0px))" }}
              />
              <X className="h-5 w-5 relative" />
            </button>
          </div>

          {/* Mobile Switcher: nur im Vergleichsmodus, segmentierte Pills für Pane-Wechsel */}
          {compareWith && !inline && (
            <div className="sm:hidden sticky top-[64px] z-20 px-4 py-2 bg-zinc-950/95 backdrop-blur-xl border-b border-white/[0.06] flex items-center gap-2">
              <button
                onClick={() => setActivePane("primary")}
                className={`flex-1 h-10 rounded-xl text-[12px] font-medium tracking-wide transition-all active:scale-[0.97] truncate px-3 ${
                  activePane === "primary"
                    ? "bg-primary/15 border border-primary/40 text-foreground"
                    : "bg-white/[0.03] border border-white/10 text-white/55"
                }`}
              >
                {displayName}
              </button>
              <button
                onClick={() => setActivePane("compare")}
                className={`flex-1 h-10 rounded-xl text-[12px] font-medium tracking-wide transition-all active:scale-[0.97] truncate px-3 ${
                  activePane === "compare"
                    ? "bg-primary/15 border border-primary/40 text-foreground"
                    : "bg-white/[0.03] border border-white/10 text-white/55"
                }`}
              >
                {compareWith}
              </button>
            </div>
          )}

          <div
            className={`flex-1 min-h-0 flex ${compareWith ? "flex-col sm:flex-row sm:divide-x sm:divide-white/[0.06]" : "flex-col"}`}
            onPointerDown={(e) => {
              if (!compareWith || inline) return;
              if (window.innerWidth >= 640) return;
              swipeStartXRef.current = e.clientX;
            }}
            onPointerUp={(e) => {
              if (!compareWith || inline) return;
              if (window.innerWidth >= 640) return;
              const startX = swipeStartXRef.current;
              if (typeof startX !== "number") return;
              const dx = e.clientX - startX;
              if (Math.abs(dx) >= 120) {
                setActivePane(dx < 0 ? "compare" : "primary");
              }
              swipeStartXRef.current = null;
            }}
          >
            <motion.div
              ref={scrollRef}
              animate={{ flexBasis: compareWith ? "50%" : "100%" }}
              transition={{ duration: 0.65, ease: [0.32, 0.72, 0, 1] }}
              className={`${compareWith ? `sm:flex-shrink-0 sm:flex-grow-0 sm:min-w-0 ${activePane === "primary" ? "flex-1" : "hidden sm:block"}` : "flex-1"} overflow-y-auto overflow-x-hidden scrollbar-none`}
              style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 80px)", willChange: "flex-basis" }}
            >
              {compact && (
                <div className="flex items-center gap-3 px-4 sm:px-6 py-3 sm:py-4 border-b border-white/[0.06] bg-zinc-950 z-10 shrink-0">
                  <div
                    className="premium-stat flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-light tracking-wide text-primary/80"
                    style={{ filter: "drop-shadow(0 0 8px hsl(40 50% 60% / 0.15))" }}
                  >
                    {initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2
                      onClick={() => {
                        navigator.clipboard.writeText(displayName);
                        toast.success("Name kopiert");
                      }}
                      className="text-lg font-extralight tracking-tight gold-text cursor-pointer hover:opacity-70 transition-opacity duration-200 truncate"
                      title="Klicken zum Kopieren"
                    >
                      {displayName}
                    </h2>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-[10px] gold-text-subtle font-medium tracking-[0.2em] uppercase">
                        {platform} · Profil
                      </p>
                      {trend30.direction !== "stable" && (
                        <span
                          className={`premium-chip inline-flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded-md ${
                            trend30.direction === "up"
                              ? "text-emerald-300 bg-emerald-500/10 border border-emerald-500/20"
                              : "text-red-300 bg-red-500/10 border border-red-500/20"
                          }`}
                        >
                          {trend30.direction === "up" ? (
                            <TrendingUp className="h-2.5 w-2.5" />
                          ) : (
                            <TrendingDown className="h-2.5 w-2.5" />
                          )}
                          {trend30.pct > 0 ? "+" : ""}
                          {trend30.pct}%
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5">{renderLabelsControl("compact")}</div>
                  </div>
                </div>
              )}
              <div className={`${splitView ? "p-4 space-y-6" : compact ? "p-4 sm:p-6 space-y-6 sm:space-y-8" : "p-5 sm:p-10 space-y-8 sm:space-y-12"} pb-16`}>
                {loading ? (
                  <ProfileSkeleton />
                ) : history.length === 0 && !liveProfile ? (
                  <p className="text-center text-white/25 font-light py-20 text-sm tracking-wide italic">
                    Noch keine Daten vorhanden.
                  </p>
                ) : (
                  <>
                    {modelsLoginsBlock}

                    {/* ── Live KPI Grid (Echtzeit) — compact strip ── */}
                    <LiveKpiStrip liveKpis={liveKpis} isActiveToday={isActiveToday} compact={compact} />

                    {/* ── 30-Tage-Trend ── */}
                    <Trend30Block last30={last30} trend30={trend30} compact={compact} gradientId="trend30Fill" />

                    {/* ── 2. KPI Grid (2×2) ── */}
                    <div className="grid grid-cols-2 gap-4">
                      {kpis.map((kpi) => {
                        const Icon = kpi.icon;
                        return (
                          <div key={kpi.label} className={`premium-card premium-card-interactive rounded-xl ${compact ? "p-3 sm:p-4" : "p-4"}`}>
                            <div className="flex items-center gap-1.5">
                              <Icon className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} style={{ color: `hsl(${kpi.accent} / 0.75)` }} />
                              <p className={`${compact ? "text-[9px] sm:text-[10px] tracking-[0.16em] sm:tracking-[0.2em]" : "text-[10px] tracking-[0.2em]"} uppercase text-white/45 font-medium truncate`}>
                                {kpi.label}
                              </p>
                            </div>
                            <p
                              className={`${compact ? "text-base sm:text-lg mt-1.5" : "text-lg mt-1.5"} font-extralight tracking-tight tabular-nums ${kpi.gold ? "gold-text" : "text-foreground/85"}`}
                            >
                              {kpi.value}
                            </p>
                          </div>
                        );
                      })}
                    </div>


                    {/* ── Postfach-Disziplin ── */}
                    <div className="space-y-5">
                      <p className="text-[10px] uppercase tracking-[0.2em] gold-text-subtle font-medium">
                        Postfach-Disziplin
                      </p>
                      <div className="premium-card rounded-2xl p-7">
                        <ResponsiveContainer width="100%" height={170}>
                          <AreaChart data={history}>
                            <defs>
                              <linearGradient id="ghostFill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#E25822" stopOpacity={0.28} />
                                <stop offset="100%" stopColor="#E25822" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <XAxis
                              dataKey="analysis_date"
                              tickFormatter={formatDate}
                              axisLine={false}
                              tickLine={false}
                              tick={{ fill: "rgba(255,255,255,0.35)", fontSize: 10 }}
                            />
                            <YAxis
                              axisLine={false}
                              tickLine={false}
                              tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }}
                              width={30}
                            />
                            <Tooltip content={<GhostChatTooltip />} cursor={{ stroke: "rgba(226,88,34,0.2)" }} />
                            <Area
                              type="monotone"
                              dataKey="open_chats"
                              stroke="#E25822"
                              strokeWidth={2}
                              fill="url(#ghostFill)"
                              dot={false}
                              activeDot={{ r: 4, fill: "#E25822", stroke: "rgba(226,88,34,0.4)", strokeWidth: 6 }}
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                      {ghostSummary && (
                        <div className="premium-card rounded-xl p-5">
                          <p className="text-xs text-white/55 font-light leading-relaxed tracking-wide">
                            Letzte 7 Tage: Ø{" "}
                            <span className="font-medium tabular-nums" style={{ color: "#E25822" }}>
                              {ghostSummary.avgChats} Chats
                            </span>{" "}
                            offen,{" "}
                            <span className="font-medium tabular-nums" style={{ color: "#E25822" }}>
                              {ghostSummary.avgDelay} Tage
                            </span>{" "}
                            Verzug. Trend: <span className="font-medium text-white/80">{ghostSummary.trend}</span>
                          </p>
                        </div>
                      )}
                    </div>



                    {/* ── Online-Zeiten (Stunden-Profil) ── */}
                    <ChatterActivityHoursCard chatterName={chatterName} platform={platform} />

                    {/* ── Management-Logbuch ── */}
                    <div className="space-y-5">
                      <p className="text-[10px] uppercase tracking-[0.2em] gold-text-subtle font-medium">
                        Management-Logbuch
                      </p>
                      <div className="flex gap-3">
                        <textarea
                          value={noteText}
                          onChange={(e) => setNoteText(e.target.value)}
                          placeholder="Was wurde heute besprochen?"
                          rows={2}
                          className="premium-card flex-1 rounded-xl px-4 py-3 text-sm text-foreground/85 font-light placeholder:text-white/25 resize-none focus:outline-none focus:border-primary/30 transition-colors duration-300"
                        />
                        <button
                          onClick={saveNote}
                          disabled={savingNote || !noteText.trim()}
                          className="premium-chip self-end px-4 py-3 rounded-xl bg-primary/12 border border-primary/25 text-primary hover:bg-primary/18 transition-all duration-300 disabled:opacity-25 disabled:cursor-not-allowed active:scale-[0.97]"
                        >
                          <Send className="h-4 w-4" />
                        </button>
                      </div>
                      {notes.length > 0 && (
                        <div className="space-y-2 max-h-60 overflow-y-auto">
                          {notes.map((n) => (
                            <div key={n.id} className="premium-card rounded-xl px-4 py-3">
                              <p className="text-xs text-foreground/80 font-light leading-relaxed">{n.note_text}</p>
                              <p className="text-[10px] text-white/30 font-light mt-2 tracking-wide">
                                {formatDateTime(n.created_at)}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>



                    {/* ── 6. Verlauf-Tabelle ── */}
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.2em] gold-text-subtle font-medium mb-5">
                        Verlauf
                      </p>
                      <div className="premium-card rounded-xl overflow-hidden">
                        <div className="grid grid-cols-3 sm:grid-cols-5 px-3 sm:px-5 py-3 border-b border-white/[0.06]">
                          {["Datum", "Umsatz", "DMs"].map((h) => (
                            <span
                              key={h}
                              className="text-[10px] uppercase tracking-[0.2em] gold-text-subtle font-medium"
                            >
                              {h}
                            </span>
                          ))}
                          {["Chats", "Verzug"].map((h) => (
                            <span
                              key={h}
                              className="text-[10px] uppercase tracking-[0.2em] gold-text-subtle font-medium hidden sm:block"
                            >
                              {h}
                            </span>
                          ))}
                        </div>
                        {[...history].reverse().map((row, i) => (
                          <div
                            key={i}
                            className="row-accent grid grid-cols-3 sm:grid-cols-5 px-3 sm:px-5 py-3 border-b border-white/[0.03] last:border-0"
                          >
                            <span className="text-xs text-white/55 font-light tabular-nums">
                              {formatDate(row.analysis_date)}
                            </span>
                            <span className="text-xs font-light gold-text tabular-nums">
                              {formatCurrency(row.revenue_today)}
                            </span>
                            <span className="text-xs text-white/50 font-light tabular-nums">{row.mass_dms}</span>
                            <span className="text-xs text-white/50 font-light hidden sm:block tabular-nums">
                              {row.open_chats}
                            </span>
                            <span
                              className={`text-xs font-light hidden sm:block tabular-nums ${row.response_delay_days > 0 ? "text-[#E25822]/85" : "text-white/25"}`}
                            >
                              {row.response_delay_days > 0 ? `${row.response_delay_days}d` : "—"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </motion.div>
            <AnimatePresence>
              {compareWith && (
                <motion.div
                  key="compare-pane"
                  initial={{ opacity: 0, x: 32 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 32 }}
                  transition={{
                    opacity: { duration: 0.5, ease: [0.32, 0.72, 0, 1], delay: 0.25 },
                    x: { duration: 0.6, ease: [0.32, 0.72, 0, 1], delay: 0.25 },
                  }}
                  style={{ willChange: "transform, opacity", backfaceVisibility: "hidden" }}
                  className={`sm:flex-1 sm:min-w-0 sm:max-w-[50%] sm:block ${activePane === "compare" ? "flex-1 min-h-0" : "hidden"} overflow-hidden`}
                >
                  <ChatterSlideOver
                    inline
                    open
                    chatterName={compareWith}
                    platform={platform}
                    onClose={() => setCompareWith(null)}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Floating-Close-Pill — immer erreichbar auf Mobile, auch wenn der Header verdeckt ist */}
          <button
            onClick={onClose}
            aria-label="Schließen"
            className="sm:hidden fixed right-4 z-40 inline-flex items-center gap-1.5 h-11 px-4 rounded-full bg-zinc-900/95 backdrop-blur-xl border border-white/15 text-white/80 text-xs font-medium shadow-[0_8px_24px_-8px_rgba(0,0,0,0.6)] active:scale-95 transition-transform"
            style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}
          >
            <X className="h-4 w-4" />
            Schließen
          </button>
        </motion.aside>
      )}
      {open &&
        !inline &&
        pickerOpen &&
        (() => {
          const filtered = chatterList.filter(
            (n) => !pickerQuery.trim() || n.toLowerCase().includes(pickerQuery.toLowerCase()),
          );
          return (
            <motion.div
              key="cmp-modal"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="fixed inset-0 z-[60] flex items-start justify-center px-4 sm:pt-[12vh] pt-[8vh]"
              style={{
                background:
                  "radial-gradient(ellipse 80% 60% at 50% 30%, hsl(40 30% 12% / 0.5) 0%, hsl(0 0% 0% / 0.78) 70%)",
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
              }}
              onClick={() => {
                setPickerOpen(false);
                setPickerQuery("");
              }}
            >
              <motion.div
                initial={{ opacity: 0, y: -10, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.98, transition: { duration: 0.14 } }}
                transition={{ type: "spring", damping: 26, stiffness: 320 }}
                onClick={(e) => e.stopPropagation()}
                className="premium-card gold-glow-sm w-full max-w-[480px] max-h-[70vh] rounded-2xl flex flex-col overflow-hidden"
              >
                {/* Goldener Akzent-Strich oben */}
                <span
                  aria-hidden
                  className="absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-primary/55 to-transparent"
                />

                {/* Header */}
                <div className="px-6 pt-5 pb-4 border-b border-white/[0.05] shrink-0">
                  <p className="text-[10px] uppercase tracking-[0.25em] gold-text-subtle font-medium">
                    Vergleichen mit
                  </p>
                  <p className="text-[11px] text-white/35 font-light mt-1 tracking-wide">
                    Wähle einen zweiten Chatter für direkten Vergleich
                  </p>
                  <div className="mt-4 flex items-center gap-2.5 px-3.5 h-11 rounded-xl bg-white/[0.025] border border-white/[0.06] focus-within:border-primary/30 focus-within:bg-white/[0.04] transition-colors">
                    <Search className="h-4 w-4 text-white/35 shrink-0" />
                    <input
                      autoFocus
                      value={pickerQuery}
                      onChange={(e) => setPickerQuery(e.target.value)}
                      placeholder="Chatter suchen…"
                      className="flex-1 bg-transparent text-sm text-foreground/90 font-light placeholder:text-white/25 focus:outline-none"
                    />
                    <kbd className="hidden sm:inline-flex items-center px-1.5 h-5 rounded text-[9px] font-medium text-white/35 bg-white/[0.04] border border-white/[0.06] tracking-wider">
                      ESC
                    </kbd>
                  </div>
                </div>

                {/* Liste */}
                <div className="flex-1 min-h-0 overflow-y-auto scrollbar-none py-2 px-2">
                  {chatterList.length === 0 ? (
                    <div className="flex items-center justify-center gap-2 py-12 text-xs text-white/30 font-light">
                      <span className="h-3 w-3 rounded-full border border-white/15 border-t-primary/60 animate-spin" />
                      Lade Chatter…
                    </div>
                  ) : filtered.length === 0 ? (
                    <p className="px-3 py-12 text-center text-xs text-white/30 font-light italic tracking-wide">
                      Keine Treffer
                    </p>
                  ) : (
                    filtered.slice(0, 200).map((n) => {
                      const init = getInitials(n);
                      return (
                        <button
                          key={n}
                          type="button"
                          onClick={() => {
                            setCompareWith(n);
                            setPickerOpen(false);
                            setPickerQuery("");
                          }}
                          className="group/row w-full flex items-center gap-3 text-left px-3 py-2.5 rounded-xl hover:bg-white/[0.035] transition-all duration-200"
                        >
                          <span className="premium-stat flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[11px] font-light tracking-wide text-primary/75 group-hover/row:text-primary transition-colors">
                            {init}
                          </span>
                          <span className="flex-1 min-w-0 text-sm text-foreground/80 font-light tracking-tight truncate group-hover/row:text-foreground transition-colors">
                            {toTitleCase(n)}
                          </span>
                          <GitCompareArrows className="h-3.5 w-3.5 text-white/15 group-hover/row:text-primary/65 transition-colors" />
                        </button>
                      );
                    })
                  )}
                </div>

                {/* Footer-Hint */}
                <div className="px-6 py-3 border-t border-white/[0.05] shrink-0 flex items-center justify-between text-[10px] text-white/30 font-light tracking-wide">
                  <span>
                    {filtered.length} {filtered.length === 1 ? "Chatter" : "Chatter"}
                  </span>
                  <span>Klick zum Vergleichen</span>
                </div>
              </motion.div>
            </motion.div>
          );
        })()}
    </AnimatePresence>
  );

  return typeof document !== "undefined" ? createPortal(slideOverContent, document.body) : slideOverContent;
}
