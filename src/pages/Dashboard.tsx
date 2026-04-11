import { useState, useEffect, useMemo, useRef } from "react";
import { usePlatform } from "@/contexts/PlatformContext";
import { motion, AnimatePresence } from "framer-motion";
import CategoryResultCards from "@/components/CategoryResultCards";
import ChatterSlideOver from "@/components/ChatterSlideOver";
import TrendWidget from "@/components/TrendWidget";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { supabase } from "@/integrations/supabase/client";
import { FileSpreadsheet, Upload, Search, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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

interface ReportRow {
  id: string;
  analysis_date: string;
  chatter_count: number;
  result_json: unknown;
}

function isAnalysisResult(value: unknown): value is AnalysisResult {
  return !!value && typeof value === "object" && Array.isArray((value as AnalysisResult).categories);
}

export default function Dashboard() {
  const { platform } = usePlatform();
  const navigate = useNavigate();
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedChatter, setSelectedChatter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setReports([]);
      setSelectedId(null);

      const { data } = await supabase
        .from("analysis_reports")
        .select("id, analysis_date, chatter_count, result_json")
        .eq("platform", platform)
        .order("analysis_date", { ascending: false });

      if (data && data.length > 0) {
        const rows = data as unknown as ReportRow[];
        setReports(rows);
        setSelectedId(rows[0].id);
      }
      setLoading(false);
    };
    load();
  }, [platform]);

  const selectedIndex = reports.findIndex((r) => r.id === selectedId);
  const selectedReport = selectedIndex >= 0 ? reports[selectedIndex] : null;
  const result = selectedReport && isAnalysisResult(selectedReport.result_json)
    ? (selectedReport.result_json as unknown as AnalysisResult)
    : null;

  const allChatters = useMemo(() => {
    if (!result) return [];
    return result.categories.flatMap((cat) =>
      cat.chatters.map((c) => ({ name: c.name, category: cat.categoryName, emoji: cat.emoji }))
    );
  }, [result]);

  const filteredChatters = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return allChatters.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 8);
  }, [searchQuery, allChatters]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleChatterSelect = (name: string) => {
    setSelectedChatter(name);
    setSearchQuery("");
    setSearchOpen(false);
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="flex-1 min-w-0">
        <AnimatePresence mode="wait">
          <motion.div
            key={platform}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="max-w-5xl mx-auto space-y-8 sm:space-y-12 p-2 sm:p-8 lg:p-12"
          >
            {/* Header + Date Selector */}
            <div className="space-y-3">
              <h1 className="text-2xl sm:text-3xl font-extralight tracking-tight text-foreground">{platform}</h1>
              
              {reports.length > 1 ? (
                <Select value={selectedId || ""} onValueChange={setSelectedId}>
                  <SelectTrigger className="w-full sm:w-64 bg-white/[0.02] border-white/[0.06] text-foreground/70 text-sm">
                    <SelectValue placeholder="Analyse wählen…" />
                  </SelectTrigger>
                  <SelectContent>
                    {reports.map((r, i) => (
                      <SelectItem key={r.id} value={r.id}>
                        {new Date(r.analysis_date).toLocaleDateString("de-DE")}
                        {i === 0 ? " (aktuell)" : ""}
                        {" · "}{r.chatter_count} Chatters
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-white/30 text-sm font-light tracking-wide">
                  {selectedReport
                    ? `Letzte Analyse: ${new Date(selectedReport.analysis_date).toLocaleDateString("de-DE")}`
                    : "Noch keine Analyse vorhanden."}
                </p>
              )}
            </div>

            {/* Trend Widget */}
            {reports.length > 0 && (
              <TrendWidget
                reports={reports.map((r) => ({
                  analysis_date: r.analysis_date,
                  chatter_count: r.chatter_count,
                  result_json: r.result_json,
                }))}
                selectedIndex={selectedIndex >= 0 ? selectedIndex : 0}
              />
            )}

            {loading ? (
              <div className="flex items-center justify-center py-20">
                <div className="h-6 w-6 border border-white/20 border-t-white/60 rounded-full animate-spin" />
              </div>
            ) : result ? (
              <ErrorBoundary>
                <CategoryResultCards data={{ categories: result.categories }} onChatterSelect={setSelectedChatter} />
              </ErrorBoundary>
            ) : (
              <div className="flex flex-col items-center justify-center py-20 space-y-6">
                <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/[0.06]">
                  <FileSpreadsheet className="h-8 w-8 text-white/15" />
                </div>
                <div className="text-center space-y-2">
                  <p className="text-foreground/50 font-light text-sm">Keine Analyse für {platform} vorhanden.</p>
                  <p className="text-white/20 text-xs font-light">Lade eine Datei im Upload-Bereich hoch.</p>
                </div>
                <Button
                  onClick={() => navigate("/upload")}
                  variant="ghost"
                  className="text-primary/70 hover:text-primary hover:bg-primary/5 transition-all duration-500"
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Zum Upload
                </Button>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
      <ChatterSlideOver open={!!selectedChatter} onClose={() => setSelectedChatter(null)} chatterName={selectedChatter || ""} platform={platform} />
    </div>
  );
}
