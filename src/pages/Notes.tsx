import { useState, useEffect, useMemo, useRef } from "react";
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
  ImagePlus,
  Loader2,
  Play,
  Download,
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
  media_urls: string[];
}

const COLLAPSED_KEY = "text_snippets_collapsed_v1";
const BUCKET = "snippet-media";

const isVideoPath = (p: string) => /\.(mp4|webm|mov|m4v|ogv)$/i.test(p);

export default function Notes() {
  const { user } = useAuth();
  const { platform } = usePlatform();
  const { toast } = useToast();
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});

  // Signed URL cache
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});

  // Editor
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Snippet | null>(null);
  const [draftDay, setDraftDay] = useState<string>("0");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [draftMedia, setDraftMedia] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // New bucket
  const [newBucketDay, setNewBucketDay] = useState("");

  // Lightbox
  const [lightbox, setLightbox] = useState<string | null>(null);

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
      .select("id, day_offset, title, body, position, media_urls")
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

  // Sign URLs whenever snippets change
  useEffect(() => {
    const allPaths = Array.from(
      new Set(snippets.flatMap((s) => s.media_urls || [])),
    );
    const missing = allPaths.filter((p) => !signedUrls[p]);
    if (missing.length === 0) return;
    (async () => {
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrls(missing, 3600);
      if (error || !data) return;
      const next: Record<string, string> = {};
      data.forEach((d, i) => {
        if (d.signedUrl) next[missing[i]] = d.signedUrl;
      });
      setSignedUrls((prev) => ({ ...prev, ...next }));
    })();
  }, [snippets]);

  const buckets = useMemo(() => {
    const map = new Map<number, Snippet[]>();
    for (const s of snippets) {
      if (!map.has(s.day_offset)) map.set(s.day_offset, []);
      map.get(s.day_offset)!.push(s);
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [snippets]);

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
    setDraftMedia(snippet?.media_urls ?? []);
    setEditorOpen(true);
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || !user) return;
    setUploading(true);
    const newPaths: string[] = [];
    for (const file of Array.from(files)) {
      if (file.size > 50 * 1024 * 1024) {
        toast({
          title: `${file.name} ist zu groß`,
          description: "Max. 50 MB pro Datei.",
          variant: "destructive",
        });
        continue;
      }
      const ext = file.name.split(".").pop() || "bin";
      const safe = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
      const path = `${user.id}/${crypto.randomUUID()}-${safe}`;
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type });
      if (error) {
        toast({ title: "Upload fehlgeschlagen", description: error.message, variant: "destructive" });
        continue;
      }
      newPaths.push(path);
      // Pre-sign immediately for preview
      const { data: signed } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(path, 3600);
      if (signed?.signedUrl) {
        setSignedUrls((prev) => ({ ...prev, [path]: signed.signedUrl }));
      }
    }
    setDraftMedia((prev) => [...prev, ...newPaths]);
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeDraftMedia = async (path: string) => {
    setDraftMedia((prev) => prev.filter((p) => p !== path));
    // Only delete from storage if it wasn't already saved (i.e., new upload)
    if (!editing || !editing.media_urls.includes(path)) {
      await supabase.storage.from(BUCKET).remove([path]);
    }
  };

  const saveSnippet = async () => {
    if (!user) return;
    const day = parseInt(draftDay, 10);
    if (isNaN(day) || day < 0) {
      toast({ title: "Ungültiger Tag", variant: "destructive" });
      return;
    }
    const body = draftBody.trim();
    if (!body && draftMedia.length === 0) {
      toast({ title: "Text oder Medium fehlt", variant: "destructive" });
      return;
    }

    if (editing) {
      // Delete removed media from storage
      const removed = editing.media_urls.filter((p) => !draftMedia.includes(p));
      if (removed.length) {
        await supabase.storage.from(BUCKET).remove(removed);
      }
      const { error } = await supabase
        .from("text_snippets")
        .update({
          day_offset: day,
          title: draftTitle.trim() || null,
          body,
          media_urls: draftMedia,
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
        media_urls: draftMedia,
      });
      if (error) {
        toast({ title: "Fehler", description: error.message, variant: "destructive" });
        return;
      }
      setExtraBuckets((prev) => prev.filter((d) => d !== day));
    }
    setEditorOpen(false);
    setEditing(null);
    setDraftBody("");
    setDraftTitle("");
    setDraftMedia([]);
    fetchSnippets();
  };

  const deleteSnippet = async (s: Snippet) => {
    if (!confirm("Diesen Text wirklich löschen?")) return;
    if (s.media_urls?.length) {
      await supabase.storage.from(BUCKET).remove(s.media_urls);
    }
    const { error } = await supabase.from("text_snippets").delete().eq("id", s.id);
    if (error) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
      return;
    }
    fetchSnippets();
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      sonner.success("Text kopiert");
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
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl sm:rounded-3xl border border-white/[0.08] bg-gradient-to-br from-white/[0.05] via-white/[0.02] to-transparent p-4 sm:p-8">
        <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-primary/[0.08] blur-3xl pointer-events-none" />
        <div className="relative flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 sm:gap-6">
          <div className="flex items-start gap-3 sm:gap-4 min-w-0">
            <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-xl sm:rounded-2xl bg-gradient-to-br from-primary/30 to-primary/5 border border-primary/25 flex items-center justify-center shrink-0">
              <MessageSquareText className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-2xl font-semibold text-foreground tracking-tight">
                Texte
              </h1>
              <p className="text-[12px] sm:text-sm text-foreground/60 font-light mt-1 sm:mt-1.5 max-w-xl leading-relaxed">
                Vorformulierte Nachrichten · gruppiert nach Tag · ein Klick kopiert in die Zwischenablage.
              </p>
              <div className="flex items-center gap-3 mt-2 sm:mt-3 text-[11px] text-foreground/45">
                <span>{totalSnippets} {totalSnippets === 1 ? "Text" : "Texte"}</span>
                <span className="h-1 w-1 rounded-full bg-white/20" />
                <span>{allBuckets.length} {allBuckets.length === 1 ? "Bucket" : "Buckets"}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Button
              onClick={() => openEditor(0, null)}
              size="sm"
              className="h-9 bg-primary hover:bg-primary/90 text-primary-foreground font-medium text-xs shadow-lg shadow-primary/25 border-0"
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
                placeholder="Tag"
                className="h-9 w-20 bg-white/[0.05] border-white/[0.12] text-xs text-center text-foreground placeholder:text-foreground/40"
              />
              <Button
                type="submit"
                size="sm"
                variant="outline"
                className="h-9 text-xs bg-white/[0.04] hover:bg-white/[0.08] text-foreground/80 hover:text-foreground border-white/[0.12]"
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
        <div className="rounded-2xl border border-dashed border-white/[0.1] bg-white/[0.02] py-20 text-center">
          <MessageSquareText className="h-8 w-8 text-foreground/20 mx-auto mb-3" />
          <p className="text-sm text-foreground/50 font-light">Noch keine Texte angelegt.</p>
          <p className="text-[11px] text-foreground/35 font-light mt-1">
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
                className="rounded-2xl border border-white/[0.08] bg-gradient-to-br from-white/[0.04] via-white/[0.02] to-transparent overflow-hidden hover:border-white/[0.12] transition-colors"
              >
                <div className="flex items-center justify-between px-4 sm:px-5 py-3 sm:py-4">
                  <button
                    onClick={() =>
                      persistCollapsed({ ...collapsed, [day]: !isCollapsed })
                    }
                    className="flex items-center gap-3 text-left flex-1 group min-w-0"
                  >
                    <div className="h-7 w-7 rounded-lg bg-white/[0.06] border border-white/[0.1] flex items-center justify-center group-hover:bg-white/[0.1] transition-colors shrink-0">
                      {isCollapsed ? (
                        <ChevronRight className="h-3.5 w-3.5 text-foreground/70" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5 text-foreground/70" />
                      )}
                    </div>
                    <div className="flex items-baseline gap-2 min-w-0">
                      <span className="text-sm sm:text-[15px] font-semibold text-foreground tracking-tight truncate">
                        {dayLabel(day)}
                      </span>
                      <span className="text-[10px] uppercase tracking-wider text-foreground/45 font-medium">
                        {items.length} {items.length === 1 ? "Text" : "Texte"}
                      </span>
                    </div>
                  </button>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => openEditor(day, null)}
                      className="flex items-center gap-1 text-xs text-primary bg-primary/15 hover:bg-primary/25 border border-primary/25 transition-colors px-2.5 py-1.5 rounded-lg font-medium"
                      title="Text in diesem Bucket"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Text</span>
                    </button>
                    {items.length === 0 && (
                      <button
                        onClick={() => removeEmptyBucket(day)}
                        className="text-foreground/45 hover:text-red-400 bg-white/[0.04] hover:bg-red-500/10 border border-white/[0.08] hover:border-red-500/20 transition-colors p-1.5 rounded-lg"
                        title="Leeren Bucket entfernen"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {!isCollapsed && (
                  <div className="px-3 sm:px-4 pb-4 pt-1 space-y-2">
                    {items.length === 0 ? (
                      <p className="text-[11px] text-foreground/35 italic px-3 py-4">
                        Noch keine Texte für diesen Tag.
                      </p>
                    ) : (
                      items.map((s) => (
                        <SnippetCard
                          key={s.id}
                          snippet={s}
                          signedUrls={signedUrls}
                          onCopy={() => copyText(s.body)}
                          onEdit={() => openEditor(s.day_offset, s)}
                          onDelete={() => deleteSnippet(s)}
                          onMediaClick={(p) => setLightbox(p)}
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
        <DialogContent className="max-w-lg bg-[hsl(var(--surface-1))] border-white/[0.1] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-foreground">
              {editing ? "Text bearbeiten" : "Neuer Text"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <label className="text-[11px] uppercase tracking-wider text-foreground/55 font-medium">
                Tag (wann rausgehen)
              </label>
              <Input
                type="number"
                min={0}
                value={draftDay}
                onChange={(e) => setDraftDay(e.target.value)}
                className="bg-white/[0.05] border-white/[0.12] text-sm text-foreground"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] uppercase tracking-wider text-foreground/55 font-medium">
                Titel (optional)
              </label>
              <Input
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder="z. B. Sexy Opener"
                className="bg-white/[0.05] border-white/[0.12] text-sm text-foreground placeholder:text-foreground/35"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] uppercase tracking-wider text-foreground/55 font-medium">
                Text
              </label>
              <Textarea
                value={draftBody}
                onChange={(e) => setDraftBody(e.target.value)}
                placeholder="Den Text hier einfügen …"
                rows={6}
                className="bg-white/[0.05] border-white/[0.12] text-sm text-foreground placeholder:text-foreground/35 resize-y min-h-[140px]"
              />
            </div>

            {/* Media uploader */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[11px] uppercase tracking-wider text-foreground/55 font-medium">
                  Medien (Bilder & Videos)
                </label>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-1.5 text-xs text-primary bg-primary/15 hover:bg-primary/25 disabled:opacity-50 border border-primary/25 transition-colors px-2.5 py-1.5 rounded-lg font-medium"
                >
                  {uploading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ImagePlus className="h-3.5 w-3.5" />
                  )}
                  Hinzufügen
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  onChange={(e) => handleFiles(e.target.files)}
                  className="hidden"
                />
              </div>
              {draftMedia.length === 0 ? (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border border-dashed border-white/[0.1] rounded-lg p-6 text-center cursor-pointer hover:border-white/[0.2] hover:bg-white/[0.02] transition-colors"
                >
                  <ImagePlus className="h-5 w-5 text-foreground/30 mx-auto mb-1.5" />
                  <p className="text-[11px] text-foreground/45">
                    Bilder oder Videos hochladen (max. 50 MB)
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {draftMedia.map((path) => {
                    const url = signedUrls[path];
                    const isVideo = isVideoPath(path);
                    return (
                      <div
                        key={path}
                        className="relative group aspect-square rounded-lg overflow-hidden border border-white/[0.08] bg-black/30"
                      >
                        {url ? (
                          isVideo ? (
                            <video src={url} className="h-full w-full object-cover" muted />
                          ) : (
                            <img src={url} alt="" className="h-full w-full object-cover" />
                          )
                        ) : (
                          <div className="h-full w-full flex items-center justify-center">
                            <Loader2 className="h-4 w-4 animate-spin text-foreground/40" />
                          </div>
                        )}
                        {isVideo && (
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="h-7 w-7 rounded-full bg-black/60 flex items-center justify-center">
                              <Play className="h-3.5 w-3.5 text-white fill-white" />
                            </div>
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => removeDraftMedia(path)}
                          className="absolute top-1 right-1 p-1 rounded-md bg-black/70 text-white hover:bg-red-500/80 transition-colors"
                          title="Entfernen"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setEditorOpen(false)}
              className="bg-white/[0.04] hover:bg-white/[0.08] text-foreground border-white/[0.12]"
            >
              Abbrechen
            </Button>
            <Button
              onClick={saveSnippet}
              disabled={uploading}
              className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/25 border-0"
            >
              <Check className="h-3.5 w-3.5 mr-1.5" />
              Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lightbox */}
      <Dialog open={!!lightbox} onOpenChange={(o) => !o && setLightbox(null)}>
        <DialogContent className="max-w-3xl bg-black/95 border-white/[0.1] p-2 sm:p-4">
          {lightbox && signedUrls[lightbox] && (
            <div className="space-y-3">
              <div className="flex items-center justify-center max-h-[75vh]">
                {isVideoPath(lightbox) ? (
                  <video
                    src={signedUrls[lightbox]}
                    controls
                    autoPlay
                    className="max-h-[75vh] max-w-full rounded-lg"
                  />
                ) : (
                  <img
                    src={signedUrls[lightbox]}
                    alt=""
                    className="max-h-[75vh] max-w-full object-contain rounded-lg"
                  />
                )}
              </div>
              <div className="flex justify-end gap-2">
                <a
                  href={signedUrls[lightbox]}
                  download
                  className="flex items-center gap-1.5 text-xs text-foreground bg-white/10 hover:bg-white/15 border border-white/15 transition-colors px-3 py-2 rounded-lg font-medium"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download
                </a>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SnippetCard({
  snippet,
  signedUrls,
  onCopy,
  onEdit,
  onDelete,
  onMediaClick,
}: {
  snippet: Snippet;
  signedUrls: Record<string, string>;
  onCopy: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onMediaClick: (path: string) => void;
}) {
  const media = snippet.media_urls || [];

  return (
    <div className="group relative rounded-xl border border-white/[0.08] bg-gradient-to-br from-white/[0.04] via-white/[0.02] to-transparent hover:border-primary/30 hover:from-white/[0.06] transition-all duration-200 shadow-sm">
      {/* Media grid */}
      {media.length > 0 && (
        <div
          className={`grid gap-1.5 p-3 pb-0 ${
            media.length === 1 ? "grid-cols-1" : media.length === 2 ? "grid-cols-2" : "grid-cols-3"
          }`}
        >
          {media.map((path) => {
            const url = signedUrls[path];
            const isVideo = isVideoPath(path);
            return (
              <button
                key={path}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onMediaClick(path);
                }}
                className={`relative rounded-lg overflow-hidden border border-white/[0.08] bg-black/30 hover:border-primary/40 transition-colors ${
                  media.length === 1 ? "aspect-video" : "aspect-square"
                }`}
              >
                {url ? (
                  isVideo ? (
                    <video src={url} className="h-full w-full object-cover" muted />
                  ) : (
                    <img src={url} alt="" className="h-full w-full object-cover" />
                  )
                ) : (
                  <div className="h-full w-full flex items-center justify-center">
                    <Loader2 className="h-4 w-4 animate-spin text-foreground/40" />
                  </div>
                )}
                {isVideo && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="h-9 w-9 rounded-full bg-black/60 flex items-center justify-center backdrop-blur-sm">
                      <Play className="h-4 w-4 text-white fill-white" />
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      <button
        onClick={onCopy}
        className="w-full text-left p-4 pr-12"
        title="Klick = Text kopieren"
      >
        {snippet.title && (
          <div className="text-[10px] uppercase tracking-[0.15em] text-primary font-semibold mb-2">
            {snippet.title}
          </div>
        )}
        {snippet.body && (
          <p className="text-[13px] sm:text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed max-h-56 overflow-y-auto">
            {snippet.body}
          </p>
        )}
        {snippet.body && (
          <div className="flex items-center gap-1.5 mt-3 text-[10px] text-foreground/50 group-hover:text-primary transition-colors">
            <Copy className="h-3 w-3" />
            <span className="uppercase tracking-wider font-semibold">Klick zum Kopieren</span>
          </div>
        )}
      </button>

      <div className="absolute top-2.5 right-2.5 flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onEdit}
          className="p-1.5 rounded-md bg-black/60 backdrop-blur-sm border border-white/[0.1] text-foreground/80 hover:text-foreground hover:bg-black/80"
          title="Bearbeiten"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 rounded-md bg-black/60 backdrop-blur-sm border border-white/[0.1] text-foreground/80 hover:text-red-400 hover:bg-black/80"
          title="Löschen"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
