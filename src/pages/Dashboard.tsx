import { useState, useCallback, useEffect, useRef } from "react";
import { Upload, Sparkles, FileSpreadsheet, XCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { usePlatform } from "@/contexts/PlatformContext";
import { motion, AnimatePresence } from "framer-motion";
import * as XLSX from "xlsx";
import CategoryResultCards from "@/components/CategoryResultCards";
import ChatterSlideOver from "@/components/ChatterSlideOver";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";

interface AnalysisChatter {
  name: string;
  startDate?: string;
  account?: string;
  kpis: Record<string, string>;
  recommendation?: string;
}

interface AnalysisCategory {
  emoji: string;
  categoryName: string;
  chatters: AnalysisChatter[];
}

interface AnalysisResult {
  categories: AnalysisCategory[];
}

function isAnalysisResult(value: unknown): value is AnalysisResult {
  return !!value && typeof value === "object" && Array.isArray((value as AnalysisResult).categories);
}

const STORAGE_KEY = "dashboard_last_result";
const CANCEL_TIMEOUT_MS = 120_000;

export default function Dashboard() {
  const { platform } = usePlatform();
  const [file, setFile] = useState<File | null>(null);
  const [csvData, setCsvData] = useState<string>("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [selectedChatter, setSelectedChatter] = useState<string | null>(null);
  const [statusLog, setStatusLog] = useState<string[]>([]);
  const [showCancel, setShowCancel] = useState(false);
  const [animationsReady, setAnimationsReady] = useState(true);
  const [progress, setProgress] = useState({ current: 0, total: 3, step: "" });

  const cancelledRef = useRef(false);
  const cancelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const addStatus = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setStatusLog((prev) => [...prev.slice(-29), `[${ts}] ${msg}`]);
  }, []);

  const deleteAnalysis = async () => {
    setDeleting(true);
    try {
      const today = new Date().toISOString().split("T")[0];
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-analysis`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ analysis_date: today, platform }),
        }
      );
      const data = await response.json();
      if (!response.ok || data.error) {
        throw new Error(data.error || "Fehler beim Löschen");
      }
      toast.success(`${data.deletedCount} Einträge für heute gelöscht.`);
      localStorage.removeItem(STORAGE_KEY);
      setResult(null);
      setFile(null);
      setCsvData("");
      setStatusLog([]);
    } catch (err: any) {
      toast.error(err.message || "Fehler beim Löschen");
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
    }
  };

  useEffect(() => {
    try {
      const cached = localStorage.getItem(STORAGE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.platform === platform && isAnalysisResult(parsed.data)) {
          setResult(parsed.data);
          return;
        }
      }
    } catch {}
    setResult(null);
    setFile(null);
    setCsvData("");
    setStatusLog([]);
  }, [platform]);

  const handleFile = (f: File) => {
    setFile(f);
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = e.target?.result;
      if (!data) return;
      try {
        if (/\.(xlsx|xls)$/i.test(f.name)) {
          const wb = XLSX.read(data, { type: "array" });
          const csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
          setCsvData(csv);
        } else {
          setCsvData(new TextDecoder().decode(data as ArrayBuffer));
        }
      } catch (err: any) {
        toast.error("Datei konnte nicht gelesen werden: " + (err.message || "Fehler"));
      }
    };
    reader.readAsArrayBuffer(f);
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, []);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  };

  const cancelAnalysis = () => {
    cancelledRef.current = true;
    addStatus("⛔ Analyse abgebrochen.");
    toast.info("Analyse abgebrochen.");
    setLoading(false);
    setShowCancel(false);
    if (cancelTimerRef.current) clearTimeout(cancelTimerRef.current);
  };

  const analyze = async () => {
    if (!csvData) {
      toast.error("Bitte lade zuerst eine Datei hoch.");
      return;
    }

    setLoading(true);
    setResult(null);
    setStatusLog([]);
    setShowCancel(false);
    cancelledRef.current = false;
    cancelTimerRef.current = setTimeout(() => setShowCancel(true), CANCEL_TIMEOUT_MS);

    try {
      addStatus("[Step 1/3] CSV wird vorbereitet…");
      setProgress({ current: 1, total: 3, step: "Daten vorbereiten" });

      const lines = csvData.split("\n").filter((l) => l.trim());
      if (lines.length < 2) throw new Error("Keine Daten in der Datei gefunden.");
      const chatterCount = lines.length - 1;
      const batchCount = Math.ceil(chatterCount / 50);
      addStatus(`✅ ${chatterCount} Chatter erkannt → ${batchCount} Batch${batchCount > 1 ? "es" : ""}`);

      if (cancelledRef.current) return;

      addStatus(`[Step 2/3] KI-Analyse läuft (${batchCount} Batch${batchCount > 1 ? "es" : ""})…`);
      setProgress({ current: 2, total: 3, step: `KI analysiert (${batchCount} Batches)` });
      addStatus("🧠 Sende Daten an Lovable AI…");

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-csv`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ csvData, platform }),
          signal: AbortSignal.timeout(300000),
        }
      );

      const data = await response.json();

      if (cancelledRef.current) return;

      if (!response.ok || data?.error) {
        const errMsg = data?.error || `Fehler (${response.status})`;
        throw new Error(errMsg);
      }

      const analysisResult = data?.result as AnalysisResult | undefined;
      if (!analysisResult || !Array.isArray(analysisResult.categories)) {
        throw new Error("Ungültiges Ergebnis von der KI. Bitte erneut versuchen.");
      }

      addStatus("[Step 3/3] Ergebnisse werden aufbereitet…");
      setProgress({ current: 3, total: 3, step: "Fertig" });

      const total = analysisResult.categories.reduce((s, c) => s + c.chatters.length, 0);
      const bi = data?.batchInfo;
      if (bi) {
        addStatus(`📊 ${bi.succeeded}/${bi.total} Batches erfolgreich (${bi.inputRows} Input → ${bi.totalChatters} Output)`);
      }
      addStatus(`🎉 Fertig: ${total} Chatter in ${analysisResult.categories.length} Kategorien`);
      if (bi && bi.totalChatters === bi.inputRows) {
        addStatus(`✅ 100% Coverage – alle ${bi.inputRows} Chatter erfasst!`);
      }

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ platform, data: analysisResult, ts: Date.now() }));
      } catch {}

      setAnimationsReady(false);
      setResult(analysisResult);
      toast.success(`Analyse abgeschlossen: ${total} Chatter.`);
      setTimeout(() => setAnimationsReady(true), 2000);
    } catch (err: any) {
      console.error("[Analyse] Fehler:", err);
      const msg = err.message || "Unbekannter Fehler";
      addStatus(`💥 ${msg}`);
      toast.error(msg);
    } finally {
      setLoading(false);
      setShowCancel(false);
      setProgress({ current: 0, total: 3, step: "" });
      if (cancelTimerRef.current) clearTimeout(cancelTimerRef.current);
    }
  };

  return (
    <div className="flex h-full min-h-0">
      <div className={`flex-1 min-w-0 overflow-y-auto transition-all duration-500 ${selectedChatter ? "mr-0" : ""}`}>
        <AnimatePresence mode="wait">
          <motion.div
            key={platform}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="max-w-5xl mx-auto space-y-12 p-8 lg:p-12"
          >
            <div className="space-y-3">
              <h1 className="text-3xl font-extralight tracking-tight text-foreground">{platform}</h1>
              <p className="text-white/30 text-sm font-light tracking-wide">
                Tägliche Analyse für {platform} — Datei hochladen und KI starten.
              </p>
            </div>

            {/* Drop Zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={`relative rounded-2xl p-20 text-center transition-all duration-700 cursor-pointer ${
                dragOver ? "bg-white/[0.03] border border-primary/15 gold-glow-sm"
                  : file ? "bg-white/[0.02] border border-white/[0.06]"
                    : "bg-white/[0.015] border border-white/[0.04] hover:border-white/[0.08] hover:bg-white/[0.025]"
              }`}
              onClick={() => document.getElementById("file-input")?.click()}
            >
              <input id="file-input" type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={onFileChange} />
              {file ? (
                <div className="flex items-center justify-center gap-5">
                  <div className="p-3 rounded-xl bg-primary/8"><FileSpreadsheet className="h-6 w-6 text-primary/70" /></div>
                  <div className="text-left">
                    <p className="font-medium text-foreground/90 text-sm tracking-wide">{file.name}</p>
                    <p className="text-xs text-white/25 mt-0.5 font-light">{(file.size / 1024).toFixed(1)} KB</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="mx-auto w-12 h-12 rounded-xl bg-white/[0.03] border border-white/[0.05] flex items-center justify-center">
                    <Upload className="h-5 w-5 text-white/20" />
                  </div>
                  <div>
                    <p className="text-foreground/70 font-light text-sm tracking-wide">Datei hierher ziehen oder klicken</p>
                    <p className="text-[11px] text-white/20 mt-1 font-light tracking-wider uppercase">CSV · XLSX · XLS</p>
                  </div>
                </div>
              )}
            </div>

            {/* Buttons */}
            <div className="flex gap-3">
              <Button
                onClick={analyze}
                disabled={!file || loading}
                className="flex-1 bg-white/[0.04] hover:bg-white/[0.06] text-foreground/80 font-light text-sm py-7 rounded-xl border border-white/[0.06] hover:border-primary/15 transition-all duration-700 disabled:opacity-20 disabled:cursor-not-allowed tracking-wide"
              >
                {loading ? (
                  <span className="flex items-center gap-3">
                    <span className="h-4 w-4 border border-white/20 border-t-white/60 rounded-full" style={{ animation: "spin-slow 1s linear infinite" }} />
                    <span className="text-white/50">Analysiert…</span>
                  </span>
                ) : (
                  <span className="flex items-center gap-2.5">
                    <Sparkles className="h-4 w-4 text-primary/60" />
                    Analyse starten
                  </span>
                )}
              </Button>
              {showCancel && loading && (
                <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
                  <Button onClick={cancelAnalysis} variant="destructive" className="py-7 px-6 rounded-xl">
                    <XCircle className="h-4 w-4 mr-2" />Abbrechen
                  </Button>
                </motion.div>
              )}
              {result && !loading && (
                <Button
                  onClick={() => setDeleteDialogOpen(true)}
                  variant="ghost"
                  className="py-7 px-6 rounded-xl text-red-400/70 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-all duration-500"
                >
                  <Trash2 className="h-4 w-4 mr-2" />Analyse löschen
                </Button>
              )}
            </div>

            {/* Delete Confirmation Dialog */}
            <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
              <DialogContent className="bg-background border-white/10">
                <DialogHeader>
                  <DialogTitle className="text-foreground">Analyse löschen?</DialogTitle>
                  <DialogDescription className="text-white/50">
                    Möchtest du die heutige Analyse ({new Date().toLocaleDateString("de-DE")}) für <strong className="text-foreground/80">{platform}</strong> wirklich löschen? Ältere Analysen bleiben erhalten.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter className="gap-2">
                  <DialogClose asChild>
                    <Button variant="ghost" className="text-white/50">Abbrechen</Button>
                  </DialogClose>
                  <Button
                    onClick={deleteAnalysis}
                    disabled={deleting}
                    variant="destructive"
                    className="bg-red-600 hover:bg-red-700"
                  >
                    {deleting ? "Löscht…" : "Ja, löschen"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Status Log */}
            {(loading || statusLog.length > 0) && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 rounded-2xl bg-white/[0.02] border border-white/[0.06] p-6">
                {loading && progress.total > 0 && (
                  <>
                    <div className="flex items-center justify-between text-xs font-light tracking-wider">
                      <span className="text-primary/70 uppercase">KI-Pipeline — Step {progress.current} / {progress.total}</span>
                      <span className="text-white/40">{Math.round((progress.current / progress.total) * 100)}%</span>
                    </div>
                    <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/[0.04]">
                      <motion.div
                        className="absolute inset-y-0 left-0 rounded-full"
                        style={{ background: "linear-gradient(90deg, hsl(var(--primary)), hsl(var(--primary) / 0.6))" }}
                        initial={{ width: "0%" }}
                        animate={{ width: `${(progress.current / progress.total) * 100}%` }}
                        transition={{ duration: 0.6, ease: "easeOut" }}
                      />
                    </div>
                  </>
                )}
                <div className="max-h-48 overflow-y-auto space-y-1 font-mono text-[11px] leading-relaxed scrollbar-thin">
                  {statusLog.map((line, i) => (
                    <div key={i} className={`${i === statusLog.length - 1 ? "text-white/60" : "text-white/25"} transition-colors duration-300`}>
                      {line}
                    </div>
                  ))}
                  {loading && <div className="text-white/30 animate-pulse">▌</div>}
                </div>
              </motion.div>
            )}

            {/* Results */}
            {result && (
              <ErrorBoundary>
                <div className={animationsReady ? "" : "!transition-none !animate-none"}>
                  <CategoryResultCards data={result} onChatterSelect={setSelectedChatter} />
                </div>
              </ErrorBoundary>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
      <ChatterSlideOver open={!!selectedChatter} onClose={() => setSelectedChatter(null)} chatterName={selectedChatter || ""} platform={platform} />
    </div>
  );
}
