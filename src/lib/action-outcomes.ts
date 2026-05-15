/**
 * Action Outcomes — A1 (ROI-Tracking), A2 (Feedback), A3 (Wochen-Recap)
 *
 * Beim "Erledigt" snapshotten wir Baseline + Schätzung pro Aktion.
 * Backfill rechnet 24/48/72h später die tatsächliche Revenue-Veränderung gegen
 * die 7T-Baseline und persistiert delta_*. Daraus speist sich:
 *   - Score-Multiplier pro (chatter, action_type)  → bewährte Hebel hochziehen
 *   - "Hat geholfen?" Feedback-Karten              → 3T nach Erledigung
 *   - Wochen-Recap                                 → Sonntag-Karte
 */
import { supabase } from "@/integrations/supabase/client";
import { normalizeChatterName } from "@/lib/active-chatters";
import type { UnifiedAction } from "@/lib/today-engine";

export interface ActionOutcomeRow {
  id: string;
  user_id: string;
  platform: string;
  chatter_name: string;
  action_type: string;
  action_kind: string | null;
  action_key: string | null;
  estimated_eur: number;
  baseline_revenue_7d: number;
  done_at: string;
  revenue_before_24h: number | null;
  revenue_after_24h: number | null;
  revenue_after_48h: number | null;
  revenue_after_72h: number | null;
  delta_24h: number | null;
  delta_48h: number | null;
  delta_72h: number | null;
  helped: boolean | null;
  feedback_at: string | null;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDate(d);
}

/** Sum revenue_today across the chatter's accounts over the date range [from..to] inclusive. */
async function sumRevenue(
  userId: string,
  platform: string,
  chatterKey: string,
  fromISO: string,
  toISO: string,
): Promise<number> {
  const { data } = await supabase
    .from("chatter_history")
    .select("revenue_today, chatter_name")
    .eq("user_id", userId)
    .ilike("platform", platform)
    .gte("analysis_date", fromISO)
    .lte("analysis_date", toISO);
  if (!data) return 0;
  let sum = 0;
  for (const r of data) {
    if (!r.chatter_name) continue;
    if (normalizeChatterName(r.chatter_name) !== chatterKey) continue;
    sum += Number(r.revenue_today) || 0;
  }
  return sum;
}

/** Average daily revenue over the past `days` days (excluding today). */
async function baseline7d(
  userId: string,
  platform: string,
  chatterKey: string,
): Promise<number> {
  const total = await sumRevenue(userId, platform, chatterKey, daysAgoISO(7), daysAgoISO(1));
  return total / 7;
}

/** Snapshot eine Aktion direkt beim "Erledigt"-Klick. */
export async function recordActionDone(platform: string, action: UnifiedAction): Promise<void> {
  if (!action.chatterName) return; // nur personenbezogene Aktionen
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const chatterKey = normalizeChatterName(action.chatterName);
  const baseline = await baseline7d(user.id, platform, chatterKey);

  await supabase.from("action_outcomes").insert({
    user_id: user.id,
    platform,
    chatter_name: action.chatterName,
    action_type: action.primaryKind,
    action_kind: action.signals[0]?.kind ?? null,
    action_key: action.bundleKey,
    estimated_eur: Math.round(action.totalImpactEurPerWeek),
    baseline_revenue_7d: baseline,
    revenue_before_24h: baseline, // tagesäquivalent
  });
}

/** Backfill 24/48/72h Snapshots für alte Outcomes. */
export async function backfillOutcomes(platform: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  // Hole Outcomes der letzten 8T, die noch unvollständig sind
  const { data } = await supabase
    .from("action_outcomes")
    .select("*")
    .eq("user_id", user.id)
    .ilike("platform", platform)
    .gte("done_at", new Date(Date.now() - 8 * 86400000).toISOString())
    .or("revenue_after_24h.is.null,revenue_after_48h.is.null,revenue_after_72h.is.null");

  if (!data || data.length === 0) return;
  const now = Date.now();

  for (const row of data as ActionOutcomeRow[]) {
    const doneTs = new Date(row.done_at).getTime();
    const ageH = (now - doneTs) / 3600000;
    const chatterKey = normalizeChatterName(row.chatter_name);
    const baseline = Number(row.baseline_revenue_7d) || 0;

    const updates: Partial<ActionOutcomeRow> = {};

    const fillFor = async (hours: 24 | 48 | 72, field: "revenue_after_24h" | "revenue_after_48h" | "revenue_after_72h", deltaField: "delta_24h" | "delta_48h" | "delta_72h") => {
      if (ageH < hours) return;
      if (row[field] != null) return;
      // Window: [doneAt..doneAt+Xh] mapped to dates
      const fromD = new Date(doneTs);
      const toD = new Date(doneTs + hours * 3600000);
      const sum = await sumRevenue(user.id, platform, chatterKey, isoDate(fromD), isoDate(toD));
      const expected = baseline * (hours / 24);
      updates[field] = sum;
      updates[deltaField] = sum - expected;
    };

    await fillFor(24, "revenue_after_24h", "delta_24h");
    await fillFor(48, "revenue_after_48h", "delta_48h");
    await fillFor(72, "revenue_after_72h", "delta_72h");

    if (Object.keys(updates).length > 0) {
      await supabase.from("action_outcomes").update(updates).eq("id", row.id);
    }
  }
}

/** Score-Multiplier pro (chatterKey, action_type) aus historischen 24h-Deltas. */
export async function loadRoiMultipliers(platform: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return map;

  const { data } = await supabase
    .from("action_outcomes")
    .select("chatter_name, action_type, estimated_eur, delta_24h")
    .eq("user_id", user.id)
    .ilike("platform", platform)
    .gte("done_at", new Date(Date.now() - 60 * 86400000).toISOString())
    .not("delta_24h", "is", null);

  if (!data) return map;

  // group by chatterKey|action_type
  const groups = new Map<string, { totalDelta: number; totalExpected: number; n: number }>();
  for (const r of data) {
    if (!r.chatter_name) continue;
    const key = `${normalizeChatterName(r.chatter_name)}|${r.action_type}`;
    const expected = (Number(r.estimated_eur) || 0) / 7; // €/Tag-Äquivalent
    const cur = groups.get(key) ?? { totalDelta: 0, totalExpected: 0, n: 0 };
    cur.totalDelta += Number(r.delta_24h) || 0;
    cur.totalExpected += expected;
    cur.n += 1;
    groups.set(key, cur);
  }

  for (const [key, g] of groups) {
    if (g.n < 2) continue; // braucht ≥2 Beobachtungen
    if (g.totalExpected <= 0) continue;
    const ratio = g.totalDelta / g.totalExpected; // 1.0 = wie geschätzt
    // Multiplier 0.5..1.8, gedämpft
    const mult = Math.max(0.5, Math.min(1.8, 0.7 + 0.5 * ratio));
    map.set(key, mult);
  }
  return map;
}

/** Outcomes 3–7T alt, ohne Feedback. */
export async function loadPendingFeedback(platform: string): Promise<ActionOutcomeRow[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const from = new Date(Date.now() - 7 * 86400000).toISOString();
  const to = new Date(Date.now() - 3 * 86400000).toISOString();
  const { data } = await supabase
    .from("action_outcomes")
    .select("*")
    .eq("user_id", user.id)
    .ilike("platform", platform)
    .gte("done_at", from)
    .lte("done_at", to)
    .is("helped", null)
    .order("done_at", { ascending: false })
    .limit(8);
  return (data ?? []) as ActionOutcomeRow[];
}

export async function setOutcomeFeedback(id: string, helped: boolean): Promise<void> {
  await supabase
    .from("action_outcomes")
    .update({ helped, feedback_at: new Date().toISOString() })
    .eq("id", id);
}

export interface WeekRecap {
  totalDelta: number;
  topChatter: { name: string; delta: number } | null;
  topActionType: { type: string; delta: number } | null;
  count: number;
}

/** Letzte 7T (rollend) — nur am Sonntag in UI rendern. */
export async function loadWeekRecap(platform: string): Promise<WeekRecap | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const from = new Date(Date.now() - 7 * 86400000).toISOString();

  const { data } = await supabase
    .from("action_outcomes")
    .select("chatter_name, action_type, delta_24h")
    .eq("user_id", user.id)
    .ilike("platform", platform)
    .gte("done_at", from)
    .not("delta_24h", "is", null);

  if (!data || data.length === 0) return null;

  let total = 0;
  const byChatter = new Map<string, number>();
  const byType = new Map<string, number>();
  for (const r of data) {
    const d = Number(r.delta_24h) || 0;
    total += d;
    if (r.chatter_name) byChatter.set(r.chatter_name, (byChatter.get(r.chatter_name) ?? 0) + d);
    if (r.action_type) byType.set(r.action_type, (byType.get(r.action_type) ?? 0) + d);
  }
  const topChatterEntry = [...byChatter.entries()].sort((a, b) => b[1] - a[1])[0];
  const topTypeEntry = [...byType.entries()].sort((a, b) => b[1] - a[1])[0];

  return {
    totalDelta: total,
    topChatter: topChatterEntry ? { name: topChatterEntry[0], delta: topChatterEntry[1] } : null,
    topActionType: topTypeEntry ? { type: topTypeEntry[0], delta: topTypeEntry[1] } : null,
    count: data.length,
  };
}
