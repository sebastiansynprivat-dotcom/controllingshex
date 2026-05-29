import { useEffect, useRef, useState } from "react";
import { Loader2, Copy, Check, X } from "lucide-react";
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
}

interface Props {
  open: boolean;
  onClose: () => void;
  platform: string;
  targets: BulkTarget[];
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

export default function BulkGoalMessagesDialog({ open, onClose, platform, targets }: Props) {
  const [results, setResults] = useState<Result[]>([]);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const cancelRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    cancelRef.current = false;
    const initial: Result[] = targets.map((t) => ({
      chatter: t.chatter,
      goal: t.goal,
      status: "pending",
      message: "",
    }));
    setResults(initial);
    setCopiedIdx(null);
    setCopiedAll(false);

    // Worker-Pool mit begrenzter Parallelität
    let cursor = 0;
    const runNext = async (): Promise<void> => {
      if (cancelRef.current) return;
      const i = cursor++;
      if (i >= targets.length) return;
      setResults((prev) => {
        const next = [...prev];
        next[i] = { ...next[i], status: "loading" };
        return next;
      });
      try {
        const { data, error } = await supabase.functions.invoke("generate-goal-message", {
          body: {
            chatter_name: targets[i].chatter,
            platform,
            proposed_goal: targets[i].goal,
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
    const workers = Array.from({ length: Math.min(CONCURRENCY, targets.length) }, () => runNext());
    Promise.all(workers).catch(() => {});
    return () => {
      cancelRef.current = true;
    };
  }, [open, platform, targets]);

  async function copyOne(idx: number, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx((c) => (c === idx ? null : c)), 1500);
    } catch {
      toast.error("Kopieren fehlgeschlagen");
    }
  }

  async function copyAll() {
    const blocks = results
      .filter((r) => r.status === "done" && r.message)
      .map((r) => `— ${r.chatter} · Ziel ${formatEUR(r.goal)} —\n${r.message}`)
      .join("\n\n");
    if (!blocks) {
      toast.error("Noch keine Nachrichten zum Kopieren");
      return;
    }
    try {
      await navigator.clipboard.writeText(blocks);
      setCopiedAll(true);
      toast.success("Alle Nachrichten kopiert");
      setTimeout(() => setCopiedAll(false), 1800);
    } catch {
      toast.error("Kopieren fehlgeschlagen");
    }
  }

  const doneCount = results.filter((r) => r.status === "done").length;
  const errCount = results.filter((r) => r.status === "error").length;
  const loadingCount = results.filter((r) => r.status === "loading" || r.status === "pending").length;
  const allDone = loadingCount === 0 && results.length > 0;

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

        <div className="flex items-center justify-between gap-2 pb-2 border-b border-white/[0.06]">
          <div className="text-[11px] text-white/45 font-light">
            Parallel: {CONCURRENCY} · Setzt KEINE Ziele — nur Nachrichten-Generierung
          </div>
          <Button size="sm" disabled={doneCount === 0} onClick={copyAll}>
            {copiedAll ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            <span className="ml-1.5">{copiedAll ? "Alle kopiert" : "Alle kopieren"}</span>
          </Button>
        </div>

        <div className="overflow-y-auto flex-1 space-y-2 pr-1 -mr-1">
          {results.map((r, idx) => (
            <div
              key={`${r.chatter}-${idx}`}
              className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white/90 truncate">{r.chatter}</div>
                  <div className="text-[11px] text-white/45 font-light">
                    Ziel: {formatEUR(r.goal)}
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
                    <button
                      onClick={() => copyOne(idx, r.message)}
                      className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded-md border border-white/10 bg-white/[0.04] text-white/75 hover:bg-white/[0.08] hover:text-white transition-colors"
                    >
                      {copiedIdx === idx ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      {copiedIdx === idx ? "Kopiert" : "Kopieren"}
                    </button>
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
          ))}
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
