import { useState } from "react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { buildTimeRange, type TimeRange, type TimeRangePreset } from "@/lib/timerange-categorize";

interface Props {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
}

const PRESETS: { id: TimeRangePreset; label: string }[] = [
  { id: "today", label: "Heute" },
  { id: "yesterday", label: "Gestern" },
  { id: "7d", label: "7T" },
  { id: "14d", label: "14T" },
  { id: "30d", label: "30T" },
  { id: "90d", label: "90T" },
];

export default function TimeRangeToggle({ value, onChange }: Props) {
  const [customOpen, setCustomOpen] = useState(false);

  const handlePreset = (id: TimeRangePreset) => {
    onChange(buildTimeRange(id));
  };

  const handleCustomSelect = (range: { from?: Date; to?: Date } | undefined) => {
    if (!range?.from) return;
    const fromIso = format(range.from, "yyyy-MM-dd");
    const toIso = range.to ? format(range.to, "yyyy-MM-dd") : fromIso;
    onChange(buildTimeRange("custom", fromIso, toIso));
    if (range.from && range.to) setCustomOpen(false);
  };

  const customDateRange = value.preset === "custom"
    ? { from: new Date(value.from + "T00:00:00"), to: new Date(value.to + "T00:00:00") }
    : undefined;

  const customLabel = value.preset === "custom"
    ? `${format(new Date(value.from + "T00:00:00"), "d.M.")}–${format(new Date(value.to + "T00:00:00"), "d.M.")}`
    : "Custom";

  return (
    <div className="flex gap-1 flex-wrap items-center">
      {PRESETS.map((p) => {
        const isActive = value.preset === p.id;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => handlePreset(p.id)}
            className={cn(
              "px-2.5 py-1 rounded-md text-[11px] font-light tracking-wide transition-all border backdrop-blur-sm",
              isActive
                ? "bg-gradient-to-b from-yellow-400/[0.14] to-yellow-500/[0.06] border-yellow-400/35 text-yellow-200 shadow-[0_0_0_1px_rgba(212,175,55,0.08),0_4px_14px_-6px_rgba(212,175,55,0.35)]"
                : "bg-white/[0.025] border-white/[0.07] text-white/55 hover:text-foreground/85 hover:bg-white/[0.045] hover:border-white/[0.12]"
            )}
          >
            {p.label}
          </button>
        );
      })}
      <Popover open={customOpen} onOpenChange={setCustomOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-auto px-2.5 py-1 rounded-md text-[11px] font-light tracking-wide border backdrop-blur-sm transition-all",
              value.preset === "custom"
                ? "bg-gradient-to-b from-yellow-400/[0.14] to-yellow-500/[0.06] border-yellow-400/35 text-yellow-200 hover:bg-yellow-400/[0.18] shadow-[0_0_0_1px_rgba(212,175,55,0.08),0_4px_14px_-6px_rgba(212,175,55,0.35)]"
                : "bg-white/[0.025] border-white/[0.07] text-white/55 hover:text-foreground/85 hover:bg-white/[0.045] hover:border-white/[0.12]"
            )}
          >
            <CalendarIcon className="h-3 w-3 mr-1 opacity-70" />
            {customLabel}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-auto p-0 premium-card border-white/[0.08] bg-black/95 backdrop-blur-xl rounded-xl shadow-[0_20px_60px_-12px_rgba(0,0,0,0.6)]"
          align="start"
        >
          <Calendar
            mode="range"
            selected={customDateRange as any}
            onSelect={handleCustomSelect as any}
            numberOfMonths={1}
            initialFocus
            className={cn("p-3 pointer-events-auto")}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
