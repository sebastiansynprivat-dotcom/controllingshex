import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { normalizeLogin, platformKey } from "./core.ts";
import { UpstreamError } from "./errors.ts";
import { resolveAccounts } from "./resolution.ts";
import {
  FIXED_NOW,
  link,
  model,
  MODEL_A,
  MODEL_B,
  resolveResponse,
  shexProfile,
} from "./test-helpers.ts";
import type { Match } from "./test-helpers.ts";
import type {
  LinkRow,
  ModelRow,
  ProfileStatus,
  ResolveRequest,
  ShexProfile,
} from "./types.ts";

function scenario(
  models: ModelRow[],
  links: LinkRow[] = [],
  match: Match = () => ({}),
  profiles: ShexProfile[] = [],
  includeProfiles = true,
) {
  const request: ResolveRequest = {
    identities: models.flatMap((row) => {
      const email = normalizeLogin(row.email);
      return email === null
        ? []
        : [{ platform: platformKey(row.platform), email }];
    }),
    model_ids: links.flatMap((row) =>
      row.external_model_id ? [row.external_model_id] : []
    ),
    include_profiles: includeProfiles,
  };
  return resolveAccounts(
    models,
    links,
    resolveResponse(request, match, profiles),
    includeProfiles,
  );
}

Deno.test("resolution: controlling assignment beats even ambiguous SheX accounts", () => {
  const [result] = scenario([model(1)], [
    link(1, { updated_at: "2026-09-24T20:00:00+02:00" }),
  ], () => ({ same: [MODEL_A, MODEL_B] }));
  assertEquals(result.assignment_source, "controlling");
  assertEquals(result.external_model_id, MODEL_A);
  assertEquals(result.assignment_updated_at, FIXED_NOW);
  assertEquals(result.status, "approved");
});

Deno.test("resolution: explicit block beats a SheX match", () => {
  const [result] = scenario([model(1)], [
    link(1, { mode: "block", external_model_id: null }),
  ], () => ({ same: [MODEL_A] }));
  assertEquals(result, {
    id: model(1).id,
    platform: "4Based",
    email: "konto-1@example.com",
    status: "missing",
    status_reason: "blocked",
    external_model_id: null,
    assignment_source: "controlling",
    assignment_updated_at: FIXED_NOW,
    confirmed_at: null,
    source_updated_at: null,
    profile: null,
  });
});

Deno.test("resolution: one SheX account assigns; multiple same-platform accounts remain ambiguous", () => {
  const [single] = scenario(
    [model(1)],
    [],
    () => ({ same: [MODEL_A], other: [MODEL_B] }),
  );
  assertEquals(single.assignment_source, "shex_account");
  assertEquals(single.external_model_id, MODEL_A);
  assertEquals(single.assignment_updated_at, null);
  const [ambiguous] = scenario(
    [model(1)],
    [],
    () => ({ same: [MODEL_A, MODEL_B] }),
  );
  assertEquals(ambiguous.status_reason, "ambiguous");
  assertEquals(ambiguous.assignment_source, null);
});

Deno.test("resolution: same login uses upstream other-platform candidates", () => {
  const [result] = scenario([model(1)], [], () => ({ other: [MODEL_A] }));
  assertEquals(result.assignment_source, "same_login");
  assertEquals(result.external_model_id, MODEL_A);
});

Deno.test("resolution: same login uses a controlling sibling assignment or direct SheX sibling", () => {
  const models = [
    model(1),
    model(2, { platform: "Maloum", email: " KONTO-1@EXAMPLE.COM " }),
  ];
  const [fromOverride] = scenario(models, [link(1, { platform: "Maloum" })]);
  assertEquals(fromOverride.assignment_source, "same_login");
  assertEquals(fromOverride.external_model_id, MODEL_A);
  const [fromShex] = scenario(
    models,
    [],
    (identity) => identity.platform === "maloum" ? { same: [MODEL_A] } : {},
  );
  assertEquals(fromShex.assignment_source, "same_login");
  assertEquals(fromShex.external_model_id, MODEL_A);
});

Deno.test("resolution: same login deduplicates one candidate and rejects conflicts", () => {
  const models = [
    model(1),
    model(2, { platform: "Maloum", email: model(1).email }),
  ];
  const [same] = scenario(
    models,
    [link(1, { platform: "Maloum" })],
    () => ({ other: [MODEL_A] }),
  );
  assertEquals(same.assignment_source, "same_login");
  const [conflict] = scenario(
    models,
    [link(1, { platform: "Maloum" })],
    () => ({ other: [MODEL_B] }),
  );
  assertEquals(conflict.status_reason, "ambiguous");
  assertEquals(conflict.assignment_source, null);
  assertEquals(conflict.external_model_id, null);
});

Deno.test("resolution: same-login results never propagate, regardless of row order", () => {
  const models = [
    model(1, { platform: "Maloum" }),
    model(2, { email: model(1).email }),
  ];
  for (const order of [models, [...models].reverse()]) {
    const results = scenario(
      order,
      [],
      (identity) => identity.platform === "maloum" ? { other: [MODEL_A] } : {},
    );
    assertEquals(
      results.find((row) => row.platform === "Maloum")?.assignment_source,
      "same_login",
    );
    assertEquals(
      results.find((row) => row.platform === "4Based")?.status_reason,
      "no_assignment",
    );
  }
});

Deno.test("resolution: blocked and ambiguous siblings contribute no model", () => {
  const models = [
    model(1),
    model(2, { platform: "Maloum", email: model(1).email }),
  ];
  const [blocked] = scenario(models, [
    link(1, { platform: "Maloum", mode: "block", external_model_id: null }),
  ], (identity) => identity.platform === "maloum" ? { same: [MODEL_A] } : {});
  assertEquals(blocked.status_reason, "no_assignment");
  const [ambiguous] = scenario(
    models,
    [],
    (identity) =>
      identity.platform === "maloum" ? { same: [MODEL_A, MODEL_B] } : {},
  );
  assertEquals(ambiguous.status_reason, "no_assignment");
});

Deno.test("resolution: a sibling block does not veto independent upstream other-platform IDs", () => {
  const [result] = scenario(
    [model(1), model(2, { platform: "Maloum", email: model(1).email })],
    [link(1, { platform: "Maloum", mode: "block", external_model_id: null })],
    () => ({ other: [MODEL_A] }),
  );
  assertEquals(result.assignment_source, "same_login");
});

Deno.test("resolution: null or blank email means no_login; no candidate means no_assignment", () => {
  const results = scenario([
    model(1, { email: null }),
    model(2, { email: " \t" }),
    model(3),
  ]);
  assertEquals(results.map((row) => row.status_reason), [
    "no_login",
    "no_login",
    "no_assignment",
  ]);
  assertEquals(results.map((row) => row.assignment_source), [null, null, null]);
});

Deno.test("resolution: missing upstream model preserves assignment source and controlling timestamp", () => {
  const missing = shexProfile(MODEL_A, "none", { model_exists: false });
  const [result] = scenario([model(1)], [link(1)], () => ({}), [missing]);
  assertEquals(result.status_reason, "model_not_found");
  assertEquals(result.external_model_id, null);
  assertEquals(result.assignment_source, "controlling");
  assertEquals(result.assignment_updated_at, FIXED_NOW);
  const [direct] = scenario([model(1)], [], () => ({ same: [MODEL_A] }), [
    missing,
  ]);
  assertEquals(direct.assignment_source, "shex_account");
  assertEquals(direct.external_model_id, null);
});

Deno.test("resolution: profile status matrix and projection are exact", () => {
  const cases: [ProfileStatus, string, string][] = [
    ["none", "not_approved", "no_profile"],
    ["not_approved", "not_approved", "awaiting_approval"],
    ["unusable", "not_approved", "profile_unusable"],
    ["approved", "approved", "approved"],
  ];
  for (const [profileStatus, status, reason] of cases) {
    const source = shexProfile(MODEL_A, profileStatus);
    if (source.profile) {
      source.profile = Object.assign({ foreign: "removed" }, source.profile);
    }
    const [result] = scenario([model(1)], [], () => ({ same: [MODEL_A] }), [
      source,
    ]);
    assertEquals(result.status, status);
    assertEquals(result.status_reason, reason);
    assertEquals(result.external_model_id, MODEL_A);
    assertEquals(
      result.profile,
      profileStatus === "approved" ? shexProfile().profile : null,
    );
    assertEquals(
      result.confirmed_at,
      profileStatus === "approved" ? FIXED_NOW : null,
    );
    assertEquals(
      result.source_updated_at,
      profileStatus === "approved" ? FIXED_NOW : null,
    );
  }
});

Deno.test("resolution: duplicate identities share all fields except their row IDs", () => {
  const [a, b] = scenario([
    model(1),
    model(2, { email: " KONTO-1@EXAMPLE.COM " }),
  ], [link(1)]);
  assertEquals({ ...a, id: b.id }, b);
});

Deno.test("resolution: username login without @ uses the same matching rules", () => {
  const [a, b] = scenario([
    model(1, { email: " FABEL_USER " }),
    model(2, { platform: "Maloum", email: "fabel_user" }),
  ], [link(1, { platform: "Maloum", email_normalized: "fabel_user" })]);
  assertEquals(a.email, "fabel_user");
  assertEquals(a.assignment_source, "same_login");
  assertEquals(a.external_model_id, b.external_model_id);
});

Deno.test("resolution: missing profile entry or null approved export profile is an upstream failure", () => {
  const models = [model(1)];
  const upstream = resolveResponse({
    identities: [{ platform: "4based", email: "konto-1@example.com" }],
    model_ids: [],
    include_profiles: true,
  }, () => ({ same: [MODEL_A] }));
  assertThrows(
    () => resolveAccounts(models, [], { ...upstream, profiles: [] }),
    UpstreamError,
  );
  upstream.profiles[0].profile = null;
  assertThrows(() => resolveAccounts(models, [], upstream), UpstreamError);
  assertEquals(
    resolveAccounts(models, [], upstream, false)[0].status,
    "approved",
  );
});
