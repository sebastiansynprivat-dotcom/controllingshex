import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Loader2, Database, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  ChannelKnowledge, listKnowledge, createKnowledge, updateKnowledge, deleteKnowledge,
} from "@/lib/channel-plan";

interface Props { platform: string }

export default function ChannelKnowledgeList({ platform }: Props) {
  const [items, setItems] = useState<ChannelKnowledge[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<ChannelKnowledge | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ChannelKnowledge | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setItems(await listKnowledge(platform));
    } catch (e: any) {
      toast.error(e.message || "Konnte nicht laden");
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [platform]);

  const openNew = () => {
    setEditing(null); setDraftTitle(""); setDraftBody(""); setEditorOpen(true);
  };
  const openEdit = (k: ChannelKnowledge) => {
    setEditing(k); setDraftTitle(k.title || ""); setDraftBody(k.body); setEditorOpen(true);
  };

  const save = async () => {
    if (!draftBody.trim()) { toast.error("Body fehlt"); return; }
    setSaving(true);
    try {
      if (editing) await updateKnowledge(editing.id, draftTitle.trim() || null, draftBody.trim());
      else await createKnowledge(platform, draftTitle.trim() || null, draftBody.trim());
      setEditorOpen(false);
      await load();
      toast.success("Gespeichert");
    } catch (e: any) {
      toast.error(e.message || "Fehler");
    } finally { setSaving(false); }
  };

  const doDelete = async () => {
    if (!pendingDelete) return;
    const k = pendingDelete; setPendingDelete(null);
    try { await deleteKnowledge(k.id); await load(); toast.success("Gelöscht"); }
    catch (e: any) { toast.error(e.message || "Fehler"); }
  };

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-br from-white/[0.04] via-white/[0.02] to-transparent p-4 sm:p-6">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-primary/30 to-primary/5 border border-primary/25 flex items-center justify-center shrink-0">
            <Database className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-foreground tracking-tight">AI-Wissensbasis</h3>
            <p className="text-[11px] text-foreground/55 font-light">Notizen, Themen, Tonalität, Beispiele — Kontext für die Wochenplanung.</p>
          </div>
        </div>
        <Button size="sm" onClick={openNew} className="h-9 bg-primary hover:bg-primary/90 text-primary-foreground border-0 shadow-lg shadow-primary/25 text-xs font-medium shrink-0">
          <Plus className="h-3.5 w-3.5 mr-1.5" /> Eintrag
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-4 w-4 animate-spin text-foreground/40" /></div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/[0.08] py-10 text-center">
          <p className="text-[12px] text-foreground/45 font-light">Noch keine Einträge.</p>
          <p className="text-[11px] text-foreground/35 font-light mt-1">Füge Themen, Briefings oder Tonalitäts-Hinweise hinzu.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((k) => (
            <div key={k.id} className="group rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 sm:p-4 hover:border-white/[0.14] transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {k.title && (
                    <div className="text-[10px] uppercase tracking-[0.15em] text-primary font-semibold mb-1.5">{k.title}</div>
                  )}
                  <p className="text-[13px] text-foreground/85 whitespace-pre-wrap leading-relaxed">{k.body}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => openEdit(k)} className="p-1.5 rounded-md text-foreground/70 hover:text-foreground hover:bg-white/[0.06]" title="Edit">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => setPendingDelete(k)} className="p-1.5 rounded-md text-foreground/50 hover:text-red-400 hover:bg-red-500/10" title="Delete">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-lg bg-[hsl(var(--surface-1))] border-white/[0.1]">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-foreground">
              {editing ? "Eintrag bearbeiten" : "Neuer Eintrag"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div>
              <label className="text-[11px] uppercase tracking-wider text-foreground/55 font-medium">Titel (optional)</label>
              <Input value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} placeholder="z.B. Tonalität" className="mt-1 bg-white/[0.05] border-white/[0.12] text-sm" />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-foreground/55 font-medium">Inhalt</label>
              <Textarea value={draftBody} onChange={(e) => setDraftBody(e.target.value)} rows={8} placeholder="Themen, Beispiele, Do/Don'ts …" className="mt-1 bg-white/[0.05] border-white/[0.12] text-sm min-h-[200px]" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditorOpen(false)} className="bg-white/[0.04] hover:bg-white/[0.08] text-foreground border-white/[0.12]">
              <X className="h-3.5 w-3.5 mr-1.5" /> Abbrechen
            </Button>
            <Button onClick={save} disabled={saving} className="bg-primary hover:bg-primary/90 text-primary-foreground border-0">
              {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Check className="h-3.5 w-3.5 mr-1.5" />}
              Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent className="bg-[hsl(var(--surface-1))] border-white/[0.1]">
          <AlertDialogHeader>
            <AlertDialogTitle>Eintrag löschen?</AlertDialogTitle>
            <AlertDialogDescription>Dieser Wissensbasis-Eintrag wird dauerhaft entfernt.</AlertDialogDescription>
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
