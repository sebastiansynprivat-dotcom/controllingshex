import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  ACCOUNT_FIELDS,
  validateExportEnvelope,
  validateModelsResponse,
  validateResolveResponse,
} from "./contracts.ts";
import { PROFILE_KEYS } from "./core.ts";
import { UpstreamError } from "./errors.ts";
import fixture from "./fixtures/export-example.json" with { type: "json" };
import {
  MODEL_A,
  MODEL_B,
  resolveResponse,
  shexModel,
  shexProfile,
} from "./test-helpers.ts";
import type { ResolveRequest } from "./types.ts";

const request: ResolveRequest = {
  identities: [{ platform: " 4Based ", email: " FABEL@EXAMPLE.COM " }],
  model_ids: [MODEL_B.toUpperCase()],
  include_profiles: true,
};
const goodResolve = () => resolveResponse(request, () => ({ same: [MODEL_A] }));

Deno.test("invented fixture passes the strict envelope validator and covers required rows", () => {
  const result = validateExportEnvelope(fixture);
  assertEquals(result.summary, {
    accounts: 7,
    approved: 3,
    not_approved: 1,
    missing: 3,
    excluded_rows: 0,
  });
  assertEquals(
    result.accounts.map((row) => Object.keys(row)),
    result.accounts.map(() => [...ACCOUNT_FIELDS]),
  );
  assertEquals(
    Object.keys(
      result.accounts.find((row) =>
        row.status === "approved" && row.assignment_source === "controlling"
      )!.profile!,
    ),
    [...PROFILE_KEYS],
  );
  assertEquals(
    new Set(result.accounts.map((row) => row.status_reason)),
    new Set([
      "approved",
      "awaiting_approval",
      "no_assignment",
      "no_login",
      "blocked",
    ]),
  );
});

Deno.test("export validator rejects extra or absent fields, invalid metadata and inconsistent summaries", () => {
  const mutations: ((value: Record<string, unknown>) => void)[] = [
    (v) => {
      v.foreign = true;
    },
    (v) => {
      v.contract = "wrong";
    },
    (v) => {
      v.generated_at = "2026-09-24T20:00:00+02:00";
    },
    (v) => {
      (v.summary as Record<string, unknown>).accounts = 8;
    },
    (v) => {
      (v.summary as Record<string, unknown>).approved = 4;
    },
    (v) => {
      (v.summary as Record<string, unknown>).excluded_rows = -1;
    },
    (v) => {
      delete v.accounts;
    },
  ];
  for (const mutate of mutations) {
    const value = structuredClone(fixture) as Record<string, unknown>;
    mutate(value);
    assertThrows(
      () => validateExportEnvelope(value),
      Error,
      "invalid_export_envelope",
    );
  }
});

Deno.test("export validator rejects incomplete rows, foreign profiles and invalid status relationships", () => {
  const mutations: ((row: Record<string, unknown>) => void)[] = [
    (r) => {
      delete r.confirmed_at;
    },
    (r) => {
      r.foreign = true;
    },
    (r) => {
      r.id = "invalid";
    },
    (r) => {
      r.email = " UPPER@EXAMPLE.COM ";
    },
    (r) => {
      r.platform = "Unknown";
    },
    (r) => {
      r.status_reason = "awaiting_approval";
    },
    (r) => {
      r.external_model_id = null;
    },
    (r) => {
      r.assignment_source = null;
    },
    (r) => {
      r.profile = null;
    },
    (r) => {
      r.profile = [];
    },
    (r) => {
      r.profile = { foreign: true };
    },
    (r) => {
      r.confirmed_at = "invalid";
    },
    (r) => {
      r.assignment_source = "shex_account";
    },
  ];
  for (const mutate of mutations) {
    const value = structuredClone(fixture);
    mutate(value.accounts[0]);
    assertThrows(
      () => validateExportEnvelope(value),
      Error,
      "invalid_export_envelope",
    );
  }
  const duplicate = structuredClone(fixture);
  duplicate.accounts[1].id = duplicate.accounts[0].id;
  assertThrows(() => validateExportEnvelope(duplicate));
});

Deno.test("upstream validator checks normalized echoes and exact profile coverage", () => {
  assertEquals(validateResolveResponse(goodResolve(), request), goodResolve());
  const bad = [goodResolve(), goodResolve(), goodResolve(), goodResolve()];
  bad[0].resolutions[0].email = "wrong@example.org";
  bad[1].resolutions[0].platform = "maloum";
  bad[2].profiles.pop();
  bad[3].profiles.push(shexProfile(MODEL_B));
  for (const value of bad) {
    assertThrows(() => validateResolveResponse(value, request), UpstreamError);
  }
  const missingResolutionProfile = goodResolve();
  missingResolutionProfile.profiles.shift();
  assertThrows(
    () => validateResolveResponse(missingResolutionProfile, request),
    UpstreamError,
  );
});

Deno.test("upstream validator rejects extra fields, invalid shapes, unsorted IDs and inconsistent approval", () => {
  const bad = [
    goodResolve(),
    goodResolve(),
    goodResolve(),
    goodResolve(),
    goodResolve(),
    goodResolve(),
    goodResolve(),
    goodResolve(),
    goodResolve(),
  ];
  Object.assign(bad[0], { foreign: true });
  Object.assign(bad[1].profiles[0], { foreign: true });
  bad[2].profiles[0].model_exists = false;
  bad[3].profiles[0].profile = null;
  bad[4].profiles.reverse();
  bad[5].resolutions[0].same_platform_model_ids = [MODEL_B, MODEL_A];
  bad[6].profiles[0].profile_status = "not_approved";
  bad[7].profiles[0].updated_at = "2026-09-24T18:00:00Z";
  Object.assign(bad[8].profiles[0].profile!, { foreign: true });
  for (const value of bad) {
    assertThrows(() => validateResolveResponse(value, request), UpstreamError);
  }
  assertThrows(
    () =>
      validateResolveResponse(goodResolve(), {
        ...request,
        include_profiles: false,
      }),
    UpstreamError,
  );
});

Deno.test("upstream allows an empty projected approved profile and null nonapproved metadata", () => {
  const response = goodResolve();
  response.profiles[0].profile = {};
  response.profiles[1] = shexProfile(MODEL_B, "none", { model_exists: false });
  assertEquals(validateResolveResponse(response, request), response);
});

Deno.test("list_models validator enforces complete unique rows but accepts any order", () => {
  const good = {
    contract: "controlling-model-profiles.v1",
    models: [
      shexModel(MODEL_A, { name: "Ätherfabel", username: null }),
      shexModel(MODEL_B, { name: "Zirbelfunke" }),
    ],
  };
  assertEquals(validateModelsResponse(good), good);
  const reversed = { ...good, models: [...good.models].reverse() };
  assertEquals(validateModelsResponse(reversed), reversed);
  assertThrows(
    () =>
      validateModelsResponse({
        ...good,
        models: [good.models[0], good.models[0]],
      }),
    UpstreamError,
  );
  assertThrows(
    () =>
      validateModelsResponse({
        ...good,
        models: [{ ...good.models[0], profile: {} }],
      }),
    UpstreamError,
  );
  assertThrows(
    () =>
      validateModelsResponse({
        ...good,
        models: [{ ...good.models[0], model_active: "true" }],
      }),
    UpstreamError,
  );
});
