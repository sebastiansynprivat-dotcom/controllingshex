import { useEffect, useState } from "react";
import { Plus, Trash2, Pencil, Copy, FileText, Check, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast as sonner } from "sonner";

interface Note {
  id: string;
  title: string | null;
  body: string;
  position: number;
  created_at: string;
}

const SHARED_PLATFORM = "__shared__";

export default function StandardTab() {
  const { user } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Note | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const fetchNotes = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("standard_notes")
      .select("id, title, body, position, created_at")
      .order("position", { ascending: true })
      .order("created_at", { ascending: false });
    setNotes((data || []) as Note[]);
    setLoading(false);
  };

  useEffect(() => {
    if (user) fetchNotes();
  }, [user]);

  const openNew = () => {
    setEditing(null);
    setTitle("");
    setBody("");
    setEditorOpen(true);
  };

  const openEdit = (n: Note) => {
    setEditing(n);
    setTitle(n.title ?? "");
    setBody(n.body);
    setEditorOpen(true);
  };

  const save = async () => {
    if (!user) return;
    const t = title.trim() || null;
    const b = body.trim();
    if (!b && !t) {
      sonner.error("Bitte Text eingeben");
      return;
    }
    if (editing) {
      const { error } = await supabase
        .from("standard_notes")
        .update({ title: t, body: b })
        .eq("id", editing.id);
      if (error) return sonner.error(error.message);
    } else {
      const maxPos = notes.reduce((m, n) => Math.max(m, n.position), -1);
      const { error } = await supabase.from("standard_notes").insert({
        user_id: user.id,
        platform: SHARED_PLATFORM,
        title: t,
        body: b,
        position: maxPos + 1,
      });
      if (error) return sonner.error(error.message);
    }
    setEditorOpen(false);
    fetchNotes();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("standard_notes").delete().eq("id", id);
    if (error) return sonner.error(error.message);
    fetchNotes();
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      sonner.success("Text kopiert");
    } catch {
      sonner.error("Kopieren fehlgeschlagen");
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-br from-white/[0.04] via-white/[0.02] to-transparent p-4 sm:p-6">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary/30 to-primary/5 border border-primary/25 flex items-center justify-center shrink-0">
              <FileText className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold text-foreground tracking-tight">Standard</h3>
              <p className="text-[11px] text-foreground/55 font-light">Freie Notizen — ohne Tag oder Checks.</p>
            </div>
          </div>
          <Button onClick={openNew} size="sm" className="h-9 bg-primary hover:bg-primary/90 text-primary-foreground text-xs">
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Neue Notiz
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="h-5 w-5 border border-white/20 border-t-white/60 rounded-full animate-spin" />
          </div>
        ) : notes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/[0.1] py-12 text-center">
            <p className="text-sm text-foreground/50 font-light">Noch keine Notizen.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {notes.map((n) => (
              <div key={n.id} className="group rounded-xl border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04] transition-colors p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {n.title && (
                      <div className="text-[13px] font-medium text-foreground mb-1">{n.title}</div>
                    )}
                    <p
                      onClick={() => copy(n.body)}
                      title="Klick zum Kopieren"
                      className="text-[13px] text-foreground/85 whitespace-pre-wrap cursor-pointer hover:text-foreground transition-colors"
                    >
                      {n.body}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-foreground/60 hover:text-foreground" onClick={() => copy(n.body)}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-foreground/60 hover:text-foreground" onClick={() => openEdit(n)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-foreground/60 hover:text-destructive" onClick={() => remove(n.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="bg-[hsl(var(--surface-1))] border-white/[0.1]">
          <DialogHeader>
            <DialogTitle>{editing ? "Notiz bearbeiten" : "Neue Notiz"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Titel (optional)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="bg-white/[0.05] border-white/[0.12]"
            />
            <Textarea
              placeholder="Text…"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              className="bg-white/[0.05] border-white/[0.12]"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)}>
              <X className="h-3.5 w-3.5 mr-1.5" /> Abbrechen
            </Button>
            <Button onClick={save}>
              <Check className="h-3.5 w-3.5 mr-1.5" /> Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
