export const PROFILE_KEYS = [
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
] as const;

export type Profile = Partial<Record<(typeof PROFILE_KEYS)[number], unknown>>;

export function normalizeLogin(value: unknown): string | null {
  return typeof value === "string" ? value.trim().toLowerCase() || null : null;
}

export function platformKey(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function projectProfile(snapshot: unknown): Profile {
  const result: Profile = {};
  if (isRecord(snapshot)) {
    for (const key of PROFILE_KEYS) {
      if (Object.prototype.hasOwnProperty.call(snapshot, key)) {
        result[key] = snapshot[key];
      }
    }
  }
  return result;
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    );
}

export function toTimestamp(value: string | null): string | null {
  if (value === null) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const iso = date.toISOString();
  return iso.length === 24 ? iso : null;
}

export function identityKey(platform: string, email: string): string {
  return JSON.stringify([platformKey(platform), email]);
}
