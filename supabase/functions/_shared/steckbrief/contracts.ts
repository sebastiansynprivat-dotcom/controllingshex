import {
  isRecord,
  isUuid,
  normalizeLogin,
  platformKey,
  PROFILE_KEYS,
  toTimestamp,
} from "./core.ts";
import { UpstreamError } from "./errors.ts";
import type {
  ExportEnvelope,
  ModelsResponse,
  ResolveRequest,
  ResolveResponse,
} from "./types.ts";

function requireShape(condition: unknown): asserts condition {
  if (!condition) throw new Error("invalid_contract");
}

function fields(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  requireShape(isRecord(value));
  const actual = Object.keys(value);
  requireShape(
    actual.length === keys.length &&
      keys.every((key) => Object.hasOwn(value, key)),
  );
  return value;
}

function lowerUuid(value: unknown): value is string {
  return isUuid(value) && value === value.toLowerCase();
}

function iso(value: unknown): boolean {
  return typeof value === "string" && value.length === 24 &&
    toTimestamp(value) === value;
}

function timestamp(value: unknown): void {
  requireShape(value === null || iso(value));
}

function status(value: unknown): void {
  requireShape(
    ["approved", "not_approved", "none", "unusable"].includes(value as string),
  );
}

function jsonValue(value: unknown): boolean {
  if (
    value === null || typeof value === "string" || typeof value === "boolean"
  ) return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(jsonValue);
  return isRecord(value) && Object.values(value).every(jsonValue);
}

function profile(value: unknown): void {
  requireShape(isRecord(value));
  requireShape(
    Object.keys(value).every((key) =>
      (PROFILE_KEYS as readonly string[]).includes(key)
    ),
  );
  requireShape(Object.values(value).every(jsonValue));
}

function uuidList(value: unknown): string[] {
  requireShape(Array.isArray(value));
  requireShape(
    value.every((id, i) => lowerUuid(id) && (i === 0 || value[i - 1] < id)),
  );
  return value as string[];
}

export function validateResolveRequest(value: ResolveRequest): void {
  try {
    requireShape(typeof value.include_profiles === "boolean");
    requireShape(
      Array.isArray(value.identities) && value.identities.length <= 1000,
    );
    for (const identity of value.identities) {
      requireShape(isRecord(identity));
      requireShape(
        typeof identity.platform === "string" &&
          identity.platform.length >= 1 && identity.platform.length <= 32,
      );
      requireShape(
        typeof identity.email === "string" && identity.email.length >= 1 &&
          identity.email.length <= 320,
      );
    }
    requireShape(
      Array.isArray(value.model_ids) && value.model_ids.length <= 1000,
    );
    requireShape(value.model_ids.every(isUuid));
  } catch {
    throw new UpstreamError();
  }
}

export function validateResolveResponse(
  value: unknown,
  request: ResolveRequest,
): ResolveResponse {
  try {
    validateResolveRequest(request);
    const root = fields(value, ["contract", "resolutions", "profiles"]);
    requireShape(root.contract === "controlling-model-profiles.v1");
    requireShape(
      Array.isArray(root.resolutions) &&
        root.resolutions.length === request.identities.length,
    );
    const expectedIds = new Set(
      request.model_ids.map((id) => id.toLowerCase()),
    );
    root.resolutions.forEach((entry: unknown, index: number) => {
      const row = fields(entry, [
        "platform",
        "email",
        "same_platform_model_ids",
        "other_platform_model_ids",
      ]);
      const sent = request.identities[index];
      requireShape(row.platform === platformKey(sent.platform));
      requireShape(row.email === (normalizeLogin(sent.email) ?? ""));
      const same = uuidList(row.same_platform_model_ids);
      const other = uuidList(row.other_platform_model_ids);
      if (row.email === "") {
        requireShape(same.length === 0 && other.length === 0);
      }
      for (const id of [...same, ...other]) expectedIds.add(id);
    });
    requireShape(
      Array.isArray(root.profiles) && root.profiles.length === expectedIds.size,
    );
    let previousId = "";
    for (const entry of root.profiles) {
      const row = fields(entry, [
        "model_id",
        "model_exists",
        "profile_status",
        "confirmed_at",
        "updated_at",
        "profile",
      ]);
      requireShape(
        lowerUuid(row.model_id) && row.model_id > previousId &&
          expectedIds.has(row.model_id),
      );
      previousId = row.model_id;
      requireShape(typeof row.model_exists === "boolean");
      status(row.profile_status);
      timestamp(row.confirmed_at);
      timestamp(row.updated_at);
      if (!row.model_exists) requireShape(row.profile_status === "none");
      if (row.profile_status === "approved") {
        if (request.include_profiles) profile(row.profile);
        else requireShape(row.profile === null);
      } else {
        requireShape(
          row.confirmed_at === null && row.updated_at === null &&
            row.profile === null,
        );
      }
    }
    return value as ResolveResponse;
  } catch {
    throw new UpstreamError();
  }
}

export function validateModelsResponse(value: unknown): ModelsResponse {
  try {
    const root = fields(value, ["contract", "models"]);
    requireShape(
      root.contract === "controlling-model-profiles.v1" &&
        Array.isArray(root.models),
    );
    const seen = new Set<string>();
    for (const entry of root.models) {
      const row = fields(entry, [
        "model_id",
        "name",
        "username",
        "model_active",
        "profile_status",
      ]);
      requireShape(lowerUuid(row.model_id) && !seen.has(row.model_id));
      requireShape(typeof row.name === "string");
      requireShape(row.username === null || typeof row.username === "string");
      requireShape(typeof row.model_active === "boolean");
      status(row.profile_status);
      // Order is not validated: locale collation may differ between runtimes,
      // and a sorting nuance must never make the whole overview unavailable.
      seen.add(row.model_id);
    }
    return value as ModelsResponse;
  } catch {
    throw new UpstreamError();
  }
}

export const ACCOUNT_FIELDS = [
  "id",
  "platform",
  "email",
  "status",
  "status_reason",
  "external_model_id",
  "assignment_source",
  "assignment_updated_at",
  "confirmed_at",
  "source_updated_at",
  "profile",
] as const;

export function validateExportEnvelope(value: unknown): ExportEnvelope {
  try {
    const root = fields(value, [
      "contract",
      "generated_at",
      "summary",
      "accounts",
    ]);
    requireShape(
      root.contract === "models-steckbrief-export.v1" && iso(root.generated_at),
    );
    const summary = fields(root.summary, [
      "accounts",
      "approved",
      "not_approved",
      "missing",
      "excluded_rows",
    ]);
    requireShape(
      Object.values(summary).every((n) =>
        typeof n === "number" && Number.isSafeInteger(n) && n >= 0
      ),
    );
    requireShape(Array.isArray(root.accounts));
    const counts = { approved: 0, not_approved: 0, missing: 0 };
    const ids = new Set<string>();
    for (const entry of root.accounts) {
      const row = fields(entry, ACCOUNT_FIELDS);
      requireShape(lowerUuid(row.id) && !ids.has(row.id));
      ids.add(row.id);
      requireShape(
        ["Maloum", "Brezzels", "4Based"].includes(row.platform as string),
      );
      requireShape(
        row.email === null ||
          (typeof row.email === "string" &&
            normalizeLogin(row.email) === row.email),
      );
      requireShape(
        row.assignment_source === null ||
          ["controlling", "shex_account", "same_login"].includes(
            row.assignment_source as string,
          ),
      );
      timestamp(row.assignment_updated_at);
      timestamp(row.confirmed_at);
      timestamp(row.source_updated_at);
      if (row.assignment_source !== "controlling") {
        requireShape(row.assignment_updated_at === null);
      }
      if (row.status === "approved" || row.status === "not_approved") {
        requireShape(
          row.email !== null && lowerUuid(row.external_model_id) &&
            row.assignment_source !== null,
        );
        if (row.status === "approved") {
          requireShape(row.status_reason === "approved");
          profile(row.profile);
          counts.approved++;
        } else {
          requireShape(
            ["no_profile", "awaiting_approval", "profile_unusable"].includes(
              row.status_reason as string,
            ),
          );
          counts.not_approved++;
        }
      } else {
        requireShape(
          row.status === "missing" && row.external_model_id === null,
        );
        switch (row.status_reason) {
          case "no_login":
            requireShape(row.email === null && row.assignment_source === null);
            break;
          case "blocked":
            requireShape(
              row.email !== null && row.assignment_source === "controlling",
            );
            break;
          case "model_not_found":
            requireShape(row.email !== null && row.assignment_source !== null);
            break;
          case "ambiguous":
          case "no_assignment":
            requireShape(row.email !== null && row.assignment_source === null);
            break;
          default:
            requireShape(false);
        }
        counts.missing++;
      }
      if (row.status !== "approved") {
        requireShape(
          row.confirmed_at === null && row.source_updated_at === null &&
            row.profile === null,
        );
      }
    }
    requireShape(summary.accounts === root.accounts.length);
    for (const key of ["approved", "not_approved", "missing"] as const) {
      requireShape(summary[key] === counts[key]);
    }
    return value as ExportEnvelope;
  } catch {
    throw new Error("invalid_export_envelope");
  }
}
