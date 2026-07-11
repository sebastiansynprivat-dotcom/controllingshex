/**
 * Revenue Tasks — die geistesgesunde Top-Aufgaben-Engine fürs „Heute".
 *
 * Idee: Statt allgemeiner To-Dos („X hat keine Antworten") werden hier nur
 * Aufgaben mit konkretem €-Hebel erzeugt. Jede Aufgabe trägt einen geschätzten
 * impactEurPerWeek + Begründung. Sortiert nach Score, gecappt auf Top-N,
 * dedupiert pro Chatter.
 *
 * Quellen, die zusammengeführt werden:
 *   1. Recovery-Queue          (recovery-queue.ts)
 *   2. Model-Phasen-Knick      (lokal aus chatter_history aggregiert)
 *   3. Tier-Mismatch (Pull-up) (effort-potential.ts) + Underused Cross-Check
 *   4. Swap-Engine Top-Pick    (swap-suggestions.ts)
 *   5. Hochfrequenz-Lücke      (chatter_hourly_stats — Peak-Slots leer)
 *
 * Alle Aufgaben sind deterministisch, transparent, ohne LLM.
 */
import { supabase } from "@/integrations/supabase/client";
import { fetchAllPaged } from "@/lib/paged";
import {
  computeLeaderboardRanks,
  computeRecoveryQueue,
  loadRecoveryHistory,
} from "@/lib/recovery-queue";
import { loadMismatchMap, type MismatchEntry } from "@/lib/effort-potential";
import { tierForFollowers } from "@/lib/account-tiers";
import { buildAccountSwapTasks } from "@/lib/account-swap-engine";
import { buildDowngradeCandidates } from "@/lib/downgrade-candidates";
import { loadActiveChatterNames, normalizeChatterName } from "@/lib/active-chatters";

export type RevenueTaskKind = "recovery" | "phase" | "mismatch" | "swap" | "slot" | "upgrade" | "downgrade";

export interface RevenueTask {
  key: string;
  kind: RevenueTaskKind;
  title: string;
  why: string;
  impactEurPerWeek: number;
  confidence: number; // 0..1
  score: number;
  chatterName?: string | null;
  secondaryChatter?: string | null;
  modelName?: string | null;
  meta?: {
    downgradeSince?: string; // YYYY-MM-DD, für chronologische Sortierung im Downgrade-Tab
  };
}

const MAX_TASKS = 20;
const MIN_IMPACT_EUR_PER_WEEK = 30;

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function fmtEur(v: number): string {
  return Math.round(v).toLocaleString("de-DE") + " €";
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

interface HistoryRow {
  chatter_name: string;
  account: string | null;
  analysis_date: string;
  revenue_today: number;
  mass_dms: number;
  open_chats: number;
  response_delay_days: number;
}

interface HourlyRow {
  chatter_name: string;
  date: string;
  hour: number;
  revenue: number;
  mass_dms: number;
  unread_delta: number;
}

/* -------------------- Phasen-Knick (lokal) -------------------- */

interface PhaseTrouble {
  modelName: string;
  currentChatter: string;
  previousChatter: string;
  currAvg: number;
  prevAvg: number;
  currDays: number;
  followers: number;
  dropEurPerDay: number;
}

function detectPhaseTroubles(
  history: HistoryRow[],
  followersByAcc: Map<string, number>
): PhaseTrouble[] {
  // Gruppieren pro account (Account kann mehrere Chatter pro Tag haben — nimm Top-Earner)
  const byAcc = new Map<string, Map<string, Map<string, number>>>(); // acc → date → chatter → rev
  for (const r of history) {
    const acc = (r.account || "").trim();
    if (!acc) continue;
    // account kann komma-getrennt sein → splitten und Umsatz teilen ist Quatsch;
    // hier: einfach den ersten Account nehmen (Modell-Phasen sind grobe Zuordnung)
    const accs = acc.split(",").map((a) => a.trim()).filter(Boolean);
    for (const a of accs) {
      const akey = a.toLowerCase();
      if (!byAcc.has(akey)) byAcc.set(akey, new Map());
      const dm = byAcc.get(akey)!;
      if (!dm.has(r.analysis_date)) dm.set(r.analysis_date, new Map());
      const cm = dm.get(r.analysis_date)!;
      const rev = Number(r.revenue_today) || 0;
      cm.set(r.chatter_name, (cm.get(r.chatter_name) ?? 0) + rev);
    }
  }

  const troubles: PhaseTrouble[] = [];
  for (const [akey, dm] of byAcc) {
    const sortedDates = [...dm.keys()].sort();
    if (sortedDates.length < 8) continue;
    // Bestimme Top-Chatter pro Tag → Phasen
    interface Phase { chatter: string; from: string; to: string; days: number; total: number; }
    const phases: Phase[] = [];
    for (const date of sortedDates) {
      let top: string | null = null;
      let topRev = -1;
      let dailyTotal = 0;
      for (const [c, v] of dm.get(date)!) {
        dailyTotal += v;
        if (v > topRev) { topRev = v; top = c; }
      }
      if (!top) continue;
      const last = phases[phases.length - 1];
      if (last && last.chatter === top) {
        last.to = date;
        last.days += 1;
        last.total += dailyTotal;
      } else {
        phases.push({ chatter: top, from: date, to: date, days: 1, total: dailyTotal });
      }
    }
    if (phases.length < 2) continue;
    const curr = phases[phases.length - 1];
    const prev = phases[phases.length - 2];
    if (curr.days < 5 || prev.days < 3) continue;
    const currAvg = curr.total / curr.days;
    const prevAvg = prev.total / prev.days;
    if (prevAvg < 50) continue;
    if (currAvg > prevAvg * 0.7) continue;
    // finde Original-Account-Schreibweise
    const originalAcc = [...followersByAcc.keys()].find((k) => k === akey) ?? akey;
    troubles.push({
      modelName: originalAcc,
      currentChatter: curr.chatter,
      previousChatter: prev.chatter,
      currAvg,
      prevAvg,
      currDays: curr.days,
      followers: followersByAcc.get(akey) ?? 0,
      dropEurPerDay: prevAvg - currAvg,
    });
  }
  return troubles;
}

/* -------------------- Hochfrequenz-Lücke -------------------- */

interface SlotGap {
  account: string;
  hours: number[]; // unbesetzte Peak-Stunden heute
  expectedEurPerDay: number;
}

/**
 * Pro Top-Tier-Account (Growth/Top): Ermittelt historische Peak-Stunden
 * (Median € pro Stunde ≥ 30). Schaut, welche dieser Stunden heute (bisher)
 * 0 Aktivität haben — dort liegt buchstäblich Geld auf der Straße.
 *
 * Vereinfachung: hourly_stats hat keine direkte Account-Zuordnung. Wir
 * mappen Chatter → aktueller Account aus history.
 */
function detectSlotGaps(
  hourly: HourlyRow[],
  chatterCurrentAccount: Map<string, string>,
  followersByAcc: Map<string, number>
): SlotGap[] {
  const today = todayStr();
  const nowHour = new Date().getHours();
  // Aggregiere pro Account: Stunde → Liste Tageswerte (Summe revenue über alle Chatter dieser Stunde)
  const perAccHourDay = new Map<string, Map<number, Map<string, number>>>();
  for (const r of hourly) {
    const acc = chatterCurrentAccount.get(normalizeChatterName(r.chatter_name));
    if (!acc) continue;
    const akey = acc.toLowerCase();
    if (!perAccHourDay.has(akey)) perAccHourDay.set(akey, new Map());
    const hm = perAccHourDay.get(akey)!;
    if (!hm.has(r.hour)) hm.set(r.hour, new Map());
    const dm = hm.get(r.hour)!;
    const rev = Number(r.revenue) || 0;
    dm.set(r.date, (dm.get(r.date) ?? 0) + rev);
  }

  const out: SlotGap[] = [];
  for (const [akey, hm] of perAccHourDay) {
    const followers = followersByAcc.get(akey) ?? 0;
    const tier = tierForFollowers(followers);
    if (!tier || (tier.id !== "growth" && tier.id !== "top")) continue;

    const peakHours: { hour: number; medianEur: number }[] = [];
    for (const [hour, dm] of hm) {
      const values = [...dm.values()].filter((v) => v > 0);
      if (values.length < 5) continue;
      const med = median(values);
      if (med >= 30) peakHours.push({ hour, medianEur: med });
    }
    if (peakHours.length === 0) continue;

    // Heute schon belegt?
    const todayActive = new Set<number>();
    for (const [hour, dm] of hm) {
      const v = dm.get(today);
      if (v && v > 0) todayActive.add(hour);
    }
    const missed = peakHours.filter(
      (p) => p.hour <= nowHour && !todayActive.has(p.hour)
    );
    if (missed.length === 0) continue;
    const expectedEurPerDay = missed.reduce((s, p) => s + p.medianEur, 0);
    if (expectedEurPerDay < 30) continue;
    // Original-Schreibweise des Accounts wiederherstellen
    let original = akey;
    for (const acc of chatterCurrentAccount.values()) {
      if (acc.toLowerCase() === akey) { original = acc; break; }
    }
    out.push({
      account: original,
      hours: missed.map((p) => p.hour).sort((a, b) => a - b),
      expectedEurPerDay,
    });
  }
  return out;
}

/* -------------------- Score-Helper -------------------- */

function tierMultiplierFromFollowers(followers: number): number {
  const t = tierForFollowers(followers);
  if (!t) return 1.0;
  switch (t.id) {
    case "seed": return 1.0;
    case "starter": return 1.1;
    case "growth": return 1.35;
    case "top": return 1.6;
  }
}

function importanceFor(totals: Map<string, number>, name: string): number {
  const v = totals.get(name) ?? 0;
  const arr = [...totals.values()].filter((x) => x > 0).sort((a, b) => b - a);
  const top = arr[0] ?? 0;
  if (top <= 0) return 1.0;
  if (v <= 0) return 0.3;
  const ratio = v / top;
  return Math.min(2.0, Math.max(0.4, 0.5 + 1.5 * Math.sqrt(ratio)));
}

function fmtHourRange(hours: number[]): string {
  if (hours.length === 0) return "";
  // konsekutive Slots zusammenfassen
  const out: string[] = [];
  let start = hours[0], prev = hours[0];
  for (let i = 1; i <= hours.length; i++) {
    if (i < hours.length && hours[i] === prev + 1) { prev = hours[i]; continue; }
    out.push(start === prev ? `${start}–${start + 1}h` : `${start}–${prev + 1}h`);
    if (i < hours.length) { start = hours[i]; prev = hours[i]; }
  }
  return out.join(", ");
}

/* -------------------- Hauptfunktion -------------------- */

export async function generateRevenueTasks(platform: string): Promise<RevenueTask[]> {
  const today = todayStr();
  const fromIso60 = isoDaysAgo(60);
  const fromIso30 = isoDaysAgo(30);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const [historyAllPaged, hourlyPaged, modelsPaged, recoveryHistory, mismatchRes, activeNames, swapTasks, downgradeTasks] = await Promise.all([
    fetchAllPaged<HistoryRow>((from, to) =>
      supabase
        .from("chatter_history")
        .select("chatter_name, account, analysis_date, revenue_today, mass_dms, open_chats, response_delay_days")
        .eq("user_id", user.id)
        .ilike("platform", platform)
        .gte("analysis_date", fromIso60)
        .order("analysis_date", { ascending: false })
        .range(from, to)
    ),
    fetchAllPaged<HourlyRow>((from, to) =>
      supabase
        .from("chatter_hourly_stats")
        .select("chatter_name, date, hour, revenue, mass_dms, unread_delta")
        .eq("user_id", user.id)
        .ilike("platform", platform)
        .gte("date", fromIso30)
        .range(from, to)
    ),
    fetchAllPaged<{ model_name: string; follower_count: number }>((from, to) =>
      supabase
        .from("models")
        .select("model_name, follower_count")
        .eq("user_id", user.id)
        .ilike("platform", platform)
        .range(from, to)
    ),
    loadRecoveryHistory(platform),
    loadMismatchMap(platform),
    loadActiveChatterNames(platform),
    buildAccountSwapTasks(platform).catch((e) => {
      console.warn("[revenue-tasks] account-swap-engine failed", e);
      return [] as RevenueTask[];
    }),
    buildDowngradeCandidates(platform).catch((e) => {
      console.warn("[revenue-tasks] downgrade-candidates failed", e);
      return [] as RevenueTask[];
    }),
  ]);

  const historyAll = (historyRes.data ?? []) as HistoryRow[];
  const hourly = (hourlyRes.data ?? []) as HourlyRow[];
  const models = (modelsRes.data ?? []) as { model_name: string; follower_count: number }[];

  const isActive = (name: string) =>
    activeNames === null ? true : activeNames.has(normalizeChatterName(name));
  const history = historyAll.filter((r) => r.chatter_name && isActive(r.chatter_name));

  // Followers pro Account (lowercased)
  const followersByAcc = new Map<string, number>();
  for (const m of models) {
    const k = m.model_name.toLowerCase().trim();
    const v = Number(m.follower_count) || 0;
    if ((followersByAcc.get(k) ?? 0) < v) followersByAcc.set(k, v);
  }

  // Aktueller Account pro Chatter (latest history row mit nicht-leerem account)
  const chatterCurrentAccount = new Map<string, string>();
  for (const r of history) {
    const key = normalizeChatterName(r.chatter_name);
    if (chatterCurrentAccount.has(key)) continue;
    const acc = (r.account || "").split(",")[0]?.trim();
    if (acc) chatterCurrentAccount.set(key, acc);
  }

  // 30T-Umsatz-Totals → Importance
  const totals30 = new Map<string, number>();
  for (const r of history) {
    if (r.analysis_date < fromIso30) continue;
    totals30.set(r.chatter_name, (totals30.get(r.chatter_name) ?? 0) + (Number(r.revenue_today) || 0));
  }

  const tasks: RevenueTask[] = [];

  /* 1. RECOVERY */
  const ranks = computeLeaderboardRanks(recoveryHistory);
  const recovery = computeRecoveryQueue(recoveryHistory, ranks).slice(0, 6);
  for (const r of recovery) {
    if (r.recoveryEur < MIN_IMPACT_EUR_PER_WEEK) continue;
    const acc = chatterCurrentAccount.get(normalizeChatterName(r.chatterName));
    const followers = acc ? (followersByAcc.get(acc.toLowerCase()) ?? 0) : 0;
    const tierMult = tierMultiplierFromFollowers(followers);
    const imp = importanceFor(totals30, r.chatterName);
    const topBoost = r.isTopPerformer ? 1.8 : 1.0;
    const score = r.recoveryEur * r.confidence * tierMult * imp * topBoost;
    tasks.push({
      key: `rev:recovery:${normalizeChatterName(r.chatterName)}:${today}`,
      kind: "recovery",
      title: `${r.chatterName} pushen — −${Math.round(r.gapPct * 100)}% vs. Median`,
      why: `Aktive-Tage-Median ${fmtEur(r.baseline)}/Tag (30T, ohne Null-Tage) vs. zuletzt ${fmtEur(r.currentAvg)}/Tag. ${
        r.isTopPerformer ? "Top-10 Performer." : `Rang #${r.leaderboardRank ?? "—"}.`
      }`,
      impactEurPerWeek: r.recoveryEur,
      confidence: r.confidence,
      score,
      chatterName: r.chatterName,
      modelName: acc ?? null,
    });
  }

  /* 2. PHASEN-KNICK */
  const phaseTroubles = detectPhaseTroubles(history, followersByAcc);
  for (const p of phaseTroubles) {
    const impact = p.dropEurPerDay * 7;
    if (impact < MIN_IMPACT_EUR_PER_WEEK) continue;
    const tierMult = tierMultiplierFromFollowers(p.followers);
    const imp = importanceFor(totals30, p.previousChatter);
    const confidence = Math.min(1, p.currDays / 10);
    const score = impact * confidence * tierMult * imp;
    tasks.push({
      key: `rev:phase:${p.modelName.toLowerCase()}:${today}`,
      kind: "phase",
      title: `Model „${p.modelName}" zurück zu ${p.previousChatter}`,
      why: `Seit ${p.currDays} Tagen auf ${p.currentChatter}: Ø ${fmtEur(p.currAvg)}/Tag. Vorher mit ${p.previousChatter}: ${fmtEur(p.prevAvg)}/Tag.`,
      impactEurPerWeek: impact,
      confidence,
      score,
      modelName: p.modelName,
      chatterName: p.currentChatter,
      secondaryChatter: p.previousChatter,
    });
  }

  /* 3. TIER-MISMATCH (Pull-up) */
  const underusedByAcc = new Map<string, MismatchEntry>();
  for (const u of mismatchRes.underused) {
    underusedByAcc.set(u.account.toLowerCase(), u);
  }
  for (const pull of mismatchRes.pullUp) {
    // Suche Underused-Partner mit großem Account, dessen Followers > pulls Followers
    const candidate = mismatchRes.underused.find(
      (u) => (followersByAcc.get(u.account.toLowerCase()) ?? 0) >
             (followersByAcc.get(pull.account.toLowerCase()) ?? 0)
    );
    const targetAcc = candidate?.account ?? null;
    const targetFollowers = targetAcc ? (followersByAcc.get(targetAcc.toLowerCase()) ?? 0) : 0;
    // Erwartete Mehrleistung: pulls Stunden auf größerem Account → konservativ
    // 1h Aktivität auf Top/Growth-Account ≈ 8€/h Median → 8€ × (avg h) × 7
    const estPerDay = candidate
      ? Math.max(40, pull.avgHoursPerDay * 8)
      : Math.max(30, pull.avgHoursPerDay * 5);
    const impact = estPerDay * 7;
    if (impact < MIN_IMPACT_EUR_PER_WEEK) continue;
    const tierMult = tierMultiplierFromFollowers(targetFollowers || 1500);
    const imp = importanceFor(totals30, pull.chatterName);
    const score = impact * 0.6 * tierMult * imp;
    tasks.push({
      key: `rev:mismatch:${pull.key}:${today}`,
      kind: "mismatch",
      title: candidate
        ? `Tausch: ${pull.chatterName} ↔ ${candidate.chatterName} (${candidate.account})`
        : `${pull.chatterName} auf größeren Account ziehen`,
      why: candidate
        ? `${pull.chatterName} schiebt Ø ${pull.avgHoursPerDay.toFixed(1)}h/Tag auf ${pull.tier.label} „${pull.account}". ${candidate.chatterName} sitzt auf ${candidate.tier.label} „${candidate.account}" (${candidate.avgHoursPerDay.toFixed(1)}h/Tag).`
        : `${pull.chatterName} liefert Ø ${pull.avgHoursPerDay.toFixed(1)}h/Tag auf ${pull.tier.label} „${pull.account}" — größerer Account würde diese Zeit monetarisieren.`,
      impactEurPerWeek: impact,
      confidence: 0.6,
      score,
      chatterName: pull.chatterName,
      secondaryChatter: candidate?.chatterName ?? null,
      modelName: candidate?.account ?? null,
    });
  }

  /* 4. ACCOUNT-TAUSCH (neue Engine) */
  tasks.push(...swapTasks);

  /* 4b. DOWNGRADE-KANDIDATEN (eigene Karte, klare Kriterien) */
  tasks.push(...downgradeTasks);




  /* 5. HOCHFREQUENZ-LÜCKE */
  const slotGaps = detectSlotGaps(hourly, chatterCurrentAccount, followersByAcc);
  for (const g of slotGaps) {
    const impact = g.expectedEurPerDay; // einmalig „heute verloren", bewerten wir nicht ×7
    if (impact < MIN_IMPACT_EUR_PER_WEEK) continue;
    const followers = followersByAcc.get(g.account.toLowerCase()) ?? 0;
    const tierMult = tierMultiplierFromFollowers(followers);
    const score = impact * 1.3 * tierMult; // hoher Hebel: sofort umsetzbar
    tasks.push({
      key: `rev:slot:${g.account.toLowerCase()}:${today}`,
      kind: "slot",
      title: `„${g.account}": Peak-Slot ${fmtHourRange(g.hours)} unbesetzt`,
      why: `Ø ${fmtEur(g.expectedEurPerDay)} verlieren pro Tag, wenn diese Stunden leer bleiben. Jemand auf den Account.`,
      impactEurPerWeek: impact,
      confidence: 0.9,
      score,
      modelName: g.account,
    });
  }

  /* DEDUPE pro Chatter (außer Slot — Account-bezogen; außer Swap — eigene Logik
     in der Engine, darf nicht mit Recovery/Phase/Mismatch um die MAX_TASKS-Slots
     konkurrieren). */
  const seenChatter = new Set<string>();
  const sorted = [...tasks].sort((a, b) => b.score - a.score);
  const final: RevenueTask[] = [];
  const swapsOnly: RevenueTask[] = [];
  for (const t of sorted) {
    if (t.kind === "swap" || t.kind === "upgrade" || t.kind === "downgrade") {
      swapsOnly.push(t);
      continue;
    }
    if (t.kind !== "slot" && t.chatterName) {
      const k = normalizeChatterName(t.chatterName);
      if (seenChatter.has(k)) continue;
      seenChatter.add(k);
    }
    final.push(t);
    if (final.length >= MAX_TASKS) break;
  }
  // Swap- + Upgrade-Tasks immer komplett mitliefern — Heute-Tab paginiert selbst.
  final.push(...swapsOnly);
  return final;
}
