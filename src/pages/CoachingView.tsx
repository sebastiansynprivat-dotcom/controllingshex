import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2, Sparkles, CheckCircle2, Circle, ChevronRight, ChevronLeft, ArrowRight, MessageCircle, Target, Trophy, HelpCircle, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  CoachingAnalysisRow,
  CoachingProgress,
  Lever,
  StoryboardRound,
  loadAnalysisByToken,
  updateProgress,
  evaluateSimulation,
} from "@/lib/coaching";

type Section = "cover" | "lever" | "sbi" | "action" | "done";

export default function CoachingView() {
  const { token } = useParams<{ token: string }>();
  const [row, setRow] = useState<CoachingAnalysisRow | null>(null);
  const [progress, setProgress] = useState<CoachingProgress>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<Section>("cover");
  const [leverIdx, setLeverIdx] = useState(0);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    loadAnalysisByToken(token)
      .then((r) => {
        setRow(r);
        setProgress(r.progress_json ?? {});
      })
      .catch((e) => setError(e.message ?? "Fehler beim Laden"))
      .finally(() => setLoading(false));
  }, [token]);

  const saveProgress = useCallback(
    async (next: CoachingProgress) => {
      if (!token) return;
      setProgress(next);
      try {
        await updateProgress(token, next);
      } catch (e: any) {
        console.warn("progress save failed", e);
      }
    },
    [token],
  );

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
          <div className="text-white/70 text-lg font-light mb-2">Coaching nicht gefunden</div>
          <div className="text-white/40 text-sm">{error ?? "Der Link ist ungültig oder abgelaufen."}</div>
        </div>
      </div>
    );
  }

  const result = row.summary_json ?? ({} as any);
  const levers: Lever[] = Array.isArray(result.top_3_levers) ? result.top_3_levers : [];

  const readSet = new Set(progress.levers_read ?? []);
  const markLeverRead = (i: number) => {
    if (readSet.has(i)) return;
    readSet.add(i);
    saveProgress({ ...progress, levers_read: Array.from(readSet) });
  };

  const goToLever = (i: number) => {
    setLeverIdx(i);
    setSection("lever");
    markLeverRead(i);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white/90">
      <TopNav
        row={row}
        section={section}
        leverIdx={leverIdx}
        levers={levers}
        onGoCover={() => setSection("cover")}
        onGoLever={goToLever}
        onGoSbi={() => setSection("sbi")}
        onGoAction={() => setSection("action")}
        progress={progress}
      />

      <div className="max-w-3xl mx-auto px-4 sm:px-8 pb-24 pt-6">
        {section === "cover" && (
          <CoverSection row={row} levers={levers} onStart={() => goToLever(0)} />
        )}
        {section === "lever" && levers[leverIdx] && (
          <LeverSection
            key={leverIdx}
            lever={levers[leverIdx]}
            index={leverIdx}
            total={levers.length}
            token={token!}
            progress={progress}
            onSaveProgress={saveProgress}
            onNext={() => {
              if (leverIdx + 1 < levers.length) goToLever(leverIdx + 1);
              else setSection("sbi");
            }}
            onPrev={() => {
              if (leverIdx > 0) goToLever(leverIdx - 1);
              else setSection("cover");
            }}
          />
        )}
        {section === "sbi" && (
          <SbiSection
            row={row}
            onNext={() => setSection("action")}
            onPrev={() => goToLever(Math.max(0, levers.length - 1))}
          />
        )}
        {section === "action" && (
          <ActionSection
            row={row}
            progress={progress}
            onSaveProgress={saveProgress}
            onDone={async () => {
              await saveProgress({ ...progress, completed: true });
              setSection("done");
            }}
            onPrev={() => setSection("sbi")}
          />
        )}
        {section === "done" && <DoneSection row={row} />}
      </div>
    </div>
  );
}

/* ---------- Nav ---------- */

function TopNav({
  row, section, leverIdx, levers, progress,
  onGoCover, onGoLever, onGoSbi, onGoAction,
}: {
  row: CoachingAnalysisRow;
  section: Section;
  leverIdx: number;
  levers: Lever[];
  progress: CoachingProgress;
  onGoCover: () => void;
  onGoLever: (i: number) => void;
  onGoSbi: () => void;
  onGoAction: () => void;
}) {
  const readSet = new Set(progress.levers_read ?? []);
  const total = levers.length + 3; // cover + levers + sbi + action
  const doneCount =
    (section !== "cover" || readSet.size > 0 ? 1 : 0) +
    readSet.size +
    (section === "sbi" || section === "action" || section === "done" ? 1 : 0) +
    (progress.completed ? 1 : 0);
  const pct = Math.min(100, Math.round((doneCount / total) * 100));

  return (
    <div className="sticky top-0 z-20 bg-zinc-950/85 backdrop-blur-xl border-b border-white/[0.06]">
      <div className="max-w-3xl mx-auto px-4 sm:px-8 py-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Sparkles className="h-4 w-4 text-primary/80" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{row.chatter_name} · Coaching</div>
            <div className="text-[11px] text-white/40 font-light">
              {row.date_from} → {row.date_to} · {row.chats_analyzed} Chats
            </div>
          </div>
          <div className="text-xs text-white/50 tabular-nums">{pct}%</div>
        </div>
        <div className="mt-3 h-1 bg-white/[0.05] rounded-full overflow-hidden">
          <div className="h-full bg-primary/70 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-3 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          <NavChip label="Start" active={section === "cover"} onClick={onGoCover} />
          {levers.map((_, i) => (
            <NavChip
              key={i}
              label={`Hebel ${i + 1}`}
              active={section === "lever" && leverIdx === i}
              done={readSet.has(i)}
              onClick={() => onGoLever(i)}
            />
          ))}
          <NavChip label="Feedback" active={section === "sbi"} onClick={onGoSbi} />
          <NavChip label="Aktion" active={section === "action" || section === "done"} done={!!progress.completed} onClick={onGoAction} />
        </div>
      </div>
    </div>
  );
}

function NavChip({ label, active, done, onClick }: { label: string; active?: boolean; done?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-medium border transition-colors ${
        active
          ? "bg-primary/15 border-primary/40 text-primary-foreground/95"
          : done
            ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-200/90"
            : "bg-white/[0.03] border-white/[0.06] text-white/60 hover:bg-white/[0.06]"
      }`}
    >
      {done && !active && <CheckCircle2 className="h-3 w-3 inline mr-1 -mt-0.5" />}
      {label}
    </button>
  );
}

/* ---------- Cover ---------- */

function CoverSection({ row, levers, onStart }: { row: CoachingAnalysisRow; levers: Lever[]; onStart: () => void }) {
  const result = row.summary_json ?? ({} as any);
  const wc = result.weekly_comparison;
  return (
    <div className="space-y-8 py-6">
      <div>
        <div className="text-xs uppercase tracking-widest text-primary/70 mb-2">Dein persönliches Coaching</div>
        <h1 className="text-3xl sm:text-4xl font-light tracking-tight text-white leading-tight">
          Hey {row.chatter_name}
        </h1>
        {result.headline_promise && (
          <p className="mt-4 text-lg sm:text-xl text-white/70 font-light leading-relaxed">
            {result.headline_promise}
          </p>
        )}
      </div>

      {result.personal_intro && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 text-[15px] leading-relaxed text-white/80">
          {result.personal_intro}
        </div>
      )}

      {wc && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
          <div className="text-[11px] uppercase tracking-widest text-white/40 mb-3">Vs. Vorperiode</div>
          <div className="text-lg font-medium text-white/90 mb-2">{wc.headline}</div>
          <div className="text-sm text-white/60 leading-relaxed">{wc.summary}</div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <MiniStat label="Diese Periode" value={`${Math.round(wc.current_revenue_eur ?? 0)}€`} />
            <MiniStat label="Vorperiode" value={`${Math.round(wc.previous_revenue_eur ?? 0)}€`} />
          </div>
        </div>
      )}

      <div>
        <div className="text-[11px] uppercase tracking-widest text-white/40 mb-3">Deine 3 Hebel</div>
        <div className="space-y-2">
          {levers.map((l, i) => (
            <div key={i} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 flex items-center gap-3">
              <div className="w-7 h-7 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center text-xs font-medium text-primary-foreground/90">
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-white/90 truncate">{l.title}</div>
                {l.one_liner && <div className="text-[12px] text-white/50 truncate">{l.one_liner}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <Button onClick={onStart} className="w-full h-12 text-base">
        Los geht's <ArrowRight className="h-4 w-4 ml-2" />
      </Button>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.05] px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-widest text-white/40">{label}</div>
      <div className="text-lg font-medium text-white/90 tabular-nums">{value}</div>
    </div>
  );
}

/* ---------- Lever ---------- */

function LeverSection({
  lever, index, total, token, progress, onSaveProgress, onNext, onPrev,
}: {
  lever: Lever;
  index: number;
  total: number;
  token: string;
  progress: CoachingProgress;
  onSaveProgress: (p: CoachingProgress) => void;
  onNext: () => void;
  onPrev: () => void;
}) {
  const storyboard: StoryboardRound[] = Array.isArray(lever.storyboard) ? lever.storyboard : [];
  return (
    <div className="space-y-6 py-6">
      <div>
        <div className="text-xs uppercase tracking-widest text-primary/70 mb-2">Hebel {index + 1} von {total}</div>
        <h2 className="text-2xl sm:text-3xl font-light text-white leading-tight">{lever.title}</h2>
        {lever.one_liner && (
          <p className="mt-3 text-lg text-white/70 font-light">{lever.one_liner}</p>
        )}
        {lever.money_line && (
          <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-amber-400/10 border border-amber-400/25 px-3 py-1.5 text-[12px] text-amber-100/90">
            💰 {lever.money_line}
          </div>
        )}
      </div>

      {(lever.situation_summary || lever.customer_profile) && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 space-y-3">
          <div className="text-[11px] uppercase tracking-widest text-white/40">Der Kontext</div>
          {lever.situation_summary && (
            <p className="text-[15px] leading-relaxed text-white/80">{lever.situation_summary}</p>
          )}
          {lever.customer_profile && (
            <div className="pt-2 border-t border-white/[0.05] text-sm text-white/60 leading-relaxed">
              <span className="text-white/50 font-medium">Wer ist der Kunde: </span>
              {lever.customer_profile}
            </div>
          )}
        </div>
      )}

      <div className="space-y-4">
        {storyboard.map((r, i) => (
          <RoundCard key={i} round={r} index={i} />
        ))}
      </div>

      {lever.quiz && (
        <QuizCard
          quiz={lever.quiz}
          answered={progress.quiz_answers?.[index]}
          onAnswer={(selected) => {
            const correct = selected === lever.quiz!.correct_index;
            const next = {
              ...progress,
              quiz_answers: {
                ...(progress.quiz_answers ?? {}),
                [index]: { selected, correct, at: new Date().toISOString() },
              },
            };
            onSaveProgress(next);
          }}
        />
      )}

      {lever.simulation_prompt && (
        <SimulationCard
          prompt={lever.simulation_prompt}
          token={token}
          leverIndex={index}
          result={progress.simulation_results?.[index]}
          onResult={(res) => {
            onSaveProgress({
              ...progress,
              simulation_results: {
                ...(progress.simulation_results ?? {}),
                [index]: { ...res, at: new Date().toISOString() },
              },
            });
          }}
        />
      )}

      <div className="flex gap-2 pt-2">
        <Button variant="ghost" onClick={onPrev} className="flex-1">
          <ChevronLeft className="h-4 w-4 mr-1" /> Zurück
        </Button>
        <Button onClick={onNext} className="flex-1">
          Weiter <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

function RoundCard({ round, index }: { round: StoryboardRound; index: number }) {
  const labels = ["So lief es", "So wäre es besser", "Sag genau das"];
  const label = labels[index] ?? `Runde ${index + 1}`;
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center text-[11px] font-medium text-primary-foreground/90">
          {index + 1}
        </div>
        <div className="text-[11px] uppercase tracking-widest text-white/50 font-medium">{label}</div>
      </div>
      {round.context && (
        <div className="text-sm text-white/60 leading-relaxed italic border-l-2 border-primary/25 pl-3">
          {round.context}
        </div>
      )}
      {round.customer && (
        <Bubble side="left" label="Kunde" text={round.customer} />
      )}
      {round.chatter_did && (
        <Bubble side="right" label="Du hast geschrieben" text={round.chatter_did} muted />
      )}
      {round.verdict && (
        <div className="text-[12px] text-amber-200/80 pl-2">→ {round.verdict}</div>
      )}
      {round.better_version && (
        <Bubble side="right" label="So besser" text={round.better_version} accent />
      )}
      {round.why_one_line && (
        <div className="text-[12px] text-emerald-200/80 pl-2">Warum: {round.why_one_line}</div>
      )}
      {round.say_this && (
        <Bubble side="right" label="Merksatz" text={round.say_this} accent big />
      )}
    </div>
  );
}

function Bubble({
  side, label, text, muted, accent, big,
}: { side: "left" | "right"; label: string; text: string; muted?: boolean; accent?: boolean; big?: boolean }) {
  const isRight = side === "right";
  return (
    <div className={`flex ${isRight ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[85%] space-y-1">
        <div className={`text-[10px] uppercase tracking-widest ${isRight ? "text-right" : "text-left"} ${accent ? "text-primary/80" : "text-white/40"}`}>
          {label}
        </div>
        <div
          className={`px-4 py-3 rounded-2xl text-[15px] leading-relaxed whitespace-pre-wrap ${
            accent
              ? "bg-primary text-primary-foreground rounded-tr-sm"
              : muted
                ? "bg-white/[0.05] text-white/70 rounded-tr-sm"
                : "bg-white/[0.08] text-white/90 rounded-tl-sm"
          } ${big ? "text-base sm:text-lg font-medium" : ""}`}
        >
          {text}
        </div>
      </div>
    </div>
  );
}

function QuizCard({
  quiz, answered, onAnswer,
}: {
  quiz: NonNullable<Lever["quiz"]>;
  answered?: { selected: number; correct: boolean };
  onAnswer: (i: number) => void;
}) {
  const done = !!answered;
  return (
    <div className="rounded-2xl border border-primary/20 bg-primary/[0.04] p-5 space-y-4">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-primary/80">
        <HelpCircle className="h-3.5 w-3.5" /> Quick-Check
      </div>
      <div className="text-[15px] font-medium text-white/90 leading-relaxed">{quiz.question}</div>
      <div className="space-y-2">
        {quiz.options.map((opt, i) => {
          const isSelected = answered?.selected === i;
          const isCorrect = i === quiz.correct_index;
          const showColor = done && (isSelected || isCorrect);
          return (
            <button
              key={i}
              disabled={done}
              onClick={() => onAnswer(i)}
              className={`w-full text-left rounded-xl border px-4 py-3 text-sm transition-colors ${
                showColor && isCorrect
                  ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-100"
                  : showColor && isSelected && !isCorrect
                    ? "bg-red-500/15 border-red-500/40 text-red-100"
                    : "bg-white/[0.03] border-white/[0.06] text-white/80 hover:bg-white/[0.06]"
              } ${done ? "cursor-default" : "cursor-pointer"}`}
            >
              <div className="flex items-center gap-2">
                {done && isCorrect ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                ) : (
                  <Circle className="h-4 w-4 text-white/30 shrink-0" />
                )}
                <span>{opt}</span>
              </div>
            </button>
          );
        })}
      </div>
      {done && (
        <div className={`rounded-xl px-4 py-3 text-sm ${answered!.correct ? "bg-emerald-500/10 text-emerald-100/90" : "bg-white/[0.04] text-white/75"}`}>
          <div className="font-medium mb-1">{answered!.correct ? "Genau richtig 🎯" : "Nah dran — merk dir das:"}</div>
          <div className="text-[13px] leading-relaxed">{quiz.explanation}</div>
        </div>
      )}
    </div>
  );
}

function SimulationCard({
  prompt, token, leverIndex, result, onResult,
}: {
  prompt: NonNullable<Lever["simulation_prompt"]>;
  token: string;
  leverIndex: number;
  result?: { answer: string; score: number; feedback: string };
  onResult: (r: { answer: string; score: number; feedback: string }) => void;
}) {
  const [answer, setAnswer] = useState(result?.answer ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!answer.trim()) {
      toast.error("Schreib erst eine Antwort.");
      return;
    }
    setBusy(true);
    try {
      const res = await evaluateSimulation({ token, lever_index: leverIndex, answer });
      onResult({ answer, ...res });
    } catch (e: any) {
      toast.error(e.message ?? "Auswertung fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 space-y-4">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-white/60">
        <PlayCircle className="h-3.5 w-3.5" /> Simulation — was schreibst du?
      </div>
      <Bubble side="left" label="Kunde" text={prompt.customer_message} />
      <Textarea
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        placeholder="Tipp deine Antwort so, wie du sie wirklich schicken würdest…"
        rows={4}
        className="bg-white/[0.03] border-white/[0.06]"
        disabled={busy}
      />
      <Button onClick={submit} disabled={busy || !answer.trim()} className="w-full">
        {busy ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> KI bewertet…</> : <>Antwort einreichen</>}
      </Button>
      {result && (
        <div className="rounded-xl bg-white/[0.04] border border-white/[0.06] p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-amber-300" />
            <span className="text-sm font-medium">Feedback · {result.score}/10</span>
          </div>
          <div className="text-[13px] leading-relaxed text-white/75 whitespace-pre-wrap">{result.feedback}</div>
        </div>
      )}
    </div>
  );
}

/* ---------- SBI ---------- */

function SbiSection({ row, onNext, onPrev }: { row: CoachingAnalysisRow; onNext: () => void; onPrev: () => void }) {
  const sbi = row.summary_json?.sbi_feedback;
  return (
    <div className="space-y-6 py-6">
      <div>
        <div className="text-xs uppercase tracking-widest text-primary/70 mb-2">Persönliches Feedback</div>
        <h2 className="text-2xl sm:text-3xl font-light text-white leading-tight">Was besonders auffiel</h2>
      </div>
      {sbi?.strength && (
        <SbiBlock
          title="Deine Stärke"
          tone="strength"
          situation={sbi.strength.situation}
          behavior={sbi.strength.behavior}
          impact={sbi.strength.impact}
        />
      )}
      {sbi?.growth && (
        <SbiBlock
          title="Deine Wachstums-Chance"
          tone="growth"
          situation={sbi.growth.situation}
          behavior={sbi.growth.behavior}
          impact={sbi.growth.impact}
          alternative={sbi.growth.alternative_if_then}
        />
      )}
      {!sbi && <div className="text-white/40 text-sm">Kein Feedback verfügbar.</div>}
      <div className="flex gap-2 pt-2">
        <Button variant="ghost" onClick={onPrev} className="flex-1"><ChevronLeft className="h-4 w-4 mr-1" /> Zurück</Button>
        <Button onClick={onNext} className="flex-1">Weiter <ChevronRight className="h-4 w-4 ml-1" /></Button>
      </div>
    </div>
  );
}

function SbiBlock({
  title, tone, situation, behavior, impact, alternative,
}: { title: string; tone: "strength" | "growth"; situation: string; behavior: string; impact: string; alternative?: string }) {
  const accent = tone === "strength" ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-100" : "bg-amber-500/10 border-amber-500/25 text-amber-100";
  return (
    <div className={`rounded-2xl border ${tone === "strength" ? "border-emerald-500/20" : "border-amber-500/20"} bg-white/[0.02] p-5 space-y-3`}>
      <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-medium ${accent}`}>
        {tone === "strength" ? <Trophy className="h-3.5 w-3.5" /> : <Target className="h-3.5 w-3.5" />}
        {title}
      </div>
      <SbiRow label="Situation" text={situation} />
      <SbiRow label="Was du getan hast" text={behavior} />
      <SbiRow label="Was das bewirkt hat" text={impact} />
      {alternative && (
        <div className="rounded-xl bg-primary/10 border border-primary/25 p-4">
          <div className="text-[10px] uppercase tracking-widest text-primary/80 mb-1">So beim nächsten Mal</div>
          <div className="text-[15px] font-medium text-white/95 leading-relaxed">„{alternative}"</div>
        </div>
      )}
    </div>
  );
}

function SbiRow({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-white/40 mb-1">{label}</div>
      <div className="text-[14px] leading-relaxed text-white/80">{text}</div>
    </div>
  );
}

/* ---------- Action ---------- */

function ActionSection({
  row, progress, onSaveProgress, onDone, onPrev,
}: {
  row: CoachingAnalysisRow;
  progress: CoachingProgress;
  onSaveProgress: (p: CoachingProgress) => void;
  onDone: () => void;
  onPrev: () => void;
}) {
  const r = row.summary_json ?? ({} as any);
  const levers: Lever[] = Array.isArray(r.top_3_levers) ? r.top_3_levers : [];
  const sayThis = levers[0]?.storyboard?.[2]?.say_this?.trim();

  const done = !!progress.actions_done?.[0];
  const toggleAction = () => {
    onSaveProgress({
      ...progress,
      actions_done: { ...(progress.actions_done ?? {}), 0: !done },
    });
  };

  return (
    <div className="space-y-6 py-6">
      <div>
        <div className="text-xs uppercase tracking-widest text-primary/70 mb-2">Dein nächster Schritt</div>
        <h2 className="text-2xl sm:text-3xl font-light text-white leading-tight">Eine Sache. Sieben Tage.</h2>
        <p className="mt-3 text-white/60 leading-relaxed">Alles andere kommt später. Nur diese eine Handlung, jeden Tag.</p>
      </div>

      {sayThis && (
        <div className="rounded-2xl bg-zinc-900 border border-primary/30 p-6">
          <div className="text-[10px] uppercase tracking-widest text-primary/80 mb-3">Der eine Satz für diese Woche</div>
          <div className="text-xl sm:text-2xl font-medium text-white leading-snug">„{sayThis}"</div>
        </div>
      )}

      {r.micro_action && (
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 space-y-3">
          <div className="text-[11px] uppercase tracking-widest text-white/50">Mikro-Aktion diese Woche</div>
          <div className="text-[16px] font-medium text-white/95 leading-relaxed">{r.micro_action}</div>
          <button
            onClick={toggleAction}
            className={`w-full flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors ${
              done ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-100" : "bg-white/[0.03] border-white/[0.06] text-white/70 hover:bg-white/[0.05]"
            }`}
          >
            {done ? <CheckCircle2 className="h-5 w-5" /> : <Circle className="h-5 w-5" />}
            <span className="text-sm font-medium">{done ? "Ich mache das diese Woche" : "Ich verpflichte mich"}</span>
          </button>
        </div>
      )}

      {r.retrieval_question && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
          <div className="text-[11px] uppercase tracking-widest text-white/50 mb-2 flex items-center gap-2">
            <MessageCircle className="h-3.5 w-3.5" /> Frag dich selbst
          </div>
          <div className="text-[15px] italic text-white/80 leading-relaxed">{r.retrieval_question}</div>
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <Button variant="ghost" onClick={onPrev} className="flex-1"><ChevronLeft className="h-4 w-4 mr-1" /> Zurück</Button>
        <Button onClick={onDone} className="flex-1">Coaching abschließen <CheckCircle2 className="h-4 w-4 ml-2" /></Button>
      </div>
    </div>
  );
}

function DoneSection({ row }: { row: CoachingAnalysisRow }) {
  return (
    <div className="py-12 text-center space-y-4">
      <div className="w-16 h-16 rounded-full bg-emerald-500/15 border border-emerald-500/30 mx-auto flex items-center justify-center">
        <CheckCircle2 className="h-8 w-8 text-emerald-400" />
      </div>
      <h2 className="text-2xl font-light text-white">Stark gemacht, {row.chatter_name}.</h2>
      <p className="text-white/60 max-w-md mx-auto leading-relaxed">
        Nächste Woche schauen wir, wie viel dir der eine Satz gebracht hat.
      </p>
    </div>
  );
}
