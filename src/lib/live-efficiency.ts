/**
 * Live-Effizienz pro Chatter — basiert auf chatter_activity_sessions (echte Online-Phasen).
 *
 * Quelle: SQL-Funktion `get_live_efficiency(user_id, platform, from, to)`.
 * Wird im Wechselmodus genutzt, um Skill nicht aus 7T-Tagessummen, sondern aus
 * tatsächlichen aktiven Minuten / Volumen / Reaktionszeit abzuleiten.
 */
import { supabase } from "@/integrations/supabase/client";

export interface LiveEfficiencyRow {
  chatter_name: string;
  total_active_min: number;
  total_revenue: number;
  total_mass_dms: number;
  total_incoming_proxy: number;
  session_count: number;
  active_days: number;
  range_days: number;
  eur_per_active_hour: number;
  eur_per_incoming: number;
  first_response_min_p50: number | null;
  session_consistency: number;
}

export async function fetchLiveEfficiency(
  platform: string,
  from: string,
  to: string,
): Promise<Map<string, LiveEfficiencyRow>> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Map();

  const { data, error } = await supabase.rpc("get_live_efficiency", {
    p_user_id: user.id,
    p_platform: platform,
    p_from: from,
    p_to: to,
  });
  if (error) {
    console.warn("[live-efficiency] rpc failed", error);
    return new Map();
  }
  const map = new Map<string, LiveEfficiencyRow>();
  for (const row of (data ?? []) as any[]) {
    const r: LiveEfficiencyRow = {
      chatter_name: row.chatter_name,
      total_active_min: Number(row.total_active_min) || 0,
      total_revenue: Number(row.total_revenue) || 0,
      total_mass_dms: Number(row.total_mass_dms) || 0,
      total_incoming_proxy: Number(row.total_incoming_proxy) || 0,
      session_count: Number(row.session_count) || 0,
      active_days: Number(row.active_days) || 0,
      range_days: Number(row.range_days) || 1,
      eur_per_active_hour: Number(row.eur_per_active_hour) || 0,
      eur_per_incoming: Number(row.eur_per_incoming) || 0,
      first_response_min_p50: row.first_response_min_p50 == null ? null : Number(row.first_response_min_p50),
      session_consistency: Number(row.session_consistency) || 0,
    };
    map.set(r.chatter_name.trim().toLowerCase(), r);
  }
  return map;
}

/** Hat dieser Chatter genug Live-Daten für einen verlässlichen Live-Score? */
export function hasUsableLiveData(row: LiveEfficiencyRow | undefined): boolean {
  if (!row) return false;
  return row.total_active_min >= 60 && row.session_count >= 3;
}
