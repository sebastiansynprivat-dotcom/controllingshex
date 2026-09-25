import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import {
  ACCOUNT_FIELDS,
  validateExportEnvelope,
} from "../_shared/steckbrief/contracts.ts";
import { NotConfiguredError } from "../_shared/steckbrief/errors.ts";
import {
  fakeShex,
  FIXED_NOW,
  json,
  link,
  memoryStore,
  model,
  MODEL_A,
  MODEL_B,
  PROFILE_MARKER,
  shexProfile,
  TEST_EXPORT_KEY,
  TEST_UPSTREAM_KEY,
  testEnv,
  uuid,
} from "../_shared/steckbrief/test-helpers.ts";
import { createExportHandler } from "./handler.ts";
import type { ExportHandlerDeps } from "./handler.ts";

function setup(patch: Partial<ExportHandlerDeps> = {}) {
  const logs: string[] = [];
  const sleeps: number[] = [];
  const memory = memoryStore();
  const upstream = fakeShex();
  const handler = createExportHandler({
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
  return { handler, logs, sleeps, memory, upstream };
}

function request(
  method = "GET",
  body?: string,
  headers: HeadersInit = { "x-api-key": TEST_EXPORT_KEY },
  query = "",
): Request {
  return new Request(`https://example.com/export${query}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body }),
  });
}

function checkLog(lines: string[], status: number, code?: string) {
  assertEquals(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assertEquals(entry.fn, "models-steckbrief-export");
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
    Object.values(entry.counts).every((count) =>
      typeof count === "number" && Number.isSafeInteger(count) && count >= 0
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
      "Fabelmodell",
      "Fabelstern",
    ]
  ) assertFalse(lines[0].includes(sensitive));
}

async function checkError(response: Response, status: number, code: string) {
  assertEquals(response.status, status);
  assertEquals(await response.text(), JSON.stringify({ error: code }));
  assertEquals(response.headers.get("cache-control"), "no-store");
  assertEquals(
    response.headers.get("content-type"),
    "application/json; charset=utf-8",
  );
  for (const key of response.headers.keys()) {
    assertFalse(key.startsWith("access-control-"));
  }
}

Deno.test("export checks method before environment/auth, including OPTIONS", async () => {
  for (const method of ["PUT", "OPTIONS", "DELETE", "HEAD"]) {
    const h = setup({
      env: () => {
        throw new Error("must not run");
      },
    });
    await checkError(
      await h.handler(request(method)),
      405,
      "method_not_allowed",
    );
    checkLog(h.logs, 405, "method_not_allowed");
    assertEquals(h.memory.calls, []);
  }
});

Deno.test("export requires its own configured key before authentication", async () => {
  for (const value of [undefined, "", " \t "]) {
    const h = setup({
      env: (name) => name === "STECKBRIEF_EXPORT_KEY" ? value : testEnv(name),
    });
    await checkError(
      await h.handler(request("POST", "invalid", {})),
      503,
      "not_configured",
    );
    checkLog(h.logs, 503, "not_configured");
  }
});

Deno.test("export only accepts x-api-key, never query, bearer or unrelated export keys", async () => {
  const cases: [HeadersInit, string][] = [
    [{}, ""],
    [{ "x-api-key": "wrong" }, ""],
    [{}, `?key=${TEST_EXPORT_KEY}`],
    [{ authorization: `Bearer ${TEST_EXPORT_KEY}` }, ""],
    [
      { "x-api-key": "wrong", authorization: `Bearer ${TEST_EXPORT_KEY}` },
      `?key=${TEST_EXPORT_KEY}`,
    ],
    [{ "x-api-key": "synthetic-legacy-export" }, ""],
    [{ "x-api-key": "synthetic-live-status" }, ""],
  ];
  for (const [headers, query] of cases) {
    const h = setup({
      env: (name) =>
        ({
          MODELS_EXPORT_KEY: "synthetic-legacy-export",
          LIVE_STATUS_KEY: "synthetic-live-status",
        } as Record<string, string>)[name] ??
          (name === "CONTROLLING_MODEL_PROFILES_KEY"
            ? undefined
            : testEnv(name)),
    });
    await checkError(
      await h.handler(request("POST", "invalid", headers, query)),
      401,
      "unauthorized",
    );
    checkLog(h.logs, 401, "unauthorized");
    assertEquals(h.upstream.requests, []);
  }
});

Deno.test("export checks upstream key after auth and before parsing body", async () => {
  const h = setup({
    env: (name) =>
      name === "CONTROLLING_MODEL_PROFILES_KEY" ? " \t " : testEnv(name),
  });
  await checkError(
    await h.handler(request("POST", "invalid")),
    503,
    "not_configured",
  );
  checkLog(h.logs, 503, "not_configured");
  assertEquals(h.memory.calls, []);
});

Deno.test("export rejects invalid JSON, non-object bodies and invalid platform values", async () => {
  for (
    const body of [
      "invalid",
      "null",
      "[]",
      '"Maloum"',
      '{"platform":42}',
      '{"platform":null}',
      '{"platform":{}}',
      '{"platform":[]}',
      '{"platform":""}',
      JSON.stringify({ platform: "x".repeat(33) }),
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
  }
  for (
    const query of [
      "?platform=",
      `?platform=${"x".repeat(33)}`,
      "?platform=Maloum&platform=4Based",
    ]
  ) {
    const h = setup();
    await checkError(
      await h.handler(
        request("GET", undefined, { "x-api-key": TEST_EXPORT_KEY }, query),
      ),
      400,
      "invalid_request",
    );
    checkLog(h.logs, 400, "invalid_request");
  }
});

function populated() {
  const models = [
    model(1, { email: " SHARED@EXAMPLE.COM " }),
    model(2, { email: "shared@example.com" }),
    model(3, { platform: "Brezzels" }),
    model(4, { platform: "Maloum", email: "shared@example.com" }),
    model(5, { platform: "Maloum", email: null }),
    model(6, { user_id: null }),
  ];
  const memory = memoryStore({
    models,
    links: [link(1, { email_normalized: "shared@example.com" })],
  });
  const upstream = fakeShex(
    (identity) => identity.platform === "brezzels" ? { same: [MODEL_B] } : {},
    [shexProfile(MODEL_B, "not_approved")],
  );
  return {
    ...setup({ store: memory.store, fetchImpl: upstream.fetchImpl }),
    models,
    inputRequests: upstream.resolveRequests,
  };
}

Deno.test("export returns strict 11-field rows in store order with correct counts and safe headers/log", async () => {
  const h = populated();
  const response = await h.handler(request());
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("access-control-allow-origin"), null);
  assertEquals(response.headers.get("cache-control"), "no-store");
  const body = validateExportEnvelope(await response.json());
  assertEquals(body.generated_at, FIXED_NOW);
  assertEquals(
    body.accounts.map((row) => row.id),
    h.models.slice(0, 5).map((row) => row.id),
  );
  for (const row of body.accounts) {
    assertEquals(Object.keys(row), [...ACCOUNT_FIELDS]);
  }
  assertEquals(body.summary, {
    accounts: 5,
    approved: 3,
    not_approved: 1,
    missing: 1,
    excluded_rows: 1,
  });
  assertEquals(body.accounts.map((row) => row.assignment_source), [
    "controlling",
    "controlling",
    "shex_account",
    "same_login",
    null,
  ]);
  assertEquals(body.accounts[0].profile, {
    name: PROFILE_MARKER,
    age: null,
    content_joi: false,
  });
  assertEquals(
    { ...body.accounts[0], id: body.accounts[1].id },
    body.accounts[1],
  );
  assertEquals(h.inputRequests.length, 1);
  assertEquals(h.inputRequests[0].include_profiles, true);
  assertEquals(h.inputRequests[0].identities.length, 3);
  checkLog(h.logs, 200);
  assertEquals(JSON.parse(h.logs[0]).counts, body.summary);
});

Deno.test("export captures generated_at once after auth/config and before inventory loading", async () => {
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
      ...memory.store,
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
  const body = validateExportEnvelope(await response.json());
  assertEquals(body.generated_at, "2026-09-24T18:00:01.000Z");
  assertEquals(steps, [
    "now:0",
    "STECKBRIEF_EXPORT_KEY",
    "CONTROLLING_MODEL_PROFILES_KEY",
    "now:1",
    "models",
    "links",
    "admins",
    "upstream",
    "now:2",
  ]);
});

Deno.test("export platform filter is case-insensitive and applies only after full inventory resolution", async () => {
  for (const useBody of [true, false]) {
    const h = populated();
    const response = await h.handler(
      useBody ? request("POST", '{"platform":"mAlOuM"}') : request(
        "GET",
        undefined,
        { "x-api-key": TEST_EXPORT_KEY },
        "?platform=mAlOuM",
      ),
    );
    const body = validateExportEnvelope(await response.json());
    assertEquals(body.accounts.map((row) => row.platform), [
      "Maloum",
      "Maloum",
    ]);
    assertEquals(body.accounts[0].assignment_source, "same_login");
    assertEquals(body.accounts[0].external_model_id, MODEL_A);
    assertEquals(body.summary, {
      accounts: 2,
      approved: 1,
      not_approved: 0,
      missing: 1,
      excluded_rows: 0,
    });
    assertEquals(h.inputRequests[0].identities.map((row) => row.platform), [
      "4based",
      "brezzels",
      "maloum",
    ]);
    checkLog(h.logs, 200);
  }
  const h = populated();
  const response = await h.handler(request("POST", '{"platform":"4bAsEd"}'));
  assertEquals(
    validateExportEnvelope(await response.json()).summary.excluded_rows,
    1,
  );
});

Deno.test("POST without body (or whitespace only) behaves like an unfiltered GET", async () => {
  const get = populated();
  const expected = validateExportEnvelope(
    await (await get.handler(request("GET"))).json(),
  );
  for (const body of [undefined, "", "  \n"]) {
    const h = populated();
    const response = await h.handler(request("POST", body));
    assertEquals(response.status, 200);
    const actual = validateExportEnvelope(await response.json());
    assertEquals(actual.summary, expected.summary);
    assertEquals(actual.accounts, expected.accounts);
    checkLog(h.logs, 200);
  }
});

Deno.test("unknown platform returns empty 200 with all summary counts zero", async () => {
  for (const platform of ["unknown", "4-based", " Maloum "]) {
    const h = populated();
    const response = await h.handler(
      request("POST", JSON.stringify({ platform })),
    );
    assertEquals(response.status, 200);
    const body = validateExportEnvelope(await response.json());
    assertEquals(body.accounts, []);
    assertEquals(body.summary, {
      accounts: 0,
      approved: 0,
      not_approved: 0,
      missing: 0,
      excluded_rows: 0,
    });
    checkLog(h.logs, 200);
  }
});

Deno.test("untrusted siblings cannot contribute assignments", async () => {
  const memory = memoryStore({
    models: [
      model(1),
      model(2, {
        platform: "Maloum",
        email: model(1).email,
        user_id: uuid(900_002),
      }),
    ],
    links: [link(1, { platform: "Maloum" })],
  });
  const h = setup({ store: memory.store });
  const response = await h.handler(request());
  const body = validateExportEnvelope(await response.json());
  assertEquals(body.accounts.length, 1);
  assertEquals(body.accounts[0].status_reason, "no_assignment");
  assertEquals(body.summary.excluded_rows, 1);
});

Deno.test("empty export still calls upstream and trims configured/header keys", async () => {
  const h = setup({
    env: (name) => testEnv(name) ? ` ${testEnv(name)} ` : undefined,
  });
  const response = await h.handler(
    request("POST", "{}", { "x-api-key": ` ${TEST_EXPORT_KEY} ` }),
  );
  assertEquals(response.status, 200);
  assertEquals(validateExportEnvelope(await response.json()).accounts, []);
  assertEquals(h.upstream.requests.length, 1);
  checkLog(h.logs, 200);
});

Deno.test("export closes upstream failures to exact 502 and logs once without sensitive values", async () => {
  let calls = 0;
  const h = setup({
    fetchImpl: () => {
      calls++;
      return Promise.resolve(
        json(
          { error: `${PROFILE_MARKER} synthetic@example.org ${MODEL_A}` },
          503,
        ),
      );
    },
  });
  await checkError(await h.handler(request()), 502, "upstream_failed");
  assertEquals(calls, 2);
  assertEquals(h.sleeps, [1000]);
  checkLog(h.logs, 502, "upstream_failed");
});

Deno.test("export maps missing SheX rollout/config to closed 503 without retries or CORS", async () => {
  for (const status of [404, 503]) {
    let calls = 0;
    const h = setup({
      fetchImpl: () => {
        calls++;
        return Promise.resolve(json({
          error: status === 503
            ? "not_configured"
            : `synthetic@example.org ${MODEL_A} ${PROFILE_MARKER}`,
        }, status));
      },
    });
    await checkError(await h.handler(request()), 503, "not_configured");
    assertEquals(calls, 1);
    assertEquals(h.sleeps, []);
    checkLog(h.logs, 503, "not_configured");
  }
});

Deno.test("export maps a missing links table to closed 503 before calling SheX", async () => {
  const memory = memoryStore();
  memory.store.getLinksPage = () => Promise.reject(new NotConfiguredError());
  const h = setup({ store: memory.store });
  await checkError(await h.handler(request()), 503, "not_configured");
  checkLog(h.logs, 503, "not_configured");
  assertEquals(h.upstream.requests, []);
});

Deno.test("export never returns a partial or empty filtered result on upstream contract failure", async () => {
  const bad = setup({
    store: memoryStore({ models: [model(1)] }).store,
    fetchImpl: () =>
      Promise.resolve(
        json({
          contract: "controlling-model-profiles.v1",
          resolutions: [],
          profiles: [],
        }),
      ),
  });
  await checkError(
    await bad.handler(request("POST", '{"platform":"unknown"}')),
    502,
    "upstream_failed",
  );
  checkLog(bad.logs, 502, "upstream_failed");
});

Deno.test("export maps incomplete inventories and unexpected failures to closed 500 errors", async () => {
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
