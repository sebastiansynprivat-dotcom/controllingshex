/**
 * Triple-Stage Analysis Pipeline
 * Step 1: Data Cleaning & Validation (client-side)
 * Step 2: Rule-Based Categorization (client-side)
 * Step 3: AI Recommendations (edge function)
 */

/* ------------------------------------------------------------------ */
/*  TYPES                                                              */
/* ------------------------------------------------------------------ */

export interface ModelInfo {
  model_name: string;
  follower_count: number;
}

export interface CleanedChatter {
  name: string;
  startDate: string;
  account: string;
  revenueToday: number;
  revenueAllTime: number;
  openChats: number;
  oldestChatDays: number;
  massDms: number;
  followers: number;
  rawKpis: Record<string, string>;
}

export interface CategorizedChatter extends CleanedChatter {
  category: string;
  emoji: string;
  onboardingDay?: number;
}

export interface AnalysisChatter {
  name: string;
  startDate?: string;
  account?: string;
  kpis: Record<string, string>;
  recommendation?: string;
}

export interface AnalysisCategory {
  emoji: string;
  categoryName: string;
  chatters: AnalysisChatter[];
}

export interface AnalysisResult {
  categories: AnalysisCategory[];
}

export type PipelineStep = 1 | 2 | 3;

/* ------------------------------------------------------------------ */
/*  STEP 1: DATA CLEANING                                              */
/* ------------------------------------------------------------------ */

function toTitleCase(str: string): string {
  return str
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function parseNumber(val: string | undefined): number {
  if (!val) return 0;
  const cleaned = val.replace(/[^\d,.\-]/g, "").replace(",", ".");
  return parseFloat(cleaned) || 0;
}

function parseIntSafe(val: string | undefined): number {
  if (!val) return 0;
  return parseInt(val.replace(/\D/g, ""), 10) || 0;
}

/**
 * Parse CSV headers and find column indices by common patterns
 */
function findColumns(headers: string[]): Record<string, number> {
  const lower = headers.map((h) => h.toLowerCase().trim());
  const find = (patterns: RegExp[]): number => {
    for (const p of patterns) {
      const idx = lower.findIndex((h) => p.test(h));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  return {
    name: find([/^name$/, /chatter/i, /mitarbeiter/i]),
    startDate: find([/start\s*dat/i, /beginn/i, /onboard/i]),
    account: find([/account/i, /model/i, /konto/i]),
    revenueToday: find([/tages\s*umsatz/i, /revenue\s*today/i, /daily.*rev/i, /umsatz.*heute/i]),
    revenueAllTime: find([/gesamt\s*umsatz/i, /all.*time.*rev/i, /revenue.*all/i, /total.*rev/i]),
    openChats: find([/offene?\s*chats?/i, /open\s*chats?/i]),
    oldestChat: find([/oldest\s*chat/i, /älteste.*chat/i, /chat.*alter/i, /verzug/i, /delay/i]),
    massDms: find([/mass\s*dm/i, /massdm/i]),
  };
}

export function step1_cleanData(csvData: string, models: ModelInfo[]): CleanedChatter[] {
  const lines = csvData.split("\n").filter((l) => l.trim());
  if (lines.length < 2) throw new Error("CSV enthält keine Daten.");

  const headers = lines[0].split(",").map((h) => h.trim());
  const cols = findColumns(headers);

  if (cols.name === -1) {
    throw new Error("Spalte 'Name' nicht in CSV gefunden. Verfügbare Spalten: " + headers.join(", "));
  }

  // Build follower lookup (case-insensitive)
  const followerMap = new Map<string, number>();
  for (const m of models) {
    followerMap.set(m.model_name.toLowerCase(), m.follower_count);
  }

  const chatters: CleanedChatter[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",").map((v) => v.trim());
    if (!values[cols.name]?.trim()) continue;

    const name = toTitleCase(values[cols.name]);
    const account = cols.account !== -1 ? values[cols.account] || "" : "";

    // Match followers from model list
    const followers = followerMap.get(account.toLowerCase()) || 0;

    // Parse oldest chat days with OCR protection
    let oldestChatDays = cols.oldestChat !== -1 ? parseIntSafe(values[cols.oldestChat]) : 0;
    if (oldestChatDays > 30) oldestChatDays = 0; // OCR-Schutz

    // Build raw KPIs for display
    const rawKpis: Record<string, string> = {};
    headers.forEach((h, idx) => {
      if (idx !== cols.name && values[idx]?.trim()) {
        rawKpis[h] = values[idx];
      }
    });

    chatters.push({
      name,
      startDate: cols.startDate !== -1 ? values[cols.startDate] || "" : "",
      account,
      revenueToday: cols.revenueToday !== -1 ? parseNumber(values[cols.revenueToday]) : 0,
      revenueAllTime: cols.revenueAllTime !== -1 ? parseNumber(values[cols.revenueAllTime]) : 0,
      openChats: cols.openChats !== -1 ? parseIntSafe(values[cols.openChats]) : 0,
      oldestChatDays,
      massDms: cols.massDms !== -1 ? parseIntSafe(values[cols.massDms]) : 0,
      followers,
      rawKpis,
    });
  }

  return chatters;
}

/* ------------------------------------------------------------------ */
/*  STEP 2: RULE-BASED CATEGORIZATION                                  */
/* ------------------------------------------------------------------ */

function getDaysSinceStart(startDate: string): number {
  if (!startDate) return 999;
  const trimmed = startDate.trim().replace(/\s+/g, " ");

  let year: number, month: number, day: number;

  // DD.MM.YYYY, DD/MM/YYYY, DD-MM-YYYY (1-2 digit day/month, 2-4 digit year)
  const dmy = trimmed.match(/^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{2,4})$/);
  if (dmy) {
    day = parseInt(dmy[1], 10);
    month = parseInt(dmy[2], 10);
    year = parseInt(dmy[3], 10);
    if (year < 100) year += 2000;
  } else {
    // YYYY-MM-DD (ISO)
    const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) {
      year = parseInt(iso[1], 10);
      month = parseInt(iso[2], 10);
      day = parseInt(iso[3], 10);
    } else {
      return 999;
    }
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) return 999;

  // Validate date is real (e.g. not Feb 31)
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    return 999;
  }

  const now = new Date();
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.floor((todayUtc - parsed.getTime()) / 86400000);
  return diff >= 0 ? diff : 999;
}

export function step2_categorize(chatters: CleanedChatter[]): CategorizedChatter[] {
  return chatters.map((ch) => {
    const daysSinceStart = getDaysSinceStart(ch.startDate);

    // Priority 1: 🟥 ROT — Oldest Chat > 3 Tage (überschreibt ALLES)
    if (ch.oldestChatDays > 3) {
      return { ...ch, category: "WARNUNG", emoji: "🟠" };
    }

    // Priority 2: 🟦 BLAU — Newcomer (Start Date ≤ 5 Tage)
    if (daysSinceStart >= 0 && daysSinceStart <= 5) {
      const day = Math.max(1, daysSinceStart);
      return {
        ...ch,
        category: `ONBOARDING TAG ${Math.min(day, 5)}`,
        emoji: "🔵",
        onboardingDay: day,
      };
    }

    // Priority 3: 🔴 ROT — Null Euro Tag (Tagesumsatz = 0€)
    if (ch.revenueToday === 0) {
      return { ...ch, category: "NULL EURO TAG", emoji: "🔴" };
    }

    // Priority 4: 🟩 GRÜN — Top-Performer (All-Time > 500€ AND Oldest Chat ≤ 2)
    if (ch.revenueAllTime > 500 && ch.oldestChatDays <= 2) {
      return { ...ch, category: "ACCOUNT UPGRADE (UMSATZ-STREAK)", emoji: "🟢" };
    }

    // Priority 5: ⚪ Mittelfeld (alle anderen)
    return { ...ch, category: "WEITER SO / MITTELFELD", emoji: "⚪" };
  });
}

/* ------------------------------------------------------------------ */
/*  STEP 3 HELPERS: Convert categorized data to edge function format   */
/* ------------------------------------------------------------------ */

export function buildStep3Payload(categorized: CategorizedChatter[]): {
  categories: Array<{ emoji: string; categoryName: string; chatters: Array<{ name: string; data: string }> }>;
} {
  const catMap = new Map<string, { emoji: string; chatters: Array<{ name: string; data: string }> }>();

  for (const ch of categorized) {
    if (!catMap.has(ch.category)) {
      catMap.set(ch.category, { emoji: ch.emoji, chatters: [] });
    }
    catMap.get(ch.category)!.chatters.push({
      name: ch.name,
      data: [
        `Account: ${ch.account || "unbekannt"}`,
        `Tagesumsatz: ${ch.revenueToday.toFixed(2)}€`,
        `Gesamtumsatz: ${ch.revenueAllTime.toFixed(2)}€`,
        `Offene Chats: ${ch.openChats}`,
        `Ältester Chat: ${ch.oldestChatDays} Tage`,
        `MassDMs: ${ch.massDms}`,
        `Follower: ${ch.followers}`,
        ch.onboardingDay ? `Onboarding-Tag: ${ch.onboardingDay}` : "",
      ].filter(Boolean).join(", "),
    });
  }

  return {
    categories: Array.from(catMap.entries()).map(([name, val]) => ({
      emoji: val.emoji,
      categoryName: name,
      chatters: val.chatters,
    })),
  };
}

/**
 * Convert AI recommendations back to display format, merging with categorized data
 */
export function mergeRecommendations(
  categorized: CategorizedChatter[],
  recommendations: Record<string, string>
): AnalysisResult {
  const catMap = new Map<string, AnalysisCategory>();

  for (const ch of categorized) {
    if (!catMap.has(ch.category)) {
      catMap.set(ch.category, { emoji: ch.emoji, categoryName: ch.category, chatters: [] });
    }

    const kpis: Record<string, string> = {
      "Tagesumsatz": `${ch.revenueToday.toFixed(2)} €`,
      "Gesamtumsatz": `${ch.revenueAllTime.toFixed(2)} €`,
      "Offene Chats": `${ch.openChats} Chats seit ${ch.oldestChatDays} Tagen`,
      "MassDMs": `${ch.massDms}`,
    };

    if (ch.followers > 0) kpis["Follower"] = ch.followers.toLocaleString("de-DE");

    catMap.get(ch.category)!.chatters.push({
      name: ch.name,
      startDate: ch.startDate,
      account: ch.account,
      kpis,
      recommendation: recommendations[ch.name] || "Keine Empfehlung verfügbar.",
    });
  }

  // Sort chatters within each category by revenue descending
  for (const [, cat] of catMap) {
    cat.chatters.sort((a, b) => {
      const revA = parseNumber(a.kpis["Tagesumsatz"]);
      const revB = parseNumber(b.kpis["Tagesumsatz"]);
      return revB - revA;
    });
  }

  return { categories: Array.from(catMap.values()) };
}
