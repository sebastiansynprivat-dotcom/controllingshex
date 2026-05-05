import { useEffect, useMemo, useState } from "react";
import { Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  chatterName: string;
  platform: string;
  compact?: boolean;
}

interface Row {
  date: string;
  hour: number;
  revenue: number;
  mass_dms: number;
  unread_delta: number;
}

const LOOKBACK_DAYS = 14;

function utcHourToBerlinHour(date: string, hour: number): number {
  const d = new Date(`${date}T${String(hour).padStart(2, "0")}:00:00Z`);
  const berlin = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    hour12: false,
  }).format(d);
  const h = parseInt(berlin, 10);
  return isNaN(h) ? hour : h % 24;
}

export default function ChatterActivityHoursCard({ chatterName, platform, compact = false }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!chatterName) return;
    let cancelled = false;
    (async () => {
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
        .select("date, hour, revenue, mass_dms, unread_delta")
        .eq("user_id", uid)
        .ilike("platform", platform)
        .ilike("chatter_name", chatterName.trim())
        .gte("date", sinceIso);
      if (!cancelled) {
        setRows((data ?? []) as Row[]);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chatterName, platform]);

  const { perHour, avgHoursPerDay, daysObserved, peakHour, totalActiveHours, topRange } = useMemo(() => {
    // Pro Tag: Set aktiver lokaler Stunden
    const dayHours = new Map<string, Set<number>>();
    const hourCount = new Array(24).fill(0); // wie oft war diese Stunde aktiv (über alle Tage)

    for (const r of rows) {
      const active =
        (Number(r.revenue) || 0) > 0 ||
        (Number(r.mass_dms) || 0) > 0 ||
        (Number(r.unread_delta) || 0) < 0;
      if (!active) continue;
      const h = utcHourToBerlinHour(r.date, r.hour);
      if (!dayHours.has(r.date)) dayHours.set(r.date, new Set());
      dayHours.get(r.date)!.add(h);
    }
    dayHours.forEach((set) => set.forEach((h) => (hourCount[h] += 1)));

    const days = dayHours.size;
    const totalHours = Array.from(dayHours.values()).reduce((s, set) => s + set.size, 0);
    const avgPerDay = days > 0 ? totalHours / days : 0;
    const perHour = hourCount.map((c, h) => ({
      hour: h,
      freq: days > 0 ? c / days : 0, // 0..1 = an wie viel % der Tage war diese Stunde aktiv
    }));
    const peak = perHour.reduce((p, c) => (c.freq > p.freq ? c : p), perHour[0]);

    // Größte zusammenhängende Spanne typischer Aktivität (freq >= 0.4)
    const THRESHOLD = 0.4;
    let bestStart = -1,
      bestLen = 0,
      curStart = -1,
      curLen = 0;
    for (let i = 0; i < 48; i++) {
      const h = i % 24;
      if (perHour[h].freq >= THRESHOLD) {
        if (curStart === -1) curStart = h;
        curLen++;
        if (curLen > bestLen) {
          bestLen = curLen;
          bestStart = curStart;
        }
      } else {
        curStart = -1;
        curLen = 0;
      }
      if (bestLen >= 24) break;
    }
    const range =
      bestLen > 0 && bestLen < 24
        ? { start: bestStart, end: (bestStart + bestLen) % 24, len: bestLen }
        : null;

    return {
      perHour,
      avgHoursPerDay: avgPerDay,
      daysObserved: days,
      peakHour: peak,
      totalActiveHours: totalHours,
      topRange: range,
    };
  }, [rows]);

  if (loading) {
    return (
      <div className="premium-card rounded-2xl p-5">
        <p className="text-[10px] uppercase tracking-[0.2em] text-white/35 font-medium">Online-Zeiten</p>
        <p className="mt-3 text-xs text-white/30 font-light">Lade Aktivitätsmuster…</p>
      </div>
    );
  }

  const noData = totalActiveHours === 0;
  const maxBar = Math.max(0.0001, ...perHour.map((p) => p.freq));
  const pad = compact ? "p-4" : "p-5";

  return (
    <div className={`premium-card rounded-2xl ${pad} relative overflow-hidden`}>
      <div className="pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full bg-[hsl(220_60%_60%/0.06)] blur-3xl" />
      <div className="relative">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-white/40" />
            <p className="text-[10px] uppercase tracking-[0.2em] gold-text-subtle font-medium">
              Online-Zeiten
            </p>
          </div>
          <span className="text-[10px] text-white/30 font-light tabular-nums">
            {daysObserved === 0
              ? "noch keine Daten"
              : `${daysObserved} Tag${daysObserved === 1 ? "" : "e"} · ${LOOKBACK_DAYS} d`}
          </span>
        </div>

        {noData ? (
          <p className="text-xs text-white/40 font-light leading-relaxed">
            Noch kein Stunden-Profil vorhanden. Sobald Aktivität in den Live-Reports auftaucht,
            entsteht hier automatisch ein Muster.
          </p>
        ) : (
          <>
            <div className="flex items-baseline gap-3">
              <span
                className="font-extralight tabular-nums text-[34px] leading-none text-white/95"
                style={{ letterSpacing: "-0.04em" }}
              >
                Ø {avgHoursPerDay.toFixed(1)}
                <span className="text-white/35 text-base ml-1">h/Tag</span>
              </span>
              {topRange && (
                <span className="text-[11px] text-white/50 font-light">
                  meist{" "}
                  <span className="text-white/80 tabular-nums">
                    {String(topRange.start).padStart(2, "0")}–{String(topRange.end).padStart(2, "0")}h
                  </span>
                </span>
              )}
            </div>

            {/* Heatmap 24h: Häufigkeit (an wie viel % der Tage aktiv) */}
            <div className="mt-4">
              <div className="flex items-end gap-[2px] h-16">
                {perHour.map((p) => {
                  const pct = (p.freq / maxBar) * 100;
                  const isPeak = p.hour === peakHour.hour && p.freq > 0;
                  const inRange =
                    topRange &&
                    (topRange.start <= topRange.end
                      ? p.hour >= topRange.start && p.hour < topRange.end
                      : p.hour >= topRange.start || p.hour < topRange.end);
                  return (
                    <div key={p.hour} className="group relative flex-1 h-full flex items-end">
                      <div
                        className={`w-full rounded-t-[2px] transition-all ${
                          isPeak
                            ? "bg-gradient-to-t from-emerald-400/80 to-emerald-200/90"
                            : inRange
                            ? "bg-gradient-to-t from-white/[0.22] to-white/[0.40]"
                            : "bg-gradient-to-t from-white/[0.08] to-white/[0.18]"
                        }`}
                        style={{ height: `${Math.max(p.freq > 0 ? 5 : 2, pct)}%` }}
                        title={`${String(p.hour).padStart(2, "0")}:00 · an ${(p.freq * 100).toFixed(0)}% der Tage aktiv`}
                      />
                      <div className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-background/95 border border-white/10 rounded px-1.5 py-0.5 text-[9px] text-white/80 whitespace-nowrap font-light tabular-nums z-10">
                        {String(p.hour).padStart(2, "0")}h · {(p.freq * 100).toFixed(0)}%
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-1.5 flex justify-between text-[8px] uppercase tracking-[0.18em] text-white/25 font-light">
                <span>00</span>
                <span>06</span>
                <span>12</span>
                <span>18</span>
                <span>23</span>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-4 text-[9.5px] text-white/35 font-light">
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-300/80" /> Peak{" "}
                <span className="tabular-nums text-white/55">
                  {String(peakHour.hour).padStart(2, "0")}h
                </span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-white/40" /> Typisch (≥ 40 % der Tage)
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
