import { useEffect, useMemo, useState } from "react";
import { Clock, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePlatform } from "@/contexts/PlatformContext";

interface HourlyRow {
  date: string; // YYYY-MM-DD (UTC)
  hour: number; // 0-23 (UTC)
  chatter_name: string;
  revenue: number;
  mass_dms: number;
  unread_delta: number;
}

const LOOKBACK_DAYS = 14;

/**
 * Konvertiert (UTC date + hour) → lokale Berlin-Stunde 0-23.
 */
function utcHourToBerlinHour(date: string, hour: number): number {
  const d = new Date(`${date}T${String(hour).padStart(2, "0")}:00:00Z`);
  // Intl gibt uns die Stunde in Berlin
  const berlin = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    hour12: false,
  }).format(d);
  const h = parseInt(berlin, 10);
  return isNaN(h) ? hour : h % 24;
}

export default function PeakHoursCard() {
  const { platform } = usePlatform();
  const [rows, setRows] = useState<HourlyRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) {
        setRows([]);
        setLoading(false);
        return;
      }
      const since = new Date();
      since.setDate(since.getDate() - LOOKBACK_DAYS);
      const sinceIso = since.toISOString().slice(0, 10);
      const { data } = await supabase
        .from("chatter_hourly_stats")
        .select("date, hour, chatter_name, revenue, mass_dms, unread_delta")
        .eq("user_id", uid)
        .eq("platform", platform)
        .gte("date", sinceIso);
      if (!cancelled) {
        setRows((data ?? []) as HourlyRow[]);
        setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = false;
    };
  }, [platform]);

  const { perHour, daysObserved, totalActivity, peakHour, nowHour } = useMemo(() => {
    // Pro lokaler Stunde: Set von "date|chatter" mit Aktivität sammeln,
    // damit wir Ø Chatter pro Stunde berechnen können.
    const buckets = new Map<number, Map<string, Set<string>>>(); // hour → date → chatterSet
    const dateSet = new Set<string>();
    let total = 0;

    for (const r of rows) {
      const active =
        (Number(r.revenue) || 0) > 0 ||
        (Number(r.mass_dms) || 0) > 0 ||
        (Number(r.unread_delta) || 0) < 0;
      if (!active) continue;
      total++;
      const localHour = utcHourToBerlinHour(r.date, r.hour);
      dateSet.add(r.date);
      if (!buckets.has(localHour)) buckets.set(localHour, new Map());
      const dayMap = buckets.get(localHour)!;
      if (!dayMap.has(r.date)) dayMap.set(r.date, new Set());
      dayMap.get(r.date)!.add((r.chatter_name ?? "").toLowerCase().trim());
    }

    const days = Math.max(1, dateSet.size);
    const perHour: { hour: number; avg: number; max: number }[] = [];
    for (let h = 0; h < 24; h++) {
      const dayMap = buckets.get(h);
      if (!dayMap) {
        perHour.push({ hour: h, avg: 0, max: 0 });
        continue;
      }
      let sum = 0;
      let max = 0;
      dayMap.forEach((set) => {
        sum += set.size;
        if (set.size > max) max = set.size;
      });
      perHour.push({ hour: h, avg: sum / days, max });
    }

    const peak = perHour.reduce((p, c) => (c.avg > p.avg ? c : p), perHour[0]);
    const nowH = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Berlin",
      hour: "2-digit",
      hour12: false,
    }).format(new Date());
    return {
      perHour,
      daysObserved: dateSet.size,
      totalActivity: total,
      peakHour: peak,
      nowHour: parseInt(nowH, 10) % 24,
    };
  }, [rows]);

  const maxBar = Math.max(1, ...perHour.map((p) => p.avg));

  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/[0.06] bg-gradient-to-br from-white/[0.03] via-white/[0.01] to-transparent p-5 shadow-[0_20px_60px_-30px_hsl(220_50%_40%/0.2),inset_0_1px_0_hsl(0_0%_100%/0.05)]">
      <div className="pointer-events-none absolute -top-20 -right-20 h-48 w-48 rounded-full bg-[hsl(220_60%_60%/0.08)] blur-3xl" />

      <div className="relative">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-white/45" />
            <span className="text-[10px] tracking-[0.28em] uppercase text-white/45 font-light">
              Peak-Chatter
            </span>
          </div>
          <span className="text-[10px] text-white/30 font-light tabular-nums">
            {daysObserved === 0
              ? "noch keine Daten"
              : `${daysObserved} Tag${daysObserved === 1 ? "" : "e"} · ${LOOKBACK_DAYS} d Fenster`}
          </span>
        </div>

        {loading ? (
          <p className="mt-6 text-center text-xs text-white/30 font-light">Lade Aktivitätsmuster…</p>
        ) : totalActivity === 0 ? (
          <div className="mt-6 flex flex-col items-center gap-2 py-6 text-center">
            <Sparkles className="h-4 w-4 text-white/20" />
            <p className="text-xs text-white/40 font-light max-w-[280px]">
              Noch keine Aktivität erfasst. Sobald deine Chatter heute ihre ersten Updates senden,
              entsteht hier dein persönliches Stunden-Profil.
            </p>
          </div>
        ) : (
          <>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="font-extralight tabular-nums text-[40px] leading-none text-white/95"
                style={{ letterSpacing: "-0.04em" }}>
                {String(peakHour.hour).padStart(2, "0")}
                <span className="text-white/30">:00</span>
              </span>
              <span className="text-[11px] text-white/45 font-light">
                Ø {peakHour.avg.toFixed(1)} Chatter aktiv
              </span>
            </div>

            {/* Heatmap-Bars 24h */}
            <div className="mt-5">
              <div className="flex items-end gap-[3px] h-20">
                {perHour.map((p) => {
                  const pct = (p.avg / maxBar) * 100;
                  const isPeak = p.hour === peakHour.hour;
                  const isNow = p.hour === nowHour;
                  return (
                    <div key={p.hour} className="group relative flex-1 h-full flex items-end">
                      <div
                        className={`w-full rounded-t-[2px] transition-all ${
                          isPeak
                            ? "bg-gradient-to-t from-emerald-400/80 to-emerald-200/90"
                            : isNow
                            ? "bg-gradient-to-t from-amber-400/70 to-amber-200/90"
                            : "bg-gradient-to-t from-white/[0.18] to-white/[0.32]"
                        }`}
                        style={{ height: `${Math.max(p.avg > 0 ? 6 : 2, pct)}%` }}
                        title={`${String(p.hour).padStart(2, "0")}:00 · Ø ${p.avg.toFixed(1)} Chatter (max ${p.max})`}
                      />
                      <div className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-background/95 border border-white/10 rounded px-1.5 py-0.5 text-[9px] text-white/80 whitespace-nowrap font-light tabular-nums z-10">
                        {String(p.hour).padStart(2, "0")}h · Ø {p.avg.toFixed(1)}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 flex justify-between text-[8px] uppercase tracking-[0.18em] text-white/25 font-light">
                <span>00</span>
                <span>06</span>
                <span>12</span>
                <span>18</span>
                <span>23</span>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-4 text-[9.5px] text-white/35 font-light">
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-300/80" /> Peak
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-300/80" /> Jetzt ({String(nowHour).padStart(2, "0")}h)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-white/30" /> Stunde
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
