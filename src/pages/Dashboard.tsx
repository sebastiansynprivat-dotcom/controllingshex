import { useState, useCallback } from "react";
import { Upload, Sparkles, Copy, Check, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export default function Dashboard() {
  const [file, setFile] = useState<File | null>(null);
  const [csvData, setCsvData] = useState<string>("");
  const [result, setResult] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
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
        body: { csvData },
      });
      if (error) throw error;
      setResult(data.result || "Keine Ergebnisse erhalten.");
    } catch (err: any) {
      toast.error("Analyse fehlgeschlagen: " + (err.message || "Unbekannter Fehler"));
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async () => {
    if (!result) return;
    // Convert markdown table to TSV for Google Sheets
    const lines = result.split("\n").filter((l) => l.trim().startsWith("|"));
    const tsv = lines
      .filter((l) => !l.match(/^\|[\s-|]+\|$/))
      .map((l) =>
        l
          .split("|")
          .filter((c) => c.trim() !== "")
          .map((c) => c.trim())
          .join("\t")
      )
      .join("\n");
    await navigator.clipboard.writeText(tsv || result);
    setCopied(true);
    toast.success("Tabelle kopiert!");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-fade-in">
      <div>
        <h1 className="font-display text-3xl font-bold gold-text">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Lade deine tägliche Datei hoch und starte die KI-Analyse.</p>
      </div>

      {/* Upload Zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`relative border-2 border-dashed rounded-xl p-12 text-center transition-all duration-300 cursor-pointer ${
          dragOver
            ? "border-primary gold-glow bg-primary/5"
            : file
            ? "border-primary/40 bg-surface-2"
            : "border-border bg-surface-2 hover:border-primary/40"
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
          <div className="flex items-center justify-center gap-3">
            <FileSpreadsheet className="h-8 w-8 text-primary" />
            <div className="text-left">
              <p className="font-medium text-foreground">{file.name}</p>
              <p className="text-sm text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</p>
            </div>
          </div>
        ) : (
          <>
            <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-foreground font-medium">Datei hierher ziehen oder klicken</p>
            <p className="text-sm text-muted-foreground mt-1">CSV, XLSX oder XLS</p>
          </>
        )}
      </div>

      {/* Analyze Button */}
      <Button
        onClick={analyze}
        disabled={!file || loading}
        className="w-full gold-gradient text-primary-foreground font-semibold text-lg py-6 rounded-xl transition-all duration-300 hover:gold-glow disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {loading ? (
          <span className="flex items-center gap-3">
            <span className="h-5 w-5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full" style={{ animation: "spin-slow 1s linear infinite" }} />
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
      {result && (
        <div className="animate-fade-in-delay space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl font-semibold text-foreground">Ergebnis</h2>
            <Button
              onClick={copyToClipboard}
              variant="outline"
              className="border-primary/30 text-primary hover:bg-primary/10 hover:gold-glow-sm"
            >
              {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
              {copied ? "Kopiert!" : "Für Google Sheets kopieren"}
            </Button>
          </div>
          <div className="bg-surface-2 border border-border rounded-xl p-6 overflow-x-auto">
            <div className="prose prose-invert max-w-none">
              <ResultTable markdown={result} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ResultTable({ markdown }: { markdown: string }) {
  const lines = markdown.split("\n");
  const tableLines = lines.filter((l) => l.trim().startsWith("|"));

  if (tableLines.length < 2) {
    return <pre className="whitespace-pre-wrap text-sm text-foreground">{markdown}</pre>;
  }

  const headers = tableLines[0]
    .split("|")
    .filter((c) => c.trim())
    .map((c) => c.trim());

  const rows = tableLines
    .slice(2)
    .map((l) =>
      l
        .split("|")
        .filter((c) => c.trim() !== "")
        .map((c) => c.trim())
    );

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border">
          {headers.map((h, i) => (
            <th key={i} className="text-left py-3 px-4 text-primary font-semibold">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className="border-b border-border/50 hover:bg-surface-3/50 transition-colors">
            {row.map((cell, j) => (
              <td key={j} className="py-3 px-4 text-foreground">
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
