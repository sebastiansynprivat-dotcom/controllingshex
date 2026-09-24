// Entirely synthetic data. This module never imports the real Supabase store.
import { normalizeLogin, platformKey } from "./core.ts";
import type { AuthStore, InventoryStore, Page } from "./inventory.ts";
import type {
  Identity,
  LinkRow,
  ModelRow,
  ProfileStatus,
  Resolution,
  ResolveRequest,
  ResolveResponse,
  ShexModel,
  ShexProfile,
} from "./types.ts";

export const FIXED_NOW = "2026-09-24T18:00:00.000Z";
export const PROFILE_MARKER = "Fiktiver Profilwert Nebelfeder";
export const TEST_EXPORT_KEY = "synthetic-export-key";
export const TEST_UPSTREAM_KEY = "synthetic-upstream-key";
export const TEST_TOKEN = "synthetic-user-token";

export function uuid(n: number): string {
  return `b7a091e4-65b2-4f01-8a32-${n.toString(16).padStart(12, "0")}`;
}

export const ADMIN_ID = uuid(900_001);
export const MODEL_A = uuid(800_001);
export const MODEL_B = uuid(800_002);

export function model(n: number, patch: Partial<ModelRow> = {}): ModelRow {
  return {
    id: uuid(n),
    platform: "4Based",
    model_name: `Fabelmodell ${n}`,
    email: `konto-${n}@example.com`,
    user_id: ADMIN_ID,
    ...patch,
  };
}

export function link(n: number, patch: Partial<LinkRow> = {}): LinkRow {
  return {
    id: uuid(100_000 + n),
    platform: "4Based",
    email_normalized: `konto-${n}@example.com`,
    mode: "assign",
    external_model_id: MODEL_A,
    external_model_name: "Fabelmodell Nebelfeder",
    created_by: ADMIN_ID,
    created_at: FIXED_NOW,
    updated_at: FIXED_NOW,
    ...patch,
  };
}

export function shexProfile(
  id = MODEL_A,
  profileStatus: ProfileStatus = "approved",
  patch: Partial<ShexProfile> = {},
): ShexProfile {
  return {
    model_id: id,
    model_exists: true,
    profile_status: profileStatus,
    confirmed_at: profileStatus === "approved" ? FIXED_NOW : null,
    updated_at: profileStatus === "approved" ? FIXED_NOW : null,
    profile: profileStatus === "approved"
      ? { name: PROFILE_MARKER, age: null, content_joi: false }
      : null,
    ...patch,
  };
}

export function shexModel(
  id = MODEL_A,
  patch: Partial<ShexModel> = {},
): ShexModel {
  return {
    model_id: id,
    name: "Fabelmodell Nebelfeder",
    username: "fabelmodell_synthetic",
    model_active: true,
    profile_status: "approved",
    ...patch,
  };
}

export type Match = (
  identity: Identity,
) => { same?: string[]; other?: string[] };

export function resolveResponse(
  request: ResolveRequest,
  match: Match = () => ({}),
  profiles: ShexProfile[] = [],
): ResolveResponse {
  const resolutions: Resolution[] = request.identities.map((identity) => {
    const normalized = {
      platform: platformKey(identity.platform),
      email: normalizeLogin(identity.email) ?? "",
    };
    const found = match(normalized);
    return {
      ...normalized,
      same_platform_model_ids: [...new Set(found.same ?? [])].sort(),
      other_platform_model_ids: [...new Set(found.other ?? [])].sort(),
    };
  });
  const ids = [
    ...new Set([
      ...request.model_ids.map((id) => id.toLowerCase()),
      ...resolutions.flatMap((
        row,
      ) => [...row.same_platform_model_ids, ...row.other_platform_model_ids]),
    ]),
  ].sort();
  return {
    contract: "controlling-model-profiles.v1",
    resolutions,
    profiles: ids.map((id) => {
      const profile = profiles.find((row) => row.model_id === id) ??
        shexProfile(id);
      return {
        ...profile,
        profile: request.include_profiles ? profile.profile : null,
      };
    }),
  };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function fakeShex(
  match: Match = () => ({}),
  profiles: ShexProfile[] = [],
  models: ShexModel[] = [],
) {
  const requests:
    ((ResolveRequest & { action: "resolve" }) | { action: "list_models" })[] =
      [];
  const resolveRequests: ResolveRequest[] = [];
  const fetchImpl: typeof fetch = async (_url, init) => {
    const request = JSON.parse((init as RequestInit).body as string);
    requests.push(request);
    if (request.action === "resolve") resolveRequests.push(request);
    return request.action === "list_models"
      ? json({ contract: "controlling-model-profiles.v1", models })
      : json(resolveResponse(request, match, profiles));
  };
  return { fetchImpl, requests, resolveRequests };
}

export function memoryStore(
  options: {
    models?: ModelRow[];
    links?: LinkRow[];
    admins?: string[];
    authenticated?: boolean;
    admin?: boolean;
  } = {},
) {
  const calls: { table: string; from: number; to: number }[] = [];
  const page = <T>(
    table: string,
    rows: T[],
    from: number,
    to: number,
  ): Promise<Page<T>> => {
    calls.push({ table, from, to });
    return Promise.resolve({
      rows: rows.slice(from, to + 1),
      count: rows.length,
    });
  };
  const store: InventoryStore & AuthStore = {
    getModelsPage: (from, to) => page("models", options.models ?? [], from, to),
    getLinksPage: (from, to) => page("links", options.links ?? [], from, to),
    getAdminUserIdsPage: (from, to) =>
      page(
        "admins",
        (options.admins ?? [ADMIN_ID]).map((user_id) => ({ user_id })),
        from,
        to,
      ),
    getUserIdFromToken: (token) =>
      Promise.resolve(
        options.authenticated !== false && token === TEST_TOKEN
          ? ADMIN_ID
          : null,
      ),
    isAdmin: () => Promise.resolve(options.admin !== false),
  };
  return { store, calls };
}

export function testEnv(name: string): string | undefined {
  return ({
    STECKBRIEF_EXPORT_KEY: TEST_EXPORT_KEY,
    CONTROLLING_MODEL_PROFILES_KEY: TEST_UPSTREAM_KEY,
  } as Record<string, string>)[name];
}
