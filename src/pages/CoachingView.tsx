import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Loader2, ArrowRight, ArrowLeft, Trophy, Flame, Sparkles, Target,
  MessageCircle, TrendingDown, TrendingUp, Star, Crown, Send, Check, X,
  ChevronDown, Zap, Heart, DollarSign, Play, Lock, Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

import {
  CoachingAnalysisRow,
  CoachingProgress,
  CoachingMemo,
  Lever,
  BossFightTurn,
  loadAnalysisByToken,
  updateProgress,
  evaluateDrill,
  bossFightCustomerReply,
  bossFightFinalScore,
  levelFromXp,
} from "@/lib/coaching";
import { supabase } from "@/integrations/supabase/client";
import CoachingMemoBar from "@/components/CoachingMemoBar";

/* ----------------------------- Dopamin helpers ----------------------------- */

function ConfettiBurst({ show }: { show: boolean }) {
  if (!show) return null;
  const bits = Array.from({ length: 18 });
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center overflow-hidden">
      {bits.map((_, i) => {
        const angle = (i / bits.length) * Math.PI * 2;
        const dist = 120 + Math.random() * 160;
        const dx = Math.cos(angle) * dist;
        const dy = Math.sin(angle) * dist;
        const colors = ["#f59e0b", "#f43f5e", "#10b981", "#fde68a", "#f472b6"];
        const c = colors[i % colors.length];
        return (
          <motion.span
            key={i}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{ x: dx, y: dy, opacity: 0, scale: 0.4, rotate: Math.random() * 360 }}
            transition={{ duration: 0.9, ease: "easeOut" }}
            style={{ background: c }}
            className="absolute h-2 w-2 rounded-sm"
          />
        );
      })}
    </div>
  );
}

function useConfetti() {
  const [on, setOn] = useState(false);
  const fire = useCallback(() => {
    setOn(true);
    try { navigator.vibrate?.(20); } catch { /* noop */ }
    window.setTimeout(() => setOn(false), 950);
  }, []);
  return { on, fire };
}

function StreakChip({ streak }: { streak: number }) {
  if (!streak || streak < 1) return null;
  return (
    <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/30 shrink-0">
      <Flame className="h-3 w-3 text-rose-400" />
      <span className="text-[10px] font-medium text-rose-200 tabular-nums">{streak}</span>
    </div>
  );
}

/* ----------------------------- Card model ----------------------------- */



type CardKind =
  | "cover"
  | "weekly"
  | "lever_intro"
  | "customer_card"
  | "cinema"
  | "cinema_better"
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
  const [cardGateOpen, setCardGateOpen] = useState(true);

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
      const sb = lv.storyboard ?? [];
      const hasContext =
        (lv.context_messages && lv.context_messages.length > 0) ||
        !!sb[0]?.customer ||
        !!lv.situation_summary;
      if (hasContext && sb[0]?.chatter_did) list.push({ kind: "cinema", leverIndex: i });
      if (sb[1]?.better_version) list.push({ kind: "cinema_better", leverIndex: i });
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

  useEffect(() => { setCardGateOpen(true); }, [safeCardIdx]);


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
        <StreakChip streak={progress.answer_streak ?? 0} />
        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 shrink-0">
          <Crown className="h-3 w-3 text-amber-400" />
          <span className="text-[10px] font-medium text-amber-200">{level.title}</span>
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
                  setCanAdvance={setCardGateOpen}
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
          disabled={safeCardIdx >= cards.length - 1 || !cardGateOpen}
          size="sm"
          className="bg-gradient-to-r from-amber-500 to-rose-500 hover:from-amber-400 hover:to-rose-400 text-black font-semibold disabled:opacity-40"
        >
          {!cardGateOpen ? <><Lock className="h-3.5 w-3.5 mr-1.5" /> Erst durchlesen</> : <>Nächste Szene <ArrowRight className="h-4 w-4 ml-1" /></>}
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
  setCanAdvance: (open: boolean) => void;
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
    case "cinema": return <CinemaCard {...p} />;
    case "cinema_better": return <CinemaBetterCard {...p} />;
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
      <Eyebrow>Szene {num} von 3</Eyebrow>
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

function parseChatLine(line: string): { role: string; text: string } {
  const m = line.match(/^(KUNDE|CHATTER|BOT-DM):\s*(.*)$/);
  if (m) return { role: m[1], text: m[2] };
  return { role: "KUNDE", text: line };
}

/* ============================== Cinema Card ============================== */
/**
 * The Chatter's core learning moment. Plays the real chat log message-by-message
 * with typing indicators (Netflix-style). Locks the "Weiter" gate until the full
 * context is visible, then reveals what actually went wrong. No guess comes here:
 * first verstehen, then verbessern.
 */

interface CinemaMsg { role: string; text: string; }

function TypingDots() {
  return (
    <div className="flex items-center gap-1 px-3 py-2 rounded-2xl bg-white/10 border border-white/10 w-fit">
      <span className="h-1.5 w-1.5 rounded-full bg-white/60 animate-bounce" style={{ animationDelay: "0ms" }} />
      <span className="h-1.5 w-1.5 rounded-full bg-white/60 animate-bounce" style={{ animationDelay: "150ms" }} />
      <span className="h-1.5 w-1.5 rounded-full bg-white/60 animate-bounce" style={{ animationDelay: "300ms" }} />
    </div>
  );
}

function CinemaCard({
  lever, card, chatterFirstName, progress, onSaveProgress, onGrantXp, setCanAdvance,
}: CardProps) {
  const leverIndex = card.leverIndex!;
  const round0 = lever?.storyboard?.[0];
  const existing = progress.cinema_progress?.[leverIndex];
  const hasTeachingMoment = !!round0?.chatter_did;

  // Build the "before" message list: context_messages first, else fall back to
  // the storyboard's own customer line, else the situation_summary.
  const beforeMessages: CinemaMsg[] = useMemo(() => {
    const ctx = lever?.context_messages ?? [];
    if (ctx.length > 0) return ctx.map(parseChatLine).filter((m) => m.role !== "BOT-DM");
    if (round0?.customer) return [{ role: "KUNDE", text: round0.customer }];
    if (lever?.situation_summary) return [{ role: "KUNDE", text: lever.situation_summary }];
    return [];
  }, [lever, round0]);

  const totalBefore = beforeMessages.length;
  const wasCompleted = !!existing?.completed;

  // Phases: playing -> reveal
  type Phase = "playing" | "reveal";
  const [revealed, setRevealed] = useState<number>(wasCompleted ? totalBefore : 0);
  const [showTyping, setShowTyping] = useState(false);
  const [phase, setPhase] = useState<Phase>(wasCompleted ? "reveal" : "playing");
  const scrollRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<any>(null);

  // Gate control: closed until phase === "reveal"
  useEffect(() => {
    setCanAdvance(!hasTeachingMoment || phase === "reveal");
  }, [hasTeachingMoment, phase, setCanAdvance]);

  // Auto-play the next message
  useEffect(() => {
    if (phase !== "playing") return;
    if (revealed >= totalBefore) {
      setPhase("reveal");
      persistCinema({ messages_revealed: totalBefore, completed: true });
      return;
    }
    // Show typing indicator, then reveal next message
    setShowTyping(true);
    const typingDelay = 600 + Math.random() * 400;
    timerRef.current = setTimeout(() => {
      setShowTyping(false);
      setRevealed((n) => n + 1);
      onGrantXp(2);
    }, typingDelay);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [phase, revealed, totalBefore, onGrantXp]);

  // Auto-scroll to bottom as messages come in
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [revealed, showTyping, phase]);

  const persistCinema = (patch: Partial<import("@/lib/coaching").CinemaProgress>) => {
    const prev = progress.cinema_progress ?? {};
    const cur = prev[leverIndex] ?? {};
    onSaveProgress({
      ...progress,
      cinema_progress: { ...prev, [leverIndex]: { ...cur, ...patch, at: new Date().toISOString() } },
    });
  };

  if (!hasTeachingMoment) {
    return null;
  }

  const shown = beforeMessages.slice(0, revealed);

  return (
    <div className="w-full">
      <div className="text-center mb-3">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-500/10 border border-rose-500/30 mb-2">
          <Play className="h-3 w-3 text-rose-400 fill-rose-400" />
          <span className="text-[10px] tracking-widest uppercase text-rose-200">Erst die Szene, dann der Aha-Moment</span>
        </div>
        <div className="text-[10px] text-white/40">
          Lies erst, was davor passiert ist, damit du den Kontext von dem Fehler erkennst.
        </div>
      </div>


      {/* Progress line inside the card */}
      {phase === "playing" && totalBefore > 0 && (
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 h-0.5 rounded-full bg-white/5 overflow-hidden">
            <div
              className="h-full bg-rose-400/70 transition-all duration-300"
              style={{ width: `${(revealed / totalBefore) * 100}%` }}
            />
          </div>
          <div className="text-[10px] tabular-nums text-white/40">{revealed}/{totalBefore}</div>
        </div>
      )}

      {/* Chat window */}
      <div
        ref={scrollRef}
        onClick={phase === "playing" ? () => {
          // Tap-to-advance: skip typing, reveal next immediately
          if (timerRef.current) clearTimeout(timerRef.current);
          setShowTyping(false);
          if (revealed < totalBefore) {
            setRevealed((n) => n + 1);
            onGrantXp(2);
          }
        } : undefined}
        className={`max-h-[45vh] overflow-y-auto rounded-2xl border border-white/10 bg-black/40 p-4 space-y-3 ${phase === "playing" ? "cursor-pointer" : ""}`}
      >
        {shown.map((m, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
          >
            <ChatBubble role={m.role} text={m.text} />
          </motion.div>
        ))}
        {showTyping && phase === "playing" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
            <TypingDots />
          </motion.div>
        )}

        {/* Reveal phase: show real bubble AFTER context is understood */}
        {phase === "reveal" && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            <ChatBubble role="CHATTER" text={round0.chatter_did} />
          </motion.div>
        )}
      </div>

      {phase === "playing" && (
        <div className="mt-3 text-center text-[10px] text-white/40">
          Tippen zeigt die nächste Nachricht schneller
        </div>
      )}

      {/* Reveal phase: verdict + money loss */}
      {phase === "reveal" && (
        <div className="mt-4 space-y-3">
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
            <div className="text-[10px] uppercase tracking-widest text-amber-300/80 mb-1">Der Aha-Moment ↑</div>
            {round0.verdict && (
              <p className="text-amber-50 text-sm leading-relaxed">{round0.verdict}</p>
            )}
          </div>
          {lever?.money_line && (
            <div className="text-[11px] text-white/40 italic px-1 leading-relaxed">
              Kleiner Reminder: {lever.money_line}
            </div>
          )}
        </div>
      )}

    </div>
  );
}

/* ============================== Cinema Better ============================== */
/**
 * The "how a top chatter would have done it" reveal. Shows the same context
 * statically (already familiar), then dramatically reveals the better version.
 */
function CinemaBetterCard({ lever, chatterFirstName, setCanAdvance }: CardProps) {
  const round1 = lever?.storyboard?.[1];
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    // Gate closes until the chatter has tapped to reveal the better version
    setCanAdvance(revealed);
  }, [revealed, setCanAdvance]);

  const contextMsgs: CinemaMsg[] = useMemo(() => {
    const ctx = lever?.context_messages ?? [];
    if (ctx.length > 0) return ctx.map(parseChatLine).filter((m) => m.role !== "BOT-DM");
    if (round1?.customer) return [{ role: "KUNDE", text: round1.customer }];
    return [];
  }, [lever, round1]);

  if (!round1?.better_version) {
    useEffect(() => { setCanAdvance(true); }, [setCanAdvance]);
    return null;
  }

  return (
    <div>
      <div className="text-center mb-3">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 mb-2">
          <Crown className="h-3 w-3 text-emerald-400" />
          <span className="text-[10px] tracking-widest uppercase text-emerald-200">Die Version, die zündet</span>
        </div>
      </div>


      {round1.context && (
        <p className="text-white/60 text-sm mb-3 text-center italic">{round1.context}</p>
      )}

      <div className="rounded-2xl border border-white/10 bg-black/40 p-4 space-y-3">
        {contextMsgs.map((m, i) => (
          <ChatBubble key={i} role={m.role} text={m.text} />
        ))}

        {!revealed ? (
          <button
            onClick={() => setRevealed(true)}
            className="w-full mt-2 py-3 rounded-2xl border-2 border-dashed border-emerald-500/40 bg-emerald-500/5 hover:bg-emerald-500/10 text-emerald-300 text-sm font-medium transition-all flex items-center justify-center gap-2"
          >
            <Eye className="h-4 w-4" /> Antippen — bessere Antwort aufdecken
          </button>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.4, type: "spring" }}
            className="flex flex-col items-end"
          >
            <div className="text-[10px] uppercase tracking-widest mb-1 px-1 text-emerald-400/80">Du (Top-Version)</div>
            <div className="max-w-[90%] rounded-2xl rounded-br-sm px-4 py-3 bg-gradient-to-br from-emerald-500/30 to-teal-500/20 text-emerald-50 text-sm border border-emerald-500/50 shadow-2xl shadow-emerald-500/20 leading-snug">
              {round1.better_version}
            </div>
          </motion.div>
        )}
      </div>

      {revealed && round1.why_one_line && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="mt-4 flex items-start gap-2 text-white/80 text-sm rounded-2xl bg-amber-500/5 border border-amber-500/20 p-3"
        >
          <Zap className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
          <span>{round1.why_one_line}</span>
        </motion.div>
      )}

      {revealed && (
        <div className="text-xs text-emerald-400/70 text-center mt-3">
          — so klingst du, {chatterFirstName}, wenn du es voll ausspielst
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
  const confetti = useConfetti();
  if (!drill) return null;
  const correct = drill.better_option;
  const answered = picked !== null;

  const choose = (opt: "a" | "b") => {
    if (answered) return;
    setPicked(opt);
    const isRight = opt === correct;
    const prev = progress.drill_answers ?? {};
    const prevStreak = progress.answer_streak ?? 0;
    onSaveProgress({
      ...progress,
      drill_answers: {
        ...prev,
        [idx]: { ...(prev[idx] ?? {} as any), picked: opt, correct: isRight, at: new Date().toISOString() },
      },
      answer_streak: isRight ? prevStreak + 1 : 0,
    });
    if (isRight) {
      onGrantXp(25);
      confetti.fire();
    } else {
      onGrantXp(5);
      try { navigator.vibrate?.(15); } catch { /* noop */ }
    }
  };

  return (
    <div>
      <ConfettiBurst show={confetti.on} />
      <Eyebrow>Kurzer Reflex-Check · Welche zündet?</Eyebrow>
      <p className="text-white/80 mb-4 leading-relaxed">{drill.prompt}</p>
      <div className="space-y-3">
        {(["a", "b"] as const).map((opt) => {
          const text = opt === "a" ? drill.option_a : drill.option_b;
          const isPicked = picked === opt;
          const isCorrect = opt === correct;
          return (
            <motion.button
              key={opt}
              onClick={() => choose(opt)}
              disabled={answered}
              whileTap={{ scale: 0.98 }}
              animate={answered && isCorrect ? { scale: [1, 1.03, 1] } : {}}
              transition={{ duration: 0.35 }}
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
            </motion.button>
          );
        })}
      </div>
      {answered && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mt-4 p-4 rounded-2xl bg-white/5 border border-white/10 text-white/80 text-sm leading-relaxed"
        >
          <span className="font-medium text-amber-400">
            {picked === correct ? "Genau der Move. " : "Nah dran. "}
          </span>{drill.why}
        </motion.div>
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
  const confetti = useConfetti();
  if (!quiz) return null;
  const answered = picked !== null;
  const correct = quiz.correct_index;

  const choose = (i: number) => {
    if (answered) return;
    setPicked(i);
    const isRight = i === correct;
    const prevStreak = progress.answer_streak ?? 0;
    onSaveProgress({
      ...progress,
      quiz_answers: {
        ...(progress.quiz_answers ?? {}),
        [idx]: { selected: i, correct: isRight, at: new Date().toISOString() },
      },
      answer_streak: isRight ? prevStreak + 1 : 0,
    });
    onGrantXp(isRight ? 30 : 5);
    if (isRight) confetti.fire();
    else { try { navigator.vibrate?.(15); } catch { /* noop */ } }
  };

  return (
    <div>
      <ConfettiBurst show={confetti.on} />
      <Eyebrow>Quick-Check</Eyebrow>
      <p className="text-white/90 text-lg leading-relaxed mb-5">{quiz.question}</p>
      <div className="space-y-2">
        {quiz.options.map((opt, i) => {
          const isPicked = picked === i;
          const isCorrect = i === correct;
          return (
            <motion.button
              key={i}
              disabled={answered}
              onClick={() => choose(i)}
              whileTap={{ scale: 0.98 }}
              animate={answered && isCorrect ? { scale: [1, 1.03, 1] } : {}}
              transition={{ duration: 0.35 }}
              className={[
                "w-full text-left p-3 rounded-xl border text-sm transition-all",
                !answered && "border-white/10 bg-white/5 hover:bg-white/10",
                answered && isCorrect && "border-emerald-500/50 bg-emerald-500/15 text-emerald-50",
                answered && isPicked && !isCorrect && "border-rose-500/50 bg-rose-500/15 text-rose-50",
                answered && !isPicked && !isCorrect && "border-white/5 bg-white/5 opacity-40",
              ].filter(Boolean).join(" ")}
            >
              {opt}
            </motion.button>
          );
        })}
      </div>
      {answered && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mt-4 p-3 rounded-xl bg-white/5 border border-white/10 text-white/80 text-sm"
        >
          {picked === correct
            ? <span className="text-emerald-400 font-semibold">Sitzt. </span>
            : <span className="text-amber-400 font-semibold">Fast. </span>}
          {quiz.explanation}
        </motion.div>
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

function FinalCard({ xp, level, result, chatterFirstName, token, progress, commitment, onSaveProgress, levers }: CardProps) {
  const stats = useMemo(() => ({
    quiz: Object.values(progress.quiz_answers ?? {}).filter((a) => a?.correct).length,
    drills: Object.values(progress.drill_answers ?? {}).filter((a) => a?.correct).length,
  }), [progress]);

  const takeaways = useMemo(
    () => (levers ?? [])
      .map((lv) => lv.storyboard?.[2]?.say_this || lv.one_liner)
      .filter(Boolean)
      .slice(0, 3) as string[],
    [levers],
  );

  const confetti = useConfetti();
  useEffect(() => {
    if (!progress.completed) {
      const nextStreak = (progress.session_streak ?? 0) + 1;
      const next = { ...progress, completed: true, session_streak: nextStreak };
      onSaveProgress(next);
      updateProgress(token, { progress: next }).catch(() => {});
      confetti.fire();
    }
    // eslint-disable-next-line
  }, []);

  return (
    <div className="text-center">
      <ConfettiBurst show={confetti.on} />
      <div className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-rose-500 mb-4 shadow-2xl shadow-amber-500/30">
        <Trophy className="h-10 w-10 text-black" />
      </div>
      <h2 className="text-3xl font-serif font-light mb-2">Bam, {chatterFirstName}.</h2>
      <p className="text-white/70 mb-6">
        Du hast dein Coaching durchgezogen — und jedes Mal, wenn du das machst, wirst du besser lesbar für die Fans.
      </p>

      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
          <div className="text-[10px] uppercase tracking-widest text-white/40">Level</div>
          <div className="text-2xl font-serif mt-1">{level.title}</div>
        </div>
        <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
          <div className="text-[10px] uppercase tracking-widest text-white/40">Quiz richtig</div>
          <div className="text-2xl font-serif mt-1">{stats.quiz}</div>
        </div>
        <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
          <div className="text-[10px] uppercase tracking-widest text-white/40">Übungen</div>
          <div className="text-2xl font-serif mt-1">{stats.drills}</div>
        </div>
      </div>

      {(progress.session_streak ?? 0) > 1 && (
        <div className="mb-6 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-rose-500/10 border border-rose-500/30">
          <Flame className="h-4 w-4 text-rose-400" />
          <span className="text-sm text-rose-100">
            {progress.session_streak} Coachings in Folge — die Kurve zeigt nach oben.
          </span>
        </div>
      )}

      {takeaways.length > 0 && (
        <div className="rounded-2xl bg-white/5 border border-white/10 p-5 text-left mb-4">
          <div className="text-[10px] uppercase tracking-widest text-white/40 mb-3">Was du mitnimmst</div>
          <ul className="space-y-2">
            {takeaways.map((t, i) => (
              <li key={i} className="flex items-start gap-2 text-white/85 text-sm leading-snug">
                <span className="text-amber-400 mt-0.5">·</span>
                <span className="italic">„{t}"</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {commitment && commitment.trim() && (
        <div className="rounded-2xl bg-gradient-to-br from-amber-500/15 to-rose-500/10 border border-amber-500/40 p-5 text-left mb-4">
          <div className="text-[10px] uppercase tracking-widest text-amber-400/80 mb-2">Dein Versprechen an dich selbst</div>
          <div className="text-amber-50 font-serif text-lg italic leading-snug">„{commitment}"</div>
        </div>
      )}

      {result.micro_action && (
        <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 p-5 text-left">
          <div className="text-[10px] uppercase tracking-widest text-amber-400/80 mb-2">Deine Mikro-Aktion diese Woche</div>
          <div className="text-amber-50 leading-relaxed">{result.micro_action}</div>
        </div>
      )}
    </div>
  );
}

