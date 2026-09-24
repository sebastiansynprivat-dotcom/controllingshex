import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { NotConfiguredError } from "../_shared/steckbrief/errors.ts";
import { LINKS_CORS_HEADERS } from "../_shared/steckbrief/http.ts";
import {
  ADMIN_ID,
  fakeShex,
  FIXED_NOW,
  json,
  link,
  memoryStore,
  model,
  MODEL_A,
  MODEL_B,
  PROFILE_MARKER,
  shexModel,
  shexProfile,
  TEST_EXPORT_KEY,
  TEST_TOKEN,
  TEST_UPSTREAM_KEY,
  testEnv,
  uuid,
} from "../_shared/steckbrief/test-helpers.ts";
import type { OverviewEnvelope } from "../_shared/steckbrief/types.ts";
import { createLinksHandler } from "./handler.ts";
import type { LinksHandlerDeps } from "./handler.ts";

function setup(patch: Partial<LinksHandlerDeps> = {}) {
  const logs: string[] = [];
  const sleeps: number[] = [];
  const memory = memoryStore();
  const upstream = fakeShex();
  const handler = createLinksHandler({
    env: testEnv,
    store: memory.store,
    fetchImpl: upstream.fetchImpl,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    now: () => new Date(FIXED_NOW),
    log: (line) => logs.push(line),
    ...patch,
  });
  return { handler, logs, memory, upstream, sleeps };
}

function request(
  method = "POST",
  body = '{"action":"overview"}',
  headers: HeadersInit = { authorization: `Bearer ${TEST_TOKEN}` },
) {
  return new Request("https://example.com/links", {
    method,
    headers,
    ...(method === "GET" || method === "HEAD" ? {} : { body }),
  });
}

function cors(response: Response) {
  for (const [key, value] of Object.entries(LINKS_CORS_HEADERS)) {
    assertEquals(response.headers.get(key), value);
  }
}

function checkLog(lines: string[], status: number, code?: string) {
  assertEquals(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assertEquals(entry.fn, "steckbrief-links");
  assertEquals(entry.status, status);
  assertEquals(entry.ms, 0);
  assertEquals(entry.error, code);
  assertEquals(
    Object.keys(entry).sort(),
    (code
      ? ["fn", "status", "counts", "ms", "error"]
      : ["fn", "status", "counts", "ms"]).sort(),
  );
  assert(
    Object.values(entry.counts).every((value) =>
      typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ),
  );
  assertFalse(lines[0].includes("@"));
  assertFalse(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(
      lines[0],
    ),
  );
  for (
    const sensitive of [
      PROFILE_MARKER,
      TEST_EXPORT_KEY,
      TEST_UPSTREAM_KEY,
      TEST_TOKEN,
      "Fabelmodell",
      "Zirbelfunke",
    ]
  ) assertFalse(lines[0].includes(sensitive));
}

async function checkError(response: Response, status: number, code: string) {
  assertEquals(response.status, status);
  cors(response);
  assertEquals(await response.text(), JSON.stringify({ error: code }));
}

function noProfileKey(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  assertFalse(Object.hasOwn(value, "profile"));
  for (const child of Object.values(value)) noProfileKey(child);
}

Deno.test("links OPTIONS returns 200 ok with exact CORS before any auth/config checks", async () => {
  const h = setup({
    env: () => {
      throw new Error("must not run");
    },
  });
  const response = await h.handler(request("OPTIONS", "invalid", {}));
  assertEquals(response.status, 200);
  assertEquals(await response.text(), "ok");
  cors(response);
  checkLog(h.logs, 200);
  assertEquals(h.memory.calls, []);
});

Deno.test("links rejects non-POST methods before token validation", async () => {
  for (const method of ["GET", "PUT", "DELETE"]) {
    const h = setup({ env: () => undefined });
    await checkError(
      await h.handler(request(method, "invalid", {})),
      405,
      "method_not_allowed",
    );
    checkLog(h.logs, 405, "method_not_allowed");
  }
});

Deno.test("links requires a valid bearer user token and authenticates before admin/config/body", async () => {
  const cases: HeadersInit[] = [
    {},
    { authorization: "Bearer" },
    { authorization: "Basic synthetic" },
    { authorization: "Bearer invalid" },
    { "x-api-key": TEST_EXPORT_KEY },
  ];
  for (const headers of cases) {
    const h = setup({ env: () => undefined });
    await checkError(
      await h.handler(request("POST", "invalid", headers)),
      401,
      "unauthorized",
    );
    checkLog(h.logs, 401, "unauthorized");
    assertEquals(h.memory.calls, []);
  }
  const memory = memoryStore({ authenticated: false });
  const h = setup({ store: memory.store });
  await checkError(await h.handler(request()), 401, "unauthorized");
  checkLog(h.logs, 401, "unauthorized");
});

Deno.test("links rejects non-admin users before missing secret and invalid body", async () => {
  const h = setup({
    store: memoryStore({ admin: false }).store,
    env: () => undefined,
  });
  await checkError(
    await h.handler(request("POST", "invalid")),
    403,
    "forbidden",
  );
  checkLog(h.logs, 403, "forbidden");
});

Deno.test("links checks secret before body and never requires the export secret", async () => {
  const missing = setup({ env: () => " \t " });
  await checkError(
    await missing.handler(request("POST", "invalid")),
    503,
    "not_configured",
  );
  checkLog(missing.logs, 503, "not_configured");
  const present = setup({
    env: (name) =>
      name === "CONTROLLING_MODEL_PROFILES_KEY" ? TEST_UPSTREAM_KEY : undefined,
  });
  const response = await present.handler(request());
  assertEquals(response.status, 200);
  cors(response);
  checkLog(present.logs, 200);
});

Deno.test("links rejects unknown actions and malformed bodies", async () => {
  for (
    const body of [
      "invalid",
      "",
      "null",
      "[]",
      "{}",
      '{"action":"resolve"}',
      '{"action":"list_models"}',
      '{"action":12}',
    ]
  ) {
    const h = setup();
    await checkError(
      await h.handler(request("POST", body)),
      400,
      "invalid_request",
    );
    checkLog(h.logs, 400, "invalid_request");
    assertEquals(h.memory.calls, []);
    assertEquals(h.upstream.requests, []);
  }
});

Deno.test("links resolves auth user ID then checks that user's role", async () => {
  const memory = memoryStore();
  const steps: string[] = [];
  memory.store.getUserIdFromToken = (token) => {
    assertEquals(token, TEST_TOKEN);
    steps.push("token");
    return Promise.resolve(ADMIN_ID);
  };
  memory.store.isAdmin = (userId) => {
    assertEquals(userId, ADMIN_ID);
    steps.push("role");
    return Promise.resolve(true);
  };
  const h = setup({
    store: memory.store,
    env: (name) => {
      steps.push("secret");
      return testEnv(name);
    },
  });
  assertEquals((await h.handler(request())).status, 200);
  assertEquals(steps, ["token", "role", "secret"]);
});

Deno.test("links captures generated_at once after auth/config and before inventory loading", async () => {
  const steps: string[] = [];
  let ticks = 0;
  const memory = memoryStore({ models: [model(1)] });
  const upstream = fakeShex();
  const h = setup({
    env: (name) => {
      steps.push(name);
      return testEnv(name);
    },
    now: () => {
      steps.push(`now:${ticks}`);
      return new Date(Date.parse(FIXED_NOW) + ticks++ * 1000);
    },
    store: {
      getUserIdFromToken: (token) => {
        steps.push("token");
        return memory.store.getUserIdFromToken(token);
      },
      isAdmin: (userId) => {
        steps.push("role");
        return memory.store.isAdmin(userId);
      },
      getModelsPage: (from, to) => {
        steps.push("models");
        return memory.store.getModelsPage(from, to);
      },
      getLinksPage: (from, to) => {
        steps.push("links");
        return memory.store.getLinksPage(from, to);
      },
      getAdminUserIdsPage: (from, to) => {
        steps.push("admins");
        return memory.store.getAdminUserIdsPage(from, to);
      },
    },
    fetchImpl: (url, init) => {
      steps.push("upstream");
      return upstream.fetchImpl(url, init);
    },
  });
  const response = await h.handler(request());
  assertEquals(response.status, 200);
  const body: OverviewEnvelope = await response.json();
  assertEquals(body.generated_at, "2026-09-24T18:00:01.000Z");
  assertEquals(steps, [
    "now:0",
    "token",
    "role",
    "CONTROLLING_MODEL_PROFILES_KEY",
    "now:1",
    "models",
    "links",
    "admins",
    "upstream",
    "upstream",
    "now:2",
  ]);
});

Deno.test("links overview is sorted, deduplicated, excludes untrusted rows and contains no profile key", async () => {
  const models = [
    model(1, { platform: "Maloum", email: "zulu@example.org" }),
    model(2, { email: "beta@example.com" }),
    model(3, { email: " ALPHA@EXAMPLE.COM " }),
    model(4, { email: "alpha@example.com" }),
    model(5, { platform: "Maloum", email: null }),
    model(6, {
      platform: "Brezzels",
      email: "orphan@example.org",
      user_id: uuid(900_002),
    }),
  ];
  const links = [
    link(3, {
      email_normalized: "alpha@example.com",
      updated_at: "2026-09-24T20:00:00+02:00",
      external_model_name: "Fabelmodell Cache",
    }),
    link(2, {
      email_normalized: "beta@example.com",
      mode: "block",
      external_model_id: null,
      external_model_name: null,
    }),
    link(6, {
      platform: "Brezzels",
      email_normalized: "orphan@example.org",
      external_model_id: MODEL_B,
    }),
  ];
  const list = [
    shexModel(),
    shexModel(MODEL_B, {
      name: "Zirbelfunke",
      username: null,
      profile_status: "none",
    }),
  ];
  const fake = fakeShex(
    (identity) => ({
      same: [identity.platform === "maloum" ? MODEL_A : MODEL_B],
    }),
    [shexProfile(), shexProfile(MODEL_B, "none")],
    list,
  );
  const h = setup({
    store: memoryStore({ models, links }).store,
    fetchImpl: fake.fetchImpl,
  });
  const response = await h.handler(request());
  assertEquals(response.status, 200);
  cors(response);
  const body: OverviewEnvelope = await response.json();
  assertEquals(Object.keys(body), [
    "contract",
    "generated_at",
    "excluded_rows",
    "models",
    "identities",
    "orphan_overrides",
  ]);
  assertEquals(body.contract, "steckbrief-links.overview.v1");
  assertEquals(body.generated_at, FIXED_NOW);
  assertEquals(body.models, list);
  assertEquals(body.excluded_rows, 1);
  assertEquals(body.identities.map((row) => [row.platform, row.email]), [
    ["4Based", "alpha@example.com"],
    ["4Based", "beta@example.com"],
    ["Maloum", "zulu@example.org"],
  ]);
  assertEquals(body.identities[0], {
    platform: "4Based",
    email: "alpha@example.com",
    status: "approved",
    status_reason: "approved",
    external_model_id: MODEL_A,
    assignment_source: "controlling",
    assignment_updated_at: FIXED_NOW,
    confirmed_at: FIXED_NOW,
    override: {
      mode: "assign",
      external_model_id: MODEL_A,
      external_model_name: "Fabelmodell Cache",
      updated_at: FIXED_NOW,
    },
    shex_model_ids: [MODEL_B],
  });
  assertEquals(body.identities[1].status_reason, "blocked");
  assertEquals(body.identities[2].override, null);
  assertEquals(body.orphan_overrides, [{
    platform: "Brezzels",
    email: "orphan@example.org",
    mode: "assign",
    external_model_id: MODEL_B,
    external_model_name: "Fabelmodell Nebelfeder",
    updated_at: FIXED_NOW,
  }]);
  noProfileKey(body);
  assertFalse(JSON.stringify(body).includes(PROFILE_MARKER));
  assertEquals(fake.requests.length, 2);
  assertEquals(fake.requests.map((row) => row.action).sort(), [
    "list_models",
    "resolve",
  ]);
  assertEquals(
    fake.requests.find((row) => row.action === "resolve")!.include_profiles,
    false,
  );
  checkLog(h.logs, 200);
  assertEquals(JSON.parse(h.logs[0]).counts, {
    models: 2,
    identities: 3,
    orphan_overrides: 1,
    excluded_rows: 1,
  });
});

Deno.test("links upstream failures carry CORS, exact closed errors and one private log", async () => {
  const h = setup({
    fetchImpl: () =>
      Promise.resolve(
        json(
          { error: `synthetic@example.com ${MODEL_A} ${PROFILE_MARKER}` },
          400,
        ),
      ),
  });
  await checkError(await h.handler(request()), 502, "upstream_failed");
  checkLog(h.logs, 502, "upstream_failed");
  assertEquals(h.sleeps, []);
});

Deno.test("links classifies rollout failures from either SheX action and preserves CORS/retries", async () => {
  for (const action of ["resolve", "list_models"]) {
    for (
      const [status, error, expectedStatus, expectedCode, attempts] of [
        [404, "synthetic", 503, "not_configured", 1],
        [503, "not_configured", 503, "not_configured", 1],
        [503, "synthetic", 502, "upstream_failed", 2],
      ] as const
    ) {
      let calls = 0;
      const fake = fakeShex();
      const h = setup({
        fetchImpl: (url, init) => {
          const body = JSON.parse((init as RequestInit).body as string);
          if (body.action !== action) return fake.fetchImpl(url, init);
          calls++;
          return Promise.resolve(json({ error }, status));
        },
      });
      await checkError(
        await h.handler(request()),
        expectedStatus,
        expectedCode,
      );
      assertEquals(calls, attempts);
      assertEquals(fake.requests.length, 1);
      assertEquals(h.sleeps, attempts === 1 ? [] : [1000]);
      checkLog(h.logs, expectedStatus, expectedCode);
    }
  }
});

Deno.test("links maps a missing links table to closed 503 with CORS before calling SheX", async () => {
  const memory = memoryStore();
  memory.store.getLinksPage = () => Promise.reject(new NotConfiguredError());
  const h = setup({ store: memory.store });
  await checkError(await h.handler(request()), 503, "not_configured");
  checkLog(h.logs, 503, "not_configured");
  assertEquals(h.upstream.requests, []);
});

Deno.test("links never returns successful resolve data when list_models violates its contract", async () => {
  const fake = fakeShex();
  const h = setup({
    fetchImpl: (url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      return body.action === "list_models"
        ? Promise.resolve(json({ contract: "wrong", models: [] }))
        : fake.fetchImpl(url, init);
    },
  });
  await checkError(await h.handler(request()), 502, "upstream_failed");
  checkLog(h.logs, 502, "upstream_failed");
});

Deno.test("links rejects unexpected profile contents even for approved include_profiles=false", async () => {
  const fake = fakeShex(() => ({ same: [MODEL_A] }));
  const h = setup({
    store: memoryStore({ models: [model(1)] }).store,
    fetchImpl: async (url, init) => {
      const response = await fake.fetchImpl(url, init);
      const value = await response.json();
      if (value.profiles?.length) {
        value.profiles[0].profile = { name: PROFILE_MARKER };
      }
      return json(value);
    },
  });
  await checkError(await h.handler(request()), 502, "upstream_failed");
  checkLog(h.logs, 502, "upstream_failed");
});

Deno.test("links finishes both upstream calls before returning a failure", async () => {
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const resolveStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const fake = fakeShex();
  const h = setup({
    fetchImpl: async (url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      if (body.action === "list_models") {
        return json({ contract: "wrong", models: [] });
      }
      started();
      await gate;
      return await fake.fetchImpl(url, init);
    },
  });
  let finished = false;
  const pending = h.handler(request()).then((response) => {
    finished = true;
    return response;
  });
  await resolveStarted;
  await new Promise((resolve) => setTimeout(resolve, 0));
  const finishedEarly = finished;
  const earlyLogs = [...h.logs];
  release();
  await checkError(await pending, 502, "upstream_failed");
  assertFalse(finishedEarly);
  assertEquals(earlyLogs, []);
  checkLog(h.logs, 502, "upstream_failed");
});

Deno.test("links inventory and unexpected errors are closed 500 responses with CORS", async () => {
  for (const incomplete of [true, false]) {
    const memory = memoryStore();
    memory.store.getModelsPage = () =>
      incomplete ? Promise.resolve({ rows: [], count: 1 }) : Promise.reject(
        new Error(`synthetic@example.com ${MODEL_A} ${PROFILE_MARKER}`),
      );
    const h = setup({ store: memory.store });
    const code = incomplete ? "inventory_incomplete" : "internal_error";
    await checkError(await h.handler(request()), 500, code);
    checkLog(h.logs, 500, code);
    assertEquals(h.upstream.requests, []);
  }
});
