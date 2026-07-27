import { supabase } from "@/integrations/supabase/client";

export interface BriefingPattern {
  title: string;
  detail: string;
  severity: "info" | "warn" | "critical";
}

export interface GoalSnapshot {
  month_key?: string;
  goal_eur?: number;
  revenue_so_far?: number;
  day_of_month?: number;
  days_in_month?: number;
  pace_daily?: number;
  projected_month?: number;
  needed_daily?: number;
  gap_eur?: number;
}

export interface DailyBriefing {
  id: string;
  platform: string;
  briefing_date: string;
  status: "pending" | "running" | "ready" | "error";
  headline: string | null;
  situation: string | null;
  patterns: BriefingPattern[];
  goal_snapshot: GoalSnapshot;
  total_impact_eur: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface BriefingAction {
  id: string;
  briefing_id: string;
  rank: number;
  chatter_name: string | null;
  account: string | null;
  action_type: string;
  title: string;
  instruction: string;
  reasoning: string | null;
  impact_eur: number;
  confidence: string | null;
  bucket: "quick_win" | "structural";
  status: "open" | "done" | "dismissed";
  done_at: string | null;
}

export function monthKey(d = new Date()) {
  return d.toISOString().slice(0, 7);
}

export async function getGoal(platform: string, key = monthKey()): Promise<number> {
  const { data } = await supabase
    .from("revenue_goals")
    .select("goal_eur")
    .eq("platform", platform)
    .eq("month_key", key)
    .maybeSingle();
  return Number(data?.goal_eur) || 0;
}

export async function setGoal(platform: string, goalEur: number, key = monthKey()) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not auth");
  const { error } = await supabase
    .from("revenue_goals")
    .upsert(
      { user_id: user.id, platform, month_key: key, goal_eur: goalEur },
      { onConflict: "user_id,platform,month_key" },
    );
  if (error) throw error;
}

export async function getTodayBriefing(platform: string): Promise<DailyBriefing | null> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("daily_briefings")
    .select("*")
    .eq("platform", platform)
    .eq("briefing_date", today)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as DailyBriefing) ?? null;
}

export async function listBriefings(platform: string, limit = 20): Promise<DailyBriefing[]> {
  const { data, error } = await supabase
    .from("daily_briefings")
    .select("*")
    .eq("platform", platform)
    .order("briefing_date", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as DailyBriefing[];
}

export async function listActions(briefingId: string): Promise<BriefingAction[]> {
  const { data, error } = await supabase
    .from("briefing_actions")
    .select("*")
    .eq("briefing_id", briefingId)
    .order("rank", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as BriefingAction[];
}

export async function setActionStatus(id: string, status: "open" | "done" | "dismissed") {
  const { error } = await supabase
    .from("briefing_actions")
    .update({ status, done_at: status === "done" ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) throw error;
}

export async function generateBriefing(platform: string, force = false): Promise<{ briefing_id: string; status: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Nicht eingeloggt");
  const { data, error } = await supabase.functions.invoke("generate-daily-briefing", {
    body: { platform, force },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) throw new Error((data as any)?.error || error.message);
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as { briefing_id: string; status: string };
}
