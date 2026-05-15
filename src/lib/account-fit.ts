/**
 * Account-Fit-Matrix
 *
 * Pro (chatter, account)-Paar wird aus 90 Tagen `chatter_history` ein
 * fitScore (0..100) berechnet — wie gut hat dieser Chatter historisch
 * auf diesem konkreten Account geliefert (vs. seine eigene Baseline und
 * vs. andere Chatter, die je auf diesem Account waren).
 *
 * Wichtige Vereinfachung: Wenn ein Chatter an einem Tag mehrere Accounts
 * hatte, splitten wir Tagesumsatz hier nicht — wir nutzen die Account-
 * Zeile direkt aus `chatter_history` (die schon pro Account aufgelistet ist).
 */
import { supabase } from "@/integrations/supabase/client";
import { normalizeChatterName } from "@/lib/active-chatters";

export interface FitEntry {
  chatterKey: string;          // normalisierter Name
  chatterName: string;         // original Anzeige
  accountKey: string;          // lowercase trimmed
  accountName: string;         // original
  days: number;                // Tage mit revenue > 0
  totalRevenue: number;
  avgPerDay: number;
  /** Letzte zusammenhängende Phase auf diesem Account: ISO-Datum erstes/letztes */
  lastPhaseFrom: string | null;
  lastPhaseTo: string | null;
  lastPhaseDays: number;
  /** Rang unter allen Chattern auf diesem Account (1 = bester) */
  rankOnAccount: number;
  totalChattersOnAccount: number;
  /** avgPerDay vs. Median anderer Chatter auf diesem Account (>1 = überdurchschnittlich) */
  vsPeerOnAccount: number;
  /** 0..100 — gewichtete Kombi aus Rank + vsPeer + Stichprobe */
  fitScore: number;
  /** "low" <3 Tage, "medium" 3-9, "high" ≥10 */
  confidence: "low" | "medium" | "high";
}

export interface AccountFitMatrix {
  /** Key: `${chatterKey}|${accountKey}` */
  byPair: Map<string, FitEntry>;
  /** Pro Account: alle Chatter, die je drauf waren — sortiert nach avgPerDay desc */
  byAccount: Map<string, FitEntry[]>;
  /** Pro Chatter: alle Accounts, die er je hatte — sortiert nach avgPerDay desc */
  byChatter: Map<string, FitEntry[]>;
  /** Median avgPerDay aller Einträge mit ≥3 Tagen, pro Account */
  peerMedianByAccount: Map<string, number>;
}

interface Row {
  chatter_name: string;
  account: string | null;
  analysis_date: string;
  revenue_today: number | null;
}

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function pairKey(chatterKey: string, accountKey: string) {
  return `${chatterKey}|${accountKey}`;
}

export function fitPairKey(chatterName: string, accountName: string): string {
  return pairKey(normalizeChatterName(chatterName), accountName.toLowerCase().trim());
}

export async function loadAccountFitMatrix(platform: string): Promise<AccountFitMatrix> {
  const { data: { user } } = await supabase.auth.getUser();
  const empty: AccountFitMatrix = {
    byPair: new Map(), byAccount: new Map(), byChatter: new Map(), peerMedianByAccount: new Map(),
  };
  if (!user) return empty;

  const since = isoDaysAgo(90);
  const { data } = await supabase
    .from("chatter_history")
    .select("chatter_name, account, analysis_date, revenue_today")
    .eq("user_id", user.id)
    .ilike("platform", platform)
    .gte("analysis_date", since);

  const rows = (data ?? []) as Row[];

  // Aggregiere pro (chatter, account, date) — i.d.R. eindeutig, aber zur Sicherheit summieren
  type Bucket = {
    chatterName: string;
    accountName: string;
    days: Map<string, number>;     // date -> revenue
  };
  const buckets = new Map<string, Bucket>();
  for (const r of rows) {
    if (!r.chatter_name || !r.account) continue;
    const accs = r.account.split(",").map(a => a.trim()).filter(Boolean);
    if (!accs.length) continue;
    const rev = Number(r.revenue_today) || 0;
    // Wenn mehrere Accounts in einer Zeile: pro Account anteilig (gleichgewichtet)
    const per = accs.length > 0 ? rev / accs.length : 0;
    for (const acc of accs) {
      const ck = normalizeChatterName(r.chatter_name);
      const ak = acc.toLowerCase();
      const k = pairKey(ck, ak);
      let b = buckets.get(k);
      if (!b) {
        b = { chatterName: r.chatter_name, accountName: acc, days: new Map() };
        buckets.set(k, b);
      }
      b.days.set(r.analysis_date, (b.days.get(r.analysis_date) ?? 0) + per);
    }
  }

  // Baue erste Pass-Entries
  const entries = new Map<string, FitEntry>();
  for (const [k, b] of buckets) {
    const [ck, ak] = k.split("|");
    const dates = Array.from(b.days.keys()).sort();
    const revs = dates.map(d => b.days.get(d)!).filter(v => v > 0);
    const totalRevenue = revs.reduce((s, v) => s + v, 0);
    const days = revs.length;
    const avgPerDay = days > 0 ? totalRevenue / days : 0;

    // Letzte zusammenhängende Phase (Lücke ≤2 Tage erlaubt)
    let phaseFrom: string | null = null;
    let phaseTo: string | null = null;
    let phaseDays = 0;
    if (dates.length > 0) {
      let prev: string | null = null;
      let curStart = dates[0];
      let curEnd = dates[0];
      let curDays = 0;
      const allPhases: { from: string; to: string; days: number }[] = [];
      for (const d of dates) {
        if (prev) {
          const gap = (Date.parse(d) - Date.parse(prev)) / 86400000;
          if (gap > 3) {
            allPhases.push({ from: curStart, to: curEnd, days: curDays });
            curStart = d;
            curDays = 0;
          }
        }
        curEnd = d;
        curDays++;
        prev = d;
      }
      allPhases.push({ from: curStart, to: curEnd, days: curDays });
      const last = allPhases[allPhases.length - 1];
      phaseFrom = last.from;
      phaseTo = last.to;
      phaseDays = last.days;
    }

    entries.set(k, {
      chatterKey: ck,
      chatterName: b.chatterName,
      accountKey: ak,
      accountName: b.accountName,
      days,
      totalRevenue,
      avgPerDay,
      lastPhaseFrom: phaseFrom,
      lastPhaseTo: phaseTo,
      lastPhaseDays: phaseDays,
      rankOnAccount: 0,
      totalChattersOnAccount: 0,
      vsPeerOnAccount: 1,
      fitScore: 0,
      confidence: days >= 10 ? "high" : days >= 3 ? "medium" : "low",
    });
  }

  // Group nach Account → Rank + Peer-Median
  const byAccount = new Map<string, FitEntry[]>();
  for (const e of entries.values()) {
    if (!byAccount.has(e.accountKey)) byAccount.set(e.accountKey, []);
    byAccount.get(e.accountKey)!.push(e);
  }
  const peerMedianByAccount = new Map<string, number>();
  for (const [acc, list] of byAccount) {
    list.sort((a, b) => b.avgPerDay - a.avgPerDay);
    const eligible = list.filter(e => e.days >= 3).map(e => e.avgPerDay);
    const med = median(eligible);
    peerMedianByAccount.set(acc, med);
    list.forEach((e, idx) => {
      e.rankOnAccount = idx + 1;
      e.totalChattersOnAccount = list.length;
      // Peer-Vergleich: andere Chatter ohne diesen
      const others = list.filter(x => x.chatterKey !== e.chatterKey && x.days >= 3).map(x => x.avgPerDay);
      const otherMed = median(others);
      e.vsPeerOnAccount = otherMed > 0 ? e.avgPerDay / otherMed : (e.avgPerDay > 0 ? 1.5 : 0);

      // fitScore 0..100
      // 50 % vsPeer (capped 0..2 → 0..100), 30 % rank-Position, 20 % stichproben-konfidenz
      const peerComp = Math.min(2, e.vsPeerOnAccount) / 2 * 100;
      const rankComp = list.length > 1
        ? (1 - (idx / (list.length - 1))) * 100
        : 60; // alleiniger Chatter → neutral leicht positiv
      const sampleComp = Math.min(1, e.days / 10) * 100;
      e.fitScore = Math.round(0.5 * peerComp + 0.3 * rankComp + 0.2 * sampleComp);
    });
  }

  // Group nach Chatter
  const byChatter = new Map<string, FitEntry[]>();
  for (const e of entries.values()) {
    if (!byChatter.has(e.chatterKey)) byChatter.set(e.chatterKey, []);
    byChatter.get(e.chatterKey)!.push(e);
  }
  for (const list of byChatter.values()) {
    list.sort((a, b) => b.avgPerDay - a.avgPerDay);
  }

  return { byPair: entries, byAccount, byChatter, peerMedianByAccount };
}

export function getFit(matrix: AccountFitMatrix, chatterName: string, accountName: string): FitEntry | null {
  return matrix.byPair.get(fitPairKey(chatterName, accountName)) ?? null;
}
