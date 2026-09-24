import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { UpstreamError } from "./errors.ts";
import {
  ATTEMPT_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  SHEX_URL,
  ShexClient,
} from "./shex-client.ts";
import {
  fakeShex,
  json,
  MODEL_A,
  PROFILE_MARKER,
  resolveResponse,
  shexModel,
  TEST_UPSTREAM_KEY,
  uuid,
} from "./test-helpers.ts";
import type { ResolveRequest } from "./types.ts";

const empty: ResolveRequest = {
  identities: [],
  model_ids: [],
  include_profiles: true,
};

function client(
  fetchImpl: typeof fetch,
  sleeps: number[] = [],
  timeoutMs?: number,
) {
  return new ShexClient({
    apiKey: TEST_UPSTREAM_KEY,
    fetchImpl,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    timeoutMs,
  });
}

Deno.test("SheX client pairs identity/model chunks of at most 1000 and preserves order", async () => {
  const fake = fakeShex();
  const request = {
    identities: Array.from(
      { length: 2100 },
      (_, i) => ({ platform: "4based", email: `synthetic-${i}@example.com` }),
    ),
    model_ids: Array.from({ length: 1001 }, (_, i) => uuid(i + 200_000)),
    include_profiles: true,
  };
  const result = await client(fake.fetchImpl).resolve(request);
  assertEquals(
    fake.resolveRequests.map((
      row,
    ) => [row.identities.length, row.model_ids.length]),
    [[1000, 1000], [1000, 1], [100, 0]],
  );
  assertEquals(
    result.resolutions.map((row) => row.email),
    request.identities.map((row) => row.email),
  );
  assertEquals(result.profiles.map((row) => row.model_id), request.model_ids);
});

Deno.test("SheX client chunks model IDs independently and makes at least one empty resolve call", async () => {
  const fake = fakeShex();
  await client(fake.fetchImpl).resolve({
    ...empty,
    model_ids: Array.from({ length: 2100 }, (_, i) => uuid(i + 200_000)),
  });
  assertEquals(
    fake.resolveRequests.map((
      row,
    ) => [row.identities.length, row.model_ids.length]),
    [[0, 1000], [0, 1000], [0, 100]],
  );
  const blank = fakeShex();
  assertEquals(
    await client(blank.fetchImpl).resolve(empty),
    resolveResponse(empty),
  );
  assertEquals(blank.requests.length, 1);
});

Deno.test("SheX client uses fixed URL, POST JSON, x-api-key, AbortController and the production deadline", async () => {
  assertEquals(ATTEMPT_TIMEOUT_MS, 20_000);
  await client((input, init) => {
    const options = init as RequestInit;
    assertEquals(input, SHEX_URL);
    assertEquals(options.method, "POST");
    assertEquals(
      new Headers(options.headers).get("content-type"),
      "application/json",
    );
    assertEquals(
      new Headers(options.headers).get("x-api-key"),
      TEST_UPSTREAM_KEY,
    );
    assertEquals(new Headers(options.headers).get("authorization"), null);
    assertEquals(options.redirect, "manual");
    assert(options.signal instanceof AbortSignal);
    assertEquals(JSON.parse(options.body as string), {
      action: "resolve",
      ...empty,
    });
    return Promise.resolve(json(resolveResponse(empty)));
  }).resolve(empty);
});

Deno.test("SheX client retries exactly once after 1000 ms on 429 and 5xx", async () => {
  for (const status of [429, 500, 503, 599]) {
    for (const recover of [true, false]) {
      let calls = 0;
      const sleeps: number[] = [];
      const instance = client(() => {
        calls++;
        return Promise.resolve(
          calls === 2 && recover
            ? json(resolveResponse(empty))
            : json({ error: "synthetic" }, status),
        );
      }, sleeps);
      if (recover) await instance.resolve(empty);
      else {await assertRejects(
          () => instance.resolve(empty),
          UpstreamError,
          "upstream_failed",
        );}
      assertEquals(calls, 2);
      assertEquals(sleeps, [1000]);
    }
  }
});

Deno.test("SheX client retries network errors once and closes error text", async () => {
  for (const recover of [true, false]) {
    let calls = 0;
    const sleeps: number[] = [];
    const instance = client(() => {
      calls++;
      if (calls === 2 && recover) {
        return Promise.resolve(json(resolveResponse(empty)));
      }
      return Promise.reject(
        new Error(`synthetic@example.com ${MODEL_A} ${PROFILE_MARKER}`),
      );
    }, sleeps);
    if (recover) await instance.resolve(empty);
    else {assertEquals(
        (await assertRejects(() => instance.resolve(empty), UpstreamError))
          .message,
        "upstream_failed",
      );}
    assertEquals(calls, 2);
    assertEquals(sleeps, [1000]);
  }
});

Deno.test("SheX client aborts timed-out attempts and retries with a fresh signal", async () => {
  for (const recover of [true, false]) {
    let calls = 0;
    let aborts = 0;
    const sleeps: number[] = [];
    const signals: AbortSignal[] = [];
    const instance = client(
      (_input, init) => {
        calls++;
        const signal = (init as RequestInit).signal!;
        signals.push(signal);
        if (calls === 2 && recover) {
          return Promise.resolve(json(resolveResponse(empty)));
        }
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            aborts++;
            reject(new DOMException("synthetic timeout", "AbortError"));
          }, { once: true });
        });
      },
      sleeps,
      5,
    );
    if (recover) await instance.resolve(empty);
    else await assertRejects(() => instance.resolve(empty), UpstreamError);
    assertEquals(calls, 2);
    assertEquals(aborts, recover ? 1 : 2);
    assertEquals(sleeps, [1000]);
    assert(signals[0] !== signals[1]);
  }
});

Deno.test("SheX client deadline also bounds a stalled response body", async () => {
  let calls = 0;
  let cancelled = 0;
  const sleeps: number[] = [];
  const instance = client(
    () => {
      calls++;
      if (calls === 2) return Promise.resolve(json(resolveResponse(empty)));
      return Promise.resolve(
        new Response(
          new ReadableStream({
            cancel() {
              cancelled++;
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );
    },
    sleeps,
    5,
  );
  await instance.resolve(empty);
  assertEquals(calls, 2);
  assertEquals(cancelled, 1);
  assertEquals(sleeps, [1000]);
});

Deno.test("SheX client never retries 400/401 or other nonretryable HTTP statuses", async () => {
  for (const status of [201, 302, 400, 401, 403, 404]) {
    let calls = 0;
    const sleeps: number[] = [];
    const instance = client(() => {
      calls++;
      return Promise.resolve(json({ error: "synthetic" }, status));
    }, sleeps);
    await assertRejects(() => instance.resolve(empty), UpstreamError);
    assertEquals(calls, 1);
    assertEquals(sleeps, []);
  }
});

Deno.test("SheX client never retries malformed JSON, wrong content type or contract violations", async () => {
  for (
    const response of [
      new Response("invalid", {
        headers: { "content-type": "application/json" },
      }),
      new Response(JSON.stringify(resolveResponse(empty)), {
        headers: { "content-type": "text/plain" },
      }),
      new Response(JSON.stringify(resolveResponse(empty)), {
        headers: { "content-type": "application/json-extra" },
      }),
      json({ contract: "wrong", resolutions: [], profiles: [] }),
    ]
  ) {
    let calls = 0;
    const sleeps: number[] = [];
    await assertRejects(() =>
      client(() => {
        calls++;
        return Promise.resolve(response);
      }, sleeps).resolve(empty), UpstreamError);
    assertEquals(calls, 1);
    assertEquals(sleeps, []);
  }
});

Deno.test("SheX client rejects echo mismatches, missing model coverage and approved null profiles", async () => {
  const request: ResolveRequest = {
    identities: [{ platform: "4based", email: "synthetic@example.org" }],
    model_ids: [MODEL_A],
    include_profiles: true,
  };
  const bad = [
    resolveResponse(request),
    resolveResponse(request),
    resolveResponse(request),
    resolveResponse(request),
  ];
  bad[0].resolutions[0].email = "wrong@example.org";
  bad[1].resolutions[0].platform = "maloum";
  bad[2].profiles = [];
  bad[3].profiles[0].profile = null;
  for (const response of bad) {
    await assertRejects(
      () => client(() => Promise.resolve(json(response))).resolve(request),
      UpstreamError,
    );
  }
});

Deno.test("SheX client bounds actual body bytes without trusting Content-Length", async () => {
  for (
    const declaredLength of [undefined, "1", String(MAX_RESPONSE_BYTES + 1)]
  ) {
    let cancelled = 0;
    let calls = 0;
    let part = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (part++ === 0) {
          controller.enqueue(new Uint8Array(MAX_RESPONSE_BYTES));
        } else controller.enqueue(new Uint8Array(1));
      },
      cancel() {
        cancelled++;
      },
    });
    const headers = new Headers({ "content-type": "application/json" });
    if (declaredLength) headers.set("content-length", declaredLength);
    const sleeps: number[] = [];
    await assertRejects(() =>
      client(() => {
        calls++;
        return Promise.resolve(new Response(stream, { headers }));
      }, sleeps).resolve(empty), UpstreamError);
    assertEquals(calls, 1);
    assertEquals(cancelled, 1);
    assertEquals(sleeps, []);
  }
});

Deno.test("SheX client accepts a JSON body exactly at the byte limit", async () => {
  const body = JSON.stringify(resolveResponse(empty));
  const response = new Response(
    " ".repeat(MAX_RESPONSE_BYTES - body.length) + body,
    { headers: { "content-type": "application/json" } },
  );
  assertEquals(
    await client(() => Promise.resolve(response)).resolve(empty),
    resolveResponse(empty),
  );
});

Deno.test("SheX client listModels validates the action and returns no profile contents", async () => {
  const models = [shexModel()];
  const fake = fakeShex(() => ({}), [], models);
  assertEquals(await client(fake.fetchImpl).listModels(), models);
  assertEquals(fake.requests, [{ action: "list_models" }]);
});

Deno.test("SheX client rejects inconsistent repeated models across chunks", async () => {
  const request = {
    ...empty,
    identities: Array.from(
      { length: 1001 },
      (_, i) => ({ platform: "4based", email: `test-${i}@example.org` }),
    ),
  };
  let calls = 0;
  await assertRejects(() =>
    client((_url, init) => {
      const result = resolveResponse(
        JSON.parse((init as RequestInit).body as string),
        () => ({ same: [MODEL_A] }),
      );
      result.profiles[0].profile = {
        name: ++calls === 1 ? "Fabelstern" : "Mondfunke",
      };
      return Promise.resolve(json(result));
    }).resolve(request), UpstreamError);
  assertEquals(calls, 2);
});
