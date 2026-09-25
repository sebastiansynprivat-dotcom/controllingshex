import { identityKey, toTimestamp } from "./core.ts";
import type { Inventory } from "./inventory.ts";
import { resolveAccounts } from "./resolution.ts";
import type {
  LinkRow,
  OverrideView,
  OverviewEnvelope,
  OverviewIdentity,
  ResolveResponse,
  ShexModel,
} from "./types.ts";

function overrideView(link: LinkRow): OverrideView {
  return {
    mode: link.mode,
    external_model_id: link.external_model_id,
    external_model_name: link.external_model_name,
    updated_at: toTimestamp(link.updated_at),
  };
}

export function buildOverview(
  inventory: Inventory,
  upstream: ResolveResponse,
  models: ShexModel[],
  generatedAt: string,
): OverviewEnvelope {
  const accounts = resolveAccounts(
    inventory.models,
    inventory.links,
    upstream,
    false,
  );
  const overrides = new Map(
    inventory.links.map((
      link,
    ) => [identityKey(link.platform, link.email_normalized), link]),
  );
  const resolutions = new Map(
    upstream.resolutions.map((
      row,
    ) => [identityKey(row.platform, row.email), row]),
  );
  const identities = new Map<string, OverviewIdentity>();
  for (const account of accounts) {
    if (account.email === null) continue;
    const key = identityKey(account.platform, account.email);
    if (identities.has(key)) continue;
    const override = overrides.get(key);
    identities.set(key, {
      platform: account.platform,
      email: account.email,
      status: account.status,
      status_reason: account.status_reason,
      external_model_id: account.external_model_id,
      assignment_source: account.assignment_source,
      assignment_updated_at: account.assignment_updated_at,
      confirmed_at: account.confirmed_at,
      override: override ? overrideView(override) : null,
      shex_model_ids: resolutions.get(key)!.same_platform_model_ids,
    });
  }
  return {
    contract: "steckbrief-links.overview.v1",
    generated_at: generatedAt,
    excluded_rows: inventory.excludedModels.length,
    models,
    identities: [...identities.values()].sort((a, b) =>
      a.platform.localeCompare(b.platform) || a.email.localeCompare(b.email)
    ),
    orphan_overrides: inventory.links
      .filter((link) =>
        !identities.has(identityKey(link.platform, link.email_normalized))
      )
      .map((link) => ({
        platform: link.platform,
        email: link.email_normalized,
        ...overrideView(link),
      })),
  };
}
