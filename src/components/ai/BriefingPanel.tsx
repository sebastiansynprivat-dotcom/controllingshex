import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  RefreshCw, Target, TrendingUp, Check, X, Sparkles, AlertTriangle,
  Zap, Building2, Euro, Loader2, MessageSquareText, ChevronDown,
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

export default function BriefingPanel({ onAsk }: { onAsk: (question: string) => void }) {
  const { platform } = usePlatform();
  const [briefing, setBriefing] = useState<DailyBriefing | null>(null);
  const [actions, setActions] = useState<BriefingAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [open, setOpen] = useState(true);
  const [goal, setGoalState] = useState(0);
  const [goalInput, setGoalInput] = useState("");
  const pollRef = useRef<number | null>(null);
  const autoRef = useRef(false);


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
    autoRef.current = false;
    load().then((b) => {
      // Auto-Fahrplan: ohne Klick starten, wenn heute noch keiner existiert
      if (!b && !autoRef.current) {
        autoRef.current = true;
        run(false);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);


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

  const ask = (a: BriefingAction) => {
    onAsk(
      `Fahrplan-Aufgabe (${platform}): ${a.title}${a.chatter_name ? ` — ${a.chatter_name}` : ""}. ${a.instruction} Begründung laut Analyse: ${a.reasoning ?? "-"}. Bitte vertiefe das mit den aktuellen Daten und sag mir genau, was ich tun soll.`
    );
  };

  const g = briefing?.goal_snapshot ?? {};
  const goalEur = goal || Number(g.goal_eur) || 0;
  const soFar = Number(g.revenue_so_far) || 0;
  const pct = goalEur > 0 ? Math.min(100, Math.round((soFar / goalEur) * 100)) : 0;

  const openActions = actions.filter((a) => a.status === "open");
  const quick = openActions.filter((a) => a.bucket === "quick_win");
  const structural = openActions.filter((a) => a.bucket === "structural");
  const closed = actions.filter((a) => a.status !== "open");
  const openImpact = openActions.reduce((s, a) => s + Number(a.impact_eur || 0), 0);

  return (
    <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      <header className="flex items-center gap-3 px-4 sm:px-5 py-3">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 min-w-0 flex-1 text-left"
        >
          <Sparkles className="h-4 w-4 shrink-0 text-primary/70" />
          <span className="text-sm font-light text-foreground/90 truncate">Fahrplan heute · {platform}</span>
          {briefing?.status === "ready" && (
            <span className="text-[11px] text-primary/80 font-light shrink-0">
              {openActions.length} offen · +{eur(openImpact)}
            </span>
          )}
          {(briefing?.status === "running" || generating) && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary/70 shrink-0" />
          )}
          <ChevronDown className={`h-4 w-4 shrink-0 text-white/30 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-[11px] shrink-0"
          onClick={() => run(true)}
          disabled={generating || briefing?.status === "running"}
        >
          <RefreshCw className="h-3 w-3 mr-1" /> Neu
        </Button>
      </header>

      {open && (
        <div className="px-4 sm:px-5 pb-5 space-y-5">
          {/* Goal */}
          <div className="rounded-xl border border-white/[0.05] bg-black/20 p-4 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 text-xs font-light text-foreground/80">
                <Target className="h-3.5 w-3.5 text-primary/70" /> Monatsziel {platform}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={goalInput}
                  onChange={(e) => setGoalInput(e.target.value)}
                  placeholder="z. B. 150000"
                  className="h-8 w-32 text-xs"
                  inputMode="numeric"
                />
                <Button size="sm" variant="secondary" className="h-8 text-xs" onClick={saveGoal}>Speichern</Button>
              </div>
            </div>
            <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Metric label="Bisher" value={eur(soFar)} />
              <Metric label="Ziel" value={eur(goalEur)} />
              <Metric label="Nötig / Tag" value={eur(Number(g.needed_daily) || 0)} />
              <Metric
                label="Prognose"
                value={eur(Number(g.projected_month) || 0)}
                tone={goalEur > 0 && Number(g.projected_month) < goalEur ? "bad" : "good"}
              />
            </div>
          </div>

          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-20 w-full rounded-xl" />
              <Skeleton className="h-28 w-full rounded-xl" />
            </div>
          ) : !briefing ? (
            <div className="rounded-xl border border-dashed border-white/[0.08] p-8 text-center space-y-3">
              <p className="text-xs text-white/35 font-light">
                Noch kein Fahrplan für heute. Nach jedem Report-Upload entsteht er automatisch — oder jetzt starten.
              </p>
              <Button size="sm" onClick={() => run(false)} disabled={generating}>
                {generating ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
                Fahrplan erstellen
              </Button>
            </div>
          ) : briefing.status === "running" ? (
            <div className="rounded-xl border border-white/[0.05] p-8 text-center space-y-2">
              <Loader2 className="h-5 w-5 animate-spin mx-auto text-primary/70" />
              <p className="text-xs text-white/35 font-light">Die AI analysiert alle Daten und baut deinen Fahrplan…</p>
            </div>
          ) : briefing.status === "error" ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 space-y-2">
              <p className="text-xs text-destructive">{briefing.error_message ?? "Fehler bei der Generierung"}</p>
              <Button size="sm" onClick={() => run(true)}>Erneut versuchen</Button>
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-primary/10 bg-gradient-to-br from-primary/[0.07] to-transparent p-4 space-y-2">
                {briefing.headline && <h2 className="text-sm font-medium tracking-tight">{briefing.headline}</h2>}
                {briefing.situation && (
                  <p className="text-xs text-white/45 font-light leading-relaxed whitespace-pre-line">{briefing.situation}</p>
                )}
                <div className="flex items-center gap-2 pt-1 flex-wrap">
                  <Badge variant="secondary" className="gap-1 text-[10px]">
                    <Euro className="h-3 w-3" /> Offenes Potenzial: {eur(openImpact)}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">{openActions.length} offene Aufgaben</Badge>
                </div>
              </div>

              {briefing.patterns?.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-medium flex items-center gap-2 text-foreground/70">
                    <TrendingUp className="h-3.5 w-3.5" /> Erkannte Muster
                  </h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {briefing.patterns.map((p, i) => (
                      <div key={i} className="rounded-xl border border-white/[0.05] bg-black/20 p-3">
                        <div className="flex items-center gap-2 mb-1">
                          {p.severity === "critical" && <AlertTriangle className="h-3.5 w-3.5 text-destructive" />}
                          <span className="text-[12px] font-medium">{p.title}</span>
                        </div>
                        <p className="text-[11px] text-white/40 font-light leading-relaxed">{p.detail}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <ActionGroup
                icon={<Zap className="h-3.5 w-3.5 text-primary/70" />}
                title={`Quick Wins — heute umsetzbar (${quick.length})`}
                actions={quick}
                onMark={mark}
                onAsk={ask}
              />
              <ActionGroup
                icon={<Building2 className="h-3.5 w-3.5 text-primary/70" />}
                title={`Strukturelle Hebel (${structural.length})`}
                actions={structural}
                onMark={mark}
                onAsk={ask}
              />

              {closed.length > 0 && (
                <div className="space-y-1.5">
                  <h3 className="text-xs font-medium text-white/35">Erledigt / verworfen ({closed.length})</h3>
                  {closed.map((a) => (
                    <div key={a.id} className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.04] bg-black/10 px-3 py-2">
                      <span className="text-[11px] text-white/30 line-through truncate">{a.title}</span>
                      <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => mark(a, "open")}>
                        Zurückholen
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-lg bg-white/[0.03] px-3 py-2">
      <div className="text-[10px] text-white/30 font-light">{label}</div>
      <div className={`text-xs font-medium ${tone === "bad" ? "text-destructive" : tone === "good" ? "text-primary" : ""}`}>
        {value}
      </div>
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
    <div className="space-y-2">
      <h3 className="text-xs font-medium flex items-center gap-2 text-foreground/70">{icon} {title}</h3>
      <div className="space-y-2">
        {actions.map((a) => (
          <article key={a.id} className="rounded-xl border border-white/[0.05] bg-black/20 p-3.5 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[12px] font-semibold">{a.title}</span>
                  {a.chatter_name && <Badge variant="outline" className="text-[10px]">{a.chatter_name}</Badge>}
                  {a.account && <Badge variant="secondary" className="text-[10px]">{a.account}</Badge>}
                </div>
                <p className="text-[11px] text-white/45 font-light mt-1.5 leading-relaxed">{a.instruction}</p>
                {a.reasoning && (
                  <p className="text-[10px] text-white/25 font-light mt-1.5 leading-relaxed">{a.reasoning}</p>
                )}
              </div>
              <div className="shrink-0 text-right">
                <div className="text-xs font-semibold text-primary">+{eur(Number(a.impact_eur))}</div>
                {a.confidence && <div className="text-[10px] text-white/25">{a.confidence}</div>}
              </div>
            </div>
            <div className="flex items-center gap-1.5 pt-0.5">
              <Button size="sm" className="h-6 text-[11px]" onClick={() => onMark(a, "done")}>
                <Check className="h-3 w-3 mr-1" /> Erledigt
              </Button>
              <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => onAsk(a)}>
                <MessageSquareText className="h-3 w-3 mr-1" /> Vertiefen
              </Button>
              <Button size="sm" variant="ghost" className="h-6 text-[11px] text-white/35" onClick={() => onMark(a, "dismissed")}>
                <X className="h-3 w-3 mr-1" /> Verwerfen
              </Button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
