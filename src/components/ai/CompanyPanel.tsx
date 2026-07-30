import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  RefreshCw, TrendingUp, Users, ArrowLeftRight, Building2,
  MessageSquareText, Loader2, AlertTriangle, Info, AlertCircle,
} from "lucide-react";
import { usePlatform } from "@/contexts/PlatformContext";
import {
  CompanyDigest, CompanyDigestCard, CompanyDigestSection,
  countCriticalSignals, countCards, generateDigest, getTodayDigest,
} from "@/lib/company-digest";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

const eur = (n: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n || 0);

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  revenue: TrendingUp,
  operations: Users,
  staffing: ArrowLeftRight,
  accounts: Building2,
};

const SEVERITY_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  info: Info,
  warn: AlertTriangle,
  critical: AlertCircle,
};

const SEVERITY_STYLE: Record<string, string> = {
  info: "border-white/[0.06] bg-white/[0.02] text-white/70",
  warn: "border-amber-400/20 bg-amber-400/[0.06] text-amber-400/90",
  critical: "border-red-400/20 bg-red-400/[0.06] text-red-400/90",
};

const SEVERITY_DOT: Record<string, string> = {
  info: "bg-white/30",
  warn: "bg-amber-400",
  critical: "bg-red-400",
};

export default function CompanyPanel({ onAsk }: { onAsk: (question: string) => void }) {
  const { platform } = usePlatform();
  const [digest, setDigest] = useState<CompanyDigest | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const pollRef = useRef<number | null>(null);
  const autoRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const d = await getTodayDigest(platform);
      setDigest(d);
      return d;
    } catch (e: any) {
      toast.error(e.message ?? "Company-Digest konnte nicht geladen werden");
      return null;
    } finally {
      setLoading(false);
    }
  }, [platform]);

  useEffect(() => {
    setLoading(true);
    autoRef.current = false;
    load().then((d) => {
      if (!d && !autoRef.current) {
        autoRef.current = true;
        run(false);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  useEffect(() => {
    if (digest?.status !== "running") {
      if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    pollRef.current = window.setInterval(async () => {
      const d = await load();
      if (d && d.status !== "running") {
        setGenerating(false);
        if (d.status === "ready") toast.success("Company-Digest ist fertig");
        if (d.status === "error") toast.error(d.error_message ?? "Fehler bei der Generierung");
      }
    }, 4000);
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, [digest?.status, load]);

  const run = async (force: boolean) => {
    setGenerating(true);
    try {
      await generateDigest(platform, force);
      toast.info("Company-Digest wird erstellt…");
      await load();
    } catch (e: any) {
      setGenerating(false);
      toast.error(e.message ?? "Generierung fehlgeschlagen");
    }
  };

  const criticalCount = countCriticalSignals(digest);
  const cardCount = countCards(digest);

  return (
    <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      <header className="flex items-center gap-3 px-4 sm:px-5 py-3">
        <div className="flex items-center gap-2 min-w-0 flex-1 text-left">
          <Building2 className="h-4 w-4 shrink-0 text-primary/70" />
          <span className="text-sm font-light text-foreground/90 truncate">Company · heute · {platform}</span>
          {digest?.status === "ready" && (
            <span className="text-[11px] text-primary/80 font-light shrink-0">
              {cardCount} Karten {criticalCount > 0 ? `· ${criticalCount} Signal${criticalCount === 1 ? "" : "e"}` : ""}
            </span>
          )}
          {(digest?.status === "running" || generating) && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary/70 shrink-0" />
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-[11px] shrink-0"
          onClick={() => run(true)}
          disabled={generating || digest?.status === "running"}
        >
          <RefreshCw className="h-3 w-3 mr-1" /> Neu
        </Button>
      </header>

      <div className="px-4 sm:px-5 pb-5 space-y-5">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-28 w-full rounded-xl" />
            <Skeleton className="h-28 w-full rounded-xl" />
          </div>
        ) : !digest ? (
          <div className="rounded-xl border border-white/[0.05] p-8 text-center space-y-2">
            <Loader2 className="h-5 w-5 animate-spin mx-auto text-primary/70" />
            <p className="text-xs text-white/35 font-light">
              Der Company-Digest für heute wird automatisch erstellt…
            </p>
          </div>
        ) : digest.status === "running" ? (
          <div className="rounded-xl border border-white/[0.05] p-8 text-center space-y-2">
            <Loader2 className="h-5 w-5 animate-spin mx-auto text-primary/70" />
            <p className="text-xs text-white/35 font-light">
              Die AI analysiert alle aktiven Chatters und Accounts…
            </p>
          </div>
        ) : digest.status === "error" ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 space-y-2">
            <p className="text-xs text-destructive">{digest.error_message ?? "Fehler bei der Generierung"}</p>
            <Button size="sm" onClick={() => run(true)}>Erneut versuchen</Button>
          </div>
        ) : (
          <div className="space-y-6">
            {digest.sections_json?.length === 0 && (
              <div className="rounded-xl border border-white/[0.05] p-6 text-center">
                <p className="text-xs text-white/35 font-light">Keine Signale erkannt.</p>
              </div>
            )}
            {digest.sections_json?.map((section) => (
              <SectionBlock key={section.section_key} section={section} onAsk={onAsk} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function SectionBlock({
  section,
  onAsk,
}: {
  section: CompanyDigestSection;
  onAsk: (question: string) => void;
}) {
  const Icon = ICONS[section.section_key] ?? Building2;
  const signalCount = section.signals?.filter((s) => s.severity === "warn" || s.severity === "critical").length ?? 0;

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 h-8 w-8 shrink-0 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center">
          <Icon className="h-4 w-4 text-white/45" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-medium text-foreground/90">{section.section_title}</h3>
            {signalCount > 0 && (
              <Badge variant="outline" className="text-[10px] border-amber-400/20 text-amber-400/80">
                {signalCount} Signal{signalCount === 1 ? "" : "e"}
              </Badge>
            )}
          </div>
          {section.summary && (
            <p className="text-xs text-white/40 font-light mt-1 leading-relaxed">{section.summary}</p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {section.cards?.map((card, idx) => (
          <Card key={idx} card={card} sectionTitle={section.section_title} onAsk={onAsk} />
        ))}
      </div>
    </div>
  );
}

function Card({
  card,
  sectionTitle,
  onAsk,
}: {
  card: CompanyDigestCard;
  sectionTitle: string;
  onAsk: (question: string) => void;
}) {
  const SeverityIcon = SEVERITY_ICON[card.severity] ?? Info;
  return (
    <div className={`rounded-xl border p-3.5 space-y-2 ${SEVERITY_STYLE[card.severity] ?? SEVERITY_STYLE.info}`}>
      <div className="flex items-start gap-2.5">
        <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${SEVERITY_DOT[card.severity] ?? SEVERITY_DOT.info}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-[12px] font-medium leading-snug">{card.title}</h4>
            {card.tags?.map((tag) => (
              <Badge key={tag} variant="outline" className="text-[9px] px-1 py-0 h-4 border-white/[0.08] text-white/40">
                {tag}
              </Badge>
            ))}
          </div>
          <p className="text-[11px] font-light leading-relaxed mt-1 opacity-80">{card.detail}</p>
          {card.recommendation && (
            <p className="text-[11px] font-light leading-relaxed mt-1.5 text-primary/75">
              → {card.recommendation}
            </p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-xs font-semibold text-primary">{card.impact_eur >= 0 ? "+" : ""}{eur(card.impact_eur)}</div>
          <div className="text-[10px] text-white/25">/ Tag</div>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-[11px] font-light text-white/45 hover:text-white/80"
          onClick={() =>
            onAsk(
              `${sectionTitle}: ${card.title}. ${card.detail} Empfohlene Handlung: ${card.recommendation}. Bitte vertiefe das mit den aktuellen Daten und sag mir genau, was ich tun soll.`
            )
          }
        >
          <MessageSquareText className="h-3 w-3 mr-1" /> Im Chat besprechen
        </Button>
      </div>
    </div>
  );
}
