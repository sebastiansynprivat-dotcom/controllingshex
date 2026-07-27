import type { SupabaseClient } from "@supabase/supabase-js";

function normalizeName(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/[\uFE00-\uFE0F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD]/g, "")
    .replace(/[\u00A0\u2007\u202F]/g, " ")
    .toLowerCase()
    .replace(/[_ ]+/g, "_")
    .trim();
}

/**
 * Liefert die Namen aller Chatter, die im neuesten analysis_report einer
 * Plattform vorkommen. Chatter, die in neueren Reports nicht mehr enthalten
 * sind, werden ausgeschlossen.
 *
 * Gibt `null` zurück, wenn noch kein Report existiert — dann sollte kein
 * Filter angewendet werden.
 */
export async function loadActiveChatterNames(
  supabase: SupabaseClient,
  platform: string,
): Promise<Set<string> | null> {
  const { data: reports } = await supabase
    .from("analysis_reports")
    .select("result_json, analysis_date")
    .eq("platform", platform)
    .not("result_json", "is", null)
    .order("analysis_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);

  const latest = reports?.[0];
  if (!latest) return null;

  const names = new Set<string>();
  const result = latest.result_json as any;
  if (result && Array.isArray(result.categories)) {
    for (const cat of result.categories) {
      for (const ch of cat.chatters ?? []) {
        if (ch?.name) names.add(normalizeName(ch.name));
      }
    }
  }

  if (names.size === 0 && latest.analysis_date) {
    const { data: histRows } = await supabase
      .from("chatter_history")
      .select("chatter_name")
      .eq("platform", platform)
      .eq("analysis_date", latest.analysis_date);
    for (const r of histRows ?? []) {
      if (r.chatter_name) names.add(normalizeName(r.chatter_name));
    }
  }

  return names;
}
