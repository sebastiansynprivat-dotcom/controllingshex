import { useEffect, useState } from "react";
import { motion } from "framer-motion";

const PHASES = [
  "Verbinde mit deinen Daten",
  "Lese Echtzeit-Signale",
  "Vergleiche mit Historie",
  "Gewichte nach Impact",
  "Formuliere Empfehlung",
];

export default function ThinkingIndicator({ label }: { label?: string }) {
  const [phase, setPhase] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const p = setInterval(() => setPhase((v) => (v + 1) % PHASES.length), 2600);
    const t = setInterval(() => setElapsed((v) => v + 1), 1000);
    return () => {
      clearInterval(p);
      clearInterval(t);
    };
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}
      className="flex justify-start"
    >
      <div className="lux-thinking relative overflow-hidden rounded-2xl px-5 sm:px-6 py-4 min-w-[260px] max-w-[85%]">
        <div className="relative flex items-center gap-3.5">
          <span className="lux-orb" />
          <div className="flex-1 min-w-0">
            <motion.p
              key={label ?? phase}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45 }}
              className="lux-shimmer-text text-[13px] font-light tracking-tight"
            >
              {label ?? PHASES[phase]}
            </motion.p>
            <div className="mt-2 h-px w-full overflow-hidden rounded-full bg-white/[0.05]">
              <span className="lux-progress block h-full w-1/3" />
            </div>
          </div>
          <span className="text-[10px] font-light tabular-nums text-white/20 tracking-widest">
            {String(Math.floor(elapsed / 60)).padStart(2, "0")}:{String(elapsed % 60).padStart(2, "0")}
          </span>
        </div>
      </div>
    </motion.div>
  );
}
