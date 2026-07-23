import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Loader2, ArrowRight, ArrowLeft, Trophy, Flame, Sparkles, Target,
  MessageCircle, TrendingDown, TrendingUp, Star, Crown, Send, Check, X,
  ChevronDown, Zap, Heart, DollarSign,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  CoachingAnalysisRow,
  CoachingProgress,
  Lever,
  BossFightTurn,
  loadAnalysisByToken,
  updateProgress,
  evaluateDrill,
  bossFightCustomerReply,
  bossFightFinalScore,
  levelFromXp,
} from "@/lib/coaching";

/* ----------------------------- Card model ----------------------------- */

type CardKind =
  | "cover"
  | "weekly"
  | "lever_intro"
  | "customer_card"
  | "context"
  | "situation"
  | "chatter_did"
  | "money_loss"
  | "better"
  | "drill"
  | "type_drill"
  | "boss_anecdote"
  | "takeaway"
  | "quiz"
  | "sbi_strength"
  | "sbi_growth"
  | "boss_fight"
  | "commitment"
  | "final";

interface StoryCard {
  kind: CardKind;
  leverIndex?: number;
  roundIndex?: number;
}

/* ----------------------------- Component ----------------------------- */

export default function CoachingView() {
  const { token } = useParams<{ token: string }>();
  const [row, setRow] = useState<CoachingAnalysisRow | null>(null);
  const [progress, setProgress] = useState<CoachingProgress>({});
  const [xp, setXp] = useState(0);
  const [cardIdx, setCardIdx] = useState(0);
  const [commitment, setCommitment] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [direction, setDirection] = useState<1 | -1>(1);
  const saveTimer = useRef<any>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    loadAnalysisByToken(token)
      .then((r) => {
        setRow(r);
        setProgress(r.progress_json ?? {});
        setXp(r.xp_earned ?? 0);
        setCardIdx(Math.max(0, r.current_card_index ?? 0));
        setCommitment(r.commitment_text ?? "");
      })
      .catch((e) => setError(e.message ?? "Fehler beim Laden"))
      .finally(() => setLoading(false));
  }, [token]);

  const result = row?.summary_json ?? ({} as any);
  const levers: Lever[] = Array.isArray(result.top_3_levers) ? result.top_3_levers : [];
  const bossScenario = result.boss_scenario ?? null;
  const chatterFirstName = (row?.chatter_name ?? "").split(/\s+/)[0] || "Champ";

  const cards = useMemo<StoryCard[]>(() => {
    if (!row) return [];
    const list: StoryCard[] = [{ kind: "cover" }];
    if (result.weekly_comparison) list.push({ kind: "weekly" });
    levers.forEach((lv, i) => {
      list.push({ kind: "lever_intro", leverIndex: i });
      if (lv.customer_card) list.push({ kind: "customer_card", leverIndex: i });
      if (lv.context_messages && lv.context_messages.length) list.push({ kind: "context", leverIndex: i });
      if (lv.situation_summary) list.push({ kind: "situation", leverIndex: i });
      const sb = lv.storyboard ?? [];
      if (sb[0]?.chatter_did) list.push({ kind: "chatter_did", leverIndex: i, roundIndex: 0 });
      if (lv.money_line) list.push({ kind: "money_loss", leverIndex: i });
      if (sb[1]?.better_version) list.push({ kind: "better", leverIndex: i, roundIndex: 1 });
      if (lv.drill) list.push({ kind: "drill", leverIndex: i });
      if (lv.drill) list.push({ kind: "type_drill", leverIndex: i });
      if (lv.boss_anecdote) list.push({ kind: "boss_anecdote", leverIndex: i });
      if (sb[2]?.say_this) list.push({ kind: "takeaway", leverIndex: i, roundIndex: 2 });
      if (lv.quiz) list.push({ kind: "quiz", leverIndex: i });
    });
    if (result.sbi_feedback?.strength) list.push({ kind: "sbi_strength" });
    if (result.sbi_feedback?.growth) list.push({ kind: "sbi_growth" });
    if (bossScenario) list.push({ kind: "boss_fight" });
    list.push({ kind: "commitment" });
    list.push({ kind: "final" });
    return list;
  }, [row, result, levers, bossScenario]);

  const safeCardIdx = Math.min(cardIdx, Math.max(0, cards.length - 1));
  const currentCard = cards[safeCardIdx];
  const totalCards = cards.length;
  const overallProgress = totalCards ? (safeCardIdx + 1) / totalCards : 0;
  const level = levelFromXp(xp);

  const persist = useCallback((patch: Parameters<typeof updateProgress>[1]) => {
    if (!token) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      updateProgress(token, patch).catch((e) => console.warn("save failed", e));
    }, 400);
  }, [token]);

  const grantXp = useCallback((amount: number) => {
    setXp((v) => {
      const nv = v + amount;
      persist({ xp_earned: nv });
      return nv;
    });
    if (amount >= 25) toast.success(`+${amount} XP`, { duration: 1500 });
  }, [persist]);

  const goNext = useCallback(() => {
    setDirection(1);
    setCardIdx((i) => {
      const next = Math.min(cards.length - 1, i + 1);
      if (next !== i) {
        const seen = new Set(progress.cards_seen ?? []);
        if (!seen.has(i)) {
          seen.add(i);
          const newProgress = { ...progress, cards_seen: Array.from(seen) };
          setProgress(newProgress);
          persist({ progress: newProgress, current_card_index: next, xp_earned: xp + 10 });
          setXp((v) => v + 10);
        } else {
          persist({ current_card_index: next });
        }
      }
      return next;
    });
  }, [cards.length, progress, persist, xp]);

  const goPrev = useCallback(() => {
    setDirection(-1);
    setCardIdx((i) => {
      const next = Math.max(0, i - 1);
      if (next !== i) persist({ current_card_index: next });
      return next;
    });
  }, [persist]);

  /* ----------------------------- Loading / error ----------------------------- */

  if (loading) {
    return (
      <div className="fixed inset-0 bg-zinc-950 flex items-center justify-center text-white/40">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (error || !row) {
    return (
      <div className="fixed inset-0 bg-zinc-950 flex items-center justify-center text-center px-6">
        <div>
          <div className="text-white/80 text-lg font-light mb-2">Coaching nicht gefunden</div>
          <div className="text-white/40 text-sm">{error ?? "Der Link ist ungültig oder abgelaufen."}</div>
        </div>
      </div>
    );
  }

  const lever = currentCard?.leverIndex != null ? levers[currentCard.leverIndex] : undefined;

  /* ----------------------------- Render ----------------------------- */

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-zinc-950 via-zinc-900 to-black text-white flex flex-col">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 pt-3 pb-2 shrink-0">
        <div className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-amber-400 to-rose-500 transition-all duration-300"
            style={{ width: `${overallProgress * 100}%` }}
          />
        </div>
        <div className="text-[10px] tabular-nums text-white/50 shrink-0">{safeCardIdx + 1}/{totalCards}</div>
        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 shrink-0">
          <Crown className="h-3 w-3 text-amber-400" />
          <span className="text-[10px] font-medium text-amber-200">{level.title}</span>
          <span className="text-[10px] text-white/50">·</span>
          <span className="text-[10px] tabular-nums text-white/70">{xp} XP</span>
        </div>
      </div>

      {/* Card area */}
      <div className="flex-1 relative overflow-hidden">
        <AnimatePresence initial={false} mode="wait" custom={direction}>
          <motion.div
            key={safeCardIdx}
            custom={direction}
            initial={{ opacity: 0, x: direction * 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction * -30 }}
            transition={{ duration: 0.25 }}
            className="absolute inset-0 overflow-y-auto"
          >
            <div className="min-h-full flex flex-col justify-center px-5 py-6 max-w-lg mx-auto">
              {currentCard && (
                <CardRenderer
                  card={currentCard}
                  lever={lever}
                  levers={levers}
                  result={result}
                  chatterFirstName={chatterFirstName}
                  bossScenario={bossScenario}
                  progress={progress}
                  commitment={commitment}
                  setCommitment={setCommitment}
                  token={token!}
                  onGrantXp={grantXp}
                  onAdvance={goNext}
                  onSaveProgress={(p) => {
                    setProgress(p);
                    persist({ progress: p });
                  }}
                  onSaveCommitment={(t) => {
                    setCommitment(t);
                    persist({ commitment_text: t });
                  }}
                  xp={xp}
                  level={level}
                  row={row}
                />
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom nav */}
      <div className="flex items-center gap-3 px-4 py-3 border-t border-white/5 shrink-0 bg-black/40 backdrop-blur">
        <Button
          variant="ghost"
          size="sm"
          onClick={goPrev}
          disabled={safeCardIdx === 0}
          className="text-white/70 hover:text-white hover:bg-white/5"
        >
          <ArrowLeft className="h-4 w-4 mr-1" /> Zurück
        </Button>
        <div className="flex-1" />
        <Button
          onClick={goNext}
          disabled={safeCardIdx >= cards.length - 1}
          size="sm"
          className="bg-gradient-to-r from-amber-500 to-rose-500 hover:from-amber-400 hover:to-rose-400 text-black font-semibold"
        >
          Weiter <ArrowRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

/* ============================================================================
   Card renderers
   ============================================================================ */

interface CardProps {
  card: StoryCard;
  lever?: Lever;
  levers: Lever[];
  result: any;
  chatterFirstName: string;
  bossScenario: any;
  progress: CoachingProgress;
  commitment: string;
  setCommitment: (t: string) => void;
  token: string;
  onGrantXp: (n: number) => void;
  onAdvance: () => void;
  onSaveProgress: (p: CoachingProgress) => void;
  onSaveCommitment: (t: string) => void;
  xp: number;
  level: ReturnType<typeof levelFromXp>;
  row: CoachingAnalysisRow;
}

function CardRenderer(p: CardProps) {
  switch (p.card.kind) {
    case "cover": return <CoverCard {...p} />;
    case "weekly": return <WeeklyCard {...p} />;
    case "lever_intro": return <LeverIntroCard {...p} />;
    case "customer_card": return <CustomerCardView {...p} />;
    case "context": return <ContextCard {...p} />;
    case "situation": return <SituationCard {...p} />;
    case "chatter_did": return <ChatterDidCard {...p} />;
    case "money_loss": return <MoneyLossCard {...p} />;
    case "better": return <BetterCard {...p} />;
    case "drill": return <DrillCard {...p} />;
    case "type_drill": return <TypeDrillCard {...p} />;
    case "boss_anecdote": return <BossAnecdoteCard {...p} />;
    case "takeaway": return <TakeawayCard {...p} />;
    case "quiz": return <QuizCard {...p} />;
    case "sbi_strength": return <StrengthCard {...p} />;
    case "sbi_growth": return <GrowthCard {...p} />;
    case "boss_fight": return <BossFightCard {...p} />;
    case "commitment": return <CommitmentCard {...p} />;
    case "final": return <FinalCard {...p} />;
    default: return null;
  }
}

/* ============================== Simple cards ============================== */

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] tracking-[0.2em] uppercase text-amber-400/80 mb-3">{children}</div>;
}

function CoverCard({ chatterFirstName, result, row }: CardProps) {
  return (
    <div className="text-center">
      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/5 border border-white/10 mb-6">
        <Sparkles className="h-3 w-3 text-amber-400" />
        <span className="text-[10px] tracking-widest uppercase text-white/70">Dein Coaching</span>
      </div>
      <h1 className="text-4xl font-serif font-light mb-3 leading-tight">
        Hey <span className="italic text-amber-400">{chatterFirstName}</span>
      </h1>
      <p className="text-white/70 text-lg leading-relaxed mb-6">
        {result.headline_promise || "Diese Karten bringen dich diese Woche auf das nächste Level."}
      </p>
      {result.personal_intro && (
        <p className="text-white/50 text-sm leading-relaxed italic">"{result.personal_intro}"</p>
      )}
      <div className="mt-8 text-xs text-white/30">
        Tippe unten auf „Weiter", um zu starten
      </div>
    </div>
  );
}

function WeeklyCard({ result }: CardProps) {
  const wc = result.weekly_comparison ?? {};
  const delta = wc.delta_pct;
  const positive = typeof delta === "number" && delta >= 0;
  return (
    <div>
      <Eyebrow>Vs. Vorperiode</Eyebrow>
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
        <div className="flex items-center gap-2 mb-4">
          {positive ? <TrendingUp className="h-5 w-5 text-emerald-400" /> : <TrendingDown className="h-5 w-5 text-rose-400" />}
          <div className="text-lg font-semibold">{wc.headline || (positive ? "Aufwärtstrend" : "Rückgang")}</div>
        </div>
        <div className="flex items-baseline gap-4 mb-4">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-white/40">Diese Periode</div>
            <div className="text-2xl font-serif">{Math.round(wc.current_revenue_eur ?? 0)}€</div>
          </div>
          <div className="text-white/30">vs.</div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-white/40">Davor</div>
            <div className="text-2xl font-serif text-white/50">{Math.round(wc.previous_revenue_eur ?? 0)}€</div>
          </div>
          {typeof delta === "number" && (
            <div className={`ml-auto text-2xl font-semibold ${positive ? "text-emerald-400" : "text-rose-400"}`}>
              {positive ? "+" : ""}{delta}%
            </div>
          )}
        </div>
        <p className="text-white/60 text-sm leading-relaxed">{wc.summary}</p>
      </div>
    </div>
  );
}

function LeverIntroCard({ lever, card }: CardProps) {
  if (!lever) return null;
  const num = (card.leverIndex ?? 0) + 1;
  return (
    <div className="text-center">
      <div className="text-8xl font-serif italic text-amber-400/20 mb-4">{num}</div>
      <Eyebrow>Hebel {num} von 3</Eyebrow>
      <h2 className="text-3xl font-serif font-light mb-4">{lever.title}</h2>
      <p className="text-white/80 text-lg leading-relaxed mb-6">{lever.one_liner}</p>
      {lever.money_line && (
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/30">
          <DollarSign className="h-4 w-4 text-emerald-400" />
          <span className="text-emerald-300 text-sm font-medium">{lever.money_line}</span>
        </div>
      )}
    </div>
  );
}

function CustomerCardView({ lever }: CardProps) {
  const cc = lever?.customer_card;
  if (!cc) return null;
  return (
    <div>
      <Eyebrow>Der Kunde in dieser Situation</Eyebrow>
      <div className="rounded-3xl bg-gradient-to-br from-fuchsia-500/10 via-purple-500/10 to-indigo-500/10 border border-white/10 p-6 shadow-xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-white/40">Alias</div>
            <div className="text-2xl font-serif">{cc.alias}</div>
          </div>
          <div className="text-3xl">{extractEmoji(cc.mood) || "🎭"}</div>
        </div>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <Stat label="Ausgegeben" value={cc.spend_estimate} />
          <Stat label="Steht auf" value={cc.kink_hint} />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1">Zuletzt</div>
          <div className="text-white/85 italic">„{cc.last_action}"</div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1">{label}</div>
      <div className="text-white/90 text-sm">{value || "—"}</div>
    </div>
  );
}

function extractEmoji(s?: string): string | null {
  if (!s) return null;
  const m = s.match(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u);
  return m ? m[0] : null;
}

function roleLabel(role: string): string {
  if (role === "CHATTER") return "Du";
  if (role === "BOT-DM") return "Auto-DM";
  return "Kunde";
}

function ChatBubble({ role, text }: { role: string; text: string }) {
  const isChatter = role === "CHATTER";
  const isBot = role === "BOT-DM";
  const alignRight = isChatter || isBot;
  return (
    <div className={`flex flex-col ${alignRight ? "items-end" : "items-start"}`}>
      <div className={`text-[10px] uppercase tracking-widest mb-1 px-1 ${
        isChatter ? "text-amber-400/80" : isBot ? "text-white/30" : "text-white/40"
      }`}>
        {roleLabel(role)}
      </div>
      <div className={[
        "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-snug",
        isChatter ? "bg-amber-500/20 text-amber-50 border border-amber-500/30 rounded-br-sm"
          : isBot ? "bg-white/5 text-white/50 italic border border-white/10 rounded-br-sm"
            : "bg-white/10 text-white/90 border border-white/10 rounded-bl-sm",
      ].join(" ")}>
        {text}
      </div>
    </div>
  );
}

function FullChatHistory({ lever, highlightRound }: { lever?: Lever; highlightRound?: number }) {
  const [open, setOpen] = useState(false);
  const msgs = lever?.context_messages ?? [];
  const storyboard = lever?.storyboard ?? [];
  const parsedContext = msgs.map(parseChatLine);
  if (!msgs.length && !storyboard.length) return null;

  return (
    <div className="mt-5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 text-white/70 hover:text-white text-xs transition-all"
      >
        <MessageCircle className="h-3.5 w-3.5" />
        {open ? "Verlauf ausblenden" : "Kompletten Chatverlauf ansehen"}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4 space-y-3">
          <div className="text-[10px] uppercase tracking-widest text-white/40 text-center pb-2 border-b border-white/5">
            Wie es begann
          </div>
          {parsedContext.map((p, i) => (
            <ChatBubble key={`ctx-${i}`} role={p.role} text={p.text} />
          ))}
          {storyboard.length > 0 && (
            <div className="text-[10px] uppercase tracking-widest text-white/40 text-center pt-2 pb-1 border-t border-white/5">
              Der Moment im Chat
            </div>
          )}
          {storyboard.map((r, i) => {
            const isHighlight = highlightRound === i;
            return (
              <div key={`sb-${i}`} className={`space-y-3 ${isHighlight ? "ring-2 ring-amber-400/40 rounded-2xl p-2 -m-1" : ""}`}>
                {r.customer && <ChatBubble role="KUNDE" text={r.customer} />}
                {r.chatter_did && <ChatBubble role="CHATTER" text={r.chatter_did} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ContextCard({ lever }: CardProps) {
  const msgs = lever?.context_messages ?? [];
  if (!msgs.length) return null;
  return (
    <div>
      <Eyebrow>So lief der Chat davor</Eyebrow>
      <p className="text-white/60 text-sm mb-4">Lies mit — so hat der Kunde geschrieben, bevor du geantwortet hast:</p>
      <div className="space-y-3 rounded-2xl border border-white/10 bg-black/30 p-4">
        {msgs.map((line, i) => {
          const parsed = parseChatLine(line);
          return <ChatBubble key={i} role={parsed.role} text={parsed.text} />;
        })}
      </div>
      <div className="text-center mt-6 text-xs text-white/50 flex items-center justify-center gap-1.5">
        <ChevronDown className="h-4 w-4 animate-bounce" />
        Und dann kam DEINE Antwort…
      </div>
    </div>
  );
}

function parseChatLine(line: string): { role: string; text: string } {
  const m = line.match(/^(KUNDE|CHATTER|BOT-DM):\s*(.*)$/);
  if (m) return { role: m[1], text: m[2] };
  return { role: "KUNDE", text: line };
}

function SituationCard({ lever }: CardProps) {
  if (!lever?.situation_summary) return null;
  return (
    <div>
      <Eyebrow>Die Situation</Eyebrow>
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <MessageCircle className="h-6 w-6 text-amber-400 mb-4" />
        <p className="text-white/90 text-lg leading-relaxed">{lever.situation_summary}</p>
      </div>
    </div>
  );
}

function ChatterDidCard({ lever, chatterFirstName }: CardProps) {
  const round = lever?.storyboard?.[0];
  if (!round) return null;
  return (
    <div>
      <Eyebrow>Das ist passiert</Eyebrow>
      <div className="space-y-3">
        {round.customer && <ChatBubble role="KUNDE" text={round.customer} />}
        {round.chatter_did && <ChatBubble role="CHATTER" text={round.chatter_did} />}
      </div>
      <div className="text-xs text-white/50 text-right mt-2">— was du gesagt hast, {chatterFirstName}</div>
      {round.verdict && (
        <div className="mt-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-sm text-center">
          {round.verdict}
        </div>
      )}
      <FullChatHistory lever={lever} highlightRound={0} />
    </div>
  );
}

function MoneyLossCard({ lever }: CardProps) {
  return (
    <div className="text-center">
      <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-rose-500/20 border border-rose-500/40 mb-4">
        <TrendingDown className="h-8 w-8 text-rose-400" />
      </div>
      <Eyebrow>Was es dich kostet</Eyebrow>
      <div className="text-3xl font-serif font-light leading-tight text-rose-100 mb-4">
        {lever?.money_line}
      </div>
      <p className="text-white/50 text-sm">
        Jedes Mal wenn diese Situation kommt und du sie liegen lässt — verlierst du Geld, das schon in Reichweite war.
      </p>
    </div>
  );
}

function BetterCard({ lever, chatterFirstName }: CardProps) {
  const round = lever?.storyboard?.[1];
  if (!round) return null;
  return (
    <div>
      <Eyebrow>So macht's ein Top-Chatter</Eyebrow>
      {round.context && <p className="text-white/60 text-sm mb-3">{round.context}</p>}
      {round.customer && (
        <div className="flex justify-start mb-2">
          <div className="max-w-[85%] rounded-2xl rounded-bl-sm px-4 py-2.5 bg-white/10 text-white/90 text-sm border border-white/10">
            {round.customer}
          </div>
        </div>
      )}
      <div className="flex justify-end mb-3">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm px-4 py-3 bg-gradient-to-br from-emerald-500/30 to-teal-500/20 text-emerald-50 text-sm border border-emerald-500/40 shadow-lg">
          {round.better_version}
        </div>
      </div>
      <div className="text-xs text-emerald-400/70 text-right mb-4">— so würdest du klingen, {chatterFirstName}, nur besser</div>
      {round.why_one_line && (
        <div className="mt-4 flex items-start gap-2 text-white/70 text-sm">
          <Zap className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
          <span>{round.why_one_line}</span>
        </div>
      )}
    </div>
  );
}

function DrillCard({ lever, card, progress, onSaveProgress, onGrantXp }: CardProps) {
  const drill = lever?.drill;
  const idx = card.leverIndex!;
  const existing = progress.drill_answers?.[idx];
  const [picked, setPicked] = useState<"a" | "b" | null>(existing?.picked ?? null);
  if (!drill) return null;
  const correct = drill.better_option;
  const answered = picked !== null;

  const choose = (opt: "a" | "b") => {
    if (answered) return;
    setPicked(opt);
    const isRight = opt === correct;
    const prev = progress.drill_answers ?? {};
    onSaveProgress({
      ...progress,
      drill_answers: {
        ...prev,
        [idx]: { ...(prev[idx] ?? {} as any), picked: opt, correct: isRight, at: new Date().toISOString() },
      },
    });
    if (isRight) onGrantXp(25);
    else onGrantXp(5);
  };

  return (
    <div>
      <Eyebrow>Drill · Welche ist besser?</Eyebrow>
      <p className="text-white/80 mb-4 leading-relaxed">{drill.prompt}</p>
      <div className="space-y-3">
        {(["a", "b"] as const).map((opt) => {
          const text = opt === "a" ? drill.option_a : drill.option_b;
          const isPicked = picked === opt;
          const isCorrect = opt === correct;
          return (
            <button
              key={opt}
              onClick={() => choose(opt)}
              disabled={answered}
              className={[
                "w-full text-left p-4 rounded-2xl border transition-all",
                !answered && "border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20",
                answered && isCorrect && "border-emerald-500/50 bg-emerald-500/15",
                answered && isPicked && !isCorrect && "border-rose-500/50 bg-rose-500/15",
                answered && !isPicked && !isCorrect && "border-white/5 bg-white/5 opacity-40",
              ].filter(Boolean).join(" ")}
            >
              <div className="flex items-start gap-3">
                <div className={[
                  "shrink-0 h-6 w-6 rounded-full flex items-center justify-center text-xs font-semibold",
                  !answered && "bg-white/10 text-white/70",
                  answered && isCorrect && "bg-emerald-500 text-black",
                  answered && isPicked && !isCorrect && "bg-rose-500 text-white",
                  answered && !isPicked && !isCorrect && "bg-white/10 text-white/40",
                ].filter(Boolean).join(" ")}>
                  {answered && isCorrect ? <Check className="h-3 w-3" /> : answered && isPicked && !isCorrect ? <X className="h-3 w-3" /> : opt.toUpperCase()}
                </div>
                <div className="text-sm text-white/90 leading-snug">{text}</div>
              </div>
            </button>
          );
        })}
      </div>
      {answered && (
        <div className="mt-4 p-4 rounded-2xl bg-white/5 border border-white/10 text-white/80 text-sm leading-relaxed">
          <span className="font-medium text-amber-400">Warum: </span>{drill.why}
        </div>
      )}
    </div>
  );
}

function TypeDrillCard({ lever, card, token, progress, onSaveProgress, onGrantXp }: CardProps) {
  const drill = lever?.drill;
  const idx = card.leverIndex!;
  const existing = progress.drill_answers?.[idx];
  const [text, setText] = useState(existing?.typed ?? "");
  const [busy, setBusy] = useState(false);
  const [score, setScore] = useState<number | null>(existing?.score ?? null);
  const [feedback, setFeedback] = useState<string | null>(existing?.feedback ?? null);
  const [polished, setPolished] = useState<string | null>(existing?.polished ?? null);
  if (!drill) return null;

  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const res = await evaluateDrill({ token, lever_index: idx, answer: text.trim() });
      setScore(res.score);
      setFeedback(res.feedback);
      setPolished(res.polished ?? null);
      const prev = progress.drill_answers ?? {};
      onSaveProgress({
        ...progress,
        drill_answers: {
          ...prev,
          [idx]: { ...(prev[idx] ?? { picked: "a", correct: false } as any), typed: text.trim(), score: res.score, feedback: res.feedback, polished: res.polished, at: new Date().toISOString() },
        },
      });
      onGrantXp(Math.max(10, res.score * 3));
    } catch (e: any) {
      toast.error(e.message ?? "Bewertung fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Eyebrow>Jetzt du · Tipp deine Antwort</Eyebrow>
      <p className="text-white/70 mb-3 text-sm">{drill.prompt}</p>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Wie würdest DU antworten?"
        rows={4}
        disabled={score !== null}
        className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
      />
      {score === null ? (
        <Button
          onClick={submit}
          disabled={!text.trim() || busy}
          className="w-full mt-3 bg-gradient-to-r from-amber-500 to-rose-500 text-black font-semibold"
        >
          {busy ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Bewerte…</> : <>Bewertung holen <Send className="h-4 w-4 ml-2" /></>}
        </Button>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-3 p-3 rounded-2xl bg-white/5 border border-white/10">
            <div className={`h-12 w-12 rounded-full flex items-center justify-center font-serif text-lg ${score >= 7 ? "bg-emerald-500/20 text-emerald-300" : score >= 4 ? "bg-amber-500/20 text-amber-300" : "bg-rose-500/20 text-rose-300"}`}>
              {score}
            </div>
            <div className="text-white/80 text-sm leading-relaxed">{feedback}</div>
          </div>
          {polished && (
            <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30">
              <div className="text-[10px] uppercase tracking-widest text-emerald-400/80 mb-1">Polierte Version</div>
              <div className="text-emerald-50 text-sm italic">"{polished}"</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BossAnecdoteCard({ lever }: CardProps) {
  const a = lever?.boss_anecdote;
  if (!a) return null;
  return (
    <div>
      <Eyebrow>Aus dem Nähkästchen</Eyebrow>
      <div className="relative rounded-3xl bg-gradient-to-br from-amber-500/10 to-rose-500/10 border border-amber-500/20 p-6">
        <div className="absolute -top-3 -left-3 h-10 w-10 rounded-full bg-amber-500 flex items-center justify-center shadow-lg">
          <Crown className="h-5 w-5 text-black" />
        </div>
        <div className="text-amber-300 font-serif italic text-lg mb-3 mt-2">{a.hook}</div>
        <p className="text-white/85 leading-relaxed">{a.story}</p>
      </div>
    </div>
  );
}

function TakeawayCard({ lever }: CardProps) {
  const round = lever?.storyboard?.[2];
  if (!round?.say_this) return null;
  return (
    <div className="text-center">
      <Eyebrow>Merk dir das</Eyebrow>
      <div className="rounded-3xl border-2 border-amber-400/40 bg-gradient-to-br from-amber-500/10 to-transparent p-8">
        <Star className="h-8 w-8 text-amber-400 mx-auto mb-4" />
        {round.context && <p className="text-white/50 text-xs mb-4">{round.context}</p>}
        <div className="text-2xl font-serif italic leading-snug text-amber-50">"{round.say_this}"</div>
      </div>
      <p className="text-white/40 text-xs mt-4">Screenshot machen · beim nächsten Chat rausholen</p>
    </div>
  );
}

function QuizCard({ lever, card, progress, onSaveProgress, onGrantXp }: CardProps) {
  const quiz = lever?.quiz;
  const idx = card.leverIndex!;
  const existing = progress.quiz_answers?.[idx];
  const [picked, setPicked] = useState<number | null>(existing?.selected ?? null);
  if (!quiz) return null;
  const answered = picked !== null;
  const correct = quiz.correct_index;

  const choose = (i: number) => {
    if (answered) return;
    setPicked(i);
    const isRight = i === correct;
    onSaveProgress({
      ...progress,
      quiz_answers: {
        ...(progress.quiz_answers ?? {}),
        [idx]: { selected: i, correct: isRight, at: new Date().toISOString() },
      },
    });
    onGrantXp(isRight ? 30 : 5);
  };

  return (
    <div>
      <Eyebrow>Quick-Check</Eyebrow>
      <p className="text-white/90 text-lg leading-relaxed mb-5">{quiz.question}</p>
      <div className="space-y-2">
        {quiz.options.map((opt, i) => {
          const isPicked = picked === i;
          const isCorrect = i === correct;
          return (
            <button
              key={i}
              disabled={answered}
              onClick={() => choose(i)}
              className={[
                "w-full text-left p-3 rounded-xl border text-sm transition-all",
                !answered && "border-white/10 bg-white/5 hover:bg-white/10",
                answered && isCorrect && "border-emerald-500/50 bg-emerald-500/15 text-emerald-50",
                answered && isPicked && !isCorrect && "border-rose-500/50 bg-rose-500/15 text-rose-50",
                answered && !isPicked && !isCorrect && "border-white/5 bg-white/5 opacity-40",
              ].filter(Boolean).join(" ")}
            >
              {opt}
            </button>
          );
        })}
      </div>
      {answered && (
        <div className="mt-4 p-3 rounded-xl bg-white/5 border border-white/10 text-white/80 text-sm">
          {picked === correct ? <span className="text-emerald-400 font-semibold">Richtig. </span> : <span className="text-rose-400 font-semibold">Nicht ganz. </span>}
          {quiz.explanation}
        </div>
      )}
    </div>
  );
}

function StrengthCard({ result }: CardProps) {
  const s = result.sbi_feedback?.strength;
  if (!s) return null;
  return (
    <div>
      <Eyebrow>Deine Stärke</Eyebrow>
      <div className="rounded-3xl border border-emerald-500/30 bg-emerald-500/10 p-6">
        <Heart className="h-6 w-6 text-emerald-400 mb-4" />
        <p className="text-emerald-50/80 text-sm mb-3"><span className="font-semibold">Situation: </span>{s.situation}</p>
        <p className="text-emerald-50 mb-3 leading-relaxed"><span className="font-semibold">Was du gemacht hast: </span>{s.behavior}</p>
        <p className="text-emerald-200/90 text-sm leading-relaxed italic">Wirkung: {s.impact}</p>
      </div>
    </div>
  );
}

function GrowthCard({ result }: CardProps) {
  const g = result.sbi_feedback?.growth;
  if (!g) return null;
  return (
    <div>
      <Eyebrow>Dein Wachstumsfeld</Eyebrow>
      <div className="rounded-3xl border border-amber-500/30 bg-amber-500/5 p-6">
        <Target className="h-6 w-6 text-amber-400 mb-4" />
        <p className="text-white/70 text-sm mb-3"><span className="font-semibold text-amber-300">Situation: </span>{g.situation}</p>
        <p className="text-white/90 mb-3 leading-relaxed"><span className="font-semibold text-amber-300">Was passiert ist: </span>{g.behavior}</p>
        <p className="text-white/70 text-sm mb-4 leading-relaxed"><span className="font-semibold text-amber-300">Was liegen blieb: </span>{g.impact}</p>
        {g.alternative_if_then && (
          <div className="mt-4 p-4 rounded-2xl bg-black/30 border border-amber-500/20">
            <div className="text-[10px] uppercase tracking-widest text-amber-400/80 mb-2">Nächstes Mal sag stattdessen</div>
            <div className="text-amber-50 italic leading-relaxed">"{g.alternative_if_then}"</div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================== Boss Fight ============================== */

function BossFightCard({ bossScenario, token, row, onGrantXp }: CardProps) {
  const [turns, setTurns] = useState<BossFightTurn[]>(row.boss_fight_result?.turns ?? []);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [finalScore, setFinalScore] = useState<{ score: number; verdict: string; revenue_potential_eur: number; feedback: string } | null>(
    row.boss_fight_result?.score != null
      ? { score: row.boss_fight_result.score!, verdict: row.boss_fight_result.verdict ?? "", revenue_potential_eur: row.boss_fight_result.revenue_potential_eur ?? 0, feedback: row.boss_fight_result.feedback ?? "" }
      : null,
  );
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (turns.length === 0 && bossScenario?.opening_message) {
      setTurns([{ role: "customer", text: bossScenario.opening_message, at: new Date().toISOString() }]);
    }
  }, [bossScenario, turns.length]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [turns.length]);

  if (!bossScenario) return null;
  const maxTurns = bossScenario.max_turns ?? 4;
  const chatterTurns = turns.filter((t) => t.role === "chatter").length;
  const done = chatterTurns >= maxTurns || finalScore !== null;

  const persistTurns = (nextTurns: BossFightTurn[], score?: typeof finalScore) => {
    updateProgress(token, {
      boss_fight_result: {
        turns: nextTurns,
        ...(score ? { score: score.score, verdict: score.verdict, revenue_potential_eur: score.revenue_potential_eur, feedback: score.feedback, completed_at: new Date().toISOString() } : {}),
      },
    }).catch(() => {});
  };

  const send = async () => {
    if (!input.trim() || busy) return;
    const my: BossFightTurn = { role: "chatter", text: input.trim(), at: new Date().toISOString() };
    const nextTurns = [...turns, my];
    setTurns(nextTurns);
    setInput("");
    setBusy(true);
    try {
      if (chatterTurns + 1 >= maxTurns) {
        const score = await bossFightFinalScore({ token, turn_history: nextTurns });
        setFinalScore(score);
        persistTurns(nextTurns, score);
        onGrantXp(Math.max(20, score.score));
      } else {
        const reply = await bossFightCustomerReply({ token, turn_history: nextTurns });
        const withReply = [...nextTurns, { role: "customer" as const, text: reply.reply, at: new Date().toISOString() }];
        setTurns(withReply);
        persistTurns(withReply);
      }
    } catch (e: any) {
      toast.error(e.message ?? "Simulator-Fehler");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full">
      <div className="text-center mb-4">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-500/10 border border-rose-500/40">
          <Flame className="h-3.5 w-3.5 text-rose-400" />
          <span className="text-[10px] tracking-widest uppercase text-rose-200 font-semibold">Boss-Fight</span>
        </div>
        <h2 className="text-2xl font-serif font-light mt-3">{bossScenario.customer_alias}</h2>
        <p className="text-white/60 text-sm mt-1">{bossScenario.customer_profile}</p>
        <p className="text-amber-400/80 text-xs mt-2 italic">Ziel: {bossScenario.goal}</p>
      </div>

      <div ref={listRef} className="max-h-[45vh] overflow-y-auto rounded-2xl border border-white/10 bg-black/30 p-3 space-y-2 mb-3">
        {turns.map((t, i) => {
          const isMe = t.role === "chatter";
          return (
            <div key={i} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
              <div className={[
                "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm",
                isMe ? "bg-amber-500/20 text-amber-50 border border-amber-500/30 rounded-br-sm"
                  : "bg-white/10 text-white/90 border border-white/10 rounded-bl-sm",
              ].join(" ")}>
                {t.text}
              </div>
            </div>
          );
        })}
        {busy && (
          <div className="flex justify-start">
            <div className="rounded-2xl px-3.5 py-2 bg-white/5 border border-white/10 text-white/50 text-xs">tippt…</div>
          </div>
        )}
      </div>

      {!done && (
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Deine Antwort…"
            disabled={busy}
            onKeyDown={(e) => { if (e.key === "Enter") send(); }}
            className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
          />
          <Button onClick={send} disabled={busy || !input.trim()} className="bg-amber-500 hover:bg-amber-400 text-black font-semibold">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      )}
      <div className="mt-2 text-center text-[10px] text-white/40">
        Runde {chatterTurns} / {maxTurns}
      </div>

      {finalScore && (
        <div className="mt-4 rounded-2xl border border-amber-500/40 bg-gradient-to-br from-amber-500/10 to-rose-500/10 p-5 text-center">
          <Trophy className="h-8 w-8 text-amber-400 mx-auto mb-2" />
          <div className="text-3xl font-serif">{finalScore.score}<span className="text-white/40 text-lg">/100</span></div>
          <div className="text-amber-300 font-medium mt-1">{finalScore.verdict}</div>
          <div className="text-white/60 text-sm mt-2">Potenzial: ~{Math.round(finalScore.revenue_potential_eur)}€</div>
          <p className="text-white/80 text-sm mt-3 leading-relaxed">{finalScore.feedback}</p>
        </div>
      )}
    </div>
  );
}

/* ============================== Commitment + Final ============================== */

function CommitmentCard({ commitment, setCommitment, onSaveCommitment, chatterFirstName }: CardProps) {
  const [text, setText] = useState(commitment);
  return (
    <div>
      <Eyebrow>Dein Versprechen</Eyebrow>
      <p className="text-white/80 text-lg leading-relaxed mb-4">
        Wenn du diese Woche EINE Sache anders machst — welche wird es?
      </p>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => { setCommitment(text); onSaveCommitment(text); }}
        placeholder={`Ich, ${chatterFirstName}, verspreche diese Woche …`}
        rows={4}
        className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
      />
      <div className="mt-3 text-xs text-white/40 italic">
        Wird gespeichert. Beim nächsten Login siehst du es wieder.
      </div>
    </div>
  );
}

function FinalCard({ xp, level, result, chatterFirstName, token, progress, onSaveProgress }: CardProps) {
  const stats = useMemo(() => ({
    quiz: Object.values(progress.quiz_answers ?? {}).filter((a) => a?.correct).length,
    drills: Object.values(progress.drill_answers ?? {}).filter((a) => a?.correct).length,
  }), [progress]);

  useEffect(() => {
    if (!progress.completed) {
      const next = { ...progress, completed: true };
      onSaveProgress(next);
      updateProgress(token, { progress: next }).catch(() => {});
    }
  }, []); // eslint-disable-line

  return (
    <div className="text-center">
      <div className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-rose-500 mb-4 shadow-2xl shadow-amber-500/30">
        <Trophy className="h-10 w-10 text-black" />
      </div>
      <h2 className="text-3xl font-serif font-light mb-2">Bam, {chatterFirstName}.</h2>
      <p className="text-white/70 mb-6">Du hast dein Coaching durchgezogen.</p>
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
          <div className="text-[10px] uppercase tracking-widest text-white/40">XP</div>
          <div className="text-2xl font-serif mt-1">{xp}</div>
        </div>
        <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
          <div className="text-[10px] uppercase tracking-widest text-white/40">Level</div>
          <div className="text-2xl font-serif mt-1">{level.title}</div>
        </div>
        <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
          <div className="text-[10px] uppercase tracking-widest text-white/40">Quiz richtig</div>
          <div className="text-2xl font-serif mt-1">{stats.quiz}</div>
        </div>
        <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
          <div className="text-[10px] uppercase tracking-widest text-white/40">Drills</div>
          <div className="text-2xl font-serif mt-1">{stats.drills}</div>
        </div>
      </div>
      {result.micro_action && (
        <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 p-5 text-left">
          <div className="text-[10px] uppercase tracking-widest text-amber-400/80 mb-2">Deine Mikro-Aktion diese Woche</div>
          <div className="text-amber-50 leading-relaxed">{result.micro_action}</div>
        </div>
      )}
    </div>
  );
}
