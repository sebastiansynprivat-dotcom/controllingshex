import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  RefreshCw, ArrowLeftRight, UserMinus, UserPlus, MinusCircle, PlusCircle,
  Check, Undo2, MessageSquareText, Loader2, TrendingUp, TrendingDown, Eye,
} from "lucide-react";
import { usePlatform } from "@/contexts/PlatformContext";
import {
  ActionEvent, EVENT_LABEL, VERDICT_LABEL, evaluateActionEvents,
  listActionEvents, setEventStatus, summarizePatterns,
} from "@/lib/action-events";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const eur = (n: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n || 0);

const ICONS: Record<string, any> = {
  account_reassigned: ArrowLeftRight,
  account_removed: MinusCircle,
  account_added: PlusCircle,
  chatter_onboarded: UserPlus,
  chatter_offboarded: UserMinus,
};

const VERDICT_STYLE: Record<string, string> = {
  good: "text-emerald-400 border-emerald-400/20 bg-emerald-400/[0.06]",
  bad: "text-red-400 border-red-400/20 bg-red-400/[0.06]",
  neutral: "text-white/40 border-white/10 bg-white/[0.03]",
  watch: "text-amber-400 border-amber-400/20 bg-amber-400/[0.06]",
};

function Delta({ before, after }: { before: number; after: number }) {
  const diff = (after || 0) - (before || 0);
  const up = diff >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 ${up ? "text-emerald-400/80" : "text-red-400/80"}`}>
      <Icon className="h-3 w-3" />
      {eur(before)} → {eur(after)}
    </span>
  );
}

export default function ActionReviewPanel({ onAsk }: { onAsk: (question: string) => void }) {
  const { platform } = usePlatform();
  const [events, setEvents] = useState<ActionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    try {
      setEvents(await listActionEvents(platform));
    } catch (e: any) {
      toast.error(e.message ?? "Rückblick konnte nicht geladen werden");
    } finally {
      setLoading(false);
    }
  }, [platform]);

  useEffect(() => {
    setLoading(true);
    load().then(() => {
      // Fällige Bewertungen still im Hintergrund nachziehen
      evaluateActionEvents(platform).then((r) => { if (r?.evaluated) load(); }).catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const rerun = async () => {
    setRunning(true);
    try {
      const r = await evaluateActionEvents(platform, true);
      toast.success(r?.evaluated ? `${r.evaluated} Entscheidungen neu bewertet` : "Nichts Neues zu bewerten");
      await load();
    } catch (e: any) {
      toast.error(e.message ?? "Bewertung fehlgeschlagen");
    } finally {
      setRunning(false);
    }
  };

  const mark = async (e: ActionEvent, status: string) => {
    try {
      await setEventStatus(e.id, status);
      setEvents((prev) => prev.filter((x) => x.id !== e.id));
    } catch (err: any) {
      toast.error(err.message ?? "Konnte nicht gespeichert werden");
    }
  };

  const patterns = summarizePatterns(events);
  const bad = events.filter((e) => e.verdict === "bad");
  const rest = events.filter((e) => e.verdict !== "bad");

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }

  const card = (e: ActionEvent) => {
    const Icon = ICONS[e.event_type] ?? Eye;
    const o = e.outcome_json ?? {};
    return (
      <div key={e.id} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 sm:p-5 space-y-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 h-8 w-8 shrink-0 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center">
            <Icon className="h-4 w-4 text-white/45" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-light text-white/85">
              {EVENT_LABEL[e.event_type] ?? e.event_type}
              {e.account ? <span className="text-white/45"> · {e.account}</span> : null}
            </p>
            <p className="text-[11px] text-white/35 font-light mt-0.5">
              {e.chatter_name}
              {e.counterpart_chatter ? ` ← ${e.counterpart_chatter}` : ""} · erkannt am{" "}
              {new Date(e.detected_on).toLocaleDateString("de-DE")}
            </p>
          </div>
          {e.verdict && (
            <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-light ${VERDICT_STYLE[e.verdict]}`}>
              {VERDICT_LABEL[e.verdict as keyof typeof VERDICT_LABEL]}
            </span>
          )}
        </div>

        {(o.chatter_avg_before != null || o.account_avg_before != null) && (
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] font-light text-white/40">
            {o.account_avg_before != null && (
              <span>Account/Tag: <Delta before={o.account_avg_before} after={o.account_avg_after} /></span>
            )}
            {o.chatter_avg_before != null && (
              <span>Chatter/Tag: <Delta before={o.chatter_avg_before} after={o.chatter_avg_after} /></span>
            )}
            {o.live_oldest_chat_days != null && (
              <span>Verzug jetzt: {o.live_oldest_chat_days} Tage · {o.live_unread ?? 0} offen</span>
            )}
          </div>
        )}

        {e.verdict_reason && (
          <p className="text-xs font-light leading-relaxed text-white/60">{e.verdict_reason}</p>
        )}
        {e.recommendation && (
          <p className="text-xs font-light leading-relaxed text-primary/75">→ {e.recommendation}</p>
        )}
        {!e.verdict && (
          <p className="text-xs font-light text-white/30">
            Wird ab 3 Tagen nach der Handlung automatisch bewertet.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {!!e.impact_eur && (
            <span className={`text-[11px] font-light ${e.impact_eur < 0 ? "text-red-400/80" : "text-emerald-400/80"}`}>
              {e.impact_eur > 0 ? "+" : ""}{eur(e.impact_eur)} / Tag
            </span>
          )}
          <div className="flex-1" />
          <Button
            size="sm" variant="ghost"
            className="h-7 px-2 text-[11px] font-light text-white/45 hover:text-white/80"
            onClick={() => onAsk(
              `Rückblick: ${EVENT_LABEL[e.event_type] ?? e.event_type} — ${e.chatter_name ?? ""}${
                e.account ? ` auf ${e.account}` : ""
              } (${new Date(e.detected_on).toLocaleDateString("de-DE")}). Was ist seither passiert und was soll ich jetzt tun?`,
            )}
          >
            <MessageSquareText className="h-3 w-3 mr-1" /> Im Chat besprechen
          </Button>
          <Button
            size="sm" variant="ghost"
            className="h-7 px-2 text-[11px] font-light text-white/45 hover:text-amber-400"
            onClick={() => mark(e, "reverted")}
          >
            <Undo2 className="h-3 w-3 mr-1" /> Zurückgedreht
          </Button>
          <Button
            size="sm" variant="ghost"
            className="h-7 px-2 text-[11px] font-light text-white/45 hover:text-emerald-400"
            onClick={() => mark(e, "accepted")}
          >
            <Check className="h-3 w-3 mr-1" /> Passt so
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-extralight text-foreground tracking-tight">Rückblick</h1>
          <p className="text-xs text-white/30 font-light mt-1 max-w-lg">
            Deine Besetzungs-Entscheidungen werden automatisch aus den Reports erkannt und nach ein paar Tagen
            gegen die tatsächliche Umsatzentwicklung geprüft.
          </p>
        </div>
        <Button
          size="sm" variant="outline"
          className="shrink-0 h-8 text-[11px] font-light border-white/10 bg-white/[0.02]"
          onClick={rerun} disabled={running}
        >
          {running ? <Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1.5" />}
          Neu bewerten
        </Button>
      </div>

      {patterns.length > 0 && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.015] p-4">
          <p className="text-[11px] uppercase tracking-wider text-white/25 font-light mb-2">Muster</p>
          <div className="space-y-1">
            {patterns.map((p) => (
              <p key={p.event_type} className="text-xs font-light text-white/50">
                {EVENT_LABEL[p.event_type] ?? p.event_type}: {p.good} von {p.total} haben funktioniert
                {p.bad > 0 ? `, ${p.bad} gingen nach hinten los` : ""}
              </p>
            ))}
          </div>
        </div>
      )}

      {events.length === 0 && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-8 text-center">
          <p className="text-sm font-light text-white/40">
            Noch keine Handlungen erkannt. Sobald sich zwischen zwei Reports eine Besetzung ändert, taucht sie hier auf.
          </p>
        </div>
      )}

      {bad.length > 0 && (
        <div className="space-y-3">
          <p className="text-[11px] uppercase tracking-wider text-red-400/50 font-light">
            Nochmal reinschauen ({bad.length})
          </p>
          {bad.map(card)}
        </div>
      )}

      {rest.length > 0 && (
        <div className="space-y-3">
          <p className="text-[11px] uppercase tracking-wider text-white/25 font-light">Weitere Entscheidungen</p>
          {rest.map(card)}
        </div>
      )}
    </div>
  );
}
