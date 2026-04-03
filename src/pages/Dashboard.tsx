import { useState, useCallback, useEffect, useRef } from "react";
import { Upload, Sparkles, FileSpreadsheet, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { usePlatform } from "@/contexts/PlatformContext";
import { motion, AnimatePresence } from "framer-motion";
import * as XLSX from "xlsx";
import CategoryResultCards from "@/components/CategoryResultCards";
import ChatterSlideOver from "@/components/ChatterSlideOver";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import {
  step1_cleanData,
  step2_categorize,
  buildStep3Payload,
  mergeRecommendations,
  type AnalysisResult,
  type ModelInfo,
  type CategorizedChatter,
  type PipelineStep,
} from "@/lib/analysis-pipeline";

function isAnalysisResult(value: unknown): value is AnalysisResult {
  return !!value && typeof value === "object" && Array.isArray((value as AnalysisResult).categories);
}

const BATCH_SIZE = 30;
const STORAGE_KEY = "dashboard_last_result";
const CANCEL_TIMEOUT_MS = 60_000;

export default function Dashboard() {
  const { platform } = usePlatform();
  const [file, setFile] = useState<File | null>(null);
  const [csvData, setCsvData] = useState<string>("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [selectedChatter, setSelectedChatter] = useState<string | null>(null);
  const [pipelineStep, setPipelineStep] = useState<PipelineStep | 0>(0);
  const [statusLog, setStatusLog] = useState<string[]>([]);
  const [showCancel, setShowCancel] = useState(false);
  const [animationsReady, setAnimationsReady] = useState(true);

  const cancelledRef = useRef(false);
  const cancelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addStatus = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setStatusLog((prev) => [...prev.slice(-29), `[${ts}] ${msg}`]);
  }, []);

  // Restore cached result on mount
  useEffect(() => {
    try {
      const cached = localStorage.getItem(STORAGE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.platform === platform && isAnalysisResult(parsed.data)) {
          setResult(parsed.data);
        }
      }
    } catch { /* ignore */ }
  }, [platform]);

  const handleFile = (f: File) => {
    setFile(f);
    const reader = new FileReader();

    reader.onload = (e) => {
      const data = e.target?.result;
      if (!data) return;

      try {
        const isExcel = /\.(xlsx|xls)$/i.test(f.name);

        if (isExcel) {
          const workbook = XLSX.read(data, { type: "array" });
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          const csv = XLSX.utils.sheet_to_csv(firstSheet);
          console.log(`[Upload] XLSX → CSV converted. First 100 chars: ${csv.substring(0, 100)}`);
          if (csv.startsWith("PK")) {
            toast.error("Datei konnte nicht in Text konvertiert werden.");
            return;
          }
          setCsvData(csv);
        } else {
          const text = new TextDecoder().decode(data as ArrayBuffer);
          console.log(`[Upload] CSV loaded. First 100 chars: ${text.substring(0, 100)}`);
          if (text.startsWith("PK")) {
            toast.error("Datei konnte nicht in Text konvertiert werden.");
            return;
          }
          setCsvData(text);
        }
      } catch (err: any) {
        console.error("[Upload] File parse error:", err);
        toast.error("Datei konnte nicht gelesen werden: " + (err.message || "Unbekannter Fehler"));
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
    addStatus("⛔ Analyse manuell abgebrochen.");
    toast.info("Analyse wurde abgebrochen.");
    setLoading(false);
    setShowCancel(false);
    setPipelineStep(0);
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
    setPipelineStep(0);
    cancelledRef.current = false;

    cancelTimerRef.current = setTimeout(() => setShowCancel(true), CANCEL_TIMEOUT_MS);

    try {
      /* ===== STEP 1: Data Cleaning ===== */
      setPipelineStep(1);
      addStatus("🧹 [Step 1/3] Daten werden bereinigt und validiert…");

      // Fetch models for follower matching
      addStatus("📋 Lade Model-Liste aus der Datenbank…");
      const { data: modelsData } = await supabase
        .from("models")
        .select("model_name, follower_count")
        .eq("platform", platform);

      const models: ModelInfo[] = (modelsData || []).map((m: any) => ({
        model_name: m.model_name,
        follower_count: m.follower_count,
      }));
      addStatus(`📋 ${models.length} Models geladen`);

      if (cancelledRef.current) return;

      const cleaned = step1_cleanData(csvData, models);
      addStatus(`✅ [Step 1/3] ${cleaned.length} Chatter bereinigt. Namen, Follower & OCR-Schutz angewendet.`);

      if (cancelledRef.current) return;

      /* ===== STEP 2: Rule-Based Categorization ===== */
      setPipelineStep(2);
      addStatus("🏷️ [Step 2/3] Kategorien werden berechnet (regelbasiert)…");

      const categorized = step2_categorize(cleaned);

      // Count categories
      const catCounts = new Map<string, number>();
      for (const ch of categorized) {
        catCounts.set(ch.category, (catCounts.get(ch.category) || 0) + 1);
      }
      const catSummary = Array.from(catCounts.entries())
        .map(([name, count]) => `${name}: ${count}`)
        .join(", ");
      addStatus(`✅ [Step 2/3] Kategorisiert: ${catSummary}`);

      // Show intermediate result (without AI recommendations)
      const intermediateResult = mergeRecommendations(categorized, {});
      setAnimationsReady(false);
      setResult(intermediateResult);
      setTimeout(() => setAnimationsReady(true), 500);

      if (cancelledRef.current) return;

      /* ===== STEP 3: AI Recommendations ===== */
      setPipelineStep(3);
      addStatus("🧠 [Step 3/3] KI erstellt Management-Strategien (Gemini 2.5 Pro)…");

      const step3Payload = buildStep3Payload(categorized);

      // Batch chatters for AI in groups of BATCH_SIZE
      const allChatters = categorized;
      const totalChatters = allChatters.length;
      const allRecommendations: Record<string, string> = {};

      if (totalChatters <= BATCH_SIZE) {
        // Single batch
        addStatus(`📤 Sende ${totalChatters} Chatter an KI…`);
        const recs = await invokeStep3(step3Payload, platform);
        Object.assign(allRecommendations, recs);
        addStatus(`✅ ${Object.keys(recs).length} Empfehlungen erhalten`);
      } else {
        // Multiple batches
        const numBatches = Math.ceil(totalChatters / BATCH_SIZE);
        addStatus(`📦 ${totalChatters} Chatter → ${numBatches} Batches`);

        for (let i = 0; i < numBatches; i++) {
          if (cancelledRef.current) break;

          const batchChatters = allChatters.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
          const batchPayload = buildStep3Payload(batchChatters);

          addStatus(`📤 Batch ${i + 1}/${numBatches}: ${batchChatters.length} Chatter an KI…`);

          const recs = await invokeStep3(batchPayload, platform);
          Object.assign(allRecommendations, recs);

          addStatus(`✅ Batch ${i + 1}: ${Object.keys(recs).length} Empfehlungen`);

          // Progressive update
          const progressResult = mergeRecommendations(categorized, allRecommendations);
          setAnimationsReady(false);
          setResult(progressResult);
          setTimeout(() => setAnimationsReady(true), 300);
        }
      }

      if (cancelledRef.current) return;

      // Final merge with all recommendations
      const finalResult = mergeRecommendations(categorized, allRecommendations);

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ platform, data: finalResult, ts: Date.now() }));
      } catch { /* storage full */ }

      setAnimationsReady(false);
      setResult(finalResult);
      toast.success(`Analyse abgeschlossen: ${totalChatters} Chatter verarbeitet.`);
      setTimeout(() => setAnimationsReady(true), 2000);

      addStatus(`🎉 Pipeline abgeschlossen: ${totalChatters} Chatter, ${Object.keys(allRecommendations).length} Empfehlungen`);
    } catch (err: any) {
      console.error("[Pipeline] ✗ Fehler:", err);
      const stepLabel = pipelineStep > 0 ? ` in Schritt ${pipelineStep}` : "";
      addStatus(`💥 Fehler${stepLabel}: ${(err.message || "").substring(0, 150)}`);
      toast.error(`Fehler${stepLabel}: ${err.message || "Analyse fehlgeschlagen."}`);
    } finally {
      setLoading(false);
      setShowCancel(false);
      setPipelineStep(0);
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
              <h1 className="text-3xl font-extralight tracking-tight text-foreground">
                {platform}
              </h1>
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
                dragOver
                  ? "bg-white/[0.03] border border-primary/15 gold-glow-sm"
                  : file
                    ? "bg-white/[0.02] border border-white/[0.06]"
                    : "bg-white/[0.015] border border-white/[0.04] hover:border-white/[0.08] hover:bg-white/[0.025]"
              }`}
              onClick={() => document.getElementById("file-input")?.click()}
            >
              <input
                id="file-input"
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={onFileChange}
              />
              {file ? (
                <div className="flex items-center justify-center gap-5">
                  <div className="p-3 rounded-xl bg-primary/8">
                    <FileSpreadsheet className="h-6 w-6 text-primary/70" />
                  </div>
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
                    <p className="text-foreground/70 font-light text-sm tracking-wide">
                      Datei hierher ziehen oder klicken
                    </p>
                    <p className="text-[11px] text-white/20 mt-1 font-light tracking-wider uppercase">CSV · XLSX · XLS</p>
                  </div>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <Button
                onClick={analyze}
                disabled={!file || loading}
                className="flex-1 bg-white/[0.04] hover:bg-white/[0.06] text-foreground/80 font-light text-sm py-7 rounded-xl border border-white/[0.06] hover:border-primary/15 transition-all duration-700 disabled:opacity-20 disabled:cursor-not-allowed tracking-wide"
              >
                {loading ? (
                  <span className="flex items-center gap-3">
                    <span
                      className="h-4 w-4 border border-white/20 border-t-white/60 rounded-full"
                      style={{ animation: "spin-slow 1s linear infinite" }}
                    />
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
                    <XCircle className="h-4 w-4 mr-2" />
                    Abbrechen
                  </Button>
                </motion.div>
              )}
            </div>

            {/* Pipeline Progress */}
            {(loading || statusLog.length > 0) && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-4 rounded-2xl bg-white/[0.02] border border-white/[0.06] p-6"
              >
                {/* Step indicator */}
                {loading && pipelineStep > 0 && (
                  <div className="flex items-center gap-2 mb-3">
                    {[1, 2, 3].map((step) => (
                      <div key={step} className="flex items-center gap-2">
                        <div
                          className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium transition-all duration-500 ${
                            step < pipelineStep
                              ? "bg-green-500/20 text-green-400 border border-green-500/30"
                              : step === pipelineStep
                                ? "bg-primary/20 text-primary border border-primary/30 animate-pulse"
                                : "bg-white/[0.03] text-white/20 border border-white/[0.06]"
                          }`}
                        >
                          {step < pipelineStep ? "✓" : step}
                        </div>
                        <span className={`text-[10px] tracking-wider uppercase ${
                          step === pipelineStep ? "text-primary/70" : step < pipelineStep ? "text-green-400/50" : "text-white/15"
                        }`}>
                          {step === 1 ? "Bereinigung" : step === 2 ? "Kategorien" : "KI-Strategie"}
                        </span>
                        {step < 3 && <div className={`w-6 h-px ${step < pipelineStep ? "bg-green-500/30" : "bg-white/[0.06]"}`} />}
                      </div>
                    ))}
                  </div>
                )}

                {/* Status log */}
                <div className="max-h-48 overflow-y-auto space-y-1 font-mono text-[11px] leading-relaxed scrollbar-thin">
                  {statusLog.map((line, i) => (
                    <div
                      key={i}
                      className={`${i === statusLog.length - 1 ? "text-white/60" : "text-white/25"} transition-colors duration-300`}
                    >
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

      <ChatterSlideOver
        open={!!selectedChatter}
        onClose={() => setSelectedChatter(null)}
        chatterName={selectedChatter || ""}
        platform={platform}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  HELPER: Invoke Step 3 edge function with retry                     */
/* ------------------------------------------------------------------ */

async function invokeStep3(
  payload: ReturnType<typeof buildStep3Payload>,
  platform: string,
  retries = 2
): Promise<Record<string, string>> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const { data, error } = await supabase.functions.invoke("analyze-csv", {
        body: { categorizedData: payload, platform },
      });

      if (error) {
        throw new Error(typeof error === "string" ? error : error.message || "Edge Function error");
      }

      if (data?.recommendations && typeof data.recommendations === "object") {
        return data.recommendations;
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      return {};
    } catch (err: any) {
      if (attempt === retries) throw err;
      console.warn(`[Step 3] Attempt ${attempt} failed, retrying:`, err.message);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  return {};
}
