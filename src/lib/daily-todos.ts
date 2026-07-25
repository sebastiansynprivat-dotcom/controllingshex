/**
 * Smart Daily To-Dos
 *
 * Generiert eine priorisierte Tagesaufgaben-Liste aus heutigem Report + 14T Historie.
 * Reine Client-Side Aggregation, deterministisch, transparent.
 */

import { supabase } from "@/integrations/supabase/client";
import { detectModelTroubles } from "@/lib/model-tracking";
import { loadActiveChatterNames, normalizeChatterName } from "@/lib/active-chatters";
import { findTalentMatches, findOrphanedAccounts } from "@/lib/talent-scout";
import { loadActiveRejections } from "@/lib/talent-rejections";
import { fetchAllPaged } from "@/lib/paged";

export type TodoCategory = "verzug" | "activity" | "revenue" | "model" | "positive" | "talent";

/** Mindest-Verzug in Tagen, ab dem ein Chatter als "im Verzug" gilt. */
export const MIN_VERZUG_DAYS = 3;


export interface DailyTodo {
  /** Stabiler Schlüssel inkl. Datum, z.B. "verzug:Sarah:2026-05-03" */
  key: string;
  category: TodoCategory;
  /** Score 0-100+, höher = wichtiger */
  score: number;
  title: string;
  why: string;
  chatterName?: string | null;
  modelName?: string | null;
  /** Optional: zweiter Chatter für direkten Vergleich (Talent-Match → Wechselmodus) */
  compareWith?: string | null;
  /** Strukturierte Zahlen für realistische €-Hebel-Berechnung im today-engine. */
  meta?: {
    delayDays?: number;
    dropPct?: number;
    todayRevenue?: number;
    baselineRevenue?: number;
    todayMassDms?: number;
    baselineMassDms?: number;
    missingMassDms?: number;
    todayOpenChats?: number;
    baselineOpenChats?: number;
    missingDays?: number;
    riserMedianRev?: number;
    matchScore?: number;
    modelDropPerDay?: number;
    rejectAccountRiser?: string;
    rejectAccountName?: string;
  };
}

export interface TodoState {
  status: "done" | "snoozed" | "dismissed";
  snoozed_until: string | null;
}

interface HistoryRow {
  chatter_name: string;
  analysis_date: string;
  revenue_today: number | null;
  mass_dms: number | null;
  open_chats: number | null;
  response_delay_days: number | null;
  account: string | null;
}

async function loadChatterHistoryRows(platform: string, sinceStr: string): Promise<HistoryRow[]> {
  return fetchAllPaged<HistoryRow>((from, to) =>
    supabase
      .from("chatter_history")
      .select("chatter_name, analysis_date, revenue_today, mass_dms, open_chats, response_delay_days, account")
      .eq("platform", platform)
      .gte("analysis_date", sinceStr)
      .order("analysis_date", { ascending: false })
      .range(from, to)
  );
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

export async function generateDailyTodos(platform: string): Promise<DailyTodo[]> {
  const today = todayStr();
  const thirtyAgo = new Date();
  thirtyAgo.setDate(thirtyAgo.getDate() - 30);
  const sinceStr = thirtyAgo.toISOString().split("T")[0];

  const rows = await loadChatterHistoryRows(platform, sinceStr);
  if (rows.length === 0) return [];

  // Nur Chatter berücksichtigen, die im neuesten Report noch enthalten sind.
  const activeNames = await loadActiveChatterNames(platform);
  const isActive = (name: string) =>
    activeNames === null ? true : activeNames.has(normalizeChatterName(name));

  // Onboarding-Phasen aus dem neuesten Report.
  //  - Tag 1: KOMPLETT raus, kein Todo (auch nicht Verzug).
  //  - Tag 2–5: nur Verzug zählt, andere Trigger ignorieren.
  //  - Ab Tag 6: alles normal.
  const day1Names = new Set<string>();
  const day2to5Names = new Set<string>();
  try {
    const { data: latestReport } = await supabase
      .from("analysis_reports")
      .select("result_json")
      .eq("platform", platform)
      .not("result_json", "is", null)
      .order("analysis_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1);
    const cats = (latestReport?.[0]?.result_json as
      | { categories?: { categoryName?: string; chatters?: { name?: string }[] }[] }
      | null)?.categories;
    for (const cat of cats ?? []) {
      const catName = cat.categoryName ?? "";
      if (!/ONBOARDING/i.test(catName)) continue;
      const tagMatch = catName.match(/TAG\s*(\d+)/i);
      const day = tagMatch ? parseInt(tagMatch[1], 10) : null;
      // Wenn kein Tag erkennbar → konservativ als Tag 2–5 behandeln
      // (Verzug zählt, Rest nicht).
      const bucket = day === 1 ? day1Names
        : day === null ? day2to5Names
        : day >= 2 && day <= 5 ? day2to5Names
        : null;
      if (!bucket) continue;
      for (const ch of cat.chatters ?? []) {
        if (ch?.name) bucket.add(normalizeChatterName(ch.name));
      }
    }
  } catch (e) {
    console.warn("[daily-todos] onboarding lookup failed", e);
  }
  const isDay1 = (name: string) => day1Names.has(normalizeChatterName(name));
  const isDay2to5 = (name: string) => day2to5Names.has(normalizeChatterName(name));

  // Tatsächlich neuestes Datum, nicht "heute" (Reports kommen evtl. mit Verzug)
  const latestDate = rows[0].analysis_date;

  // === LIVE-STATE laden (chatter_history_live) ===
  // Wird benutzt, um Signale gegen den aktuellen Live-Stand abzugleichen:
  //   - Verzug & offene Chats: falls live aufgelöst → Signal droppen
  //   - sonst Live-Werte in die Beschreibung packen
  interface LiveSnap {
    displayName: string;
    date: string;
    unread: number;
    oldest: number;
    revenue: number;
    massDms: number;
    updatedAt: string;
  }
  const liveByName = new Map<string, LiveSnap>();
  try {
    const todayIso = todayStr();
    const yIso = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    const liveRows = await fetchAllPaged<{
      chatter_name: string;
      date: string;
      unread_chats: number | null;
      oldest_chat: number | null;
      revenue: number | null;
      mass_dms: number | null;
      updated_at: string | null;
    }>((from, to) =>
      supabase
        .from("chatter_history_live")
        .select("chatter_name, date, unread_chats, oldest_chat, revenue, mass_dms, updated_at")
        .ilike("platform", platform)
        .gte("date", yIso)
        .range(from, to)
    );
    const sorted = [...(liveRows ?? [])].sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return (b.updated_at ?? "").localeCompare(a.updated_at ?? "");
    });
    for (const r of sorted) {
      if (!r.chatter_name) continue;
      const k = normalizeChatterName(r.chatter_name);
      if (liveByName.has(k)) continue;
      liveByName.set(k, {
        displayName: r.chatter_name,
        date: r.date,
        unread: Math.max(0, Number(r.unread_chats ?? 0)),
        oldest: Math.max(0, Number(r.oldest_chat ?? 0)),
        revenue: Math.max(0, Number(r.revenue ?? 0)),
        massDms: Math.max(0, Number(r.mass_dms ?? 0)),
        updatedAt: r.updated_at ?? todayIso,
      });
    }
  } catch (e) {
    console.warn("[daily-todos] live-state lookup failed", e);
  }
  const liveFor = (name: string): LiveSnap | null =>
    liveByName.get(normalizeChatterName(name)) ?? null;
  const liveAgeMin = (l: LiveSnap): number => {
    const t = new Date(l.updatedAt).getTime();
    return isFinite(t) ? Math.max(0, Math.round((Date.now() - t) / 60000)) : 9999;
  };
  const liveAgeLabel = (mins: number): string => {
    if (mins < 60) return `${mins}min`;
    const h = Math.floor(mins / 60);
    return h < 24 ? `${h}h` : `${Math.floor(h / 24)}T`;
  };
  const isCurrentLive = (l: LiveSnap): boolean => l.date === today || liveAgeMin(l) <= 360;




  // Models + Follower laden, um sie auf der Karte anzuzeigen.
  const modelRowsForLookup = await fetchAllPaged<{ model_name: string; follower_count: number | null }>((from, to) =>
    supabase
      .from("models")
      .select("model_name, follower_count")
      .eq("platform", platform)
      .range(from, to)
  );
  const followersByModel = new Map<string, number>();
  for (const m of modelRowsForLookup || []) {
    const key = m.model_name.toLowerCase().trim();
    const v = Number(m.follower_count) || 0;
    const prev = followersByModel.get(key) ?? 0;
    if (v > prev) followersByModel.set(key, v);
  }
  const formatFollowers = (n: number): string => {
    if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(".0", "")}k`;
    return String(n);
  };
  /** Liefert die heutigen Accounts (Models) eines Chatters mit Follower-Anzeige. */
  const modelInfoFor = (todayEntries: HistoryRow[]): string => {
    const accs = new Set<string>();
    for (const e of todayEntries) {
      const raw = (e.account || "").trim();
      if (!raw) continue;
      // account kann mehrere Models per Komma enthalten — splitten
      for (const part of raw.split(",")) {
        const a = part.trim();
        if (a) accs.add(a);
      }
    }
    if (accs.size === 0) return "";
    const parts: string[] = [];
    for (const a of accs) {
      const f = followersByModel.get(a.toLowerCase()) ?? 0;
      parts.push(`${a} (${formatFollowers(f)})`);
    }
    return parts.join(", ");
  };

  // Onboarding-Startdatum (erstes Auftauchen in Reports, accountübergreifend) pro Chatter.
  const onboardedByName = new Map<string, string>();
  try {
    const { data: onboardRows } = await supabase.rpc("get_chatter_onboarding", { p_platform: platform });
    for (const r of (onboardRows ?? []) as { chatter_name: string; onboarded_on: string }[]) {
      if (r?.chatter_name && r?.onboarded_on) {
        onboardedByName.set(normalizeChatterName(r.chatter_name), r.onboarded_on);
      }
    }
  } catch (e) {
    console.warn("[daily-todos] onboarding date lookup failed", e);
  }
  const formatStartDate = (iso: string): string => {
    const d = new Date(iso);
    if (!isFinite(d.getTime())) return iso;
    return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
  };
  const startSuffixFor = (name: string): string => {
    const iso = onboardedByName.get(normalizeChatterName(name));
    if (!iso) return "";
    const start = new Date(iso);
    const days = Math.max(0, Math.floor((Date.now() - start.getTime()) / 86400000));
    return ` · Start ${formatStartDate(iso)} (Tag ${days + 1})`;
  };

  const byChatter = new Map<string, HistoryRow[]>();
  for (const r of rows) {
    if (!r.chatter_name) continue;
    if (!isActive(r.chatter_name)) continue;
    const list = byChatter.get(r.chatter_name) || [];
    list.push(r);
    byChatter.set(r.chatter_name, list);
  }

  // Importance pro Chatter: relativer Umsatz-Anteil (14T) → Multiplier 0.5x – 1.8x.
  // Sortiert die wichtigen Umsatz-Träger nach oben, drückt low-revenue Chatter nach unten.
  const chatterTotals = new Map<string, number>();
  for (const r of rows) {
    if (!r.chatter_name) continue;
    if (!isActive(r.chatter_name)) continue;
    chatterTotals.set(r.chatter_name, (chatterTotals.get(r.chatter_name) ?? 0) + (Number(r.revenue_today) || 0));
  }
  const totalsArr = Array.from(chatterTotals.values()).filter((v) => v > 0).sort((a, b) => b - a);
  const topRev = totalsArr[0] ?? 0;
  const medianRev = totalsArr.length > 0 ? totalsArr[Math.floor(totalsArr.length / 2)] : 0;
  // Härter gewichten: 0€-Chatter sollen praktisch nie über Umsatzträgern stehen.
  // Top-Umsatz: bis 3.0x. Kein Umsatz: 0.15x. Skala stark gespreizt.
  const importanceFor = (name: string): number => {
    const v = chatterTotals.get(name) ?? 0;
    if (topRev <= 0) return 1.0;
    if (v <= 0) return 0.15;
    const ratio = v / topRev;
    // sqrt-Kurve, stärker gespreizt: top = 3.0, 25% von top ≈ 1.5, 5% von top ≈ 0.7
    const m = 0.4 + 2.6 * Math.sqrt(ratio);
    return Math.min(3.0, Math.max(0.2, m));
  };
  const importanceLabel = (name: string): string => {
    const v = chatterTotals.get(name) ?? 0;
    if (topRev > 0 && v >= topRev * 0.6) return " · Top-Umsatz";
    if (v <= 0) return " · 0€";
    if (medianRev > 0 && v >= medianRev) return "";
    return " · Low-Umsatz";
  };

  const todos: DailyTodo[] = [];

  for (const [name, entries] of byChatter) {
    // Tag-1 Onboarding → komplett überspringen
    if (isDay1(name)) continue;
    const onlyVerzug = isDay2to5(name);

    const todayEntries = entries.filter((e) => e.analysis_date === latestDate);
    const todayEntry = todayEntries[0];
    const historical = entries.filter((e) => e.analysis_date !== latestDate);
    const importance = importanceFor(name);
    const tag = importanceLabel(name);
    const modelInfo = modelInfoFor(todayEntries);
    const modelSuffix = modelInfo ? ` · Model: ${modelInfo}` : "";
    // Aggregierte Tageswerte über alle Account-Zeilen
    const todayOpenChats = todayEntries.reduce((s, e) => s + (e.open_chats ?? 0), 0);
    const todayMaxDelay = todayEntries.reduce((m, e) => Math.max(m, e.response_delay_days ?? 0), 0);
    const delayedReportEntries = todayEntries.filter(
      (e) => (e.open_chats ?? 0) > 0 && (e.response_delay_days ?? 0) >= 2,
    );
    const reportOpenChatsInDelay = delayedReportEntries.reduce((s, e) => s + (e.open_chats ?? 0), 0);
    const reportMaxDelayWithOpenChats = delayedReportEntries.reduce(
      (m, e) => Math.max(m, e.response_delay_days ?? 0),
      0,
    );

    // Inaktivität — fehlt heute, war aber regelmäßig da
    if (!todayEntry && historical.length >= 5 && !onlyVerzug) {
      todos.push({
        key: `inactive:${name}:${today}`,
        category: "activity",
        score: Math.round(60 * importance),
        title: `${name} fehlt im Report${tag}`,
        why: `Letzte Tage regelmäßig dabei, heute nicht — Status klären.`,
        chatterName: name,
        meta: { missingDays: 1 },
      });
      continue;
    }
    // Verzug — aktuelle Live-Daten sind die Wahrheit. Eine Karte entsteht nur,
    // wenn der aktuelle Snapshot sowohl offene Chats als auch oldest_chat ≥ 3
    // bestätigt (2 Tage gelten noch nicht als Verzug). Ist Live stale/fehlt,
    // fällt der Trigger auf Report-Zeilen zurück, aber nur auf Zeilen, bei denen
    // offene Chats UND Delay auf derselben Account-Zeile stehen.
    const live = liveFor(name);
    if (live && isCurrentLive(live)) {
      const oldestDays = Math.round(live.oldest);
      if (live.unread > 0 && oldestDays >= MIN_VERZUG_DAYS) {
        todos.push({
          key: `verzug:${name}:${today}`,
          category: "verzug",
          score: Math.round((90 + oldestDays * 5) * importance),
          title: `${name} dringend — ältester Chat ${oldestDays}T${tag}`,
          why: `Live (${liveAgeLabel(liveAgeMin(live))}): ältester Chat ${oldestDays}T · ${live.unread} ungelesen${modelSuffix}${startSuffixFor(name)}. Sofort entlasten oder Ursache klären.`,
          chatterName: name,
          meta: { delayDays: oldestDays, todayOpenChats: live.unread },
        });
      }
    } else if (reportMaxDelayWithOpenChats >= MIN_VERZUG_DAYS && reportOpenChatsInDelay > 0) {

      // Kein aktueller Live-Snapshot vorhanden → Report-Fallback (mit klarer Kennzeichnung).
      todos.push({
        key: `verzug:${name}:${today}`,
        category: "verzug",
        score: Math.round((90 + reportMaxDelayWithOpenChats * 5) * importance),
        title: `${name} dringend — ältester Chat ${reportMaxDelayWithOpenChats}T${tag}`,
        why: `Report (kein aktueller Live-Snapshot): ältester Chat ${reportMaxDelayWithOpenChats}T · ${reportOpenChatsInDelay} offene Chats${modelSuffix}${startSuffixFor(name)}. Sofort entlasten oder Ursache klären.`,
        chatterName: name,
        meta: { delayDays: reportMaxDelayWithOpenChats, todayOpenChats: reportOpenChatsInDelay },
      });
    }





    if (!todayEntry || historical.length < 2) continue;
    if (onlyVerzug) continue; // Tag 2–5: ab hier nichts mehr

    // 14T / 30T Aggregate für Confirmation-Gate
    const past14Cutoff = new Date();
    past14Cutoff.setDate(past14Cutoff.getDate() - 14);
    const past14Iso = past14Cutoff.toISOString().split("T")[0];
    const last14 = historical.filter((e) => e.analysis_date >= past14Iso);
    const last30 = historical;

    const sumRev = (arr: HistoryRow[]) =>
      arr.reduce((s, e) => s + Number(e.revenue_today ?? 0), 0);
    const sumDm = (arr: HistoryRow[]) => arr.reduce((s, e) => s + (e.mass_dms ?? 0), 0);

    // Pro-Tag Aggregate (über alle Account-Zeilen eines Tages summieren)
    const aggByDay = (arr: HistoryRow[]) => {
      const m = new Map<string, { rev: number; dm: number; chats: number }>();
      for (const e of arr) {
        const cur = m.get(e.analysis_date) ?? { rev: 0, dm: 0, chats: 0 };
        cur.rev += Number(e.revenue_today ?? 0);
        cur.dm += e.mass_dms ?? 0;
        cur.chats += e.open_chats ?? 0;
        m.set(e.analysis_date, cur);
      }
      return Array.from(m.values());
    };
    const days14 = aggByDay(last14);
    const days30 = aggByDay(last30);
    const avg = (vals: number[]) =>
      vals.length === 0 ? 0 : vals.reduce((s, v) => s + v, 0) / vals.length;

    // Mass-DM Drop — confirmed: 14T-Schnitt unter 30T-Schnitt × 0.7 UND Heute unter 14T × 0.5
    const todayDm = todayEntries.reduce((s, e) => s + (e.mass_dms ?? 0), 0);
    const dm14 = avg(days14.map((d) => d.dm));
    const dm30 = avg(days30.map((d) => d.dm));
    if (days30.length >= 8 && dm30 >= 3 && dm14 <= dm30 * 0.7 && todayDm < dm14 * 0.5) {
      const live = liveFor(name);
      // Live-Gegencheck: wenn live heute schon ≥ 70% der 30T-Norm an DMs raus sind → resolved.
      const liveDm = live?.massDms ?? todayDm;
      const resolved = live && liveDm >= dm30 * 0.7;
      if (!resolved) {
        const drop14vs30 = Math.round(((dm30 - dm14) / dm30) * 100);
        const livePart = live ? ` · Live (${liveAgeLabel(liveAgeMin(live))}): ${liveDm} DMs heute` : "";
        todos.push({
          key: `dm:${name}:${today}`,
          category: "activity",
          score: Math.round((70 + Math.min(30, drop14vs30 / 2)) * importance),
          title: `${name} Mass-DMs hochziehen (Ziel ${Math.round(dm30)}/Tag)${tag}`,
          why: `Letzte 14T Ø ${dm14.toFixed(1)} vs. 30T Ø ${dm30.toFixed(1)} (−${drop14vs30} %) · heute ${todayDm}${livePart}${modelSuffix}.`,
          chatterName: name,
          meta: {
            todayMassDms: todayDm,
            baselineMassDms: dm30,
            missingMassDms: Math.max(0, Math.round(dm30 - todayDm)),
            dropPct: drop14vs30,
          },
        });
      }
    }

    // Revenue Drop — confirmed: 14T-Schnitt unter 30T-Schnitt × 0.75
    const todayRev = sumRev(todayEntries);
    const rev14 = avg(days14.map((d) => d.rev));
    const rev30 = avg(days30.map((d) => d.rev));
    if (days30.length >= 8 && rev30 >= 50 && rev14 <= rev30 * 0.75 && todayRev < rev14 * 0.7) {
      const live = liveFor(name);
      const liveRev = live?.revenue ?? todayRev;
      // Live-Gegencheck: wenn live heute schon ≥ 80% der 30T-Norm € drin → resolved.
      const resolved = live && liveRev >= rev30 * 0.8;
      if (!resolved) {
        const drop = Math.round(((rev30 - rev14) / rev30) * 100);
        const livePart = live ? ` · Live (${liveAgeLabel(liveAgeMin(live))}): ${Math.round(liveRev)} € heute` : "";
        todos.push({
          key: `rev:${name}:${today}`,
          category: "revenue",
          score: Math.round((75 + Math.min(25, drop / 3)) * importance),
          title: `${name} checken — Umsatz im Rückgang (−${drop} % 14T vs. 30T)${tag}`,
          why: `Letzte 14T Ø ${rev14.toFixed(0)} €/Tag vs. 30T Ø ${rev30.toFixed(0)} €/Tag · heute ${todayRev.toFixed(0)} €${livePart}${modelSuffix}.`,
          chatterName: name,
          meta: { todayRevenue: todayRev, baselineRevenue: rev30, dropPct: drop },
        });
      }
    }
    // Positive Outlier — läuft besser als sonst.
    // Drei Routen — es reicht, wenn EINE zutrifft:
    //   A) 14T-Schnitt ≥ 125 % des 30T-Ø  (nachhaltiger Aufwärtstrend)
    //   B)  7T-Schnitt ≥ 135 % des 30T-Ø  (frischer Streak)
    //   C) Heute ≥ 150 % des 30T-Ø        (heutiger Ausreißer nach oben)
    const past7Cutoff = new Date();
    past7Cutoff.setDate(past7Cutoff.getDate() - 7);
    const past7Iso = past7Cutoff.toISOString().split("T")[0];
    const days7 = aggByDay(historical.filter((e) => e.analysis_date >= past7Iso));
    const rev7 = avg(days7.map((d) => d.rev));

    const trend14 = days30.length >= 6 && rev30 >= 30 && rev14 >= rev30 * 1.25;
    const streak7 = days7.length >= 4 && rev30 >= 30 && rev7 >= rev30 * 1.35;
    const spikeToday = days30.length >= 5 && rev30 >= 30 && todayRev >= rev30 * 1.5;

    if (trend14 || streak7 || spikeToday) {
      // Stärkste Route für Titel/Reason wählen (relatives Plus)
      type Route = { label: string; avgVal: number; up: number };
      const candidates: Route[] = [];
      if (trend14) candidates.push({ label: "14T", avgVal: rev14, up: Math.round(((rev14 - rev30) / rev30) * 100) });
      if (streak7) candidates.push({ label: "7T", avgVal: rev7, up: Math.round(((rev7 - rev30) / rev30) * 100) });
      if (spikeToday) candidates.push({ label: "heute", avgVal: todayRev, up: Math.round(((todayRev - rev30) / rev30) * 100) });
      const best = candidates.reduce((a, b) => (b.up > a.up ? b : a));
      todos.push({
        key: `pos:${name}:${today}`,
        category: "positive",
        score: Math.round(40 * importance),
        title: `Was läuft bei ${name} richtig? (+${best.up} % ${best.label})`,
        why: `${best.label === "heute" ? "Heute" : `Letzte ${best.label} Ø`} ${best.avgVal.toFixed(0)} € vs. 30T Ø ${rev30.toFixed(0)} €${modelSuffix} — Erfolgsrezept abgreifen.`,
        chatterName: name,
        meta: { todayRevenue: todayRev, baselineRevenue: rev30 },
      });
    }

    // Chat Jam — bleibt absolute Schwelle; zusätzlich confirmation, dass auch 14T-Schnitt erhöht ist
    const baseChats = avg(days30.map((d) => d.chats));
    const chats14 = avg(days14.map((d) => d.chats));
    if (todayOpenChats >= 30 && baseChats > 0 && todayOpenChats > baseChats * 1.5 && chats14 > baseChats * 1.2) {
      const live = liveFor(name);
      // Live-Gegencheck: Stack ist live schon klein → kein Jam mehr.
      const resolved = live && live.unread < Math.max(15, baseChats * 0.8);
      if (!resolved) {
        const up = Math.round(((todayOpenChats - baseChats) / baseChats) * 100);
        const livePart = live
          ? ` · Live (${liveAgeLabel(liveAgeMin(live))}): ${live.unread} ungelesen${live.oldest >= 1 ? `, ältester ${Math.round(live.oldest)}T` : ""}`
          : "";
        todos.push({
          key: `jam:${name}:${today}`,
          category: "activity",
          score: Math.round(65 * importance),
          title: `${name} entlasten — ${todayOpenChats} offene Chats${tag}`,
          why: `Heute +${up} % vs. 30T Ø ${baseChats.toFixed(0)} · 14T Ø bereits ${chats14.toFixed(0)}${livePart}${modelSuffix}.`,
          chatterName: name,
          meta: { todayOpenChats: todayOpenChats, baselineOpenChats: baseChats },
        });
      }
    }
  }


  // Models in Trouble
  const modelRows = await fetchAllPaged<{ model_name: string }>((from, to) =>
    supabase
      .from("models")
      .select("model_name")
      .eq("platform", platform)
      .range(from, to)
  );
  const modelNames = modelRows.map((m) => m.model_name);
  if (modelNames.length > 0) {
    try {
      const troubles = await detectModelTroubles(platform, modelNames);
      const scored = troubles
        .filter((t) => !(t.currentChatter && !isActive(t.currentChatter)))
        .map((t) => {
          const dropPerDay = (t.baselineAvgPerDay ?? 0) > 0 && (t.currentAvgPerDay ?? 0) >= 0
            ? Math.max(0, (t.baselineAvgPerDay ?? 0) - (t.currentAvgPerDay ?? 0))
            : 0;
          return { t, dropPerDay };
        })
        // Impact-Sortierung: größter €/Tag-Drop zuerst
        .sort((a, b) => b.dropPerDay - a.dropPerDay);
      for (const { t, dropPerDay } of scored) {
        const followers = followersByModel.get(t.modelName.toLowerCase().trim()) ?? 0;
        const followerPart = followers > 0 ? ` (${formatFollowers(followers)} Follower)` : "";
        // Score reflektiert Impact, damit globale Sortierung stimmt
        const impactScore = Math.min(99, 70 + Math.round(dropPerDay));
        todos.push({
          key: `model:${t.modelName}:${today}`,
          category: "model",
          score: t.severity === "high" ? Math.max(85, impactScore) : impactScore,
          title: `Model "${t.modelName}"${followerPart} im Rückgang`,
          why: t.reason,
          modelName: t.modelName,
          chatterName: t.currentChatter,
          meta: { modelDropPerDay: dropPerDay },
        });
      }
    } catch (e) {
      console.warn("[daily-todos] model trouble detection failed", e);
    }
  }



  // Talent-Scout — verlässliche Workhorses ↔ verwaiste Accounts
  try {
    const fmtFollowers = (n: number): string => {
      if (!n || n <= 0) return "—";
      if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
      if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
      return String(n);
    };
    const fmtEur = (n: number): string => `${Math.round(n)} €`;

    const rejected = await loadActiveRejections(platform);
    const matches = await findTalentMatches(platform, rejected);
    const matchedUnderusers = new Set(matches.map((m) => m.underuser.toLowerCase()));
    for (const m of matches) {
      const onbPart = m.riserDaysOnboarded != null ? `, ${m.riserDaysOnboarded}T onboarded` : "";
      const tierPart = m.riserTier ? ` (${m.riserTier.label})` : "";
      const boostIcon = m.riserHasRevenueBoost ? "⭐ " : "🚀 ";
      const boostPart = m.riserHasRevenueBoost
        ? ` · zusätzlich ${m.riserRevenueDays}/6T Umsatz (Ø ${m.riserAvgRevenue} €/Tag)`
        : "";
      const scoreBoost = m.riserHasRevenueBoost ? 12 : 0;

      const underRev: string[] = [];
      if (m.underuserAvgRevenue6d > 0) underRev.push(`Ø 6T: ${fmtEur(m.underuserAvgRevenue6d)}`);
      if (m.underuserRecentAvgRevenue2d > 0) {
        underRev.push(`zuletzt (2T): ${fmtEur(m.underuserRecentAvgRevenue2d)}`);
      } else if (m.underuserAvgRevenue6d > 0) {
        underRev.push(`zuletzt (2T): 0 €`);
      }
      const underLive = `ältester Chat ${m.underuserOldestChatDays}T offen · ${m.underuserOpenChats} ungelesen`;
      const underBlock = `Account ${m.underuserAccount} (${m.underuserTier.label}, ${fmtFollowers(m.underuserFollowers)} Follower) bei ${m.underuser}${underRev.length ? " · " + underRev.join(" · ") : ""} · ${underLive}`;

      todos.push({
        key: `talent:${m.riser}:${m.underuser}:${today}`,
        category: "talent",
        score: 70 + Math.round(m.matchScore / 10) + scoreBoost,
        title: `${boostIcon}${m.riser} auf ${m.underuserAccount} hochziehen`,
        why: `${m.riser}${tierPart}: ${m.riserChatWorkDays}/6T Chats abgearbeitet · ${m.riserDmDays}/6T Mass-DMs${boostPart}${onbPart}. ${underBlock}.`,
        chatterName: m.riser,
        compareWith: m.underuser,
        meta: {
          matchScore: m.matchScore,
          rejectAccountRiser: m.riser,
          rejectAccountName: m.underuserAccount,
        },
      });
    }
    // Solo-Warnungen für besonders verwaiste Accounts ohne passenden Workhorse
    const orphans = await findOrphanedAccounts(platform);

    for (const o of orphans) {
      if (matchedUnderusers.has(o.chatter.toLowerCase())) continue;
      if (!isActive(o.chatter)) continue;
      const liveBits: string[] = [];
      if (o.oldestChatDays >= 1) liveBits.push(`ältester Chat ${o.oldestChatDays}T offen`);
      if (o.openChats > 0) liveBits.push(`${o.openChats} ungelesen`);
      if (o.activeDays <= 2) liveBits.push(`nur ${o.activeDays}/6 Tage aktiv`);

      const revParts: string[] = [];
      if (o.avgRevenue6d > 0) revParts.push(`Ø 6T: ${fmtEur(o.avgRevenue6d)}`);
      if (o.recentAvgRevenue2d > 0) {
        revParts.push(`zuletzt (2T): ${fmtEur(o.recentAvgRevenue2d)}`);
      } else if (o.avgRevenue6d > 0) {
        revParts.push(`zuletzt (2T): 0 €`);
      }

      const head = `${o.tier.label}-Account ${o.account} (${fmtFollowers(o.followers)} Follower) bei ${o.chatter}`;
      const body = [...revParts, ...liveBits].filter(Boolean).join(" · ") || "kaum Bewegung";

      todos.push({
        key: `talent-orphan:${o.account}:${today}`,
        category: "talent",
        score: 65 + Math.min(15, Math.round(o.painScore / 10)),
        title: `⚠️ Account ${o.account} liegt brach`,
        why: `${head} · ${body}. Wechsel auf verlässlicheren Chatter prüfen.`,
        chatterName: o.chatter,
      });
    }
  } catch (e) {
    console.warn("[daily-todos] talent scout failed", e);
  }

  // === LIVE-PASS: Verzug-Todos für Chatter erzeugen, die zwar Live-Rückstand
  // haben (oldest_chat ≥ 2), aber im chatter_history-Loop nicht als eigener
  // Eintrag erschienen (z.B. weil sie in den 30T-Reports nicht auftauchen
  // oder aus dem letzten Report gefallen sind). Ohne diesen Pass fehlen sie
  // im Verzugs-Tab, obwohl die Live-Daten sie klar zeigen.
  const existingVerzugKeys = new Set(
    todos.filter((t) => t.category === "verzug").map((t) => t.key),
  );
  for (const [nameKey, live] of liveByName) {
    const oldestDays = Math.round(live.oldest);
    if (oldestDays < MIN_VERZUG_DAYS) continue;
    if (live.unread <= 0) continue;
    if (!isCurrentLive(live)) continue;

    // Display-Name bevorzugt aus chatter_history (Report-Schreibweise), sonst
    // aus dem Live-Datensatz selbst.
    let displayName: string | null = null;
    for (const [dispName] of byChatter) {
      if (normalizeChatterName(dispName) === nameKey) { displayName = dispName; break; }
    }
    if (!displayName) displayName = live.displayName;

    if (day1Names.has(nameKey)) continue;
    // Nur Chatter aus dem aktuellen Roster (letzter Report) einbeziehen.
    // Wer nicht mehr im letzten Report vorkommt, gehört nicht in den Verzugs-Tab.
    if (!isActive(displayName)) continue;
    const key = `verzug:${displayName}:${today}`;
    if (existingVerzugKeys.has(key)) continue;

    const importance = importanceFor(displayName);
    const tag = importanceLabel(displayName);
    todos.push({
      key,
      category: "verzug",
      score: Math.round((90 + oldestDays * 5) * importance),
      title: `${displayName} dringend — ältester Chat ${oldestDays}T${tag}`,
      why: `Live (${liveAgeLabel(liveAgeMin(live))}): ältester Chat ${oldestDays}T · ${live.unread} ungelesen${startSuffixFor(displayName)}. Sofort entlasten oder Ursache klären.`,
      chatterName: displayName,
      meta: { delayDays: oldestDays, todayOpenChats: live.unread },
    });
    existingVerzugKeys.add(key);
  }

  // Sortieren
  todos.sort((a, b) => b.score - a.score);
  return todos;
}

export async function loadTodoStates(
  platform: string
): Promise<Record<string, TodoState>> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return {};

  // Abgehakte Aufgaben bleiben weg, bis ein NEUER Report hochgeladen wird.
  // Lower-Bound = Zeitpunkt des aktuellsten Reports (oder heute 00:00 als Fallback).
  const { data: latestReport } = await supabase
    .from("analysis_reports")
    .select("created_at")
    .eq("user_id", user.id)
    .eq("platform", platform)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const sinceIso = latestReport?.created_at ?? todayStr() + "T00:00:00Z";

  const data = await fetchAllPaged<{ todo_key: string; status: string; snoozed_until: string | null }>((from, to) =>
    supabase
      .from("daily_todo_state")
      .select("todo_key, status, snoozed_until")
      .eq("user_id", user.id)
      .eq("platform", platform)
      .gte("acted_at", sinceIso)
      .range(from, to)
  );

  const map: Record<string, TodoState> = {};
  for (const r of data || []) {
    map[r.todo_key] = {
      status: r.status as TodoState["status"],
      snoozed_until: r.snoozed_until,
    };
  }
  return map;
}

export async function setTodoStatus(
  platform: string,
  todoKey: string,
  status: TodoState["status"],
  snoozedUntil?: string | null
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  await supabase.from("daily_todo_state").upsert(
    {
      user_id: user.id,
      platform,
      todo_key: todoKey,
      status,
      snoozed_until: snoozedUntil ?? null,
      acted_at: new Date().toISOString(),
    },
    { onConflict: "user_id,platform,todo_key" }
  );
}

export async function clearTodoStatus(platform: string, todoKey: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("daily_todo_state")
    .delete()
    .eq("user_id", user.id)
    .eq("platform", platform)
    .eq("todo_key", todoKey);
}
