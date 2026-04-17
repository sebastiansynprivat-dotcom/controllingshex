/**
 * Action-Categories — Single Source of Truth
 *
 * 6 strikt priorisierte Action-Kategorien (jeder Chatter genau 1x):
 *  1. 🆘 SOFORT EINGREIFEN — kritisch, verlangt Eingriff heute
 *  2. 💬 COACHING NÖTIG    — Performance fällt / Probleme erkennbar
 *  3. 🚀 PUSHEN            — Onboarding / Potenzial / kurz vor Upgrade
 *  4. 🎉 BELOHNEN          — Top-Performer (Solid / Star / Whale / Rising / Breakout)
 *  5. 📊 RE-ASSIGNEN       — Account-Match passt nicht (Follower vs. Performance)
 *  6. 👀 BEOBACHTEN        — Auffangkorb, stabil, kein Eingriff
 */

export type ActionCategoryName =
  | "SOFORT EINGREIFEN"
  | "COACHING NÖTIG"
  | "PUSHEN"
  | "BELOHNEN"
  | "RE-ASSIGNEN"
  | "BEOBACHTEN";

export interface ActionCategory {
  name: ActionCategoryName;
  emoji: string;
  /** Numeric priority (1 = highest, 6 = lowest) */
  priority: number;
  /** Short German description shown in tooltips/hints */
  description: string;
}

export const ACTION_CATEGORIES: readonly ActionCategory[] = [
  { name: "SOFORT EINGREIFEN", emoji: "🆘", priority: 1, description: "Kritisch — heute eingreifen" },
  { name: "COACHING NÖTIG",    emoji: "💬", priority: 2, description: "Performance fällt — Coaching nötig" },
  { name: "PUSHEN",            emoji: "🚀", priority: 3, description: "Onboarding / Potenzial pushen" },
  { name: "BELOHNEN",          emoji: "🎉", priority: 4, description: "Top-Performer — anerkennen" },
  { name: "RE-ASSIGNEN",       emoji: "📊", priority: 5, description: "Account passt nicht — re-assignen" },
  { name: "BEOBACHTEN",        emoji: "👀", priority: 6, description: "Stabil — beobachten" },
] as const;

export const ACTION_CATEGORY_NAMES = ACTION_CATEGORIES.map((c) => c.name) as readonly ActionCategoryName[];

const EMOJI_BY_NAME = new Map(ACTION_CATEGORIES.map((c) => [c.name, c.emoji]));
const ALLOWED_NAMES_SET = new Set<string>(ACTION_CATEGORY_NAMES);

export function getActionEmoji(name: string): string {
  return EMOJI_BY_NAME.get(name as ActionCategoryName) || "👀";
}

export function isActionCategory(name: string | undefined | null): name is ActionCategoryName {
  return !!name && ALLOWED_NAMES_SET.has(name);
}

/**
 * Map ANY legacy or AI-returned category name to one of the 6 Action-Categories.
 * Strict priority: highest-severity match wins.
 */
export function mapToActionCategory(rawName: string | undefined | null): { name: ActionCategoryName; emoji: string } {
  if (!rawName) return { name: "BEOBACHTEN", emoji: "👀" };
  const text = rawName.trim();

  // 1. Direct match on new names (incl. case-variations)
  const upper = text.replace(/^[^\w]*/, "").trim().toUpperCase();
  for (const cat of ACTION_CATEGORIES) {
    if (upper === cat.name || upper.includes(cat.name)) return { name: cat.name, emoji: cat.emoji };
  }

  // 2. Explicit new-name fuzzy
  if (/SOFORT.*EINGREIFEN|EINGREIFEN/i.test(text)) return { name: "SOFORT EINGREIFEN", emoji: "🆘" };
  if (/COACHING.*N(Ö|OE)TIG/i.test(text)) return { name: "COACHING NÖTIG", emoji: "💬" };
  if (/^PUSHEN$|\bPUSHEN\b/i.test(text)) return { name: "PUSHEN", emoji: "🚀" };
  if (/BELOHNEN/i.test(text)) return { name: "BELOHNEN", emoji: "🎉" };
  if (/RE.?ASSIGN/i.test(text)) return { name: "RE-ASSIGNEN", emoji: "📊" };
  if (/BEOBACHTEN/i.test(text)) return { name: "BEOBACHTEN", emoji: "👀" };

  // 3. Legacy → Action mapping (highest severity first)
  // SOFORT EINGREIFEN
  if (/EINBRUCH/i.test(text)) return { name: "SOFORT EINGREIFEN", emoji: "🆘" };
  const zeroMatch = text.match(/0\s*€.*?TAG\s*(\d+\+?)/i) || text.match(/NULL\s*EURO\s*TAG\s*(\d+\+?)?/i);
  if (zeroMatch) {
    const tag = zeroMatch[1] || "1";
    if (tag.includes("+") || parseInt(tag, 10) >= 5) return { name: "SOFORT EINGREIFEN", emoji: "🆘" };
    if (parseInt(tag, 10) >= 2) return { name: "COACHING NÖTIG", emoji: "💬" };
    return { name: "BEOBACHTEN", emoji: "👀" };
  }
  if (/0\s*€.*FOLGE|FOLGE.*0\s*€|KÜNDIGUNG/i.test(text)) return { name: "SOFORT EINGREIFEN", emoji: "🆘" };

  // COACHING NÖTIG
  if (/WARNUNG/i.test(text)) return { name: "COACHING NÖTIG", emoji: "💬" };
  if (/VIDEO.?COACHING/i.test(text)) return { name: "COACHING NÖTIG", emoji: "💬" };
  if (/COACHING.*KONTROLLE|ENGERE/i.test(text)) return { name: "COACHING NÖTIG", emoji: "💬" };
  if (/TRAFFIC.*CONVERSION|CONVERSION|TRAFFIC.*KEINE|TRAFFIC.?TEST/i.test(text)) return { name: "COACHING NÖTIG", emoji: "💬" };

  // PUSHEN
  if (/ONBOARDING/i.test(text)) return { name: "PUSHEN", emoji: "🚀" };
  if (/KURZ.*UPGRADE/i.test(text)) return { name: "PUSHEN", emoji: "🚀" };
  if (/COMEBACK/i.test(text)) return { name: "PUSHEN", emoji: "🚀" };

  // BELOHNEN
  if (/BREAKOUT/i.test(text)) return { name: "BELOHNEN", emoji: "🎉" };
  if (/UPGRADE.*STREAK|STREAK.*UPGRADE/i.test(text)) return { name: "BELOHNEN", emoji: "🎉" };
  if (/UPGRADE.*ZUVERL|ZUVERL.*UPGRADE/i.test(text)) return { name: "BELOHNEN", emoji: "🎉" };
  if (/TOP.?PERFORMER/i.test(text)) return { name: "BELOHNEN", emoji: "🎉" };

  // RE-ASSIGNEN
  if (/MODEL.?TAUSCH/i.test(text)) return { name: "RE-ASSIGNEN", emoji: "📊" };

  // BEOBACHTEN (Auffangkorb)
  if (/UNTER.?BEOBACHTUNG|MITTELFELD|WEITER\s*SO/i.test(text)) return { name: "BEOBACHTEN", emoji: "👀" };

  return { name: "BEOBACHTEN", emoji: "👀" };
}
