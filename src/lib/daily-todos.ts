/**
 * Smart Daily To-Dos
 *
 * Generiert eine priorisierte Tagesaufgaben-Liste aus heutigem Report + 14T Historie.
 * Reine Client-Side Aggregation, deterministisch, transparent.
 */

import { supabase } from "@/integrations/supabase/client";
import { detectModelTroubles } from "@/lib/model-tracking";
import { loadActiveChatterNames, normalizeChatterName } from "@/lib/active-chatters";
import { findTalentMatches } from "@/lib/talent-scout";

export type TodoCategory = "verzug" | "activity" | "revenue" | "model" | "positive" | "talent";

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
  const fourteenAgo = new Date();
  fourteenAgo.setDate(fourteenAgo.getDate() - 14);
  const sinceStr = fourteenAgo.toISOString().split("T")[0];

  const { data: history } = await supabase
    .from("chatter_history")
    .select("chatter_name, analysis_date, revenue_today, mass_dms, open_chats, response_delay_days, account")
    .eq("platform", platform)
    .gte("analysis_date", sinceStr)
    .order("analysis_date", { ascending: false });

  const rows = (history || []) as HistoryRow[];
  if (rows.length === 0) return [];

  // Nur Chatter berücksichtigen, die im neuesten Report noch enthalten sind.
  // Wer nicht mehr im aktuellen Report auftaucht, ist „raus" und wird komplett
  // aus den To-Dos gefiltert.
  const activeNames = await loadActiveChatterNames(platform);
  const isActive = (name: string) =>
    activeNames === null ? true : activeNames.has(normalizeChatterName(name));

  // Tatsächlich neuestes Datum, nicht "heute" (Reports kommen evtl. mit Verzug)
  const latestDate = rows[0].analysis_date;

  // Models + Follower laden, um sie auf der Karte anzuzeigen.
  const { data: modelRowsForLookup } = await supabase
    .from("models")
    .select("model_name, follower_count")
    .eq("platform", platform);
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

    // Inaktivität — fehlt heute, war aber regelmäßig da
    if (!todayEntry && historical.length >= 5) {
      todos.push({
        key: `inactive:${name}:${today}`,
        category: "activity",
        score: Math.round(60 * importance),
        title: `${name} fehlt im Report${tag}`,
        why: `Letzte Tage regelmäßig dabei, heute nicht — Status klären.`,
        chatterName: name,
      });
      continue;
    }
    if (!todayEntry || historical.length < 2) continue;

    // Verzug
    const delay = todayMaxDelay;
    if (delay >= 3) {
      todos.push({
        key: `verzug:${name}:${today}`,
        category: "verzug",
        score: Math.round((90 + delay * 5) * importance),
        title: `${name} dringend — ${delay} Tage Verzug${tag}`,
        why: `Antwortverzug ${delay} Tage · ${todayOpenChats} offene Chats${modelSuffix}. Sofort entlasten oder Ursache klären.`,
        chatterName: name,
      });
    }

    // Mass-DM Drop
    const todayDm = todayEntries.reduce((s, e) => s + (e.mass_dms ?? 0), 0);
    const baseDm = median(historical.map((e) => e.mass_dms ?? 0));
    if (baseDm >= 3) {
      const drop = ((baseDm - todayDm) / baseDm) * 100;
      if (drop >= 50) {
        todos.push({
          key: `dm:${name}:${today}`,
          category: "activity",
          score: Math.round((70 + Math.min(30, drop / 3)) * importance),
          title: `${name} Mass-DMs hochziehen (Ziel 6/Tag)${tag}`,
          why: `Heute ${todayDm} statt Ø ${baseDm.toFixed(0)} (−${Math.round(drop)}%)${modelSuffix}.`,
          chatterName: name,
        });
      }
    }

    // Revenue Drop
    const todayRev = todayEntries.reduce((s, e) => s + Number(e.revenue_today ?? 0), 0);
    const baseRev = median(historical.map((e) => Number(e.revenue_today ?? 0)));
    if (baseRev >= 50) {
      const drop = ((baseRev - todayRev) / baseRev) * 100;
      if (drop >= 40) {
        todos.push({
          key: `rev:${name}:${today}`,
          category: "revenue",
          score: Math.round((75 + Math.min(25, drop / 4)) * importance),
          title: `${name} checken — Umsatz −${Math.round(drop)}%${tag}`,
          why: `Heute ${todayRev.toFixed(0)}€ vs. Ø ${baseRev.toFixed(0)}€${modelSuffix}.`,
          chatterName: name,
        });
      }
      // Positive Outlier
      if (todayRev >= baseRev * 1.8) {
        const up = Math.round(((todayRev - baseRev) / baseRev) * 100);
        todos.push({
          key: `pos:${name}:${today}`,
          category: "positive",
          score: Math.round(40 * importance),
          title: `Was läuft bei ${name} richtig? (+${up}%)`,
          why: `${todayRev.toFixed(0)}€ vs. Ø ${baseRev.toFixed(0)}€${modelSuffix} — Erfolgsrezept abgreifen.`,
          chatterName: name,
        });
      }
    }

    // Chat Jam
    const todayChats = todayOpenChats;
    const baseChats = median(historical.map((e) => e.open_chats ?? 0));
    if (todayChats >= 30 && baseChats > 0 && todayChats > baseChats * 1.5) {
      const up = Math.round(((todayChats - baseChats) / baseChats) * 100);
      todos.push({
        key: `jam:${name}:${today}`,
        category: "activity",
        score: Math.round(65 * importance),
        title: `${name} entlasten — ${todayChats} offene Chats${tag}`,
        why: `+${up}% vs. Ø ${baseChats.toFixed(0)} offene Chats${modelSuffix}.`,
        chatterName: name,
      });
    }
  }

  // Models in Trouble
  const { data: modelRows } = await supabase
    .from("models")
    .select("model_name")
    .eq("platform", platform);
  const modelNames = (modelRows || []).map((m) => m.model_name);
  if (modelNames.length > 0) {
    try {
      const troubles = await detectModelTroubles(platform, modelNames);
      for (const t of troubles.slice(0, 8)) {
        todos.push({
          key: `model:${t.modelName}:${today}`,
          category: "model",
          score: t.severity === "high" ? 85 : 78,
          title: `Model "${t.modelName}" im Rückgang`,
          why: t.reason,
          modelName: t.modelName,
          chatterName: t.currentChatter,
        });
      }
    } catch (e) {
      console.warn("[daily-todos] model trouble detection failed", e);
    }
  }



  // Talent-Scout — Aufsteiger ab Onboarding-Tag 5 + Underuser-Vorschlag
  try {
    const matches = await findTalentMatches(platform);
    for (const m of matches) {
      const respPart = m.riserResponseP50 != null ? ` · ${Math.round(m.riserResponseP50)}min Reaktion` : "";
      todos.push({
        key: `talent:${m.riser}:${m.underuser}:${today}`,
        category: "talent",
        score: 70 + Math.round(m.matchScore / 10),
        title: `🚀 ${m.riser} prüfen — Aufsteiger seit ${m.riserDaysOnboarded} Tagen`,
        why: `Stark in Aktivität (${m.riserAvgMassDms.toFixed(1)} MassDMs/Tag${respPart}) auf ${m.riserTier.label}-Account. Vergleiche mit ${m.underuser} (${m.underuserTier.label}, ${m.underuserOpenChats} offene Chats · Ø ${m.underuserDelayDays}T Verzug).`,
        chatterName: m.riser,
        compareWith: m.underuser,
      });
    }
  } catch (e) {
    console.warn("[daily-todos] talent scout failed", e);
  }

  // Sortieren
  todos.sort((a, b) => b.score - a.score);
  return todos;
}

export async function loadTodoStates(
  platform: string
): Promise<Record<string, TodoState>> {
  const today = todayStr();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return {};

  const { data } = await supabase
    .from("daily_todo_state")
    .select("todo_key, status, snoozed_until")
    .eq("user_id", user.id)
    .eq("platform", platform)
    .gte("acted_at", today + "T00:00:00Z");

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
