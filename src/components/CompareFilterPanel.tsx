import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ACCOUNT_TIERS, type AccountTierId } from "@/lib/account-tiers";
import { ACTION_CATEGORIES, type ActionCategoryName } from "@/lib/action-categories";
import { type CompareFilter, type ComparePreset, EMPTY_FILTER } from "@/lib/compare-filters";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ChevronDown, X, SlidersHorizontal } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";

interface Props {
  label: string;
  accent: "emerald" | "sky";
  filter: CompareFilter;
  onChange: (next: CompareFilter) => void;
  allLabels: Array<{ id: string; label_name: string; color: string }>;
  presets?: ComparePreset[];
  onApplyPreset?: (preset: ComparePreset, side: "A" | "B") => void;
  side?: "A" | "B";
}

export default function CompareFilterPanel({ label, accent, filter, onChange, allLabels, presets, onApplyPreset, side }: Props) {
  const isMobile = useIsMobile();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

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
    if (filter.tenureDays) n++;
    if (filter.status !== "any") n++;
    if (filter.alerts !== "any") n++;
    return n;
  }, [filter]);

  // Active pills summary for mobile chip header
  const activePills = useMemo(() => {
    const pills: string[] = [];
    filter.tiers.forEach((t) => {
      const tier = ACCOUNT_TIERS.find((x) => x.id === t);
      if (tier) pills.push(`${tier.emoji}`);
    });
    filter.categories.forEach((c) => {
      const cat = ACTION_CATEGORIES.find((x) => x.name === c);
      if (cat) pills.push(`${cat.emoji}`);
    });
    if (filter.status !== "any") pills.push(filter.status === "active" ? "Aktiv" : filter.status === "inactive" ? "Inaktiv" : "Onb.");
    if (filter.alerts !== "any") pills.push(filter.alerts === "with" ? "🔔" : "🔕");
    if (filter.delayMax != null) pills.push(`≤${filter.delayMax}d`);
    if (filter.tenureDays) {
      const [lo, hi] = filter.tenureDays;
      pills.push(`📅${lo}–${hi}d`);
    }
    if (filter.revToday) pills.push("€h");
    if (filter.revAvg) pills.push("Ø€");
    if (filter.labelIds.length) pills.push(`${filter.labelIds.length}🏷`);
    return pills;
  }, [filter]);

  // The full filter UI body (reused inline on desktop / inside sheet on mobile)
  const FilterBody = (
    <div className="space-y-3">
      {/* Presets — quick-apply for this side */}
      {presets && presets.length > 0 && side && onApplyPreset && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Presets</div>
          <div className="flex flex-wrap gap-1">
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onApplyPreset(p, side)}
                className="px-2 min-h-7 rounded-md text-[11px] border bg-white/[0.03] border-white/[0.06] text-white/65 hover:text-foreground hover:border-white/15 transition-all"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

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
                  "px-2 min-h-7 rounded-md text-[11px] border transition-all",
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
                  "px-2 min-h-7 rounded-md text-[11px] border transition-all",
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
                  "px-2 min-h-7 rounded-md text-[11px] border transition-all",
                  filter.status === s
                    ? "bg-primary/15 border-primary/40 text-primary"
                    : "bg-white/[0.03] border-white/[0.06] text-white/55"
                )}
              >
                {s === "any" ? "Alle" : s === "active" ? "Aktiv" : s === "inactive" ? "Inaktiv" : "Onb."}
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
                  "px-2 min-h-7 rounded-md text-[11px] border transition-all",
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
        <RangeInput label="€ heute" value={filter.revToday} onChange={(v) => update({ revToday: v })} />
        <RangeInput label="Ø € Fenster" value={filter.revAvg} onChange={(v) => update({ revAvg: v })} />
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
          className="h-8 text-xs"
        />
      </div>

      {/* Tenure: Aktiv seit (Tage) */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Aktiv seit (Tage)</span>
          {filter.tenureDays && (
            <button
              type="button"
              onClick={() => update({ tenureDays: null })}
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
            max={3650}
            placeholder="Min"
            value={filter.tenureDays ? filter.tenureDays[0] : ""}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "" && (!filter.tenureDays || filter.tenureDays[1] === 0)) {
                update({ tenureDays: null });
                return;
              }
              const n = Math.max(0, Math.min(3650, Number(raw) || 0));
              const hi = filter.tenureDays?.[1] ?? Math.max(n, 365);
              update({ tenureDays: [n, hi] });
            }}
            className="h-8 text-xs px-2"
          />
          <span className="text-muted-foreground text-xs">–</span>
          <Input
            type="number"
            min={0}
            max={3650}
            placeholder="Max"
            value={filter.tenureDays ? filter.tenureDays[1] : ""}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "" && (!filter.tenureDays || filter.tenureDays[0] === 0)) {
                update({ tenureDays: null });
                return;
              }
              const n = Math.max(0, Math.min(3650, Number(raw) || 0));
              const lo = filter.tenureDays?.[0] ?? 0;
              update({ tenureDays: [lo, n] });
            }}
            className="h-8 text-xs px-2"
          />
        </div>
        {/* Quick presets */}
        <div className="flex flex-wrap gap-1 mt-1.5">
          {[
            { label: "<7d", range: [0, 6] as [number, number] },
            { label: "7–30d", range: [7, 30] as [number, number] },
            { label: "1–3M", range: [31, 90] as [number, number] },
            { label: "3M+", range: [91, 3650] as [number, number] },
          ].map((p) => {
            const on =
              filter.tenureDays?.[0] === p.range[0] && filter.tenureDays?.[1] === p.range[1];
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => update({ tenureDays: on ? null : p.range })}
                className={cn(
                  "px-1.5 min-h-6 rounded text-[10px] border transition-all",
                  on
                    ? "bg-primary/15 border-primary/40 text-primary"
                    : "bg-white/[0.03] border-white/[0.06] text-white/55 hover:text-white/80"
                )}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {allLabels.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Labels</div>
          <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
            {allLabels.map((l) => {
              const on = filter.labelIds.includes(l.id);
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => update({ labelIds: toggleArr(filter.labelIds, l.id) })}
                  className={cn(
                    "px-2 min-h-7 rounded-md text-[11px] border transition-all",
                    on
                      ? "border-primary/40 text-primary"
                      : "border-white/[0.06] text-white/55 hover:text-white/80"
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

  // ─── MOBILE: compact chip header + bottom-sheet ──────────────────────────
  if (isMobile) {
    return (
      <>
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className={cn(
            "w-full text-left rounded-xl border bg-white/[0.02] p-2 space-y-1.5 transition-all active:bg-white/[0.04]",
            accentRing
          )}
        >
          <div className="flex items-center justify-between gap-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className={cn("inline-block h-2 w-2 rounded-full shrink-0", accentDot)} />
              <span className="text-[11px] font-semibold tracking-wide text-foreground/90 truncate">
                {label}
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {activeCount > 0 ? (
                <span className="text-[10px] text-primary tabular-nums">{activeCount}</span>
              ) : (
                <SlidersHorizontal className="h-3 w-3 text-muted-foreground" />
              )}
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </div>
          </div>
          {activePills.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {activePills.slice(0, 3).map((p, i) => (
                <span
                  key={i}
                  className="px-1.5 py-0.5 rounded text-[10px] bg-primary/10 text-primary border border-primary/20"
                >
                  {p}
                </span>
              ))}
              {activePills.length > 3 && (
                <span className="text-[10px] text-muted-foreground">+{activePills.length - 3}</span>
              )}
            </div>
          ) : (
            <div className="text-[10px] text-muted-foreground">Filter setzen…</div>
          )}
        </button>

        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent
            side="bottom"
            className="max-h-[85vh] overflow-y-auto rounded-t-2xl"
          >
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <span className={cn("inline-block h-2 w-2 rounded-full", accentDot)} />
                {label}
                {activeCount > 0 && (
                  <button
                    type="button"
                    onClick={() => onChange(EMPTY_FILTER)}
                    className="ml-auto text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                  >
                    <X className="h-3 w-3" /> Reset
                  </button>
                )}
              </SheetTitle>
            </SheetHeader>
            <div className="mt-4">{FilterBody}</div>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  // ─── DESKTOP: kompakter Chip-Header + Inline-Akkordeon ──────────────────
  return (
    <div
      className={cn(
        "rounded-xl border bg-white/[0.02] transition-colors",
        accentRing,
        expanded && "bg-white/[0.04]"
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left p-2.5 flex items-center justify-between gap-2 group"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className={cn("inline-block h-2 w-2 rounded-full shrink-0", accentDot)} />
          <span className="text-xs font-semibold tracking-wide text-foreground/90 shrink-0">{label}</span>
          {activePills.length > 0 ? (
            <div className="flex items-center gap-1 min-w-0 overflow-hidden">
              {activePills.slice(0, 5).map((p, i) => (
                <span
                  key={i}
                  className="px-1.5 py-0.5 rounded text-[10px] bg-primary/10 text-primary border border-primary/20 shrink-0"
                >
                  {p}
                </span>
              ))}
              {activePills.length > 5 && (
                <span className="text-[10px] text-muted-foreground shrink-0">+{activePills.length - 5}</span>
              )}
            </div>
          ) : (
            <span className="text-[11px] text-muted-foreground truncate">Filter setzen…</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {activeCount > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange(EMPTY_FILTER);
              }}
              className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 px-1 py-0.5 rounded hover:bg-white/[0.05]"
            >
              <X className="h-3 w-3" />
            </button>
          )}
          {activeCount === 0 && <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />}
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 text-muted-foreground transition-transform",
              expanded && "rotate-180"
            )}
          />
        </div>
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-1 border-t border-white/[0.05]">{FilterBody}</div>
          </motion.div>
        )}
      </AnimatePresence>
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
          className="h-8 text-xs px-2"
        />
        <span className="text-muted-foreground text-xs">–</span>
        <Input
          type="number"
          min={0}
          placeholder="Max"
          value={value ? hi : ""}
          onChange={(e) => set(1, e.target.value)}
          className="h-8 text-xs px-2"
        />
      </div>
    </div>
  );
}
