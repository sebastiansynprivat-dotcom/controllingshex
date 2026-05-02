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
import { useEffect, useMemo, useState } from "react";
import { Target, Sparkles, TrendingUp, TrendingDown, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePlatform } from "@/contexts/PlatformContext";
import ChatterSlideOver from "@/components/ChatterSlideOver";
import {
  parseGoalFromNote,
  computeGoalProgress,
  formatEUR,
  type GoalProgress,
} from "@/lib/monthly-goals";

const LABEL_NAME = "Monatsziel";

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

function GoalCard({ row, onClick }: { row: ChatterGoalRow; onClick: () => void }) {
  const p = row.progress;
  const deficitColor =
    p.deficit <= 0 ? "text-emerald-300"
    : p.pacePct >= 80 ? "text-amber-300"
    : "text-red-300";

  return (
    <button
      onClick={onClick}
      className="text-left w-full rounded-2xl border border-white/[0.06] bg-gradient-to-br from-white/[0.035] via-white/[0.02] to-transparent p-4 sm:p-5 hover:border-white/[0.12] hover:bg-white/[0.04] transition-all duration-300 group"
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
    </button>
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

export default function MonthlyGoals() {
  const { platform } = usePlatform();
  const [rows, setRows] = useState<ChatterGoalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("deficit");
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Nicht angemeldet");

        // 1) Label-ID finden
        const { data: labels, error: lErr } = await supabase
          .from("chatter_labels")
          .select("id, label_name")
          .eq("platform", platform)
          .eq("label_name", LABEL_NAME);
        if (lErr) throw lErr;
        const labelId = labels?.[0]?.id;
        if (!labelId) {
          if (!cancelled) { setRows([]); setLoading(false); }
          return;
        }

        // 2) Assignments laden
        const { data: assigns, error: aErr } = await supabase
          .from("chatter_label_assignments")
          .select("chatter_name")
          .eq("platform", platform)
          .eq("label_id", labelId);
        if (aErr) throw aErr;
        const chatters = Array.from(new Set((assigns ?? []).map((a) => a.chatter_name)));
        if (chatters.length === 0) {
          if (!cancelled) { setRows([]); setLoading(false); }
          return;
        }

        // 3) Coaching-Notes & Monatsumsatz parallel laden
        const today = new Date();
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
          .toISOString().slice(0, 10);
        const todayIso = today.toISOString().slice(0, 10);

        const [notesRes, histRes] = await Promise.all([
          supabase
            .from("coaching_notes")
            .select("chatter_name, note_text, created_at")
            .eq("platform", platform)
            .in("chatter_name", chatters)
            .order("created_at", { ascending: false }),
          supabase
            .from("chatter_history")
            .select("chatter_name, revenue_today, analysis_date")
            .eq("platform", platform)
            .in("chatter_name", chatters)
            .gte("analysis_date", monthStart)
            .lte("analysis_date", todayIso),
        ]);
        if (notesRes.error) throw notesRes.error;
        if (histRes.error) throw histRes.error;

        // Pro Chatter: neueste Notiz mit Zahl
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

        // Monatsumsatz aggregieren
        const revByChatter = new Map<string, number>();
        for (const h of histRes.data ?? []) {
          revByChatter.set(
            h.chatter_name,
            (revByChatter.get(h.chatter_name) ?? 0) + Number(h.revenue_today ?? 0),
          );
        }

        const built: ChatterGoalRow[] = [];
        for (const c of chatters) {
          const g = goalByChatter.get(c);
          if (!g) continue;
          const rev = revByChatter.get(c) ?? 0;
          built.push({
            chatter: c,
            noteText: g.text,
            noteDate: g.date,
            progress: computeGoalProgress(g.goal, rev, today),
          });
        }

        if (!cancelled) setRows(built);
      } catch (e: any) {
        console.error("[MonthlyGoals] load failed", e);
        if (!cancelled) setError(e?.message ?? "Fehler beim Laden");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [platform]);

  const sortedRows = useMemo(() => {
    const arr = [...rows];
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
  }, [rows, sortKey]);

  const monthName = new Date().toLocaleDateString("de-DE", { month: "long", year: "numeric" });
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
                  ? "Noch keine Chatter mit dem Label „Monatsziel" und einer Zahl in den Notizen."
                  : `${rows.length} Chatter im Tracking · ${onTrackCount} on track · ${formatEUR(totalRev)} von ${formatEUR(totalGoal)} erreicht.`}
              </p>
            </div>
          </div>
        </div>

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

        {/* Content */}
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
              und schreibe eine Zahl in die Coaching-Notizen (z.B. <span className="text-white/80">„2.000"</span>).
            </p>
            <p className="text-xs text-white/35 font-light mt-2">
              Die neueste Notiz mit einer Zahl gilt als aktuelles Ziel.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
            {sortedRows.map((row) => (
              <GoalCard
                key={row.chatter}
                row={row}
                onClick={() => setSelected(row.chatter)}
              />
            ))}
          </div>
        )}
      </div>

      <ChatterSlideOver
        open={!!selected}
        chatterName={selected ?? ""}
        platform={platform}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
