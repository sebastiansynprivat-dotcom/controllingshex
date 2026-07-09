/**
 * Account-Swap-Engine — neue Heute-Tab Logik für „Account-Tausch".
 *
 * Ersetzt komplett die alte SWAP-Engine (Skill-Score / Fit-Matrix / Tier-Median).
 *
 * Logik:
 *   Downgrade-Trigger (alle: Account > 500 Follower):
 *     A) Chats im Verzug (response_delay_days > 0 im letzten Report)
 *     B) Unterperformance: 14d-Schnitt < 60 % vom Lifetime-Schnitt (gepoolt, ≥ 14d Historie)
 *     C) Null-Euro-Serie > 7 aufeinanderfolgende Tage (Reportlücken übersprungen)
 *
 *   Upgrade-Typen:
 *     X) Seed-Chatter < 300 Follower (Prio 1 mit Revenue, Prio 2 ohne Revenue) → wechselt
 *     Y) Solo-Chatter (genau 1 Account) > 300 Follower, 14d ≥ 110 % Lifetime → DAZU
 *     Z) Beliebiger Chatter, 14d ≥ 110 % Lifetime auf Ist-Account, Ziel-Account ≥ 120 %
 *        vom Lifetime-Schnitt des Ist-Accounts → wechselt (Hochstufung)
 *
 *   Matching: Downgrade-Slots sortiert (zero_streak > delay > underperformance,
 *   Followers DESC) bekommen den jeweils stärksten verfügbaren Upgrade-Kandidaten:
 *   Y > Z > X-Prio-1 > X-Prio-2.
 */
import { supabase } from "@/integrations/supabase/client";
import { loadActiveChatterNames, normalizeChatterName } from "@/lib/active-chatters";
import { fetchLiveEfficiency, hasUsableLiveData, type LiveEfficiencyRow } from "@/lib/live-efficiency";
import { tierForFollowers, type AccountTierId } from "@/lib/account-tiers";
import type { RevenueTask } from "@/lib/revenue-tasks";

// ---------- Konstanten ----------
const DOWNGRADE_FOLLOWER_MIN = 500;
const SEED_FOLLOWER_MAX = 300;
const TYPE_Y_FOLLOWER_MIN = 300;
const UNDERPERFORM_RATIO = 0.6;
const OVERPERFORM_RATIO = 1.1;
const PROMOTION_ACCOUNT_RATIO = 1.2;
const HEALTHY_ACCOUNT_RATIO = 1.0;
const PRODUCTIVE_PAIR_RATIO = 0.8;
const PRODUCTIVE_PAIR_MIN_EUR = 30;
const MIN_DELAY_DAYS_FOR_SWAP = 2;
const MIN_SEED_RECENT_AVG = 10;
const MIN_LIFETIME_DAYS = 14;
const RECENT_WINDOW_DAYS = 14;
const ZERO_STREAK_DAYS = 7;

// High-Converter Klasse — nutzt Live-Efficiency (RPC get_live_efficiency).
const HC_WINDOW_DAYS = 14;
const HC_MIN_INCOMING = 50;         // Volumen-Gate
const HC_LIFT_FACTOR = 1.3;         // eur/incoming ≥ 1.3× Peer-Median des aktuellen Tiers
const HC_MIN_TIER_SAMPLE = 3;       // Median nur zuverlässig ab n=3 Peers im Tier



// ---------- Typen ----------
interface HistoryRow {
  chatter_name: string;
  account: string | null;
  analysis_date: string;
  revenue_today: number;
  response_delay_days: number;
}

interface ModelRow {
  model_name: string;
  follower_count: number;
}

type DowngradeReason = "delay" | "underperformance" | "zero_streak";

interface DowngradeCandidate {
  chatter: string;
  accountKey: string;
  accountLabel: string;
  followers: number;
  reason: DowngradeReason;
  lifetimeAvg: number | null;
  recent14d: number;
  streakDays: number;
  delayDays: number;
  severityRank: number; // 0 = zero_streak, 1 = delay, 2 = underperformance
}

type UpgradeType = "seed_p1" | "seed_p2" | "second_account" | "promotion" | "high_converter";

interface UpgradeCandidate {
  chatter: string;
  type: UpgradeType;
  currentAccountKey: string;
  currentAccountLabel: string;
  currentFollowers: number;
  currentLifetimeAvg: number | null;
  recent14d: number;
  ratio: number; // 14d / lifetime
  todayRevenue: number;
  /** Nur Typ Z: Slot-spezifischer Score (Ziel-Account-Lifetime / Ist-Lifetime). */
  promotionDiff?: number;
  /** Nur high_converter: €/eingehende Nachricht (letzte 14T). */
  eurPerIncoming?: number;
  /** Nur high_converter: Peer-Median €/Nachricht im aktuellen Tier. */
  tierMedianEurPerIncoming?: number;
  /** Nur high_converter: aktuelles Tier-Label des Chatters. */
  currentTierLabel?: string;
  /** Nur high_converter: Volumen (incoming proxy) im Fenster. */
  incomingCount?: number;
}

interface SwapMatch {
  downgrade: DowngradeCandidate;
  upgrade: UpgradeCandidate | null;
}

// ---------- Helpers ----------
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

function splitAccounts(account: string | null): string[] {
  if (!account) return [];
  return account
    .split(/[,;|]/)
    .map((a) => a.trim())
    .filter(Boolean);
}

function accKey(label: string): string {
  return label.toLowerCase().trim();
}

// ---------- Aggregationen ----------
interface PairKey {
  chatter: string;
  accountKey: string;
}

/** Map<chatter|accountKey, Array<{date, rev}>> sortiert nach Datum aufsteigend. */
function groupByChatterAccount(rows: HistoryRow[]): Map<string, { date: string; rev: number; delay: number }[]> {
  const out = new Map<string, { date: string; rev: number; delay: number }[]>();
  for (const r of rows) {
    const accs = splitAccounts(r.account);
    if (accs.length === 0) continue;
    // Revenue wird pro Account NICHT geteilt — wir behandeln jeden gelisteten
    // Account als „Chatter saß auch hier"; das ist konservativ und matcht die
    // bestehende Phase-Logik in revenue-tasks.ts.
    for (const a of accs) {
      const key = `${normalizeChatterName(r.chatter_name)}|${accKey(a)}`;
      if (!out.has(key)) out.set(key, []);
      out.get(key)!.push({
        date: r.analysis_date,
        rev: Number(r.revenue_today) || 0,
        delay: Number(r.response_delay_days) || 0,
      });
    }
  }
  for (const arr of out.values()) arr.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

/** Lifetime-Schnitt (Tages-Umsatz, alle Chatter gepoolt) pro Account. null bei <14d. */
function getAccountLifetimeAverages(rows: HistoryRow[]): Map<string, number | null> {
  // accountKey → date → summed rev
  const byAcc = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const accs = splitAccounts(r.account);
    if (accs.length === 0) continue;
    for (const a of accs) {
      const k = accKey(a);
      if (!byAcc.has(k)) byAcc.set(k, new Map());
      const dm = byAcc.get(k)!;
      const rev = Number(r.revenue_today) || 0;
      dm.set(r.analysis_date, (dm.get(r.analysis_date) ?? 0) + rev);
    }
  }
  const out = new Map<string, number | null>();
  for (const [k, dm] of byAcc) {
    if (dm.size < MIN_LIFETIME_DAYS) {
      out.set(k, null);
      continue;
    }
    let sum = 0;
    for (const v of dm.values()) sum += v;
    out.set(k, sum / dm.size);
  }
  return out;
}

/** 14d-Schnitt (gepoolt, alle Chatter) pro Account. */
function getAccountRecentAverages(
  pairMap: Map<string, { date: string; rev: number; delay: number }[]>,
): Map<string, { avg: number; days: number }> {
  const cutoff = isoDaysAgo(RECENT_WINDOW_DAYS - 1);
  const byAcc = new Map<string, Map<string, number>>();
  for (const [key, entries] of pairMap) {
    const [, ak] = key.split("|");
    if (!byAcc.has(ak)) byAcc.set(ak, new Map());
    const dm = byAcc.get(ak)!;
    for (const e of entries) {
      if (e.date < cutoff) continue;
      dm.set(e.date, (dm.get(e.date) ?? 0) + e.rev);
    }
  }

  const out = new Map<string, { avg: number; days: number }>();
  for (const [ak, dm] of byAcc) {
    const days = dm.size;
    if (days === 0) continue;
    let sum = 0;
    for (const rev of dm.values()) sum += rev;
    out.set(ak, { avg: sum / days, days });
  }
  return out;
}

/** 14d-Schnitt eines (Chatter, Account)-Paars über aktive Tage. */
function getChatter14dAverage(entries: { date: string; rev: number }[]): { avg: number; days: number } {
  const cutoff = isoDaysAgo(RECENT_WINDOW_DAYS - 1);
  const recent = entries.filter((e) => e.date >= cutoff);
  if (recent.length === 0) return { avg: 0, days: 0 };
  const sum = recent.reduce((s, e) => s + e.rev, 0);
  return { avg: sum / recent.length, days: recent.length };
}

/**
 * Längste 0€-Serie am Ende der Historie. Tage ohne Report werden übersprungen
 * (zählen weder als 0 noch unterbrechen sie die Serie).
 */
function getZeroEuroStreak(entries: { date: string; rev: number }[]): number {
  let streak = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].rev === 0) streak++;
    else break;
  }
  return streak;
}

/** Map<chatter, Set<accountKey>> aus dem JÜNGSTEN Report-Datum jedes Chatters. */
function getLastReportAssignments(rows: HistoryRow[]): Map<string, Set<string>> {
  const latestDate = new Map<string, string>();
  for (const r of rows) {
    const ck = normalizeChatterName(r.chatter_name);
    const cur = latestDate.get(ck);
    if (!cur || r.analysis_date > cur) latestDate.set(ck, r.analysis_date);
  }
  const out = new Map<string, Set<string>>();
  for (const r of rows) {
    const ck = normalizeChatterName(r.chatter_name);
    if (r.analysis_date !== latestDate.get(ck)) continue;
    const accs = splitAccounts(r.account);
    if (!out.has(ck)) out.set(ck, new Set());
    for (const a of accs) out.get(ck)!.add(accKey(a));
  }
  return out;
}

/** Map<chatter, max response_delay_days im letzten Report>. */
function getDelayedChatters(rows: HistoryRow[]): Map<string, number> {
  const latestDate = new Map<string, string>();
  for (const r of rows) {
    const ck = normalizeChatterName(r.chatter_name);
    const cur = latestDate.get(ck);
    if (!cur || r.analysis_date > cur) latestDate.set(ck, r.analysis_date);
  }
  const out = new Map<string, number>();
  for (const r of rows) {
    const ck = normalizeChatterName(r.chatter_name);
    if (r.analysis_date !== latestDate.get(ck)) continue;
    const d = Number(r.response_delay_days) || 0;
    if (d > 0) out.set(ck, Math.max(out.get(ck) ?? 0, d));
  }
  return out;
}

// ---------- Detektoren ----------
function detectDowngrades(
  pairMap: Map<string, { date: string; rev: number; delay: number }[]>,
  followersByAcc: Map<string, number>,
  lifetimeByAcc: Map<string, number | null>,
  delayedByChatter: Map<string, number>,
  originalAccountLabel: Map<string, string>,
  originalChatterName: Map<string, string>,
  lastAssignments: Map<string, Set<string>>,
): DowngradeCandidate[] {
  const out: DowngradeCandidate[] = [];
  const accountRecentByAcc = getAccountRecentAverages(pairMap);

  for (const [key, entries] of pairMap) {
    const [ck, ak] = key.split("|");
    // Nur aktuelle Zuweisungen — wer auf dem Account nicht mehr sitzt, kann nicht
    // „Downgrade" sein.
    if (!lastAssignments.get(ck)?.has(ak)) continue;

    const followers = followersByAcc.get(ak) ?? 0;
    if (followers <= DOWNGRADE_FOLLOWER_MIN) continue;

    const lifetime = lifetimeByAcc.get(ak) ?? null;
    const { avg: recent14d } = getChatter14dAverage(entries);
    const streak = getZeroEuroStreak(entries);
    const delay = delayedByChatter.get(ck) ?? 0;

    const accountRecent = accountRecentByAcc.get(ak);
    const accountIsHealthy =
      lifetime != null &&
      lifetime > 0 &&
      !!accountRecent &&
      accountRecent.days >= 3 &&
      accountRecent.avg >= lifetime * HEALTHY_ACCOUNT_RATIO;
    const chatterLooksProductive =
      recent14d >= PRODUCTIVE_PAIR_MIN_EUR ||
      (lifetime != null && lifetime > 0 && recent14d >= lifetime * PRODUCTIVE_PAIR_RATIO);

    // Trigger C — Null-Euro-Serie (höchste Priorität).
    // Chatter-spezifisches Signal: 7+ Tage 0 € auf einem Account, den er aktuell
    // betreut. Greift auch wenn der Account insgesamt läuft — andere Chatter
    // tragen den Account, dieser hier produziert nicht.
    if (streak > ZERO_STREAK_DAYS) {
      out.push({
        chatter: originalChatterName.get(ck) ?? ck,
        accountKey: ak,
        accountLabel: originalAccountLabel.get(ak) ?? ak,
        followers,
        reason: "zero_streak",
        lifetimeAvg: lifetime,
        recent14d,
        streakDays: streak,
        delayDays: delay,
        severityRank: 0,
      });
      continue;
    }

    // Trigger A — Chats im Verzug. Aber: kein guter Performer wird nur wegen
    // 1–2 Tagen Delay von einem laufenden Account gezogen.
    if (delay >= MIN_DELAY_DAYS_FOR_SWAP && !chatterLooksProductive) {
      out.push({
        chatter: originalChatterName.get(ck) ?? ck,
        accountKey: ak,
        accountLabel: originalAccountLabel.get(ak) ?? ak,
        followers,
        reason: "delay",
        lifetimeAvg: lifetime,
        recent14d,
        streakDays: streak,
        delayDays: delay,
        severityRank: 1,
      });
      continue;
    }

    // Trigger B — Unterperformance vs. Lifetime.
    // Nur hier den Healthy-Guard anwenden: wenn der Account insgesamt auf
    // Lifetime-Niveau läuft, ist „14d-Schnitt eines Paars unter 60 %" kein
    // valides Signal — andere Chatter kompensieren ja.
    if (
      lifetime != null &&
      lifetime > 0 &&
      recent14d < lifetime * UNDERPERFORM_RATIO &&
      !accountIsHealthy
    ) {
      out.push({
        chatter: originalChatterName.get(ck) ?? ck,
        accountKey: ak,
        accountLabel: originalAccountLabel.get(ak) ?? ak,
        followers,
        reason: "underperformance",
        lifetimeAvg: lifetime,
        recent14d,
        streakDays: streak,
        delayDays: delay,
        severityRank: 2,
      });
    }
  }

  // Sortierung: severityRank ASC, dann followers DESC (größte Accounts zuerst)
  out.sort((a, b) => a.severityRank - b.severityRank || b.followers - a.followers);
  // Dedupe pro Chatter (ein Chatter blockt nicht mehrere Slots)
  const seen = new Set<string>();
  const dedup: DowngradeCandidate[] = [];
  for (const d of out) {
    if (seen.has(d.chatter.toLowerCase())) continue;
    seen.add(d.chatter.toLowerCase());
    dedup.push(d);
  }
  return dedup;
}

function detectUpgradesTypeX(
  lastAssignments: Map<string, Set<string>>,
  followersByAcc: Map<string, number>,
  pairMap: Map<string, { date: string; rev: number; delay: number }[]>,
  activeNames: Set<string> | null,
  originalChatterName: Map<string, string>,
  originalAccountLabel: Map<string, string>,
): { prio1: UpgradeCandidate[]; prio2: UpgradeCandidate[] } {
  const prio1: UpgradeCandidate[] = [];
  const prio2: UpgradeCandidate[] = [];
  for (const [ck, accs] of lastAssignments) {
    if (activeNames && !activeNames.has(ck)) continue;
    // Seed: ALLE aktuellen Accounts dieses Chatters < 300 Follower
    const accList = [...accs];
    if (accList.length === 0) continue;
    const allSeed = accList.every((a) => (followersByAcc.get(a) ?? 0) < SEED_FOLLOWER_MAX);
    if (!allSeed) continue;
    // Stärkster Seed-Account für Anzeige
    let bestAcc = accList[0];
    let bestFollowers = followersByAcc.get(bestAcc) ?? 0;
    for (const a of accList) {
      const f = followersByAcc.get(a) ?? 0;
      if (f > bestFollowers) {
        bestFollowers = f;
        bestAcc = a;
      }
    }
    const entries = pairMap.get(`${ck}|${bestAcc}`) ?? [];
    const { avg: recent14d } = getChatter14dAverage(entries);
    const todayRev = entries.length ? entries[entries.length - 1].rev : 0;
    const hasMeaningfulRevenue = recent14d >= MIN_SEED_RECENT_AVG || todayRev >= MIN_SEED_RECENT_AVG;

    const cand: UpgradeCandidate = {
      chatter: originalChatterName.get(ck) ?? ck,
      type: hasMeaningfulRevenue ? "seed_p1" : "seed_p2",
      currentAccountKey: bestAcc,
      currentAccountLabel: originalAccountLabel.get(bestAcc) ?? bestAcc,
      currentFollowers: bestFollowers,
      currentLifetimeAvg: null,
      recent14d,
      ratio: 0,
      todayRevenue: todayRev,
    };
    if (cand.type === "seed_p1") prio1.push(cand);
  }
  prio1.sort((a, b) => b.todayRevenue - a.todayRevenue || b.recent14d - a.recent14d);
  prio2.sort((a, b) => b.currentFollowers - a.currentFollowers);
  return { prio1, prio2 };
}

function detectUpgradesTypeY(
  lastAssignments: Map<string, Set<string>>,
  followersByAcc: Map<string, number>,
  lifetimeByAcc: Map<string, number | null>,
  pairMap: Map<string, { date: string; rev: number; delay: number }[]>,
  activeNames: Set<string> | null,
  originalChatterName: Map<string, string>,
  originalAccountLabel: Map<string, string>,
): UpgradeCandidate[] {
  const out: UpgradeCandidate[] = [];
  for (const [ck, accs] of lastAssignments) {
    if (activeNames && !activeNames.has(ck)) continue;
    if (accs.size !== 1) continue;
    const ak = [...accs][0];
    const followers = followersByAcc.get(ak) ?? 0;
    if (followers <= TYPE_Y_FOLLOWER_MIN) continue;
    const lifetime = lifetimeByAcc.get(ak);
    if (lifetime == null || lifetime <= 0) continue;
    const entries = pairMap.get(`${ck}|${ak}`) ?? [];
    const { avg: recent14d, days } = getChatter14dAverage(entries);
    if (days < 3) continue;
    const ratio = recent14d / lifetime;
    if (ratio < OVERPERFORM_RATIO) continue;
    out.push({
      chatter: originalChatterName.get(ck) ?? ck,
      type: "second_account",
      currentAccountKey: ak,
      currentAccountLabel: originalAccountLabel.get(ak) ?? ak,
      currentFollowers: followers,
      currentLifetimeAvg: lifetime,
      recent14d,
      ratio,
      todayRevenue: entries.length ? entries[entries.length - 1].rev : 0,
    });
  }
  out.sort((a, b) => b.ratio - a.ratio);
  return out;
}

/**
 * Typ Z — Hochstufung. Pro überdurchschnittlichem (Chatter, Account)-Paar wird
 * EIN Eintrag erzeugt; die slot-spezifische Account-Differenz wird beim Matching
 * geprüft. Auch Chatter mit 2 Accounts qualifizieren sich (einer wird hochgestuft).
 */
function detectUpgradesTypeZ(
  lastAssignments: Map<string, Set<string>>,
  followersByAcc: Map<string, number>,
  lifetimeByAcc: Map<string, number | null>,
  pairMap: Map<string, { date: string; rev: number; delay: number }[]>,
  activeNames: Set<string> | null,
  originalChatterName: Map<string, string>,
  originalAccountLabel: Map<string, string>,
): UpgradeCandidate[] {
  const out: UpgradeCandidate[] = [];
  for (const [ck, accs] of lastAssignments) {
    if (activeNames && !activeNames.has(ck)) continue;
    for (const ak of accs) {
      const lifetime = lifetimeByAcc.get(ak);
      if (lifetime == null || lifetime <= 0) continue;
      const entries = pairMap.get(`${ck}|${ak}`) ?? [];
      const { avg: recent14d, days } = getChatter14dAverage(entries);
      if (days < 3) continue;
      const ratio = recent14d / lifetime;
      if (ratio < OVERPERFORM_RATIO) continue;
      out.push({
        chatter: originalChatterName.get(ck) ?? ck,
        type: "promotion",
        currentAccountKey: ak,
        currentAccountLabel: originalAccountLabel.get(ak) ?? ak,
        currentFollowers: followersByAcc.get(ak) ?? 0,
        currentLifetimeAvg: lifetime,
        recent14d,
        ratio,
        todayRevenue: entries.length ? entries[entries.length - 1].rev : 0,
      });
    }
  }
  // Vorab nach Ratio sortieren; finale Sortierung passiert pro Slot.
  out.sort((a, b) => b.ratio - a.ratio);
  return out;
}

// ---------- Matching ----------
function matchSwaps(
  downgrades: DowngradeCandidate[],
  upgradesY: UpgradeCandidate[],
  upgradesZ: UpgradeCandidate[],
  upgradesX1: UpgradeCandidate[],
  upgradesX2: UpgradeCandidate[],
  lifetimeByAcc: Map<string, number | null>,
): { matches: SwapMatch[]; unusedY: UpgradeCandidate[] } {
  const matches: SwapMatch[] = [];
  const usedChatters = new Set<string>();

  // Mutable Pools
  const poolY = [...upgradesY];
  const poolZ = [...upgradesZ];
  const poolX1 = [...upgradesX1];
  const poolX2 = [...upgradesX2];

  const popFirst = (pool: UpgradeCandidate[]): UpgradeCandidate | null => {
    while (pool.length) {
      const c = pool.shift()!;
      if (usedChatters.has(c.chatter.toLowerCase())) continue;
      return c;
    }
    return null;
  };

  for (const slot of downgrades) {
    const slotLifetime = lifetimeByAcc.get(slot.accountKey) ?? null;

    // Typ Y zuerst
    let pick: UpgradeCandidate | null = null;
    let mode: "Y" | "Z" | "X1" | "X2" | null = null;

    // Y: solo performer, freier Slot ist Zusatz-Account
    const yCand = popFirst(poolY);
    if (yCand) {
      // Y darf nicht auf seinen eigenen Ist-Account gematched werden
      if (yCand.currentAccountKey !== slot.accountKey) {
        pick = yCand;
        mode = "Y";
      } else {
        // wieder zurückstellen, nicht für diesen Slot nutzen
        poolY.unshift(yCand);
      }
    }

    // Z: Hochstufung — Ziel-Account-Lifetime ≥ 120 % vom Ist-Lifetime
    if (!pick && slotLifetime != null) {
      // Wähle besten Z-Kandidaten, dessen Ist-Account klein genug ist
      let bestIdx = -1;
      let bestDiff = 0;
      for (let i = 0; i < poolZ.length; i++) {
        const c = poolZ[i];
        if (usedChatters.has(c.chatter.toLowerCase())) continue;
        if (c.currentAccountKey === slot.accountKey) continue;
        if (c.currentLifetimeAvg == null || c.currentLifetimeAvg <= 0) continue;
        const diff = slotLifetime / c.currentLifetimeAvg;
        if (diff >= PROMOTION_ACCOUNT_RATIO && diff > bestDiff) {
          bestDiff = diff;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0) {
        pick = { ...poolZ[bestIdx], promotionDiff: bestDiff };
        mode = "Z";
        poolZ.splice(bestIdx, 1);
      }
    }

    // X Prio 1
    if (!pick) {
      const c = popFirst(poolX1);
      if (c && c.currentAccountKey !== slot.accountKey) {
        pick = c;
        mode = "X1";
      } else if (c) {
        poolX1.unshift(c);
      }
    }

    // X Prio 2
    if (!pick) {
      const c = popFirst(poolX2);
      if (c && c.currentAccountKey !== slot.accountKey) {
        pick = c;
        mode = "X2";
      } else if (c) {
        poolX2.unshift(c);
      }
    }

    if (pick) {
      usedChatters.add(pick.chatter.toLowerCase());
      matches.push({ downgrade: slot, upgrade: pick });
    } else {
      matches.push({ downgrade: slot, upgrade: null });
    }
  }

  // Übrig gebliebene Typ-Y-Kandidaten → eigene Tasks
  const unusedY = poolY.filter((c) => !usedChatters.has(c.chatter.toLowerCase()));
  return { matches, unusedY };
}

// ---------- Reason-Text ----------
function downgradeReasonText(d: DowngradeCandidate): string {
  switch (d.reason) {
    case "zero_streak":
      return `${d.streakDays} Tage in Folge 0 € auf „${d.accountLabel}" (${d.followers.toLocaleString("de-DE")} Follower).`;
    case "delay":
      return `Chats im Verzug (max. ${d.delayDays} Tage) auf „${d.accountLabel}" (${d.followers.toLocaleString("de-DE")} Follower).`;
    case "underperformance":
      return `14d-Schnitt ${fmtEur(d.recent14d)}/Tag < 60 % vom Lifetime-Schnitt ${fmtEur(d.lifetimeAvg ?? 0)}/Tag auf „${d.accountLabel}".`;
  }
}

function upgradeReasonText(u: UpgradeCandidate): string {
  switch (u.type) {
    case "second_account":
      return `${u.chatter} liefert ${fmtEur(u.recent14d)}/Tag (14d) — ${Math.round(u.ratio * 100)} % vom Lifetime-Schnitt seines Accounts. Solo-Performer, zweiter Account passt.`;
    case "promotion":
      return `${u.chatter} läuft auf „${u.currentAccountLabel}" mit ${Math.round(u.ratio * 100)} % vom Lifetime-Schnitt (${fmtEur(u.recent14d)}/Tag). Ziel-Account hat ${Math.round(((u.promotionDiff ?? 1) - 1) * 100)} % höheren Lifetime-Schnitt — Hochstufung.`;
    case "seed_p1":
      return `${u.chatter} aktiv auf Seed-Account „${u.currentAccountLabel}" (${u.currentFollowers} Follower) mit Revenue — bereit für größeren Account.`;
    case "seed_p2":
      return `${u.chatter} aktiv auf Seed-Account „${u.currentAccountLabel}" (${u.currentFollowers} Follower), bisher ohne Revenue — Chance auf größeren Account.`;
    case "high_converter": {
      const epi = u.eurPerIncoming ?? 0;
      const med = u.tierMedianEurPerIncoming ?? 0;
      const lift = med > 0 ? Math.round(((epi / med) - 1) * 100) : 0;
      const tier = u.currentTierLabel ?? "aktuelles Tier";
      return `${u.chatter} konvertiert eingehende Nachrichten überdurchschnittlich: ${epi.toFixed(2).replace(".", ",")} €/Nachricht (14d, ${u.incomingCount ?? 0} Nachrichten) — +${lift}% über Peer-Median (${med.toFixed(2).replace(".", ",")} €) im Tier „${tier}". Größerer Account bringt mehr Volumen bei gleicher Conversion.`;
    }
  }
}

/**
 * High-Converter Detektor — Chatter, die pro eingehender Nachricht deutlich
 * überdurchschnittlich viel Umsatz erzeugen (relativ zum Peer-Median ihres
 * aktuellen Account-Tiers). Nutzt die RPC `get_live_efficiency` (letzte 14T).
 *
 * Ist bewusst additiv zu den bestehenden Upgrade-Typen: Chatter ohne
 * Live-/Incoming-Daten triggern hier nicht — die alten Typen (seed/second/promotion)
 * greifen dann wie bisher.
 */
async function detectUpgradesHighConverter(
  platform: string,
  lastAssignments: Map<string, Set<string>>,
  followersByAcc: Map<string, number>,
  activeNames: Set<string> | null,
  originalChatterName: Map<string, string>,
  originalAccountLabel: Map<string, string>,
): Promise<UpgradeCandidate[]> {
  const from = isoDaysAgo(HC_WINDOW_DAYS);
  const to = todayStr();
  let liveMap: Map<string, LiveEfficiencyRow>;
  try {
    liveMap = await fetchLiveEfficiency(platform, from, to);
  } catch (e) {
    console.warn("[account-swap-engine] high_converter: live-efficiency failed", e);
    return [];
  }
  if (liveMap.size === 0) return [];

  // Chatter-Effizienz-Rows re-normalisieren auf normalizeChatterName-Schema
  // (fetchLiveEfficiency benutzt intern nur trim+lowercase).
  const byNormalizedChatter = new Map<string, LiveEfficiencyRow>();
  for (const row of liveMap.values()) {
    const key = normalizeChatterName(row.chatter_name);
    if (!key) continue;
    // Falls Duplikate: die mit höherem Volumen gewinnt
    const prev = byNormalizedChatter.get(key);
    if (!prev || row.total_incoming_proxy > prev.total_incoming_proxy) {
      byNormalizedChatter.set(key, row);
    }
  }

  // Aktuelles Tier je Chatter = Tier des größten aktuell zugewiesenen Accounts.
  const chatterTier = new Map<string, { id: AccountTierId; label: string; topAccount: string; followers: number } | null>();
  for (const [ck, accs] of lastAssignments) {
    if (activeNames && !activeNames.has(ck)) continue;
    let bestAcc: string | null = null;
    let bestFollowers = -1;
    for (const a of accs) {
      const f = followersByAcc.get(a) ?? 0;
      if (f > bestFollowers) { bestFollowers = f; bestAcc = a; }
    }
    if (!bestAcc) { chatterTier.set(ck, null); continue; }
    const tier = tierForFollowers(bestFollowers);
    if (!tier) { chatterTier.set(ck, null); continue; }
    chatterTier.set(ck, { id: tier.id, label: tier.label, topAccount: bestAcc, followers: bestFollowers });
  }

  // Peer-Median je Tier auf Basis der Chatter, die aktuell in diesem Tier sitzen
  // UND das Volumen-Gate erfüllen.
  const perTierValues = new Map<AccountTierId, number[]>();
  for (const [ck, tier] of chatterTier) {
    if (!tier) continue;
    const row = byNormalizedChatter.get(ck);
    if (!row) continue;
    if (row.total_incoming_proxy < HC_MIN_INCOMING) continue;
    if (!hasUsableLiveData(row)) continue;
    if (!perTierValues.has(tier.id)) perTierValues.set(tier.id, []);
    perTierValues.get(tier.id)!.push(row.eur_per_incoming);
  }
  const median = (arr: number[]): number => {
    if (arr.length === 0) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
  };
  const tierMedian = new Map<AccountTierId, number>();
  for (const [tid, vals] of perTierValues) {
    if (vals.length < HC_MIN_TIER_SAMPLE) continue;
    tierMedian.set(tid, median(vals));
  }

  const out: UpgradeCandidate[] = [];
  for (const [ck, tier] of chatterTier) {
    if (!tier) continue;
    // Bereits Top-Tier → nichts zu upgraden
    if (tier.id === "top") continue;
    const row = byNormalizedChatter.get(ck);
    if (!row) continue;
    if (row.total_incoming_proxy < HC_MIN_INCOMING) continue;
    if (!hasUsableLiveData(row)) continue;
    const med = tierMedian.get(tier.id);
    if (med == null || med <= 0) continue;
    if (row.eur_per_incoming < HC_LIFT_FACTOR * med) continue;

    out.push({
      chatter: originalChatterName.get(ck) ?? row.chatter_name,
      type: "high_converter",
      currentAccountKey: tier.topAccount,
      currentAccountLabel: originalAccountLabel.get(tier.topAccount) ?? tier.topAccount,
      currentFollowers: tier.followers,
      currentLifetimeAvg: null,
      recent14d: row.total_revenue / HC_WINDOW_DAYS,
      ratio: row.eur_per_incoming / med,
      todayRevenue: 0,
      eurPerIncoming: row.eur_per_incoming,
      tierMedianEurPerIncoming: med,
      currentTierLabel: tier.label,
      incomingCount: row.total_incoming_proxy,
    });
  }
  out.sort((a, b) => (b.eurPerIncoming ?? 0) - (a.eurPerIncoming ?? 0));
  return out;
}



// ---------- Public API ----------
export async function buildAccountSwapTasks(platform: string): Promise<RevenueTask[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  // History vollständig paginiert laden — keine künstliche Zeilen- oder Datumsgrenze.
  const PAGE = 1000;
  const historyAll: HistoryRow[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from("chatter_history")
      .select("chatter_name, account, analysis_date, revenue_today, response_delay_days")
      .eq("user_id", user.id)
      .ilike("platform", platform)
      .order("analysis_date", { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) {
      console.warn("[account-swap-engine] history page failed", page, error);
      break;
    }
    const rows = (data ?? []) as HistoryRow[];
    historyAll.push(...rows);
    if (rows.length < PAGE) break;
  }

  const [modelsRes, activeNames] = await Promise.all([
    supabase
      .from("models")
      .select("model_name, follower_count")
      .eq("user_id", user.id)
      .ilike("platform", platform),
    loadActiveChatterNames(platform),
  ]);

  const historyRaw = historyAll;
  const models = (modelsRes.data ?? []) as ModelRow[];

  // Aktive-Chatter-Filter
  const history = historyRaw.filter((r) => {
    if (!r.chatter_name) return false;
    if (!activeNames) return true;
    return activeNames.has(normalizeChatterName(r.chatter_name));
  });
  if (history.length === 0) return [];

  // Followers + Account-Labels
  const followersByAcc = new Map<string, number>();
  const originalAccountLabel = new Map<string, string>();
  for (const m of models) {
    const k = accKey(m.model_name);
    const v = Number(m.follower_count) || 0;
    if ((followersByAcc.get(k) ?? 0) < v) followersByAcc.set(k, v);
    if (!originalAccountLabel.has(k)) originalAccountLabel.set(k, m.model_name);
  }
  // Auch aus history Accounts ergänzen, falls models-Tabelle leer ist
  for (const r of history) {
    for (const a of splitAccounts(r.account)) {
      const k = accKey(a);
      if (!originalAccountLabel.has(k)) originalAccountLabel.set(k, a);
      if (!followersByAcc.has(k)) followersByAcc.set(k, 0);
    }
  }

  // Original-Chatter-Schreibweise
  const originalChatterName = new Map<string, string>();
  for (const r of history) {
    const k = normalizeChatterName(r.chatter_name);
    if (!originalChatterName.has(k)) originalChatterName.set(k, r.chatter_name);
  }

  const pairMap = groupByChatterAccount(history);
  const lifetimeByAcc = getAccountLifetimeAverages(history);
  const lastAssignments = getLastReportAssignments(history);
  const delayedByChatter = getDelayedChatters(history);

  const downgrades = detectDowngrades(
    pairMap,
    followersByAcc,
    lifetimeByAcc,
    delayedByChatter,
    originalAccountLabel,
    originalChatterName,
    lastAssignments,
  );

  const upgradesY = detectUpgradesTypeY(
    lastAssignments,
    followersByAcc,
    lifetimeByAcc,
    pairMap,
    activeNames,
    originalChatterName,
    originalAccountLabel,
  );

  const upgradesZ = detectUpgradesTypeZ(
    lastAssignments,
    followersByAcc,
    lifetimeByAcc,
    pairMap,
    activeNames,
    originalChatterName,
    originalAccountLabel,
  );

  const { prio1: upgradesX1, prio2: upgradesX2 } = detectUpgradesTypeX(
    lastAssignments,
    followersByAcc,
    pairMap,
    activeNames,
    originalChatterName,
    originalAccountLabel,
  );

  const upgradesHC = await detectUpgradesHighConverter(
    platform,
    lastAssignments,
    followersByAcc,
    activeNames,
    originalChatterName,
    originalAccountLabel,
  );

  const { matches, unusedY } = matchSwaps(
    downgrades,
    upgradesY,
    upgradesZ,
    upgradesX1,
    upgradesX2,
    lifetimeByAcc,
  );

  console.info("[account-swap-engine]", {
    platform,
    historyRows: history.length,
    activeChatters: activeNames?.size ?? "(no filter)",
    accountsKnown: followersByAcc.size,
    pairs: pairMap.size,
    lastAssignments: lastAssignments.size,
    delayedChatters: delayedByChatter.size,
    downgrades: downgrades.length,
    downgradesByReason: {
      zero_streak: downgrades.filter((d) => d.reason === "zero_streak").length,
      delay: downgrades.filter((d) => d.reason === "delay").length,
      underperformance: downgrades.filter((d) => d.reason === "underperformance").length,
    },
    upgradesY: upgradesY.length,
    upgradesZ: upgradesZ.length,
    upgradesX1: upgradesX1.length,
    upgradesX2: upgradesX2.length,
    matches: matches.length,
    unusedY: unusedY.length,
  });

  const today = todayStr();
  const tasks: RevenueTask[] = [];

  for (const m of matches) {
    const d = m.downgrade;
    const u = m.upgrade;

    if (u) {
      const swapMode = u.type === "second_account" ? "dazu" : "wechselt";
      const title =
        u.type === "second_account"
          ? `Zweiter Account: ${u.chatter} zusätzlich auf „${d.accountLabel}"`
          : u.type === "promotion"
            ? `Hochstufung: ${u.chatter} → „${d.accountLabel}" (statt „${u.currentAccountLabel}")`
            : `Account-Tausch: ${d.chatter} runter, ${u.chatter} rauf auf „${d.accountLabel}"`;
      tasks.push({
        key: `rev:swap:${d.accountKey}:${d.chatter.toLowerCase()}:${u.chatter.toLowerCase()}:${today}`,
        kind: "swap",
        title,
        why: `${downgradeReasonText(d)} ${upgradeReasonText(u)} (${swapMode})`,
        impactEurPerWeek: 0,
        confidence: 0.75,
        score: (d.followers || 1) * (u.type === "second_account" ? 1.5 : u.type === "promotion" ? 1.3 : u.type === "seed_p1" ? 1.0 : 0.7),
        chatterName: d.chatter,
        secondaryChatter: u.chatter,
        modelName: d.accountLabel,
      });
    } else {
      tasks.push({
        key: `rev:swap:slot-open:${d.accountKey}:${d.chatter.toLowerCase()}:${today}`,
        kind: "swap",
        title: `Account frei: „${d.accountLabel}" — ${d.chatter} runter, kein Ersatz`,
        why: `${downgradeReasonText(d)} Aktuell kein passender Upgrade-Kandidat verfügbar.`,
        impactEurPerWeek: 0,
        confidence: 0.6,
        score: (d.followers || 1) * 0.5,
        chatterName: d.chatter,
        modelName: d.accountLabel,
      });
    }
  }

  for (const u of unusedY) {
    tasks.push({
      key: `rev:swap:second-account-wait:${u.chatter.toLowerCase()}:${today}`,
      kind: "swap",
      title: `Zweiter Account empfohlen: ${u.chatter}`,
      why: `${upgradeReasonText(u)} Aktuell kein freier Slot — beim nächsten Downgrade berücksichtigen.`,
      impactEurPerWeek: 0,
      confidence: 0.55,
      score: (u.currentFollowers || 1) * 0.4,
      chatterName: u.chatter,
      modelName: u.currentAccountLabel,
    });
  }

  // -------- UPGRADE-KANDIDATEN (eigene Sektion) --------
  // Alle Upgrade-Kandidaten — unabhängig davon, ob im Swap-Matching ein Slot
  // gefunden wurde. Dedup pro Chatter, beste Type-Priorität gewinnt:
  // second_account > promotion > seed_p1 > seed_p2.
  const typeRank: Record<UpgradeType, number> = {
    second_account: 4,
    promotion: 3,
    seed_p1: 2,
    seed_p2: 1,
  };
  const bestByChatter = new Map<string, UpgradeCandidate>();
  for (const u of [...upgradesY, ...upgradesZ, ...upgradesX1, ...upgradesX2]) {
    const k = u.chatter.toLowerCase();
    const prev = bestByChatter.get(k);
    if (!prev || typeRank[u.type] > typeRank[prev.type]) bestByChatter.set(k, u);
  }
  for (const u of bestByChatter.values()) {
    const typeLabel =
      u.type === "second_account" ? "Zweiter Account"
        : u.type === "promotion" ? "Hochstufung"
          : u.type === "seed_p1" ? "Größerer Account (mit Revenue)"
            : "Größerer Account (Seed)";
    tasks.push({
      key: `rev:upgrade:${u.chatter.toLowerCase()}:${today}`,
      kind: "upgrade",
      title: `${u.chatter} → ${typeLabel}`,
      why: upgradeReasonText(u),
      impactEurPerWeek: 0,
      confidence: 0.7,
      score:
        (u.currentFollowers || 1) *
        (u.type === "second_account" ? 1.4
          : u.type === "promotion" ? 1.2
            : u.type === "seed_p1" ? 1.0
              : 0.6),
      chatterName: u.chatter,
      modelName: u.currentAccountLabel,
    });
  }

  // -------- DOWNGRADE-KANDIDATEN --------
  // Werden jetzt vom neuen Modul `downgrade-candidates.ts` erzeugt, das klare
  // Kriterien nutzt (komplette Inaktivität ODER Volumen ohne Konversion).
  // Die alten Signale (zero_streak / delay / underperformance) bleiben intern
  // im Swap-Matching oben aktiv, werden aber nicht mehr als eigene Karten
  // im Heute-Tab dargestellt.


  return tasks;
}
