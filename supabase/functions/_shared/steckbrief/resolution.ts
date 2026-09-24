import {
  identityKey,
  isRecord,
  normalizeLogin,
  platformKey,
  projectProfile,
  toTimestamp,
} from "./core.ts";
import { UpstreamError } from "./errors.ts";
import type {
  AssignmentSource,
  ExportAccount,
  LinkRow,
  ModelRow,
  ResolveResponse,
  StatusReason,
} from "./types.ts";

type Result = Omit<ExportAccount, "id" | "platform" | "email">;
type Base =
  | {
    kind: "assigned";
    modelId: string;
    source: AssignmentSource;
    updatedAt: string | null;
  }
  | { kind: "blocked"; updatedAt: string | null }
  | { kind: "ambiguous" | "unassigned" };

function missing(
  reason: StatusReason,
  source: AssignmentSource | null = null,
  updatedAt: string | null = null,
): Result {
  return {
    status: "missing",
    status_reason: reason,
    external_model_id: null,
    assignment_source: source,
    assignment_updated_at: updatedAt,
    confirmed_at: null,
    source_updated_at: null,
    profile: null,
  };
}

/** Stages 1/2 are frozen before stage 3, so same-login results cannot propagate. */
export function resolveAccounts(
  models: ModelRow[],
  links: LinkRow[],
  upstream: ResolveResponse,
  includeProfiles = true,
): ExportAccount[] {
  const overrides = new Map(
    links.map((
      link,
    ) => [identityKey(link.platform, link.email_normalized), link]),
  );
  const resolutions = new Map(
    upstream.resolutions.map((
      row,
    ) => [identityKey(row.platform, row.email), row]),
  );
  const profiles = new Map(upstream.profiles.map((row) => [row.model_id, row]));
  const bases = new Map<string, Base>();
  const siblings = new Map<string, { platform: string; base: Base }[]>();
  for (const model of models) {
    const email = normalizeLogin(model.email);
    if (email === null) continue;
    const key = identityKey(model.platform, email);
    if (bases.has(key)) continue;
    const override = overrides.get(key);
    const resolution = resolutions.get(key);
    if (!resolution) throw new UpstreamError();
    let base: Base;
    if (override?.mode === "block") {
      base = { kind: "blocked", updatedAt: toTimestamp(override.updated_at) };
    } else if (override?.mode === "assign") {
      if (!override.external_model_id) throw new UpstreamError();
      base = {
        kind: "assigned",
        modelId: override.external_model_id.toLowerCase(),
        source: "controlling",
        updatedAt: toTimestamp(override.updated_at),
      };
    } else if (resolution.same_platform_model_ids.length === 1) {
      base = {
        kind: "assigned",
        modelId: resolution.same_platform_model_ids[0],
        source: "shex_account",
        updatedAt: null,
      };
    } else {
      base = {
        kind: resolution.same_platform_model_ids.length > 1
          ? "ambiguous"
          : "unassigned",
      };
    }
    bases.set(key, base);
    const group = siblings.get(email) ?? [];
    group.push({ platform: platformKey(model.platform), base });
    siblings.set(email, group);
  }

  const results = new Map<string, Result>();
  return models.map((model) => {
    const email = normalizeLogin(model.email);
    let result = missing("no_login");
    if (email !== null) {
      const key = identityKey(model.platform, email);
      const cached = results.get(key);
      if (cached) result = cached;
      else {
        let base = bases.get(key)!;
        if (base.kind === "unassigned") {
          const candidates = new Set(
            resolutions.get(key)!.other_platform_model_ids,
          );
          for (const sibling of siblings.get(email) ?? []) {
            if (
              sibling.platform !== platformKey(model.platform) &&
              sibling.base.kind === "assigned"
            ) {
              candidates.add(sibling.base.modelId);
            }
          }
          if (candidates.size === 1) {
            base = {
              kind: "assigned",
              modelId: [...candidates][0],
              source: "same_login",
              updatedAt: null,
            };
          } else if (candidates.size > 1) base = { kind: "ambiguous" };
        }
        if (base.kind === "assigned") {
          const profile = profiles.get(base.modelId);
          if (!profile) throw new UpstreamError();
          if (!profile.model_exists) {
            result = missing("model_not_found", base.source, base.updatedAt);
          } else {
            const reasons = {
              none: "no_profile",
              not_approved: "awaiting_approval",
              unusable: "profile_unusable",
              approved: "approved",
            } as const;
            const approved = profile.profile_status === "approved";
            if (approved && includeProfiles && !isRecord(profile.profile)) {
              throw new UpstreamError();
            }
            result = {
              status: approved ? "approved" : "not_approved",
              status_reason: reasons[profile.profile_status],
              external_model_id: base.modelId,
              assignment_source: base.source,
              assignment_updated_at: base.updatedAt,
              confirmed_at: approved ? toTimestamp(profile.confirmed_at) : null,
              source_updated_at: approved
                ? toTimestamp(profile.updated_at)
                : null,
              profile: approved && includeProfiles
                ? projectProfile(profile.profile)
                : null,
            };
          }
        } else if (base.kind === "blocked") {
          result = missing("blocked", "controlling", base.updatedAt);
        } else {result = missing(
            base.kind === "ambiguous" ? "ambiguous" : "no_assignment",
          );}
        results.set(key, result);
      }
    }
    return { id: model.id, platform: model.platform, email, ...result };
  });
}
