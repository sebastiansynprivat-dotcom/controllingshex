import { supabase } from "@/integrations/supabase/client";

export interface ChannelKnowledge {
  id: string;
  title: string | null;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface ChannelPlan {
  id: string;
  week_start: string;
  generation_context: string | null;
  created_at: string;
}

export interface ChannelPlanDay {
  id: string;
  plan_id: string;
  plan_date: string;
  weekday: number;
  theme: string;
  post_text: string;
  context_notes: {
    season?: string;
    holiday?: string | null;
    day_of_month?: number;
    month_de?: string;
    weekday_de?: string;
  };
  position: number;
}

// Channel data is shared across all workspaces (platforms) per user.
const SHARED_PLATFORM = "__shared__";

export async function listKnowledge(_platform?: string): Promise<ChannelKnowledge[]> {
  const { data, error } = await supabase
    .from("channel_knowledge")
    .select("id, title, body, created_at, updated_at")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []) as ChannelKnowledge[];
}

export async function createKnowledge(_platform: string, title: string | null, body: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not auth");
  const { error } = await supabase.from("channel_knowledge").insert({
    user_id: user.id, platform: SHARED_PLATFORM, title, body,
  });
  if (error) throw error;
}

export async function updateKnowledge(id: string, title: string | null, body: string) {
  const { error } = await supabase.from("channel_knowledge").update({ title, body }).eq("id", id);
  if (error) throw error;
}

export async function deleteKnowledge(id: string) {
  const { error } = await supabase.from("channel_knowledge").delete().eq("id", id);
  if (error) throw error;
}

export async function listPlans(_platform?: string): Promise<ChannelPlan[]> {
  const { data, error } = await supabase
    .from("channel_plans")
    .select("id, week_start, generation_context, created_at")
    .order("week_start", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data || []) as ChannelPlan[];
}

export async function listPlanDays(planId: string): Promise<ChannelPlanDay[]> {
  const { data, error } = await supabase
    .from("channel_plan_days")
    .select("id, plan_id, plan_date, weekday, theme, post_text, context_notes, position")
    .eq("plan_id", planId)
    .order("position", { ascending: true });
  if (error) throw error;
  return (data || []) as ChannelPlanDay[];
}

export async function updatePlanDay(id: string, theme: string, post_text: string) {
  const { error } = await supabase
    .from("channel_plan_days")
    .update({ theme, post_text })
    .eq("id", id);
  if (error) throw error;
}

export async function deletePlan(id: string) {
  const { error } = await supabase.from("channel_plans").delete().eq("id", id);
  if (error) throw error;
}

export async function generatePlan(opts: {
  platform: string;
  week_start: string; // YYYY-MM-DD
  selected_weekdays: number[]; // 1..7 (Mon..Sun)
  extra_context?: string;
}): Promise<{ plan_id: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Nicht eingeloggt");
  const { data, error } = await supabase.functions.invoke("generate-channel-plan", {
    body: opts,
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) {
    const msg = (data as any)?.error || error.message || "Generation failed";
    throw new Error(msg);
  }
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as { plan_id: string };
}

// next Monday helper
export function nextMondayISO(): string {
  const d = new Date();
  const day = d.getDay(); // 0..6, 0=Sun
  const diff = day === 1 ? 7 : ((1 - day + 7) % 7) || 7;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}
