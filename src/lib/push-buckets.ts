/**
 * Push-Buckets — Live-Aktivierungs- und Performance-Push für den Heute-Tab.
 *
 * Kombiniert:
 *  - Aktive Chatter aus dem neuesten Report (loadActiveChatterNames)
 *  - Heutige Live-Daten (chatter_history_live)
 *  - Persönlicher Tagesumsatz-Ø + übliche Startstunde (chatter_history der letzten 14 Tage)
 *
 * Resultat pro Chatter: genau EIN Bucket + Klartext-Push-Vorschlag.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  loadActiveChatterNames,
  loadActiveModels,
  loadModelChatters,
  normalizeAccountName,
  normalizeChatterName,
} from "@/lib/active-chatters";


export type PushBucketId =
  | "hot"
  | "boost"
  | "push"
  | "kick"
  | "rescue"
  | "shift_due"
  | "dropped_off"
  | "offline"
  | "silent_model";

export type PushBucketGroup = "live" | "offline" | "silent_model";

export interface PushBucketDef {
  id: PushBucketId;
  label: string;
  emoji: string;
  group: PushBucketGroup;
  /** Dringlichkeits-Reihenfolge in der UI (kleinere = oben) */
  order: number;
  /** Tailwind accent classes */
  accent: string;
  ring: string;
  tint: string;
}


export const PUSH_BUCKETS: Record<PushBucketId, PushBucketDef> = {
  rescue: {
    id: "rescue",
    label: "Rescue",
    emoji: "🩹",
    group: "live",
    order: 1,
    accent: "text-orange-300",
    ring: "border-orange-400/30",
    tint: "bg-orange-500/[0.06]",
  },
  kick: {
    id: "kick",
    label: "Kick",
    emoji: "⚡",
    group: "live",
    order: 2,
    accent: "text-red-300",
    ring: "border-red-400/30",
    tint: "bg-red-500/[0.06]",
  },
  offline: {
    id: "offline",
    label: "Komplett offline",
    emoji: "🌙",
    group: "offline",
    order: 3,
    accent: "text-indigo-300",
    ring: "border-indigo-400/25",
    tint: "bg-indigo-500/[0.05]",
  },
  shift_due: {
    id: "shift_due",
    label: "Schichtstart fällig",
    emoji: "⏰",
    group: "offline",
    order: 4,
    accent: "text-amber-300",
    ring: "border-amber-400/30",
    tint: "bg-amber-500/[0.06]",
  },
  dropped_off: {
    id: "dropped_off",
    label: "Abgetaucht",
    emoji: "😴",
    group: "offline",
    order: 5,
    accent: "text-sky-300",
    ring: "border-sky-400/25",
    tint: "bg-sky-500/[0.05]",
  },
  push: {
    id: "push",
    label: "Push",
    emoji: "💪",
    group: "live",
    order: 6,
    accent: "text-yellow-300",
    ring: "border-yellow-400/25",
    tint: "bg-yellow-500/[0.05]",
  },
  boost: {
    id: "boost",
    label: "Boost",
    emoji: "🚀",
    group: "live",
    order: 7,
    accent: "text-emerald-300",
    ring: "border-emerald-400/25",
    tint: "bg-emerald-500/[0.05]",
  },
  hot: {
    id: "hot",
    label: "Hot",
    emoji: "🔥",
    group: "live",
    order: 8,
    accent: "text-pink-300",
    ring: "border-pink-400/30",
    tint: "bg-pink-500/[0.06]",
  },
  silent_model: {
    id: "silent_model",
    label: "Model schweigt",
    emoji: "📉",
    group: "silent_model",
    order: 9,
    accent: "text-slate-300",
    ring: "border-slate-400/25",
    tint: "bg-slate-500/[0.06]",
  },
};

export interface PushCard {

  /** Stabiler todo-key für daily_todo_state */
  todoKey: string;
  chatterName: string;
  bucket: PushBucketDef;
  /** Klartext-Push, was du jetzt tun/schreiben sollst */
  suggestion: string;
  /** Knappe Datenzeile mit den harten Zahlen */
  dataLine: string;
  /** Live oder Offline — für Sortierung/Filterung */
  isLive: boolean;
  /** Score für innerhalb-Bucket-Sortierung (höher = wichtiger) */
  score: number;
  /** Nur für silent_model — Chatter, die im letzten Report auf dem Model sitzen */
  assignedChatters?: string[];
  /** Nur für silent_model — Model-Display-Name */
  modelName?: string;
}



interface LiveSnap {
  revenue: number;
  unread: number;
  oldest: number;
  updatedAt: string;
  hasRowToday: boolean;
}

interface ChatterStats {
  avgDailyRev: number;
  avgUnread: number;
  /** Übliche Startstunde (0-23) als Median der ersten Live-Aktivität in den letzten 14 Tagen */
  usualStartHour: number | null;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function fmtEur(v: number): string {
  return `${Math.round(v)} €`;
}

function fmtAgo(updatedAt: string, now: number): string {
  const ms = now - new Date(updatedAt).getTime();
  if (!isFinite(ms) || ms < 0) return "gerade";
  const min = Math.round(ms / 60000);
  if (min < 60) return `vor ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `vor ${h}h`;
  return `vor ${Math.floor(h / 24)}T`;
}

function fmtHour(h: number): string {
  return `${h.toString().padStart(2, "0")}:00`;
}

export async function loadPushCards(platform: string): Promise<PushCard[]> {
  const today = todayIso();
  const now = Date.now();
  const nowDate = new Date();
  const currentHour = nowDate.getHours() + nowDate.getMinutes() / 60;

  // 1. Aktive Chatter (Schnittmenge-Basis)
  const activeNames = await loadActiveChatterNames(platform);
  if (!activeNames || activeNames.size === 0) return [];

  // 2. Heutige Live-Daten
  const { data: liveTodayRaw } = await supabase
    .from("chatter_history_live")
    .select("chatter_name, revenue, unread_chats, oldest_chat, updated_at")
    .ilike("platform", platform)
    .eq("date", today);

  const liveByName = new Map<string, LiveSnap>();
  for (const r of liveTodayRaw ?? []) {
    const name = (r.chatter_name ?? "").trim();
    if (!name) continue;
    const k = normalizeChatterName(name);
    if (!activeNames.has(k)) continue;
    const updatedAt = r.updated_at ?? today;
    const prev = liveByName.get(k);
    if (prev && new Date(prev.updatedAt).getTime() >= new Date(updatedAt).getTime()) continue;
    liveByName.set(k, {
      revenue: Math.max(0, Number(r.revenue ?? 0)),
      unread: Math.max(0, Number(r.unread_chats ?? 0)),
      oldest: Math.max(0, Number(r.oldest_chat ?? 0)),
      updatedAt,
      hasRowToday: true,
    });
  }

  // 3. History 14T für Stats (Ø-Umsatz, Ø-Unread)
  const since = new Date();
  since.setDate(since.getDate() - 14);
  const sinceIso = since.toISOString().slice(0, 10);
  const { data: histRows } = await supabase
    .from("chatter_history")
    .select("chatter_name, analysis_date, revenue_today, open_chats")
    .eq("platform", platform)
    .gte("analysis_date", sinceIso);

  const statsByName = new Map<string, ChatterStats>();
  const revMap = new Map<string, number[]>();
  const unreadMap = new Map<string, number[]>();
  for (const r of histRows ?? []) {
    const name = (r.chatter_name ?? "").trim();
    if (!name) continue;
    const k = normalizeChatterName(name);
    if (!activeNames.has(k)) continue;
    if (!revMap.has(k)) revMap.set(k, []);
    revMap.get(k)!.push(Number(r.revenue_today ?? 0));
    if (!unreadMap.has(k)) unreadMap.set(k, []);
    unreadMap.get(k)!.push(Number(r.open_chats ?? 0));
  }

  // 4. Übliche Startstunde aus chatter_hourly_stats letzte 14 Tage
  const { data: hourlyRows } = await supabase
    .from("chatter_hourly_stats")
    .select("chatter_name, date, hour, revenue, mass_dms, unread_delta")
    .ilike("platform", platform)
    .gte("date", sinceIso);

  const startHoursByName = new Map<string, number[]>();
  // Pro Tag pro Chatter die früheste Aktiv-Stunde finden
  const earliestByChatterDay = new Map<string, Map<string, number>>();
  for (const r of hourlyRows ?? []) {
    const name = (r.chatter_name ?? "").trim();
    if (!name) continue;
    const k = normalizeChatterName(name);
    if (!activeNames.has(k)) continue;
    const hour = Number(r.hour);
    if (!isFinite(hour)) continue;
    const active = (Number(r.revenue ?? 0) > 0) || (Number(r.mass_dms ?? 0) > 0) || (Number(r.unread_delta ?? 0) < 0);
    if (!active) continue;
    let dayMap = earliestByChatterDay.get(k);
    if (!dayMap) {
      dayMap = new Map();
      earliestByChatterDay.set(k, dayMap);
    }
    const prev = dayMap.get(r.date);
    if (prev === undefined || hour < prev) dayMap.set(r.date, hour);
  }
  for (const [k, dayMap] of earliestByChatterDay) {
    startHoursByName.set(k, Array.from(dayMap.values()));
  }

  for (const k of activeNames) {
    const revs = revMap.get(k) ?? [];
    const unr = unreadMap.get(k) ?? [];
    const starts = startHoursByName.get(k) ?? [];
    statsByName.set(k, {
      avgDailyRev: revs.length ? revs.reduce((a, b) => a + b, 0) / revs.length : 0,
      avgUnread: unr.length ? unr.reduce((a, b) => a + b, 0) / unr.length : 0,
      usualStartHour: starts.length >= 3 ? Math.round(median(starts)) : null,
    });
  }

  // 5. Bucket-Entscheidung pro Chatter
  const cards: PushCard[] = [];
  // dayProgress 06:00–24:00
  const dayProgress = Math.max(0, Math.min(1, (currentHour - 6) / 18));

  for (const k of activeNames) {
    // Originalname aus History oder Live wiederherstellen — sonst lower_snake
    const live = liveByName.get(k);
    const stats = statsByName.get(k) ?? { avgDailyRev: 0, avgUnread: 0, usualStartHour: null };
    const displayName = pickDisplayName(k, hourlyRows, liveTodayRaw, histRows);

    if (live) {
      // ==== LIVE-Bucket ====
      const ageMin = Math.max(0, (now - new Date(live.updatedAt).getTime()) / 60000);
      const expectedByNow = stats.avgDailyRev * dayProgress;
      const pace = expectedByNow > 0 ? live.revenue / expectedByNow : 1;
      const pacePct = Math.round(pace * 100);

      // RESCUE: Stau ≥ 2h oder massiv Unread
      if (live.oldest >= 2 || (stats.avgUnread > 0 && live.unread >= Math.max(stats.avgUnread * 2, 15))) {
        const oldestRound = Math.round(live.oldest);
        cards.push({
          todoKey: `push:${displayName}:rescue:${today}`,
          chatterName: displayName,
          bucket: PUSH_BUCKETS.rescue,
          isLive: true,
          score: 100 + oldestRound * 5 + Math.min(20, live.unread / 2),
          suggestion: `Stau ${oldestRound}h · ${live.unread} ungelesen — sofort entlasten oder Ursache klären.`,
          dataLine: `Live: ${fmtEur(live.revenue)} heute · ältester Chat ${oldestRound}h · letzter Update ${fmtAgo(live.updatedAt, now)}`,
        });
        continue;
      }

      // KICK: < 70% Pace bei > 30% Tagesfortschritt
      if (expectedByNow > 0 && pace < 0.7 && dayProgress > 0.3) {
        const missing = Math.max(0, expectedByNow - live.revenue);
        cards.push({
          todoKey: `push:${displayName}:kick:${today}`,
          chatterName: displayName,
          bucket: PUSH_BUCKETS.kick,
          isLive: true,
          score: 90 + Math.min(20, missing / 20),
          suggestion: `Klare Ansage: ${pacePct}% vom Pace, fehlen ${fmtEur(missing)} bis erwarteter Stand. Frag was blockiert.`,
          dataLine: `Live: ${fmtEur(live.revenue)} / Pace ${fmtEur(expectedByNow)} · letzter Update ${fmtAgo(live.updatedAt, now)}`,
        });
        continue;
      }

      // HOT: ≥ 150% Pace
      if (expectedByNow > 0 && pace >= 1.5) {
        cards.push({
          todoKey: `push:${displayName}:hot:${today}`,
          chatterName: displayName,
          bucket: PUSH_BUCKETS.hot,
          isLive: true,
          score: 60 + Math.min(20, pace * 5),
          suggestion: `Loben — ${pacePct}% Pace ist stark. Sag ihm explizit, dass das gerade läuft und er Tempo halten soll.`,
          dataLine: `Live: ${fmtEur(live.revenue)} / Pace ${fmtEur(expectedByNow)} · letzter Update ${fmtAgo(live.updatedAt, now)}`,
        });
        continue;
      }

      // BOOST: 100–150% Pace
      if (expectedByNow > 0 && pace >= 1.0) {
        cards.push({
          todoKey: `push:${displayName}:boost:${today}`,
          chatterName: displayName,
          bucket: PUSH_BUCKETS.boost,
          isLive: true,
          score: 40 + Math.min(15, pace * 5),
          suggestion: `Kurzes Schulterklopfen — solide ${pacePct}%. Halt das Tempo bis zum Abend.`,
          dataLine: `Live: ${fmtEur(live.revenue)} / Pace ${fmtEur(expectedByNow)} · letzter Update ${fmtAgo(live.updatedAt, now)}`,
        });
        continue;
      }

      // PUSH: 70–100% Pace
      if (expectedByNow > 0 && pace >= 0.7) {
        const gap = Math.max(0, expectedByNow - live.revenue);
        cards.push({
          todoKey: `push:${displayName}:push:${today}`,
          chatterName: displayName,
          bucket: PUSH_BUCKETS.push,
          isLive: true,
          score: 50 + Math.min(15, gap / 15),
          suggestion: `Motivieren — ${pacePct}%, noch ${fmtEur(gap)} bis Pace. Kurze Nachricht, dass er nochmal nachlegen soll.`,
          dataLine: `Live: ${fmtEur(live.revenue)} / Pace ${fmtEur(expectedByNow)} · letzter Update ${fmtAgo(live.updatedAt, now)}`,
        });
        continue;
      }

      // ABGETAUCHT: live row da, aber > 2h kein Update
      if (ageMin >= 120 && stats.avgDailyRev > 0 && dayProgress > 0.1 && dayProgress < 0.95) {
        cards.push({
          todoKey: `push:${displayName}:dropped_off:${today}`,
          chatterName: displayName,
          bucket: PUSH_BUCKETS.dropped_off,
          isLive: false,
          score: 70 + Math.min(20, ageMin / 30),
          suggestion: `${Math.round(ageMin / 60)}h kein Update — kurz nachhaken, ob alles okay.`,
          dataLine: `Heute ${fmtEur(live.revenue)} · letzter Update ${fmtAgo(live.updatedAt, now)} · Tages-Ø ${fmtEur(stats.avgDailyRev)}`,
        });
        continue;
      }

      // Kein Bucket — silent (z. B. läuft normal aber noch zu früh am Tag)
      continue;
    }

    // ==== OFFLINE-Bucket (keine Live-Row heute) ====
    // SCHICHTSTART FÄLLIG: übliche Startstunde liegt vor jetzt
    if (stats.usualStartHour !== null && currentHour >= stats.usualStartHour + 0.5) {
      const lateMin = Math.round((currentHour - stats.usualStartHour) * 60);
      cards.push({
        todoKey: `push:${displayName}:shift_due:${today}`,
        chatterName: displayName,
        bucket: PUSH_BUCKETS.shift_due,
        isLive: false,
        score: 80 + Math.min(20, lateMin / 10),
        suggestion: `Schichtstart fällig — sonst aktiv ab ~${fmtHour(stats.usualStartHour)}. Erinnerung schreiben.`,
        dataLine: `Heute noch keine Aktivität · Tages-Ø ${fmtEur(stats.avgDailyRev)} · sonst aktiv ab ~${fmtHour(stats.usualStartHour)}`,
      });
      continue;
    }

    // KOMPLETT OFFLINE: nur wenn jemand mit Tages-Ø > 0 — sonst zu viel Rauschen
    if (stats.avgDailyRev > 20 && dayProgress > 0.25) {
      const expectedByNow = stats.avgDailyRev * dayProgress;
      cards.push({
        todoKey: `push:${displayName}:offline:${today}`,
        chatterName: displayName,
        bucket: PUSH_BUCKETS.offline,
        isLive: false,
        score: 55 + Math.min(25, expectedByNow / 20),
        suggestion: `Schreib ihn an — heute noch nichts gemacht, normalerweise schon ~${fmtEur(expectedByNow)} um diese Zeit.`,
        dataLine: `Heute offline · Tages-Ø ${fmtEur(stats.avgDailyRev)}${stats.usualStartHour !== null ? ` · sonst ab ~${fmtHour(stats.usualStartHour)}` : ""}`,
      });
      continue;
    }
  }

  // ==== SILENT MODELS ====
  // Models mit heute 0 €, aber 7T-Ø > 10 €/Tag und mind. 3 aktive Tage.
  try {
    const silent = await loadSilentModelCards(platform, today);
    cards.push(...silent);
  } catch (e) {
    console.error("[push-buckets] silent models", e);
  }



  // Sortierung: nach Bucket-Order, dann Score absteigend
  cards.sort((a, b) => {
    if (a.bucket.order !== b.bucket.order) return a.bucket.order - b.bucket.order;
    return b.score - a.score;
  });
  return cards;
}

/** Versucht den hübschen Namen für einen normalisierten Key wiederherzustellen. */
function pickDisplayName(
  normKey: string,
  ...sources: Array<Array<{ chatter_name?: string | null }> | null | undefined>
): string {
  for (const src of sources) {
    for (const r of src ?? []) {
      const n = (r?.chatter_name ?? "").toString().trim();
      if (n && normalizeChatterName(n) === normKey) return n;
    }
  }
  // Fallback: snake → Title Case
  return normKey
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

/**
 * Silent-Model-Karten: Model hat heute 0 € gemacht, aber im 7T-Schnitt (ohne
 * heute) > 10 €/Tag und mind. 3 aktive Tage → verantwortliche Chatter noch mal
 * anhauen.
 */
async function loadSilentModelCards(platform: string, today: string): Promise<PushCard[]> {
  const sevenAgo = new Date();
  sevenAgo.setDate(sevenAgo.getDate() - 7);
  const sinceIso = sevenAgo.toISOString().slice(0, 10);

  const { data: rows } = await supabase
    .from("chatter_history")
    .select("chatter_name, account, analysis_date, revenue_today")
    .ilike("platform", platform)
    .gte("analysis_date", sinceIso);

  if (!rows || rows.length === 0) return [];

  const activeModels = await loadActiveModels(platform);

  // Pro Model (normalisiert): { revByDay: Map<date, sum>, displayName, todayChatters: Set }
  interface Agg {
    display: string;
    revByDay: Map<string, number>;
    todayChatters: Map<string, string>; // normKey -> displayName
  }
  const perModel = new Map<string, Agg>();

  for (const r of rows) {
    const rawAcc = (r.account ?? "").trim();
    const rawName = (r.chatter_name ?? "").trim();
    if (!rawAcc) continue;
    const parts = rawAcc.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) continue;
    const rev = Number(r.revenue_today ?? 0);
    const perAcc = rev / parts.length;
    for (const acc of parts) {
      const key = normalizeAccountName(acc);
      if (activeModels && !activeModels.has(key)) continue;
      let agg = perModel.get(key);
      if (!agg) {
        agg = { display: acc, revByDay: new Map(), todayChatters: new Map() };
        perModel.set(key, agg);
      }
      agg.revByDay.set(r.analysis_date, (agg.revByDay.get(r.analysis_date) ?? 0) + perAcc);
      if (r.analysis_date === today && rawName) {
        const nk = normalizeChatterName(rawName);
        if (!agg.todayChatters.has(nk)) agg.todayChatters.set(nk, rawName);
      }
    }
  }

  const cards: PushCard[] = [];
  for (const [modelKey, agg] of perModel) {
    const todayRev = agg.revByDay.get(today) ?? 0;
    if (todayRev > 0) continue;

    // 7T-Schnitt ohne heute
    let sum = 0;
    let activeDays = 0;
    let totalDays = 0;
    let yesterday = 0;
    const yIso = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0,10); })();
    for (const [date, rev] of agg.revByDay) {
      if (date === today) continue;
      totalDays++;
      sum += rev;
      if (rev > 0) activeDays++;
      if (date === yIso) yesterday = rev;
    }
    if (totalDays === 0) continue;
    const avg = sum / totalDays;
    if (avg <= 10) continue;
    if (activeDays < 3) continue;

    const chatters = Array.from(agg.todayChatters.values());
    const chatterText = chatters.length > 0
      ? chatters.length === 1 ? chatters[0] : `${chatters.length} Chatter`
      : "kein Chatter zugewiesen";

    cards.push({
      todoKey: `push:model:${modelKey}:silent:${today}`,
      chatterName: agg.display,
      bucket: PUSH_BUCKETS.silent_model,
      isLive: false,
      score: 40 + Math.min(40, avg),
      suggestion: chatters.length > 0
        ? `Heute noch 0 € — ${chatterText} noch mal anhauen.`
        : `Heute noch 0 € auf ${agg.display} — heute kein Chatter zugewiesen.`,
      dataLine: `7T-Ø: ${fmtEur(avg)}/Tag${yesterday > 0 ? ` · gestern: ${fmtEur(yesterday)}` : ""} · heute: 0 €`,
      assignedChatters: chatters,
    });
  }

  cards.sort((a, b) => b.score - a.score);
  return cards;
}

