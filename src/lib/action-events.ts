/**
 * Aktions-Monitor — erkennt Handlungen (Account-Tausch, Account weggenommen,
 * Chatter rein/raus) automatisch aus den Reports und bewertet sie 3 bzw. 7 Tage
 * später anhand der tatsächlichen Umsatzentwicklung.
 */
import { supabase } from "@/integrations/supabase/client";

export type ActionEventType =
  | "account_reassigned"
  | "account_removed"
  | "account_added"
  | "chatter_onboarded"
  | "chatter_offboarded";

export type Verdict = "good" | "neutral" | "bad" | "watch";

export interface ActionEvent {
  id: string;
  platform: string;
  event_type: ActionEventType | string;
  chatter_name: string | null;
  counterpart_chatter: string | null;
  account: string | null;
  prev_account: string | null;
  detected_on: string;
  baseline_json: Record<string, any>;
  outcome_json: Record<string, any>;
  evaluated_at: string | null;
  verdict: Verdict | null;
  verdict_reason: string | null;
  recommendation: string | null;
  impact_eur: number;
  status: "open" | "accepted" | "reverted" | "archived" | string;
  created_at: string;
}

export const EVENT_LABEL: Record<string, string> = {
  account_reassigned: "Account getauscht",
  account_removed: "Account weggenommen",
  account_added: "Account dazugegeben",
  chatter_onboarded: "Chatter neu dazu",
  chatter_offboarded: "Chatter rausgenommen",
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  good: "Hat funktioniert",
  neutral: "Kein Unterschied",
  bad: "War kein guter Zug",
  watch: "Weiter beobachten",
};

export async function listActionEvents(platform: string, limit = 200): Promise<ActionEvent[]> {
  const { data, error } = await supabase
    .from("action_events")
    .select("*")
    .eq("platform", platform)
    .neq("status", "archived")
    .order("detected_on", { ascending: false })
    .order("impact_eur", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as ActionEvent[];
}

/** Anzahl offener Negativ-Bewertungen (für das Badge in der Sidebar). */
export async function countBadVerdicts(platform: string): Promise<number> {
  const { count } = await supabase
    .from("action_events")
    .select("id", { count: "exact", head: true })
    .eq("platform", platform)
    .eq("status", "open")
    .eq("verdict", "bad");
  return count ?? 0;
}

export async function setEventStatus(id: string, status: ActionEvent["status"]) {
  const { error } = await supabase.from("action_events").update({ status }).eq("id", id);
  if (error) throw error;
}

/** Erkennung nach einem Report-Upload — vergleicht die letzten beiden Report-Tage. */
export async function detectActionEvents(platform: string) {
  const { data, error } = await supabase.functions.invoke("detect-action-events", {
    body: { platform },
  });
  if (error) throw error;
  return data as { ok: boolean; created: number };
}

/** Bewertung fälliger Handlungen (>= 3 Tage alt). */
export async function evaluateActionEvents(platform: string, force = false) {
  const { data, error } = await supabase.functions.invoke("evaluate-action-events", {
    body: { platform, force },
  });
  if (error) throw error;
  return data as { ok: boolean; evaluated: number };
}

/** Aggregiertes Lernen: Trefferquote pro Handlungsart. */
export interface VerdictPattern {
  event_type: string;
  good: number;
  bad: number;
  total: number;
}

export function summarizePatterns(events: ActionEvent[]): VerdictPattern[] {
  const m = new Map<string, VerdictPattern>();
  for (const e of events) {
    if (!e.verdict || e.verdict === "watch") continue;
    const p = m.get(e.event_type) ?? { event_type: e.event_type, good: 0, bad: 0, total: 0 };
    if (e.verdict === "good") p.good++;
    if (e.verdict === "bad") p.bad++;
    p.total++;
    m.set(e.event_type, p);
  }
  return Array.from(m.values()).sort((a, b) => b.total - a.total);
}
