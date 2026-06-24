/**
 * Floating Bottom-Bar — Ablage für Auffälligkeiten-Karten.
 *
 * Persistent über localStorage (siehe `use-anomaly-tray`). Drop-Target für
 * Karten aus `AnomalyPanel`; Karten lassen sich per Button oder Drag zurück
 * auf ein Panel wieder einblenden.
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Archive, ChevronDown, ChevronUp, RotateCcw, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { TRAY_DRAG_MIME, useAnomalyTray, type TrayItem } from "@/hooks/use-anomaly-tray";

const SEVERITY_DOT: Record<string, string> = {
  critical: "bg-red-400 shadow-[0_0_8px_rgba(239,68,68,0.55)]",
  high: "bg-orange-400 shadow-[0_0_8px_rgba(251,146,60,0.5)]",
  medium: "bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.45)]",
  info: "bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.4)]",
  positive: "bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.45)]",
};

interface AnomalyTrayProps {
  onChatterSelect?: (name: string) => void;
}

export default function AnomalyTray({ onChatterSelect }: AnomalyTrayProps = {}) {
  const { items, add, remove, clear } = useAnomalyTray();
  const [collapsed, setCollapsed] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [copiedName, setCopiedName] = useState<string | null>(null);

  const handleCardClick = async (name: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(name);
        setCopiedName(name);
        window.setTimeout(() => setCopiedName((v) => (v === name ? null : v)), 1400);
      }
    } catch {
      /* clipboard kann blockiert sein — Profil trotzdem öffnen */
    }
    onChatterSelect?.(name);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const raw = e.dataTransfer.getData(TRAY_DRAG_MIME);
    if (!raw) return;
    try {
      const item = JSON.parse(raw) as Omit<TrayItem, "addedAt">;
      if (item?.name) add(item);
    } catch {
      /* noop */
    }
  };

  const handleDragStartItem = (e: React.DragEvent, item: TrayItem) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(TRAY_DRAG_MIME, JSON.stringify({
      name: item.name,
      kind: item.kind,
      severity: item.severity,
      message: item.message,
      impactPerDay: item.impactPerDay,
    }));
    // Hint: Zieht man aus Tray heraus → Item entfernen, sobald Drop irgendwo passiert.
    // Tatsächliches Entfernen passiert via Panel.onDrop oder via Button.
  };

  // Immer sichtbar — auch leer, damit User weiß wohin er ziehen kann.
  // Portal an document.body, damit `position: fixed` nicht durch transform/filter
  // an Layout-Vorfahren (z. B. motion.div mit blur-Filter) gebrochen wird.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-[100] w-[min(960px,calc(100vw-1.5rem))] pointer-events-auto">
      <motion.div
        layout
        onDragOver={(e) => {
          e.preventDefault();
          if (e.dataTransfer.types.includes(TRAY_DRAG_MIME)) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={cn(
          "rounded-2xl border backdrop-blur-xl shadow-[0_20px_60px_-20px_rgba(0,0,0,0.7)] transition-colors",
          dragOver
            ? "border-amber-300/60 bg-amber-500/[0.10]"
            : "border-white/[0.08] bg-black/55",
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-3 sm:px-4 py-2 border-b border-white/[0.05]">
          <Archive className="h-3.5 w-3.5 text-white/55" />
          <span className="text-[11px] uppercase tracking-[0.2em] text-white/65 font-medium">
            Ablage
          </span>
          <span className="text-[11px] tabular-nums text-white/45 font-light">
            {items.length}
          </span>
          {dragOver && (
            <span className="text-[10px] uppercase tracking-wider text-amber-200/90 font-medium ml-1">
              hier ablegen
            </span>
          )}

          <div className="ml-auto flex items-center gap-1">
            {items.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => items.forEach((i) => remove(i.name))}
                  title="Alle Karten zurück in die Übersicht"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] uppercase tracking-wider text-white/55 hover:text-white/85 hover:bg-white/[0.05] transition-colors"
                >
                  <RotateCcw className="h-3 w-3" />
                  Zurücklegen
                </button>
                <button
                  type="button"
                  onClick={clear}
                  title="Ablage komplett leeren"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] uppercase tracking-wider text-white/45 hover:text-red-200 hover:bg-red-500/[0.08] transition-colors"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => setCollapsed((v) => !v)}
              title={collapsed ? "Ablage einblenden" : "Ablage einklappen"}
              className="inline-flex items-center justify-center h-6 w-6 rounded-md text-white/55 hover:text-white/85 hover:bg-white/[0.05] transition-colors"
            >
              {collapsed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        {/* Body */}
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.div
              key="body"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              {items.length === 0 ? (
                <div className="px-4 py-4 text-center text-[11px] text-white/40 font-light">
                  Karten hierher ziehen, um sie aus der Übersicht zu nehmen.
                </div>
              ) : (
                <div className="flex gap-2 overflow-x-auto px-3 sm:px-4 py-3 [scrollbar-width:thin]">
                  {items.map((item) => (
                    <div
                      key={item.name}
                      draggable
                      onDragStart={(e) => handleDragStartItem(e, item)}
                      className={cn(
                        "group/tray-item shrink-0 max-w-[240px] rounded-xl border bg-white/[0.03] hover:bg-white/[0.06] transition-colors cursor-grab active:cursor-grabbing",
                        item.kind === "highlight"
                          ? "border-emerald-400/20"
                          : "border-red-400/20",
                      )}
                    >
                      <div className="flex items-start gap-2 px-2.5 py-2">
                        <span
                          className={cn(
                            "h-1.5 w-1.5 rounded-full mt-1 shrink-0",
                            SEVERITY_DOT[item.severity] ?? SEVERITY_DOT.info,
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-[12px] font-medium text-white/90 truncate">
                            {item.name}
                          </div>
                          <div className="text-[10px] text-white/45 font-light truncate">
                            {item.kind === "highlight" ? "Highlight" : "Problem"}
                            {item.impactPerDay > 0 && (
                              <span className="text-white/55"> · {item.kind === "highlight" ? "+" : "−"}{item.impactPerDay.toLocaleString("de-DE")}€/Tag</span>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => remove(item.name)}
                          title="Zurück in die Übersicht"
                          className="opacity-50 group-hover/tray-item:opacity-100 inline-flex items-center justify-center h-5 w-5 rounded-md text-white/60 hover:text-white hover:bg-white/[0.08] transition-all"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>,
    document.body,
  );
}
