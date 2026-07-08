import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Archive, Check, X, Rocket, TrendingDown, GitCompareArrows } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UnifiedAction } from "@/lib/today-engine";

interface Props {
  items: UnifiedAction[];
  onCheckOff: (action: UnifiedAction) => void;
  onReturn: (action: UnifiedAction) => void;
  onCompare: (upgrade: UnifiedAction, downgrade: UnifiedAction) => void;
  onDropAction: (bundleKey: string) => void;
}

export default function CompareTray({ items, onCheckOff, onReturn, onCompare, onDropAction }: Props) {
  const [open, setOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [selUp, setSelUp] = useState<string | null>(null);
  const [selDown, setSelDown] = useState<string | null>(null);

  const upgrades = useMemo(() => items.filter((a) => a.primaryKind === "upgrade"), [items]);
  const downgrades = useMemo(() => items.filter((a) => a.primaryKind === "downgrade"), [items]);
  const count = items.length;

  // Auto-select first of each kind for quick compare
  useEffect(() => {
    if (!selUp && upgrades[0]) setSelUp(upgrades[0].bundleKey);
    if (selUp && !upgrades.find((a) => a.bundleKey === selUp)) setSelUp(upgrades[0]?.bundleKey ?? null);
  }, [upgrades, selUp]);
  useEffect(() => {
    if (!selDown && downgrades[0]) setSelDown(downgrades[0].bundleKey);
    if (selDown && !downgrades.find((a) => a.bundleKey === selDown)) setSelDown(downgrades[0]?.bundleKey ?? null);
  }, [downgrades, selDown]);

  const compareReady = selUp && selDown;
  const startCompare = () => {
    const u = upgrades.find((a) => a.bundleKey === selUp);
    const d = downgrades.find((a) => a.bundleKey === selDown);
    if (u && d) {
      onCompare(u, d);
      setOpen(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("application/x-tray-bundlekey")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDragOver(true);
    }
  };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const key = e.dataTransfer.getData("application/x-tray-bundlekey");
    if (key) onDropAction(key);
  };

  return createPortal(
    <>
      {/* Floating button + drop zone */}
      <div
        className="fixed z-50 pointer-events-auto"
        style={{
          right: "max(env(safe-area-inset-right), 16px)",
          bottom: "calc(max(env(safe-area-inset-bottom), 0px) + 96px)",
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <motion.button
          type="button"
          onClick={() => setOpen((v) => !v)}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0, opacity: 0 }}
          whileTap={{ scale: 0.94 }}
          className={cn(
            "relative flex h-14 w-14 items-center justify-center rounded-full border backdrop-blur-2xl transition-all",
            "shadow-[0_12px_36px_-12px_rgba(0,0,0,0.7)]",
            dragOver
              ? "h-16 w-16 border-emerald-400/70 bg-emerald-500/25 ring-4 ring-emerald-400/25"
              : open
                ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-100"
                : "border-white/[0.12] bg-background/70 text-white/75 hover:text-white hover:border-white/25",
          )}
          aria-label="Vergleichs-Ablage"
        >
          <Archive className={cn("transition-all", dragOver ? "h-6 w-6 text-emerald-100" : "h-5 w-5")} />
          {count > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[20px] h-[20px] px-1 rounded-full bg-emerald-500 text-[10px] font-semibold text-emerald-950 flex items-center justify-center tabular-nums shadow-lg">
              {count}
            </span>
          )}
        </motion.button>
      </div>

      {/* Panel */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              key="tray-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
              onClick={() => setOpen(false)}
            />
            <motion.div
              key="tray-panel"
              initial={{ opacity: 0, y: 20, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.96 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="fixed z-50 flex flex-col rounded-2xl border border-white/[0.1] bg-background/95 backdrop-blur-2xl shadow-[0_24px_60px_-20px_rgba(0,0,0,0.85)] overflow-hidden"
              style={{
                right: "max(env(safe-area-inset-right), 16px)",
                bottom: "calc(max(env(safe-area-inset-bottom), 0px) + 168px)",
                width: "min(calc(100vw - 32px), 380px)",
                maxHeight: "min(70vh, 620px)",
              }}
            >
              {/* Header */}
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/[0.06]">
                <div className="flex items-center gap-2">
                  <Archive className="h-4 w-4 text-emerald-300" />
                  <span className="text-[13px] font-medium text-white/85">Ablage</span>
                  <span className="text-[11px] text-white/35 font-light tabular-nums">· {count}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="h-7 w-7 rounded-full flex items-center justify-center text-white/50 hover:text-white/90 hover:bg-white/[0.06] transition-colors"
                  aria-label="Schließen"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Compare CTA */}
              <div className="px-4 py-3 border-b border-white/[0.06] bg-white/[0.015]">
                <button
                  type="button"
                  onClick={startCompare}
                  disabled={!compareReady}
                  className={cn(
                    "w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[12px] font-medium border transition-all",
                    compareReady
                      ? "bg-emerald-500/15 border-emerald-400/40 text-emerald-100 hover:bg-emerald-500/25"
                      : "bg-white/[0.03] border-white/[0.08] text-white/30 cursor-not-allowed",
                  )}
                >
                  <GitCompareArrows className="h-3.5 w-3.5" />
                  Vergleich starten
                </button>
                <p className="mt-1.5 text-[10px] text-white/30 font-light text-center">
                  {compareReady
                    ? "Öffnet beide Profile nebeneinander"
                    : "Wähle je 1 Upgrade + 1 Downgrade"}
                </p>
              </div>

              {/* Lists */}
              <div className="flex-1 overflow-y-auto p-3 space-y-4">
                <TrayColumn
                  title="Upgrade"
                  icon={Rocket}
                  accent="text-emerald-300"
                  badgeClass="bg-emerald-500/15 border-emerald-400/25 text-emerald-200"
                  items={upgrades}
                  selectedKey={selUp}
                  onSelect={setSelUp}
                  onCheck={onCheckOff}
                  onReturn={onReturn}
                />
                <TrayColumn
                  title="Downgrade"
                  icon={TrendingDown}
                  accent="text-red-300"
                  badgeClass="bg-red-500/15 border-red-400/25 text-red-200"
                  items={downgrades}
                  selectedKey={selDown}
                  onSelect={setSelDown}
                  onCheck={onCheckOff}
                  onReturn={onReturn}
                />
                {count === 0 && (
                  <div className="text-center text-[11px] text-white/30 font-light py-8">
                    Zieh Karten aus dem Vergleich hierher, um sie zu sammeln.
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>,
    document.body,
  );
}

function TrayColumn({
  title,
  icon: Icon,
  accent,
  badgeClass,
  items,
  selectedKey,
  onSelect,
  onCheck,
  onReturn,
}: {
  title: string;
  icon: typeof Rocket;
  accent: string;
  badgeClass: string;
  items: UnifiedAction[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onCheck: (a: UnifiedAction) => void;
  onReturn: (a: UnifiedAction) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-1">
        <Icon className={cn("h-3.5 w-3.5", accent)} />
        <span className={cn("text-[10px] font-semibold uppercase tracking-[0.18em]", accent)}>{title}</span>
        <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-medium tabular-nums border", badgeClass)}>
          {items.length}
        </span>
      </div>
      <div className="space-y-1.5">
        {items.map((a) => {
          const selected = a.bundleKey === selectedKey;
          return (
            <div
              key={a.bundleKey}
              onClick={() => onSelect(a.bundleKey)}
              className={cn(
                "group flex items-center gap-2 rounded-lg border px-2.5 py-2 cursor-pointer transition-all",
                selected
                  ? "border-emerald-400/40 bg-emerald-500/[0.06]"
                  : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.14] hover:bg-white/[0.04]",
              )}
            >
              <div
                className={cn(
                  "flex h-4 w-4 items-center justify-center rounded-full border shrink-0",
                  selected ? "border-emerald-400 bg-emerald-500/30" : "border-white/20",
                )}
              >
                {selected && <div className="h-1.5 w-1.5 rounded-full bg-emerald-300" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-medium text-white/85 truncate">
                  {a.chatterName ?? "—"}
                </p>
                {a.signals[0]?.title && (
                  <p className="text-[10px] text-white/40 font-light truncate">{a.signals[0].title}</p>
                )}
              </div>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCheck(a);
                }}
                title="Abhaken & abschließen"
                className="h-7 w-7 rounded-full flex items-center justify-center text-emerald-300/70 hover:text-emerald-200 hover:bg-emerald-500/15 transition-colors"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onReturn(a);
                }}
                title="Zurück in die Liste"
                className="h-7 w-7 rounded-full flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/[0.06] transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
