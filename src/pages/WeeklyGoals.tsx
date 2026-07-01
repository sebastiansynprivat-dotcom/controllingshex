/**
 * Monatsziele-Dashboard.
 *
 * Listet alle Chatter mit Label "Monatsziel" und extrahiert das Ziel aus der
 * neuesten Coaching-Notiz, die eine Zahl enthält. Zeigt pro Chatter:
 *  - Monatsziel (EUR)
 *  - Aktueller Monatsumsatz
 *  - Soll-Tagesumsatz, benötigter Ø bis Monatsende
 *  - On-Track-Status (grün / amber / rot)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Target, Sparkles, TrendingUp, TrendingDown, Loader2, Check, X, Pencil, MessageSquare, FileText, Trash2 } from "lucide-react";
import GoalMessageDialog from "@/components/GoalMessageDialog";
import BulkGoalMessagesDialog, { type BulkTarget } from "@/components/BulkGoalMessagesDialog";
import GoalMessageTemplatesDialog from "@/components/GoalMessageTemplatesDialog";

import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { usePlatform } from "@/contexts/PlatformContext";
import ChatterSlideOver from "@/components/ChatterSlideOver";
import PastWeeklyGoalsTab from "@/components/PastWeeklyGoalsTab";
import {
  parseGoalFromNote,
  computeWeekProgress as computeGoalProgress,
  formatEUR,
  suggestWeeklyGoal,
  splitAccounts,
  computeModelBaselines,
  nextWeekLabel,
  parseTargetWeek,
  weekStart,
  isoWeekNumber,
  type WeekProgress as GoalProgress,
  type GoalStatus,
} from "@/lib/weekly-goals";

const LABEL_NAME = "Wochenziel";

function toIsoDateLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromIsoDateLocal(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}


interface ChatterGoalRow {
  chatter: string;
  noteText: string;
  noteDate: string;
  progress: GoalProgress;
}

type SortKey = "deficit" | "progress" | "goal" | "name";

function StatusBadge({ status }: { status: GoalProgress["status"] }) {
  const map = {
    on_track: { label: "On Track", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-400/30" },
    close:    { label: "Knapp",    cls: "bg-amber-500/15 text-amber-300 border-amber-400/30" },
    off_track:{ label: "Off Track",cls: "bg-red-500/15 text-red-300 border-red-400/30" },
  } as const;
  const { label, cls } = map[status];
  return (
    <span className={`text-[10px] uppercase tracking-[0.18em] px-2 py-0.5 rounded-full border font-medium ${cls}`}>
      {label}
    </span>
  );
}

function ProgressBar({ pct, status }: { pct: number; status: GoalProgress["status"] }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const color =
    status === "on_track" ? "from-emerald-400 to-emerald-500"
    : status === "close"  ? "from-amber-400 to-amber-500"
    : "from-red-400 to-red-500";
  return (
    <div className="h-2 w-full rounded-full bg-white/[0.05] overflow-hidden">
      <div
        className={`h-full bg-gradient-to-r ${color} transition-all duration-700`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

function GoalCard({ row, onOpen, onMessage }: { row: ChatterGoalRow; onOpen: () => void; onMessage: () => void }) {
  const p = row.progress;
  const deficitColor =
    p.deficit <= 0 ? "text-emerald-300"
    : p.pacePct >= 80 ? "text-amber-300"
    : "text-red-300";

  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = () => {
    if (clickTimer.current) {
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
      onOpen();
      return;
    }
    clickTimer.current = setTimeout(() => {
      clickTimer.current = null;
      navigator.clipboard?.writeText(row.chatter).then(
        () => toast.success(`"${row.chatter}" kopiert`),
        () => toast.error("Kopieren fehlgeschlagen"),
      );
    }, 220);
  };

  useEffect(() => {
    return () => {
      if (clickTimer.current) clearTimeout(clickTimer.current);
    };
  }, []);

  return (
    <div
      onClick={handleClick}
      role="button"
      tabIndex={0}
      title="1× Klick: Name kopieren · 2× Klick: Profil öffnen"
      className="text-left w-full rounded-2xl border border-white/[0.06] bg-gradient-to-br from-white/[0.035] via-white/[0.02] to-transparent p-4 sm:p-5 hover:border-white/[0.12] hover:bg-white/[0.04] transition-all duration-300 group cursor-pointer"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3
            onClick={(e) => { e.stopPropagation(); onOpen(); }}
            title="Profil öffnen"
            className="text-base sm:text-lg font-semibold text-white/90 truncate group-hover:text-white cursor-pointer hover:underline decoration-white/30 underline-offset-4"
          >
            {row.chatter}
          </h3>
          <p className="text-[11px] text-white/35 font-light mt-0.5">
            Ziel aus Notiz vom {new Date(row.noteDate).toLocaleDateString("de-DE")}
          </p>
        </div>
        <StatusBadge status={p.status} />
      </div>

      <div className="space-y-2 mb-4">
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-white/45 font-light">{Math.round(p.progressPct)}% des Ziels</span>
          <span className="text-white/55 font-light tabular-nums">
            {formatEUR(p.currentRevenue)} / {formatEUR(p.goal)}
          </span>
        </div>
        <ProgressBar pct={p.progressPct} status={p.status} />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Soll heute" value={formatEUR(p.expectedSoFar)} />
        <Stat
          label="Differenz"
          value={(p.deficit > 0 ? "−" : "+") + formatEUR(Math.abs(p.deficit))}
          valueClass={deficitColor}
          icon={p.deficit > 0 ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
        />
        <Stat label="Pace" value={`${Math.round(p.pacePct)}%`} valueClass={deficitColor} />
      </div>

      <div className="mt-3 pt-3 border-t border-white/[0.05] flex items-center justify-between text-[11px] text-white/45 font-light">
        <span>
          Ø nötig/Tag bis Ende:{" "}
          <span className="text-white/75 tabular-nums">{formatEUR(p.requiredPerRemainingDay)}</span>
        </span>
        <span>
          Ø Soll/Tag: <span className="text-white/65 tabular-nums">{formatEUR(p.dailyTarget)}</span>
        </span>
      </div>

      <button
        onClick={(e) => { e.stopPropagation(); onMessage(); }}
        className="mt-3 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-white/[0.08] bg-white/[0.025] text-white/70 text-xs font-light hover:bg-white/[0.06] hover:text-white/95 transition-colors"
      >
        <MessageSquare className="h-3.5 w-3.5" />
        Nachricht generieren
      </button>
    </div>
  );
}

function Stat({
  label,
  value,
  valueClass = "text-white/85",
  icon,
}: {
  label: string;
  value: string;
  valueClass?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg bg-white/[0.025] border border-white/[0.04] px-2.5 py-2">
      <div className="text-[9px] uppercase tracking-[0.16em] text-white/35 font-light mb-1">
        {label}
      </div>
      <div className={`text-sm font-semibold tabular-nums flex items-center gap-1 ${valueClass}`}>
        {icon}
        {value}
      </div>
    </div>
  );
}

interface SuggestionRow {
  chatter: string;
  avg30: number;
  monthRevenue: number;
  suggested: number;
  models: string[];
  modelBaselineEurPerDay: number;
  basis: "model" | "chatter" | "fallback";
  currentGoal: number | null;
}

function SuggestionCard({
  row,
  onAccept,
  onSkip,
  onMessage,
  onOpen,
  busy,
}: {
  row: SuggestionRow;
  onAccept: (goal: number) => void;
  onSkip: () => void;
  onMessage: (goal: number) => void;
  onOpen: () => void;
  busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<string>(String(row.suggested));

  const parsed = Math.max(0, Math.round(parseFloat(value.replace(/[^\d.,]/g, "").replace(",", ".")) || 0));

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-br from-emerald-500/[0.04] via-white/[0.02] to-transparent p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3
            className="text-base sm:text-lg font-semibold text-white/90 truncate cursor-pointer hover:text-white transition-colors hover:underline decoration-white/30 underline-offset-4"
            onClick={onOpen}
            title="Profil öffnen"
          >
            {row.chatter}
          </h3>
          <p className="text-[11px] text-white/35 font-light mt-0.5">
            {row.basis === "model"
              ? `Basis: ${row.models.length} ${row.models.length === 1 ? "Model" : "Models"} · Ø ${formatEUR(row.modelBaselineEurPerDay)}/Tag Potenzial`
              : row.basis === "chatter"
              ? `Basis: eigener Schnitt – über Model-Potenzial (Ø ${formatEUR(row.avg30)}/Tag vs. ${formatEUR(row.modelBaselineEurPerDay)}/Tag)`
              : "Basis: Chatter-Schnitt (kein Model erkannt)"}
          </p>
          {row.currentGoal != null && (
            <p className="text-[11px] text-amber-200/80 font-light mt-1">
              Aktuell: <span className="tabular-nums">{formatEUR(row.currentGoal)}</span> → neu{" "}
              <span className="tabular-nums text-emerald-200">{formatEUR(parsed || row.suggested)}</span>
              {row.currentGoal > 0 && (
                <span className="ml-1 text-white/45">
                  ({((parsed || row.suggested) >= row.currentGoal ? "+" : "")}
                  {Math.round((((parsed || row.suggested) - row.currentGoal) / row.currentGoal) * 100)}%)
                </span>
              )}
            </p>
          )}
        </div>
        <span
          className={`text-[10px] uppercase tracking-[0.2em] px-2 py-1 rounded-full font-light shrink-0 ${
            row.currentGoal != null
              ? "border border-amber-300/30 bg-amber-400/10 text-amber-200"
              : row.basis === "model"
              ? "border border-emerald-300/30 bg-emerald-400/10 text-emerald-200"
              : row.basis === "chatter"
              ? "border border-sky-300/30 bg-sky-400/10 text-sky-200"
              : "border border-amber-300/30 bg-amber-400/10 text-amber-200"
          } border`}
        >
          {row.currentGoal != null
            ? "Update"
            : row.basis === "model"
            ? "Vorschlag"
            : row.basis === "chatter"
            ? "Overperformer"
            : "Fallback"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-4">
        <Stat
          label={row.basis === "model" ? "Ø Tag (Models)" : "Ø Tag (Chatter)"}
          value={formatEUR(row.basis === "model" ? row.modelBaselineEurPerDay : row.avg30)}
        />
        <Stat label="Monat bisher" value={formatEUR(row.monthRevenue)} />
      </div>

      <div className="rounded-xl border border-emerald-300/20 bg-emerald-400/[0.06] px-4 py-3 mb-3">
        <div className="text-[10px] uppercase tracking-[0.2em] text-emerald-200/70 font-light mb-1">
          Vorgeschlagenes Wochenziel
        </div>
        {editing ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="numeric"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="flex-1 bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-lg font-semibold tabular-nums text-white/90 focus:outline-none focus:border-emerald-300/40"
              placeholder="z.B. 3500"
            />
            <span className="text-white/55 text-sm">€</span>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <span className="text-2xl sm:text-3xl font-semibold tabular-nums text-emerald-200">
              {formatEUR(parsed || row.suggested)}
            </span>
            <button
              onClick={() => setEditing(true)}
              className="text-[11px] text-white/45 hover:text-white/80 font-light flex items-center gap-1 transition-colors"
              title="Ziel anpassen"
            >
              <Pencil className="h-3 w-3" />
              ändern
            </button>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <button
          disabled={busy || parsed <= 0}
          onClick={() => onAccept(parsed)}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-emerald-300/30 bg-emerald-400/15 text-emerald-100 text-sm font-light hover:bg-emerald-400/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {row.currentGoal != null ? "Überschreiben" : "Annehmen"}
        </button>
        <button
          disabled={busy}
          onClick={onSkip}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-white/[0.06] bg-white/[0.02] text-white/55 text-sm font-light hover:bg-white/[0.05] hover:text-white/80 transition-colors disabled:opacity-50"
          title="Vorschlag ausblenden"
        >
          <X className="h-3.5 w-3.5" />
          Skip
        </button>
      </div>

      <button
        type="button"
        disabled={busy || parsed <= 0}
        onClick={() => onMessage(parsed || row.suggested)}
        className="mt-2 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-white/[0.08] bg-white/[0.025] text-white/70 text-xs font-light hover:bg-white/[0.06] hover:text-white/95 transition-colors disabled:opacity-50"
      >
        <MessageSquare className="h-3.5 w-3.5" />
        Nachricht generieren
      </button>
    </div>
  );
}

export default function WeeklyGoals() {
  const { platform } = usePlatform();
  const [rows, setRows] = useState<ChatterGoalRow[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("deficit");
  const [statusFilter, setStatusFilter] = useState<GoalStatus | "all">("all");
  // Impact-Filter: granular nach Wochenziel-Höhe
  const [impactFilter, setImpactFilter] = useState<"all" | "lt100" | "lt300" | "lt500" | "lt1000" | "gte1000">("all");
  const [tab, setTab] = useState<"current" | "future" | "past">("current");
  const [selected, setSelected] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [acceptingChatter, setAcceptingChatter] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [messageFor, setMessageFor] = useState<{ chatter: string; proposedGoal: number; currentGoal: number | null } | null>(null);
  const [bulkTargets, setBulkTargets] = useState<BulkTarget[] | null>(null);
  const setBulkOpen = (targets: BulkTarget[]) => setBulkTargets(targets.length > 0 ? targets : null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [suggestionsGenerated, setSuggestionsGenerated] = useState(false);
  // Einstellbare Schwellen für Wochenziel-Vorschläge
  const [stretchPct, setStretchPct] = useState<number>(110);
  const [smoothingDays, setSmoothingDays] = useState<number>(14);
  const [thresholdsLoaded, setThresholdsLoaded] = useState(false);
  const [thresholdsOpen, setThresholdsOpen] = useState(false);
  const [stretchDraft, setStretchDraft] = useState<string>("110");
  const [smoothingDraft, setSmoothingDraft] = useState<string>("14");
  const [savingThresholds, setSavingThresholds] = useState(false);
  const [trackedThroughDate, setTrackedThroughDate] = useState<Date | null>(null);

  // Schwellen aus settings laden (einmalig)
  useEffect(() => {
    (async () => {
      try {
        const { data: u } = await supabase.auth.getUser();
        const uid = u?.user?.id;
        if (!uid) { setThresholdsLoaded(true); return; }
        const { data } = await supabase
          .from("settings")
          .select("key, value")
          .in("key", ["weekly_goal_stretch_pct", "weekly_goal_smoothing_days"])
          .eq("user_id", uid);
        for (const row of (data ?? []) as Array<{ key: string; value: string }>) {
          const n = Number(row.value);
          if (!Number.isFinite(n)) continue;
          if (row.key === "weekly_goal_stretch_pct" && n >= 80 && n <= 200) {
            setStretchPct(n);
            setStretchDraft(String(n));
          }
          if (row.key === "weekly_goal_smoothing_days" && n >= 3 && n <= 60) {
            setSmoothingDays(n);
            setSmoothingDraft(String(n));
          }
        }
      } finally {
        setThresholdsLoaded(true);
      }
    })();
  }, []);

  async function saveThresholds() {
    const s = Number(stretchDraft);
    const d = Number(smoothingDraft);
    if (!Number.isFinite(s) || s < 80 || s > 200) {
      toast.error("Stretch muss zwischen 80 und 200 % liegen");
      return;
    }
    if (!Number.isFinite(d) || d < 3 || d > 60) {
      toast.error("Smoothing-Fenster muss zwischen 3 und 60 Tagen liegen");
      return;
    }
    setSavingThresholds(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u?.user?.id;
      if (!uid) throw new Error("Nicht angemeldet");
      for (const [key, val] of [
        ["weekly_goal_stretch_pct", String(Math.round(s))],
        ["weekly_goal_smoothing_days", String(Math.round(d))],
      ] as const) {
        const { data: existing } = await supabase
          .from("settings").select("id").eq("key", key).eq("user_id", uid).maybeSingle();
        if (existing) {
          await supabase.from("settings")
            .update({ value: val, updated_at: new Date().toISOString() })
            .eq("id", (existing as any).id);
        } else {
          await supabase.from("settings").insert({ key, value: val, user_id: uid });
        }
      }
      setStretchPct(Math.round(s));
      setSmoothingDays(Math.round(d));
      setStretchDraft(String(Math.round(s)));
      setSmoothingDraft(String(Math.round(d)));
      setThresholdsOpen(false);
      // suggestionsGenerated bewusst nicht zurücksetzen — die Liste rechnet
      // sich durch den Deps-Change (stretchPct / smoothingDays) automatisch neu.
      toast.success("Schwellen gespeichert – Vorschläge werden neu berechnet");
    } catch (e: any) {
      toast.error(e?.message ?? "Speichern fehlgeschlagen");
    } finally {
      setSavingThresholds(false);
    }
  }




  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        // Auf Session warten (race condition fix)
        let { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          session = await new Promise((resolve) => {
            const timeout = setTimeout(() => resolve(null), 2000);
            const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
              if (s) {
                clearTimeout(timeout);
                sub.subscription.unsubscribe();
                resolve(s);
              }
            });
          });
        }
        const user = session?.user;
        if (!user) throw new Error("Nicht angemeldet");

        const today = new Date();
        const reportStart = weekStart(today);
        const reportStartIso = toIsoDateLocal(reportStart);
        const todayIso = toIsoDateLocal(today);
        // (kein 30-Tage-Fenster mehr — Vorschlag = All-Time-Durchschnitt)

        // 1) Label finden / anlegen
        const { data: labels, error: lErr } = await supabase
          .from("chatter_labels")
          .select("id, label_name")
          .eq("platform", platform)
          .eq("label_name", LABEL_NAME);
        if (lErr) throw lErr;
        const labelId = labels?.[0]?.id ?? null;

        // 2) Assignments für Monatsziel-Label laden (kann leer sein)
        let labelChatters: string[] = [];
        if (labelId) {
          const { data: assigns, error: aErr } = await supabase
            .from("chatter_label_assignments")
            .select("chatter_name")
            .eq("platform", platform)
            .eq("label_id", labelId);
          if (aErr) throw aErr;
          labelChatters = Array.from(new Set((assigns ?? []).map((a) => a.chatter_name)));
        }

        // 60-Tage-Fenster für Model-Baseline + Chatter-Roster
        const sixtyDaysAgo = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 60);
        const sixtyAgoIso = toIsoDateLocal(sixtyDaysAgo);

        // 3) Historie (60 Tage, inkl. account) — paginiert (Supabase Default-Limit = 1000)
        async function fetchAllHistory<T>(
          builder: () => any,
        ): Promise<T[]> {
          const pageSize = 1000;
          const all: T[] = [];
          let from = 0;
          // Hard-Cap, falls jemals etwas Komisches passiert
          for (let i = 0; i < 50; i++) {
            const { data, error } = await builder().range(from, from + pageSize - 1);
            if (error) throw error;
            const chunk = (data ?? []) as T[];
            all.push(...chunk);
            if (chunk.length < pageSize) break;
            from += pageSize;
          }
          return all;
        }

        const [histAllRows, notesRes, histMonthRows] = await Promise.all([
          fetchAllHistory<{
            chatter_name: string;
            revenue_today: number | null;
            analysis_date: string;
            account: string | null;
          }>(() =>
            supabase
              .from("chatter_history")
              .select("chatter_name, revenue_today, analysis_date, account")
              .eq("platform", platform)
              .gte("analysis_date", sixtyAgoIso)
              .lte("analysis_date", todayIso)
              .order("analysis_date", { ascending: false }),
          ),
          labelChatters.length > 0
            ? supabase
                .from("coaching_notes")
                .select("chatter_name, note_text, created_at")
                .eq("platform", platform)
                .in("chatter_name", labelChatters)
                .order("created_at", { ascending: false })
            : Promise.resolve({ data: [], error: null } as any),
          labelChatters.length > 0
            ? fetchAllHistory<{
                chatter_name: string;
                revenue_today: number | null;
                analysis_date: string;
                account: string | null;
              }>(() =>
                supabase
                  .from("chatter_history")
                  .select("chatter_name, revenue_today, analysis_date, account")
                  .eq("platform", platform)
                  .in("chatter_name", labelChatters)
                  .gte("analysis_date", reportStartIso)
                  .lte("analysis_date", todayIso),
              )
            : Promise.resolve([] as Array<{ chatter_name: string; revenue_today: number | null; analysis_date: string; account: string | null }>),
        ]);
        if ((notesRes as any).error) throw (notesRes as any).error;



        // === Aktuelle Wochenziele ===
        const goalByChatter = new Map<string, { goal: number; text: string; date: string }>();
        for (const n of notesRes.data ?? []) {
          if (goalByChatter.has(n.chatter_name)) continue;
          // Nur Wochenziel-Notizen berücksichtigen (Chatter kann auch Monatsziel-Notes haben).
          if (!/^\s*Wochenziel/i.test(n.note_text ?? "")) continue;
          const goal = parseGoalFromNote(n.note_text);
          if (goal != null) {
            goalByChatter.set(n.chatter_name, {
              goal,
              text: n.note_text,
              date: n.created_at,
            });
          }
        }
        // Dedupliziere doppelte Reports pro Tag: pro (chatter, date, account)
        // nehmen wir MAX(revenue_today). Verhindert Doppelzählung wenn am
        // selben Tag mehrere Reports mit gleicher Account-Struktur ankommen
        // (z.B. einmal mit leerem account "" und einmal mit Account-Namen).
        const monthRevMax = new Map<string, number>(); // key = chatter|date|account
        for (const h of histMonthRows ?? []) {
          const key = `${h.chatter_name}|${h.analysis_date}|${(h.account ?? "").trim()}`;
          const v = Number(h.revenue_today ?? 0);
          const prev = monthRevMax.get(key) ?? 0;
          if (v > prev) monthRevMax.set(key, v);
        }
        const monthRevByChatter = new Map<string, number>();
        for (const [key, v] of monthRevMax) {
          const chatter = key.split("|")[0];
          monthRevByChatter.set(chatter, (monthRevByChatter.get(chatter) ?? 0) + v);
        }
        let latestCurrentReportIso: string | null = null;
        for (const h of histAllRows) {
          if (h.analysis_date >= reportStartIso && h.analysis_date <= todayIso) {
            if (!latestCurrentReportIso || h.analysis_date > latestCurrentReportIso) {
              latestCurrentReportIso = h.analysis_date;
            }
          }
        }
        const progressDate = latestCurrentReportIso
          ? fromIsoDateLocal(latestCurrentReportIso)
          : new Date(reportStart.getFullYear(), reportStart.getMonth(), reportStart.getDate() - 1);
        const built: ChatterGoalRow[] = [];
        const currentWeekStart = weekStart(today);
        for (const c of labelChatters) {
          const g = goalByChatter.get(c);
          if (!g) continue;
          // Zukünftige Wochenziele (KW liegt nach der aktuellen) gehören NICHT
          // in das Tracking der laufenden Woche — sonst würden sie mit 0 €
          // Fortschritt und daysPassed=0 fälschlich als „on track" gezählt.
          const target = parseTargetWeek(g.text);
          const isFuture = !!target && target > currentWeekStart;
          if (isFuture) continue;
          const rev = monthRevByChatter.get(c) ?? 0;
          built.push({
            chatter: c,
            noteText: g.text,
            noteDate: g.date,
            progress: computeGoalProgress(g.goal, rev, progressDate),
          });
        }

        // === Zukünftige Wochenziele (Vorschläge — basiert auf Model-Performance) ===
        // 3a) Model-Baselines aus allen Rows der letzten 60 Tage
        const modelBaselines = computeModelBaselines(histAllRows);


        // 3b) Roster pro Chatter aus letzten 14 Tagen (aktuelle Zuordnung)
        //     + chattersByModel: wer arbeitet aktuell am selben Model (für anteilige Verteilung)
        const fourteenAgoIso = toIsoDateLocal(
          new Date(today.getFullYear(), today.getMonth(), today.getDate() - 14),
        );
        const rosterByChatter = new Map<string, Set<string>>();
        const chattersByModel = new Map<string, Set<string>>();
        const sumByChatter = new Map<string, number>();
        const daysByChatter = new Map<string, Set<string>>();
        for (const h of histAllRows) {
          // Chatter-Schnitt (Fallback) über 60 Tage
          sumByChatter.set(
            h.chatter_name,
            (sumByChatter.get(h.chatter_name) ?? 0) + Number(h.revenue_today ?? 0),
          );
          if (!daysByChatter.has(h.chatter_name)) daysByChatter.set(h.chatter_name, new Set());
          daysByChatter.get(h.chatter_name)!.add(h.analysis_date);

          // Roster + Reverse-Index aus letzten 14 Tagen
          if (h.analysis_date >= fourteenAgoIso) {
            const models = splitAccounts(h.account);
            if (models.length > 0) {
              if (!rosterByChatter.has(h.chatter_name)) rosterByChatter.set(h.chatter_name, new Set());
              const set = rosterByChatter.get(h.chatter_name)!;
              for (const m of models) {
                set.add(m);
                if (!chattersByModel.has(m)) chattersByModel.set(m, new Set());
                chattersByModel.get(m)!.add(h.chatter_name);
              }
            }
          }
        }

        // Neueste Report-Datum bestimmen + Chatter, die dort vorkamen
        let latestReportDate: string | null = null;
        for (const h of histAllRows) {
          if (!latestReportDate || h.analysis_date > latestReportDate) {
            latestReportDate = h.analysis_date;
          }
        }
        const activeInLatestReport = new Set<string>();
        if (latestReportDate) {
          for (const h of histAllRows) {
            if (h.analysis_date === latestReportDate && h.chatter_name) {
              activeInLatestReport.add(h.chatter_name);
            }
          }
        }

        // Map: bestehende Monatsziele (zum Anzeigen + Überschreiben)
        const currentGoalByChatter = new Map<string, number>();
        for (const [c, g] of goalByChatter) currentGoalByChatter.set(c, g.goal);

        const sugg: SuggestionRow[] = [];
        for (const [chatter, sum] of sumByChatter) {
          // Bewusst KEIN Skip für Chatter mit bestehendem Ziel — sie sollen erscheinen
          // und das alte Ziel beim Annehmen überschreiben.
          if (!activeInLatestReport.has(chatter)) continue;
          const days = daysByChatter.get(chatter)?.size ?? 0;
          if (days === 0) continue;
          const avg = sum / days;
          const monthRev = monthRevByChatter.get(chatter) ?? 0;

          const roster = Array.from(rosterByChatter.get(chatter) ?? []);
          // Anteiliger Modellschnitt: jedes Model wird durch Anzahl Chatter (letzte 14 Tage) geteilt
          let perChatterDailyBaseline = 0;
          for (const m of roster) {
            const modelDaily = modelBaselines.get(m.toLowerCase()) ?? 0;
            const share = Math.max(1, chattersByModel.get(m)?.size ?? 1);
            perChatterDailyBaseline += modelDaily / share;
          }
          const daysInWeek = 7;
          const stretchFactor = stretchPct / 100;
          const rawModelGoal = perChatterDailyBaseline * daysInWeek * stretchFactor;
          const modelGoal = Number.isFinite(rawModelGoal) && rawModelGoal > 0
            ? Math.max(10, Math.round(rawModelGoal / 10) * 10)
            : 0;

          // Smoothing für neue Chatter: wenn jemand erst wenige Tage dabei ist,
          // dürfen 2 gute Tage das Ziel nicht hochreißen.
          // Wir blenden den Chatter-Schnitt linear mit dem Model-Baseline,
          // bis er smoothingDays aktive Tage hat (volles Vertrauen).
          const MIN_DAYS_FULL_TRUST = Math.max(3, smoothingDays);
          const MIN_DAYS_CHATTER_OVERRIDE = Math.max(3, Math.round(MIN_DAYS_FULL_TRUST * 0.7));
          const trustWeight = Math.min(1, days / MIN_DAYS_FULL_TRUST);
          const smoothedAvg = perChatterDailyBaseline > 0
            ? trustWeight * avg + (1 - trustWeight) * perChatterDailyBaseline
            : avg;

          // Wenn Chatter deutlich BESSER als Model-Schnitt performt (> stretch drüber),
          // → eigenes Ergebnis × stretch nehmen statt Model-Schnitt zu deckeln.
          // ABER: nur wenn er genug Datenbasis hat.
          const chatterGoal = avg > 1
            ? Math.max(10, Math.round((smoothedAvg * daysInWeek * stretchFactor) / 10) * 10)
            : 0;

          let basis: "model" | "chatter" | "fallback";
          let suggested: number;
          if (
            modelGoal > 0 &&
            chatterGoal > 0 &&
            days >= MIN_DAYS_CHATTER_OVERRIDE &&
            avg > perChatterDailyBaseline * stretchFactor
          ) {
            basis = "chatter";
            suggested = chatterGoal;

          } else if (modelGoal > 0) {
            basis = "model";
            suggested = modelGoal;
          } else {
            // Fallback: Chatter-Schnitt 60d (nur wenn sinnvoll)
            if (avg <= 1) continue;
            basis = "fallback";
            suggested = suggestWeeklyGoal(avg);
          }



          sugg.push({
            chatter,
            avg30: avg,
            monthRevenue: monthRev,
            suggested,
            models: roster,
            modelBaselineEurPerDay: perChatterDailyBaseline,
            basis,
            currentGoal: currentGoalByChatter.get(chatter) ?? null,
          });
        }
        sugg.sort((a, b) => b.suggested - a.suggested);


        // Persisted Skips laden
        const { data: skipRows, error: skipErr } = await supabase
          .from("weekly_goal_skips")
          .select("chatter_name")
          .eq("platform", platform);
        if (skipErr) console.warn("[WeeklyGoals] skip load failed", skipErr);

        if (!cancelled) {
          setRows(built);
          setSuggestions(sugg);
          setTrackedThroughDate(progressDate);
          setSkipped(new Set((skipRows ?? []).map((r) => r.chatter_name)));
        }
      } catch (e: any) {
        console.error("[WeeklyGoals] load failed", e);
        if (!cancelled) setError(e?.message ?? "Fehler beim Laden");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (thresholdsLoaded) load();
    return () => { cancelled = true; };
  }, [platform, reloadKey, thresholdsLoaded, stretchPct, smoothingDays]);


  // Auto-Refresh, sobald ein neuer Report hochgeladen wird (neue chatter_history Rows)
  useEffect(() => {
    const channel = supabase
      .channel(`weekly-goals-history-${platform}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chatter_history", filter: `platform=eq.${platform}` },
        () => setReloadKey((k) => k + 1),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [platform]);


  async function acceptSuggestion(chatter: string, goal: number, opts?: { silentReload?: boolean; silentToast?: boolean }) {
    if (goal <= 0) {
      if (!opts?.silentToast) toast.error("Ziel muss > 0 sein");
      throw new Error("Ziel muss > 0 sein");
    }
    setAcceptingChatter(chatter);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error("Nicht angemeldet");

      // 1) Label sicherstellen
      let labelId: string | null = null;
      const { data: existing, error: lErr } = await supabase
        .from("chatter_labels")
        .select("id")
        .eq("platform", platform)
        .eq("label_name", LABEL_NAME)
        .maybeSingle();
      if (lErr) throw lErr;
      if (existing?.id) {
        labelId = existing.id;
      } else {
        const { data: created, error: cErr } = await supabase
          .from("chatter_labels")
          .insert({
            platform,
            label_name: LABEL_NAME,
            color: "#10B981",
            user_id: user.id,
          })
          .select("id")
          .single();
        if (cErr) throw cErr;
        labelId = created.id;
      }

      // 2) Assignment nur, falls noch nicht vorhanden (Überschreiben → kein Duplikat)
      const today = new Date();
      // Ziel gilt IMMER für den nächsten Monat (Vorschläge sind zukunftsorientiert).
      const weekLbl = nextWeekLabel(today);
      const noteText = `Wochenziel ${weekLbl}: ${formatEUR(goal)}`;

      const { data: existingAssign, error: aSelErr } = await supabase
        .from("chatter_label_assignments")
        .select("id")
        .eq("platform", platform)
        .eq("label_id", labelId!)
        .eq("chatter_name", chatter)
        .limit(1);
      if (aSelErr) throw aSelErr;

      const tasks: any[] = [
        supabase.from("coaching_notes").insert({
          platform,
          chatter_name: chatter,
          note_text: noteText,
          user_id: user.id,
        }),
      ];
      if (!existingAssign || existingAssign.length === 0) {
        tasks.unshift(
          supabase.from("chatter_label_assignments").insert({
            platform,
            chatter_name: chatter,
            label_id: labelId!,
            user_id: user.id,
          }),
        );
      }
      const results = await Promise.all(tasks);
      for (const r of results) if (r.error) throw r.error;

      if (!opts?.silentToast) toast.success(`Wochenziel für ${chatter} gesetzt: ${formatEUR(goal)}`);
      // Kein reloadKey-Bump mehr — Caller macht optimistisches UI-Update.
    } catch (e: any) {
      console.error("[WeeklyGoals] accept failed", e);
      if (!opts?.silentToast) toast.error(e?.message ?? "Fehler beim Setzen des Ziels");
      throw e;
    } finally {
      setAcceptingChatter(null);
    }
  }

  /**
   * Optimistisches UI-Update nach erfolgreichem Accept:
   * - Row in "Aktuelle Wochenziele" anlegen oder updaten
   * - Chatter aus Future ausblenden
   * - currentGoal in Suggestions reflektieren
   */
  function applyAcceptedGoal(chatter: string, goal: number, _monthRevenue: number) {
    // Angenommene Vorschläge gelten für die nächste Woche und gehören deshalb
    // nicht in das Tracking der laufenden Woche.
    setSuggestions((prev) =>
      prev.map((s) => (s.chatter === chatter ? { ...s, currentGoal: goal } : s)),
    );
    setSkipped((prev) => {
      if (prev.has(chatter)) return prev;
      const next = new Set(prev);
      next.add(chatter);
      return next;
    });
    // Skip aufheben in DB, falls Chatter vorher übersprungen war — Accept overruled Skip
    void persistUnskip(chatter);
  }

  async function persistSkip(chatter: string) {
    setSkipped((prev) => {
      if (prev.has(chatter)) return prev;
      const next = new Set(prev);
      next.add(chatter);
      return next;
    });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error("Nicht angemeldet");
      const { error } = await supabase
        .from("weekly_goal_skips")
        .upsert(
          { user_id: user.id, platform, chatter_name: chatter },
          { onConflict: "user_id,platform,chatter_name" },
        );
      if (error) throw error;
    } catch (e: any) {
      console.error("[WeeklyGoals] persistSkip failed", e);
      toast.error(`Skip konnte nicht gespeichert werden: ${e?.message ?? "Fehler"}`);
      setSkipped((prev) => {
        if (!prev.has(chatter)) return prev;
        const next = new Set(prev);
        next.delete(chatter);
        return next;
      });
    }
  }

  async function persistUnskip(chatter: string) {
    setSkipped((prev) => {
      if (!prev.has(chatter)) return prev;
      const next = new Set(prev);
      next.delete(chatter);
      return next;
    });
    try {
      const { error } = await supabase
        .from("weekly_goal_skips")
        .delete()
        .eq("platform", platform)
        .eq("chatter_name", chatter);
      if (error) throw error;
    } catch (e: any) {
      console.error("[WeeklyGoals] persistUnskip failed", e);
    }
  }

  const [clearingAll, setClearingAll] = useState(false);
  async function clearAllCurrentGoals() {
    if (rows.length === 0) return;
    const ok = window.confirm(
      `Wirklich alle ${rows.length} aktuellen Wochenziele für ${platform} löschen?\n\nDie Chatter bleiben in den Vorschlägen sichtbar und können neu vergeben werden.`,
    );
    if (!ok) return;
    setClearingAll(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error("Nicht angemeldet");

      // Label-ID holen
      const { data: lbl, error: lErr } = await supabase
        .from("chatter_labels")
        .select("id")
        .eq("platform", platform)
        .eq("label_name", LABEL_NAME)
        .maybeSingle();
      if (lErr) throw lErr;

      const chatterNames = rows.map((r) => r.chatter);

      // 1) Label-Assignments löschen
      if (lbl?.id && chatterNames.length > 0) {
        const { error: aErr } = await supabase
          .from("chatter_label_assignments")
          .delete()
          .eq("platform", platform)
          .eq("label_id", lbl.id)
          .in("chatter_name", chatterNames);
        if (aErr) throw aErr;
      }

      // 2) Monatsziel-Notes löschen (nur die mit "Monatsziel"-Prefix)
      if (chatterNames.length > 0) {
        const { error: nErr } = await supabase
          .from("coaching_notes")
          .delete()
          .eq("platform", platform)
          .in("chatter_name", chatterNames)
          .ilike("note_text", "Wochenziel%");
        if (nErr) throw nErr;
      }

      // Optimistisch UI leeren
      setRows([]);
      setSuggestions((prev) => prev.map((s) => ({ ...s, currentGoal: null })));
      setSkipped(new Set());
      toast.success(`${chatterNames.length} Wochenziele gelöscht`);
    } catch (e: any) {
      console.error("[WeeklyGoals] clearAll failed", e);
      toast.error(e?.message ?? "Fehler beim Löschen");
    } finally {
      setClearingAll(false);
    }
  }

  async function revertAcceptedGoal(chatter: string) {
    try {
      const { data: lbl, error: lErr } = await supabase
        .from("chatter_labels")
        .select("id")
        .eq("platform", platform)
        .eq("label_name", LABEL_NAME)
        .maybeSingle();
      if (lErr) throw lErr;

      if (lbl?.id) {
        const { error: aErr } = await supabase
          .from("chatter_label_assignments")
          .delete()
          .eq("platform", platform)
          .eq("label_id", lbl.id)
          .eq("chatter_name", chatter);
        if (aErr) throw aErr;
      }

      const { error: nErr } = await supabase
        .from("coaching_notes")
        .delete()
        .eq("platform", platform)
        .eq("chatter_name", chatter)
        .ilike("note_text", "Wochenziel%");
      if (nErr) throw nErr;

      setRows((prev) => prev.filter((r) => r.chatter !== chatter));
      setSuggestions((prev) =>
        prev.map((s) => (s.chatter === chatter ? { ...s, currentGoal: null } : s)),
      );
      setSkipped((prev) => {
        if (!prev.has(chatter)) return prev;
        const next = new Set(prev);
        next.delete(chatter);
        return next;
      });
      toast.success(`Wochenziel für ${chatter} entfernt`);
    } catch (e: any) {
      console.error("[WeeklyGoals] revert failed", e);
      toast.error(e?.message ?? "Fehler beim Zurücksetzen");
      throw e;
    }
  }




  const visibleSuggestions = useMemo(
    // Chatter mit bereits gesetztem aktuellem Monatsziel werden nicht erneut vorgeschlagen.
    // Erst nach Un-Accept (currentGoal = null) tauchen sie wieder hier auf.
    () => suggestions.filter((s) => !skipped.has(s.chatter) && s.currentGoal == null),
    [suggestions, skipped],
  );

  // Hochrechnung: Wochenumsatz, wenn alle Chatter ihr (vorgeschlagenes oder bereits gesetztes) Wochenziel erreichen.
  const projectedWeekTotal = useMemo(() => {
    const considered = suggestions.filter((s) => !skipped.has(s.chatter));
    let goalSum = 0;
    let avgSum = 0;
    let withGoal = 0;
    let withCurrent = 0;
    for (const s of considered) {
      const goal = s.currentGoal ?? s.suggested;
      goalSum += goal;
      // "Wochen-Schnitt" = Chatter-Ø/Tag × 7
      avgSum += (s.avg30 || 0) * 7;
      if (s.suggested > 0) withGoal += 1;
      if (s.currentGoal != null) withCurrent += 1;
    }
    return { goalSum, avgSum, count: considered.length, withGoal, withCurrent };
  }, [suggestions, skipped]);

  const filteredRows = useMemo(() => {
    let arr = rows;
    if (impactFilter === "lt100") arr = arr.filter((r) => r.progress.goal < 100);
    else if (impactFilter === "lt300") arr = arr.filter((r) => r.progress.goal >= 100 && r.progress.goal < 300);
    else if (impactFilter === "lt500") arr = arr.filter((r) => r.progress.goal >= 300 && r.progress.goal < 500);
    else if (impactFilter === "lt1000") arr = arr.filter((r) => r.progress.goal >= 500 && r.progress.goal < 1000);
    else if (impactFilter === "gte1000") arr = arr.filter((r) => r.progress.goal >= 1000);
    if (statusFilter !== "all") arr = arr.filter((r) => r.progress.status === statusFilter);
    return arr;
  }, [rows, statusFilter, impactFilter]);

  const impactCounts = useMemo(() => ({
    lt100: rows.filter((r) => r.progress.goal < 100).length,
    lt300: rows.filter((r) => r.progress.goal >= 100 && r.progress.goal < 300).length,
    lt500: rows.filter((r) => r.progress.goal >= 300 && r.progress.goal < 500).length,
    lt1000: rows.filter((r) => r.progress.goal >= 500 && r.progress.goal < 1000).length,
    gte1000: rows.filter((r) => r.progress.goal >= 1000).length,
  }), [rows]);

  const sortedRows = useMemo(() => {
    const arr = [...filteredRows];
    arr.sort((a, b) => {
      switch (sortKey) {
        case "progress": return b.progress.progressPct - a.progress.progressPct;
        case "goal":     return b.progress.goal - a.progress.goal;
        case "name":     return a.chatter.localeCompare(b.chatter, "de");
        case "deficit":
        default:         return b.progress.deficit - a.progress.deficit;
      }
    });
    return arr;
  }, [filteredRows, sortKey]);

  const statusCounts = useMemo(() => {
    const base = impactFilter === "lt100" ? rows.filter((r) => r.progress.goal < 100)
      : impactFilter === "lt300" ? rows.filter((r) => r.progress.goal >= 100 && r.progress.goal < 300)
      : impactFilter === "lt500" ? rows.filter((r) => r.progress.goal >= 300 && r.progress.goal < 500)
      : impactFilter === "lt1000" ? rows.filter((r) => r.progress.goal >= 500 && r.progress.goal < 1000)
      : impactFilter === "gte1000" ? rows.filter((r) => r.progress.goal >= 1000)
      : rows;
    return {
      total: base.length,
      on_track: base.filter((r) => r.progress.status === "on_track").length,
      close: base.filter((r) => r.progress.status === "close").length,
      off_track: base.filter((r) => r.progress.status === "off_track").length,
    };
  }, [rows, impactFilter]);

  const filteredTotalGoal = useMemo(
    () => filteredRows.reduce((s, r) => s + r.progress.goal, 0),
    [filteredRows],
  );

  const filteredTotalRevenue = useMemo(
    () => filteredRows.reduce((s, r) => s + r.progress.currentRevenue, 0),
    [filteredRows],
  );

  const filteredOverallPct = useMemo(
    () => (filteredTotalGoal > 0 ? (filteredTotalRevenue / filteredTotalGoal) * 100 : 0),
    [filteredTotalGoal, filteredTotalRevenue],
  );

  const filteredRemaining = useMemo(
    () => Math.max(0, filteredTotalGoal - filteredTotalRevenue),
    [filteredTotalGoal, filteredTotalRevenue],
  );

  const overallStatus: GoalStatus =
    filteredOverallPct >= 90 ? "on_track"
    : filteredOverallPct >= 75 ? "close"
    : "off_track";

  const today = new Date();
  const trackedThrough = trackedThroughDate ?? new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const { week: _wk, year: _yr } = isoWeekNumber(today);
  const weekName = `KW ${_wk} ${_yr}`;
  const totalGoal = rows.reduce((s, r) => s + r.progress.goal, 0);
  const totalRev = rows.reduce((s, r) => s + r.progress.currentRevenue, 0);
  const onTrackCount = rows.filter((r) => r.progress.status === "on_track").length;

  return (
    <div className="min-h-full bg-background -m-3 sm:m-0">
      <div className="max-w-6xl mx-auto px-3 sm:px-6 py-3 sm:py-10 space-y-3 sm:space-y-6">
        {/* Hero */}
        <div className="relative overflow-hidden rounded-2xl sm:rounded-3xl border border-white/[0.06] bg-gradient-to-br from-white/[0.04] via-white/[0.02] to-transparent p-4 sm:p-8">
          <div className="absolute -top-20 -right-20 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -left-10 h-56 w-56 rounded-full bg-blue-500/[0.08] blur-3xl pointer-events-none" />
          <div className="relative flex items-start gap-3 sm:gap-4">
            <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-xl sm:rounded-2xl bg-gradient-to-br from-emerald-400/20 to-blue-500/10 border border-emerald-300/20 flex items-center justify-center shrink-0">
              <Target className="h-4 w-4 sm:h-5 sm:w-5 text-emerald-200" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] text-white/40 font-light">
                <Sparkles className="h-3 w-3" />
                Dashboard · {weekName}
              </div>
              <h1 className="text-xl sm:text-3xl font-semibold tracking-tight gold-text mt-0.5 sm:mt-1">
                Wochenziele
              </h1>
              <p className="text-[12px] sm:text-sm text-white/55 font-light mt-1 sm:mt-1.5 max-w-2xl leading-relaxed">
                {rows.length === 0
                  ? 'Noch keine Chatter mit dem Label „Wochenziel" und einer Zahl in den Notizen.'
                  : `${rows.length} Chatter im Tracking · ${onTrackCount} on track · ${formatEUR(totalRev)} von ${formatEUR(totalGoal)} erreicht.`}
              </p>
              <p className="text-[10px] sm:text-[11px] text-white/35 font-light mt-1">
                Tracking bis: {trackedThrough.toLocaleDateString("de-DE")} · Upload-Report bis: {today.toLocaleDateString("de-DE")}
              </p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1.5 border-b border-white/[0.06] pb-0">
          {([
            ["current", "Aktuelle Wochenziele", rows.length],
            ["future", "Zukünftige Wochenziele", suggestionsGenerated ? visibleSuggestions.length : 0],
            ["past", "Vergangene Wochenziele", null],
          ] as ["current" | "future" | "past", string, number | null][]).map(([k, label, count]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`relative text-[12px] sm:text-sm px-4 py-2.5 font-light transition-colors flex items-center gap-2 ${
                tab === k
                  ? "text-white"
                  : "text-white/45 hover:text-white/75"
              }`}
            >
              {label}
              {count != null && (
                <span className={`tabular-nums text-[10px] px-1.5 py-0.5 rounded-full ${
                  tab === k ? "bg-white/[0.08] text-white/80" : "bg-white/[0.03] text-white/40"
                }`}>{count}</span>
              )}
              {tab === k && (
                <span className="absolute -bottom-px left-0 right-0 h-px bg-emerald-300/60" />
              )}
            </button>
          ))}
        </div>

        {tab === "current" && (
          <>
            {/* Impact-Filter: granular nach Wochenziel-Höhe */}
            {rows.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {([
                  ["lt100", "< 100 €", impactCounts.lt100, "border-white/15 bg-white/[0.04] text-white/70"],
                  ["lt300", "< 300 €", impactCounts.lt300, "border-sky-300/30 bg-sky-400/10 text-sky-200"],
                  ["lt500", "< 500 €", impactCounts.lt500, "border-amber-300/30 bg-amber-400/10 text-amber-200"],
                  ["lt1000", "< 1.000 €", impactCounts.lt1000, "border-rose-300/30 bg-rose-400/10 text-rose-200"],
                  ["gte1000", "≥ 1.000 €", impactCounts.gte1000, "border-emerald-300/30 bg-emerald-400/10 text-emerald-200"],
                  ["all", "Alle", rows.length, "border-white/20 bg-white/[0.06] text-white/90"],
                ] as ["lt100" | "lt300" | "lt500" | "lt1000" | "gte1000" | "all", string, number, string][]).map(([k, label, count, activeCls]) => (
                  <button
                    key={k}
                    onClick={() => setImpactFilter(k)}
                    className={`text-[11px] px-3 py-1.5 rounded-full border transition-all font-light flex items-center gap-1.5 ${
                      impactFilter === k
                        ? activeCls
                        : "border-white/[0.05] bg-white/[0.015] text-white/45 hover:text-white/70 hover:border-white/10"
                    }`}
                  >
                    {label}
                    <span className="tabular-nums opacity-70">{count}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Status filter */}
            {rows.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {([
                  ["all", "Alle", statusCounts.total, "border-white/20 bg-white/[0.06] text-white/90"],
                  ["on_track", "On Track", statusCounts.on_track, "border-emerald-300/30 bg-emerald-400/10 text-emerald-200"],
                  ["close", "Knapp", statusCounts.close, "border-amber-300/30 bg-amber-400/10 text-amber-200"],
                  ["off_track", "Off Track", statusCounts.off_track, "border-red-300/30 bg-red-400/10 text-red-200"],
                ] as [GoalStatus | "all", string, number, string][]).map(([k, label, count, activeCls]) => (
                  <button
                    key={k}
                    onClick={() => setStatusFilter(k)}
                    className={`text-[11px] px-3 py-1.5 rounded-full border transition-all font-light flex items-center gap-1.5 ${
                      statusFilter === k
                        ? activeCls
                        : "border-white/[0.05] bg-white/[0.015] text-white/45 hover:text-white/70 hover:border-white/10"
                    }`}
                  >
                    {label}
                    <span className="tabular-nums opacity-70">{count}</span>
                  </button>
                ))}
                <button
                  onClick={clearAllCurrentGoals}
                  disabled={clearingAll}
                  className="ml-auto text-[11px] px-3 py-1.5 rounded-full border border-red-400/20 bg-red-500/[0.06] text-red-200/85 hover:bg-red-500/[0.12] hover:text-red-100 transition-colors font-light flex items-center gap-1.5 disabled:opacity-50"
                  title="Alle aktuellen Wochenziele für diese Plattform löschen"
                >
                  {clearingAll ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                  Alle löschen
                </button>
              </div>
            )}

            {/* Sort */}
            {rows.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {([
                  ["deficit", "Größter Rückstand"],
                  ["progress", "Fortschritt"],
                  ["goal", "Höchstes Ziel"],
                  ["name", "Name"],
                ] as [SortKey, string][]).map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => setSortKey(k)}
                    className={`text-[11px] px-3 py-1.5 rounded-full border transition-all font-light ${
                      sortKey === k
                        ? "border-white/20 bg-white/[0.06] text-white/90"
                        : "border-white/[0.05] bg-white/[0.015] text-white/45 hover:text-white/70 hover:border-white/10"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            {/* Gesamtfortschritt für den aktuellen Filter */}
            {filteredRows.length > 0 && (
              <div className="rounded-xl border border-white/[0.06] bg-gradient-to-br from-white/[0.04] via-white/[0.02] to-transparent p-4 sm:p-5 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.2em] text-white/40 font-light">
                      Gesamtfortschritt · {filteredRows.length} Chatter
                    </div>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="text-2xl sm:text-3xl font-semibold tabular-nums text-white/90">
                        {Math.round(filteredOverallPct)}%
                      </span>
                      <span className="text-sm text-white/50 font-light">
                        des Ziels erreicht
                      </span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-white/40 font-light">
                      Noch fehlend
                    </div>
                    <div className={`text-lg font-semibold tabular-nums mt-0.5 ${
                      overallStatus === "on_track" ? "text-emerald-300"
                      : overallStatus === "close" ? "text-amber-300"
                      : "text-red-300"
                    }`}>
                      {formatEUR(filteredRemaining)}
                    </div>
                  </div>
                </div>

                <ProgressBar pct={filteredOverallPct} status={overallStatus} />

                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg bg-white/[0.025] border border-white/[0.04] px-2.5 py-2">
                    <div className="text-[9px] uppercase tracking-[0.16em] text-white/35 font-light mb-1">
                      Aktuell
                    </div>
                    <div className="text-sm font-semibold tabular-nums text-white/85">
                      {formatEUR(filteredTotalRevenue)}
                    </div>
                  </div>
                  <div className="rounded-lg bg-white/[0.025] border border-white/[0.04] px-2.5 py-2">
                    <div className="text-[9px] uppercase tracking-[0.16em] text-white/35 font-light mb-1">
                      Ziel / Woche
                    </div>
                    <div className="text-sm font-semibold tabular-nums text-emerald-200/80">
                      {formatEUR(filteredTotalGoal)}
                    </div>
                  </div>
                  <div className="rounded-lg bg-white/[0.025] border border-white/[0.04] px-2.5 py-2">
                    <div className="text-[9px] uppercase tracking-[0.16em] text-white/35 font-light mb-1">
                      Wenn alle erreichen
                    </div>
                    <div className="text-sm font-semibold tabular-nums text-emerald-200/80">
                      {formatEUR(filteredTotalGoal)} / Woche
                    </div>
                  </div>
                </div>
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center py-20 text-white/40">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                <span className="text-sm font-light">Lade Wochenziele…</span>
              </div>
            ) : error ? (
              <div className="rounded-2xl border border-red-400/20 bg-red-500/5 p-6 text-sm text-red-200">
                {error}
              </div>
            ) : rows.length === 0 ? (
              <div className="rounded-2xl border border-white/[0.05] bg-white/[0.015] p-8 text-center">
                <Target className="h-8 w-8 mx-auto text-white/20 mb-3" />
                <p className="text-sm text-white/55 font-light">
                  Vergib im Swipe-Mode oder Slide-Over das Label <span className="text-white/80">„Wochenziel"</span>{" "}
                  und schreibe eine Zahl in die Coaching-Notizen — oder nutze den Tab{" "}
                  <span className="text-white/80">„Zukünftige Wochenziele"</span>.
                </p>
              </div>
            ) : sortedRows.length === 0 ? (
              <div className="rounded-2xl border border-white/[0.05] bg-white/[0.015] p-8 text-center">
                <p className="text-sm text-white/55 font-light">
                  Keine Chatter im aktuellen Filter.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
                {sortedRows.map((row) => (
                  <GoalCard
                    key={row.chatter}
                    row={row}
                    onOpen={() => setSelected(row.chatter)}
                    onMessage={() =>
                      setMessageFor({
                        chatter: row.chatter,
                        proposedGoal: row.progress.goal,
                        currentGoal: row.progress.goal,
                      })
                    }
                  />
                ))}
              </div>
            )}
          </>
        )}

        {tab === "future" && (
          <>
            {loading ? (
              <div className="flex items-center justify-center py-20 text-white/40">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                <span className="text-sm font-light">Berechne Vorschläge…</span>
              </div>
            ) : error ? (
              <div className="rounded-2xl border border-red-400/20 bg-red-500/5 p-6 text-sm text-red-200">
                {error}
              </div>
            ) : !suggestionsGenerated ? (
              <div className="rounded-2xl border border-white/[0.05] bg-white/[0.015] p-10 text-center space-y-4">
                <Sparkles className="h-8 w-8 mx-auto text-emerald-300/60" />
                <div className="space-y-1">
                  <p className="text-sm text-white/80 font-light">
                    Vorschläge für alle Chatter aus dem neuesten Report
                  </p>
                  <p className="text-[11px] text-white/40 font-light max-w-md mx-auto">
                    Inkl. Chatter mit bestehendem Monatsziel — Annehmen überschreibt das aktuelle Ziel.
                    Smoothing für neue Chatter (&lt;14 Tage) ist eingebaut.
                  </p>
                </div>
                <button
                  onClick={() => setSuggestionsGenerated(true)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-emerald-300/30 bg-emerald-400/15 text-emerald-100 text-sm font-light hover:bg-emerald-400/25 transition-colors"
                >
                  <Sparkles className="h-4 w-4" />
                  Zukünftige Wochenziele generieren
                </button>
              </div>
            ) : visibleSuggestions.length === 0 ? (
              <div className="rounded-2xl border border-white/[0.05] bg-white/[0.015] p-8 text-center">
                <Sparkles className="h-8 w-8 mx-auto text-white/20 mb-3" />
                <p className="text-sm text-white/55 font-light">
                  Keine Chatter im neuesten Report mit ausreichend Daten für einen Vorschlag.
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <p className="text-[11px] text-white/40 font-light flex-1 min-w-[200px]">
                    Alle Chatter aus dem neuesten Report. Vorschlag = Σ Model-Ø der zugeordneten Models × 7 Tage × {stretchPct} % (auf 10 € gerundet, Smoothing über {smoothingDays} Tage für neue Chatter). Karten mit „Update"-Badge überschreiben das bestehende Wochenziel.
                  </p>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => {
                        setStretchDraft(String(stretchPct));
                        setSmoothingDraft(String(smoothingDays));
                        setThresholdsOpen((v) => !v);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-white/[0.08] bg-white/[0.025] text-white/70 text-xs font-light hover:bg-white/[0.06] hover:text-white/95 transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Schwellen
                    </button>
                    <button
                      onClick={() => {
                        setSkipped(new Set());
                        setReloadKey((k) => k + 1);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-white/[0.08] bg-white/[0.025] text-white/70 text-xs font-light hover:bg-white/[0.06] hover:text-white/95 transition-colors"
                    >
                      <Loader2 className="h-3.5 w-3.5" />
                      Neu generieren
                    </button>
                    <button
                      onClick={() => setTemplatesOpen(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-white/[0.08] bg-white/[0.025] text-white/70 text-xs font-light hover:bg-white/[0.06] hover:text-white/95 transition-colors"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      Vorlagen
                    </button>
                    <button
                      onClick={() =>
                        setBulkOpen(
                          visibleSuggestions.map((s) => ({ chatter: s.chatter, goal: s.suggested, currentGoal: s.currentGoal })),
                        )
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-emerald-300/30 bg-emerald-400/15 text-emerald-100 text-xs font-light hover:bg-emerald-400/25 transition-colors"
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                      Nachrichten für alle generieren
                    </button>
                  </div>
                </div>

                {thresholdsOpen && (
                  <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 sm:p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-sm font-medium text-white/85">Schwellen für Wochenziele</h4>
                        <p className="text-[11px] text-white/40 font-light mt-0.5">
                          Wirkt nur auf die Vorschläge oben – bestehende Wochenziele bleiben unverändert.
                        </p>
                      </div>
                      <button
                        onClick={() => setThresholdsOpen(false)}
                        className="text-white/40 hover:text-white/80"
                        aria-label="Schließen"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-[11px] uppercase tracking-[0.18em] text-white/45 font-light block mb-1.5">
                          Stretch-Faktor (%)
                        </label>
                        <input
                          type="number"
                          min={80}
                          max={200}
                          step={5}
                          value={stretchDraft}
                          onChange={(e) => setStretchDraft(e.target.value)}
                          className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-base font-medium tabular-nums text-white/90 focus:outline-none focus:border-emerald-300/40"
                        />
                        <p className="text-[10px] text-white/35 font-light mt-1">
                          100 % = exakter Schnitt · 110 % = Standard · 120 % = ambitioniert
                        </p>
                      </div>
                      <div>
                        <label className="text-[11px] uppercase tracking-[0.18em] text-white/45 font-light block mb-1.5">
                          Smoothing-Fenster (Tage)
                        </label>
                        <input
                          type="number"
                          min={3}
                          max={60}
                          step={1}
                          value={smoothingDraft}
                          onChange={(e) => setSmoothingDraft(e.target.value)}
                          className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-base font-medium tabular-nums text-white/90 focus:outline-none focus:border-emerald-300/40"
                        />
                        <p className="text-[10px] text-white/35 font-light mt-1">
                          Bis zu so vielen aktiven Tagen wird der Chatter-Schnitt mit dem Model-Schnitt gemischt.
                        </p>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        onClick={() => setThresholdsOpen(false)}
                        className="px-4 py-2 rounded-xl border border-white/[0.08] bg-white/[0.02] text-white/70 text-xs font-light hover:bg-white/[0.06] hover:text-white/95 transition-colors"
                      >
                        Abbrechen
                      </button>
                      <button
                        onClick={saveThresholds}
                        disabled={savingThresholds}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-emerald-300/30 bg-emerald-400/15 text-emerald-100 text-xs font-light hover:bg-emerald-400/25 transition-colors disabled:opacity-50"
                      >
                        {savingThresholds ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        Speichern & neu berechnen
                      </button>
                    </div>
                  </div>
                )}



                {projectedWeekTotal.count > 0 && (
                  <div className="rounded-2xl border border-emerald-300/20 bg-gradient-to-br from-emerald-500/[0.08] via-emerald-400/[0.03] to-transparent p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="min-w-0">
                        <div className="text-[10px] uppercase tracking-[0.2em] text-emerald-200/70 font-light mb-1">
                          Wochen-Hochrechnung
                        </div>
                        <h4 className="text-sm text-white/80 font-light">
                          Wenn alle {projectedWeekTotal.count} Chatter ihr Wochenziel bzw. ihren Wochen-Schnitt erreichen.
                        </h4>
                      </div>
                      <div className="flex gap-6 sm:gap-8">
                        <div>
                          <div className="text-[10px] uppercase tracking-[0.18em] text-white/40 font-light mb-1">
                            Σ Wochenziele
                          </div>
                          <div className="text-2xl sm:text-3xl font-semibold tabular-nums text-emerald-200">
                            {formatEUR(projectedWeekTotal.goalSum)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-[0.18em] text-white/40 font-light mb-1">
                            Σ Wochen-Ø
                          </div>
                          <div className="text-2xl sm:text-3xl font-semibold tabular-nums text-white/80">
                            {formatEUR(projectedWeekTotal.avgSum)}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
                  {visibleSuggestions.map((s) => (
                    <SuggestionCard
                      key={s.chatter}
                      row={s}
                      busy={acceptingChatter === s.chatter}
                      onOpen={() => setSelected(s.chatter)}
                      onAccept={async (goal) => {
                        await acceptSuggestion(s.chatter, goal);
                        applyAcceptedGoal(s.chatter, goal, s.monthRevenue);
                      }}
                      onSkip={() => persistSkip(s.chatter)}
                      onMessage={(goal) =>
                        setMessageFor({ chatter: s.chatter, proposedGoal: goal, currentGoal: s.currentGoal })
                      }
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {tab === "past" && (
          <PastWeeklyGoalsTab
            platform={platform}
            onOpenChatter={(c) => setSelected(c)}
          />
        )}
      </div>

      {messageFor && (
        <GoalMessageDialog
          open={!!messageFor}
          onClose={() => setMessageFor(null)}
          chatter={messageFor.chatter}
          platform={platform}
          proposedGoal={messageFor.proposedGoal}
          currentGoal={messageFor.currentGoal}
          goalType="weekly"
        />
      )}

      {bulkTargets && (
        <BulkGoalMessagesDialog
          open={!!bulkTargets}
          onClose={() => {
            setBulkTargets(null);
          }}
          platform={platform}
          targets={bulkTargets}
          goalType="weekly"
          onAccept={async (chatter, goal) => {
            await acceptSuggestion(chatter, goal, { silentReload: true, silentToast: true });
            const monthRev = suggestions.find((s) => s.chatter === chatter)?.monthRevenue ?? 0;
            applyAcceptedGoal(chatter, goal, monthRev);
          }}
          onSkip={(chatter) => persistSkip(chatter)}
          onUnskip={(chatter) => persistUnskip(chatter)}
          onUnaccept={revertAcceptedGoal}
        />

      )}

      <GoalMessageTemplatesDialog
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        initialTab="weekly"
      />


      <ChatterSlideOver
        open={!!selected}
        chatterName={selected ?? ""}
        platform={platform}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
