import { useState, useEffect, useMemo } from "react";
import {
  Plus,
  Trash2,
  Copy,
  ChevronDown,
  ChevronRight,
  Pencil,
  Check,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePlatform } from "@/contexts/PlatformContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { toast as sonner } from "sonner";

interface Snippet {
  id: string;
  day_offset: number;
  title: string | null;
  body: string;
  position: number;
}

const COLLAPSED_KEY = "text_snippets_collapsed_v1";

export default function Notes() {
  const { user } = useAuth();
  const { platform } = usePlatform();
  const { toast } = useToast();
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});

  // Editor dialog
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Snippet | null>(null);
  const [draftDay, setDraftDay] = useState<string>("0");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");

  // New bucket
  const [newBucketDay, setNewBucketDay] = useState("");

  useEffect(() => {
    try {
      const c = localStorage.getItem(COLLAPSED_KEY);
      if (c) setCollapsed(JSON.parse(c));
    } catch {}
  }, []);

  const persistCollapsed = (next: Record<number, boolean>) => {
    setCollapsed(next);
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
  };

  const fetchSnippets = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("text_snippets")
      .select("id, day_offset, title, body, position")
      .eq("platform", platform)
      .order("day_offset", { ascending: true })
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (!error && data) setSnippets(data as Snippet[]);
    setLoading(false);
  };

  useEffect(() => {
    fetchSnippets();
  }, [user, platform]);

  // Group by day_offset
  const buckets = useMemo(() => {
    const map = new Map<number, Snippet[]>();
    for (const s of snippets) {
      if (!map.has(s.day_offset)) map.set(s.day_offset, []);
      map.get(s.day_offset)!.push(s);
    }
    // also include empty buckets remembered via collapsed map? skip — they show only when snippet exists
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [snippets]);

  // Empty buckets the user explicitly created (no snippets yet) — keep in local state
  const [extraBuckets, setExtraBuckets] = useState<number[]>([]);
  const allBuckets = useMemo(() => {
    const days = new Set<number>(buckets.map(([d]) => d));
    extraBuckets.forEach((d) => days.add(d));
    return Array.from(days).sort((a, b) => a - b);
  }, [buckets, extraBuckets]);

  const openEditor = (day: number, snippet: Snippet | null) => {
    setEditing(snippet);
    setDraftDay(String(snippet?.day_offset ?? day));
    setDraftTitle(snippet?.title ?? "");
    setDraftBody(snippet?.body ?? "");
    setEditorOpen(true);
  };

  const saveSnippet = async () => {
    if (!user) return;
    const day = parseInt(draftDay, 10);
    if (isNaN(day) || day < 0) {
      toast({ title: "Ungültiger Tag", variant: "destructive" });
      return;
    }
    const body = draftBody.trim();
    if (!body) {
      toast({ title: "Text fehlt", variant: "destructive" });
      return;
    }
    if (editing) {
      const { error } = await supabase
        .from("text_snippets")
        .update({
          day_offset: day,
          title: draftTitle.trim() || null,
          body,
        })
        .eq("id", editing.id);
      if (error) {
        toast({ title: "Fehler", description: error.message, variant: "destructive" });
        return;
      }
    } else {
      const maxPos = Math.max(
        -1,
        ...snippets.filter((s) => s.day_offset === day).map((s) => s.position),
      );
      const { error } = await supabase.from("text_snippets").insert({
        user_id: user.id,
        platform,
        day_offset: day,
        title: draftTitle.trim() || null,
        body,
        position: maxPos + 1,
      });
      if (error) {
        toast({ title: "Fehler", description: error.message, variant: "destructive" });
        return;
      }
      // Remove from extraBuckets if it was an empty bucket
      setExtraBuckets((prev) => prev.filter((d) => d !== day));
    }
    setEditorOpen(false);
    setEditing(null);
    setDraftBody("");
    setDraftTitle("");
    fetchSnippets();
  };

  const deleteSnippet = async (id: string) => {
    if (!confirm("Diesen Text wirklich löschen?")) return;
    const { error } = await supabase.from("text_snippets").delete().eq("id", id);
    if (error) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
      return;
    }
    fetchSnippets();
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      sonner.success("Kopiert");
    } catch {
      sonner.error("Kopieren fehlgeschlagen");
    }
  };

  const addBucket = () => {
    const n = parseInt(newBucketDay, 10);
    if (isNaN(n) || n < 0) {
      toast({ title: "Ungültiger Tag", variant: "destructive" });
      return;
    }
    if (!allBuckets.includes(n)) {
      setExtraBuckets((prev) => [...prev, n]);
    }
    setNewBucketDay("");
  };

  const removeEmptyBucket = (day: number) => {
    setExtraBuckets((prev) => prev.filter((d) => d !== day));
  };

  const dayLabel = (d: number) => (d === 0 ? "Tag 0 · Erstkontakt" : `Tag ${d}`);

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground/90 tracking-wide">Texte</h1>
          <p className="text-[11px] text-white/30 font-light mt-1">
            Vorformulierte Nachrichten · gruppiert nach Tag · ein Klick = kopiert
          </p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() => openEditor(0, null)}
          size="sm"
          className="bg-primary/15 hover:bg-primary/25 text-primary border border-primary/20 font-light text-xs"
        >
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Neuer Text
        </Button>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            addBucket();
          }}
          className="flex items-center gap-1.5"
        >
          <Input
            type="number"
            min={0}
            value={newBucketDay}
            onChange={(e) => setNewBucketDay(e.target.value)}
            placeholder="Tag …"
            className="h-8 w-24 bg-white/[0.03] border-white/[0.06] text-xs"
          />
          <Button
            type="submit"
            size="sm"
            variant="ghost"
            className="h-8 text-xs text-white/50 hover:text-white/80"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Bucket
          </Button>
        </form>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-5 w-5 border border-white/20 border-t-white/60 rounded-full animate-spin" />
        </div>
      ) : allBuckets.length === 0 ? (
        <div className="py-16 text-center text-white/30 text-sm">
          Noch keine Texte. Lege deinen ersten an.
        </div>
      ) : (
        <div className="space-y-4">
          {allBuckets.map((day) => {
            const items = snippets.filter((s) => s.day_offset === day);
            const isCollapsed = !!collapsed[day];
            return (
              <div
                key={day}
                className="rounded-xl border border-white/[0.06] bg-white/[0.015] overflow-hidden"
              >
                <div className="flex items-center justify-between px-4 py-3">
                  <button
                    onClick={() =>
                      persistCollapsed({ ...collapsed, [day]: !isCollapsed })
                    }
                    className="flex items-center gap-2 text-left flex-1 group"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="h-3.5 w-3.5 text-white/30 group-hover:text-white/60" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 text-white/30 group-hover:text-white/60" />
                    )}
                    <span className="text-sm font-medium text-foreground/85">
                      {dayLabel(day)}
                    </span>
                    <span className="text-[10px] text-white/30 ml-1">
                      {items.length} {items.length === 1 ? "Text" : "Texte"}
                    </span>
                  </button>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openEditor(day, null)}
                      className="text-white/30 hover:text-primary transition-colors p-1.5 rounded-md hover:bg-white/[0.04]"
                      title="Text in diesem Bucket"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                    {items.length === 0 && (
                      <button
                        onClick={() => removeEmptyBucket(day)}
                        className="text-white/20 hover:text-red-400/60 transition-colors p-1.5 rounded-md hover:bg-white/[0.04]"
                        title="Leeren Bucket entfernen"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {!isCollapsed && (
                  <div className="px-3 pb-3 space-y-2">
                    {items.length === 0 ? (
                      <p className="text-[11px] text-white/25 italic px-2 py-3">
                        Noch keine Texte für diesen Tag.
                      </p>
                    ) : (
                      items.map((s) => (
                        <SnippetCard
                          key={s.id}
                          snippet={s}
                          onCopy={() => copyText(s.body)}
                          onEdit={() => openEditor(s.day_offset, s)}
                          onDelete={() => deleteSnippet(s.id)}
                        />
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Editor Dialog */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-lg bg-[hsl(var(--surface-1))] border-white/[0.08]">
          <DialogHeader>
            <DialogTitle className="text-base font-medium text-foreground/90">
              {editing ? "Text bearbeiten" : "Neuer Text"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <label className="text-[11px] uppercase tracking-wider text-white/40">
                Tag (wann rausgehen)
              </label>
              <Input
                type="number"
                min={0}
                value={draftDay}
                onChange={(e) => setDraftDay(e.target.value)}
                className="bg-white/[0.03] border-white/[0.08] text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] uppercase tracking-wider text-white/40">
                Titel (optional)
              </label>
              <Input
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder="z. B. Sexy Opener"
                className="bg-white/[0.03] border-white/[0.08] text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] uppercase tracking-wider text-white/40">
                Text
              </label>
              <Textarea
                value={draftBody}
                onChange={(e) => setDraftBody(e.target.value)}
                placeholder="Den Text hier einfügen …"
                rows={8}
                className="bg-white/[0.03] border-white/[0.08] text-sm resize-y min-h-[160px]"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              onClick={() => setEditorOpen(false)}
              className="text-white/50 hover:text-white/80"
            >
              Abbrechen
            </Button>
            <Button
              onClick={saveSnippet}
              className="bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30"
            >
              <Check className="h-3.5 w-3.5 mr-1.5" />
              Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SnippetCard({
  snippet,
  onCopy,
  onEdit,
  onDelete,
}: {
  snippet: Snippet;
  onCopy: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group relative rounded-lg border border-white/[0.05] bg-white/[0.02] hover:border-white/[0.1] hover:bg-white/[0.035] transition-colors">
      <button
        onClick={onCopy}
        className="w-full text-left p-3 pr-3"
        title="Klick = kopieren"
      >
        {snippet.title && (
          <div className="text-[10px] uppercase tracking-wider text-primary/70 font-medium mb-1.5">
            {snippet.title}
          </div>
        )}
        <p className="text-sm text-foreground/85 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
          {snippet.body}
        </p>
      </button>
      <div className="absolute top-2 right-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onCopy}
          className="p-1.5 rounded-md bg-black/30 backdrop-blur-sm text-white/60 hover:text-primary hover:bg-black/50"
          title="Kopieren"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onEdit}
          className="p-1.5 rounded-md bg-black/30 backdrop-blur-sm text-white/60 hover:text-white hover:bg-black/50"
          title="Bearbeiten"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 rounded-md bg-black/30 backdrop-blur-sm text-white/60 hover:text-red-400 hover:bg-black/50"
          title="Löschen"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
