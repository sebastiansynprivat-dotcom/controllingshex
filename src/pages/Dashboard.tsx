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
  const [result, setResult] = useState<string>("");
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
    setResult("");
    try {
      const { data, error } = await supabase.functions.invoke("analyze-csv", {
        body: { csvData, platform },
      });
      if (error) throw error;
      setResult(data.result || "Keine Ergebnisse erhalten.");
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
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -12 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="max-w-6xl mx-auto space-y-10"
      >
        {/* Header */}
        <div className="space-y-2">
          <h1 className="font-display text-4xl font-bold gold-text tracking-tight">
            {platform}
          </h1>
          <p className="text-muted-foreground text-lg">
            Lade die tägliche Datei für <span className="text-foreground font-medium">{platform}</span> hoch und starte die KI-Analyse.
          </p>
        </div>

        {/* Upload Zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`relative rounded-2xl p-16 text-center transition-all duration-500 cursor-pointer ${
            dragOver
              ? "glass-card-gold gold-glow"
              : file
              ? "glass-card border-primary/20"
              : "glass-card hover:border-primary/15"
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
            <div className="flex items-center justify-center gap-4">
              <div className="p-3 rounded-xl bg-primary/10">
                <FileSpreadsheet className="h-8 w-8 text-primary" />
              </div>
              <div className="text-left">
                <p className="font-semibold text-foreground text-lg">{file.name}</p>
                <p className="text-sm text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="mx-auto w-16 h-16 rounded-2xl glass-card flex items-center justify-center">
                <Upload className="h-7 w-7 text-muted-foreground" />
              </div>
              <p className="text-foreground font-semibold text-lg">
                Datei hierher ziehen oder klicken
              </p>
              <p className="text-sm text-muted-foreground">CSV, XLSX oder XLS</p>
            </div>
          )}
        </div>

        {/* Analyze Button */}
        <Button
          onClick={analyze}
          disabled={!file || loading}
          className="w-full gold-gradient text-primary-foreground font-bold text-lg py-7 rounded-2xl transition-all duration-500 hover:gold-glow disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {loading ? (
            <span className="flex items-center gap-3">
              <span
                className="h-5 w-5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full"
                style={{ animation: "spin-slow 1s linear infinite" }}
              />
              KI analysiert Daten...
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              Analysieren
            </span>
          )}
        </Button>

        {/* Result */}
        {result && <CategoryResultCards markdown={result} />}
      </motion.div>
    </AnimatePresence>
  );
}
