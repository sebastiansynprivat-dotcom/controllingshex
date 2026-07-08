/**
 * Downgrade-Kandidaten — eigene "Heute"-Karte neben Upgrade-Kandidaten.
 *
 * Zwei klar getrennte Buckets, jeweils mit sichtbarem Warum:
 *
 *   A) INAKTIV — Chatter ist im letzten Report, hat aber im Zeitfenster
 *      (7 Tage) 0 Sessions, 0 Umsatz, 0 Mass-DMs, 0 bearbeitete Nachrichten.
 *      Neue Chatter (Onboarding < 4 Tage her) werden ausgeschlossen.
 *
 *   B) VOLUMEN OHNE KONVERSION — Chatter × Account bekommt viel Traffic,
 *      dreht ihn aber schlecht in Umsatz:
 *        - Nachrichten ≥ max(30, Median über alle Kombis)
 *        - €/Msg ≤ 50 % vom volumen-gewichteten Plattform-Ø
 *        - Muster hält an ≥ 3 der letzten 7 Tage
 *
 * Dedup: max 1 Karte pro Chatter. A schlägt B. Weitere B-Accounts desselben
 * Chatters werden als Nebenevidenz im Warum-Text erwähnt.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  loadActiveChatterNames,
  loadActiveChatterModels,
  normalizeAccountName,
  normalizeChatterName,
} from "@/lib/active-chatters";
import type { RevenueTask } from "@/lib/revenue-tasks";

const WINDOW_DAYS = 7;
const ONBOARDING_MIN_DAYS = 4;
const MIN_MESSAGES = 30;
const EFF_RATIO_MAX = 0.5; // ≤ 50 % vom Plattform-Ø
const IMPACT_EFF_TARGET_RATIO = 0.7; // Ziel-€/Msg bei Downgrade: 70 % Plattform-Ø
const PERSISTENCE_DAYS = 3;

function todayISO(): string {
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
function fmtEurFine(v: number): string {
  return v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
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
  revenue_today: number | null;
  mass_dms: number | null;
  open_chats: number | null;
}
interface SessionRow {
  chatter_name: string;
  date: string;
  duration_min: number | null;
  revenue_in_session: number | null;
  mass_dms_in_session: number | null;
  incoming_proxy: number | null;
}
interface OnboardingRow {
  chatter_name: string;
  onboarded_on: string;
  report_day: number;
}
interface ComboAgg {
  chatterKey: string;
  chatter: string;
  account: string;
  messages: number;
  revenue: number;
  daysUnderRatio: number; // Anzahl Tage mit ≤ EFF_RATIO_MAX
  daysWithData: number;
  firstPatternDate: string | null; // frühestes Datum, an dem das Muster erfüllt war
}

export async function buildDowngradeCandidates(platform: string): Promise<RevenueTask[]> {
  const today = todayISO();
  const from = isoDaysAgo(WINDOW_DAYS - 1);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const activeNames = await loadActiveChatterNames(platform);
  if (!activeNames) return []; // Kein Report → nicht filtern, aber auch keine Karten
  if (activeNames.size === 0) return [];
  const activeChatterModels = (await loadActiveChatterModels(platform)) ?? new Map();

  const [historyRes, sessionsRes, onboardingRes] = await Promise.all([
    (async () => {
      const pageSize = 1000;
      const all: HistoryRow[] = [];
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await supabase
          .from("chatter_history")
          .select("chatter_name, account, analysis_date, revenue_today, mass_dms, open_chats")
          .eq("user_id", user.id)
          .ilike("platform", platform)
          .gte("analysis_date", from)
          .lte("analysis_date", today)
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        const page = (data ?? []) as HistoryRow[];
        all.push(...page);
        if (page.length < pageSize) break;
      }
      return all;
    })(),
    supabase
      .from("chatter_activity_sessions")
      .select("chatter_name, date, duration_min, revenue_in_session, mass_dms_in_session, incoming_proxy")
      .eq("user_id", user.id)
      .ilike("platform", platform)
      .gte("date", from)
      .lte("date", today),
    supabase.rpc("get_chatter_onboarding", { p_platform: platform }),
  ]);

  const history = (historyRes ?? []).filter(
    (r) => r.chatter_name && activeNames.has(normalizeChatterName(r.chatter_name)),
  );
  const sessions = ((sessionsRes.data ?? []) as SessionRow[]).filter(
    (r) => r.chatter_name && activeNames.has(normalizeChatterName(r.chatter_name)),
  );
  const onboarding = ((onboardingRes.data ?? []) as OnboardingRow[]);
  const onboardedOnByKey = new Map<string, string>();
  for (const o of onboarding) {
    if (o.chatter_name) onboardedOnByKey.set(normalizeChatterName(o.chatter_name), o.onboarded_on);
  }

  const now = new Date(today + "T00:00:00Z").getTime();
  const daysSinceOnboarding = (name: string): number => {
    const k = normalizeChatterName(name);
    const d = onboardedOnByKey.get(k);
    if (!d) return 999;
    const t = new Date(d + "T00:00:00Z").getTime();
    return Math.floor((now - t) / 86400_000);
  };

  // ---- Original-Name Cache (letzte Schreibweise gewinnt) ----
  const originalNameByKey = new Map<string, string>();
  for (const r of history) {
    originalNameByKey.set(normalizeChatterName(r.chatter_name), r.chatter_name);
  }

  // ---- Aktivität pro Chatter (7T) ----
  interface ActivityAgg {
    key: string;
    display: string;
    sessions: number;
    durationMin: number;
    revenue: number;
    massDms: number;
    incoming: number;
    historyRevenue: number;
    historyMassDms: number;
    historyOpenChats: number;
    lastActivityDate: string | null;
    avgRevenuePerActiveDay: number;
  }
  const activity = new Map<string, ActivityAgg>();
  const getOrInit = (name: string): ActivityAgg => {
    const key = normalizeChatterName(name);
    let a = activity.get(key);
    if (!a) {
      a = {
        key,
        display: originalNameByKey.get(key) ?? name,
        sessions: 0,
        durationMin: 0,
        revenue: 0,
        massDms: 0,
        incoming: 0,
        historyRevenue: 0,
        historyMassDms: 0,
        historyOpenChats: 0,
        lastActivityDate: null,
        avgRevenuePerActiveDay: 0,
      };
      activity.set(key, a);
    }
    return a;
  };
  for (const s of sessions) {
    const a = getOrInit(s.chatter_name);
    a.sessions += 1;
    a.durationMin += Number(s.duration_min) || 0;
    a.revenue += Number(s.revenue_in_session) || 0;
    a.massDms += Number(s.mass_dms_in_session) || 0;
    a.incoming += Number(s.incoming_proxy) || 0;
    if (!a.lastActivityDate || s.date > a.lastActivityDate) a.lastActivityDate = s.date;
  }
  const revenueDaysByKey = new Map<string, Map<string, number>>();
  for (const r of history) {
    const a = getOrInit(r.chatter_name);
    a.historyRevenue += Number(r.revenue_today) || 0;
    a.historyMassDms += Number(r.mass_dms) || 0;
    a.historyOpenChats += Number(r.open_chats) || 0;
    const rev = Number(r.revenue_today) || 0;
    if (rev > 0) {
      const m = revenueDaysByKey.get(a.key) ?? new Map<string, number>();
      m.set(r.analysis_date, (m.get(r.analysis_date) ?? 0) + rev);
      revenueDaysByKey.set(a.key, m);
    }
  }
  for (const a of activity.values()) {
    const m = revenueDaysByKey.get(a.key);
    if (m && m.size > 0) {
      const vals = [...m.values()];
      a.avgRevenuePerActiveDay = vals.reduce((s, v) => s + v, 0) / vals.length;
    }
  }
  // Chatter, die im Roster sind, aber gar keine Zeile hatten → auch aufnehmen
  for (const key of activeNames) {
    if (!activity.has(key)) {
      activity.set(key, {
        key,
        display: originalNameByKey.get(key) ?? key,
        sessions: 0,
        durationMin: 0,
        revenue: 0,
        massDms: 0,
        incoming: 0,
        historyRevenue: 0,
        historyMassDms: 0,
        historyOpenChats: 0,
        lastActivityDate: null,
        avgRevenuePerActiveDay: 0,
      });
    }
  }

  // ============ Bucket B: Volumen ohne Konversion ============
  // Chatter × Account × Tag → Baseline berechnen, dann Kombis filtern.
  interface DayCell { messages: number; revenue: number; }
  const perComboDay = new Map<string, Map<string, DayCell>>(); // key = chatterKey||accountLower
  const comboLabels = new Map<string, { chatter: string; account: string }>();
  for (const r of history) {
    const name = r.chatter_name;
    if (!name || !r.account) continue;
    const accounts = r.account.split(",").map((s) => s.trim()).filter(Boolean);
    if (accounts.length === 0) continue;
    // Nachrichten & Umsatz gleich verteilt auf angegebene Accounts (in der Regel 1).
    const share = 1 / accounts.length;
    const msg = (Number(r.open_chats) || 0) * share;
    const rev = (Number(r.revenue_today) || 0) * share;
    if (msg <= 0 && rev <= 0) continue;
    const chKey = normalizeChatterName(name);
    const allowedAccs = activeChatterModels.get(chKey);
    for (const acc of accounts) {
      // Nur Kombis, die im NEUESTEN Report noch existieren. Historische
      // Zuordnungen (z. B. Chatter hatte Account X, hat ihn heute nicht mehr)
      // dürfen keine Downgrade-Karte auslösen.
      if (allowedAccs && !allowedAccs.has(normalizeAccountName(acc))) continue;
      const key = `${chKey}||${acc.toLowerCase()}`;
      if (!comboLabels.has(key)) comboLabels.set(key, { chatter: name, account: acc });
      const dayMap = perComboDay.get(key) ?? new Map<string, DayCell>();
      const cell = dayMap.get(r.analysis_date) ?? { messages: 0, revenue: 0 };
      cell.messages += msg;
      cell.revenue += rev;
      dayMap.set(r.analysis_date, cell);
      perComboDay.set(key, dayMap);
    }
  }

  // Baseline = gewichtetes Ø €/Msg über alle Kombis mit Traffic
  let totMsg = 0, totRev = 0;
    const comboAggs: ComboAgg[] = [];
    for (const [key, dayMap] of perComboDay) {
      let m = 0, r = 0;
      for (const c of dayMap.values()) { m += c.messages; r += c.revenue; }
      if (m <= 0) continue;
      totMsg += m; totRev += r;
      const label = comboLabels.get(key)!;
      comboAggs.push({
        chatterKey: key.split("||")[0],
        chatter: label.chatter,
        account: label.account,
        messages: m,
        revenue: r,
        daysUnderRatio: 0,
        daysWithData: dayMap.size,
        firstPatternDate: null,
      });
    }
  const avgEff = totMsg > 0 ? totRev / totMsg : 0;
  const volumeMedian = median(comboAggs.map((c) => c.messages));
  const msgThreshold = Math.max(MIN_MESSAGES, volumeMedian);

  // Persistenz pro Kombi: an wie vielen Tagen war €/Msg ≤ 50 % Ø
  for (const c of comboAggs) {
    const dayMap = perComboDay.get(`${c.chatterKey}||${c.account.toLowerCase()}`)!;
    let n = 0;
    let firstPatternDate: string | null = null;
    for (const [date, cell] of dayMap) {
      if (cell.messages < 5) continue; // Ein-Nachrichten-Tage überspringen
      const eff = cell.revenue / cell.messages;
      if (eff <= avgEff * EFF_RATIO_MAX) {
        n += 1;
        if (!firstPatternDate || date < firstPatternDate) firstPatternDate = date;
      }
    }
    c.daysUnderRatio = n;
    c.firstPatternDate = firstPatternDate;
  }

  const bucketB = comboAggs.filter((c) => {
    const eff = c.messages > 0 ? c.revenue / c.messages : 0;
    return (
      c.messages >= msgThreshold &&
      avgEff > 0 &&
      eff <= avgEff * EFF_RATIO_MAX &&
      c.daysUnderRatio >= PERSISTENCE_DAYS
    );
  });

  // Pro Chatter: höchstes Volumen gewinnt, weitere als Nebenevidenz
  const bucketBByChatter = new Map<string, { primary: ComboAgg; others: ComboAgg[] }>();
  bucketB.sort((a, b) => b.messages - a.messages);
  for (const c of bucketB) {
    const entry = bucketBByChatter.get(c.chatterKey);
    if (!entry) bucketBByChatter.set(c.chatterKey, { primary: c, others: [] });
    else entry.others.push(c);
  }

  // ============ Bucket A: Inaktiv ============
  const bucketA: ActivityAgg[] = [];
  for (const a of activity.values()) {
    if (daysSinceOnboarding(a.display) < ONBOARDING_MIN_DAYS) continue;
    const noSession = a.sessions === 0;
    const noRevenue = a.revenue === 0 && a.historyRevenue === 0;
    const noMass = a.massDms === 0 && a.historyMassDms === 0;
    const noIncoming = a.incoming === 0 && a.historyOpenChats === 0;
    if (noSession && noRevenue && noMass && noIncoming) bucketA.push(a);
  }

  // ============ Task-Erzeugung ============
  const tasks: RevenueTask[] = [];
  const emittedChatters = new Set<string>();

  // A zuerst — dominiert bei Overlap
  for (const a of bucketA) {
    if (emittedChatters.has(a.key)) continue;
    emittedChatters.add(a.key);
    const dayAge = daysSinceOnboarding(a.display);
    const baselinePerDay = a.avgRevenuePerActiveDay;
    const cost = Math.max(0, Math.round(baselinePerDay * 7));
    const whyBits: string[] = [
      `Seit ${WINDOW_DAYS} Tagen: 0 Sessions, 0 € Umsatz, 0 Mass-DMs, 0 Nachrichten bearbeitet.`,
    ];
    if (baselinePerDay > 0) {
      whyBits.push(`Historischer Ø ${fmtEur(baselinePerDay)}/Tag geht komplett verloren.`);
    }
    if (Number.isFinite(dayAge) && dayAge < 999) {
      whyBits.push(`Onboarding: Tag ${dayAge + 1}.`);
    }
    tasks.push({
      key: `rev:downgrade:inactive:${a.key}:${today}`,
      kind: "downgrade",
      title: `${a.display} — komplett inaktiv (${WINDOW_DAYS}T)`,
      why: whyBits.join(" "),
      impactEurPerWeek: cost,
      confidence: 0.9,
      score: 1_000_000 + cost, // Inaktiv immer oben
      chatterName: a.display,
      modelName: null,
      meta: { downgradeSince: a.lastActivityDate ?? onboardedOnByKey.get(a.key) ?? from },
    });
  }

  // B danach
  for (const [chKey, entry] of bucketBByChatter) {
    if (emittedChatters.has(chKey)) continue;
    emittedChatters.add(chKey);
    const c = entry.primary;
    const eff = c.messages > 0 ? c.revenue / c.messages : 0;
    const gap = avgEff > 0 ? (1 - eff / avgEff) : 0;
    const msgsPerDay = c.messages / Math.max(1, c.daysWithData);
    const impact = Math.max(
      0,
      Math.round((avgEff * IMPACT_EFF_TARGET_RATIO - eff) * (c.messages) * (7 / Math.max(1, c.daysWithData))),
    );
    const whyBits: string[] = [
      `Account „${c.account}" bekommt Ø ${Math.round(msgsPerDay)} Msg/Tag, aber nur ${fmtEurFine(eff)}/Msg (Plattform-Ø ${fmtEurFine(avgEff)}, ${Math.round(gap * 100)} % darunter).`,
      `Muster an ${c.daysUnderRatio} von ${c.daysWithData} Tagen im Zeitfenster.`,
    ];
    if (entry.others.length > 0) {
      const list = entry.others.slice(0, 2).map((o) => `„${o.account}"`).join(", ");
      whyBits.push(`Zusätzlich betroffen: ${list}.`);
    }
    tasks.push({
      key: `rev:downgrade:waste:${chKey}:${c.account.toLowerCase()}:${today}`,
      kind: "downgrade",
      title: `${c.chatter} auf „${c.account}" — Volumen ohne Konversion`,
      why: whyBits.join(" "),
      impactEurPerWeek: impact,
      confidence: 0.75,
      score: impact + c.messages, // primär nach Impact, sekundär Volumen
      chatterName: c.chatter,
      modelName: c.account,
      meta: { downgradeSince: c.firstPatternDate ?? from },
    });
  }

  return tasks;
}
