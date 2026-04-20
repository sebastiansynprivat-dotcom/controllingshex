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
              "px-2.5 py-1 rounded-md text-[11px] font-medium transition-all border",
              isActive
                ? "bg-primary/15 border-primary/40 text-primary"
                : "bg-white/[0.03] border-white/[0.06] text-white/55 hover:text-white/80"
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
              "h-auto px-2.5 py-1 rounded-md text-[11px] font-medium border",
              value.preset === "custom"
                ? "bg-primary/15 border-primary/40 text-primary hover:bg-primary/20"
                : "bg-white/[0.03] border-white/[0.06] text-white/55 hover:text-white/80"
            )}
          >
            <CalendarIcon className="h-3 w-3 mr-1" />
            {customLabel}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
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
