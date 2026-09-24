import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type SteckbriefStatus = "approved" | "not_approved" | "missing";
export type SteckbriefReason =
  | "approved"
  | "no_profile"
  | "awaiting_approval"
  | "profile_unusable"
  | "no_login"
  | "blocked"
  | "no_assignment"
  | "ambiguous"
  | "model_not_found";
export type SteckbriefSource = "controlling" | "shex_account" | "same_login" | null;
export type ShexProfileStatus = "approved" | "not_approved" | "unusable" | "none";
export type SteckbriefOverrideMode = "assign" | "block";

export interface ShexModelEntry {
  model_id: string;
  name: string;
  username: string | null;
  model_active: boolean;
  profile_status: ShexProfileStatus;
}

export interface SteckbriefOverride {
  mode: SteckbriefOverrideMode;
  external_model_id: string | null;
  external_model_name: string | null;
  updated_at: string | null;
}

export interface SteckbriefIdentity {
  platform: string;
  email: string;
  status: SteckbriefStatus;
  status_reason: SteckbriefReason;
  external_model_id: string | null;
  assignment_source: SteckbriefSource;
  assignment_updated_at: string | null;
  confirmed_at: string | null;
  override: SteckbriefOverride | null;
  shex_model_ids: string[];
}

export interface OrphanOverride extends SteckbriefOverride {
  platform: string;
  email: string;
}

export interface SteckbriefOverview {
  contract: "steckbrief-links.overview.v1";
  generated_at: string;
  excluded_rows: number;
  models: ShexModelEntry[];
  identities: SteckbriefIdentity[];
  orphan_overrides: OrphanOverride[];
}

export type SteckbriefFailure = "forbidden" | "not_configured" | "upstream" | "error";
export type SteckbriefState = "loading" | "ready" | SteckbriefFailure;
export type SteckbriefOverviewResult =
  | { state: "ready"; overview: SteckbriefOverview }
  | { state: SteckbriefFailure };

export function normalizeLogin(email: unknown): string | null {
  return typeof email === "string" ? email.trim().toLowerCase() || null : null;
}

export function identityKey(platform: string, email: unknown): string {
  // Keep the stored platform label; tuple encoding avoids separator collisions.
  return JSON.stringify([platform, normalizeLogin(email)]);
}

function failureState(error: unknown): SteckbriefFailure {
  const status = error instanceof FunctionsHttpError && error.context instanceof Response
    ? error.context.status
    : undefined;
  if (status === 401 || status === 403) return "forbidden";
  // 404: function not deployed yet — same meaning for the page as a missing secret.
  if (status === 503 || status === 404) return "not_configured";
  if (status === 502) return "upstream";
  return "error";
}

export async function fetchSteckbriefOverview(): Promise<SteckbriefOverviewResult> {
  try {
    const { data, error } = await supabase.functions.invoke<SteckbriefOverview>("steckbrief-links", {
      body: { action: "overview" },
    });
    if (error) return { state: failureState(error) };
    if (
      !data || data.contract !== "steckbrief-links.overview.v1"
      || !Array.isArray(data.models) || !Array.isArray(data.identities)
      || !Array.isArray(data.orphan_overrides)
    ) return { state: "error" };
    return { state: "ready", overview: data };
  } catch (error) {
    return { state: failureState(error) };
  }
}

export async function saveAssignment(
  platform: string,
  email: unknown,
  model: ShexModelEntry,
): Promise<{ ok: boolean }> {
  try {
    const email_normalized = normalizeLogin(email);
    if (!email_normalized) return { ok: false };
    const { error } = await supabase.from("model_steckbrief_links").upsert({
      platform,
      email_normalized,
      mode: "assign",
      external_model_id: model.model_id,
      external_model_name: model.name,
    }, { onConflict: "platform,email_normalized" });
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}

export async function saveBlock(platform: string, email: unknown): Promise<{ ok: boolean }> {
  try {
    const email_normalized = normalizeLogin(email);
    if (!email_normalized) return { ok: false };
    const { error } = await supabase.from("model_steckbrief_links").upsert({
      platform,
      email_normalized,
      mode: "block",
      external_model_id: null,
      external_model_name: null,
    }, { onConflict: "platform,email_normalized" });
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}

export async function removeOverride(platform: string, email: unknown): Promise<{ ok: boolean }> {
  try {
    const email_normalized = normalizeLogin(email);
    if (!email_normalized) return { ok: false };
    const { error } = await supabase.from("model_steckbrief_links")
      .delete().eq("platform", platform).eq("email_normalized", email_normalized);
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}

export interface SteckbriefDescription {
  tone: "ok" | "warn" | "bad" | "muted";
  label: string;
  detail: string;
}

export function formatSteckbriefDate(timestamp: string | null): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  // Contract timestamps are UTC; retain that calendar date in every browser.
  return date.toLocaleDateString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC",
  });
}

export function describeStatus(
  identity: SteckbriefIdentity | null | undefined,
  modelsById: ReadonlyMap<string, ShexModelEntry>,
): SteckbriefDescription {
  const name = (identity?.external_model_id && modelsById.get(identity.external_model_id)?.name)
    || identity?.override?.external_model_name || "";
  switch (identity?.status_reason) {
    case "approved":
      return {
        tone: "ok", label: "Steckbrief freigegeben",
        detail: [name, formatSteckbriefDate(identity.confirmed_at)].filter(Boolean).join(" · "),
      };
    case "no_profile":
      return { tone: "warn", label: "Kein Steckbrief in SheX", detail: name };
    case "awaiting_approval":
      return { tone: "warn", label: "Wartet auf Freigabe", detail: name };
    case "profile_unusable":
      return { tone: "warn", label: "Steckbrief fehlerhaft", detail: name };
    case "no_login":
      return { tone: "muted", label: "Keine Login-Mail", detail: "" };
    case "blocked":
      return { tone: "muted", label: "Kein Steckbrief (gesperrt)", detail: "" };
    case "ambiguous":
      return { tone: "bad", label: "Mehrere Models möglich", detail: "" };
    case "model_not_found":
      return { tone: "bad", label: "Zugeordnetes Model fehlt in SheX", detail: name };
    case "no_assignment":
    default:
      return { tone: "bad", label: "Kein Steckbrief zugeordnet", detail: "" };
  }
}

export function describeSource(source: SteckbriefSource): string {
  switch (source) {
    case "controlling": return "im Controlling zugeordnet";
    case "shex_account": return "über SheX-Konto";
    case "same_login": return "über gleiche Login-Mail";
    default: return "";
  }
}

export function conflictWithShex(identity: SteckbriefIdentity | null | undefined): boolean {
  return identity?.override?.mode === "assign"
    && identity.shex_model_ids.length > 0
    && !identity.shex_model_ids.includes(identity.override.external_model_id);
}

export function countWithoutApproved(
  rows: readonly { platform: string; email?: string | null }[],
  identitiesByKey: ReadonlyMap<string, SteckbriefIdentity>,
): number {
  return rows.filter((row) => !normalizeLogin(row.email)
    || identitiesByKey.get(identityKey(row.platform, row.email))?.status !== "approved").length;
}
