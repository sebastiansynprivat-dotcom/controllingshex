import { AnimatePresence, motion } from "framer-motion";
import { MessageCircle, Flame, Eye, AlertTriangle, SkipForward, Check } from "lucide-react";
import { useMemo } from "react";

interface Props {
  open: boolean;
  chatterName: string;
  categoryEmoji?: string;
  categoryName?: string;
  onPick: (type: "verbal" | "praise" | "observed" | "warning") => void;
  onSkip: () => void;
}

const OPTIONS: {
  type: "verbal" | "praise" | "observed" | "warning";
  icon: React.ComponentType<any>;
  label: string;
  hint: string;
  hue: string;
}[] = [
  { type: "verbal", icon: MessageCircle, label: "Input gegeben", hint: "Coaching, Feedback, Korrektur", hue: "212 90% 60%" },
  { type: "praise", icon: Flame, label: "Lob", hint: "Positive Verstärkung", hue: "25 95% 55%" },
  { type: "warning", icon: AlertTriangle, label: "Warnung", hint: "Ermahnung, ernste Ansage", hue: "0 80% 60%" },
  { type: "observed", icon: Eye, label: "Nur beobachtet", hint: "Heute kein Input nötig", hue: "240 5% 60%" },
];

function getInitials(name: string): string {
  const clean = name.replace(/_/g, " ").trim();
  const parts = clean.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function QuickInputPrompt({ open, chatterName, categoryEmoji, categoryName, onPick, onSkip }: Props) {
  const initials = useMemo(() => getInitials(chatterName), [chatterName]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="absolute inset-0 z-30 flex items-stretch justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          {/* Card */}
          <motion.div
            className="relative w-full rounded-2xl p-3.5 flex flex-col overflow-hidden"
            style={{
              background: `
                radial-gradient(130% 70% at 0% 0%, hsl(152 70% 45% / 0.16) 0%, transparent 55%),
                radial-gradient(110% 80% at 100% 100%, hsl(212 90% 60% / 0.12) 0%, transparent 60%),
                linear-gradient(165deg, hsl(0 0% 100% / 0.05) 0%, hsl(240 6% 5%) 38%, hsl(240 8% 3%) 100%)
              `,
              border: "1px solid hsl(152 70% 45% / 0.25)",
              boxShadow:
                "0 18px 60px -16px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.05), inset 0 1px 0 rgba(255,255,255,0.07), 0 0 32px -8px hsl(152 70% 45% / 0.25)",
            }}
            initial={{ scale: 0.92, y: 14, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.94, y: 8, opacity: 0 }}
            transition={{ type: "spring", damping: 26, stiffness: 360, mass: 0.7 }}
          >
            {/* Top accent line */}
            <div
              aria-hidden
              className="pointer-events-none absolute top-0 left-6 right-6 h-px rounded-full"
              style={{
                background: "linear-gradient(to right, transparent 0%, hsl(152 70% 45% / 0.7) 50%, transparent 100%)",
                boxShadow: "0 0 14px hsl(152 70% 45% / 0.5)",
              }}
            />

            {/* Header chip — "Eintrag tracken" */}
            <div className="flex items-center justify-between mb-2">
              <div
                className="flex items-center gap-1.5 px-2 py-0.5 rounded-full border"
                style={{
                  borderColor: "hsl(152 70% 45% / 0.3)",
                  background: "hsl(152 70% 45% / 0.10)",
                }}
              >
                <Check className="h-3 w-3" style={{ color: "hsl(152 70% 65%)" }} strokeWidth={3} />
                <span className="text-[9.5px] uppercase tracking-wider font-semibold" style={{ color: "hsl(152 70% 75%)" }}>
                  Geswipt — Input tracken?
                </span>
              </div>
              {categoryEmoji && (
                <span className="text-[16px] leading-none opacity-60">{categoryEmoji}</span>
              )}
            </div>

            {/* Avatar + Name */}
            <div className="flex items-center gap-2.5 mb-0.5">
              <motion.div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold tracking-wide"
                style={{
                  background: "linear-gradient(135deg, hsl(152 70% 45% / 0.25) 0%, hsl(152 70% 45% / 0.06) 100%)",
                  color: "hsl(152 70% 75%)",
                  border: "1px solid hsl(152 70% 45% / 0.22)",
                }}
                initial={{ scale: 0.7, rotate: -8 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", damping: 18, stiffness: 360, delay: 0.05 }}
              >
                {initials}
              </motion.div>
              <div className="min-w-0 flex-1">
                <p className="text-[9px] uppercase tracking-[0.18em] text-white/40 font-medium leading-none">Was hast du</p>
                <h2 className="text-base font-semibold text-foreground capitalize leading-tight truncate mt-0.5">
                  {chatterName.replace(/_/g, " ")} <span className="text-white/55 font-light text-[11px]">heute gegeben?</span>
                </h2>
              </div>
            </div>

            <div className="h-px bg-white/[0.06] my-2.5" />

            {/* Options — compact, tappable */}
            <div className="flex-1 flex flex-col gap-1.5 min-h-0">
              {OPTIONS.map(({ type, icon: Icon, label, hint, hue }, i) => (
                <motion.button
                  key={type}
                  onClick={() => {
                    try { (navigator as any).vibrate?.(12); } catch {}
                    onPick(type);
                  }}
                  whileTap={{ scale: 0.97 }}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.06 + i * 0.04, type: "spring", damping: 24, stiffness: 320 }}
                  className="group flex items-center gap-2.5 w-full py-2.5 px-3 rounded-xl border text-left transition-all hover:translate-x-0.5"
                  style={{
                    background: `linear-gradient(135deg, hsl(${hue} / 0.10), hsl(${hue} / 0.03))`,
                    borderColor: `hsl(${hue} / 0.25)`,
                    boxShadow: `inset 0 1px 0 hsl(${hue} / 0.08)`,
                  }}
                >
                  <div
                    className="h-8 w-8 shrink-0 rounded-lg flex items-center justify-center"
                    style={{
                      background: `linear-gradient(135deg, hsl(${hue} / 0.22), hsl(${hue} / 0.06))`,
                      border: `1px solid hsl(${hue} / 0.25)`,
                    }}
                  >
                    <Icon className="h-4 w-4" style={{ color: `hsl(${hue} / 0.95)` }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold leading-tight" style={{ color: `hsl(${hue} / 0.98)` }}>
                      {label}
                    </p>
                    <p className="text-[10.5px] text-white/45 font-light leading-tight mt-0.5 truncate">{hint}</p>
                  </div>
                  <div
                    className="text-white/30 group-hover:text-white/60 transition-colors text-base leading-none"
                    aria-hidden
                  >
                    →
                  </div>
                </motion.button>
              ))}
            </div>

            {/* Skip — secondary, subtle */}
            <motion.button
              onClick={onSkip}
              whileTap={{ scale: 0.97 }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.24 }}
              className="mt-2 flex items-center justify-center gap-2 w-full py-2 rounded-lg text-[11px] text-white/45 hover:text-white/75 hover:bg-white/[0.03] transition-colors"
            >
              <SkipForward className="h-3.5 w-3.5" />
              <span className="font-medium">Nichts tracken — weiter</span>
            </motion.button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
