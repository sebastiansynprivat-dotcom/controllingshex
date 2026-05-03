import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, Pencil, Copy, FileText, Check, X, Tag, Search, ChevronDown, ImagePlus, Loader2, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast as sonner } from "sonner";
import { cn } from "@/lib/utils";

interface Note {
  id: string;
  title: string | null;
  body: string;
  category: string | null;
  position: number;
  created_at: string;
  media_urls: string[];
}

const SHARED_PLATFORM = "__shared__";
const ALL = "__all__";
const UNCATEGORIZED = "Ohne Kategorie";
const BUCKET = "snippet-media";

export default function StandardTab() {
  const { user } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Note | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("");
  const [filter, setFilter] = useState<string>(ALL);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [draftMedia, setDraftMedia] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [lightbox, setLightbox] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchNotes = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("standard_notes")
      .select("id, title, body, category, position, created_at, media_urls")
      .order("position", { ascending: true })
      .order("created_at", { ascending: false });
    setNotes((data || []) as Note[]);
    setLoading(false);
  };

  useEffect(() => {
    if (user) fetchNotes();
  }, [user]);

  // Sign URLs whenever notes change
  useEffect(() => {
    const allPaths = Array.from(new Set(notes.flatMap((n) => n.media_urls || [])));
    const missing = allPaths.filter((p) => !signedUrls[p]);
    if (missing.length === 0) return;
    (async () => {
      const { data } = await supabase.storage.from(BUCKET).createSignedUrls(missing, 3600);
      if (!data) return;
      const next: Record<string, string> = {};
      data.forEach((d, i) => {
        if (d.signedUrl) next[missing[i]] = d.signedUrl;
      });
      setSignedUrls((prev) => ({ ...prev, ...next }));
    })();
  }, [notes]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    notes.forEach((n) => set.add(n.category?.trim() || UNCATEGORIZED));
    return Array.from(set).sort((a, b) => {
      if (a === UNCATEGORIZED) return 1;
      if (b === UNCATEGORIZED) return -1;
      return a.localeCompare(b);
    });
  }, [notes]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return notes.filter((n) => {
      if (filter !== ALL && (n.category?.trim() || UNCATEGORIZED) !== filter) return false;
      if (!q) return true;
      return (
        (n.title || "").toLowerCase().includes(q) ||
        n.body.toLowerCase().includes(q) ||
        (n.category || "").toLowerCase().includes(q)
      );
    });
  }, [notes, filter, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, Note[]>();
    filtered.forEach((n) => {
      const key = n.category?.trim() || UNCATEGORIZED;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(n);
    });
    return Array.from(map.entries()).sort((a, b) => {
      if (a[0] === UNCATEGORIZED) return 1;
      if (b[0] === UNCATEGORIZED) return -1;
      return a[0].localeCompare(b[0]);
    });
  }, [filtered]);

  const openNew = () => {
    setEditing(null);
    setTitle("");
    setBody("");
    setCategory(filter !== ALL && filter !== UNCATEGORIZED ? filter : "");
    setDraftMedia([]);
    setEditorOpen(true);
  };

  const openEdit = (n: Note) => {
    setEditing(n);
    setTitle(n.title ?? "");
    setBody(n.body);
    setCategory(n.category ?? "");
    setDraftMedia(n.media_urls ?? []);
    setEditorOpen(true);
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || !user) return;
    setUploading(true);
    const newPaths: string[] = [];
    for (const file of Array.from(files)) {
      if (file.size > 20 * 1024 * 1024) {
        sonner.error(`${file.name} zu groß (max. 20 MB)`);
        continue;
      }
      const safe = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
      const path = `${user.id}/standard/${crypto.randomUUID()}-${safe}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type });
      if (error) {
        sonner.error(error.message);
        continue;
      }
      newPaths.push(path);
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
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
    if (!editing || !editing.media_urls.includes(path)) {
      await supabase.storage.from(BUCKET).remove([path]);
    }
  };

  const save = async () => {
    if (!user) return;
    const t = title.trim() || null;
    const b = body.trim();
    const c = category.trim() || null;
    if (!b && !t && draftMedia.length === 0) {
      sonner.error("Bitte Text oder Bild hinzufügen");
      return;
    }
    if (editing) {
      const removed = editing.media_urls.filter((p) => !draftMedia.includes(p));
      if (removed.length) await supabase.storage.from(BUCKET).remove(removed);
      const { error } = await supabase
        .from("standard_notes")
        .update({ title: t, body: b, category: c, media_urls: draftMedia })
        .eq("id", editing.id);
      if (error) return sonner.error(error.message);
    } else {
      const maxPos = notes.reduce((m, n) => Math.max(m, n.position), -1);
      const { error } = await supabase.from("standard_notes").insert({
        user_id: user.id,
        platform: SHARED_PLATFORM,
        title: t,
        body: b,
        category: c,
        position: maxPos + 1,
        media_urls: draftMedia,
      });
      if (error) return sonner.error(error.message);
    }
    setEditorOpen(false);
    fetchNotes();
  };

  const remove = async (id: string) => {
    const note = notes.find((n) => n.id === id);
    if (note?.media_urls?.length) {
      await supabase.storage.from(BUCKET).remove(note.media_urls);
    }
    const { error } = await supabase.from("standard_notes").delete().eq("id", id);
    if (error) return sonner.error(error.message);
    fetchNotes();
  };

  const downloadImage = async (path: string) => {
    try {
      const { data, error } = await supabase.storage.from(BUCKET).download(path);
      if (error || !data) throw error || new Error("Download fehlgeschlagen");
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = path.split("/").pop() || "bild";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      sonner.error(e?.message || "Download fehlgeschlagen");
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      sonner.success("Text kopiert");
    } catch {
      sonner.error("Kopieren fehlgeschlagen");
    }
  };

  const knownCategories = useMemo(
    () => Array.from(new Set(notes.map((n) => n.category?.trim()).filter(Boolean) as string[])).sort(),
    [notes],
  );

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-br from-white/[0.04] via-white/[0.02] to-transparent p-4 sm:p-6">
        <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary/30 to-primary/5 border border-primary/25 flex items-center justify-center shrink-0">
              <FileText className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold text-foreground tracking-tight">Standard</h3>
              <p className="text-[11px] text-foreground/55 font-light">Freie Notizen — mit eigenen Kategorien.</p>
            </div>
          </div>
          <Button onClick={openNew} size="sm" className="h-9 bg-primary hover:bg-primary/90 text-primary-foreground text-xs">
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Neue Notiz
          </Button>
        </div>

        {notes.length > 0 && (
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-foreground/40 pointer-events-none" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Suchen…"
              className="h-9 pl-9 pr-9 bg-white/[0.05] border-white/[0.12] text-xs"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 rounded-md flex items-center justify-center text-foreground/50 hover:text-foreground hover:bg-white/[0.06]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}

        {notes.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap mb-4">
            <button
              onClick={() => setFilter(ALL)}
              className={cn(
                "h-7 px-2.5 rounded-full text-[11px] font-medium transition-colors border",
                filter === ALL
                  ? "bg-primary/15 border-primary/30 text-primary"
                  : "bg-white/[0.03] border-white/[0.08] text-foreground/60 hover:text-foreground hover:bg-white/[0.06]",
              )}
            >
              Alle ({notes.length})
            </button>
            {categories.map((c) => {
              const count = notes.filter((n) => (n.category?.trim() || UNCATEGORIZED) === c).length;
              return (
                <button
                  key={c}
                  onClick={() => setFilter(c)}
                  className={cn(
                    "h-7 px-2.5 rounded-full text-[11px] font-medium transition-colors border inline-flex items-center gap-1",
                    filter === c
                      ? "bg-primary/15 border-primary/30 text-primary"
                      : "bg-white/[0.03] border-white/[0.08] text-foreground/60 hover:text-foreground hover:bg-white/[0.06]",
                  )}
                >
                  <Tag className="h-3 w-3" />
                  {c} ({count})
                </button>
              );
            })}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="h-5 w-5 border border-white/20 border-t-white/60 rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/[0.1] py-12 text-center">
            <p className="text-sm text-foreground/50 font-light">Noch keine Notizen.</p>
          </div>
        ) : (
          <div className="space-y-5">
            {grouped.map(([cat, items]) => (
              <div key={cat} className="space-y-2">
                <div className="flex items-center gap-2 px-1">
                  <span className="text-[10px] uppercase tracking-wider text-foreground/45 font-medium">
                    {cat}
                  </span>
                  <span className="text-[10px] text-foreground/30">·</span>
                  <span className="text-[10px] text-foreground/45">{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.map((n) => {
                    const isOpen = !!expanded[n.id];
                    const hasMedia = (n.media_urls?.length || 0) > 0;
                    return (
                      <div key={n.id} className="group rounded-lg border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
                        <div className="flex items-start gap-1.5 px-2 py-1.5">
                          <button
                            onClick={() => setExpanded((p) => ({ ...p, [n.id]: !isOpen }))}
                            className="min-w-0 flex-1 text-left py-0.5"
                            title={isOpen ? "Einklappen" : "Ausklappen"}
                          >
                            {n.title && (
                              <span className="text-[12px] font-medium text-foreground/90 truncate block mb-0.5">{n.title}</span>
                            )}
                            <span
                              className={cn(
                                "text-[12px] text-foreground/65 block whitespace-pre-wrap leading-snug",
                                !isOpen && "line-clamp-3",
                              )}
                            >
                              {n.body}
                            </span>
                            {hasMedia && !isOpen && (
                              <span className="inline-flex items-center gap-1 mt-1 text-[10px] text-foreground/45">
                                <ImagePlus className="h-3 w-3" />
                                {n.media_urls.length} {n.media_urls.length === 1 ? "Bild" : "Bilder"}
                              </span>
                            )}
                          </button>
                          <div className="flex items-center gap-0.5 shrink-0 mt-0.5">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6 text-foreground/50 hover:text-foreground"
                              onClick={() => copy(n.body)}
                              title="Kopieren"
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6 text-foreground/40 hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={() => openEdit(n)}
                              title="Bearbeiten"
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6 text-foreground/40 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={() => remove(n.id)}
                              title="Löschen"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                            <button
                              onClick={() => setExpanded((p) => ({ ...p, [n.id]: !isOpen }))}
                              className="h-6 w-6 rounded flex items-center justify-center text-foreground/50 hover:text-foreground hover:bg-white/[0.06]"
                              title={isOpen ? "Einklappen" : "Ausklappen"}
                            >
                              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isOpen && "rotate-180")} />
                            </button>
                          </div>
                        </div>
                        {isOpen && hasMedia && (
                          <div className="px-2 pb-2 flex flex-wrap gap-1.5">
                            {n.media_urls.map((path) => {
                              const url = signedUrls[path];
                              if (!url) return (
                                <div key={path} className="h-16 w-16 rounded bg-white/[0.04] animate-pulse" />
                              );
                              return (
                                <div key={path} className="relative group/img h-16 w-16 rounded overflow-hidden border border-white/[0.08]">
                                  <img src={url} alt="" className="h-full w-full object-cover" />
                                  <button
                                    onClick={() => downloadImage(path)}
                                    title="Herunterladen"
                                    className="absolute inset-0 flex items-center justify-center bg-black/60 text-white opacity-0 group-hover/img:opacity-100 transition-opacity"
                                  >
                                    <Download className="h-4 w-4" />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
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
            <div className="space-y-1.5">
              <Input
                placeholder="Kategorie (optional)"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                list="standard-categories"
                className="bg-white/[0.05] border-white/[0.12]"
              />
              <datalist id="standard-categories">
                {knownCategories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              {knownCategories.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {knownCategories.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCategory(c)}
                      className="h-6 px-2 rounded-full text-[10px] bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-foreground/60 hover:text-foreground transition-colors"
                    >
                      {c}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Textarea
              placeholder="Text…"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              className="bg-white/[0.05] border-white/[0.12]"
            />

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-foreground/55">Bilder ({draftMedia.length})</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="h-8 text-xs bg-white/[0.04] border-white/[0.12]"
                >
                  {uploading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5 mr-1.5" />}
                  Bilder hinzufügen
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => handleFiles(e.target.files)}
                />
              </div>
              {draftMedia.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {draftMedia.map((path) => {
                    const url = signedUrls[path];
                    return (
                      <div key={path} className="relative group/media h-20 w-20 rounded-lg overflow-hidden border border-white/[0.1]">
                        {url ? (
                          <img src={url} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="h-full w-full bg-white/[0.04] animate-pulse" />
                        )}
                        <button
                          type="button"
                          onClick={() => removeDraftMedia(path)}
                          className="absolute top-0.5 right-0.5 h-5 w-5 rounded-full bg-black/70 text-white flex items-center justify-center opacity-0 group-hover/media:opacity-100 transition-opacity"
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

      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 cursor-zoom-out"
        >
          <img src={lightbox} alt="" className="max-h-full max-w-full object-contain" />
        </div>
      )}
    </div>
  );
}
