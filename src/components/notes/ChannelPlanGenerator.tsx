import { useState } from "react";
import { Sparkles, Loader2, CalendarDays } from "lucide-react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { generatePlan, nextMondayISO } from "@/lib/channel-plan";

interface Props {
  platform: string;
  onGenerated: (planId: string) => void;
}

const WEEKDAYS = [
  { num: 1, label: "Mo" },
  { num: 2, label: "Di" },
  { num: 3, label: "Mi" },
  { num: 4, label: "Do" },
  { num: 5, label: "Fr" },
  { num: 6, label: "Sa" },
  { num: 7, label: "So" },
];

export default function ChannelPlanGenerator({ platform, onGenerated }: Props) {
  const [open, setOpen] = useState(false);
  const [weekStart, setWeekStart] = useState(nextMondayISO());
  const [selected, setSelected] = useState<number[]>([1, 3, 5]);
  const [extraContext, setExtraContext] = useState("");
  const [loading, setLoading] = useState(false);

  const toggle = (n: number) =>
    setSelected((s) => (s.includes(n) ? s.filter((x) => x !== n) : [...s, n].sort()));

  const generate = async () => {
    if (selected.length === 0) { toast.error("Mindestens 1 Tag wählen"); return; }
    setLoading(true);
    try {
      const res = await generatePlan({
        platform,
        week_start: weekStart,
        selected_weekdays: selected,
        extra_context: extraContext.trim() || undefined,
      });
      toast.success("Plan generiert");
      setOpen(false);
      onGenerated(res.plan_id);
    } catch (e: any) {
      toast.error(e.message || "Fehler");
    } finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-9 bg-primary hover:bg-primary/90 text-primary-foreground border-0 shadow-lg shadow-primary/25 text-xs font-medium">
          <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Neue Woche generieren
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md bg-[hsl(var(--surface-1))] border-white/[0.1]">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold text-foreground flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-primary" /> Wochenplan generieren
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <label className="text-[11px] uppercase tracking-wider text-foreground/55 font-medium">Wochenstart</label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "mt-1 w-full justify-start text-left font-normal h-10 bg-white/[0.05] border-white/[0.12] text-sm text-foreground hover:bg-white/[0.08]",
                    !weekStart && "text-foreground/50"
                  )}
                >
                  <CalendarDays className="mr-2 h-4 w-4 text-primary" />
                  {weekStart
                    ? format(new Date(weekStart + "T00:00:00"), "EEEE, d. MMMM yyyy", { locale: de })
                    : "Datum wählen"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 bg-[hsl(var(--surface-1))] border-white/[0.1]" align="start">
                <Calendar
                  mode="single"
                  selected={weekStart ? new Date(weekStart + "T00:00:00") : undefined}
                  onSelect={(d) => {
                    if (d) {
                      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                      setWeekStart(iso);
                    }
                  }}
                  weekStartsOn={1}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wider text-foreground/55 font-medium">Posting-Tage</label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {WEEKDAYS.map((w) => {
                const on = selected.includes(w.num);
                return (
                  <button key={w.num} onClick={() => toggle(w.num)} className={`h-9 w-12 rounded-lg text-xs font-semibold border transition-colors ${on ? "bg-primary/20 text-primary border-primary/40" : "bg-white/[0.04] text-foreground/60 border-white/[0.08] hover:bg-white/[0.08]"}`}>
                    {w.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wider text-foreground/55 font-medium">Extra Kontext (optional)</label>
            <Textarea value={extraContext} onChange={(e) => setExtraContext(e.target.value)} rows={3} placeholder="z.B. Fokus auf Sommer-Promo, neue Story-Reihe …" className="mt-1 bg-white/[0.05] border-white/[0.12] text-sm" />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} className="bg-white/[0.04] hover:bg-white/[0.08] text-foreground border-white/[0.12]">Abbrechen</Button>
          <Button onClick={generate} disabled={loading} className="bg-primary hover:bg-primary/90 text-primary-foreground border-0">
            {loading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
            Generieren
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
