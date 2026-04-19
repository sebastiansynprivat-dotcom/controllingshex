import { supabase } from "@/integrations/supabase/client";

export type InputSource = "note" | "video" | "label" | "verbal" | "praise" | "observed" | "warning";

export interface InputEvent {
  source: InputSource;
  created_at: string; // ISO
  note?: string | null;
}

export interface LastInputInfo {
  lastAt: string | null;
  lastSource: InputSource | null;
  events: InputEvent[];
}

const SOURCE_META: Record<InputSource, { icon: string; label: string; color: string }> = {
  note: { icon: "✍️", label: "Notiz", color: "212 90% 60%" },
  video: { icon: "🎥", label: "Video-Coaching", color: "270 80% 65%" },
  label: { icon: "🏷️", label: "Label", color: "152 70% 45%" },
  verbal: { icon: "💬", label: "Verbal", color: "38 92% 55%" },
  praise: { icon: "🔥", label: "Lob", color: "25 95% 55%" },
  observed: { icon: "👀", label: "Beobachtet", color: "240 5% 60%" },
  warning: { icon: "⚠️", label: "Warnung", color: "0 80% 60%" },
};

export function getSourceMeta(s: InputSource) {
  return SOURCE_META[s];
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[_ ]+/g, "_").trim();
}

/**
 * Loads last input event per chatter across all sources.
 * Combines: coaching_notes, video_coachings, chatter_label_assignments, chatter_inputs
 */
export async function loadLastInputs(
  platform: string,
  chatterNames: string[]
): Promise<Map<string, LastInputInfo>> {
  const result = new Map<string, LastInputInfo>();
  if (chatterNames.length === 0) return result;

  // Fetch all 4 sources in parallel
  const [notesRes, videosRes, labelsRes, inputsRes] = await Promise.all([
    supabase
      .from("coaching_notes")
      .select("chatter_name, note_text, created_at")
      .eq("platform", platform)
      .in("chatter_name", chatterNames)
      .order("created_at", { ascending: false }),
    supabase
      .from("video_coachings")
      .select("chatter_name, sent_at")
      .eq("platform", platform)
      .in("chatter_name", chatterNames)
      .order("sent_at", { ascending: false }),
    supabase
      .from("chatter_label_assignments")
      .select("chatter_name, created_at")
      .eq("platform", platform)
      .in("chatter_name", chatterNames)
      .order("created_at", { ascending: false }),
    supabase
      .from("chatter_inputs")
      .select("chatter_name, input_type, note, created_at")
      .eq("platform", platform)
      .in("chatter_name", chatterNames)
      .order("created_at", { ascending: false }),
  ]);

  const push = (name: string, ev: InputEvent) => {
    const key = normalize(name);
    if (!result.has(key)) result.set(key, { lastAt: null, lastSource: null, events: [] });
    result.get(key)!.events.push(ev);
  };

  (notesRes.data || []).forEach((n: any) =>
    push(n.chatter_name, { source: "note", created_at: n.created_at, note: n.note_text })
  );
  (videosRes.data || []).forEach((v: any) =>
    push(v.chatter_name, { source: "video", created_at: v.sent_at })
  );
  (labelsRes.data || []).forEach((l: any) =>
    push(l.chatter_name, { source: "label", created_at: l.created_at })
  );
  (inputsRes.data || []).forEach((i: any) => {
    const src = (["verbal", "praise", "observed", "warning"].includes(i.input_type)
      ? i.input_type
      : "verbal") as InputSource;
    push(i.chatter_name, { source: src, created_at: i.created_at, note: i.note });
  });

  // Sort each list & set last
  for (const [, info] of result) {
    info.events.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    if (info.events.length > 0) {
      info.lastAt = info.events[0].created_at;
      info.lastSource = info.events[0].source;
    }
  }

  return result;
}

export function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

export interface InputBadgeStyle {
  label: string;
  hue: string; // HSL string e.g. "152 70% 45%"
  intensity: "fresh" | "aging" | "stale" | "never";
}

export function getInputBadgeStyle(lastAt: string | null): InputBadgeStyle {
  if (!lastAt) {
    return { label: "Noch nie", hue: "240 5% 50%", intensity: "never" };
  }
  const d = daysSince(lastAt);
  if (d === 0) return { label: "heute", hue: "152 70% 45%", intensity: "fresh" };
  if (d === 1) return { label: "gestern", hue: "152 70% 45%", intensity: "fresh" };
  if (d <= 3) return { label: `${d}d`, hue: "152 70% 45%", intensity: "fresh" };
  if (d <= 7) return { label: `${d}d`, hue: "45 90% 55%", intensity: "aging" };
  if (d <= 14) return { label: `${d}d`, hue: "25 95% 55%", intensity: "aging" };
  return { label: `${d}d`, hue: "0 84% 60%", intensity: "stale" };
}

export async function logManualInput(
  platform: string,
  chatterName: string,
  type: "verbal" | "praise" | "observed" | "warning",
  note?: string
): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { error } = await supabase.from("chatter_inputs").insert({
    user_id: user.id,
    platform,
    chatter_name: chatterName,
    input_type: type,
    note: note || null,
  });
  return !error;
}
