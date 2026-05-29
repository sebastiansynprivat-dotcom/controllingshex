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
import { Target, Sparkles, TrendingUp, TrendingDown, Loader2, Check, X, Pencil, MessageSquare } from "lucide-react";
import GoalMessageDialog from "@/components/GoalMessageDialog";
import BulkGoalMessagesDialog, { type BulkTarget } from "@/components/BulkGoalMessagesDialog";

import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { usePlatform } from "@/contexts/PlatformContext";
import ChatterSlideOver from "@/components/ChatterSlideOver";
import {
  parseGoalFromNote,
  computeGoalProgress,
  formatEUR,
  suggestMonthlyGoal,
  splitAccounts,
  computeModelBaselines,
  suggestFromModels,
  type GoalProgress,
  type GoalStatus,
} from "@/lib/monthly-goals";

const LABEL_NAME = "Monatsziel";

function toIsoDateLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
          <h3 className="text-base sm:text-lg font-semibold text-white/90 truncate group-hover:text-white">
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
  busy,
}: {
  row: SuggestionRow;
  onAccept: (goal: number) => void;
  onSkip: () => void;
  onMessage: (goal: number) => void;
  busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<string>(String(row.suggested));

  const parsed = Math.max(0, Math.round(parseFloat(value.replace(/[^\d.,]/g, "").replace(",", ".")) || 0));

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-br from-emerald-500/[0.04] via-white/[0.02] to-transparent p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="text-base sm:text-lg font-semibold text-white/90 truncate">
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
          Vorgeschlagenes Monatsziel
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

export default function MonthlyGoals() {
  const { platform } = usePlatform();
  const [rows, setRows] = useState<ChatterGoalRow[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("deficit");
  const [statusFilter, setStatusFilter] = useState<GoalStatus | "all">("all");
  const [tab, setTab] = useState<"current" | "future">("current");
  const [selected, setSelected] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [acceptingChatter, setAcceptingChatter] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [messageFor, setMessageFor] = useState<{ chatter: string; proposedGoal: number; currentGoal: number | null } | null>(null);
  const [bulkTargets, setBulkTargets] = useState<BulkTarget[] | null>(null);
  const setBulkOpen = (targets: BulkTarget[]) => setBulkTargets(targets.length > 0 ? targets : null);
  const [suggestionsGenerated, setSuggestionsGenerated] = useState(false);


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
        const reportStart = new Date(today.getFullYear(), today.getMonth(), 2);
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
              }>(() =>
                supabase
                  .from("chatter_history")
                  .select("chatter_name, revenue_today, analysis_date")
                  .eq("platform", platform)
                  .in("chatter_name", labelChatters)
                  .gte("analysis_date", reportStartIso)
                  .lte("analysis_date", todayIso),
              )
            : Promise.resolve([] as Array<{ chatter_name: string; revenue_today: number | null; analysis_date: string }>),
        ]);
        if ((notesRes as any).error) throw (notesRes as any).error;



        // === Aktuelle Monatsziele ===
        const goalByChatter = new Map<string, { goal: number; text: string; date: string }>();
        for (const n of notesRes.data ?? []) {
          if (goalByChatter.has(n.chatter_name)) continue;
          const goal = parseGoalFromNote(n.note_text);
          if (goal != null) {
            goalByChatter.set(n.chatter_name, {
              goal,
              text: n.note_text,
              date: n.created_at,
            });
          }
        }
        const monthRevByChatter = new Map<string, number>();
        for (const h of histMonthRows ?? []) {
          monthRevByChatter.set(
            h.chatter_name,
            (monthRevByChatter.get(h.chatter_name) ?? 0) + Number(h.revenue_today ?? 0),
          );
        }
        const built: ChatterGoalRow[] = [];
        for (const c of labelChatters) {
          const g = goalByChatter.get(c);
          if (!g) continue;
          const rev = monthRevByChatter.get(c) ?? 0;
          built.push({
            chatter: c,
            noteText: g.text,
            noteDate: g.date,
            progress: computeGoalProgress(g.goal, rev, today),
          });
        }

        // === Zukünftige Monatsziele (Vorschläge — basiert auf Model-Performance) ===
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
          const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
          const rawModelGoal = perChatterDailyBaseline * daysInMonth * 1.10;
          const modelGoal = Number.isFinite(rawModelGoal) && rawModelGoal > 0
            ? Math.max(50, Math.round(rawModelGoal / 50) * 50)
            : 0;

          // Smoothing für neue Chatter: wenn jemand erst wenige Tage dabei ist,
          // dürfen 2 gute Tage das Ziel nicht hochreißen.
          // Wir blenden den Chatter-Schnitt linear mit dem Model-Baseline,
          // bis er 14 aktive Tage hat (volles Vertrauen).
          const MIN_DAYS_FULL_TRUST = 14;
          const MIN_DAYS_CHATTER_OVERRIDE = 10; // erst ab so vielen Tagen darf Chatter Model schlagen
          const trustWeight = Math.min(1, days / MIN_DAYS_FULL_TRUST);
          const smoothedAvg = perChatterDailyBaseline > 0
            ? trustWeight * avg + (1 - trustWeight) * perChatterDailyBaseline
            : avg;

          // Wenn Chatter deutlich BESSER als Model-Schnitt performt (>10% drüber),
          // → eigenes Ergebnis + 10 % nehmen statt Model-Schnitt zu deckeln.
          // ABER: nur wenn er genug Datenbasis hat (≥10 Tage).
          const chatterGoal = avg > 1
            ? Math.max(50, Math.round((smoothedAvg * daysInMonth * 1.10) / 50) * 50)
            : 0;

          let basis: "model" | "chatter" | "fallback";
          let suggested: number;
          if (
            modelGoal > 0 &&
            chatterGoal > 0 &&
            days >= MIN_DAYS_CHATTER_OVERRIDE &&
            avg > perChatterDailyBaseline * 1.10
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
            suggested = suggestMonthlyGoal(avg, today);
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


        if (!cancelled) {
          setRows(built);
          setSuggestions(sugg);
        }
      } catch (e: any) {
        console.error("[MonthlyGoals] load failed", e);
        if (!cancelled) setError(e?.message ?? "Fehler beim Laden");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [platform, reloadKey]);

  // Auto-Refresh, sobald ein neuer Report hochgeladen wird (neue chatter_history Rows)
  useEffect(() => {
    const channel = supabase
      .channel(`monthly-goals-history-${platform}`)
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


  async function acceptSuggestion(chatter: string, goal: number) {
    if (goal <= 0) {
      toast.error("Ziel muss > 0 sein");
      return;
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

      // 2) Assignment + Notiz parallel
      const today = new Date();
      const monthLabel = today.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
      const noteText = `Monatsziel ${monthLabel}: ${formatEUR(goal)}`;
      const [assignRes, noteRes] = await Promise.all([
        supabase.from("chatter_label_assignments").insert({
          platform,
          chatter_name: chatter,
          label_id: labelId!,
          user_id: user.id,
        }),
        supabase.from("coaching_notes").insert({
          platform,
          chatter_name: chatter,
          note_text: noteText,
          user_id: user.id,
        }),
      ]);
      if (assignRes.error) throw assignRes.error;
      if (noteRes.error) throw noteRes.error;

      toast.success(`Monatsziel für ${chatter} gesetzt: ${formatEUR(goal)}`);
      setReloadKey((k) => k + 1);
    } catch (e: any) {
      console.error("[MonthlyGoals] accept failed", e);
      toast.error(e?.message ?? "Fehler beim Setzen des Ziels");
    } finally {
      setAcceptingChatter(null);
    }
  }

  const visibleSuggestions = useMemo(
    () => suggestions.filter((s) => !skipped.has(s.chatter)),
    [suggestions, skipped],
  );

  const filteredRows = useMemo(
    () => statusFilter === "all" ? rows : rows.filter((r) => r.progress.status === statusFilter),
    [rows, statusFilter],
  );

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

  const statusCounts = useMemo(() => ({
    on_track: rows.filter((r) => r.progress.status === "on_track").length,
    close: rows.filter((r) => r.progress.status === "close").length,
    off_track: rows.filter((r) => r.progress.status === "off_track").length,
  }), [rows]);

  const today = new Date();
  const trackedThrough = new Date(today);
  trackedThrough.setDate(today.getDate() - 1);
  const monthName = today.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
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
                Dashboard · {monthName}
              </div>
              <h1 className="text-xl sm:text-3xl font-semibold tracking-tight gold-text mt-0.5 sm:mt-1">
                Monatsziele
              </h1>
              <p className="text-[12px] sm:text-sm text-white/55 font-light mt-1 sm:mt-1.5 max-w-2xl leading-relaxed">
                {rows.length === 0
                  ? 'Noch keine Chatter mit dem Label „Monatsziel" und einer Zahl in den Notizen.'
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
            ["current", "Aktuelle Monatsziele", rows.length],
            ["future", "Zukünftige Monatsziele", visibleSuggestions.length],
          ] as ["current" | "future", string, number][]).map(([k, label, count]) => (
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
              <span className={`tabular-nums text-[10px] px-1.5 py-0.5 rounded-full ${
                tab === k ? "bg-white/[0.08] text-white/80" : "bg-white/[0.03] text-white/40"
              }`}>{count}</span>
              {tab === k && (
                <span className="absolute -bottom-px left-0 right-0 h-px bg-emerald-300/60" />
              )}
            </button>
          ))}
        </div>

        {tab === "current" && (
          <>
            {/* Status filter */}
            {rows.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {([
                  ["all", "Alle", rows.length, "border-white/20 bg-white/[0.06] text-white/90"],
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

            {loading ? (
              <div className="flex items-center justify-center py-20 text-white/40">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                <span className="text-sm font-light">Lade Monatsziele…</span>
              </div>
            ) : error ? (
              <div className="rounded-2xl border border-red-400/20 bg-red-500/5 p-6 text-sm text-red-200">
                {error}
              </div>
            ) : rows.length === 0 ? (
              <div className="rounded-2xl border border-white/[0.05] bg-white/[0.015] p-8 text-center">
                <Target className="h-8 w-8 mx-auto text-white/20 mb-3" />
                <p className="text-sm text-white/55 font-light">
                  Vergib im Swipe-Mode oder Slide-Over das Label <span className="text-white/80">„Monatsziel"</span>{" "}
                  und schreibe eine Zahl in die Coaching-Notizen — oder nutze den Tab{" "}
                  <span className="text-white/80">„Zukünftige Monatsziele"</span>.
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
            ) : visibleSuggestions.length === 0 ? (
              <div className="rounded-2xl border border-white/[0.05] bg-white/[0.015] p-8 text-center">
                <Sparkles className="h-8 w-8 mx-auto text-white/20 mb-3" />
                <p className="text-sm text-white/55 font-light">
                  Keine offenen Vorschläge. Alle aktiven Chatter haben bereits ein Monatsziel oder machen weniger als 1 € / Tag im Schnitt.
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <p className="text-[11px] text-white/40 font-light flex-1 min-w-[200px]">
                    Nur Chatter aus dem neuesten Report. Vorschlag = Σ Model-Ø der zugeordneten Models × Tage im Monat × 110 % (auf 50 € gerundet).
                  </p>
                  <button
                    onClick={() =>
                      setBulkOpen(
                        visibleSuggestions.map((s) => ({ chatter: s.chatter, goal: s.suggested })),
                      )
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-emerald-300/30 bg-emerald-400/15 text-emerald-100 text-xs font-light hover:bg-emerald-400/25 transition-colors shrink-0"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    Nachrichten für alle generieren
                  </button>
                </div>


                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
                  {visibleSuggestions.map((s) => (
                    <SuggestionCard
                      key={s.chatter}
                      row={s}
                      busy={acceptingChatter === s.chatter}
                      onAccept={(goal) => acceptSuggestion(s.chatter, goal)}
                      onSkip={() => setSkipped((prev) => new Set(prev).add(s.chatter))}
                      onMessage={(goal) =>
                        setMessageFor({ chatter: s.chatter, proposedGoal: goal, currentGoal: null })
                      }
                    />
                  ))}
                </div>
              </>
            )}
          </>
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
        />
      )}

      {bulkTargets && (
        <BulkGoalMessagesDialog
          open={!!bulkTargets}
          onClose={() => setBulkTargets(null)}
          platform={platform}
          targets={bulkTargets}
        />
      )}


      <ChatterSlideOver
        open={!!selected}
        chatterName={selected ?? ""}
        platform={platform}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
