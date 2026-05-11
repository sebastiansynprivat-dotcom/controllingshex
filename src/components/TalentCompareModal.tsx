import { useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Rocket, ArrowLeftRight } from "lucide-react";
import ChatterSlideOver from "@/components/ChatterSlideOver";

interface Props {
  open: boolean;
  onClose: () => void;
  platform: string;
  riser: string;
  underuser: string;
}

export default function TalentCompareModal({ open, onClose, platform, riser, underuser }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-md flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 border-b border-white/[0.06] bg-zinc-950/95 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-8 w-8 rounded-lg flex items-center justify-center border border-fuchsia-500/25 bg-fuchsia-500/10 text-fuchsia-300 shrink-0">
                <Rocket className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-[0.2em] text-fuchsia-300/80 font-medium">Talent · Vergleich</p>
                <p className="text-[12px] text-white/70 font-light truncate">
                  Aufsteiger vs. ungenutztes Potenzial
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="h-9 w-9 rounded-lg border border-white/[0.08] bg-white/[0.03] text-white/60 hover:text-white hover:border-white/20 transition-all flex items-center justify-center shrink-0"
              aria-label="Schließen"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Two profiles */}
          <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
            <div className="flex-1 min-h-0 md:min-w-0 md:w-1/2 relative">
              <div className="absolute top-2 left-2 z-20 px-2 py-0.5 rounded-md text-[9px] uppercase tracking-[0.2em] font-medium border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                Aufsteiger
              </div>
              <ChatterSlideOver
                open={open}
                onClose={onClose}
                chatterName={riser}
                platform={platform}
                inline
              />
            </div>

            {/* Divider with arrow */}
            <div className="hidden md:flex items-center justify-center w-0 relative">
              <div className="absolute h-10 w-10 rounded-full border border-white/10 bg-zinc-950 flex items-center justify-center text-white/50">
                <ArrowLeftRight className="h-4 w-4" />
              </div>
            </div>
            <div className="md:hidden flex items-center justify-center py-1 border-y border-white/[0.06] bg-zinc-950/80">
              <div className="h-7 w-7 rounded-full border border-white/10 bg-zinc-900 flex items-center justify-center text-white/50">
                <ArrowLeftRight className="h-3.5 w-3.5 rotate-90" />
              </div>
            </div>

            <div className="flex-1 min-h-0 md:min-w-0 md:w-1/2 relative">
              <div className="absolute top-2 left-2 z-20 px-2 py-0.5 rounded-md text-[9px] uppercase tracking-[0.2em] font-medium border border-amber-500/30 bg-amber-500/10 text-amber-300">
                Potenzial ungenutzt
              </div>
              <ChatterSlideOver
                open={open}
                onClose={onClose}
                chatterName={underuser}
                platform={platform}
                inline
              />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
