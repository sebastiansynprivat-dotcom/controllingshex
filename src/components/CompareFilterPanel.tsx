import { useMemo } from "react";
import { ACCOUNT_TIERS, type AccountTierId } from "@/lib/account-tiers";
import { ACTION_CATEGORIES, type ActionCategoryName } from "@/lib/action-categories";
import type { CompareFilter } from "@/lib/compare-filters";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { X } from "lucide-react";

interface Props {
  label: string;
  accent: "emerald" | "sky";
  filter: CompareFilter;
  onChange: (next: CompareFilter) => void;
  allLabels: Array<{ id: string; label_name: string; color: string }>;
}

export default function CompareFilterPanel({ label, accent, filter, onChange, allLabels }: Props) {
  const accentRing =
    accent === "emerald"
      ? "ring-emerald-400/40 border-emerald-400/30"
      : "ring-sky-400/40 border-sky-400/30";
  const accentDot = accent === "emerald" ? "bg-emerald-400" : "bg-sky-400";

  const update = (patch: Partial<CompareFilter>) => onChange({ ...filter, ...patch });

  const toggleArr = <T extends string>(arr: T[], v: T): T[] =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  const activeCount = useMemo(() => {
    let n = 0;
    if (filter.tiers.length) n++;
    if (filter.categories.length) n++;
    if (filter.labelIds.length) n++;
    if (filter.revToday) n++;
    if (filter.revAvg) n++;
    if (filter.delayMax != null) n++;
    if (filter.status !== "any") n++;
    if (filter.alerts !== "any") n++;
    return n;
  }, [filter]);

  return (
    <div className={cn("rounded-xl border bg-white/[0.02] p-3 space-y-3", accentRing)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={cn("inline-block h-2 w-2 rounded-full", accentDot)} />
          <span className="text-xs font-semibold tracking-wide text-foreground/90">{label}</span>
          {activeCount > 0 && (
            <span className="text-[10px] text-muted-foreground">({activeCount} aktiv)</span>
          )}
        </div>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={() =>
              onChange({
                tiers: [],
                categories: [],
                labelIds: [],
                revToday: null,
                revAvg: null,
                delayMax: null,
                status: "any",
                alerts: "any",
              })
            }
            className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            <X className="h-3 w-3" /> Reset
          </button>
        )}
      </div>

      {/* Tiers */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Tier</div>
        <div className="flex flex-wrap gap-1">
          {ACCOUNT_TIERS.map((t) => {
            const on = filter.tiers.includes(t.id);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => update({ tiers: toggleArr(filter.tiers as AccountTierId[], t.id) })}
                className={cn(
                  "px-2 py-0.5 rounded-md text-[10px] border transition-all",
                  on
                    ? "bg-primary/15 border-primary/40 text-primary"
                    : "bg-white/[0.03] border-white/[0.06] text-white/55 hover:text-white/80"
                )}
              >
                {t.emoji} {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Categories */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Kategorie</div>
        <div className="flex flex-wrap gap-1">
          {ACTION_CATEGORIES.filter((c) => !c.name.startsWith("ONBOARDING")).map((c) => {
            const on = filter.categories.includes(c.name);
            return (
              <button
                key={c.name}
                type="button"
                onClick={() =>
                  update({ categories: toggleArr(filter.categories as ActionCategoryName[], c.name) })
                }
                className={cn(
                  "px-2 py-0.5 rounded-md text-[10px] border transition-all",
                  on
                    ? "bg-primary/15 border-primary/40 text-primary"
                    : "bg-white/[0.03] border-white/[0.06] text-white/55 hover:text-white/80"
                )}
                title={c.description}
              >
                {c.emoji}
              </button>
            );
          })}
        </div>
      </div>

      {/* Status + Alerts */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Status</div>
          <div className="flex flex-wrap gap-1">
            {(["any", "active", "inactive", "onboarding"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => update({ status: s })}
                className={cn(
                  "px-2 py-0.5 rounded-md text-[10px] border transition-all",
                  filter.status === s
                    ? "bg-primary/15 border-primary/40 text-primary"
                    : "bg-white/[0.03] border-white/[0.06] text-white/55"
                )}
              >
                {s === "any" ? "Alle" : s === "active" ? "Aktiv" : s === "inactive" ? "Inaktiv" : "Onboard"}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Alert</div>
          <div className="flex flex-wrap gap-1">
            {(["any", "with", "without"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => update({ alerts: s })}
                className={cn(
                  "px-2 py-0.5 rounded-md text-[10px] border transition-all",
                  filter.alerts === s
                    ? "bg-primary/15 border-primary/40 text-primary"
                    : "bg-white/[0.03] border-white/[0.06] text-white/55"
                )}
              >
                {s === "any" ? "Alle" : s === "with" ? "Mit" : "Ohne"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Revenue ranges */}
      <div className="grid grid-cols-2 gap-2">
        <RangeInput
          label="€ heute"
          value={filter.revToday}
          onChange={(v) => update({ revToday: v })}
        />
        <RangeInput
          label="Ø € Fenster"
          value={filter.revAvg}
          onChange={(v) => update({ revAvg: v })}
        />
      </div>

      {/* Delay max */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
          Max Response-Delay (Tage)
        </div>
        <Input
          type="number"
          min={0}
          max={30}
          placeholder="–"
          value={filter.delayMax ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            update({ delayMax: v === "" ? null : Math.max(0, Math.min(30, Number(v))) });
          }}
          className="h-7 text-xs"
        />
      </div>

      {/* Labels */}
      {allLabels.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Labels</div>
          <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
            {allLabels.map((l) => {
              const on = filter.labelIds.includes(l.id);
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => update({ labelIds: toggleArr(filter.labelIds, l.id) })}
                  className={cn(
                    "px-2 py-0.5 rounded-md text-[10px] border transition-all",
                    on ? "border-primary/40 text-primary" : "border-white/[0.06] text-white/55 hover:text-white/80"
                  )}
                  style={on ? { backgroundColor: l.color + "22" } : undefined}
                >
                  {l.label_name}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function RangeInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: [number, number] | null;
  onChange: (v: [number, number] | null) => void;
}) {
  const [lo, hi] = value ?? [0, 0];
  const set = (idx: 0 | 1, raw: string) => {
    if (raw === "" && (idx === 0 ? hi === 0 : lo === 0) && !value) {
      onChange(null);
      return;
    }
    const n = Number(raw) || 0;
    const curLo = value?.[0] ?? 0;
    const curHi = value?.[1] ?? n;
    const next: [number, number] = idx === 0 ? [n, curHi] : [curLo, n];
    onChange(next);
  };
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            ×
          </button>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Input
          type="number"
          min={0}
          placeholder="Min"
          value={value ? lo : ""}
          onChange={(e) => set(0, e.target.value)}
          className="h-7 text-xs px-2"
        />
        <span className="text-muted-foreground text-xs">–</span>
        <Input
          type="number"
          min={0}
          placeholder="Max"
          value={value ? hi : ""}
          onChange={(e) => set(1, e.target.value)}
          className="h-7 text-xs px-2"
        />
      </div>
    </div>
  );
}
