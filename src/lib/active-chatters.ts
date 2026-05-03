/**
 * Aktive Chatter = Namen, die im NEUESTEN analysis_report dieser Plattform
 * vorkommen. Chatter, die in einem neueren Upload nicht mehr enthalten sind,
 * gelten als "raus" und werden in der UI komplett ausgeblendet — ihre History
 * bleibt aber in der Datenbank erhalten.
 *
 * Wird von Daily-Todos, Recovery-Queue und Anomaly-Engine benutzt.
 */
import { supabase } from "@/integrations/supabase/client";
import { onChatterDataUpdated } from "@/lib/data-events";

export function normalizeChatterName(name: string): string {
  return name.toLowerCase().replace(/[_ ]+/g, "_").trim();
}

interface CacheEntry {
  ts: number;
  names: Set<string>;
  /** null = noch nie ein Report geladen → keinen Filter anwenden */
  hasReport: boolean;
}

const cache = new Map<string, CacheEntry>();
const TTL_MS = 60_000;

/**
 * Liefert die normalisierten Namen aller Chatter aus dem aktuellsten Report.
 * Returns `null`, wenn (noch) gar kein Report existiert — dann darf NICHT
 * gefiltert werden, sonst sieht der Nutzer komplett leere Listen.
 */
export async function loadActiveChatterNames(platform: string): Promise<Set<string> | null> {
  const cached = cache.get(platform);
  if (cached && Date.now() - cached.ts < TTL_MS) {
    return cached.hasReport ? cached.names : null;
  }

  const { data } = await supabase
    .from("analysis_reports")
    .select("result_json")
    .eq("platform", platform)
    .not("result_json", "is", null)
    .order("analysis_date", { ascending: false })
    .limit(1);

  const result = data?.[0]?.result_json as
    | { categories?: { chatters?: { name?: string }[] }[] }
    | null
    | undefined;

  if (!result || !Array.isArray(result.categories)) {
    cache.set(platform, { ts: Date.now(), names: new Set(), hasReport: false });
    return null;
  }

  const names = new Set<string>();
  for (const cat of result.categories) {
    for (const ch of cat.chatters ?? []) {
      if (ch?.name) names.add(normalizeChatterName(ch.name));
    }
  }
  cache.set(platform, { ts: Date.now(), names, hasReport: true });
  return names;
}

export function invalidateActiveChattersCache(platform?: string): void {
  if (platform) cache.delete(platform);
  else cache.clear();
}
