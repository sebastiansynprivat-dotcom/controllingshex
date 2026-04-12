import { useState, useEffect, useMemo, useRef } from "react";
import { usePlatform } from "@/contexts/PlatformContext";
import { motion, AnimatePresence } from "framer-motion";
import CategoryResultCards from "@/components/CategoryResultCards";
import ChatterSlideOver from "@/components/ChatterSlideOver";
import TrendWidget from "@/components/TrendWidget";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { supabase } from "@/integrations/supabase/client";
import { FileSpreadsheet, Upload, Search, X, ChevronDown } from "lucide-react";
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
        .not("result_json", "is", null)
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

  // ── Alert computation ──
  const alerts = useMemo(() => {
    if (!result) return [];
    const list: { color: string; icon: string; message: string; categoryName: string; priority: number }[] = [];

    for (const cat of result.categories) {
      const n = cat.chatters.length;
      if (n === 0) continue;
      const name = cat.categoryName.toUpperCase();

      // Red: WARNUNG
      if (/WARNUNG/.test(name)) {
        list.push({ color: "red", icon: "🟠", message: `${n} Chatter${n > 1 ? "s" : ""} mit Antwortverzug > 3 Tage`, categoryName: cat.categoryName, priority: 0 });
      }
      // Red: 0€ TAG 5+
      else if (/0\s*€.*TAG\s*[5-9]|0\s*€.*TAG\s*7\+/i.test(name)) {
        list.push({ color: "red", icon: "📉", message: `${n} Chatter${n > 1 ? "s" : ""} mit 0€ seit 5+ Tagen`, categoryName: cat.categoryName, priority: 1 });
      }
      // Orange: ACCOUNT-EINBRUCH
      else if (/EINBRUCH/.test(name)) {
        list.push({ color: "orange", icon: "⚠️", message: `${n} Account${n > 1 ? "s" : ""} mit Umsatzeinbruch`, categoryName: cat.categoryName, priority: 2 });
      }
      // Orange: COACHING / ENGERE KONTROLLE
      else if (/ENGERE|KONTROLLE/.test(name)) {
        list.push({ color: "orange", icon: "🟡", message: `${n} Chatter${n > 1 ? "s" : ""} brauchen engere Kontrolle`, categoryName: cat.categoryName, priority: 3 });
      }
      // Blue: ONBOARDING
      else if (/ONBOARDING/.test(name)) {
        list.push({ color: "blue", icon: "🔵", message: `${n} neue${n > 1 ? "" : "r"} Chatter im Onboarding`, categoryName: cat.categoryName, priority: 4 });
      }
      // Green: UPGRADE / BREAKOUT
      else if (/UPGRADE|BREAKOUT/.test(name)) {
        list.push({ color: "green", icon: "🟢", message: `${n} Chatter${n > 1 ? "s" : ""} im Upgrade-Streak`, categoryName: cat.categoryName, priority: 5 });
      }
    }

    // Deduplicate by color+priority bucket, merge counts
    const merged = new Map<string, typeof list[0]>();
    for (const a of list) {
      const key = `${a.priority}`;
      if (merged.has(key)) continue; // first match wins per priority
      merged.set(key, a);
    }

    return [...merged.values()].sort((a, b) => a.priority - b.priority);
  }, [result]);

  const [alertsExpanded, setAlertsExpanded] = useState(false);
  const visibleAlerts = alertsExpanded ? alerts : alerts.slice(0, 4);

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
    setSearchQuery("");
    setSearchOpen(false);
    // Scroll to the chatter card first, then open slide-over
    const el = document.querySelector(`[data-chatter-name="${name}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      // Brief highlight flash
      el.classList.add("ring-1", "ring-primary/40", "bg-white/[0.04]");
      setTimeout(() => el.classList.remove("ring-1", "ring-primary/40", "bg-white/[0.04]"), 1500);
    }
    setTimeout(() => setSelectedChatter(name), 400);
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

            {/* Chatter Search */}
            {result && (
              <div ref={searchRef} className="relative">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(true); }}
                    onFocus={() => setSearchOpen(true)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") { setSearchQuery(""); setSearchOpen(false); }
                    }}
                    placeholder="Chatter suchen…"
                    className="w-full sm:w-80 h-10 pl-9 pr-9 rounded-lg bg-white/[0.03] border border-white/[0.06] text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => { setSearchQuery(""); setSearchOpen(false); }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {searchOpen && filteredChatters.length > 0 && (
                  <div className="absolute z-50 mt-1 w-full sm:w-80 rounded-lg border border-white/[0.08] bg-popover shadow-lg overflow-hidden">
                    {filteredChatters.map((c) => (
                      <button
                        key={`${c.emoji}-${c.name}`}
                        onClick={() => handleChatterSelect(c.name)}
                        className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-foreground/80 hover:bg-white/[0.06] transition-colors text-left"
                      >
                        <span>{c.emoji}</span>
                        <span className="font-medium truncate">{c.name}</span>
                        <span className="ml-auto text-xs text-muted-foreground truncate">{c.category}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Alerts */}
            {alerts.length > 0 && (
              <div className="space-y-2">
                {visibleAlerts.map((alert, i) => {
                  const colorMap: Record<string, string> = {
                    red: "border-l-red-500 bg-red-500/5",
                    orange: "border-l-orange-400 bg-orange-400/5",
                    blue: "border-l-blue-400 bg-blue-400/5",
                    green: "border-l-emerald-400 bg-emerald-400/5",
                  };
                  return (
                    <button
                      key={i}
                      onClick={() => {
                        const el = document.querySelector(`[data-category-name="${alert.categoryName}"]`);
                        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
                      }}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg border-l-4 text-sm text-foreground/80 font-light transition-all hover:brightness-125 cursor-pointer ${colorMap[alert.color] || ""}`}
                    >
                      <span>{alert.icon}</span>
                      <span>{alert.message}</span>
                    </button>
                  );
                })}
                {alerts.length > 4 && (
                  <button
                    onClick={() => setAlertsExpanded((v) => !v)}
                    className="flex items-center gap-1 text-[11px] text-white/30 hover:text-white/50 transition-colors font-light mx-auto"
                  >
                    {alertsExpanded ? "Weniger anzeigen" : `${alerts.length - 4} weitere anzeigen`}
                    <ChevronDown className={`h-3 w-3 transition-transform ${alertsExpanded ? "rotate-180" : ""}`} />
                  </button>
                )}
              </div>
            )}

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
