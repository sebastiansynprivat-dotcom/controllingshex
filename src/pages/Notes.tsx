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
  MessageSquareText,
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
  const totalSnippets = snippets.length;

  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-6 py-3 sm:py-10 space-y-3 sm:space-y-6">
      {/* Hero Header */}
      <div className="relative overflow-hidden rounded-2xl sm:rounded-3xl border border-white/[0.06] bg-gradient-to-br from-white/[0.04] via-white/[0.02] to-transparent p-4 sm:p-8">
        <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-primary/[0.06] blur-3xl pointer-events-none" />
        <div className="relative flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 sm:gap-6">
          <div className="flex items-start gap-3 sm:gap-4 min-w-0">
            <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-xl sm:rounded-2xl bg-gradient-to-br from-primary/25 to-primary/5 border border-primary/20 flex items-center justify-center shrink-0">
              <MessageSquareText className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-2xl font-semibold text-foreground/95 tracking-tight">
                Texte
              </h1>
              <p className="text-[12px] sm:text-sm text-white/55 font-light mt-1 sm:mt-1.5 max-w-xl leading-relaxed">
                Vorformulierte Nachrichten · gruppiert nach Tag · ein Klick kopiert in die Zwischenablage.
              </p>
              <div className="flex items-center gap-3 mt-2 sm:mt-3 text-[11px] text-white/35">
                <span>{totalSnippets} {totalSnippets === 1 ? "Text" : "Texte"}</span>
                <span className="h-1 w-1 rounded-full bg-white/15" />
                <span>{allBuckets.length} {allBuckets.length === 1 ? "Bucket" : "Buckets"}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Button
              onClick={() => openEditor(0, null)}
              size="sm"
              className="h-9 bg-gradient-to-br from-primary/30 to-primary/15 hover:from-primary/40 hover:to-primary/20 text-primary border border-primary/30 font-medium text-xs shadow-lg shadow-primary/10"
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
                className="h-9 w-20 bg-white/[0.04] border-white/[0.08] text-xs text-center"
              />
              <Button
                type="submit"
                size="sm"
                variant="ghost"
                className="h-9 text-xs text-white/55 hover:text-white/90 hover:bg-white/[0.04]"
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Bucket
              </Button>
            </form>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="h-5 w-5 border border-white/20 border-t-white/60 rounded-full animate-spin" />
        </div>
      ) : allBuckets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.015] py-20 text-center">
          <MessageSquareText className="h-8 w-8 text-white/15 mx-auto mb-3" />
          <p className="text-sm text-white/40 font-light">Noch keine Texte angelegt.</p>
          <p className="text-[11px] text-white/25 font-light mt-1">
            Klick auf „Neuer Text" um loszulegen.
          </p>
        </div>
      ) : (
        <div className="space-y-3 sm:space-y-4">
          {allBuckets.map((day) => {
            const items = snippets.filter((s) => s.day_offset === day);
            const isCollapsed = !!collapsed[day];
            return (
              <div
                key={day}
                className="rounded-2xl border border-white/[0.06] bg-gradient-to-br from-white/[0.035] via-white/[0.015] to-transparent overflow-hidden hover:border-white/[0.1] transition-colors"
              >
                <div className="flex items-center justify-between px-4 sm:px-5 py-3 sm:py-4">
                  <button
                    onClick={() =>
                      persistCollapsed({ ...collapsed, [day]: !isCollapsed })
                    }
                    className="flex items-center gap-3 text-left flex-1 group"
                  >
                    <div className="h-7 w-7 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center group-hover:bg-white/[0.07] transition-colors shrink-0">
                      {isCollapsed ? (
                        <ChevronRight className="h-3.5 w-3.5 text-white/50" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5 text-white/50" />
                      )}
                    </div>
                    <div className="flex items-baseline gap-2 min-w-0">
                      <span className="text-sm sm:text-[15px] font-semibold text-foreground/90 tracking-tight">
                        {dayLabel(day)}
                      </span>
                      <span className="text-[10px] uppercase tracking-wider text-white/30">
                        {items.length} {items.length === 1 ? "Text" : "Texte"}
                      </span>
                    </div>
                  </button>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openEditor(day, null)}
                      className="text-white/40 hover:text-primary transition-colors p-2 rounded-lg hover:bg-white/[0.05]"
                      title="Text in diesem Bucket"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                    {items.length === 0 && (
                      <button
                        onClick={() => removeEmptyBucket(day)}
                        className="text-white/25 hover:text-red-400/70 transition-colors p-2 rounded-lg hover:bg-white/[0.05]"
                        title="Leeren Bucket entfernen"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>

                {!isCollapsed && (
                  <div className="px-3 sm:px-4 pb-4 pt-1 space-y-2">
                    {items.length === 0 ? (
                      <p className="text-[11px] text-white/25 italic px-3 py-4">
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
    <div className="group relative rounded-xl border border-white/[0.06] bg-gradient-to-br from-white/[0.035] via-white/[0.02] to-transparent hover:border-primary/25 hover:from-white/[0.05] transition-all duration-200 shadow-sm">
      <button
        onClick={onCopy}
        className="w-full text-left p-4 pr-12"
        title="Klick = kopieren"
      >
        {snippet.title && (
          <div className="text-[10px] uppercase tracking-[0.15em] text-primary/80 font-semibold mb-2">
            {snippet.title}
          </div>
        )}
        <p className="text-[13px] sm:text-sm text-foreground/85 whitespace-pre-wrap leading-relaxed max-h-56 overflow-y-auto">
          {snippet.body}
        </p>
        <div className="flex items-center gap-1.5 mt-3 text-[10px] text-white/30 group-hover:text-primary/70 transition-colors">
          <Copy className="h-3 w-3" />
          <span className="uppercase tracking-wider font-medium">Klick zum Kopieren</span>
        </div>
      </button>
      <div className="absolute top-2.5 right-2.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onEdit}
          className="p-1.5 rounded-md bg-black/40 backdrop-blur-sm border border-white/[0.06] text-white/60 hover:text-white hover:bg-black/60"
          title="Bearbeiten"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 rounded-md bg-black/40 backdrop-blur-sm border border-white/[0.06] text-white/60 hover:text-red-400 hover:bg-black/60"
          title="Löschen"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
