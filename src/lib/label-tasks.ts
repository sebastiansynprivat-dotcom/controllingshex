/**
 * Label-Tasks — Chatter mit aktiven Labels als Heute-Karten.
 *
 * Liefert pro (Chatter, Label) eine Karte mit Live-Daten (offene Chats,
 * ältester Chat) + Heute-Umsatz. Karten haben einen daily_todo_key, der
 * pro Tag in daily_todo_state als done markiert werden kann.
 */
import { supabase } from "@/integrations/supabase/client";
import { normalizeChatterName } from "@/lib/active-chatters";
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

  const [liveRes, histRes] = await Promise.all([
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

  // History: heute bevorzugt, Account-Lookup
  const todayRevByChatter = new Map<string, number>();
  const accountByChatter = new Map<string, string>();
  for (const r of (histRes.data ?? []) as HistRow[]) {
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

  const labelById = new Map(labels.map((l) => [l.id, l]));
  const cards: LabelCard[] = [];

  for (const a of assignments) {
    const label = labelById.get(a.label_id);
    if (!label) continue;
    const live = liveByChatter.get(a.chatter_key);
    cards.push({
      todoKey: labelTodoKey(a.label_id, a.chatter_name, today),
      chatterName: a.chatter_name,
      chatterKey: a.chatter_key,
      account: accountByChatter.get(a.chatter_key) ?? null,
      label,
      liveOpenChats: Math.max(0, Number(live?.unread_chats ?? 0)),
      liveOldestChatDays: Math.max(0, Number(live?.oldest_chat ?? 0)),
      todayRevenue: todayRevByChatter.get(a.chatter_key) ?? Number(live?.revenue ?? 0),
      liveUpdatedAt: live?.updated_at ?? null,
    });
  }

  return cards;
}
