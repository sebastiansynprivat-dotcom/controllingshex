import { useState, useCallback } from "react";
import { Upload, Sparkles, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { usePlatform } from "@/contexts/PlatformContext";
import { motion, AnimatePresence } from "framer-motion";
import CategoryResultCards from "@/components/CategoryResultCards";

export default function Dashboard() {
  const { platform } = usePlatform();
  const [file, setFile] = useState<File | null>(null);
  const [csvData, setCsvData] = useState<string>("");
  const [result, setResult] = useState<any>(null);
  const [resultRaw, setResultRaw] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

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
    setResultRaw("");
    try {
      const { data, error } = await supabase.functions.invoke("analyze-csv", {
        body: { csvData, platform },
      });
      if (error) throw error;
      if (data.result) {
        setResult(data.result);
      } else {
        setResultRaw(data.raw || "Keine Ergebnisse erhalten.");
      }
    } catch (err: any) {
      toast.error("Analyse fehlgeschlagen: " + (err.message || "Unbekannter Fehler"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={platform}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="max-w-5xl mx-auto space-y-12"
      >
        {/* Header */}
        <div className="space-y-3">
          <h1 className="text-3xl font-extralight tracking-tight text-foreground">
            {platform}
          </h1>
          <p className="text-white/30 text-sm font-light tracking-wide">
            Tägliche Analyse für {platform} — Datei hochladen und KI starten.
          </p>
        </div>

        {/* Upload Zone */}
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

        {/* Analyze Button */}
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

        {/* Result */}
        {result && <CategoryResultCards markdown={result} />}
      </motion.div>
    </AnimatePresence>
  );
}
