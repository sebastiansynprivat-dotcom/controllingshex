import { useState, useEffect, useCallback, useMemo } from "react";
import { usePlatform } from "@/contexts/PlatformContext";
import { supabase } from "@/integrations/supabase/client";
import { AnimatePresence, motion } from "framer-motion";
import SwipeCard from "@/components/SwipeCard";
import SwipeActionPanel from "@/components/SwipeActionPanel";
import ChatterSlideOver from "@/components/ChatterSlideOver";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Check, X, ChevronUp, RotateCcw, Undo2, Tag, StickyNote, Send, Plus } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface ChatterData {
  name: string;
  kpis: Record<string, string>;
  recommendation?: string;
  categoryEmoji?: string;
  categoryName?: string;
  revenueHistory?: { date: string; revenue: number }[];
}

interface AnalysisCategory {
  emoji: string;
  categoryName: string;
  chatters: {
    name: string;
    startDate?: string;
    account?: string;
    kpis: Record<string, string>;
    recommendation?: string;
  }[];
}

interface AnalysisResult {
  categories: AnalysisCategory[];
}
// Normalize chatter name for comparison: "niklas_la" and "Niklas La" should match
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[_ ]+/g, "_").trim();
}

function toTitleCase(name: string): string {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function parseLooseDate(dateStr?: string): Date | null {
  if (!dateStr) return null;

  const dmy = dateStr.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (dmy) {
    let [, d, m, y] = dmy;
    let yearNum = parseInt(y, 10);
    if (yearNum < 100) yearNum += 2000;
    const result = new Date(Date.UTC(yearNum, parseInt(m, 10) - 1, parseInt(d, 10)));
    return Number.isNaN(result.getTime()) ? null : result;
  }

  const iso = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const result = new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
    return Number.isNaN(result.getTime()) ? null : result;
  }

  return null;
}

function mapToSwipeCategory(rawName: string): { emoji: string; name: string } {
  const upper = rawName.replace(/^[^\w]*/, "").trim().toUpperCase();

  if (/EINBRUCH/i.test(rawName)) return { emoji: "⚠️", name: "ACCOUNT-EINBRUCH" };
  if (/MODEL.?TAUSCH/i.test(rawName)) return { emoji: "🔄", name: "MODEL-TAUSCH" };
  if (/BREAKOUT/i.test(rawName)) return { emoji: "🌟", name: "BREAKOUT-STAR" };
  if (/UPGRADE.*STREAK|STREAK.*UPGRADE/i.test(rawName)) return { emoji: "🟢", name: "ACCOUNT UPGRADE (UMSATZ-STREAK)" };
  if (/KURZ.*UPGRADE/i.test(rawName)) return { emoji: "🚀", name: "KURZ VOR UPGRADE" };
  if (/UPGRADE.*ZUVERL|ZUVERL.*UPGRADE/i.test(rawName)) return { emoji: "🔼", name: "ACCOUNT UPGRADE (ZUVERLÄSSIG)" };
  if (/TRAFFIC.*CONVERSION|CONVERSION|TRAFFIC.*KEINE/i.test(rawName)) return { emoji: "📊", name: "HOHER TRAFFIC / KEINE CONVERSION" };
  if (/COMEBACK/i.test(rawName)) return { emoji: "🔄", name: "COMEBACK" };
  if (/COACHING.*KONTROLLE|ENGERE/i.test(rawName)) return { emoji: "🟡", name: "COACHING / ENGERE KONTROLLE" };
  if (/VIDEO.?COACHING/i.test(rawName)) return { emoji: "📼", name: "VIDEO-COACHING" };
  if (/WARNUNG/i.test(rawName)) return { emoji: "🟠", name: "WARNUNG" };
  if (/TOP.?PERFORMER/i.test(rawName)) return { emoji: "⭐", name: "TOP PERFORMER" };
  if (/UNTER.?BEOBACHTUNG/i.test(rawName)) return { emoji: "👀", name: "UNTER BEOBACHTUNG" };
  if (/MITTELFELD|WEITER\s*SO/i.test(rawName)) return { emoji: "⚪", name: "WEITER SO" };

  const zeroMatch = rawName.match(/0\s*€.*?TAG\s*(\d+\+?)/i);
  if (zeroMatch) {
    const tag = zeroMatch[1];
    if (tag.includes("+") || parseInt(tag, 10) >= 7) return { emoji: "📉", name: "0€ UMSATZ TAG 7+" };
    const num = parseInt(tag, 10);
    if (num >= 1 && num <= 6) return { emoji: "📉", name: `0€ UMSATZ TAG ${num}` };
  }

  const onboardingMatch = rawName.match(/ONBOARDING.*?TAG\s*(\d+)/i);
  if (onboardingMatch) {
    const tag = parseInt(onboardingMatch[1], 10);
    if (tag >= 1 && tag <= 5) return { emoji: "🔵", name: `ONBOARDING TAG ${tag}` };
    return { emoji: "⚪", name: "WEITER SO" };
  }

  if (/ONBOARDING/i.test(upper)) return { emoji: "🔵", name: "ONBOARDING TAG 1" };
  return { emoji: "⚪", name: "WEITER SO" };
}

export default function TinderMode() {
  const { platform } = usePlatform();
  const [chatters, setChatters] = useState<ChatterData[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionPanel, setActionPanel] = useState(false);
  const [slideOver, setSlideOver] = useState(false);
  const [labelPanel, setLabelPanel] = useState(false);
  const [notePanel, setNotePanel] = useState(false);
  const [checkedNames, setCheckedNames] = useState<Set<string>>(new Set());
  const [undoStack, setUndoStack] = useState<string[]>([]);

  // Label state
  const [allLabels, setAllLabels] = useState<{ id: string; label_name: string; color: string }[]>([]);
  const [assignedLabelIds, setAssignedLabelIds] = useState<Set<string>>(new Set());
  const [newLabelName, setNewLabelName] = useState("");

  // Note state
  const [notes, setNotes] = useState<{ id: string; note_text: string; created_at: string }[]>([]);
  const [noteText, setNoteText] = useState("");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      // Get latest report
      const { data: report } = await supabase
        .from("analysis_reports")
        .select("result_json")
        .eq("platform", platform)
        .not("result_json", "is", null)
        .order("analysis_date", { ascending: false })
        .limit(1)
        .single();

      if (!report?.result_json) {
        setChatters([]);
        setLoading(false);
        return;
      }

      const result = report.result_json as unknown as AnalysisResult;
      if (!result?.categories) {
        setChatters([]);
        setLoading(false);
        return;
      }

      const fiveDaysAgo = new Date();
      fiveDaysAgo.setUTCDate(fiveDaysAgo.getUTCDate() - 5);

      const allChatters: ChatterData[] = [];
      for (const cat of result.categories) {
        const mapped = mapToSwipeCategory(cat.categoryName);

        for (const ch of cat.chatters) {
          let finalCategory = mapped;
          if (mapped.name.startsWith("ONBOARDING")) {
            const start = parseLooseDate(ch.startDate);
            if (start && start < fiveDaysAgo) {
              finalCategory = { emoji: "⚪", name: "WEITER SO" };
            }
          }

          allChatters.push({
            name: toTitleCase(ch.name),
            kpis: ch.kpis,
            recommendation: ch.recommendation,
            categoryEmoji: finalCategory.emoji,
            categoryName: finalCategory.name,
          });
        }
      }

      // Load revenue history for sparklines
      const names = allChatters.map((c) => c.name);
      const { data: history } = await supabase
        .from("chatter_history")
        .select("chatter_name, analysis_date, revenue_today")
        .eq("platform", platform)
        .in("chatter_name", names)
        .order("analysis_date", { ascending: true });

      if (history) {
        const histMap = new Map<string, { date: string; revenue: number }[]>();
        for (const h of history) {
          if (!histMap.has(h.chatter_name)) histMap.set(h.chatter_name, []);
          histMap.get(h.chatter_name)!.push({
            date: h.analysis_date,
            revenue: Number(h.revenue_today) || 0,
          });
        }
        for (const ch of allChatters) {
          ch.revenueHistory = histMap.get(ch.name)?.slice(-7);
        }
      }

      // Load today's checks
      const today = new Date().toISOString().split("T")[0];
      const { data: checks } = await supabase
        .from("daily_chatter_checks")
        .select("chatter_name")
        .eq("platform", platform)
        .eq("check_date", today);

      if (checks) {
        setCheckedNames(new Set(checks.map((c) => normalizeName(c.chatter_name))));
      }

      setChatters(allChatters);
      
      setUndoStack([]);
      setLoading(false);
    };
    load();
  }, [platform]);

  // Filter out already-checked chatters for swipe stack
  const uncheckedChatters = useMemo(
    () => chatters.filter((c) => !checkedNames.has(normalizeName(c.name))),
    [chatters, checkedNames]
  );

  const currentChatter = uncheckedChatters[0];
  const currentChatterName = currentChatter?.name ?? null;
  const totalCount = chatters.length;
  const checkedCount = checkedNames.size;
  const progress = totalCount > 0 ? (checkedCount / totalCount) * 100 : 0;

  // Load labels and notes when chatter changes or panels open
  useEffect(() => {
    if (!currentChatterName) return;
    supabase.from("chatter_labels").select("id, label_name, color").eq("platform", platform)
      .then(({ data }) => { if (data) setAllLabels(data); });
    supabase.from("chatter_label_assignments").select("label_id").eq("chatter_name", currentChatterName).eq("platform", platform)
      .then(({ data }) => { if (data) setAssignedLabelIds(new Set(data.map((d) => d.label_id))); });
    supabase.from("coaching_notes").select("id, note_text, created_at").eq("chatter_name", currentChatterName).eq("platform", platform).order("created_at", { ascending: false })
      .then(({ data }) => { if (data) setNotes(data); });
  }, [currentChatterName, platform]);

  const markChecked = useCallback(async (name: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const today = new Date().toISOString().split("T")[0];

    await supabase.from("daily_chatter_checks").upsert(
      { chatter_name: name, platform, user_id: user.id, check_date: today },
      { onConflict: "user_id,chatter_name,check_date,platform", ignoreDuplicates: true }
    );

    setCheckedNames((prev) => new Set(prev).add(normalizeName(name)));
  }, [platform]);

  const goNext = useCallback(() => {
    setActionPanel(false);
    // uncheckedChatters auto-updates, so index stays at 0 for next card
  }, []);

  const handleUndo = useCallback(() => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const lastName = prev[prev.length - 1];
      setCheckedNames((s) => {
        const next = new Set(s);
        next.delete(normalizeName(lastName));
        return next;
      });
      return prev.slice(0, -1);
    });
    setActionPanel(false);
  }, []);

  const handleSwipeRight = useCallback(() => {
    if (!currentChatter) return;
    setUndoStack((prev) => [...prev, currentChatter.name]);
    markChecked(currentChatter.name);
    goNext();
  }, [currentChatter, markChecked, goNext]);

  const handleSwipeLeft = useCallback(() => {
    setActionPanel(true);
  }, []);

  const handleSwipeUp = useCallback(() => {
    setSlideOver(true);
  }, []);

  const handleActionDone = useCallback(() => {
    if (currentChatter) {
      setUndoStack((prev) => [...prev, currentChatter.name]);
      markChecked(currentChatter.name);
    }
    setActionPanel(false);
    goNext();
  }, [currentChatter, markChecked, goNext]);

  const handleReset = () => {
    setCheckedNames(new Set());
    setUndoStack([]);
    setActionPanel(false);
  };

  // Label toggle
  const toggleLabel = async (labelId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !currentChatter) return;
    if (assignedLabelIds.has(labelId)) {
      await supabase.from("chatter_label_assignments").delete()
        .eq("label_id", labelId).eq("chatter_name", currentChatter.name).eq("platform", platform).eq("user_id", user.id);
      setAssignedLabelIds((prev) => { const n = new Set(prev); n.delete(labelId); return n; });
    } else {
      await supabase.from("chatter_label_assignments").insert({
        label_id: labelId, chatter_name: currentChatter.name, platform, user_id: user.id,
      });
      setAssignedLabelIds((prev) => new Set(prev).add(labelId));
    }
  };

  const createLabel = async () => {
    if (!newLabelName.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const colors = ["#3B82F6", "#EF4444", "#10B981", "#F59E0B", "#8B5CF6", "#EC4899"];
    const color = colors[allLabels.length % colors.length];
    const { data } = await supabase.from("chatter_labels")
      .insert({ user_id: user.id, platform, label_name: newLabelName.trim(), color })
      .select("id, label_name, color").single();
    if (data) { setAllLabels((prev) => [...prev, data]); setNewLabelName(""); }
  };

  // Save note
  const saveNote = async () => {
    if (!noteText.trim() || !currentChatter) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase.from("coaching_notes")
      .insert({ chatter_name: currentChatter.name, note_text: noteText.trim(), platform, user_id: user.id })
      .select("id, note_text, created_at").single();
    if (error) { toast.error("Fehler beim Speichern"); return; }
    if (data) { setNotes((prev) => [data, ...prev]); setNoteText(""); toast.success("Notiz gespeichert"); }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (actionPanel || slideOver) return;
      if (e.key === "ArrowRight") handleSwipeRight();
      if (e.key === "ArrowLeft") handleSwipeLeft();
      if (e.key === "ArrowUp") handleSwipeUp();
      if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); handleUndo(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [actionPanel, slideOver, handleSwipeRight, handleSwipeLeft, handleSwipeUp, handleUndo]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="h-6 w-6 border border-white/20 border-t-white/60 rounded-full animate-spin" />
      </div>
    );
  }

  if (chatters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
        <p className="text-sm">Keine Chatter-Daten vorhanden.</p>
        <p className="text-xs">Lade zuerst einen Report hoch.</p>
      </div>
    );
  }

  const isDone = uncheckedChatters.length === 0;

  return (
    <div className="flex flex-col h-full max-w-md mx-auto px-4 py-6">
      {/* Progress header */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground font-medium">
            {checkedCount}/{totalCount} gecheckt
          </span>
          <span className="text-xs text-muted-foreground">
            {uncheckedChatters.length} übrig
          </span>
        </div>
        <Progress value={progress} className="h-1.5" />
      </div>

      {/* Card stack */}
      <div className="relative flex-1 min-h-0">
        {isDone ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center justify-center h-full gap-4"
          >
            <div className="text-5xl">🎉</div>
            <p className="text-foreground font-medium">Alle Chatter durchgegangen!</p>
            <p className="text-sm text-muted-foreground">{checkedCount} von {totalCount} gecheckt</p>
            <Button variant="outline" size="sm" onClick={handleReset}>
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              Nochmal durchgehen
            </Button>
          </motion.div>
        ) : (
          <>
            <AnimatePresence mode="popLayout">
              {/* Show next card behind */}
              {uncheckedChatters.length > 1 && (
                <SwipeCard
                  key={uncheckedChatters[1].name + "-bg"}
                  chatter={uncheckedChatters[1]}
                  onSwipeRight={() => {}}
                  onSwipeLeft={() => {}}
                  onSwipeUp={() => {}}
                  isTop={false}
                />
              )}
              {/* Current card */}
              {currentChatter && (
                <SwipeCard
                  key={currentChatter.name + "-top"}
                  chatter={currentChatter}
                  onSwipeRight={handleSwipeRight}
                  onSwipeLeft={handleSwipeLeft}
                  onSwipeUp={handleSwipeUp}
                  isTop={true}
                />
              )}
            </AnimatePresence>

            {/* Action panel overlay */}
            {currentChatter && (
              <SwipeActionPanel
                open={actionPanel}
                onClose={() => setActionPanel(false)}
                chatterName={currentChatter.name}
                platform={platform}
                onDone={handleActionDone}
              />
            )}
          </>
        )}
      </div>

      {/* Bottom buttons */}
      {!isDone && currentChatter && (
        <>
          <div className="flex items-center justify-center gap-3 mt-4">
            <Button
              variant="outline"
              size="icon"
              onClick={handleUndo}
              disabled={undoStack.length === 0}
              className="h-9 w-9 rounded-full border-border text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-30"
            >
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => { setLabelPanel(true); setNotePanel(false); }}
              className="relative h-10 w-10 rounded-full border-border text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <Tag className="h-4 w-4" />
              {assignedLabelIds.size > 0 && (
                <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[9px] font-bold h-4 w-4 rounded-full flex items-center justify-center">
                  {assignedLabelIds.size}
                </span>
              )}
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={handleSwipeLeft}
              className="h-12 w-12 rounded-full border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
            >
              <X className="h-5 w-5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={handleSwipeUp}
              className="h-10 w-10 rounded-full border-blue-500/30 text-blue-400 hover:bg-blue-500/10 hover:text-blue-300"
            >
              <ChevronUp className="h-5 w-5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={handleSwipeRight}
              className="h-12 w-12 rounded-full border-green-500/30 text-green-400 hover:bg-green-500/10 hover:text-green-300"
            >
              <Check className="h-5 w-5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => { setNotePanel(true); setLabelPanel(false); }}
              className="relative h-10 w-10 rounded-full border-border text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <StickyNote className="h-4 w-4" />
              {notes.length > 0 && (
                <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[9px] font-bold h-4 w-4 rounded-full flex items-center justify-center">
                  {notes.length}
                </span>
              )}
            </Button>
          </div>

          {/* Label Bottom Sheet */}
          <AnimatePresence>
            {labelPanel && (
              <motion.div
                className="fixed inset-0 z-40 flex items-end justify-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <div className="absolute inset-0 bg-black/40" onClick={() => setLabelPanel(false)} />
                <motion.div
                  className="relative w-full max-w-md rounded-t-2xl bg-[hsl(var(--surface-1))] border-t border-border p-5"
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ type: "spring", damping: 25, stiffness: 300 }}
                >
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-medium text-foreground">Labels</h3>
                    <button onClick={() => setLabelPanel(false)} className="text-muted-foreground hover:text-foreground">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {allLabels.map((label) => (
                      <button
                        key={label.id}
                        onClick={() => toggleLabel(label.id)}
                        className={`text-[11px] px-2.5 py-1 rounded-full border transition-all ${
                          assignedLabelIds.has(label.id)
                            ? "border-transparent text-white"
                            : "border-border text-muted-foreground hover:text-foreground"
                        }`}
                        style={assignedLabelIds.has(label.id) ? { backgroundColor: label.color } : {}}
                      >
                        {label.label_name}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-1.5">
                    <Input
                      value={newLabelName}
                      onChange={(e) => setNewLabelName(e.target.value)}
                      placeholder="Neues Label..."
                      className="h-8 text-xs bg-secondary border-border"
                      onKeyDown={(e) => e.key === "Enter" && createLabel()}
                    />
                    <Button size="sm" onClick={createLabel} disabled={!newLabelName.trim()} className="h-8 px-3">
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Note Bottom Sheet */}
          <AnimatePresence>
            {notePanel && (
              <motion.div
                className="fixed inset-0 z-40 flex items-end justify-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <div className="absolute inset-0 bg-black/40" onClick={() => setNotePanel(false)} />
                <motion.div
                  className="relative w-full max-w-md rounded-t-2xl bg-[hsl(var(--surface-1))] border-t border-border p-5"
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ type: "spring", damping: 25, stiffness: 300 }}
                >
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-medium text-foreground">Notizen</h3>
                    <button onClick={() => setNotePanel(false)} className="text-muted-foreground hover:text-foreground">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex gap-1.5 mb-3">
                    <Textarea
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      placeholder="Notiz hinzufügen..."
                      className="text-xs bg-secondary border-border resize-none min-h-[60px]"
                      rows={2}
                    />
                    <Button size="sm" onClick={saveNote} disabled={!noteText.trim()} className="h-auto px-2 self-end">
                      <Send className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {notes.length > 0 && (
                    <div className="max-h-40 overflow-y-auto space-y-1.5">
                      {notes.map((n) => (
                        <div key={n.id} className="bg-secondary rounded-lg px-2.5 py-1.5">
                          <p className="text-[11px] text-foreground/80">{n.note_text}</p>
                          <p className="text-[9px] text-muted-foreground mt-0.5">
                            {new Date(n.created_at).toLocaleDateString("de-DE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}

      {/* Chatter SlideOver */}
      {currentChatter && (
        <ChatterSlideOver
          open={slideOver}
          onClose={() => setSlideOver(false)}
          chatterName={currentChatter.name}
          platform={platform}
        />
      )}
    </div>
  );
}
