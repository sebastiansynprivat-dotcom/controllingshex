/**
 * OnboardingList — Chatter ab Tag 5, gruppiert nach Onboarding-Tag.
 * Quick-Action: System-Label vergeben (exklusiv) → Chatter fällt aus der Liste.
 */
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sprout, ChevronRight, Tag } from "lucide-react";

import { cn } from "@/lib/utils";
import { MagneticHover } from "@/components/MagneticHover";
import { useDragScroll } from "@/hooks/use-drag-scroll";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import type { OnboardingGroup, OnboardingChatter } from "@/lib/onboarding-filter";
import {
  type ChatterLabel,
  isSystemLabel,
  setSystemLabelExclusive,
} from "@/lib/chatter-labels";

interface Props {
  groups: OnboardingGroup[];
  allLabels: ChatterLabel[];
  platform: string;
  onChatterClick: (name: string) => void;
  onAssigned: () => void;
}

export default function OnboardingList({
  groups,
  allLabels,
  platform,
  onChatterClick,
  onAssigned,
}: Props) {
  const [picker, setPicker] = useState<OnboardingChatter | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeDay, setActiveDay] = useState<number | null>(null);
  const { ref: chipScrollRef } = useDragScroll<HTMLDivElement>();

  const systemLabels = allLabels.filter(isSystemLabel);

  if (groups.length === 0) {
    return (
      <div className="premium-card rounded-2xl p-8 text-center">
        <div className="inline-flex items-center justify-center h-10 w-10 rounded-full bg-emerald-500/10 border border-emerald-500/25 mb-3">
          <Sprout className="h-4 w-4 text-emerald-300" />
        </div>
        <p className="text-[13px] text-foreground/70 font-light">
          Alle Onboarding-Chatter durchgearbeitet
        </p>
        <p className="text-[11px] text-white/30 font-light mt-1">
          Neue tauchen ab Tag 1 wieder hier auf.
        </p>
      </div>
    );
  }

  const totalAll = groups.reduce((sum, g) => sum + g.items.length, 0);
  const visibleGroups =
    activeDay === null ? groups : groups.filter((g) => g.day === activeDay);

  const handlePick = async (label: ChatterLabel) => {
    if (!picker || saving) return;
    setSaving(true);
    try {
      await setSystemLabelExclusive(platform, picker.chatterName, label.id, allLabels);
      setPicker(null);
      onAssigned();
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="space-y-6">
        <div
          ref={chipScrollRef}
          className="flex items-center gap-2 overflow-x-auto pb-1 -mx-0.5 px-0.5 scrollbar-none cursor-grab"
        >
          <button
            onClick={() => setActiveDay(null)}
            className={cn(
              "shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11px] font-medium transition-all",
              activeDay === null
                ? "bg-emerald-500/15 border-emerald-400/40 text-emerald-100"
                : "bg-white/[0.03] border-white/[0.08] text-white/55 hover:bg-white/[0.06] hover:text-white/80",
            )}
          >
            Alle
            <span className="tabular-nums opacity-60">{totalAll}</span>
          </button>
          {groups.map((g) => {
            const active = activeDay === g.day;
            return (
              <button
                key={g.day}
                onClick={() => setActiveDay(active ? null : g.day)}
                className={cn(
                  "shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11px] font-medium transition-all",
                  active
                    ? "bg-emerald-500/15 border-emerald-400/40 text-emerald-100"
                    : "bg-white/[0.03] border-white/[0.08] text-white/55 hover:bg-white/[0.06] hover:text-white/80",
                )}
              >
                Tag {g.day}
                <span className="tabular-nums opacity-60">{g.items.length}</span>
              </button>
            );
          })}
        </div>
        {visibleGroups.map((g) => (
          <div key={g.day} className="space-y-3">
            <div className="flex items-center gap-3 px-0.5">
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-500/[0.08] border border-emerald-400/15">
                <Sprout className="h-3 w-3 text-emerald-300" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-emerald-200/90">
                  Tag {g.day}
                </span>
              </div>
              <div className="flex-1 h-px bg-gradient-to-r from-white/[0.08] via-white/[0.04] to-transparent" />
              <span className="text-[10.5px] tabular-nums text-white/35 font-light">
                {g.items.length}
              </span>
            </div>
            <div className="space-y-2">
              {g.items.map((c) => (
                <motion.div
                  key={c.chatterKey}
                  layout
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 80 }}
                  transition={{ duration: 0.18 }}
                  className="group relative overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.035] to-white/[0.015] backdrop-blur-xl hover:border-white/[0.14] hover:from-white/[0.05] transition-all"
                >
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onChatterClick(c.chatterName)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onChatterClick(c.chatterName);
                      }
                    }}
                    className="w-full text-left px-4 py-3.5 flex items-center gap-3 cursor-pointer"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <MagneticHover as="span" range={18}>
                          <button
                            type="button"
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                await navigator.clipboard.writeText(c.chatterName);
                              } catch {}
                            }}
                            className="text-left -mx-1 px-1 rounded-md active:scale-[0.98] transition-transform"
                            aria-label={`${c.chatterName} kopieren`}
                            title="Klicken zum Kopieren"
                          >
                            <span className="text-[14px] font-medium text-foreground truncate tracking-[-0.005em]">
                              {c.chatterName}
                            </span>
                          </button>
                        </MagneticHover>
                      </div>
                      <ChatterKpiRow c={c} />
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setPicker(c);
                      }}
                      className="shrink-0 inline-flex items-center justify-center h-8 w-8 rounded-full bg-white/[0.04] border border-white/[0.08] text-white/60 hover:bg-white/[0.1] hover:text-white active:scale-95 transition-all"
                      aria-label="Label setzen"
                    >
                      <Tag className="h-3.5 w-3.5" />
                    </button>
                    <ChevronRight className="h-4 w-4 text-white/20 group-hover:text-white/45 group-hover:translate-x-0.5 transition-all" />
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <Sheet open={!!picker} onOpenChange={(o) => !o && setPicker(null)}>
        <SheetContent side="bottom" className="rounded-t-3xl border-white/[0.08]">
          <SheetHeader>
            <SheetTitle className="text-foreground/90 font-light">
              {picker?.chatterName}
            </SheetTitle>
            <SheetDescription className="text-white/40 text-[12px]">
              Wähle ein Label — der Chatter verschwindet danach aus dem Onboarding-Filter.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-2.5">
            {systemLabels.map((l) => (
              <button
                key={l.id}
                onClick={() => handlePick(l)}
                disabled={saving}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border transition-all text-left",
                  "bg-white/[0.03] hover:bg-white/[0.08]",
                  "disabled:opacity-40 disabled:cursor-wait",
                )}
                style={{
                  borderColor: `${l.color}40`,
                }}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: l.color }}
                />
                <MagneticHover as="span" range={16}>
                  <span className="text-[14px] font-medium text-foreground">
                    {l.label_name}
                  </span>
                </MagneticHover>
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function fmtEur(v: number): string {
  if (!v || v < 1) return "0 €";
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1).replace(".", ",")}k €`;
  return `${Math.round(v).toLocaleString("de-DE")} €`;
}

function fmtNum(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1).replace(".", ",")}k`;
  return Math.round(v).toLocaleString("de-DE");
}

function fmtSince(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  const days = Math.floor((today.getTime() - d.getTime()) / 86400000);
  if (days <= 0) return "heute";
  if (days === 1) return "1 Tag";
  if (days < 14) return `${days} Tagen`;
  if (days < 60) return `${Math.round(days / 7)} Wochen`;
  return `${Math.round(days / 30)} Monaten`;
}

function fmtOldestChat(days: number | null): string | null {
  if (days == null || days <= 0) return null;
  if (days < 1) {
    const h = Math.round(days * 24);
    return h <= 0 ? "<1 h" : `${h} h`;
  }
  if (days < 2) return `${days.toFixed(1).replace(".", ",")} Tagen`;
  return `${Math.round(days)} Tagen`;
}

function ChatterKpiRow({ c }: { c: OnboardingChatter }) {
  const since = fmtSince(c.chatterSinceOnAccount);
  const oldest = fmtOldestChat(c.liveOldestChatDays);
  return (
    <div className="mt-1.5 space-y-1.5">
      <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-white/55 font-light">
        <span className="truncate max-w-[180px]">
          {c.account ? (
            <>
              <span className="text-white/30">Account · </span>
              <span className="text-white/75">{c.account}</span>
            </>
          ) : (
            <span className="text-white/30">Kein Account zugewiesen</span>
          )}
        </span>
        {c.accountFollowers != null && c.accountFollowers > 0 && (
          <>
            <span className="text-white/15">·</span>
            <span className="tabular-nums">{fmtNum(c.accountFollowers)} Follower</span>
          </>
        )}
        {c.accountTotalRevenue > 0 && (
          <>
            <span className="text-white/15">·</span>
            <span className="tabular-nums text-white/65">{fmtEur(c.accountTotalRevenue)} Account-Total</span>
          </>
        )}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap text-[10.5px] tabular-nums">
        <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-400/20 text-emerald-200/90">
          {fmtEur(c.chatterRevenueOnAccount)}
        </span>
        {since && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.08] text-white/60">
            seit {since}
          </span>
        )}
        {c.liveOpenChats != null && c.liveOpenChats > 0 && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-amber-500/10 border border-amber-400/25 text-amber-200/90">
            {fmtNum(c.liveOpenChats)} offene Chats
          </span>
        )}
        {oldest && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-orange-500/10 border border-orange-400/25 text-orange-200/90">
            offen seit {oldest}
          </span>
        )}
        {c.avgMassDms > 0 && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-fuchsia-500/10 border border-fuchsia-400/20 text-fuchsia-200/85">
            ⌀ {Math.round(c.avgMassDms)} Mass-DMs
          </span>
        )}
      </div>
    </div>
  );
}
