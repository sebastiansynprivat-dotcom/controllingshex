import { supabase } from "@/integrations/supabase/client";

export interface CoachingMaterial {
  id: string;
  title: string;
  content: string;
  is_active: boolean;
  updated_at: string;
}

export interface StoryboardRound {
  round?: number;
  context?: string;
  customer?: string;
  chatter_did?: string;
  verdict?: string;
  better_version?: string;
  why_one_line?: string;
  say_this?: string;
}

export interface QuizQuestion {
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
}

export interface SimulationPrompt {
  customer_message: string;
  evaluation_criteria: string;
}

export interface CustomerCard {
  alias?: string;
  spend_estimate?: string;
  kink_hint?: string;
  mood?: string;
  last_action?: string;
}

export interface DrillPrompt {
  prompt: string;
  option_a: string;
  option_b: string;
  better_option: "a" | "b";
  why: string;
}

export interface BossAnecdote {
  hook: string;
  story: string;
}

export interface BossScenario {
  customer_alias: string;
  customer_profile: string;
  opening_message: string;
  goal: string;
  max_turns?: number;
}

export interface Lever {
  icon_hint?: string;
  title: string;
  one_liner?: string;
  money_line?: string;
  situation_summary?: string;
  customer_profile?: string;
  customer_card?: CustomerCard;
  context_messages?: string[];
  storyboard?: StoryboardRound[];
  quiz?: QuizQuestion;
  drill?: DrillPrompt;
  boss_anecdote?: BossAnecdote;
  simulation_prompt?: SimulationPrompt;
  // Legacy fields
  principle?: string;
  wrong_example?: string;
  better_example?: string;
  if_then_script?: string;
  story?: string;
  money_example?: string;
}

export interface SBIStrength {
  situation: string;
  behavior: string;
  impact: string;
}

export interface SBIGrowth extends SBIStrength {
  alternative_if_then: string;
}

export interface AnalysisResult {
  overall_score: number | null;
  chats_analyzed: number;
  chats_total?: number;
  personal_intro?: string;
  headline_promise?: string;
  weekly_comparison?: {
    current_revenue_eur?: number;
    previous_revenue_eur?: number;
    delta_pct?: number | null;
    headline?: string;
    summary?: string;
  } | null;
  top_3_levers?: Lever[];
  boss_scenario?: BossScenario | null;
  sbi_feedback?: { strength: SBIStrength; growth: SBIGrowth } | null;
  micro_action?: string;
  retrieval_question?: string;
  executive_summary?: string;
  personal_closing?: string;
  top_focus?: string[];
  patterns?: any[];
  chats?: any[];
}

export interface BossFightTurn {
  role: "customer" | "chatter";
  text: string;
  at?: string;
}

export interface BossFightResult {
  turns: BossFightTurn[];
  score?: number;
  verdict?: string;
  revenue_potential_eur?: number;
  feedback?: string;
  completed_at?: string;
}

export interface CinemaProgress {
  messages_revealed?: number;
  guess?: string;
  guess_score?: number;
  guess_feedback?: string;
  skipped?: boolean;
  completed?: boolean;
  at?: string;
}

export interface CoachingProgress {
  cards_seen?: number[]; // indexes of visited story-cards
  quiz_answers?: Record<number, { selected: number; correct: boolean; at: string }>;
  drill_answers?: Record<number, { picked: "a" | "b"; correct: boolean; typed?: string; score?: number; feedback?: string; polished?: string; at: string }>;
  simulation_results?: Record<number, { answer: string; score: number; feedback: string; improved_reply?: string; at: string }>;
  cinema_progress?: Record<number, CinemaProgress>;
  actions_done?: Record<number, boolean>;
  levers_read?: number[]; // legacy
  completed?: boolean;
  // v4 — dopamin / progress signals (nur UI, kein Backend-Impact)
  momentum_scores?: number[]; // rollierend, max 10 Einträge (0–10)
  answer_streak?: number;     // aktuelle „Richtig-in-Folge" innerhalb der Session
  session_streak?: number;    // abgeschlossene Coachings in Folge (persistiert)
}


export interface CoachingMemo {
  id: string;
  card_key: string;
  audio_path: string;
  audio_url?: string | null;
  duration_ms?: number | null;
  created_at: string;
  updated_at: string;
}

export interface CoachingAnalysisRow {
  id: string;
  user_id?: string;
  chatter_name: string;
  platform: string;
  model_username: string | null;
  date_from: string;
  date_to: string;
  pdf_path: string | null;
  summary_json: AnalysisResult;
  chats_analyzed: number;
  created_at: string;
  share_token: string;
  progress_json: CoachingProgress;
  completed_at: string | null;
  xp_earned?: number;
  current_card_index?: number;
  commitment_text?: string | null;
  boss_fight_result?: BossFightResult | null;
  memos?: CoachingMemo[];
}


/* ---------------- Materials ---------------- */

export async function listMaterials(): Promise<CoachingMaterial[]> {
  const { data, error } = await supabase
    .from("coaching_materials")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CoachingMaterial[];
}

export async function saveMaterial(m: { id?: string; title: string; content: string; is_active: boolean }) {
  if (m.id) {
    const { error } = await supabase
      .from("coaching_materials")
      .update({ title: m.title, content: m.content, is_active: m.is_active })
      .eq("id", m.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("coaching_materials")
      .insert({ title: m.title, content: m.content, is_active: m.is_active });
    if (error) throw error;
  }
}

export async function deleteMaterial(id: string) {
  const { error } = await supabase.from("coaching_materials").delete().eq("id", id);
  if (error) throw error;
}

/* ---------------- Chatters ---------------- */

export interface ChatterCandidate {
  chatter_name: string;
  account: string | null;
  last_analysis_date: string;
}

export async function listChattersForPlatform(platform: string): Promise<ChatterCandidate[]> {
  const { data: latest } = await supabase
    .from("analysis_reports")
    .select("analysis_date")
    .eq("platform", platform)
    .order("analysis_date", { ascending: false })
    .limit(1);

  if (!latest || latest.length === 0) return [];
  const latestDate = latest[0].analysis_date;

  const { data, error } = await supabase
    .from("chatter_history")
    .select("chatter_name, account")
    .eq("platform", platform)
    .eq("analysis_date", latestDate);

  if (error) throw error;

  const map = new Map<string, ChatterCandidate>();
  for (const row of data ?? []) {
    if (!row.chatter_name) continue;
    if (!map.has(row.chatter_name)) {
      map.set(row.chatter_name, {
        chatter_name: row.chatter_name,
        account: row.account,
        last_analysis_date: latestDate,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.chatter_name.localeCompare(b.chatter_name));
}

/* ---------------- Analyses ---------------- */

export async function listAnalyses(chatter_name: string, platform: string): Promise<CoachingAnalysisRow[]> {
  const { data, error } = await supabase
    .from("coaching_analyses")
    .select("*")
    .eq("chatter_name", chatter_name)
    .eq("platform", platform)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as CoachingAnalysisRow[];
}

interface ResolvedToken {
  platform: string;
  username: string;
  token: string;
}

async function resolveTokens(input: {
  chatter_name: string;
  platform: string;
  model_username: string | null;
}): Promise<{ telegram_id: string; tokens: ResolvedToken[] }> {
  const { data, error } = await supabase.functions.invoke("resolve-chatter-tokens", {
    body: {
      chatter_name: input.chatter_name,
      platform: input.platform,
      model_username: input.model_username,
    },
  });
  if (error) throw new Error(error.message || "resolve-chatter-tokens failed");
  if (!data?.telegram_id || !Array.isArray(data?.tokens) || data.tokens.length === 0) {
    throw new Error(data?.error || "Keine Tokens gefunden");
  }
  return { telegram_id: data.telegram_id as string, tokens: data.tokens as ResolvedToken[] };
}

function awaitRequestCompletion(
  requestId: string,
  onProgress?: (n: number) => void,
  timeoutMs = 300_000,
  idleMs = 20_000,
): Promise<any[]> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let lastChats: any[] = [];
    let lastChangeAt = Date.now();
    let completedAt: number | null = null; // Zeitpunkt, an dem status=completed erstmals gesehen wurde
    const COMPLETED_GRACE_MS = 20_000; // Wartezeit auf verspätete Chats nach "completed"
    const cleanup = () => {
      try { channel.unsubscribe(); } catch { /* noop */ }
      clearInterval(poll);
      clearInterval(idleCheck);
      clearTimeout(timer);
    };
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const handleRow = (row: any) => {
      if (!row) return;
      const chats = Array.isArray(row.result_json) ? row.result_json : [];
      if (chats.length !== lastChats.length) {
        lastChats = chats;
        lastChangeAt = Date.now();
        onProgress?.(chats.length);
      }
      if (row.status === "completed") {
        if (chats.length > 0) {
          done(() => resolve(chats));
        } else if (completedAt === null) {
          // Race: externer Dienst hat "done" vor den Chat-Batches geschickt.
          // Nicht sofort mit 0 auflösen — bis zu COMPLETED_GRACE_MS auf Chats warten.
          completedAt = Date.now();
        }
      } else if (row.status === "failed") {
        if (chats.length > 0) done(() => resolve(chats));
        else done(() => reject(new Error(row.error_message || "Chat-Fetch fehlgeschlagen")));
      }
    };

    const channel = supabase
      .channel(`chats_fetch_requests:${requestId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chats_fetch_requests", filter: `id=eq.${requestId}` },
        (payload) => handleRow(payload.new),
      )
      .subscribe();

    const pollOnce = async () => {
      const { data } = await supabase
        .from("chats_fetch_requests")
        .select("status, result_json, error_message")
        .eq("id", requestId)
        .maybeSingle();
      handleRow(data);
    };
    const poll = setInterval(pollOnce, 3000);
    pollOnce();

    const idleCheck = setInterval(() => {
      // Nach "completed" + Grace Period: mit dem auflösen, was wir haben (auch 0).
      if (completedAt !== null && Date.now() - completedAt >= COMPLETED_GRACE_MS) {
        done(() => resolve(lastChats));
        return;
      }
      // Klassischer Idle: wir haben Chats, seit `idleMs` kam nichts neues.
      if (lastChats.length > 0 && Date.now() - lastChangeAt >= idleMs) {
        done(() => resolve(lastChats));
      }
    }, 1000);

    const timer = setTimeout(() => {
      if (lastChats.length > 0) done(() => resolve(lastChats));
      else done(() => reject(new Error("Timeout beim Laden der Chats (5 min).")));
    }, timeoutMs);
  });
}

export async function fetchChatsForAnalysis(input: {
  chatter_name: string;
  platform: string;
  model_username: string | null;
  date_from: string;
  date_to: string;
  onStage?: (stage: string) => void;
}): Promise<any[]> {
  input.onStage?.("Tokens werden aufgelöst…");
  const { telegram_id, tokens } = await resolveTokens({
    chatter_name: input.chatter_name,
    platform: input.platform,
    model_username: input.model_username,
  });

  input.onStage?.(`Fordere Chats für ${tokens.length} Model(s) an…`);
  const date_range = { start: input.date_from, end: input.date_to };

  const requestIds = await Promise.all(
    tokens.map(async (t) => {
      const { data, error } = await supabase.functions.invoke("request-chats", {
        body: {
          telegram_id,
          platform: t.platform,
          token: t.token,
          model_username: t.username,
          date_range,
        },
      });
      if (error) throw new Error(error.message || "request-chats failed");
      return { request_id: data.request_id as string, username: t.username };
    }),
  );

  input.onStage?.("Warte auf Chats vom externen Dienst…");
  const counts = new Map<string, number>();
  const chatArrays = await Promise.all(
    requestIds.map(({ request_id, username }) =>
      awaitRequestCompletion(request_id, (n) => {
        counts.set(username, n);
        const total = Array.from(counts.values()).reduce((s, v) => s + v, 0);
        input.onStage?.(`Lade Chats… ${total}`);
      }).catch((e) => {
        console.warn(`Chat-Fetch für ${username} fehlgeschlagen:`, e);
        return [] as any[];
      }),
    ),
  );

  const aggregated: any[] = [];
  for (let i = 0; i < chatArrays.length; i++) {
    const username = requestIds[i].username;
    for (const c of chatArrays[i]) {
      aggregated.push({ ...c, model_username: (c && c.model_username) || username });
    }
  }

  if (aggregated.length === 0) {
    const modelList = requestIds.map((r) => r.username).join(", ");
    throw new Error(
      `Für ${modelList} wurden im Zeitraum ${input.date_from} – ${input.date_to} keine Chats gefunden. Bitte Zeitraum vergrößern oder anderes Model wählen.`,
    );
  }

  return aggregated;
}

export async function analyzeChats(input: {
  chatter_name: string;
  platform: string;
  model_username: string | null;
  date_from: string;
  date_to: string;
  chats: any[];
  onStage?: (stage: string) => void;
}): Promise<AnalysisResult> {
  input.onStage?.(`Analysiere ${input.chats.length} Chats mit KI…`);
  const url = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/generate-coaching-analysis`;
  const { data: { session } } = await supabase.auth.getSession();
  const anon = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${session?.access_token ?? anon}`,
      "apikey": anon,
    },
    body: JSON.stringify({
      chatter_name: input.chatter_name,
      platform: input.platform,
      model_username: input.model_username,
      date_from: input.date_from,
      date_to: input.date_to,
      chats: input.chats,
    }),
  });
  const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json as AnalysisResult;
}

export async function runAnalysis(input: {
  chatter_name: string;
  platform: string;
  model_username: string | null;
  date_from: string;
  date_to: string;
  onStage?: (stage: string) => void;
}): Promise<AnalysisResult> {
  const chats = await fetchChatsForAnalysis(input);
  return analyzeChats({ ...input, chats });
}

/* ---------------- Save / Share / Progress ---------------- */

function randomToken(bytes = 16): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function getShareUrl(token: string): string {
  return `${window.location.origin}/c/${token}`;
}

export async function saveAnalysis(input: {
  chatter_name: string;
  platform: string;
  model_username: string | null;
  date_from: string;
  date_to: string;
  result: AnalysisResult;
}): Promise<CoachingAnalysisRow> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Nicht eingeloggt");

  const share_token = randomToken(16);

  const { data, error } = await supabase
    .from("coaching_analyses")
    .insert({
      user_id: user.id,
      chatter_name: input.chatter_name,
      platform: input.platform,
      model_username: input.model_username,
      date_from: input.date_from,
      date_to: input.date_to,
      summary_json: input.result as any,
      chats_analyzed: input.result.chats_analyzed,
      share_token,
      progress_json: {} as any,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as CoachingAnalysisRow;
}

export async function deleteAnalysis(row: CoachingAnalysisRow) {
  if (row.pdf_path) {
    try { await supabase.storage.from("coaching-pdfs").remove([row.pdf_path]); } catch { /* noop */ }
  }
  const { error } = await supabase.from("coaching_analyses").delete().eq("id", row.id);
  if (error) throw error;
}

/* ---------------- Public share access (via edge functions) ---------------- */

export async function loadAnalysisByToken(token: string): Promise<CoachingAnalysisRow> {
  const url = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/get-coaching-by-token`;
  const anon = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": anon, "Authorization": `Bearer ${anon}` },
    body: JSON.stringify({ token }),
  });
  const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json as CoachingAnalysisRow;
}

export async function updateProgress(
  token: string,
  patch: {
    progress?: CoachingProgress;
    xp_earned?: number;
    current_card_index?: number;
    commitment_text?: string;
    boss_fight_result?: BossFightResult;
  },
): Promise<void> {
  const url = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/update-coaching-progress`;
  const anon = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": anon, "Authorization": `Bearer ${anon}` },
    body: JSON.stringify({ token, ...patch }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(json.error || `HTTP ${res.status}`);
  }
}

export async function evaluateSimulation(input: {
  token: string;
  lever_index: number;
  answer: string;
}): Promise<{ score: number; feedback: string; improved_reply?: string }> {
  const url = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/evaluate-coaching-simulation`;
  const anon = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": anon, "Authorization": `Bearer ${anon}` },
    body: JSON.stringify({ ...input, mode: "evaluate_single" }),
  });
  const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

export async function evaluateDrill(input: {
  token: string;
  lever_index: number;
  answer: string;
}): Promise<{ score: number; feedback: string; polished?: string }> {
  const url = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/evaluate-coaching-drill`;
  const anon = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": anon, "Authorization": `Bearer ${anon}` },
    body: JSON.stringify(input),
  });
  const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

export async function bossFightCustomerReply(input: {
  token: string;
  turn_history: BossFightTurn[];
}): Promise<{ reply: string; engagement_delta: number }> {
  const url = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/evaluate-coaching-simulation`;
  const anon = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": anon, "Authorization": `Bearer ${anon}` },
    body: JSON.stringify({ ...input, mode: "customer_reply" }),
  });
  const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

export async function bossFightFinalScore(input: {
  token: string;
  turn_history: BossFightTurn[];
}): Promise<{ score: number; verdict: string; revenue_potential_eur: number; feedback: string }> {
  const url = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/evaluate-coaching-simulation`;
  const anon = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": anon, "Authorization": `Bearer ${anon}` },
    body: JSON.stringify({ ...input, mode: "boss_final" }),
  });
  const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

/* ---------------- Level / XP helpers ---------------- */

export function levelFromXp(xp: number): { level: number; title: string; nextAt: number; progress: number } {
  const tiers: Array<{ min: number; title: string }> = [
    { min: 0, title: "Rookie" },
    { min: 100, title: "Closer" },
    { min: 250, title: "Shark" },
    { min: 500, title: "Legende" },
  ];
  let level = 1;
  let title = tiers[0].title;
  for (let i = 0; i < tiers.length; i++) {
    if (xp >= tiers[i].min) { level = i + 1; title = tiers[i].title; }
  }
  const next = tiers[level] ?? tiers[tiers.length - 1];
  const prev = tiers[level - 1];
  const nextAt = next?.min ?? prev.min;
  const span = Math.max(1, nextAt - prev.min);
  const progress = level >= tiers.length ? 1 : Math.min(1, (xp - prev.min) / span);
  return { level, title, nextAt, progress };
}

/* ---------------- Progress helpers ---------------- */

export function computeProgressStats(result: AnalysisResult | null | undefined, progress: CoachingProgress | null | undefined) {
  const levers = result?.top_3_levers ?? [];
  const total = levers.length;
  const read = new Set(progress?.levers_read ?? progress?.cards_seen ?? []).size;
  const quizAnswered = Object.keys(progress?.quiz_answers ?? {}).length;
  const quizCorrect = Object.values(progress?.quiz_answers ?? {}).filter((a) => a?.correct).length;
  const actions = Object.values(progress?.actions_done ?? {}).filter(Boolean).length;
  return { total, read, quizAnswered, quizCorrect, actions, completed: !!progress?.completed };
}

