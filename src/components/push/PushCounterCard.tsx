import { CountUp } from "@/components/CountUp";

interface Props {
  label: string;
  sub: string;
  value: number;
  history: number[];
  accent: "emerald" | "pink" | "amber";
}

const ACCENT = {
  emerald: {
    dot: "bg-emerald-400",
    ring: "shadow-[0_0_24px_-6px_rgba(16,185,129,0.6)]",
    stroke: "stroke-emerald-400/80",
    fill: "fill-emerald-400/10",
    text: "text-emerald-300",
  },
  pink: {
    dot: "bg-pink-400",
    ring: "shadow-[0_0_24px_-6px_rgba(236,72,153,0.55)]",
    stroke: "stroke-pink-400/80",
    fill: "fill-pink-400/10",
    text: "text-pink-300",
  },
  amber: {
    dot: "bg-amber-400",
    ring: "shadow-[0_0_24px_-6px_rgba(251,191,36,0.55)]",
    stroke: "stroke-amber-400/80",
    fill: "fill-amber-400/10",
    text: "text-amber-300",
  },
};

function Sparkline({ data, stroke, fill }: { data: number[]; stroke: string; fill: string }) {
  if (data.length < 2) {
    return <div className="h-16 w-full" />;
  }
  const W = 320;
  const H = 64;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = Math.max(1, max - min);
  const step = W / (data.length - 1);
  const pts = data.map((v, i) => {
    const x = i * step;
    const y = H - ((v - min) / range) * (H - 6) - 3;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const areaPath = `M0,${H} L${pts.join(" L")} L${W},${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-16 w-full">
      <path d={areaPath} className={fill} />
      <polyline
        points={pts.join(" ")}
        fill="none"
        strokeWidth={1.5}
        className={stroke}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function PushCounterCard({ label, sub, value, history, accent }: Props) {
  const a = ACCENT[accent];
  return (
    <div className={`rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.04] to-white/[0.01] p-5 ${a.ring}`}>
      <div className="flex items-center gap-2 mb-3">
        <span className="relative flex h-2 w-2">
          <span className={`absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping ${a.dot}`} />
          <span className={`relative inline-flex rounded-full h-2 w-2 ${a.dot}`} />
        </span>
        <span className="text-[11px] uppercase tracking-[0.2em] text-white/50 font-light">{label}</span>
      </div>
      <div className="flex items-baseline gap-2 mb-1">
        <CountUp
          value={Math.round(value)}
          duration={600}
          className={`text-5xl font-light tabular-nums ${a.text}`}
        />
        <span className="text-xs text-white/40 font-light">live</span>
      </div>
      <p className="text-xs text-white/40 font-light mb-4">{sub}</p>
      <Sparkline data={history} stroke={a.stroke} fill={a.fill} />
    </div>
  );
}

export default PushCounterCard;
