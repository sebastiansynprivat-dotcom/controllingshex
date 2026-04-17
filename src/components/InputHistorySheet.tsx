import { AnimatePresence, motion } from "framer-motion";
import { X, Clock } from "lucide-react";
import { getSourceMeta, type InputEvent } from "@/lib/chatter-inputs";

interface Props {
  open: boolean;
  onClose: () => void;
  chatterName: string;
  events: InputEvent[];
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days === 0) {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    if (hours <= 0) return "gerade eben";
    return `vor ${hours}h`;
  }
  if (days === 1) return "gestern";
  if (days < 7) return `vor ${days} Tagen`;
  if (days < 30) return `vor ${Math.floor(days / 7)} Wochen`;
  return `vor ${Math.floor(days / 30)} Monaten`;
}

export default function InputHistorySheet({ open, onClose, chatterName, events }: Props) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-end justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-md"
            onClick={onClose}
          />
          <motion.div
            className="relative w-full max-w-md rounded-t-3xl px-5 pb-7 pt-3 overflow-hidden"
            style={{
              background: `radial-gradient(120% 60% at 50% 0%, hsl(152 70% 45% / 0.10) 0%, transparent 55%), linear-gradient(180deg, hsl(240 6% 7%) 0%, hsl(240 6% 4%) 100%)`,
              borderTop: "1px solid hsl(0 0% 100% / 0.08)",
              boxShadow: "0 -20px 60px -10px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)",
            }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 340 }}
          >
            <div
              aria-hidden
              className="absolute top-0 left-12 right-12 h-px rounded-full"
              style={{
                background: "linear-gradient(to right, transparent, hsl(152 70% 45% / 0.5), transparent)",
                boxShadow: "0 0 12px hsl(152 70% 45% / 0.4)",
              }}
            />
            <div className="flex justify-center mb-3">
              <div className="w-10 h-1 rounded-full bg-white/10" />
            </div>
            <div className="flex items-center gap-2.5 mb-1">
              <div
                className="h-9 w-9 rounded-xl flex items-center justify-center"
                style={{
                  background: "linear-gradient(135deg, hsl(152 70% 45% / 0.2), hsl(152 70% 45% / 0.06))",
                  border: "1px solid hsl(152 70% 45% / 0.2)",
                }}
              >
                <Clock className="h-4 w-4" style={{ color: "hsl(152 70% 65%)" }} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-[0.18em] text-white/40 font-medium leading-none">Input-Historie</p>
                <h3 className="text-sm font-semibold text-foreground capitalize truncate mt-0.5">
                  {chatterName.replace(/_/g, " ")}
                </h3>
              </div>
              <button
                onClick={onClose}
                className="h-8 w-8 rounded-full flex items-center justify-center text-white/50 hover:text-white hover:bg-white/5 transition-colors"
                aria-label="Schließen"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="h-px bg-white/[0.06] my-4" />
            {events.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.015]">
                <Clock className="h-5 w-5 text-white/25 mb-2" />
                <p className="text-xs text-white/40 font-light">Noch keine Inputs erfasst</p>
              </div>
            ) : (
              <div className="max-h-[55vh] overflow-y-auto space-y-2 pr-1 -mr-1">
                {events.map((ev, i) => {
                  const meta = getSourceMeta(ev.source);
                  return (
                    <motion.div
                      key={`${ev.created_at}-${i}`}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.02, duration: 0.18 }}
                      className="rounded-xl px-3 py-2.5 border"
                      style={{
                        background: `linear-gradient(135deg, hsl(${meta.color} / 0.06), hsl(${meta.color} / 0.02))`,
                        borderColor: `hsl(${meta.color} / 0.18)`,
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-base leading-none">{meta.icon}</span>
                          <span className="text-xs font-semibold" style={{ color: `hsl(${meta.color} / 0.95)` }}>
                            {meta.label}
                          </span>
                        </div>
                        <span className="text-[10px] text-white/40 font-light tracking-wide shrink-0">
                          {formatRelative(ev.created_at)}
                        </span>
                      </div>
                      {ev.note && (
                        <p className="text-[11px] text-foreground/75 leading-relaxed mt-1.5 whitespace-pre-wrap">
                          {ev.note}
                        </p>
                      )}
                      <p className="text-[9px] text-white/30 font-light mt-1">
                        {new Date(ev.created_at).toLocaleString("de-DE", {
                          day: "2-digit", month: "short", year: "numeric",
                          hour: "2-digit", minute: "2-digit",
                        })}
                      </p>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
