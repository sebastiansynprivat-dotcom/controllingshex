import { useEffect, useState } from "react";
import { Copy, Pencil, Check, X, Trash2, Loader2, CalendarDays, PartyPopper } from "lucide-react";
import { toast } from "sonner";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ChannelPlan, ChannelPlanDay, listPlans, listPlanDays, updatePlanDay, deletePlan,
} from "@/lib/channel-plan";

interface Props {
  platform: string;
  refreshKey: number;
}

function formatDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
}

export default function ChannelPlanView({ platform, refreshKey }: Props) {
  const [plans, setPlans] = useState<ChannelPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [days, setDays] = useState<ChannelPlanDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingDays, setLoadingDays] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTheme, setDraftTheme] = useState("");
  const [draftPost, setDraftPost] = useState("");
  const [pendingDelete, setPendingDelete] = useState<ChannelPlan | null>(null);

  const loadPlans = async () => {
    setLoading(true);
    try {
      const list = await listPlans(platform);
      setPlans(list);
      if (list.length > 0) setSelectedPlanId((prev) => prev && list.find(p => p.id === prev) ? prev : list[0].id);
      else setSelectedPlanId(null);
    } catch (e: any) { toast.error(e.message || "Fehler"); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadPlans(); }, [platform, refreshKey]);

  useEffect(() => {
    if (!selectedPlanId) { setDays([]); return; }
    setLoadingDays(true);
    listPlanDays(selectedPlanId)
      .then(setDays)
      .catch((e) => toast.error(e.message || "Fehler"))
      .finally(() => setLoadingDays(false));
  }, [selectedPlanId, refreshKey]);

  const startEdit = (d: ChannelPlanDay) => {
    setEditingId(d.id); setDraftTheme(d.theme); setDraftPost(d.post_text);
  };
  const cancelEdit = () => setEditingId(null);
  const saveEdit = async (id: string) => {
    try {
      await updatePlanDay(id, draftTheme.trim(), draftPost.trim());
      setDays((arr) => arr.map((d) => d.id === id ? { ...d, theme: draftTheme.trim(), post_text: draftPost.trim() } : d));
      setEditingId(null);
      toast.success("Gespeichert");
    } catch (e: any) { toast.error(e.message || "Fehler"); }
  };

  const copy = async (txt: string) => {
    try { await navigator.clipboard.writeText(txt); toast.success("Kopiert"); }
    catch { toast.error("Kopieren fehlgeschlagen"); }
  };

  const doDelete = async () => {
    if (!pendingDelete) return;
    const p = pendingDelete; setPendingDelete(null);
    try { await deletePlan(p.id); toast.success("Plan gelöscht"); await loadPlans(); }
    catch (e: any) { toast.error(e.message || "Fehler"); }
  };

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-4 w-4 animate-spin text-foreground/40" /></div>;
  }

  if (plans.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/[0.08] py-14 text-center">
        <CalendarDays className="h-7 w-7 text-foreground/25 mx-auto mb-3" />
        <p className="text-[13px] text-foreground/55 font-light">Noch kein Plan generiert.</p>
        <p className="text-[11px] text-foreground/35 font-light mt-1">Klicke oben auf „Neue Woche generieren".</p>
      </div>
    );
  }

  const selected = plans.find(p => p.id === selectedPlanId);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Select value={selectedPlanId ?? undefined} onValueChange={setSelectedPlanId}>
          <SelectTrigger className="h-9 w-auto min-w-[220px] bg-white/[0.05] border-white/[0.12] text-sm text-foreground">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[hsl(var(--surface-1))] border-white/[0.1]">
            {plans.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                Woche ab {new Date(p.week_start + "T00:00:00").toLocaleDateString("de-DE")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selected && (
          <Button variant="outline" size="sm" onClick={() => setPendingDelete(selected)} className="h-9 bg-white/[0.04] hover:bg-red-500/10 hover:text-red-400 text-foreground/70 border-white/[0.12] hover:border-red-500/30 text-xs">
            <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Plan löschen
          </Button>
        )}
      </div>

      {loadingDays ? (
        <div className="flex justify-center py-10"><Loader2 className="h-4 w-4 animate-spin text-foreground/40" /></div>
      ) : (
        <div className="space-y-2.5">
          {days.map((d) => {
            const isEditing = editingId === d.id;
            const holiday = d.context_notes?.holiday;
            return (
              <div key={d.id} className="rounded-xl border border-white/[0.08] bg-gradient-to-br from-white/[0.04] via-white/[0.02] to-transparent p-4 hover:border-white/[0.14] transition-colors">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-[0.15em] text-foreground/45 font-semibold">{formatDate(d.plan_date)}</div>
                    {holiday && (
                      <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-amber-300 bg-amber-500/10 border border-amber-500/25 px-1.5 py-0.5 rounded">
                        <PartyPopper className="h-2.5 w-2.5" /> {holiday}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {!isEditing && (
                      <>
                        <button onClick={() => copy(d.post_text)} className="p-1.5 rounded-md text-foreground/70 hover:text-primary hover:bg-primary/10" title="Copy"><Copy className="h-3.5 w-3.5" /></button>
                        <button onClick={() => startEdit(d)} className="p-1.5 rounded-md text-foreground/70 hover:text-foreground hover:bg-white/[0.06]" title="Edit"><Pencil className="h-3.5 w-3.5" /></button>
                      </>
                    )}
                    {isEditing && (
                      <>
                        <button onClick={() => saveEdit(d.id)} className="p-1.5 rounded-md text-emerald-400 hover:bg-emerald-500/10" title="Save"><Check className="h-3.5 w-3.5" /></button>
                        <button onClick={cancelEdit} className="p-1.5 rounded-md text-foreground/60 hover:bg-white/[0.06]" title="Cancel"><X className="h-3.5 w-3.5" /></button>
                      </>
                    )}
                  </div>
                </div>
                {isEditing ? (
                  <div className="space-y-2">
                    <Input value={draftTheme} onChange={(e) => setDraftTheme(e.target.value)} placeholder="Thema" className="bg-white/[0.05] border-white/[0.12] text-sm" />
                    <Textarea value={draftPost} onChange={(e) => setDraftPost(e.target.value)} rows={6} className="bg-white/[0.05] border-white/[0.12] text-sm min-h-[140px]" />
                  </div>
                ) : (
                  <>
                    {d.theme && <div className="text-[12px] text-primary font-medium mb-1.5">{d.theme}</div>}
                    <p className="text-[13px] text-foreground/85 whitespace-pre-wrap leading-relaxed">{d.post_text}</p>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent className="bg-[hsl(var(--surface-1))] border-white/[0.1]">
          <AlertDialogHeader>
            <AlertDialogTitle>Wochenplan löschen?</AlertDialogTitle>
            <AlertDialogDescription>Der komplette Plan inkl. aller Tages-Posts wird entfernt.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-white/[0.04] hover:bg-white/[0.08] text-foreground border-white/[0.12]">Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete} className="bg-red-500 hover:bg-red-600 text-white border-0">Löschen</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
