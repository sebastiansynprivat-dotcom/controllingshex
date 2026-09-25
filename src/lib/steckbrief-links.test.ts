import { beforeEach, describe, expect, it, vi } from "vitest";
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";
import {
  conflictWithShex, countWithoutApproved, describeSource, describeStatus,
  fetchSteckbriefOverview, formatSteckbriefDate, identityKey, normalizeLogin,
  removeOverride, saveAssignment, saveBlock,
  type ShexModelEntry, type SteckbriefIdentity, type SteckbriefOverview, type SteckbriefOverride,
} from "./steckbrief-links";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(), from: vi.fn(), upsert: vi.fn(), delete: vi.fn(), eq: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: mocks.invoke }, from: mocks.from },
}));

const model: ShexModelEntry = {
  model_id: "10000000-0000-4000-8000-000000000001",
  name: "Testmodell Nord",
  username: "testmodell_nord",
  model_active: true,
  profile_status: "approved",
};
const otherModelId = "10000000-0000-4000-8000-000000000002";
const modelsById = new Map([[model.model_id, model]]);
const override: SteckbriefOverride = {
  mode: "assign",
  external_model_id: model.model_id,
  external_model_name: model.name,
  updated_at: "2026-09-24T16:05:12.000Z",
};

function identity(patch: Partial<SteckbriefIdentity> = {}): SteckbriefIdentity {
  return {
    platform: "4Based",
    email: "nord@example.com",
    status: "missing",
    status_reason: "no_assignment",
    external_model_id: null,
    assignment_source: null,
    assignment_updated_at: null,
    confirmed_at: null,
    override: null,
    shex_model_ids: [],
    ...patch,
  };
}

const overview: SteckbriefOverview = {
  contract: "steckbrief-links.overview.v1",
  generated_at: "2026-09-24T18:00:00.000Z",
  excluded_rows: 0,
  models: [model],
  identities: [identity()],
  orphan_overrides: [{ platform: "Maloum", email: "archiv@example.com", ...override }],
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.from.mockReturnValue({ upsert: mocks.upsert, delete: mocks.delete });
  mocks.upsert.mockResolvedValue({ error: null });
  mocks.delete.mockReturnValue({ eq: mocks.eq });
  mocks.eq.mockReturnValueOnce({ eq: mocks.eq }).mockResolvedValue({ error: null });
});

describe("normalizeLogin", () => {
  it.each([
    ["  NORD@EXAMPLE.COM\t\n", "nord@example.com"],
    ["\uFEFF\u00A0NORD@EXAMPLE.COM\u2029", "nord@example.com"],
    [" Test_Nord ", "test_nord"],
    [" A+B_%@EXAMPLE.COM ", "a+b_%@example.com"],
    [" ÄÖÜẞİ ", "äöüßi\u0307"],
    ["\u0085NORD\u0085", "\u0085nord\u0085"],
    [" TEST LOGIN ", "test login"],
    ["", null],
    [" \t\r\n\uFEFF\u00A0", null],
    [null, null],
    [undefined, null],
    [42, null],
    [false, null],
    [{ email: "nord@example.com" }, null],
    [["nord@example.com"], null],
  ])("normalizes %j to %j", (input, expected) => {
    expect(normalizeLogin(input)).toBe(expected);
  });
});

describe("identityKey", () => {
  it("normalizes only the login and preserves the stored platform label", () => {
    const key = identityKey("4Based", "nord@example.com");
    expect(identityKey("4Based", " NORD@EXAMPLE.COM ")).toBe(key);
    expect(identityKey("4based", "nord@example.com")).not.toBe(key);
    expect(identityKey(" 4Based ", "nord@example.com")).not.toBe(key);
    expect(identityKey("Maloum", "nord@example.com")).not.toBe(key);
  });

  it("handles empty logins consistently", () => {
    expect(identityKey("4Based", undefined)).toBe(identityKey("4Based", null));
    expect(identityKey("4Based", "  ")).toBe(identityKey("4Based", null));
    expect(identityKey("4Based", "null")).not.toBe(identityKey("4Based", null));
  });

  it("does not collide when tuple values contain separators", () => {
    expect(identityKey("4Based|a", "b@example.com"))
      .not.toBe(identityKey("4Based", "a|b@example.com"));
  });
});

describe("describeStatus", () => {
  it.each([
    ["approved", "approved", "ok", "Steckbrief freigegeben", "Testmodell Nord · 20.09.2026"],
    ["not_approved", "no_profile", "warn", "Kein Steckbrief in SheX", "Testmodell Nord"],
    ["not_approved", "awaiting_approval", "warn", "Wartet auf Freigabe", "Testmodell Nord"],
    ["not_approved", "profile_unusable", "warn", "Steckbrief fehlerhaft", "Testmodell Nord"],
    ["missing", "no_login", "muted", "Keine Login-Mail", ""],
    ["missing", "blocked", "muted", "Kein Steckbrief (gesperrt)", ""],
    ["missing", "no_assignment", "bad", "Kein Steckbrief zugeordnet", ""],
    ["missing", "ambiguous", "bad", "Mehrere Models möglich", ""],
    ["missing", "model_not_found", "bad", "Zugeordnetes Model fehlt in SheX", ""],
  ] as const)("describes %s / %s", (status, reason, tone, label, detail) => {
    expect(describeStatus(identity({
      status,
      status_reason: reason,
      external_model_id: status === "missing" ? null : model.model_id,
      confirmed_at: status === "approved" ? "2026-09-20T10:15:00.000Z" : null,
    }), modelsById)).toEqual({ tone, label, detail });
  });

  it("uses the current SheX name before the override's display cache", () => {
    expect(describeStatus(identity({
      status: "not_approved", status_reason: "awaiting_approval", external_model_id: model.model_id,
      override: { ...override, external_model_name: "Testmodell Archiv" },
    }), modelsById).detail).toBe("Testmodell Nord");
  });

  it("retains the cached name for a deleted assigned model", () => {
    expect(describeStatus(identity({ status_reason: "model_not_found", override }), new Map())).toEqual({
      tone: "bad", label: "Zugeordnetes Model fehlt in SheX", detail: "Testmodell Nord",
    });
  });

  it.each([undefined, null])("handles a missing overview identity (%s)", (entry) => {
    expect(describeStatus(entry, modelsById)).toEqual({
      tone: "bad", label: "Kein Steckbrief zugeordnet", detail: "",
    });
  });

  it("formats the approval date with leading zeroes and without a timezone shift", () => {
    expect(describeStatus(identity({
      status: "approved", status_reason: "approved", external_model_id: model.model_id,
      confirmed_at: "2026-01-02T23:59:00.000Z",
    }), modelsById).detail).toBe("Testmodell Nord · 02.01.2026");
  });
});

describe("formatSteckbriefDate", () => {
  it.each([null, "", "invalid"])('does not display an invalid date for "%s"', (timestamp) => {
    expect(formatSteckbriefDate(timestamp)).toBe("");
  });
});

describe("describeSource", () => {
  it.each([
    ["controlling", "im Controlling zugeordnet"],
    ["shex_account", "über SheX-Konto"],
    ["same_login", "über gleiche Login-Mail"],
    [null, ""],
  ] as const)("describes %s", (source, label) => {
    expect(describeSource(source)).toBe(label);
  });
});

describe("conflictWithShex", () => {
  it("flags an assigned override outside the SheX candidates", () => {
    expect(conflictWithShex(identity({ override, shex_model_ids: [otherModelId] }))).toBe(true);
  });

  it("does not flag an override matching any SheX candidate", () => {
    expect(conflictWithShex(identity({ override, shex_model_ids: [otherModelId, model.model_id] }))).toBe(false);
  });

  it("does not flag an assignment when SheX has no same-platform candidates", () => {
    expect(conflictWithShex(identity({ override }))).toBe(false);
  });

  it("does not flag a block or an automatic assignment", () => {
    expect(conflictWithShex(identity({
      override: { ...override, mode: "block", external_model_id: null, external_model_name: null },
      shex_model_ids: [otherModelId],
    }))).toBe(false);
    expect(conflictWithShex(identity({ shex_model_ids: [otherModelId] }))).toBe(false);
  });

  it.each([null, undefined])("handles an absent identity (%s)", (entry) => {
    expect(conflictWithShex(entry)).toBe(false);
  });
});

describe("countWithoutApproved", () => {
  const approved = identity({ status: "approved", status_reason: "approved", external_model_id: model.model_id });
  const waiting = identity({
    email: "sued@example.com", status: "not_approved", status_reason: "awaiting_approval", external_model_id: otherModelId,
  });
  const identities = new Map([
    [identityKey(approved.platform, approved.email), approved],
    [identityKey(waiting.platform, waiting.email), waiting],
  ]);

  it("counts rows, including duplicate identities and rows without login mail", () => {
    const rows = [
      { platform: "4Based", email: " NORD@EXAMPLE.COM " },
      { platform: "4Based", email: "nord@example.com" },
      { platform: "4Based", email: "sued@example.com" },
      { platform: "4Based", email: " SUED@EXAMPLE.COM " },
      { platform: "4Based", email: "unlisted@example.com" },
      { platform: "Maloum", email: "nord@example.com" },
      { platform: "4Based", email: null },
      { platform: "4Based", email: " \t " },
      { platform: "4Based" },
    ];
    expect(countWithoutApproved(rows, identities)).toBe(7);
    expect(countWithoutApproved(rows.filter((row) => row.platform === "Maloum"), identities)).toBe(1);
  });

  it("counts known missing identities and all rows when the map is empty", () => {
    const missing = identity({ status_reason: "blocked" });
    expect(countWithoutApproved([missing, missing], new Map([[identityKey(missing.platform, missing.email), missing]]))).toBe(2);
    expect(countWithoutApproved([approved, waiting], new Map())).toBe(2);
  });

  it("never approves a row without a login, even if a null key exists", () => {
    expect(countWithoutApproved([{ platform: "4Based" }], new Map([[identityKey("4Based", null), approved]]))).toBe(1);
  });

  it("returns zero for no rows or exclusively approved duplicates", () => {
    expect(countWithoutApproved([], identities)).toBe(0);
    expect(countWithoutApproved([approved, approved], identities)).toBe(0);
  });
});

describe("fetchSteckbriefOverview", () => {
  it("invokes the overview action and returns the documented response", async () => {
    mocks.invoke.mockResolvedValue({ data: overview, error: null });
    await expect(fetchSteckbriefOverview()).resolves.toEqual({ state: "ready", overview });
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("steckbrief-links", { body: { action: "overview" } });
  });

  it.each([
    [401, "forbidden"], [403, "forbidden"], [503, "not_configured"], [404, "not_configured"], [502, "upstream"],
    [400, "error"], [405, "error"], [429, "error"], [500, "error"], [504, "error"],
  ] as const)("maps HTTP %i from FunctionsHttpError.context to %s", async (status, state) => {
    const response = new Response(JSON.stringify({ error: "synthetic nord@example.com" }), { status });
    const error = Object.assign(new FunctionsHttpError(response), { status: 418 });
    mocks.invoke.mockResolvedValue({ data: overview, error });
    await expect(fetchSteckbriefOverview()).resolves.toEqual({ state });
    expect(response.bodyUsed).toBe(false);
  });

  it("also maps a rejected FunctionsHttpError", async () => {
    mocks.invoke.mockRejectedValue(new FunctionsHttpError(new Response(null, { status: 503 })));
    await expect(fetchSteckbriefOverview()).resolves.toEqual({ state: "not_configured" });
  });

  it.each([
    new FunctionsFetchError(new Error("synthetic network failure")),
    new FunctionsRelayError(new Response(null, { status: 503 })),
    new FunctionsHttpError(undefined),
    new Error("503 not_configured synthetic nord@example.com"),
    { status: 403, message: "synthetic nord@example.com" },
  ])("closes unknown failures without exposing error data (%#)", async (error) => {
    mocks.invoke.mockResolvedValue({ data: null, error });
    await expect(fetchSteckbriefOverview()).resolves.toEqual({ state: "error" });
  });

  it("never throws a network rejection", async () => {
    mocks.invoke.mockRejectedValue(new Error("synthetic nord@example.com"));
    await expect(fetchSteckbriefOverview()).resolves.toEqual({ state: "error" });
  });

  it.each([
    null, undefined, {}, { error: "synthetic failure" },
    { ...overview, contract: "unknown.v2" },
    { ...overview, models: null },
    { ...overview, identities: {} },
    { ...overview, orphan_overrides: null },
  ])("rejects an absent or incompatible overview envelope (%#)", async (data) => {
    mocks.invoke.mockResolvedValue({ data, error: null });
    await expect(fetchSteckbriefOverview()).resolves.toEqual({ state: "error" });
  });
});

describe("override writes", () => {
  it("upserts an assignment with normalized login and the stored platform label", async () => {
    await expect(saveAssignment("4Based", " NORD@EXAMPLE.COM ", model)).resolves.toEqual({ ok: true });
    expect(mocks.from).toHaveBeenCalledExactlyOnceWith("model_steckbrief_links");
    expect(mocks.upsert).toHaveBeenCalledExactlyOnceWith({
      platform: "4Based", email_normalized: "nord@example.com", mode: "assign",
      external_model_id: model.model_id, external_model_name: model.name,
    }, { onConflict: "platform,email_normalized" });
  });

  it("clears both model fields when blocking", async () => {
    await expect(saveBlock("Brezzels", " TEST_LOGIN ")).resolves.toEqual({ ok: true });
    expect(mocks.from).toHaveBeenCalledExactlyOnceWith("model_steckbrief_links");
    expect(mocks.upsert).toHaveBeenCalledExactlyOnceWith({
      platform: "Brezzels", email_normalized: "test_login", mode: "block",
      external_model_id: null, external_model_name: null,
    }, { onConflict: "platform,email_normalized" });
  });

  it("deletes only the matching platform and normalized email with literal equality", async () => {
    await expect(removeOverride("Maloum", " A_%@EXAMPLE.COM ")).resolves.toEqual({ ok: true });
    expect(mocks.from).toHaveBeenCalledExactlyOnceWith("model_steckbrief_links");
    expect(mocks.delete).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.eq.mock.calls).toEqual([["platform", "Maloum"], ["email_normalized", "a_%@example.com"]]);
  });

  const actions = [
    ["assignment", (email: unknown) => saveAssignment("4Based", email, model)],
    ["block", (email: unknown) => saveBlock("4Based", email)],
    ["removal", (email: unknown) => removeOverride("4Based", email)],
  ] as const;

  it.each(actions)("rejects missing logins before %s writes", async (_name, action) => {
    for (const email of [null, undefined, "", " \t ", 42]) {
      await expect(action(email)).resolves.toEqual({ ok: false });
    }
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it.each(actions)("returns only ok:false for a failed %s", async (_name, action) => {
    const error = { message: "synthetic nord@example.com", code: "42501" };
    mocks.upsert.mockResolvedValue({ error });
    mocks.eq.mockReset().mockReturnValueOnce({ eq: mocks.eq }).mockResolvedValue({ error });
    await expect(action("nord@example.com")).resolves.toEqual({ ok: false });
  });

  it.each(actions)("does not throw when %s rejects", async (_name, action) => {
    const error = new Error("synthetic network failure");
    mocks.upsert.mockRejectedValue(error);
    mocks.eq.mockReset().mockReturnValueOnce({ eq: mocks.eq }).mockRejectedValue(error);
    await expect(action("nord@example.com")).resolves.toEqual({ ok: false });
  });

  it.each(actions)("does not throw when the %s query cannot be constructed", async (_name, action) => {
    mocks.from.mockImplementation(() => { throw new Error("synthetic client failure"); });
    await expect(action("nord@example.com")).resolves.toEqual({ ok: false });
  });
});
