import { Rocket, TrendingUp, Sparkles } from "lucide-react";
import { motion } from "framer-motion";

interface Props {
  count: number;
  impactEur?: number;
}

export default function UpgradeHero({ count, impactEur }: Props) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-emerald-600/[0.04] to-transparent p-5">
      {/* Decorative SVG background */}
      <div className="absolute right-0 top-0 h-full w-1/2 opacity-40 pointer-events-none">
        <svg
          viewBox="0 0 200 160"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="h-full w-full"
          preserveAspectRatio="xMidYMid slice"
        >
          <defs>
            <linearGradient id="upgrade-glow" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0%" stopColor="hsl(150 60% 45%)" stopOpacity="0.35" />
              <stop offset="100%" stopColor="hsl(150 70% 35%)" stopOpacity="0.05" />
            </linearGradient>
            <linearGradient id="step-glow" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(150 70% 55%)" stopOpacity="0.9" />
              <stop offset="100%" stopColor="hsl(150 80% 40%)" stopOpacity="0.4" />
            </linearGradient>
          </defs>
          {/* Staircase / upward blocks */}
          <path
            d="M20 140 L60 140 L60 110 L100 110 L100 75 L140 75 L140 40 L180 40 L180 140 Z"
            fill="url(#upgrade-glow)"
            stroke="hsl(150 60% 45% / 0.25)"
            strokeWidth="1"
          />
          <circle cx="145" cy="32" r="10" fill="url(#step-glow)" />
          <path
            d="M140 48 L145 30 L150 48 M145 30 L145 20"
            stroke="hsl(150 80% 60%)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          {/* Small sparkle dots */}
          <circle cx="35" cy="35" r="2" fill="hsl(150 80% 60%)" opacity="0.7" />
          <circle cx="55" cy="22" r="1.5" fill="hsl(150 80% 60%)" opacity="0.5" />
          <circle cx="165" cy="110" r="1.5" fill="hsl(150 80% 60%)" opacity="0.5" />
        </svg>
      </div>

      {/* Content */}
      <div className="relative flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400/25 to-emerald-600/10 border border-emerald-400/30 shadow-[0_0_24px_-4px_rgba(52,211,153,0.25)]">
          <Rocket className="h-5 w-5 text-emerald-300" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-[15px] font-semibold tracking-tight text-emerald-100">
              Upgrade-Kandidaten
            </h2>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-400/25 text-[10px] font-medium text-emerald-200">
              <Sparkles className="h-3 w-3" />
              {count} {count === 1 ? "Kandidat" : "Kandidaten"}
            </span>
          </div>
          <p className="text-[11px] text-emerald-200/60 font-light mt-1 max-w-[70%] leading-relaxed">
            Chatters, die bereit sind, auf einen größeren Account oder mehr Verantwortung zu wachsen.
          </p>
          {impactEur != null && impactEur > 0 && (
            <div className="mt-2.5 flex items-center gap-1.5 text-[12px] font-medium text-emerald-200/90">
              <TrendingUp className="h-3.5 w-3.5 text-emerald-300" />
              <span>Potenzial:</span>
              <span className="text-emerald-300 tabular-nums">+{Math.round(impactEur).toLocaleString("de-DE")} € / Wo</span>
            </div>
          )}
        </div>
      </div>

      {/* Animated sheen */}
      <motion.div
        className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/5 to-transparent skew-x-12"
        animate={{ x: ["100%", "-100%"] }}
        transition={{ duration: 4.5, repeat: Infinity, repeatDelay: 3, ease: "easeInOut" }}
      />
    </div>
  );
}
