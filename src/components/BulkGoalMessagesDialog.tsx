import { useEffect, useRef, useState } from "react";
import { Loader2, Copy, Check, X, MessageCircle, Circle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatEUR } from "@/lib/monthly-goals";

export interface BulkTarget {
  chatter: string;
  goal: number;
  currentGoal?: number | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  platform: string;
  targets: BulkTarget[];
  onAccept?: (chatter: string, goal: number) => Promise<void>;
  onSkip?: (chatter: string) => void;
  onUnaccept?: (chatter: string) => Promise<void>;
}


type Status = "pending" | "loading" | "done" | "error";

interface Result {
  chatter: string;
  goal: number;
  status: Status;
  message: string;
  error?: string;
}

const CONCURRENCY = 3;
const LS_KEY = "bulkGoalMessages.autoAcceptOnCopy";
const LS_FILTER_KEY = "bulkGoalMessages.nameFilter";

type NameFilter = "all" | "whatsapp" | "platform";

/**
 * WhatsApp = Nachname abgekürzt ("Philip S." / "Philip S")
 * Plattform = Vor- + Nachname voll ausgeschrieben ("Philip Schmidt")
 * Ein-Wort-Namen fallen auf Plattform zurück.
 */
/**
 * WhatsApp = Nachname abgekürzt ("Philip S.", "Philip Sc", "Philip Sch")
 *            → letzter Token endet auf "." ODER ist max. 3 Zeichen lang.
 * Plattform = Vor- + Nachname voll ausgeschrieben ("Philip Schmidt").
 * Ein-Wort-Namen fallen auf Plattform zurück.
 */
function classifyName(name: string): "whatsapp" | "platform" {
  const tokens = name.trim().split(/\s+/);
  if (tokens.length < 2) return "platform";
  const last = tokens[tokens.length - 1];
  if (last.endsWith(".")) return "whatsapp";
  if (last.replace(/\.$/, "").length <= 3) return "whatsapp";
  return "platform";
}

export default function BulkGoalMessagesDialog({ open, onClose, platform, targets, onAccept, onSkip, onUnaccept }: Props) {
  const [results, setResults] = useState<Result[]>([]);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [acceptedSet, setAcceptedSet] = useState<Set<string>>(new Set());
  const [acceptingSet, setAcceptingSet] = useState<Set<string>>(new Set());
  const [acceptErrors, setAcceptErrors] = useState<Record<string, string>>({});
  const [skippedSet, setSkippedSet] = useState<Set<string>>(new Set());
  const [unacceptingSet, setUnacceptingSet] = useState<Set<string>>(new Set());
  const [editedGoals, setEditedGoals] = useState<Record<string, number>>({});

  const [autoAccept, setAutoAccept] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(LS_KEY);
      return v === null ? true : v === "1";
    } catch {
      return true;
    }
  });
  const [nameFilter, setNameFilter] = useState<NameFilter>(() => {
    try {
      const v = localStorage.getItem(LS_FILTER_KEY);
      return v === "whatsapp" || v === "platform" ? v : "all";
    } catch {
      return "all";
    }
  });
  const cancelRef = useRef(false);

  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, autoAccept ? "1" : "0");
    } catch {}
  }, [autoAccept]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_FILTER_KEY, nameFilter);
    } catch {}
  }, [nameFilter]);

  // Chatter mit bereits gesetztem Ziel komplett rausfiltern
  const effectiveTargets = targets.filter((t) => t.currentGoal == null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current = false;
    const initial: Result[] = effectiveTargets.map((t) => ({
      chatter: t.chatter,
      goal: t.goal,
      status: "pending",
      message: "",
    }));
    setResults(initial);
    setCopiedIdx(null);
    setCopiedAll(false);
    setAcceptedSet(new Set());
    setAcceptingSet(new Set());
    setUnacceptingSet(new Set());
    setEditedGoals({});
    setSkippedSet(new Set());
    setAcceptErrors({});


    let cursor = 0;
    const runNext = async (): Promise<void> => {
      if (cancelRef.current) return;
      const i = cursor++;
      if (i >= effectiveTargets.length) return;
      setResults((prev) => {
        const next = [...prev];
        next[i] = { ...next[i], status: "loading" };
        return next;
      });
      try {
        const { data, error } = await supabase.functions.invoke("generate-goal-message", {
          body: {
            chatter_name: effectiveTargets[i].chatter,
            platform,
            proposed_goal: effectiveTargets[i].goal,
            current_goal: null,
          },
        });
        if (error) throw error;
        if ((data as any)?.error) throw new Error((data as any).error);
        const msg = (data as any).message || "";
        setResults((prev) => {
          const next = [...prev];
          next[i] = { ...next[i], status: "done", message: msg };
          return next;
        });
      } catch (e: any) {
        setResults((prev) => {
          const next = [...prev];
          next[i] = { ...next[i], status: "error", message: "", error: e?.message || "Fehler" };
          return next;
        });
      }
      return runNext();
    };
    const workers = Array.from({ length: Math.min(CONCURRENCY, effectiveTargets.length) }, () => runNext());
    Promise.all(workers).catch(() => {});
    return () => {
      cancelRef.current = true;
    };
  }, [open, platform, targets]);

  async function acceptGoal(chatter: string, goal: number): Promise<boolean> {
    if (!onAccept) return false;
    if (acceptedSet.has(chatter)) return true;
    setAcceptingSet((prev) => new Set(prev).add(chatter));
    setAcceptErrors((prev) => {
      const { [chatter]: _, ...rest } = prev;
      return rest;
    });
    try {
      await onAccept(chatter, goal);
      setAcceptedSet((prev) => new Set(prev).add(chatter));
      return true;
    } catch (e: any) {
      setAcceptErrors((prev) => ({ ...prev, [chatter]: e?.message || "Fehler" }));
      return false;
    } finally {
      setAcceptingSet((prev) => {
        const next = new Set(prev);
        next.delete(chatter);
        return next;
      });
    }
  }

  async function copyOne(idx: number, text: string) {
    const r = results[idx];
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx((c) => (c === idx ? null : c)), 1500);
    } catch {
      toast.error("Kopieren fehlgeschlagen");
      return;
    }
    if (autoAccept && onAccept && !acceptedSet.has(r.chatter)) {
      const goal = editedGoals[r.chatter] ?? r.goal;
      const ok = await acceptGoal(r.chatter, goal);
      if (ok) toast.success(`Kopiert & Ziel gesetzt: ${formatEUR(goal)}`);
      else toast.error(`Kopiert, aber Ziel-Setzen fehlgeschlagen`);
    } else {
      toast.success("Kopiert");
    }

  }

  async function copyAll() {
    const doneResults = results.filter((r) => r.status === "done" && r.message);
    const blocks = doneResults
      .map((r) => `— ${r.chatter} · Ziel ${formatEUR(editedGoals[r.chatter] ?? r.goal)} —\n${r.message}`)
      .join("\n\n");

    if (!blocks) {
      toast.error("Noch keine Nachrichten zum Kopieren");
      return;
    }
    try {
      await navigator.clipboard.writeText(blocks);
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 1800);
    } catch {
      toast.error("Kopieren fehlgeschlagen");
      return;
    }
    if (autoAccept && onAccept) {
      const toAccept = doneResults.filter((r) => !acceptedSet.has(r.chatter));
      if (toAccept.length === 0) {
        toast.success("Alle Nachrichten kopiert");
        return;
      }
      const outcomes = await Promise.all(toAccept.map((r) => acceptGoal(r.chatter, editedGoals[r.chatter] ?? r.goal)));
      const okCount = outcomes.filter(Boolean).length;
      const failCount = outcomes.length - okCount;
      toast.success(
        `Alle Nachrichten kopiert · ${okCount} Ziel${okCount === 1 ? "" : "e"} gesetzt${failCount > 0 ? ` · ${failCount} Fehler` : ""}`,
      );
    } else {
      toast.success("Alle Nachrichten kopiert");
    }
  }

  const visibleResults = nameFilter === "all"
    ? results.map((r, idx) => ({ r, idx }))
    : results
        .map((r, idx) => ({ r, idx }))
        .filter(({ r }) => classifyName(r.chatter) === nameFilter);

  const waCount = results.filter((r) => classifyName(r.chatter) === "whatsapp").length;
  const platformCount = results.length - waCount;

  const doneCount = results.filter((r) => r.status === "done").length;
  const errCount = results.filter((r) => r.status === "error").length;
  const loadingCount = results.filter((r) => r.status === "loading" || r.status === "pending").length;
  const allDone = loadingCount === 0 && results.length > 0;

  const filterBtn = (val: NameFilter, label: string, count: number) => {
    const active = nameFilter === val;
    return (
      <button
        type="button"
        onClick={() => setNameFilter(val)}
        className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors font-light ${
          active
            ? "bg-white/10 border-white/20 text-white"
            : "bg-white/[0.02] border-white/[0.06] text-white/55 hover:text-white/85 hover:bg-white/[0.05]"
        }`}
      >
        {label} <span className="text-white/40">· {count}</span>
      </button>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-base">
            Nachrichten für alle Vorschläge ({results.length})
          </DialogTitle>
          <DialogDescription className="text-xs">
            {allDone
              ? `Fertig — ${doneCount} generiert${errCount > 0 ? `, ${errCount} Fehler` : ""}.`
              : `Generiere… ${doneCount}/${results.length} fertig${errCount > 0 ? ` · ${errCount} Fehler` : ""}`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-1.5 pb-2 flex-wrap">
          {filterBtn("all", "Alle", results.length)}
          {filterBtn("whatsapp", "WhatsApp", waCount)}
          {filterBtn("platform", "Plattform", platformCount)}
        </div>

        <div className="flex items-center justify-between gap-2 pb-2 border-b border-white/[0.06] flex-wrap">
          <label className="flex items-center gap-2 text-[11px] text-white/65 font-light cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoAccept}
              onChange={(e) => setAutoAccept(e.target.checked)}
              className="accent-emerald-400"
            />
            Ziel beim Kopieren übernehmen
          </label>
          <Button size="sm" disabled={doneCount === 0} onClick={copyAll}>
            {copiedAll ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            <span className="ml-1.5">{copiedAll ? "Alle kopiert" : "Alle kopieren"}</span>
          </Button>
        </div>

        <div className="overflow-y-auto flex-1 space-y-2 pr-1 -mr-1">
          {visibleResults.length === 0 && (
            <div className="text-[11px] text-white/40 font-light text-center py-6">
              Keine Einträge für diesen Filter.
            </div>
          )}
          {visibleResults.map(({ r, idx }) => {
            const accepted = acceptedSet.has(r.chatter);
            const accepting = acceptingSet.has(r.chatter);
            const unaccepting = unacceptingSet.has(r.chatter);
            const acceptErr = acceptErrors[r.chatter];
            const skipped = skippedSet.has(r.chatter);
            const isWhatsApp = classifyName(r.chatter) === "whatsapp";
            const dimmed = accepted || skipped;
            const effectiveGoal = editedGoals[r.chatter] ?? r.goal;
            const goalEdited = editedGoals[r.chatter] != null && editedGoals[r.chatter] !== r.goal;
            return (
              <div
                key={`${r.chatter}-${idx}`}
                className={`rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 transition-opacity ${dimmed ? "opacity-60" : ""}`}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0 flex items-start gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        if (accepting || unaccepting) return;
                        if (accepted) {
                          if (!onUnaccept) return;
                          setUnacceptingSet((prev) => new Set(prev).add(r.chatter));
                          try {
                            await onUnaccept(r.chatter);
                            setAcceptedSet((prev) => {
                              const next = new Set(prev);
                              next.delete(r.chatter);
                              return next;
                            });
                          } catch {
                            /* toast wird vom Parent gezeigt */
                          } finally {
                            setUnacceptingSet((prev) => {
                              const next = new Set(prev);
                              next.delete(r.chatter);
                              return next;
                            });
                          }
                          return;
                        }
                        if (skipped || !onAccept) return;
                        const goal = editedGoals[r.chatter] ?? r.goal;
                        acceptGoal(r.chatter, goal).then((ok) => {
                          if (ok) toast.success(`Ziel gesetzt: ${formatEUR(goal)}`);
                        });
                      }}
                      disabled={accepting || unaccepting || (!accepted && (skipped || !onAccept)) || (accepted && !onUnaccept)}
                      className="mt-0.5 shrink-0 text-white/40 hover:text-emerald-300 transition-colors disabled:hover:text-white/40 disabled:cursor-default"
                      title={accepted ? "Klicken zum Rückgängigmachen" : skipped ? "Übersprungen" : "Abhaken — Ziel übernehmen"}
                    >
                      {accepting || unaccepting ? (
                        <Loader2 className="h-5 w-5 animate-spin text-white/55" />
                      ) : accepted ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-300" />
                      ) : (
                        <Circle className="h-5 w-5" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (accepted || accepting) return;
                        setSkippedSet((prev) => {
                          const next = new Set(prev);
                          if (next.has(r.chatter)) {
                            next.delete(r.chatter);
                          } else {
                            next.add(r.chatter);
                            onSkip?.(r.chatter);
                            toast.success(`${r.chatter} übersprungen`);
                          }
                          return next;
                        });
                      }}
                      disabled={accepted || accepting}
                      className={`mt-0.5 shrink-0 transition-colors disabled:cursor-default ${skipped ? "text-red-300" : "text-white/40 hover:text-red-300"}`}
                      title={skipped ? "Skip aufheben" : "Überspringen — kein Monatsziel setzen"}
                    >
                      <X className="h-5 w-5" />
                    </button>
                    <div className="min-w-0">
                      <div
                        className="text-sm font-semibold text-white/90 truncate flex items-center gap-2 cursor-pointer hover:text-white transition-colors"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(r.chatter);
                            toast.success(`"${r.chatter}" kopiert`);
                          } catch {
                            toast.error("Kopieren fehlgeschlagen");
                          }
                        }}
                        title="Klicken zum Kopieren"
                      >
                        {r.chatter}
                        {skipped && (
                          <span className="text-[9px] uppercase tracking-[0.18em] text-red-300/80 font-light px-1.5 py-0.5 rounded border border-red-400/20 bg-red-400/5">
                            übersprungen
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-white/45 font-light flex items-center gap-1.5 mt-0.5">
                        <span>Ziel:</span>
                        <input
                          type="number"
                          min={0}
                          step={10}
                          value={effectiveGoal}
                          onChange={(e) => {
                            const v = e.target.value;
                            setEditedGoals((prev) => {
                              const next = { ...prev };
                              if (v === "") {
                                next[r.chatter] = 0;
                              } else {
                                const n = Number(v);
                                if (!Number.isFinite(n) || n < 0) return prev;
                                next[r.chatter] = Math.round(n);
                              }
                              return next;
                            });
                          }}
                          disabled={accepted || accepting || skipped}
                          className="w-20 bg-white/[0.04] border border-white/10 rounded px-1.5 py-0.5 text-[11px] text-white/85 tabular-nums focus:outline-none focus:border-white/25 disabled:opacity-60 disabled:cursor-not-allowed"
                        />
                        <span>€</span>
                        {goalEdited && (
                          <span className="text-[9px] uppercase tracking-[0.14em] text-amber-300/80">
                            bearbeitet · vorher {formatEUR(r.goal)}
                          </span>
                        )}
                      </div>
                      {acceptErr && (
                        <div className="text-[11px] text-red-300/80 font-light mt-0.5">
                          Ziel-Setzen: {acceptErr}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {r.status === "loading" && (
                      <span className="text-[10px] uppercase tracking-[0.18em] text-white/45 font-light flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" /> lädt
                      </span>
                    )}
                    {r.status === "pending" && (
                      <span className="text-[10px] uppercase tracking-[0.18em] text-white/30 font-light">
                        wartet
                      </span>
                    )}
                    {r.status === "error" && (
                      <span className="text-[10px] uppercase tracking-[0.18em] text-red-300 font-light flex items-center gap-1">
                        <X className="h-3 w-3" /> Fehler
                      </span>
                    )}
                    {r.status === "done" && (
                      <>
                        {isWhatsApp ? (
                          <button
                            onClick={async () => {
                              try { await navigator.clipboard.writeText(r.message); } catch {}
                              copyOne(idx, r.message);
                              const isMobile = /iphone|ipad|android/i.test(navigator.userAgent);
                              const url = isMobile
                                ? `whatsapp://send?text=${encodeURIComponent(r.message)}`
                                : `https://web.whatsapp.com/send?text=${encodeURIComponent(r.message)}`;
                              window.open(url, "_blank", "noopener,noreferrer");
                            }}
                            className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded-md border border-emerald-500/25 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20 transition-colors"
                            title="Nachricht kopieren & WhatsApp öffnen"
                          >
                            <MessageCircle className="h-3 w-3" />
                            WhatsApp
                          </button>
                        ) : (
                          <button
                            onClick={() => copyOne(idx, r.message)}
                            className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded-md border border-white/10 bg-white/[0.04] text-white/75 hover:bg-white/[0.08] hover:text-white transition-colors"
                          >
                            {copiedIdx === idx ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                            {copiedIdx === idx ? "Kopiert" : "Kopieren"}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
                {r.status === "error" ? (
                  <div className="text-xs text-red-300/80 font-light">{r.error}</div>
                ) : r.message ? (
                  <pre className="text-xs text-white/80 font-light whitespace-pre-wrap leading-relaxed font-sans">
                    {r.message}
                  </pre>
                ) : (
                  <div className="h-12 rounded-md bg-white/[0.02] animate-pulse" />
                )}
              </div>
            );
          })}
        </div>

        <div className="flex justify-end pt-2 border-t border-white/[0.06]">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Schließen
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
