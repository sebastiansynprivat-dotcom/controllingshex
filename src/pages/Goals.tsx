import { useEffect, useState } from "react";
import { Target, Calendar } from "lucide-react";
import MonthlyGoals from "@/pages/MonthlyGoals";
import WeeklyGoals from "@/pages/WeeklyGoals";

type Tab = "month" | "week";
const STORAGE_KEY = "goals.tab";

export default function Goals() {
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === "undefined") return "month";
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "week" ? "week" : "month";
  });

  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, tab); } catch {}
  }, [tab]);

  return (
    <div className="min-h-full bg-background -m-3 sm:m-0">
      <div className="max-w-6xl mx-auto px-3 sm:px-6 pt-4 sm:pt-8">
        <div className="flex gap-1.5 border-b border-white/[0.06]">
          {([
            ["month", "Monatsziele", Target] as const,
            ["week", "Wochenziele", Calendar] as const,
          ]).map(([k, label, Icon]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`relative text-[13px] sm:text-sm px-4 py-2.5 font-light transition-colors flex items-center gap-2 ${
                tab === k ? "text-white" : "text-white/45 hover:text-white/75"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
              {tab === k && (
                <span className="absolute -bottom-px left-0 right-0 h-px bg-emerald-300/60" />
              )}
            </button>
          ))}
        </div>
      </div>
      {tab === "month" ? <MonthlyGoals /> : <WeeklyGoals />}
    </div>
  );
}
