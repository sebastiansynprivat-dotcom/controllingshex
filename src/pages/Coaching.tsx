import { useEffect, useMemo, useState } from "react";
import { GraduationCap, Loader2, Sparkles, FileText, Download, Trash2, Plus, Save, X, Search } from "lucide-react";
import { toast } from "sonner";
import { format, subDays } from "date-fns";
import { usePlatform } from "@/contexts/PlatformContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import {
  CoachingMaterial,
  ChatterCandidate,
  CoachingAnalysisRow,
  listMaterials,
  saveMaterial,
  deleteMaterial,
  listChattersForPlatform,
  listAnalyses,
  runAnalysis,
  renderAnalysisPDF,
  saveAnalysis,
  downloadAnalysisPDF,
  deleteAnalysis,
} from "@/lib/coaching";

export default function CoachingPage() {
  const { platform } = usePlatform();
  const [materials, setMaterials] = useState<CoachingMaterial[]>([]);
  const [chatters, setChatters] = useState<ChatterCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<CoachingMaterial> | null>(null);
  const [selectedChatter, setSelectedChatter] = useState<ChatterCandidate | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [mats, chs] = await Promise.all([listMaterials(), listChattersForPlatform(platform)]);
      setMaterials(mats);
      setChatters(chs);
    } catch (e: any) {
      toast.error(e.message ?? "Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform]);

  const activeMaterialsCount = materials.filter((m) => m.is_active).length;
  const filtered = useMemo(
    () => chatters.filter((c) => c.chatter_name.toLowerCase().includes(search.toLowerCase())),
    [chatters, search],
  );

  const handleSaveMaterial = async () => {
    if (!editing?.title?.trim() || !editing?.content?.trim()) {
      toast.error("Titel und Inhalt sind Pflicht");
      return;
    }
    try {
      await saveMaterial({
        id: editing.id,
        title: editing.title,
        content: editing.content,
        is_active: editing.is_active ?? true,
      });
      toast.success("Material gespeichert");
      setEditing(null);
      const mats = await listMaterials();
      setMaterials(mats);
    } catch (e: any) {
      toast.error(e.message ?? "Speichern fehlgeschlagen");
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 border-b border-white/[0.04] bg-zinc-950/60 backdrop-blur-xl">
        <div className="max-w-5xl mx-auto px-4 sm:px-8 py-5 flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <GraduationCap className="h-5 w-5 text-primary/70" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-light tracking-tight text-foreground/90">Coaching</h1>
            <p className="text-xs text-white/40 font-light truncate">
              KI-gestützte Chat-Analyse gegen dein Coaching-Material · {activeMaterialsCount} aktiv
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setMaterialsOpen(true)} className="rounded-xl">
            <FileText className="h-4 w-4 mr-2" />
            Material
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-4 sm:px-8 py-6 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
            <Input
              placeholder="Chatter suchen..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-white/[0.03] border-white/[0.06]"
            />
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20 text-white/30">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-sm text-white/30 font-light">
              Keine Chatter im letzten Report für {platform}.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {filtered.map((c) => (
                <button
                  key={c.chatter_name}
                  onClick={() => setSelectedChatter(c)}
                  className="text-left rounded-xl bg-white/[0.02] border border-white/[0.06] px-4 py-3.5 hover:bg-white/[0.04] hover:border-primary/20 transition-all"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-white/[0.04] flex items-center justify-center text-xs font-medium text-white/70">
                      {c.chatter_name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground/90 truncate">{c.chatter_name}</div>
                      <div className="text-[11px] text-white/40 font-light truncate">
                        Model: {c.account || "—"}
                      </div>
                    </div>
                    <Sparkles className="h-4 w-4 text-primary/50 shrink-0" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Materials manager */}
      <Sheet open={materialsOpen} onOpenChange={setMaterialsOpen}>
        <SheetContent side="right" className="w-full sm:max-w-lg bg-zinc-950 border-white/[0.06] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-foreground/90 font-light">Coaching-Material</SheetTitle>
          </SheetHeader>
          <div className="mt-6 space-y-3">
            <Button
              variant="outline"
              onClick={() => setEditing({ title: "", content: "", is_active: true })}
              className="w-full rounded-xl"
            >
              <Plus className="h-4 w-4 mr-2" /> Neues Material
            </Button>
            {materials.length === 0 && (
              <p className="text-xs text-white/40 font-light text-center py-8">
                Noch kein Material. Lade Transkripte, Best-Practice-Docs oder Do's & Don'ts hoch.
              </p>
            )}
            {materials.map((m) => (
              <div
                key={m.id}
                className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5 space-y-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground/90 truncate">{m.title}</div>
                    <div className="text-[11px] text-white/40 font-light">
                      {m.content.length.toLocaleString("de-DE")} Zeichen · {m.is_active ? "aktiv" : "inaktiv"}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(m)}>Edit</Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        if (!confirm("Wirklich löschen?")) return;
                        await deleteMaterial(m.id);
                        setMaterials(await listMaterials());
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      {/* Material editor */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl bg-zinc-950 border-white/[0.08]">
          <DialogHeader>
            <DialogTitle className="font-light">{editing?.id ? "Material bearbeiten" : "Neues Material"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <Input
              placeholder="Titel (z.B. Verkaufs-Coaching August)"
              value={editing?.title ?? ""}
              onChange={(e) => setEditing((p) => ({ ...(p ?? {}), title: e.target.value }))}
              className="bg-white/[0.03] border-white/[0.06]"
            />
            <Textarea
              placeholder="Coaching-Transkript, Do's & Don'ts, Preis-Guidelines..."
              value={editing?.content ?? ""}
              onChange={(e) => setEditing((p) => ({ ...(p ?? {}), content: e.target.value }))}
              rows={16}
              className="bg-white/[0.03] border-white/[0.06] font-mono text-xs"
            />
            <div className="flex items-center gap-3">
              <Switch
                checked={editing?.is_active ?? true}
                onCheckedChange={(v) => setEditing((p) => ({ ...(p ?? {}), is_active: v }))}
              />
              <span className="text-sm text-white/70">Aktiv (wird bei Analysen verwendet)</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Abbrechen</Button>
            <Button onClick={handleSaveMaterial}>
              <Save className="h-4 w-4 mr-2" /> Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Chatter analysis sheet */}
      <ChatterAnalysisSheet
        chatter={selectedChatter}
        platform={platform}
        onClose={() => setSelectedChatter(null)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Chatter Sheet — history + run new analysis                         */
/* ------------------------------------------------------------------ */

function ChatterAnalysisSheet({
  chatter,
  platform,
  onClose,
}: {
  chatter: ChatterCandidate | null;
  platform: string;
  onClose: () => void;
}) {
  const [history, setHistory] = useState<CoachingAnalysisRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [dateFrom, setDateFrom] = useState(format(subDays(new Date(), 7), "yyyy-MM-dd"));
  const [dateTo, setDateTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const [analysisNotice, setAnalysisNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!chatter) return;
    setLoading(true);
    listAnalyses(chatter.chatter_name, platform)
      .then(setHistory)
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [chatter, platform]);

  const [stage, setStage] = useState<string>("");

  const handleRun = async () => {
    if (!chatter) return;
    setRunning(true);
    setStage("Starte…");
    setAnalysisNotice(null);
    try {
      const result = await runAnalysis({
        chatter_name: chatter.chatter_name,
        platform,
        model_username: chatter.account,
        date_from: dateFrom,
        date_to: dateTo,
        onStage: setStage,
      });
      if (result.chats_analyzed === 0) {
        setAnalysisNotice(result.executive_summary || "Keine analysierbaren Chats im Zeitraum gefunden.");
        toast.warning("Keine analysierbaren Chats im Zeitraum gefunden.");
        return;
      }
      setStage("PDF wird erstellt…");
      const pdf = renderAnalysisPDF({
        chatter_name: chatter.chatter_name,
        platform,
        model_username: chatter.account,
        date_from: dateFrom,
        date_to: dateTo,
        result,
      });
      const row = await saveAnalysis({
        chatter_name: chatter.chatter_name,
        platform,
        model_username: chatter.account,
        date_from: dateFrom,
        date_to: dateTo,
        result,
        pdf,
      });
      toast.success(`Analyse fertig — ${result.chats_analyzed} Chats`);
      setHistory((h) => [row, ...h]);
      // auto-download
      triggerDownload(pdf, buildFilename(chatter.chatter_name, dateFrom, dateTo));
    } catch (e: any) {
      const message = e.message ?? "Analyse fehlgeschlagen";
      setAnalysisNotice(message);
      toast.error(message);
    } finally {
      setRunning(false);
      setStage("");
    }
  };

  const handleDownload = async (row: CoachingAnalysisRow) => {
    try {
      const blob = await downloadAnalysisPDF(row.pdf_path);
      triggerDownload(blob, buildFilename(row.chatter_name, row.date_from, row.date_to));
    } catch (e: any) {
      toast.error(e.message ?? "Download fehlgeschlagen");
    }
  };

  const handleDelete = async (row: CoachingAnalysisRow) => {
    if (!confirm("Analyse wirklich löschen?")) return;
    try {
      await deleteAnalysis(row);
      setHistory((h) => h.filter((r) => r.id !== row.id));
    } catch (e: any) {
      toast.error(e.message ?? "Löschen fehlgeschlagen");
    }
  };

  return (
    <Sheet open={!!chatter} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-lg bg-zinc-950 border-white/[0.06] overflow-y-auto">
        {chatter && (
          <>
            <SheetHeader>
              <SheetTitle className="text-foreground/90 font-light">
                {chatter.chatter_name}
              </SheetTitle>
              <p className="text-xs text-white/40 font-light">
                Model: {chatter.account || "—"} · {platform}
              </p>
            </SheetHeader>

            <div className="mt-6 space-y-6">
              {/* Run new analysis */}
              <div className="rounded-xl border border-primary/20 bg-primary/[0.03] p-4 space-y-3">
                <h3 className="text-sm font-medium text-foreground/90">Neue Analyse</h3>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] text-white/40 font-light mb-1 block">Von</label>
                    <Input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      className="bg-white/[0.03] border-white/[0.06]"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-white/40 font-light mb-1 block">Bis</label>
                    <Input
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      className="bg-white/[0.03] border-white/[0.06]"
                    />
                  </div>
                </div>
                <Button onClick={handleRun} disabled={running} className="w-full">
                  {running ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {stage || "KI analysiert…"}</>
                  ) : (
                    <><Sparkles className="h-4 w-4 mr-2" /> Analyse starten</>
                  )}
                </Button>
                {analysisNotice && (
                  <div className="rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-xs leading-relaxed text-amber-100/80 whitespace-pre-wrap">
                    {analysisNotice}
                  </div>
                )}
              </div>

              {/* History */}
              <div>
                <h3 className="text-sm font-medium text-foreground/90 mb-3">Historie</h3>
                {loading ? (
                  <div className="flex justify-center py-8 text-white/30">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                ) : history.length === 0 ? (
                  <p className="text-xs text-white/40 font-light text-center py-6">
                    Noch keine Analysen für diesen Chatter.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {history.map((row) => (
                      <div
                        key={row.id}
                        className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 flex items-center gap-3"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-foreground/90 truncate">
                            {row.date_from} → {row.date_to}
                          </div>
                          <div className="text-[11px] text-white/40 font-light">
                            {row.chats_analyzed} Chats · Score {row.summary_json?.overall_score ?? "?"} · {format(new Date(row.created_at), "dd.MM.yy HH:mm")}
                          </div>
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => handleDownload(row)} title="PDF laden">
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => handleDelete(row)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function buildFilename(chatter: string, from: string, to: string) {
  const safe = chatter.replace(/[^a-zA-Z0-9-_]/g, "_");
  return `Coaching_${safe}_${from}_${to}.pdf`;
}
