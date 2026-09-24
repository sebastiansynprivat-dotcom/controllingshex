import type { Profile } from "./core.ts";

export type Platform = "Maloum" | "Brezzels" | "4Based";
export type ProfileStatus = "approved" | "not_approved" | "none" | "unusable";
export type AssignmentSource = "controlling" | "shex_account" | "same_login";
export type Status = "approved" | "not_approved" | "missing";
export type StatusReason =
  | "approved"
  | "no_profile"
  | "awaiting_approval"
  | "profile_unusable"
  | "no_login"
  | "blocked"
  | "no_assignment"
  | "ambiguous"
  | "model_not_found";

export interface Identity {
  platform: string;
  email: string;
}

export interface ModelRow {
  id: string;
  platform: Platform;
  model_name: string;
  email: string | null;
  user_id: string | null;
}

export interface LinkRow {
  id: string;
  platform: Platform;
  email_normalized: string;
  mode: "assign" | "block";
  external_model_id: string | null;
  external_model_name: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Resolution extends Identity {
  same_platform_model_ids: string[];
  other_platform_model_ids: string[];
}

export interface ShexProfile {
  model_id: string;
  model_exists: boolean;
  profile_status: ProfileStatus;
  confirmed_at: string | null;
  updated_at: string | null;
  profile: Profile | null;
}

export interface ShexModel {
  model_id: string;
  name: string;
  username: string | null;
  model_active: boolean;
  profile_status: ProfileStatus;
}

export interface ResolveRequest {
  identities: Identity[];
  model_ids: string[];
  include_profiles: boolean;
}

export interface ResolveResponse {
  contract: "controlling-model-profiles.v1";
  resolutions: Resolution[];
  profiles: ShexProfile[];
}

export interface ModelsResponse {
  contract: "controlling-model-profiles.v1";
  models: ShexModel[];
}

export interface ExportAccount {
  id: string;
  platform: Platform;
  email: string | null;
  status: Status;
  status_reason: StatusReason;
  external_model_id: string | null;
  assignment_source: AssignmentSource | null;
  assignment_updated_at: string | null;
  confirmed_at: string | null;
  source_updated_at: string | null;
  profile: Profile | null;
}

export interface ExportSummary {
  accounts: number;
  approved: number;
  not_approved: number;
  missing: number;
  excluded_rows: number;
}

export interface ExportEnvelope {
  contract: "models-steckbrief-export.v1";
  generated_at: string;
  summary: ExportSummary;
  accounts: ExportAccount[];
}

export interface OverrideView {
  mode: "assign" | "block";
  external_model_id: string | null;
  external_model_name: string | null;
  updated_at: string | null;
}

export interface OverviewIdentity {
  platform: Platform;
  email: string;
  status: Status;
  status_reason: StatusReason;
  external_model_id: string | null;
  assignment_source: AssignmentSource | null;
  assignment_updated_at: string | null;
  confirmed_at: string | null;
  override: OverrideView | null;
  shex_model_ids: string[];
}

export interface OverviewEnvelope {
  contract: "steckbrief-links.overview.v1";
  generated_at: string;
  excluded_rows: number;
  models: ShexModel[];
  identities: OverviewIdentity[];
  orphan_overrides: (OverrideView & Identity)[];
}
