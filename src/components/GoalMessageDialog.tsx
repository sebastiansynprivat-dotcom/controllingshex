import { useEffect, useState } from "react";
import { Loader2, Copy, RefreshCw, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { formatEUR } from "@/lib/monthly-goals";

interface Props {
  open: boolean;
  onClose: () => void;
  chatter: string;
  platform: string;
  proposedGoal: number;
  currentGoal?: number | null;
}

export default function GoalMessageDialog({
  open,
  onClose,
  chatter,
  platform,
  proposedGoal,
  currentGoal,
}: Props) {
  const [goal, setGoal] = useState<number>(proposedGoal);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [context, setContext] = useState<any>(null);

  useEffect(() => {
    if (open) {
      setGoal(proposedGoal);
      setMessage("");
      setContext(null);
      setCopied(false);
      // auto-generate on open
      void generate(proposedGoal);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, chatter]);

  async function generate(useGoal: number) {
    setLoading(true);
    setMessage("");
    try {
      const { data, error } = await supabase.functions.invoke("generate-goal-message", {
        body: {
          chatter_name: chatter,
          platform,
          proposed_goal: useGoal,
          current_goal: currentGoal ?? null,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setMessage((data as any).message || "");
      setContext((data as any).context || null);
    } catch (e: any) {
      console.error("[GoalMessageDialog] generate failed", e);
      toast.error(e?.message || "Fehler beim Generieren");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      toast.success("Nachricht kopiert");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Kopieren fehlgeschlagen");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">
            Nachricht an {chatter}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Monats-Recap + neues Ziel. Kopieren und direkt rüberschicken.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="text-[10px] uppercase tracking-[0.18em] text-white/40 font-light">
                Neues Monatsziel (EUR)
              </label>
              <input
                type="number"
                min={0}
                step={50}
                value={goal}
                onChange={(e) => setGoal(Math.max(0, Number(e.target.value) || 0))}
                className="mt-1 w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-sm font-semibold tabular-nums text-white/90 focus:outline-none focus:border-emerald-300/40"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading || goal <= 0}
              onClick={() => generate(goal)}
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              <span className="ml-1.5">Neu generieren</span>
            </Button>
          </div>

          {context && (
            <div className="text-[11px] text-white/45 font-light leading-relaxed">
              {context.last_month_name}: {formatEUR(context.last_month_revenue)}
              {context.prior_goal ? ` / Ziel ${formatEUR(context.prior_goal)}` : ""}
              {context.goal_hit_pct != null ? ` · ${Math.round(context.goal_hit_pct)}%` : ""}
              {context.vs_prev_pct != null
                ? ` · Trend ${context.vs_prev_pct >= 0 ? "+" : ""}${Math.round(context.vs_prev_pct)}%`
                : ""}
            </div>
          )}

          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={loading ? "Nachricht wird generiert…" : "Nachricht erscheint hier…"}
            rows={9}
            className="bg-white/[0.03] border-white/10 text-sm leading-relaxed resize-none"
          />

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Schließen
            </Button>
            <Button size="sm" disabled={!message || loading} onClick={handleCopy}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              <span className="ml-1.5">{copied ? "Kopiert" : "Kopieren"}</span>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
