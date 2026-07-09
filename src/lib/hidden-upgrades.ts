/**
 * Hidden Upgrade Chatters — dauerhaftes Ausblenden von Chattern in der
 * Upgrade-Kandidaten-Sektion (Heute-Tab). Persistiert in
 * public.hidden_upgrade_chatters, gescopet auf user_id + platform.
 */
import { supabase } from "@/integrations/supabase/client";
import { normalizeChatterName } from "@/lib/active-chatters";

const EVENT = "hidden-upgrades-updated";

export interface HiddenUpgradeEntry {
  chatterKey: string;
  originalName: string;
  createdAt: string;
}

export function hiddenChatterKey(name: string): string {
  return normalizeChatterName(name);
}

export async function fetchHiddenUpgrades(platform: string): Promise<HiddenUpgradeEntry[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from("hidden_upgrade_chatters")
    .select("chatter_key, original_name, created_at")
    .eq("user_id", user.id)
    .ilike("platform", platform)
    .order("created_at", { ascending: false });
  if (error) {
    console.warn("[hidden-upgrades] fetch failed", error);
    return [];
  }
  return (data ?? []).map((r: any) => ({
    chatterKey: r.chatter_key,
    originalName: r.original_name,
    createdAt: r.created_at,
  }));
}

export async function hideUpgradeChatter(platform: string, chatterName: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const key = hiddenChatterKey(chatterName);
  if (!key) return;
  const { error } = await supabase
    .from("hidden_upgrade_chatters")
    .upsert(
      {
        user_id: user.id,
        platform,
        chatter_key: key,
        original_name: chatterName,
      },
      { onConflict: "user_id,platform,chatter_key" },
    );
  if (error) {
    console.warn("[hidden-upgrades] hide failed", error);
    return;
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

export async function unhideUpgradeChatter(platform: string, chatterKey: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase
    .from("hidden_upgrade_chatters")
    .delete()
    .eq("user_id", user.id)
    .ilike("platform", platform)
    .eq("chatter_key", chatterKey);
  if (error) {
    console.warn("[hidden-upgrades] unhide failed", error);
    return;
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function onHiddenUpgradesUpdated(handler: () => void): () => void {
  const fn = () => handler();
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}
