/**
 * Label-Tasks — Chatter mit aktiven Labels als Heute-Karten.
 *
 * Liefert pro (Chatter, Label) eine Karte mit Live-Daten (offene Chats,
 * ältester Chat) + Heute-Umsatz. Karten haben einen daily_todo_key, der
 * pro Tag in daily_todo_state als done markiert werden kann.
 */
import { supabase } from "@/integrations/supabase/client";
import { filterRowsToActiveCombos, normalizeChatterName } from "@/lib/active-chatters";
import type { ChatterLabel, LabelAssignment } from "@/lib/chatter-labels";

export interface LabelCard {
  todoKey: string;
  chatterName: string;
  chatterKey: string;
  account: string | null;
  label: ChatterLabel;
  liveOpenChats: number;
  liveOldestChatDays: number;
  todayRevenue: number;
  liveUpdatedAt: string | null;
  accountFollowers: number | null;
  accountTodayRevenue: number | null;
  accountAvgDailyRevenue: number | null;
  /** Ø Tagesumsatz des Chatters — gleiche Berechnung wie in der Profilkarte. */
  chatterAvgDailyRevenue: number | null;
}

interface LiveRow {
  chatter_name: string;
  unread_chats: number | null;
  oldest_chat: number | null;
  revenue: number | null;
  updated_at: string | null;
  date: string;
}

interface HistRow {
  chatter_name: string;
  account: string | null;
  revenue_today: number | null;
  analysis_date: string;
}

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

export function labelTodoKey(labelId: string, chatterName: string, dateStr: string = todayStr()): string {
  return `label:${labelId}:${chatterName}:${dateStr}`;
}

export async function loadLabelCards(
  platform: string,
  labels: ChatterLabel[],
  assignments: LabelAssignment[],
): Promise<LabelCard[]> {
  if (assignments.length === 0) return [];

  const today = todayStr();
  const yesterday = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split("T")[0];
  })();
  const avgFrom = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 14);
    return d.toISOString().split("T")[0];
  })();

  // Ø Tagesumsatz pro Chatter über ALLE History-Tage — paginieren,
  // damit der Supabase-Default-Limit von 1000 Zeilen nicht trifft.
  async function fetchAllChatterHist(): Promise<{ chatter_name: string; revenue_today: number | null; analysis_date: string }[]> {
    const pageSize = 1000;
    const out: { chatter_name: string; revenue_today: number | null; analysis_date: string }[] = [];
    let from = 0;
    while (from < 200_000) {
      const { data, error } = await supabase
        .from("chatter_history")
        .select("chatter_name, revenue_today, analysis_date")
        .ilike("platform", platform)
        .order("analysis_date", { ascending: true })
        .range(from, from + pageSize - 1);
      if (error || !data || data.length === 0) break;
      out.push(...(data as any));
      if (data.length < pageSize) break;
      from += pageSize;
    }
    return out;
  }

  const [liveRes, histRes, accountHistRes, allChatterHistRows, modelsRes] = await Promise.all([
    supabase
      .from("chatter_history_live")
      .select("chatter_name, unread_chats, oldest_chat, revenue, updated_at, date")
      .ilike("platform", platform)
      .gte("date", yesterday),
    supabase
      .from("chatter_history")
      .select("chatter_name, account, revenue_today, analysis_date")
      .ilike("platform", platform)
      .gte("analysis_date", yesterday)
      .order("analysis_date", { ascending: false }),
    supabase
      .from("chatter_history")
      .select("account, revenue_today, analysis_date")
      .ilike("platform", platform)
      .gte("analysis_date", avgFrom)
      .not("account", "is", null),
    fetchAllChatterHist(),
    supabase
      .from("models")
      .select("model_name, follower_count")
      .ilike("platform", platform),
  ]);

  // Live: neueste pro Chatter
  const liveByChatter = new Map<string, LiveRow>();
  const liveSorted = [...((liveRes.data ?? []) as LiveRow[])].sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return (b.updated_at ?? "").localeCompare(a.updated_at ?? "");
  });
  for (const r of liveSorted) {
    const k = normalizeChatterName(r.chatter_name);
    if (!liveByChatter.has(k)) liveByChatter.set(k, r);
  }

  // History: heute bevorzugt, Account-Lookup — Kombis (Chatter × Account),
  // die im aktuellsten Report nicht mehr existieren, werden verworfen.
  const histRowsFiltered = await filterRowsToActiveCombos(
    platform,
    (histRes.data ?? []) as HistRow[],
  );
  const todayRevByChatter = new Map<string, number>();
  const accountByChatter = new Map<string, string>();
  for (const r of histRowsFiltered) {
    const k = normalizeChatterName(r.chatter_name);
    if (r.analysis_date === today) {
      const cur = todayRevByChatter.get(k) ?? 0;
      todayRevByChatter.set(k, Math.max(cur, Number(r.revenue_today ?? 0)));
    }
    if (!accountByChatter.has(k) && r.account) {
      const first = r.account.split(",")[0]?.trim();
      if (first) accountByChatter.set(k, first);
    }
  }

  // Account-Level: heute-Umsatz + Tagesschnitt (über alle Chatter aggregiert)
  const accountKey = (s: string) => s.trim().toLowerCase();
  const accTodayMap = new Map<string, number>();
  const accDayTotals = new Map<string, Map<string, number>>();
  for (const r of (accountHistRes.data ?? []) as { account: string | null; revenue_today: number | null; analysis_date: string }[]) {
    if (!r.account) continue;
    const first = r.account.split(",")[0]?.trim();
    if (!first) continue;
    const k = accountKey(first);
    const rev = Number(r.revenue_today ?? 0);
    if (r.analysis_date === today) {
      accTodayMap.set(k, (accTodayMap.get(k) ?? 0) + rev);
    }
    let perDay = accDayTotals.get(k);
    if (!perDay) { perDay = new Map(); accDayTotals.set(k, perDay); }
    perDay.set(r.analysis_date, (perDay.get(r.analysis_date) ?? 0) + rev);
  }
  const accAvgMap = new Map<string, number>();
  for (const [k, perDay] of accDayTotals.entries()) {
    // Tagesschnitt über Tage mit Daten, heute exkludieren (noch unvollständig)
    const days = [...perDay.entries()].filter(([d]) => d !== today);
    if (days.length === 0) continue;
    const sum = days.reduce((s, [, v]) => s + v, 0);
    accAvgMap.set(k, sum / days.length);
  }

  // Chatter-Level: Ø Tagesumsatz über alle vorhandenen History-Tage (wie Profilkarte)
  const chatterRevsByKey = new Map<string, number[]>();
  for (const r of allChatterHistRows) {
    const k = normalizeChatterName(r.chatter_name);
    const rev = Number(r.revenue_today ?? 0);
    let arr = chatterRevsByKey.get(k);
    if (!arr) { arr = []; chatterRevsByKey.set(k, arr); }
    arr.push(rev);
  }
  const chatterAvgMap = new Map<string, number>();
  for (const [k, revs] of chatterRevsByKey.entries()) {
    if (revs.length === 0) continue;
    chatterAvgMap.set(k, revs.reduce((s, v) => s + v, 0) / revs.length);
  }

  // Models: Followerzahl
  const followersByModel = new Map<string, number>();
  for (const m of (modelsRes.data ?? []) as { model_name: string | null; follower_count: number | null }[]) {
    if (!m.model_name) continue;
    followersByModel.set(accountKey(m.model_name), Number(m.follower_count ?? 0));
  }

  const labelById = new Map(labels.map((l) => [l.id, l]));
  const cards: LabelCard[] = [];

  for (const a of assignments) {
    const label = labelById.get(a.label_id);
    if (!label) continue;
    const live = liveByChatter.get(a.chatter_key);
    const account = accountByChatter.get(a.chatter_key) ?? null;
    const accK = account ? accountKey(account) : null;
    cards.push({
      todoKey: labelTodoKey(a.label_id, a.chatter_name, today),
      chatterName: a.chatter_name,
      chatterKey: a.chatter_key,
      account,
      label,
      liveOpenChats: Math.max(0, Number(live?.unread_chats ?? 0)),
      liveOldestChatDays: Math.max(0, Number(live?.oldest_chat ?? 0)),
      todayRevenue: todayRevByChatter.get(a.chatter_key) ?? Number(live?.revenue ?? 0),
      liveUpdatedAt: live?.updated_at ?? null,
      accountFollowers: accK ? followersByModel.get(accK) ?? null : null,
      accountTodayRevenue: accK ? accTodayMap.get(accK) ?? null : null,
      accountAvgDailyRevenue: accK ? accAvgMap.get(accK) ?? null : null,
      chatterAvgDailyRevenue: chatterAvgMap.get(a.chatter_key) ?? null,
    });
  }

  return cards;
}
