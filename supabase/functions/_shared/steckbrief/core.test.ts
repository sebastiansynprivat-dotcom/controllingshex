import { assert, assertEquals, assertStrictEquals } from "jsr:@std/assert@1";
import {
  isUuid,
  normalizeLogin,
  platformKey,
  PROFILE_KEYS,
  projectProfile,
  toTimestamp,
} from "./core.ts";
import { constantTimeSecretEqual } from "./http.ts";

Deno.test("normalizeLogin uses literal JavaScript trim and lowercase, including usernames", () => {
  for (const value of [null, undefined, 12, true, {}, [], "", " \t\n"]) {
    assertEquals(normalizeLogin(value), null);
  }
  assertEquals(normalizeLogin(" \tKONTO@EXAMPLE.COM\n"), "konto@example.com");
  assertEquals(normalizeLogin("\u00a0FABEL_USER_%\ufeff"), "fabel_user_%");
  assertEquals(normalizeLogin("İ"), "İ".toLowerCase());
});

Deno.test("platformKey follows the specified character removal", () => {
  assertEquals(
    ["4Based", " Maloum ", "Brezzels", "4-B_a.s!e d", "Ä-4"].map(platformKey),
    ["4based", "maloum", "brezzels", "4based", "4"],
  );
});

Deno.test("projectProfile uses exactly 34 ordered own keys and preserves every value", () => {
  assertEquals(PROFILE_KEYS, [
    "name",
    "age",
    "city",
    "occupation",
    "hobbies",
    "languages",
    "personality",
    "content_preferences",
    "no_gos",
    "place_of_birth",
    "favorite_color",
    "favorite_food",
    "favorite_movie",
    "favorite_music",
    "dream",
    "education",
    "work",
    "special_marks",
    "natural_hair",
    "shoe_size",
    "bra_size",
    "height",
    "weight",
    "content_anal_fingering",
    "content_anal_penetration",
    "content_anal_plug",
    "content_audios_for_chat",
    "content_dick_ratings",
    "content_joi",
    "content_moaning_name",
    "content_orgasm",
    "content_roleplay_costumes",
    "content_squirting",
    "content_video_speaking",
  ]);
  assertEquals(PROFILE_KEYS.length, 34);
  const hobbies = ["Wolkensammeln", false, { synthetic: true }];
  const snapshot = Object.assign(Object.create({ city: "Erfundener Ort" }), {
    foreign: "drop",
    content_joi: false,
    hobbies,
    age: null,
    name: "Fabelstern",
  });
  const projected = projectProfile(snapshot);
  assertEquals(Object.keys(projected), [
    "name",
    "age",
    "hobbies",
    "content_joi",
  ]);
  assertEquals(projected, {
    name: "Fabelstern",
    age: null,
    hobbies,
    content_joi: false,
  });
  assertStrictEquals(projected.hobbies, hobbies);
  assert(projected !== snapshot);
  assertEquals(projectProfile(null), {});
  assertEquals(projectProfile([]), {});
  assertEquals(
    Object.keys(
      projectProfile(
        Object.fromEntries(
          [...PROFILE_KEYS].reverse().map((key) => [key, true]),
        ),
      ),
    ),
    [...PROFILE_KEYS],
  );
});

Deno.test("UUID check and timestamps reject invalid values and normalize UTC", () => {
  assert(isUuid("B7A091E4-65B2-4F01-8A32-000000000001"));
  for (
    const value of [
      null,
      "",
      "b7a091e4",
      "b7a091e4-65b2-4f01-8a32-00000000000z",
    ]
  ) assert(!isUuid(value));
  assertEquals(
    toTimestamp("2026-09-24T20:00:00+02:00"),
    "2026-09-24T18:00:00.000Z",
  );
  assertEquals(toTimestamp(null), null);
  assertEquals(toTimestamp("invalid"), null);
});

Deno.test("secret comparison checks SHA-256 digests for equal and different inputs", async () => {
  assert(await constantTimeSecretEqual("synthetic-key", "synthetic-key"));
  assert(!await constantTimeSecretEqual("synthetic-key", "synthetic-kez"));
  assert(
    !await constantTimeSecretEqual("synthetic-key", "longer-synthetic-key"),
  );
  assert(!await constantTimeSecretEqual("", "synthetic-key"));
});
