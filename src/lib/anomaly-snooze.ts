/**
 * Snooze-Logik für Auffälligkeiten im Heute-Tab.
 *
 * Ein Snooze blendet eine Auffälligkeit (Chatter oder Chatter+Kind) im
 * Heute-Tab bis `snoozed_until` (inklusive) aus. Auf `/auffaelligkeiten`
 * bleibt sie sichtbar (mit dezenter Uhr-Markierung).
 */
import { supabase } from "@/integrations/supabase/client";
import type { AnomalyType } from "@/lib/anomaly-window";

export interface AnomalySnooze {
  id: string;
  chatter_name: string;
  alert_type: string | null;
  snoozed_until: string; // ISO date
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function tomorrowIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[_ ]+/g, "_").trim();
}

/** Alle aktiven (nicht abgelaufenen) Snoozes für den Workspace. */
export async function loadActiveSnoozes(
  userId: string,
  platform: string,
): Promise<AnomalySnooze[]> {
  const { data, error } = await supabase
    .from("anomaly_snooze")
    .select("id, chatter_name, alert_type, snoozed_until")
    .eq("user_id", userId)
    .eq("platform", platform)
    .gte("snoozed_until", todayIso());
  if (error || !data) return [];
  return data as AnomalySnooze[];
}

/** Snooze bis morgen (Standard). Blendet Chatter komplett aus dem Heute-Tab aus. */
export async function snoozeChatterUntilTomorrow(params: {
  userId: string;
  platform: string;
  chatterName: string;
}): Promise<void> {
  await supabase.from("anomaly_snooze").insert({
    user_id: params.userId,
    platform: params.platform,
    chatter_name: params.chatterName,
    alert_type: null,
    snoozed_until: tomorrowIso(),
  } as any);
}

/** Snooze aufheben (alle offenen Einträge für Chatter). */
export async function unsnoozeChatter(params: {
  userId: string;
  platform: string;
  chatterName: string;
}): Promise<void> {
  await supabase
    .from("anomaly_snooze")
    .delete()
    .eq("user_id", params.userId)
    .eq("platform", params.platform)
    .eq("chatter_name", params.chatterName)
    .gte("snoozed_until", todayIso());
}

/** Set aus normalisierten Chatter-Namen, die aktuell komplett gesnoozt sind. */
export function buildSnoozedChatterSet(snoozes: AnomalySnooze[]): Set<string> {
  const set = new Set<string>();
  for (const s of snoozes) {
    if (!s.alert_type) set.add(normalize(s.chatter_name));
  }
  return set;
}
