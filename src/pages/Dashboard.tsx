import { useState, useCallback, useEffect } from "react";
import { Upload, Sparkles, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { usePlatform } from "@/contexts/PlatformContext";
import { motion, AnimatePresence } from "framer-motion";
import CategoryResultCards from "@/components/CategoryResultCards";
import ChatterSlideOver from "@/components/ChatterSlideOver";
import { ErrorBoundary } from "@/components/ErrorBoundary";

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

function extractJsonCandidate(value: string) {
  const cleaned = value
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  const jsonStart = cleaned.indexOf("{");
  if (jsonStart === -1) {
    throw new Error("Kein JSON im Response gefunden.");
  }

  const jsonEnd = cleaned.lastIndexOf("}");
  const sliced = jsonEnd > jsonStart ? cleaned.slice(jsonStart, jsonEnd + 1) : cleaned.slice(jsonStart);

  return sliced
    .replace(/,\s*}/g, "}")
    .replace(/,\s*]/g, "]")
    .replace(/[\x00-\x1F\x7F]/g, "");
}

function repairJsonString(value: string) {
  let braces = 0;
  let brackets = 0;
  let inString = false;
  let escaped = false;

  for (const char of value) {
    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;
    if (char === "{") braces += 1;
    if (char === "}") braces -= 1;
    if (char === "[") brackets += 1;
    if (char === "]") brackets -= 1;
  }

  let repaired = value;
  while (brackets > 0) {
    repaired += "]";
    brackets -= 1;
  }
  while (braces > 0) {
    repaired += "}";
    braces -= 1;
  }

  return repaired;
}

function parseAnalysisPayload(payload: unknown): AnalysisResult {
  if (isAnalysisResult(payload)) {
    return payload;
  }

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;

    if (isAnalysisResult(record.result)) {
      return record.result;
    }

    const candidates = [record.result, record.raw];
    for (const candidate of candidates) {
      if (typeof candidate !== "string" || !candidate.trim()) continue;
      const extracted = extractJsonCandidate(candidate);

      try {
        const parsed = JSON.parse(extracted);
        if (isAnalysisResult(parsed)) return parsed;
      } catch {
        const repaired = repairJsonString(extracted);
        const parsed = JSON.parse(repaired);
        if (isAnalysisResult(parsed)) return parsed;
      }
    }
  }

  if (typeof payload === "string" && payload.trim()) {
    const extracted = extractJsonCandidate(payload);

    try {
      const parsed = JSON.parse(extracted);
      if (isAnalysisResult(parsed)) return parsed;
    } catch {
      const repaired = repairJsonString(extracted);
      const parsed = JSON.parse(repaired);
      if (isAnalysisResult(parsed)) return parsed;
    }
  }

  throw new Error("Die Analyse konnte nicht strukturiert geladen werden.");
}

const BATCH_SIZE = 50;
const MAX_RETRIES = 3;

function sanitizeCsvLine(line: string): string {
  return line.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

function splitCsvIntoBatches(csvData: string): string[] {
  const lines = csvData.split("\n");
  const header = sanitizeCsvLine(lines[0]);
  const dataLines = lines.slice(1)
    .map((l) => sanitizeCsvLine(l))
    .filter((l) => l.trim());

  if (dataLines.length <= BATCH_SIZE) return [[header, ...dataLines].join("\n")];

  const batches: string[] = [];
  for (let i = 0; i < dataLines.length; i += BATCH_SIZE) {
    const chunk = dataLines.slice(i, i + BATCH_SIZE);
    batches.push([header, ...chunk].join("\n"));
  }
  return batches;
}

function mergeResults(results: AnalysisResult[]): AnalysisResult {
  const categoryMap = new Map<string, AnalysisCategory>();

  for (const r of results) {
    for (const cat of r.categories) {
      const key = cat.categoryName;
      if (categoryMap.has(key)) {
        categoryMap.get(key)!.chatters.push(...cat.chatters);
      } else {
        categoryMap.set(key, { ...cat, chatters: [...cat.chatters] });
      }
    }
  }

  return { categories: Array.from(categoryMap.values()) };
}

async function invokeBatchWithRetry(
  batch: string,
  platform: string,
  batchIndex: number,
  totalBatches: number
): Promise<AnalysisResult> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[Batch ${batchIndex + 1}/${totalBatches}] Attempt ${attempt}/${MAX_RETRIES} — ${batch.split("\n").length - 1} rows`);

      const { data, error } = await supabase.functions.invoke("analyze-csv", {
        body: { csvData: batch, platform },
      });

      if (error) {
        throw new Error(typeof error === "string" ? error : error.message || "Edge Function error");
      }

      const parsed = parseAnalysisPayload(data);
      console.log(`[Batch ${batchIndex + 1}/${totalBatches}] ✓ Success — ${parsed.categories.reduce((sum, c) => sum + c.chatters.length, 0)} chatters parsed`);
      return parsed;
    } catch (err: any) {
      lastError = err;
      console.warn(`[Batch ${batchIndex + 1}/${totalBatches}] ✗ Attempt ${attempt} failed:`, err.message);

      if (attempt < MAX_RETRIES) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`[Batch ${batchIndex + 1}] Retrying in ${delay / 1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(`Batch ${batchIndex + 1} nach ${MAX_RETRIES} Versuchen fehlgeschlagen: ${lastError?.message}`);
}

const STORAGE_KEY = "dashboard_last_result";

export default function Dashboard() {
  const { platform } = usePlatform();
  const [file, setFile] = useState<File | null>(null);
  const [csvData, setCsvData] = useState<string>("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [selectedChatter, setSelectedChatter] = useState<string | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0, batchNum: 0, totalBatches: 0 });
  const [animationsReady, setAnimationsReady] = useState(true);

  // Restore cached result on mount
  useEffect(() => {
    try {
      const cached = localStorage.getItem(STORAGE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.platform === platform && isAnalysisResult(parsed.data)) {
          setResult(parsed.data);
          console.log("[Cache] Restored previous result from localStorage");
        }
      }
    } catch { /* ignore corrupt cache */ }
  }, [platform]);

  const handleFile = (f: File) => {
    setFile(f);
    const reader = new FileReader();
    reader.onload = (e) => setCsvData(e.target?.result as string);
    reader.readAsText(f);
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

  const analyze = async () => {
    if (!csvData) {
      toast.error("Bitte lade zuerst eine Datei hoch.");
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const batches = splitCsvIntoBatches(csvData);
      const totalLines = csvData.split("\n").slice(1).filter((l) => l.trim()).length;
      console.log(`[Analyse] Start: ${totalLines} Chatter in ${batches.length} Batches à ${BATCH_SIZE}`);

      setProgress({ current: 0, total: totalLines, batchNum: 0, totalBatches: batches.length });

      const batchResults: AnalysisResult[] = [];

      for (let i = 0; i < batches.length; i++) {
        setProgress({
          current: i * BATCH_SIZE,
          total: totalLines,
          batchNum: i + 1,
          totalBatches: batches.length,
        });

        const parsed = await invokeBatchWithRetry(batches[i], platform, i, batches.length);
        batchResults.push(parsed);

        const processed = Math.min((i + 1) * BATCH_SIZE, totalLines);
        setProgress({
          current: processed,
          total: totalLines,
          batchNum: i + 1,
          totalBatches: batches.length,
        });
      }

      const merged = batches.length === 1 ? batchResults[0] : mergeResults(batchResults);

      // Validate merged structure
      if (!merged || !Array.isArray(merged.categories)) {
        throw new Error("Merged result hat keine gültige categories-Struktur.");
      }

      const totalChatters = merged.categories.reduce((sum, c) => sum + c.chatters.length, 0);
      console.log(`[Analyse] ✓ Fertig: ${totalChatters} Chatter in ${merged.categories.length} Kategorien`);

      // Persist to localStorage before rendering
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ platform, data: merged, ts: Date.now() }));
        console.log("[Cache] Result saved to localStorage");
      } catch { /* storage full — non-critical */ }

      // Dampen animations for 2s to let browser breathe
      setAnimationsReady(false);
      setResult(merged);
      toast.success(`Analyse abgeschlossen: ${totalChatters} Chatter verarbeitet.`);
      setTimeout(() => setAnimationsReady(true), 2000);
    } catch (err: any) {
      console.error("[Analyse] ✗ Fehler:", err);
      toast.error(err.message || "Analyse fehlgeschlagen.");
    } finally {
      setLoading(false);
      setProgress({ current: 0, total: 0, batchNum: 0, totalBatches: 0 });
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

            <Button
              onClick={analyze}
              disabled={!file || loading}
              className="w-full bg-white/[0.04] hover:bg-white/[0.06] text-foreground/80 font-light text-sm py-7 rounded-xl border border-white/[0.06] hover:border-primary/15 transition-all duration-700 disabled:opacity-20 disabled:cursor-not-allowed tracking-wide"
            >
              {loading ? (
                <span className="flex items-center gap-3">
                  <span
                    className="h-4 w-4 border border-white/20 border-t-white/60 rounded-full"
                    style={{ animation: "spin-slow 1s linear infinite" }}
                  />
                  <span className="text-white/50">Analysiert...</span>
                </span>
              ) : (
                <span className="flex items-center gap-2.5">
                  <Sparkles className="h-4 w-4 text-primary/60" />
                  Analyse starten
                </span>
              )}
            </Button>

            {loading && progress.total > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-4 rounded-2xl bg-white/[0.02] border border-white/[0.06] p-8"
              >
                <div className="flex items-center justify-between text-xs font-light tracking-wider">
                  <span className="text-primary/70 uppercase">
                    Batch {progress.batchNum} von {progress.totalBatches}
                  </span>
                  <span className="text-white/40">
                    {Math.round((progress.current / progress.total) * 100)}%
                  </span>
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
                <p className="text-center text-xs text-white/30 font-light tracking-wide">
                  Analysiere Chatter {progress.current} von {progress.total}…
                </p>
              </motion.div>
            )}

            {result && (
              <CategoryResultCards
                data={result}
                onChatterSelect={setSelectedChatter}
              />
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
