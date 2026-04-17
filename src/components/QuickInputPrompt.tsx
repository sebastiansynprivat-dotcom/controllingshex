import { AnimatePresence, motion } from "framer-motion";
import { MessageCircle, Flame, Eye, X } from "lucide-react";

interface Props {
  open: boolean;
  chatterName: string;
  onPick: (type: "verbal" | "praise" | "observed") => void;
  onSkip: () => void;
}

const OPTIONS: { type: "verbal" | "praise" | "observed"; icon: React.ComponentType<any>; label: string; hint: string; hue: string }[] = [
  { type: "verbal", icon: MessageCircle, label: "Input gegeben", hint: "Coaching / Feedback", hue: "212 90% 60%" },
  { type: "praise", icon: Flame, label: "Lob", hint: "Positive Verstärkung", hue: "25 95% 55%" },
  { type: "observed", icon: Eye, label: "Nur beobachtet", hint: "Kein Input nötig", hue: "240 5% 60%" },
];

export default function QuickInputPrompt({ open, chatterName, onPick, onSkip }: Props) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-x-0 bottom-0 z-50 flex justify-center pointer-events-none px-3 pb-3"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ type: "spring", stiffness: 380, damping: 28 }}
        >
          <motion.div
            className="pointer-events-auto w-full max-w-md rounded-2xl px-3 py-2.5 overflow-hidden"
            style={{
              background: `linear-gradient(180deg, hsl(240 6% 9% / 0.96) 0%, hsl(240 6% 5% / 0.96) 100%)`,
              border: "1px solid hsl(0 0% 100% / 0.08)",
              boxShadow: "0 20px 60px -10px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.06)",
              backdropFilter: "blur(20px)",
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] uppercase tracking-[0.16em] text-white/45 font-medium truncate">
                <span className="text-white/70 capitalize">{chatterName.replace(/_/g, " ")}</span>
                <span className="ml-1.5">— Was war's?</span>
              </p>
              <button
                onClick={onSkip}
                className="h-6 w-6 -mr-1 rounded-full flex items-center justify-center text-white/40 hover:text-white/70 hover:bg-white/5 transition-colors shrink-0"
                aria-label="Nur swipen, nichts tracken"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {OPTIONS.map(({ type, icon: Icon, label, hint, hue }) => (
                <motion.button
                  key={type}
                  onClick={() => { try { (navigator as any).vibrate?.(10); } catch {} onPick(type); }}
                  whileTap={{ scale: 0.94 }}
                  className="flex flex-col items-center justify-center gap-1 py-2.5 px-1 rounded-xl border transition-colors"
                  style={{
                    background: `linear-gradient(135deg, hsl(${hue} / 0.10), hsl(${hue} / 0.03))`,
                    borderColor: `hsl(${hue} / 0.22)`,
                  }}
                >
                  <Icon className="h-4 w-4" style={{ color: `hsl(${hue} / 0.95)` }} />
                  <span className="text-[10px] font-semibold leading-tight text-center" style={{ color: `hsl(${hue} / 0.95)` }}>
                    {label}
                  </span>
                  <span className="text-[8.5px] text-white/35 font-light leading-tight text-center">{hint}</span>
                </motion.button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
