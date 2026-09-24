import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { InventoryIncompleteError } from "./errors.ts";
import { inventoryRequest, loadInventory } from "./inventory.ts";
import {
  ADMIN_ID,
  link,
  memoryStore,
  model,
  MODEL_A,
  uuid,
} from "./test-helpers.ts";

Deno.test("inventory loads models, links and admin roles completely in pages of 1000", async () => {
  const models = Array.from({ length: 2107 }, (_, i) => model(i + 1));
  const links = Array.from({ length: 1003 }, (_, i) => link(i + 1));
  const admins = [
    ADMIN_ID,
    ...Array.from({ length: 1001 }, (_, i) => uuid(i + 700_000)),
  ];
  const fake = memoryStore({ models, links, admins });
  const result = await loadInventory(fake.store);
  assertEquals(result.models, models);
  assertEquals(result.links, links);
  assertEquals(result.excludedModels, []);
  assertEquals(result.identities.length, models.length);
  assertEquals(fake.calls.filter((call) => call.table === "models"), [
    { table: "models", from: 0, to: 999 },
    { table: "models", from: 1000, to: 1999 },
    { table: "models", from: 2000, to: 2999 },
  ]);
  assertEquals(fake.calls.filter((call) => call.table === "links").length, 2);
  assertEquals(fake.calls.filter((call) => call.table === "admins").length, 2);
});

Deno.test("inventory rejects count mismatches in every table and absent counts", async () => {
  for (
    const method of [
      "getModelsPage",
      "getLinksPage",
      "getAdminUserIdsPage",
    ] as const
  ) {
    for (const count of [1, null, -1, 1.5]) {
      const { store } = memoryStore();
      store[method] = () => Promise.resolve({ rows: [], count });
      await assertRejects(
        () => loadInventory(store),
        InventoryIncompleteError,
        "inventory_incomplete",
      );
    }
  }
});

Deno.test("inventory rejects changed counts and duplicate rows across pages", async () => {
  for (const duplicate of [false, true]) {
    const models = Array.from({ length: 1001 }, (_, i) => model(i + 1));
    const { store } = memoryStore({ models });
    store.getModelsPage = (from, to) =>
      Promise.resolve({
        count: from > 0 && !duplicate ? 1002 : 1001,
        rows: from > 0 && duplicate ? [models[0]] : models.slice(from, to + 1),
      });
    await assertRejects(() => loadInventory(store), InventoryIncompleteError);
  }
});

Deno.test("inventory excludes untrusted rows, keeps store order, and deduplicates normalized identities", async () => {
  const models = [
    model(3, { platform: "Maloum", email: " FABEL@EXAMPLE.ORG " }),
    model(1, { user_id: uuid(900_002) }),
    model(4, { platform: "Maloum", email: "fabel@example.org" }),
    model(2, { user_id: null }),
    model(5, { email: " \t" }),
  ];
  const { store } = memoryStore({
    models,
    links: [link(3), link(4, { mode: "block", external_model_id: null })],
  });
  const result = await loadInventory(store);
  assertEquals(result.models, [models[0], models[2], models[4]]);
  assertEquals(result.excludedModels, [models[1], models[3]]);
  assertEquals(result.identities, [{
    platform: "maloum",
    email: "fabel@example.org",
  }]);
  assertEquals(inventoryRequest(result, false), {
    identities: result.identities,
    model_ids: [MODEL_A],
    include_profiles: false,
  });
});

Deno.test("empty inventory still reads one page from each table", async () => {
  const fake = memoryStore({ admins: [] });
  assertEquals(await loadInventory(fake.store), {
    models: [],
    links: [],
    identities: [],
    excludedModels: [],
  });
  assertEquals(fake.calls.length, 3);
});
