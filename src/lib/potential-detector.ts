/**
 * Potential Detector — generiert neue Heute-Karten-Signale aus der
 * Account-Fit-Matrix. Drei Trigger:
 *
 *   a) Hidden Star  — sitzt heute auf zu kleinem Account, hat woanders schon performt
 *   b) Wrong Fit    — aktuelle Person-Account-Kombi historisch schwach, anderer hat's schon gepackt
 *   c) Riser        — erst seit 3-7 Tagen auf Account, schlägt schon vorherige Baseline klar
 *
 * Output ist ein deterministisches Signal-Array mit konkretem €-Hebel und
 * historischen Belegen (evidence[]).
 */
import { supabase } from "@/integrations/supabase/client";
import { fetchAllPaged } from "@/lib/paged";
import { tierForFollowers } from "@/lib/account-tiers";
import { filterRowsToActiveCombos, normalizeChatterName } from "@/lib/active-chatters";
import type { AccountFitMatrix, FitEntry } from "@/lib/account-fit";

export type PotentialKind = "hidden_star" | "wrong_fit" | "riser_confirms";

export interface EvidenceRow {
  /** "X auf Y: Ø 180 €/Tag (12.3.–28.4.)" */
  text: string;
}

export interface PotentialSignal {
  kind: PotentialKind;
  /** Person, die "befördert" / getauscht / belobigt werden soll */
  chatterName: string;
  /** Vergleichs-Chatter (bei wrong_fit der historisch starke Kandidat) */
  secondaryChatter: string | null;
  /** Account, um den's geht */
  modelName: string | null;
  title: string;
  why: string;
  /** Geschätzter €-Hebel pro Woche (gecappt) */
  impactEurPerWeek: number;
  impactReason: string;
  /** Stabiler Key für Done/Snooze */
  todoKey: string;
  /** Historische Belege (max 3 Zeilen) */
  evidence: EvidenceRow[];
}

interface CurrentAssignment {
  chatterName: string;
  account: string;
  followers: number;
  daysOnAccount: number;
  todayRevenue: number;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "?";
  const d = new Date(iso);
  return `${d.getDate()}.${d.getMonth() + 1}.`;
}

function fmtEur(v: number): string {
  return Math.round(v).toLocaleString("de-DE") + " €";
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Lädt heutige Chatter→Account-Zuordnung + Tage-auf-Account aus chatter_history. */
async function loadCurrentAssignments(
  platform: string,
  followersByAcc: Map<string, number>,
): Promise<CurrentAssignment[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const since = isoDaysAgo(30);
  const today = todayIso();

  const data = await fetchAllPaged<{ chatter_name: string; account: string; analysis_date: string; revenue_today: number | null }>((from, to) =>
    supabase
      .from("chatter_history")
      .select("chatter_name, account, analysis_date, revenue_today")
      .eq("user_id", user.id)
      .ilike("platform", platform)
      .gte("analysis_date", since)
      .range(from, to)
  );

  const rows = await filterRowsToActiveCombos(platform, data ?? []);
  // Heutige Pairs
  const todayPairs = new Map<string, { chatter: string; account: string; revenue: number }>();
  // Historische Pairs für daysOnAccount
  const histDays = new Map<string, Set<string>>();

  for (const r of rows) {
    if (!r.chatter_name || !r.account) continue;
    const accs = r.account.split(",").map(a => a.trim()).filter(Boolean);
    for (const acc of accs) {
      const key = `${normalizeChatterName(r.chatter_name)}|${acc.toLowerCase()}`;
      if (!histDays.has(key)) histDays.set(key, new Set());
      histDays.get(key)!.add(r.analysis_date);
      if (r.analysis_date === today) {
        const rev = (Number(r.revenue_today) || 0) / accs.length;
        const prev = todayPairs.get(key);
        if (!prev) {
          todayPairs.set(key, { chatter: r.chatter_name, account: acc, revenue: rev });
        } else {
          prev.revenue += rev;
        }
      }
    }
  }

  const out: CurrentAssignment[] = [];
  for (const [key, p] of todayPairs) {
    // daysOnAccount = aufeinanderfolgende Tage rückwärts ab heute
    const days = histDays.get(key)!;
    let count = 0;
    for (let i = 0; i < 30; i++) {
      const d = isoDaysAgo(i);
      if (days.has(d)) count++;
      else if (count > 0) break;
    }
    out.push({
      chatterName: p.chatter,
      account: p.account,
      followers: followersByAcc.get(p.account.toLowerCase()) ?? 0,
      daysOnAccount: count,
      todayRevenue: p.revenue,
    });
  }
  return out;
}

const MIN_IMPACT = 30;

export async function generatePotentialSignals(
  platform: string,
  matrix: AccountFitMatrix,
  followersByAcc: Map<string, number>,
): Promise<PotentialSignal[]> {
  const today = todayIso();
  const current = await loadCurrentAssignments(platform, followersByAcc);
  const signals: PotentialSignal[] = [];

  // Set heutiger Belegungen, damit wir nicht doppelt vorschlagen
  const occupiedAccounts = new Set(current.map(a => a.account.toLowerCase()));
  const busyChatters = new Set(current.map(a => normalizeChatterName(a.chatterName)));

  for (const a of current) {
    const ck = normalizeChatterName(a.chatterName);
    const ak = a.account.toLowerCase();
    const currentFit = matrix.byPair.get(`${ck}|${ak}`) ?? null;
    const currentTier = tierForFollowers(a.followers);

    // ────── (a) HIDDEN STAR ──────
    // Sitzt heute auf seed/starter, hat woanders ≥ growth-Account mit fitScore ≥ 70
    if (currentTier && (currentTier.id === "seed" || currentTier.id === "starter")) {
      const myHist = matrix.byChatter.get(ck) ?? [];
      const stars = myHist.filter(e => {
        const fol = followersByAcc.get(e.accountKey) ?? 0;
        const t = tierForFollowers(fol);
        return e.fitScore >= 70 && e.days >= 5
          && (t?.id === "growth" || t?.id === "top")
          && e.accountKey !== ak;
      });
      stars.sort((x, y) => y.avgPerDay - x.avgPerDay);
      const star = stars[0];
      if (star) {
        const gainPerDay = Math.max(0, star.avgPerDay - a.todayRevenue);
        const impact = Math.round(gainPerDay * 7 * 0.6);
        if (impact >= MIN_IMPACT) {
          signals.push({
            kind: "hidden_star",
            chatterName: a.chatterName,
            secondaryChatter: null,
            modelName: star.accountName,
            title: `${a.chatterName}: verstecktes Talent — historisch top auf ${star.accountName}`,
            why: `Sitzt aktuell auf ${a.account} (${currentTier.label}). Auf ${star.accountName} lief ${a.chatterName} mit Ø ${fmtEur(star.avgPerDay)}/Tag (Fit ${star.fitScore}/100).`,
            impactEurPerWeek: impact,
            impactReason: `Star-Phase ${fmtEur(star.avgPerDay)}/Tag − heute ${fmtEur(a.todayRevenue)}/Tag × 7 × 60% Realisierung`,
            todoKey: `pot:hidden:${ck}:${star.accountKey}:${today}`,
            evidence: [
              { text: `${a.chatterName} auf ${star.accountName}: Ø ${fmtEur(star.avgPerDay)}/Tag (${fmtDate(star.lastPhaseFrom)}–${fmtDate(star.lastPhaseTo)}, ${star.lastPhaseDays}T)` },
              { text: `Heute ${a.chatterName} auf ${a.account}: ${fmtEur(a.todayRevenue)}/Tag` },
              { text: `Peer-Median ${star.accountName}: ${fmtEur(matrix.peerMedianByAccount.get(star.accountKey) ?? 0)}/Tag` },
            ],
          });
        }
      }
    }

    // ────── (b) WRONG FIT ──────
    // Heute ≥7T auf Account, fitScore < 35, anderer Chatter hat dort Fit > 65 historisch
    if (a.daysOnAccount >= 7 && currentFit && currentFit.fitScore < 35) {
      const others = (matrix.byAccount.get(ak) ?? [])
        .filter(e => e.chatterKey !== ck && e.fitScore >= 65 && e.days >= 5);
      others.sort((x, y) => y.fitScore - x.fitScore);
      const better = others[0];
      if (better) {
        const gainPerDay = Math.max(0, better.avgPerDay - currentFit.avgPerDay);
        const impact = Math.round(gainPerDay * 7 * 0.55);
        if (impact >= MIN_IMPACT) {
          signals.push({
            kind: "wrong_fit",
            chatterName: a.chatterName,
            secondaryChatter: better.chatterName,
            modelName: a.account,
            title: `${a.account}: ${better.chatterName} statt ${a.chatterName}?`,
            why: `${a.chatterName} läuft auf ${a.account} bei Ø ${fmtEur(currentFit.avgPerDay)}/Tag (Fit ${currentFit.fitScore}/100). ${better.chatterName} hatte denselben Account mit Ø ${fmtEur(better.avgPerDay)}/Tag (Fit ${better.fitScore}/100).`,
            impactEurPerWeek: impact,
            impactReason: `Lift ${fmtEur(gainPerDay)}/Tag × 7 × 55% Übergangs-Realisierung`,
            todoKey: `pot:wrongfit:${ck}:${better.chatterKey}:${ak}:${today}`,
            evidence: [
              { text: `${better.chatterName} auf ${a.account}: Ø ${fmtEur(better.avgPerDay)}/Tag (${fmtDate(better.lastPhaseFrom)}–${fmtDate(better.lastPhaseTo)}, ${better.lastPhaseDays}T)` },
              { text: `${a.chatterName} auf ${a.account}: Ø ${fmtEur(currentFit.avgPerDay)}/Tag (${currentFit.days}T)` },
              { text: `Peer-Median ${a.account}: ${fmtEur(matrix.peerMedianByAccount.get(ak) ?? 0)}/Tag` },
            ],
          });
        }
      }
    }

    // ────── (c) RISER CONFIRMS ──────
    // Erst 3-7 Tage auf Account, schlägt Peer-Median klar
    if (a.daysOnAccount >= 3 && a.daysOnAccount <= 7 && currentFit) {
      const peerMed = matrix.peerMedianByAccount.get(ak) ?? 0;
      const lift = peerMed > 0 ? (currentFit.avgPerDay - peerMed) / peerMed : 0;
      if (peerMed > 0 && lift >= 0.30 && currentFit.avgPerDay >= peerMed * 1.3) {
        // Suche nächstgrößeren freien Account in derselben oder höheren Tier-Gruppe
        const currentTierIdx = currentTier ? ["seed", "starter", "growth", "top"].indexOf(currentTier.id) : -1;
        const nextAccounts = Array.from(followersByAcc.entries())
          .filter(([acc, fol]) => {
            if (occupiedAccounts.has(acc)) return false;
            const t = tierForFollowers(fol);
            const tIdx = t ? ["seed", "starter", "growth", "top"].indexOf(t.id) : -1;
            return tIdx > currentTierIdx;
          })
          .sort((x, y) => x[1] - y[1])[0];
        const upgradeNote = nextAccounts ? ` Freier Account passender Größe: ${nextAccounts[0]} (${nextAccounts[1]} Follower).` : "";
        const impact = Math.round(currentFit.avgPerDay * 7 * 0.4);
        if (impact >= MIN_IMPACT) {
          signals.push({
            kind: "riser_confirms",
            chatterName: a.chatterName,
            secondaryChatter: null,
            modelName: a.account,
            title: `${a.chatterName} liefert auf ${a.account} +${Math.round(lift * 100)}% über Peer-Median`,
            why: `Erst ${a.daysOnAccount}T auf dem Account und schon Ø ${fmtEur(currentFit.avgPerDay)}/Tag (Median ${fmtEur(peerMed)}). Bestätigter Fit — größeres Model andocken?${upgradeNote}`,
            impactEurPerWeek: impact,
            impactReason: `Bestätigter Fit-Score ${currentFit.fitScore}/100 · 40% Tagespotenzial × 7`,
            todoKey: `pot:riser:${ck}:${ak}:${today}`,
            evidence: [
              { text: `${a.chatterName} auf ${a.account} (${a.daysOnAccount}T): Ø ${fmtEur(currentFit.avgPerDay)}/Tag` },
              { text: `Peer-Median ${a.account}: ${fmtEur(peerMed)}/Tag` },
              ...(nextAccounts ? [{ text: `Frei verfügbar: ${nextAccounts[0]} (${nextAccounts[1]} Follower)` }] : []),
            ],
          });
        }
      }
    }
  }

  // De-dupe: pro Chatter max 1 potential-Signal (höchster Impact gewinnt)
  const byChatter = new Map<string, PotentialSignal>();
  for (const s of signals) {
    const key = normalizeChatterName(s.chatterName);
    const prev = byChatter.get(key);
    if (!prev || s.impactEurPerWeek > prev.impactEurPerWeek) byChatter.set(key, s);
  }
  return Array.from(byChatter.values()).sort((a, b) => b.impactEurPerWeek - a.impactEurPerWeek);
}
