import { identityKey, normalizeLogin, platformKey } from "./core.ts";
import { InventoryIncompleteError } from "./errors.ts";
import type { Identity, LinkRow, ModelRow, ResolveRequest } from "./types.ts";

export const PAGE_SIZE = 1000;

export interface Page<T> {
  rows: T[];
  count: number | null;
}

export interface InventoryStore {
  getModelsPage(from: number, to: number): Promise<Page<ModelRow>>;
  getLinksPage(from: number, to: number): Promise<Page<LinkRow>>;
  getAdminUserIdsPage(
    from: number,
    to: number,
  ): Promise<Page<{ user_id: string }>>;
}

export interface AuthStore {
  getUserIdFromToken(token: string): Promise<string | null>;
  isAdmin(userId: string): Promise<boolean>;
}

export interface Inventory {
  models: ModelRow[];
  links: LinkRow[];
  identities: Identity[];
  excludedModels: ModelRow[];
}

async function loadPages<T>(
  read: (from: number, to: number) => Promise<Page<T>>,
  rowKey: (row: T) => string,
): Promise<T[]> {
  const rows: T[] = [];
  const seen = new Set<string>();
  let expected: number | undefined;
  for (let from = 0;; from += PAGE_SIZE) {
    const page = await read(from, from + PAGE_SIZE - 1);
    if (
      page.count === null || !Number.isSafeInteger(page.count) ||
      page.count < 0 ||
      (expected !== undefined && page.count !== expected)
    ) throw new InventoryIncompleteError();
    expected = page.count;
    if (page.rows.length !== Math.min(PAGE_SIZE, expected - from)) {
      throw new InventoryIncompleteError();
    }
    for (const row of page.rows) {
      const key = rowKey(row);
      // Offset pagination must not silently substitute a duplicate for a missing row.
      if (seen.has(key)) throw new InventoryIncompleteError();
      seen.add(key);
      rows.push(row);
    }
    if (rows.length === expected) return rows;
  }
}

export async function loadInventory(store: InventoryStore): Promise<Inventory> {
  const [allModels, links, admins] = await Promise.all([
    loadPages((from, to) => store.getModelsPage(from, to), (row) => row.id),
    loadPages((from, to) => store.getLinksPage(from, to), (row) => row.id),
    loadPages(
      (from, to) => store.getAdminUserIdsPage(from, to),
      (row) => row.user_id,
    ),
  ]);
  const adminIds = new Set(admins.map((row) => row.user_id));
  const models: ModelRow[] = [];
  const excludedModels: ModelRow[] = [];
  const identities = new Map<string, Identity>();
  for (const model of allModels) {
    if (model.user_id === null || !adminIds.has(model.user_id)) {
      excludedModels.push(model);
      continue;
    }
    models.push(model);
    const email = normalizeLogin(model.email);
    if (email !== null) {
      identities.set(identityKey(model.platform, email), {
        platform: platformKey(model.platform),
        email,
      });
    }
  }
  return {
    models,
    links,
    identities: [...identities.values()],
    excludedModels,
  };
}

export function inventoryRequest(
  inventory: Inventory,
  includeProfiles: boolean,
): ResolveRequest {
  return {
    identities: inventory.identities,
    model_ids: [
      ...new Set(
        inventory.links.flatMap((link) =>
          link.mode === "assign" && link.external_model_id !== null
            ? [link.external_model_id]
            : []
        ),
      ),
    ],
    include_profiles: includeProfiles,
  };
}
