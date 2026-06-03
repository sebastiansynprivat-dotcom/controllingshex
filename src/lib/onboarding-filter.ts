/**
 * Onboarding-Filter — Chatter Tag 6–20 nach Onboarding, ohne System-Label,
 * gruppiert nach Onboarding-Tag absteigend für sequenzielles Durcharbeiten.
 */
import { supabase } from "@/integrations/supabase/client";
import { normalizeChatterName, loadActiveChatterNames } from "@/lib/active-chatters";
import type { ChatterLabel, LabelAssignment } from "@/lib/chatter-labels";
import { isSystemLabel } from "@/lib/chatter-labels";

export interface OnboardingChatter {
  chatterName: string;
  chatterKey: string;
  daysOnboarded: number;
  account: string | null;
  assignedLabels: ChatterLabel[];
}

export interface OnboardingGroup {
  day: number;
  items: OnboardingChatter[];
}

interface Options {
  minDays?: number; // default 5
  maxDays?: number; // default 14
}

export async function loadOnboardingChatters(
  platform: string,
  allLabels: ChatterLabel[],
  assignments: LabelAssignment[],
  opts: Options = {},
): Promise<OnboardingGroup[]> {
  const minDays = opts.minDays ?? 5;
  const maxDays = opts.maxDays ?? Number.POSITIVE_INFINITY;

  const [onboardingRes, activeNames, accountsRes] = await Promise.all([
    supabase.rpc("get_chatter_onboarding", { p_platform: platform }),
    loadActiveChatterNames(platform),
    supabase
      .from("chatter_history")
      .select("chatter_name, account, analysis_date")
      .ilike("platform", platform)
      .order("analysis_date", { ascending: false })
      .limit(2000),
  ]);

  const onboarding = (onboardingRes.data ?? []) as { chatter_name: string; onboarded_on: string }[];

  // Account je Chatter — neuester Eintrag
  const accountByChatter = new Map<string, string>();
  for (const r of (accountsRes.data ?? []) as { chatter_name: string; account: string | null }[]) {
    const k = normalizeChatterName(r.chatter_name);
    if (!accountByChatter.has(k) && r.account) {
      const first = r.account.split(",")[0]?.trim();
      if (first) accountByChatter.set(k, first);
    }
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Index: Chatter-Key → System-Label-Zuweisungen
  const systemLabelIds = new Set(allLabels.filter(isSystemLabel).map((l) => l.id));
  const labelsByChatter = new Map<string, Set<string>>();
  for (const a of assignments) {
    const set = labelsByChatter.get(a.chatter_key) ?? new Set<string>();
    set.add(a.label_id);
    labelsByChatter.set(a.chatter_key, set);
  }
  const labelById = new Map(allLabels.map((l) => [l.id, l]));

  const items: OnboardingChatter[] = [];
  for (const row of onboarding) {
    const k = normalizeChatterName(row.chatter_name);
    if (activeNames !== null && !activeNames.has(k)) continue;
    const onboardedDate = new Date(row.onboarded_on);
    onboardedDate.setHours(0, 0, 0, 0);
    const days = Math.floor((today.getTime() - onboardedDate.getTime()) / (1000 * 60 * 60 * 24));
    if (days < minDays || days > maxDays) continue;

    // Chatter mit System-Label bereits eingestuft → raus aus Onboarding-Queue
    const ids = labelsByChatter.get(k);
    const hasSystemLabel = ids && [...ids].some((id) => systemLabelIds.has(id));
    if (hasSystemLabel) continue;

    const assignedLabels: ChatterLabel[] = [];
    if (ids) {
      for (const id of ids) {
        const l = labelById.get(id);
        if (l) assignedLabels.push(l);
      }
    }

    items.push({
      chatterName: row.chatter_name,
      chatterKey: k,
      daysOnboarded: days,
      account: accountByChatter.get(k) ?? null,
      assignedLabels,
    });
  }

  // Gruppieren nach Tag (absteigend → ältester zuerst)
  const byDay = new Map<number, OnboardingChatter[]>();
  for (const it of items) {
    const arr = byDay.get(it.daysOnboarded) ?? [];
    arr.push(it);
    byDay.set(it.daysOnboarded, arr);
  }
  return [...byDay.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([day, list]) => ({
      day,
      items: list.sort((a, b) => a.chatterName.localeCompare(b.chatterName, "de")),
    }));
}
