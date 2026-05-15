/**
 * Talent-Account-Ablehnungen — Nutzer kann Riser↔Account-Vorschläge ablehnen,
 * gilt 7 Tage, danach wird der Vorschlag wieder eingeschlossen.
 */
import { supabase } from "@/integrations/supabase/client";

const norm = (s: string) => s.trim().toLowerCase();

export async function loadActiveRejections(platform: string): Promise<Set<string>> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Set();
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("talent_account_rejections")
    .select("riser_norm, account_norm")
    .eq("user_id", user.id)
    .ilike("platform", platform)
    .gte("rejected_at", since);
  const set = new Set<string>();
  for (const r of (data ?? []) as { riser_norm: string; account_norm: string }[]) {
    set.add(`${r.riser_norm}|${r.account_norm}`);
  }
  return set;
}

export async function addRejection(platform: string, riserName: string, accountName: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  await supabase.from("talent_account_rejections").insert({
    user_id: user.id,
    platform,
    riser_norm: norm(riserName),
    account_norm: norm(accountName),
  });
}
