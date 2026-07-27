import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  RefreshCw, Target, TrendingUp, Check, X, Sparkles, AlertTriangle,
  Zap, Building2, Euro, Loader2, MessageSquareText,
} from "lucide-react";
import { usePlatform } from "@/contexts/PlatformContext";
import {
  BriefingAction, DailyBriefing, generateBriefing, getGoal, getTodayBriefing,
  listActions, setActionStatus, setGoal,
} from "@/lib/daily-briefing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

const eur = (n: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n || 0);

export default function Roadmap() {
  const { platform } = usePlatform();
  const navigate = useNavigate();
  const [briefing, setBriefing] = useState<DailyBriefing | null>(null);
  const [actions, setActions] = useState<BriefingAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [goal, setGoalState] = useState(0);
  const [goalInput, setGoalInput] = useState("");
  const pollRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [b, g] = await Promise.all([getTodayBriefing(platform), getGoal(platform)]);
      setBriefing(b);
      setGoalState(g);
      setGoalInput(g ? String(g) : "");
      setActions(b?.status === "ready" ? await listActions(b.id) : []);
      return b;
    } catch (e: any) {
      toast.error(e.message ?? "Laden fehlgeschlagen");
      return null;
    } finally {
      setLoading(false);
    }
  }, [platform]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // Poll while running
  useEffect(() => {
    if (briefing?.status !== "running") {
      if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    pollRef.current = window.setInterval(async () => {
      const b = await load();
      if (b && b.status !== "running") {
        setGenerating(false);
        if (b.status === "ready") toast.success("Fahrplan ist fertig");
        if (b.status === "error") toast.error(b.error_message ?? "Fehler bei der Generierung");
      }
    }, 4000);
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, [briefing?.status, load]);

  const run = async (force: boolean) => {
    setGenerating(true);
    try {
      await generateBriefing(platform, force);
      toast.info("Fahrplan wird erstellt…");
      await load();
    } catch (e: any) {
      setGenerating(false);
      toast.error(e.message ?? "Generierung fehlgeschlagen");
    }
  };

  const saveGoal = async () => {
    const val = Number(goalInput.replace(/[^\d]/g, ""));
    try {
      await setGoal(platform, val);
      setGoalState(val);
      toast.success("Monatsziel gespeichert");
    } catch (e: any) {
      toast.error(e.message ?? "Speichern fehlgeschlagen");
    }
  };

  const mark = async (a: BriefingAction, status: "done" | "dismissed" | "open") => {
    setActions((prev) => prev.map((x) => (x.id === a.id ? { ...x, status } : x)));
    try { await setActionStatus(a.id, status); }
    catch (e: any) { toast.error(e.message ?? "Fehler"); load(); }
  };

  const askAi = (a: BriefingAction) => {
    const q = `Fahrplan-Aufgabe (${platform}): ${a.title}${a.chatter_name ? ` — ${a.chatter_name}` : ""}. ${a.instruction} Begründung laut Analyse: ${a.reasoning ?? "-"}. Bitte vertiefe das mit den aktuellen Daten und sag mir genau, was ich tun soll.`;
    navigate(`/ai-consultant?q=${encodeURIComponent(q)}`);
  };

  const g = briefing?.goal_snapshot ?? {};
  const goalEur = goal || Number(g.goal_eur) || 0;
  const soFar = Number(g.revenue_so_far) || 0;
  const pct = goalEur > 0 ? Math.min(100, Math.round((soFar / goalEur) * 100)) : 0;

  const open = actions.filter((a) => a.status === "open");
  const quick = open.filter((a) => a.bucket === "quick_win");
  const structural = open.filter((a) => a.bucket === "structural");
  const closed = actions.filter((a) => a.status !== "open");
  const openImpact = open.reduce((s, a) => s + Number(a.impact_eur || 0), 0);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> Fahrplan
          </h1>
          <p className="text-sm text-muted-foreground">
            AI-Tagesplan für {platform} — sortiert nach Umsatz-Impact.
          </p>
        </div>
        <Button onClick={() => run(true)} disabled={generating || briefing?.status === "running"}>
          {generating || briefing?.status === "running"
            ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            : <RefreshCw className="h-4 w-4 mr-2" />}
          Neu generieren
        </Button>
      </header>

      {/* Goal card */}
      <section className="rounded-2xl border border-border/60 bg-card/50 p-5 space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Target className="h-4 w-4 text-primary" /> Monatsziel {platform}
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={goalInput}
              onChange={(e) => setGoalInput(e.target.value)}
              placeholder="z. B. 150000"
              className="h-9 w-36"
              inputMode="numeric"
            />
            <Button size="sm" variant="secondary" onClick={saveGoal}>Speichern</Button>
          </div>
        </div>

        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Metric label="Bisher" value={eur(soFar)} />
          <Metric label="Ziel" value={eur(goalEur)} />
          <Metric label="Nötig / Tag" value={eur(Number(g.needed_daily) || 0)} />
          <Metric
            label="Prognose"
            value={eur(Number(g.projected_month) || 0)}
            tone={goalEur > 0 && Number(g.projected_month) < goalEur ? "bad" : "good"}
          />
        </div>
      </section>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
        </div>
      ) : !briefing ? (
        <EmptyState onRun={() => run(false)} busy={generating} />
      ) : briefing.status === "running" ? (
        <div className="rounded-2xl border border-border/60 bg-card/50 p-8 text-center space-y-2">
          <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
          <p className="text-sm text-muted-foreground">Die AI analysiert gerade alle Daten und baut deinen Fahrplan…</p>
        </div>
      ) : briefing.status === "error" ? (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-5 space-y-3">
          <p className="text-sm text-destructive">{briefing.error_message ?? "Fehler bei der Generierung"}</p>
          <Button size="sm" onClick={() => run(true)}>Erneut versuchen</Button>
        </div>
      ) : (
        <>
          {/* Situation */}
          <section className="rounded-2xl border border-border/60 bg-gradient-to-br from-primary/[0.07] to-transparent p-5 space-y-2">
            {briefing.headline && <h2 className="text-lg font-semibold tracking-tight">{briefing.headline}</h2>}
            {briefing.situation && (
              <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">{briefing.situation}</p>
            )}
            <div className="flex items-center gap-2 pt-1">
              <Badge variant="secondary" className="gap-1">
                <Euro className="h-3 w-3" /> Offenes Potenzial heute: {eur(openImpact)}
              </Badge>
              <Badge variant="outline">{open.length} offene Aufgaben</Badge>
            </div>
          </section>

          {/* Patterns */}
          {briefing.patterns?.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <TrendingUp className="h-4 w-4" /> Erkannte Muster
              </h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {briefing.patterns.map((p, i) => (
                  <div key={i} className="rounded-xl border border-border/60 bg-card/40 p-3">
                    <div className="flex items-center gap-2 mb-1">
                      {p.severity === "critical" && <AlertTriangle className="h-3.5 w-3.5 text-destructive" />}
                      <span className="text-[13px] font-medium">{p.title}</span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{p.detail}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          <ActionGroup
            icon={<Zap className="h-4 w-4 text-primary" />}
            title="Quick Wins — heute umsetzbar"
            actions={quick}
            onMark={mark}
            onAsk={askAi}
          />
          <ActionGroup
            icon={<Building2 className="h-4 w-4 text-primary" />}
            title="Strukturelle Hebel"
            actions={structural}
            onMark={mark}
            onAsk={askAi}
          />

          {closed.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground">Erledigt / verworfen ({closed.length})</h3>
              <div className="space-y-1.5">
                {closed.map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-card/20 px-3 py-2">
                    <span className="text-xs text-muted-foreground line-through truncate">{a.title}</span>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => mark(a, "open")}>
                      Zurückholen
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-xl bg-muted/30 px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold ${tone === "bad" ? "text-destructive" : tone === "good" ? "text-primary" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function EmptyState({ onRun, busy }: { onRun: () => void; busy: boolean }) {
  return (
    <div className="rounded-2xl border border-dashed border-border/60 p-10 text-center space-y-3">
      <Sparkles className="h-7 w-7 mx-auto text-primary" />
      <p className="text-sm text-muted-foreground">
        Noch kein Fahrplan für heute. Nach jedem Report-Upload wird er automatisch erstellt — oder jetzt manuell starten.
      </p>
      <Button onClick={onRun} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
        Fahrplan erstellen
      </Button>
    </div>
  );
}

function ActionGroup({
  icon, title, actions, onMark, onAsk,
}: {
  icon: React.ReactNode;
  title: string;
  actions: BriefingAction[];
  onMark: (a: BriefingAction, s: "done" | "dismissed" | "open") => void;
  onAsk: (a: BriefingAction) => void;
}) {
  if (actions.length === 0) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold flex items-center gap-2">{icon} {title}</h3>
      <div className="space-y-2">
        {actions.map((a) => (
          <article key={a.id} className="rounded-2xl border border-border/60 bg-card/40 p-4 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-semibold">{a.title}</span>
                  {a.chatter_name && <Badge variant="outline" className="text-[10px]">{a.chatter_name}</Badge>}
                  {a.account && <Badge variant="secondary" className="text-[10px]">{a.account}</Badge>}
                </div>
                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{a.instruction}</p>
                {a.reasoning && (
                  <p className="text-[11px] text-muted-foreground/70 mt-1.5 leading-relaxed">{a.reasoning}</p>
                )}
              </div>
              <div className="shrink-0 text-right">
                <div className="text-sm font-semibold text-primary">+{eur(Number(a.impact_eur))}</div>
                {a.confidence && <div className="text-[10px] text-muted-foreground">{a.confidence}</div>}
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Button size="sm" className="h-7 text-xs" onClick={() => onMark(a, "done")}>
                <Check className="h-3 w-3 mr-1" /> Erledigt
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onAsk(a)}>
                <MessageSquareText className="h-3 w-3 mr-1" /> Mit AI vertiefen
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => onMark(a, "dismissed")}>
                <X className="h-3 w-3 mr-1" /> Verwerfen
              </Button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
