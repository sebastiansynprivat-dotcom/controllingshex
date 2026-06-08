/**
 * Chatter-Labels — vorgeseedete System-Labels + Custom-Labels.
 *
 * System-Labels werden pro User & Platform beim ersten Today-Open angelegt,
 * falls noch nicht vorhanden. User darf eigene Labels über die bestehende
 * Label-UI (TinderMode / ChatterSlideOver) ergänzen.
 */
import { supabase } from "@/integrations/supabase/client";
import { normalizeChatterName } from "@/lib/active-chatters";

export interface ChatterLabel {
  id: string;
  label_name: string;
  color: string;
}

export interface LabelAssignment {
  label_id: string;
  chatter_name: string;
  chatter_key: string; // normalisiert für Lookups
}

export const SYSTEM_LABELS: { name: string; color: string }[] = [
  { name: "🟢 Upgrade",         color: "#34d399" }, // emerald-400
  { name: "💛 Premium Upgrade", color: "#fbbf24" }, // amber-400
  { name: "❌ Kein Upgrade",    color: "#fb7185" }, // rose-400
  { name: "⬇️ Downgrade",       color: "#94a3b8" }, // slate-400
  { name: "✅ Upgrade bekommen", color: "#22d3ee" }, // cyan-400 — terminal: hidden in Labels-Tab
];

const SYSTEM_NAME_SET = new Set(SYSTEM_LABELS.map((l) => l.name));

export const UPGRADE_RECEIVED_LABEL_NAME = "✅ Upgrade bekommen";

export function isSystemLabel(label: ChatterLabel): boolean {
  return SYSTEM_NAME_SET.has(label.label_name);
}

/** "Terminal"-Label: Chatter ist final eingestuft → verschwindet aus Onboarding & Labels-Tab. */
export function isUpgradeReceivedLabel(label: ChatterLabel): boolean {
  return label.label_name === UPGRADE_RECEIVED_LABEL_NAME;
}


/** Legt fehlende System-Labels für den aktuellen User & Platform an. Idempotent via Upsert auf (user_id, platform, label_name). */
export async function ensureSystemLabels(platform: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  // Upsert verhindert Duplikate auch bei parallelen Mounts (React Strict Mode, schneller Platform-Switch).
  await supabase
    .from("chatter_labels")
    .upsert(
      SYSTEM_LABELS.map((l) => ({
        user_id: user.id,
        platform,
        label_name: l.name,
        color: l.color,
      })),
      { onConflict: "user_id,platform,label_name", ignoreDuplicates: true },
    );
}

export async function loadChatterLabels(platform: string): Promise<ChatterLabel[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from("chatter_labels")
    .select("id, label_name, color")
    .eq("user_id", user.id)
    .eq("platform", platform)
    .order("created_at", { ascending: true });
  return (data ?? []) as ChatterLabel[];
}

export async function loadLabelAssignments(platform: string): Promise<LabelAssignment[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from("chatter_label_assignments")
    .select("label_id, chatter_name")
    .eq("user_id", user.id)
    .eq("platform", platform);
  return (data ?? []).map((r) => ({
    label_id: r.label_id,
    chatter_name: r.chatter_name,
    chatter_key: normalizeChatterName(r.chatter_name),
  }));
}

export async function assignLabelToChatter(
  platform: string,
  chatterName: string,
  labelId: string,
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  // Doppelte Vergaben (gleicher Chatter + gleiches Label) vermeiden
  const { data: existing } = await supabase
    .from("chatter_label_assignments")
    .select("id")
    .eq("user_id", user.id)
    .eq("platform", platform)
    .eq("chatter_name", chatterName)
    .eq("label_id", labelId)
    .maybeSingle();
  if (existing) return;
  await supabase.from("chatter_label_assignments").insert({
    user_id: user.id,
    platform,
    chatter_name: chatterName,
    label_id: labelId,
  });
}

export async function removeLabelFromChatter(
  platform: string,
  chatterName: string,
  labelId: string,
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("chatter_label_assignments")
    .delete()
    .eq("user_id", user.id)
    .eq("platform", platform)
    .eq("chatter_name", chatterName)
    .eq("label_id", labelId);
}

/** Ersetzt alle bisherigen System-Label-Zuweisungen eines Chatters durch das neue Label. */
export async function setSystemLabelExclusive(
  platform: string,
  chatterName: string,
  labelId: string,
  allLabels: ChatterLabel[],
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const systemIds = allLabels
    .filter((l) => isSystemLabel(l))
    .map((l) => l.id);

  if (systemIds.length > 0) {
    await supabase
      .from("chatter_label_assignments")
      .delete()
      .eq("user_id", user.id)
      .eq("platform", platform)
      .eq("chatter_name", chatterName)
      .in("label_id", systemIds);
  }

  await supabase.from("chatter_label_assignments").insert({
    user_id: user.id,
    platform,
    chatter_name: chatterName,
    label_id: labelId,
  });
}
