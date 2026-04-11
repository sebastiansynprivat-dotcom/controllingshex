import { useState, useEffect } from "react";
import { usePlatform } from "@/contexts/PlatformContext";
import { motion, AnimatePresence } from "framer-motion";
import CategoryResultCards from "@/components/CategoryResultCards";
import ChatterSlideOver from "@/components/ChatterSlideOver";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { supabase } from "@/integrations/supabase/client";
import { FileSpreadsheet, Upload } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

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

export default function Dashboard() {
  const { platform } = usePlatform();
  const navigate = useNavigate();
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedChatter, setSelectedChatter] = useState<string | null>(null);
  const [reportDate, setReportDate] = useState<string | null>(null);

  useEffect(() => {
    const loadLatest = async () => {
      setLoading(true);
      setResult(null);
      const { data } = await supabase
        .from("analysis_reports")
        .select("result_json, analysis_date")
        .eq("platform", platform)
        .order("analysis_date", { ascending: false })
        .limit(1)
        .single();

      if (data?.result_json && isAnalysisResult(data.result_json)) {
        setResult(data.result_json as unknown as AnalysisResult);
        setReportDate(data.analysis_date);
      } else {
        setReportDate(null);
      }
      setLoading(false);
    };
    loadLatest();
  }, [platform]);

  return (
    <div className="flex h-full min-h-0">
      <div className="flex-1 min-w-0 overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={platform}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="max-w-5xl mx-auto space-y-8 sm:space-y-12 p-2 sm:p-8 lg:p-12"
          >
            <div className="space-y-3">
              <h1 className="text-2xl sm:text-3xl font-extralight tracking-tight text-foreground">{platform}</h1>
              <p className="text-white/30 text-sm font-light tracking-wide">
                {reportDate
                  ? `Letzte Analyse: ${new Date(reportDate).toLocaleDateString("de-DE")}`
                  : "Noch keine Analyse vorhanden."}
              </p>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-20">
                <div className="h-6 w-6 border border-white/20 border-t-white/60 rounded-full animate-spin" />
              </div>
            ) : result ? (
              <ErrorBoundary>
                <CategoryResultCards data={result} onChatterSelect={setSelectedChatter} />
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
