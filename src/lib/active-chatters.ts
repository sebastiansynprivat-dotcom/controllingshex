/**
 * Aktive Chatter = Namen, die im NEUESTEN analysis_report dieser Plattform
 * vorkommen. Chatter, die in einem neueren Upload nicht mehr enthalten sind,
 * gelten als "raus" und werden in der UI komplett ausgeblendet — ihre History
 * bleibt aber in der Datenbank erhalten.
 *
 * Zusätzlich wird pro Chatter das aktuell zugeordnete Model/Account aus dem
 * letzten Report vorgehalten. Damit lassen sich "current view"-Anzeigen (Live-
 * Tracking, Model-Split, Recovery, Tinder, ...) darauf einschränken, dass nur
 * die JETZT tatsächlich gültige Chatter×Model-Kombination auftaucht — auch
 * wenn in der History noch andere Kombis stehen.
 */
import { supabase } from "@/integrations/supabase/client";
import { onChatterDataUpdated } from "@/lib/data-events";

/**
 * Entfernt unsichtbare Zeichen, die in Reports oft als "Garnierung" eingefügt
 * werden (Variation Selectors U+FE0E/U+FE0F, Zero-Width-Joiner/Space, BOM,
 * Bidi-Marks, NBSP, Soft-Hyphen). Sonst sieht die Engine "Jeanette" und
 * "️️️ Jeanette" als zwei verschiedene Chatter.
 */
function stripInvisible(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[\uFE00-\uFE0F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD]/g, "")
    .replace(/[\u00A0\u2007\u202F]/g, " ");
}

export function normalizeChatterName(name: string): string {
  return stripInvisible(name).toLowerCase().replace(/[_ ]+/g, "_").trim();
}

export function normalizeAccountName(acc: string): string {
  return stripInvisible(acc).toLowerCase().replace(/\s+/g, " ").trim();
}

interface CacheEntry {
  ts: number;
  names: Set<string>;
  /** Chatter (normalized) → Set of currently assigned model/account (normalized) */
  chatterModels: Map<string, Set<string>>;
  /** All currently assigned models across all chatters (normalized) */
  activeModels: Set<string>;
  /** false = noch nie ein Report geladen → keinen Filter anwenden */
  hasReport: boolean;
}

const cache = new Map<string, CacheEntry>();
const TTL_MS = 60_000;

async function loadEntry(platform: string): Promise<CacheEntry> {
  const cached = cache.get(platform);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached;

  const { data } = await supabase
    .from("analysis_reports")
    .select("result_json")
    .eq("platform", platform)
    .not("result_json", "is", null)
    .order("analysis_date", { ascending: false })
    .limit(1);

  const result = data?.[0]?.result_json as
    | { categories?: { chatters?: { name?: string; account?: string }[] }[] }
    | null
    | undefined;

  if (!result || !Array.isArray(result.categories)) {
    const empty: CacheEntry = {
      ts: Date.now(),
      names: new Set(),
      chatterModels: new Map(),
      activeModels: new Set(),
      hasReport: false,
    };
    cache.set(platform, empty);
    return empty;
  }

  const names = new Set<string>();
  const chatterModels = new Map<string, Set<string>>();
  const activeModels = new Set<string>();
  for (const cat of result.categories) {
    for (const ch of cat.chatters ?? []) {
      if (!ch?.name) continue;
      const n = normalizeChatterName(ch.name);
      names.add(n);
      const acc = ch.account ? normalizeAccountName(ch.account) : "";
      if (acc) {
        if (!chatterModels.has(n)) chatterModels.set(n, new Set());
        chatterModels.get(n)!.add(acc);
        activeModels.add(acc);
      }
    }
  }
  const entry: CacheEntry = {
    ts: Date.now(),
    names,
    chatterModels,
    activeModels,
    hasReport: true,
  };
  cache.set(platform, entry);
  return entry;
}

/**
 * Namen aller Chatter im aktuellsten Report (normalisiert).
 * `null` wenn (noch) kein Report existiert — dann NICHT filtern.
 */
export async function loadActiveChatterNames(platform: string): Promise<Set<string> | null> {
  const e = await loadEntry(platform);
  return e.hasReport ? e.names : null;
}

/**
 * Chatter (normalisiert) → Set der aktuell zugeordneten Models (normalisiert).
 * `null` wenn (noch) kein Report existiert.
 */
export async function loadActiveChatterModels(
  platform: string,
): Promise<Map<string, Set<string>> | null> {
  const e = await loadEntry(platform);
  return e.hasReport ? e.chatterModels : null;
}

/** Alle Models (normalisiert), die aktuell irgendeinem Chatter zugeordnet sind. */
export async function loadActiveModels(platform: string): Promise<Set<string> | null> {
  const e = await loadEntry(platform);
  return e.hasReport ? e.activeModels : null;
}

/**
 * True, wenn dieses (Chatter, Model)-Paar im letzten Report so vorkommt.
 * Kein Report vorhanden → true (nicht filtern).
 */
export async function isActiveChatterModel(
  platform: string,
  chatter: string,
  account: string,
): Promise<boolean> {
  const e = await loadEntry(platform);
  if (!e.hasReport) return true;
  const set = e.chatterModels.get(normalizeChatterName(chatter));
  if (!set) return false;
  return set.has(normalizeAccountName(account));
}

/**
 * Filtert eine Liste von {chatter_name, account}-Rows: behält nur Zeilen,
 * bei denen die (Chatter, Account)-Kombi im NEUESTEN Report noch existiert.
 * Historische Kombis (Chatter hatte Account X, hat ihn heute nicht mehr)
 * werden verworfen. Wenn noch kein Report existiert → alle Rows behalten.
 *
 * `account` darf eine kommaseparierte Liste enthalten — es werden nur die
 * noch aktiven Accounts zurückgegeben; ist keiner mehr aktiv, wird die Row
 * gedroppt.
 */
export async function filterRowsToActiveCombos<
  T extends { chatter_name?: string | null; account?: string | null },
>(platform: string, rows: T[]): Promise<T[]> {
  const models = await loadActiveChatterModels(platform);
  if (!models) return rows;
  const out: T[] = [];
  for (const r of rows) {
    const name = r.chatter_name;
    if (!name) {
      out.push(r);
      continue;
    }
    const allowed = models.get(normalizeChatterName(name));
    if (!allowed || allowed.size === 0) continue;
    const raw = (r.account ?? "").trim();
    if (!raw) {
      // Ohne Account-Info kann Chatter nicht ausgeschlossen werden, solange er
      // im Roster steht.
      out.push(r);
      continue;
    }
    const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
    const kept = parts.filter((p) => allowed.has(normalizeAccountName(p)));
    if (kept.length === 0) continue;
    out.push(kept.length === parts.length ? r : { ...r, account: kept.join(", ") });
  }
  return out;
}

export function invalidateActiveChattersCache(platform?: string): void {
  if (platform) cache.delete(platform);
  else cache.clear();
}

// Bei neuem Upload alle Caches verwerfen, damit der gerade entfernte Chatter
// sofort verschwindet.
if (typeof window !== "undefined") {
  onChatterDataUpdated(() => invalidateActiveChattersCache());
}
