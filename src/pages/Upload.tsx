import { useState, useCallback, useRef, useEffect } from "react";
import { Upload as UploadIcon, Sparkles, FileSpreadsheet, XCircle, Trash2, Download, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { usePlatform } from "@/contexts/PlatformContext";
import { motion, AnimatePresence } from "framer-motion";
import * as XLSX from "xlsx";
import CategoryResultCards from "@/components/CategoryResultCards";
import ChatterSlideOver from "@/components/ChatterSlideOver";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { mapToActionCategory } from "@/lib/action-categories";
import { emitChatterDataUpdated } from "@/lib/data-events";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";

interface AnalysisChatter {
  name: string;
  startDate?: string;
  account?: string;
  kpis: Record<string, string>;
  recommendation?: string;
}

interface AnalysisCategory {
  emoji: string;
  categoryName: string;
  chatters: AnalysisChatter[];
}

interface AnalysisResult {
  categories: AnalysisCategory[];
}

interface ReportRow {
  id: string;
  platform: string;
  analysis_date: string;
  file_name: string;
  file_path: string;
  result_json: AnalysisResult | null;
  chatter_count: number;
  created_at: string;
}

function isAnalysisResult(value: unknown): value is AnalysisResult {
  return !!value && typeof value === "object" && Array.isArray((value as AnalysisResult).categories);
}

const BATCH_SIZE = 50;
const BATCH_RETRIES = 3;
const CANCEL_TIMEOUT_MS = 180_000;
const MAX_RETRY_ROUNDS = 10;

interface CsvChatterMetrics {
  name: string;
  startDate: string;
  account: string;
  revenueToday: number;
  massDms: number;
  openChats: number;
  responseDelayDays: number;
}

/**
 * Quote-aware splitter: respects CSV quoted fields (which may contain newlines & commas)
 * so a "Note" or "Account" cell with a line break does NOT shatter the batch.
 */
function splitCsvIntoLogicalLines(csvData: string): string[] {
  const lines: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < csvData.length; i++) {
    const char = csvData[i];

    if (char === '"') {
      if (inQuotes && csvData[i + 1] === '"') {
        current += '""';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      current += char;
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      // handle \r\n
      if (char === "\r" && csvData[i + 1] === "\n") i++;
      const trimmed = current.trim();
      if (trimmed) lines.push(trimmed);
      current = "";
      continue;
    }

    current += char;
  }

  const last = current.trim();
  if (last) lines.push(last);
  return lines;
}

function splitCsvIntoBatches(csvData: string): { header: string; batches: string[][] } {
  const lines = splitCsvIntoLogicalLines(csvData);
  if (lines.length < 2) return { header: lines[0] || "", batches: [] };
  const header = lines[0];
  const dataLines = lines.slice(1);
  const batches: string[][] = [];
  for (let i = 0; i < dataLines.length; i += BATCH_SIZE) {
    batches.push(dataLines.slice(i, i + BATCH_SIZE));
  }
  return { header, batches };
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[_\s]+/g, " ").trim();
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  fields.push(current.trim());
  return fields;
}

function findColumnIndex(headers: string[], patterns: RegExp[]): number {
  return headers.findIndex((header) => patterns.some((pattern) => pattern.test(header)));
}

function ensureRequiredColumn(index: number, label: string, headers: string[]) {
  if (index !== -1) return;
  throw new Error(`Spalte für ${label} nicht gefunden. Erkannte Spalten: ${headers.join(", ")}`);
}

function parseDecimal(value: string | undefined): number {
  if (!value) return 0;

  const cleaned = value.replace(/[^\d,.-]/g, "").trim();
  if (!cleaned) return 0;

  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");

  let normalized = cleaned;
  if (hasComma && hasDot) {
    normalized = cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.replace(/,/g, "");
  } else if (hasComma) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    normalized = cleaned.replace(/,/g, "");
  }

  return Number.parseFloat(normalized) || 0;
}

function parseInteger(value: string | undefined): number {
  if (!value) return 0;
  return Number.parseInt(value.replace(/\D/g, ""), 10) || 0;
}

function buildCsvMetricMap(csvData: string): Map<string, CsvChatterMetrics> {
  const lines = csvData.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const metrics = new Map<string, CsvChatterMetrics>();

  if (lines.length < 2) return metrics;

  const headers = parseCsvLine(lines[0]).map((header) => header.toLowerCase().trim());
  const nameIndex = findColumnIndex(headers, [/^name$/, /chatter/i, /mitarbeiter/i]);
  const startDateIndex = findColumnIndex(headers, [/start\s*dat/i, /beginn/i, /onboard/i]);
  const accountIndex = findColumnIndex(headers, [/account/i, /models?/i, /konto/i]);
  const revenueIndex = findColumnIndex(headers, [
    /tages\s*umsatz/i,
    /umsatz.*heute/i,
    /umsatz.*gestern/i,
    /revenue\s*today/i,
    /today.*revenue/i,
    /yesterday\s*revenue/i,
    /revenue\s*yesterday/i,
    /daily.*rev/i,
    /^umsatz$/i,
    /^revenue$/i,
  ]);
  const openChatsIndex = findColumnIndex(headers, [/offene?\s*chats?/i, /open\s*chats?/i, /unread\s*chats?/i]);
  const oldestChatIndex = findColumnIndex(headers, [/oldest\s*chat/i, /älteste.*chat/i, /chat.*alter/i, /verzug/i, /delay/i]);
  const massDmsIndex = findColumnIndex(headers, [/mass\s*dm(s)?/i, /massdm/i]);

  ensureRequiredColumn(nameIndex, "Name", headers);
  // Tagesumsatz is no longer hard-required: missing/invalid values default to 0
  // so chatters with empty revenue cells still appear in the report.

  for (const line of lines.slice(1)) {
    const values = parseCsvLine(line);
    const rawName = (values[nameIndex] || "").replace(/^[@\s]+/, "").trim();
    if (!rawName) continue;

    const openChatsRaw = openChatsIndex !== -1 ? values[openChatsIndex] : "";
    const oldestChatRaw = oldestChatIndex !== -1 ? values[oldestChatIndex] : openChatsRaw;
    const openChats = parseInteger(openChatsRaw);
    let responseDelayDays = parseInteger(oldestChatRaw);

    if (!responseDelayDays) {
      const match = openChatsRaw?.match(/seit\s*(\d+)/i);
      responseDelayDays = match ? Number.parseInt(match[1], 10) || 0 : 0;
    }

    if (responseDelayDays > 30) responseDelayDays = 0;

    const accountRaw = accountIndex !== -1 ? values[accountIndex] || "" : "";
    const baseKey = normalizeName(rawName);
    // Disambiguate duplicate names by account so two "Sarah" on different
    // accounts no longer overwrite each other.
    const accountKey = accountRaw ? `::${normalizeName(accountRaw)}` : "";
    let key = `${baseKey}${accountKey}`;
    let suffix = 2;
    while (metrics.has(key)) {
      key = `${baseKey}${accountKey}#${suffix++}`;
    }

    metrics.set(key, {
      name: rawName.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
      startDate: startDateIndex !== -1 ? values[startDateIndex] || "" : "",
      account: accountRaw,
      revenueToday: revenueIndex !== -1 ? parseDecimal(values[revenueIndex]) : 0,
      massDms: massDmsIndex !== -1 ? parseInteger(values[massDmsIndex]) : 0,
      openChats,
      responseDelayDays,
    });
  }

  return metrics;
}

function formatEuro(value: number): string {
  return `${value.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}


/**
 * Build AI lookup: normalized name → { category, emoji, recommendation, kpis }
 */
interface HistoryEntry {
  revenueToday: number;
  date: string;
}

function buildAiLookup(results: any[]): Map<string, { category: string; emoji: string; recommendation: string; kpis: Record<string, string> }> {
  const lookup = new Map<string, { category: string; emoji: string; recommendation: string; kpis: Record<string, string> }>();
  for (const result of results) {
    for (const cat of result.categories || []) {
      for (const chatter of cat.chatters || []) {
        const key = normalizeName(chatter.name || "");
        if (!key) continue;
        lookup.set(key, {
          category: cat.categoryName || "WEITER SO",
          emoji: cat.emoji || "⚪",
          recommendation: chatter.recommendation || "",
          kpis: chatter.kpis || {},
        });
      }
    }
  }
  return lookup;
}

function parseStartDate(value: string): Date | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/\s+/g, " ");

  // DD.MM.YYYY, DD/MM/YYYY, DD-MM-YYYY (1 or 2 digit day/month, 2 or 4 digit year)
  const dmy = trimmed.match(/^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{2,4})$/);
  if (dmy) {
    const day = Number.parseInt(dmy[1], 10);
    const month = Number.parseInt(dmy[2], 10);
    let year = Number.parseInt(dmy[3], 10);
    if (year < 100) year += 2000;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day) {
      return parsed;
    }
    return null;
  }

  // YYYY-MM-DD (ISO)
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const year = Number.parseInt(iso[1], 10);
    const month = Number.parseInt(iso[2], 10);
    const day = Number.parseInt(iso[3], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day) {
      return parsed;
    }
  }

  return null;
}

function getDaysSinceStart(startDate: string): number | null {
  const parsed = parseStartDate(startDate);
  if (!parsed) return null;

  const now = new Date();
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.floor((todayUtc - parsed.getTime()) / 86400000);
  return diff >= 0 ? diff : null;
}

function getRelevantHistory(entries?: HistoryEntry[]): HistoryEntry[] {
  if (!entries?.length) return [];

  const today = new Date().toISOString().split("T")[0];
  const uniqueByDate = new Map<string, HistoryEntry>();

  for (const entry of entries) {
    if (!entry?.date || entry.date === today || uniqueByDate.has(entry.date)) continue;
    uniqueByDate.set(entry.date, entry);
  }

  return Array.from(uniqueByDate.values()).sort((a, b) => b.date.localeCompare(a.date));
}

function getZeroRevenueStreak(currentRevenue: number, history: HistoryEntry[]): number {
  if (currentRevenue > 0) return 0;
  let streak = 1;
  for (const entry of history) {
    if (entry.revenueToday === 0) streak++;
    else break;
  }
  return streak;
}

function getPreviousZeroRevenueStreak(history: HistoryEntry[]): number {
  let streak = 0;
  for (const entry of history) {
    if (entry.revenueToday === 0) streak++;
    else break;
  }
  return streak;
}

function qualifiesAccountEinbruch(metrics: CsvChatterMetrics, history: HistoryEntry[]): boolean {
  if (metrics.revenueToday <= 0 || history.length < 2) return false;

  const avgPastRevenue = history.reduce((sum, entry) => sum + entry.revenueToday, 0) / history.length;
  if (avgPastRevenue < 20) return false;
  if (metrics.revenueToday >= avgPastRevenue * 0.5) return false;

  const lastTwoDays = history.slice(0, 2);
  return lastTwoDays.length === 2 && lastTwoDays.every((entry) => entry.revenueToday < avgPastRevenue * 0.75);
}

function isZeroRevenueOnlyCategory(category: string): boolean {
  return /0€\s*UMSATZ|NULL\s*EURO|HOHER\s*TRAFFIC|UNTER\s*BEOBACHTUNG/i.test(category);
}

function getFallbackPositiveCategory(metrics: CsvChatterMetrics, batchAverageRevenue: number): { category: string; emoji: string } {
  if (metrics.revenueToday > batchAverageRevenue) {
    return { category: "TOP PERFORMER", emoji: "⭐" };
  }

  return { category: "WEITER SO", emoji: "⚪" };
}

function buildFallbackRecommendation(
  category: string,
  metrics: CsvChatterMetrics,
  options: { daysSinceStart: number | null; zeroRevenueStreak: number; avgPastRevenue: number }
): string {
  if (/ONBOARDING/i.test(category)) {
    const day = category.match(/(\d+)/)?.[1] || "1";
    return `Onboarding Tag ${day}: heute ${formatEuro(metrics.revenueToday)} Umsatz. Aktivität, Follow-ups und Closings eng begleiten.`;
  }

  if (/WARNUNG/i.test(category)) {
    return `${metrics.openChats} offene Chats mit ${metrics.responseDelayDays} Tagen Verzug. Erst Rückstände abbauen, dann Performance neu bewerten.`;
  }

  if (/ACCOUNT-EINBRUCH/i.test(category)) {
    return `Heute ${formatEuro(metrics.revenueToday)} bei einem klaren Rückgang zum historischen Schnitt von ${formatEuro(options.avgPastRevenue)}. Verlauf der letzten Tage prüfen und direkt gegensteuern.`;
  }

  if (/COMEBACK/i.test(category)) {
    return `Heute wieder ${formatEuro(metrics.revenueToday)} Umsatz nach mehreren Null-Euro-Tagen. Momentum sichern und eng begleiten.`;
  }

  if (/0€\s*UMSATZ/i.test(category)) {
    const label = options.zeroRevenueStreak >= 7 ? "7+" : String(options.zeroRevenueStreak);
    return `Heute 0,00 € Umsatz (Tag ${label} der Null-Euro-Phase). Ursache prüfen und ein klares Aktivitätsziel für heute setzen.`;
  }

  if (/HOHER\s*TRAFFIC/i.test(category)) {
    return `${metrics.massDms} MassDMs bei 0,00 € Umsatz. Conversion-Script prüfen und Closings gezielt nachfassen.`;
  }

  if (/TOP PERFORMER/i.test(category)) {
    return `Heute ${formatEuro(metrics.revenueToday)} Umsatz. Starke Leistung – Best Practice sichern und Potenzial für größere Accounts prüfen.`;
  }

  return `Heute ${formatEuro(metrics.revenueToday)} Umsatz. Stabil weiterarbeiten und die Conversion weiter verbessern.`;
}

function shouldReplaceRecommendation(
  recommendation: string | undefined,
  metrics: CsvChatterMetrics,
  resolvedCategory: string,
  aiCategory?: string
): boolean {
  if (!recommendation?.trim()) return true;
  if (resolvedCategory !== (aiCategory || resolvedCategory)) return true;

  if (metrics.revenueToday > 0 && /(0\s*€|0\s*euro|null\s*euro|kein(?:en|e)?\s*umsatz|ohne\s*umsatz)/i.test(recommendation)) {
    return true;
  }

  if (!/ACCOUNT-EINBRUCH/i.test(resolvedCategory) && /einbruch/i.test(recommendation)) {
    return true;
  }

  return false;
}

function buildResultFromCsv(
  csvData: string,
  aiResults: any[],
  historyMap?: Map<string, { revenueToday: number; date: string }[]>
): AnalysisResult {
  const csvMetrics = buildCsvMetricMap(csvData);
  const aiLookup = buildAiLookup(aiResults);
  const categoryMap = new Map<string, AnalysisCategory>();
  const batchAverageRevenue = csvMetrics.size > 0
    ? Array.from(csvMetrics.values()).reduce((sum, chatter) => sum + chatter.revenueToday, 0) / csvMetrics.size
    : 0;

  for (const [compositeKey, metrics] of csvMetrics) {
    // Composite key is `name::account[#n]` — strip suffix to look up AI/history by base name
    const baseName = compositeKey.split("::")[0].split("#")[0];
    const ai = aiLookup.get(baseName) || aiLookup.get(compositeKey);
    const history = getRelevantHistory(historyMap?.get(baseName) || historyMap?.get(compositeKey));
    const daysSinceStart = getDaysSinceStart(metrics.startDate);
    const avgPastRevenue = history.length > 0
      ? history.reduce((sum, entry) => sum + entry.revenueToday, 0) / history.length
      : 0;
    const zeroRevenueStreak = getZeroRevenueStreak(metrics.revenueToday, history);
    const previousZeroRevenueStreak = getPreviousZeroRevenueStreak(history);

    let category = ai?.category || "";
    let emoji = ai?.emoji || "";

    if (daysSinceStart !== null && daysSinceStart > 0 && daysSinceStart <= 14) {
      category = `ONBOARDING TAG ${daysSinceStart}`;
      emoji = "🔵";
    } else if (metrics.responseDelayDays > 2) {
      category = "WARNUNG";
      emoji = "🟠";
    } else if (metrics.revenueToday === 0) {
      const aiCategoryAllowed = category && !/ACCOUNT-EINBRUCH/i.test(category) && (
        /ONBOARDING/i.test(category) ||
        /WARNUNG/i.test(category) ||
        /HOHER\s*TRAFFIC/i.test(category) ||
        /0€\s*UMSATZ/i.test(category) ||
        /NULL\s*EURO/i.test(category)
      );

      if (!aiCategoryAllowed) {
        category = `0€ UMSATZ TAG ${zeroRevenueStreak >= 7 ? "7+" : zeroRevenueStreak}`;
        emoji = "📉";
      }
    } else if (previousZeroRevenueStreak >= 3) {
      category = "COMEBACK";
      emoji = "🔄";
    } else if (qualifiesAccountEinbruch(metrics, history)) {
      category = "ACCOUNT-EINBRUCH";
      emoji = "⚠️";
    } else {
      const invalidAiCategory =
        !category ||
        /ACCOUNT-EINBRUCH/i.test(category) ||
        isZeroRevenueOnlyCategory(category) ||
        (/COMEBACK/i.test(category) && previousZeroRevenueStreak < 3) ||
        (/ONBOARDING/i.test(category) && (daysSinceStart === null || daysSinceStart < 0 || daysSinceStart > 5)) ||
        (/WARNUNG/i.test(category) && metrics.responseDelayDays <= 2);

      if (invalidAiCategory) {
        const fallback = getFallbackPositiveCategory(metrics, batchAverageRevenue);
        category = fallback.category;
        emoji = fallback.emoji;
      }
    }

    // SAFETY: If AI returned ONBOARDING but the start date says otherwise, override
    if (/ONBOARDING/i.test(category) && (daysSinceStart === null || daysSinceStart > 5)) {
      const fallback = getFallbackPositiveCategory(metrics, batchAverageRevenue);
      category = fallback.category;
      emoji = fallback.emoji;
    }

    // Map legacy/AI category to one of the 6 strict Action-Categories
    const action = mapToActionCategory(category);
    category = action.name;
    emoji = action.emoji;

    if (!categoryMap.has(category)) {
      categoryMap.set(category, { emoji: emoji || "👀", categoryName: category, chatters: [] });
    }

    const recommendation = shouldReplaceRecommendation(ai?.recommendation, metrics, category, ai?.category)
      ? buildFallbackRecommendation(category, metrics, { daysSinceStart, zeroRevenueStreak, avgPastRevenue })
      : ai?.recommendation || "Keine Empfehlung verfügbar.";

    categoryMap.get(category)!.chatters.push({
      name: metrics.name,
      startDate: metrics.startDate,
      account: metrics.account,
      kpis: {
        Tagesumsatz: formatEuro(metrics.revenueToday),
        Gesamtumsatz: (() => {
          const total = history.reduce((sum, entry) => sum + entry.revenueToday, 0) + metrics.revenueToday;
          return formatEuro(total);
        })(),
        "Offene Chats": `${metrics.openChats} Chats seit ${metrics.responseDelayDays} Tagen`,
        MassDMs: String(metrics.massDms),
      },
      recommendation,
    });
  }

  return { categories: Array.from(categoryMap.values()).filter((category) => category.chatters.length > 0) };
}

function extractDateFromFilename(name: string): string {
  // Match YYYY-MM-DD or YYYY_MM_DD anywhere in the filename
  const m = name.match(/(20\d{2})[-_](\d{2})[-_](\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return new Date().toISOString().split("T")[0];
}

async function saveChatterHistory(merged: AnalysisResult, activePlatform: string, userId: string | undefined, analysisDate: string) {
  const rows: any[] = [];
  for (const cat of merged.categories || []) {
    for (const chatter of cat.chatters || []) {
      const name = (chatter.name || "").replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
      const kpis = chatter.kpis || {};
      let revenue = 0;
      const revKey = Object.keys(kpis).find((k) => /umsatz|revenue/i.test(k));
      if (revKey) revenue = parseDecimal(kpis[revKey]);
      let massDms = 0;
      const dmKey = Object.keys(kpis).find((k) => /mass\s*dm/i.test(k));
      if (dmKey) massDms = parseInteger(kpis[dmKey]);
      let openChats = 0, responseDelay = 0;
      const chatKey = Object.keys(kpis).find((k) => /offene?\s*chats?|open\s*chats?/i.test(k));
      if (chatKey) {
        const chatVal = kpis[chatKey];
        const m = chatVal.match(/(\d+)\s*(?:chats?)\s*seit\s*(\d+)/i);
        if (m) { openChats = parseInt(m[1]) || 0; responseDelay = parseInt(m[2]) || 0; }
        else { openChats = parseInt((chatVal.match(/(\d+)/) || [])[1] || "0") || 0; }
      }
      if (responseDelay > 30) responseDelay = 0;
      rows.push({
        chatter_name: name, revenue_today: revenue, mass_dms: massDms, open_chats: openChats,
        response_delay_days: responseDelay, platform: activePlatform, analysis_date: analysisDate,
        category: cat.categoryName || null, recommendation: chatter.recommendation || null, user_id: userId,
        account: chatter.account || null,
      });
    }
  }
  if (rows.length > 0) {
    // Normalize account to "" so the unique index (COALESCE(account,'')) matches reliably
    const normalizedRows = rows.map((r: any) => ({ ...r, account: r.account ?? "" }));
    for (let i = 0; i < normalizedRows.length; i += 200) {
      const { error } = await supabase.from("chatter_history").upsert(
        normalizedRows.slice(i, i + 200),
        { onConflict: "chatter_name,account,platform,analysis_date" }
      );
      if (error) {
        console.error("[saveChatterHistory] upsert error:", error);
        throw new Error(`chatter_history upsert failed: ${error.message}`);
      }
    }
  }
}

export default function UploadPage() {
  const { platform } = usePlatform();
  const { user, session } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [csvData, setCsvData] = useState<string>("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [selectedChatter, setSelectedChatter] = useState<string | null>(null);
  const [statusLog, setStatusLog] = useState<string[]>([]);
  const [showCancel, setShowCancel] = useState(false);
  const [animationsReady, setAnimationsReady] = useState(true);
  const [progress, setProgress] = useState({ current: 0, total: 1, step: "" });

  const cancelledRef = useRef(false);
  const cancelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ReportRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loadingReports, setLoadingReports] = useState(true);

  const addStatus = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setStatusLog((prev) => [...prev.slice(-29), `[${ts}] ${msg}`]);
  }, []);

  const fetchReports = useCallback(async () => {
    setLoadingReports(true);
    const { data } = await supabase
      .from("analysis_reports")
      .select("*")
      .eq("platform", platform)
      .not("result_json", "is", null)
      .order("analysis_date", { ascending: false })
      .limit(50);
    setReports((data as unknown as ReportRow[] | null) ?? []);
    setLoadingReports(false);
  }, [platform]);

  useEffect(() => {
    fetchReports();
    setResult(null);
    setFile(null);
    setCsvData("");
    setStatusLog([]);
  }, [platform, fetchReports]);

  const handleFile = (f: File) => {
    setFile(f);
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = e.target?.result;
      if (!data) return;
      try {
        if (/\.(xlsx|xls)$/i.test(f.name)) {
          const wb = XLSX.read(data, { type: "array" });
          const csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
          setCsvData(csv);
        } else {
          setCsvData(new TextDecoder().decode(data as ArrayBuffer));
        }
      } catch (err: any) {
        toast.error("Datei konnte nicht gelesen werden: " + (err.message || "Fehler"));
      }
    };
    reader.readAsArrayBuffer(f);
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, []);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  };

  const cancelAnalysis = () => {
    cancelledRef.current = true;
    addStatus("⛔ Analyse abgebrochen.");
    toast.info("Analyse abgebrochen.");
    setLoading(false);
    setShowCancel(false);
    if (cancelTimerRef.current) clearTimeout(cancelTimerRef.current);
  };

  const uploadFileToStorage = async (f: File): Promise<string> => {
    const dateStr = new Date().toISOString().split("T")[0];
    const path = `${user?.id}/${platform}/${dateStr}/${Date.now()}_${f.name}`;
    const { error } = await supabase.storage.from("report-files").upload(path, f);
    if (error) throw new Error("Datei-Upload fehlgeschlagen: " + error.message);
    return path;
  };

  const callBatchFunction = async (
    header: string, batchLines: string[], batchNum: number, totalBatches: number, accessToken: string
  ): Promise<{ result: any; chattersReturned: number }> => {
    for (let attempt = 0; attempt <= BATCH_RETRIES; attempt++) {
      try {
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-csv-batch`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
              "Authorization": `Bearer ${accessToken}`,
            },
            body: JSON.stringify({ header, batchLines, platform, batchNum, totalBatches }),
            signal: AbortSignal.timeout(180000),
          }
        );

        const data = await response.json();

        if (!response.ok || data.error) {
          throw new Error(data.error || `HTTP ${response.status}`);
        }

        return { result: data.result, chattersReturned: data.chattersReturned || 0 };
      } catch (err: any) {
        const isLastAttempt = attempt === BATCH_RETRIES;
        if (isLastAttempt) throw err;
        addStatus(`🔁 Batch ${batchNum} Retry ${attempt + 1}/${BATCH_RETRIES}…`);
        await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
      }
    }
    throw new Error("Unreachable");
  };

  const analyze = async () => {
    if (!csvData || !file) {
      toast.error("Bitte lade zuerst eine Datei hoch.");
      return;
    }

    setLoading(true);
    setResult(null);
    setStatusLog([]);
    setShowCancel(false);
    cancelledRef.current = false;
    cancelTimerRef.current = setTimeout(() => setShowCancel(true), CANCEL_TIMEOUT_MS);
    let uploadedFilePath: string | null = null;

    try {
      // Step 1: Parse & upload
      addStatus("[Step 1] CSV wird vorbereitet…");
      const { header, batches } = splitCsvIntoBatches(csvData);
      const totalChatters = batches.reduce((s, b) => s + b.length, 0);
      const totalBatches = batches.length;

      if (totalBatches === 0) throw new Error("Keine Daten in der Datei gefunden.");

      addStatus(`✅ ${totalChatters} Chatter erkannt → ${totalBatches} Batch${totalBatches > 1 ? "es" : ""}`);
      setProgress({ current: 0, total: totalBatches + 1, step: "Datei sichern" });

      addStatus("☁️ Datei wird gesichert…");
      uploadedFilePath = await uploadFileToStorage(file);
      addStatus("✅ Datei gesichert.");

      if (cancelledRef.current) return;

      // Step 2: Process batches sequentially
      const activeSession = session ?? (await supabase.auth.getSession()).data.session;
      const accessToken = activeSession?.access_token || "";
      const batchResults: any[] = [];
      const failedBatches: number[] = [];
      let chattersTotal = 0;

      for (let i = 0; i < totalBatches; i++) {
        if (cancelledRef.current) return;

        const batchNum = i + 1;
        addStatus(`🧠 Batch ${batchNum}/${totalBatches} (${batches[i].length} Chatter)…`);
        setProgress({ current: i + 1, total: totalBatches + 1, step: `Batch ${batchNum}/${totalBatches}` });

        try {
          const { result: batchResult, chattersReturned } = await callBatchFunction(
            header, batches[i], batchNum, totalBatches, accessToken
          );
          batchResults[i] = batchResult;
          chattersTotal += chattersReturned;
          addStatus(`✅ Batch ${batchNum} fertig: ${chattersReturned}/${batches[i].length} Chatter`);
        } catch (err: any) {
          failedBatches.push(i);
          addStatus(`❌ Batch ${batchNum} fehlgeschlagen: ${err.message}`);
        }
      }

      // Retry failed batches until ALL succeed (or user cancels)
      let retryRound = 0;
      while (failedBatches.length > 0) {
        retryRound++;
        if (cancelledRef.current) return;

        const retryIndices = [...failedBatches];
        failedBatches.length = 0;
        const waitSec = Math.min(retryRound * 5, 30);
        addStatus(`🔄 Retry-Runde ${retryRound}: ${retryIndices.length} Batch(es) — warte ${waitSec}s…`);
        await new Promise(r => setTimeout(r, waitSec * 1000));

        for (const idx of retryIndices) {
          if (cancelledRef.current) return;
          const batchNum = idx + 1;
          addStatus(`🔁 Retry Batch ${batchNum}/${totalBatches}…`);

          try {
            const { result: batchResult, chattersReturned } = await callBatchFunction(
              header, batches[idx], batchNum, totalBatches, accessToken
            );
            batchResults[idx] = batchResult;
            chattersTotal += chattersReturned;
            addStatus(`✅ Retry Batch ${batchNum} erfolgreich: ${chattersReturned}/${batches[idx].length} Chatter`);
          } catch (err: any) {
            failedBatches.push(idx);
            addStatus(`❌ Retry Batch ${batchNum} fehlgeschlagen (Runde ${retryRound}): ${err.message}`);
          }
        }

        if (retryRound >= MAX_RETRY_ROUNDS && failedBatches.length > 0) {
          addStatus(`⚠️ ${MAX_RETRY_ROUNDS} Retry-Runden erreicht, versuche weiter…`);
        }
      }

      if (cancelledRef.current) return;

      const validResults = batchResults.filter(Boolean);

      // Step 3: Merge & Save — CSV is the SINGLE source of truth
      setProgress({ current: totalBatches + 1, total: totalBatches + 1, step: "Speichern" });
      addStatus("[Step 3] Ergebnisse werden zusammengeführt (CSV = Quelle)…");

      // Load chatter history for 0€ streak detection
      const csvMetricsForNames = buildCsvMetricMap(csvData);
      const chatterNames = Array.from(csvMetricsForNames.values()).map(m => m.name);
      let historyMap: Map<string, { revenueToday: number; date: string }[]> | undefined;
      if (chatterNames.length > 0) {
        const { data: histData } = await supabase
          .from("chatter_history")
          .select("chatter_name, analysis_date, revenue_today")
          .eq("platform", platform)
          .in("chatter_name", chatterNames.slice(0, 500))
          .order("analysis_date", { ascending: false })
          .limit(1000);
        if (histData && histData.length > 0) {
          historyMap = new Map();
          for (const row of histData) {
            const key = normalizeName(row.chatter_name);
            if (!historyMap.has(key)) historyMap.set(key, []);
            historyMap.get(key)!.push({ revenueToday: Number(row.revenue_today) || 0, date: row.analysis_date });
          }
        }
      }

      const merged = buildResultFromCsv(csvData, validResults, historyMap);
      const totalReturned = merged.categories.reduce((s, c) => s + c.chatters.length, 0);
      addStatus(`📊 ${totalReturned} Chatter aus CSV, KI-Empfehlungen zugeordnet.`);

      // Save report to DB — derive analysis date from filename (fallback: today)
      const analysisDate = extractDateFromFilename(file.name);
      const reportPayload = {
        platform,
        analysis_date: analysisDate,
        file_name: file.name,
        file_path: uploadedFilePath,
        result_json: merged as any,
        chatter_count: totalReturned,
        user_id: user?.id,
      };

      const { data: existingReport } = await supabase
        .from("analysis_reports")
        .select("id")
        .eq("file_path", uploadedFilePath)
        .limit(1)
        .maybeSingle();

      if (existingReport) {
        await supabase.from("analysis_reports").update(reportPayload).eq("id", existingReport.id);
      } else {
        await supabase.from("analysis_reports").insert(reportPayload);
      }

      // Save chatter history
      try {
        await saveChatterHistory(merged, platform, user?.id, analysisDate);
        addStatus("✅ Chatter-Historie gespeichert.");
        // Notify all open views (SlideOver, Dashboard, Forecast, …) to re-fetch
        emitChatterDataUpdated("upload");
      } catch (histErr: any) {
        console.error("History save error:", histErr);
        addStatus("⚠️ Chatter-Historie konnte nicht gespeichert werden.");
      }

      // Summary
      addStatus(`✅ 100% Coverage — alle ${totalReturned} Chatter erfasst!`);

      addStatus(`🎉 Fertig: ${totalReturned} Chatter in ${merged.categories.length} Kategorien`);

      setAnimationsReady(false);
      setResult(merged);
      if (failedBatches.length === 0) {
        toast.success(`Analyse abgeschlossen: ${totalReturned} Chatter.`);
      }
      setTimeout(() => setAnimationsReady(true), 2000);
      fetchReports();
    } catch (err: any) {
      console.error("[Analyse] Fehler:", err);
      const msg = err.message || "Unbekannter Fehler";

      if (uploadedFilePath) {
        // Clean up pending report
        await supabase.from("analysis_reports").delete().eq("file_path", uploadedFilePath).is("result_json", null);
        await supabase.storage.from("report-files").remove([uploadedFilePath]);
      }

      addStatus(`💥 ${msg}`);
      toast.error(msg);
    } finally {
      setLoading(false);
      setShowCancel(false);
      setProgress({ current: 0, total: 1, step: "" });
      if (cancelTimerRef.current) clearTimeout(cancelTimerRef.current);
    }
  };

  const deleteReport = async (report: ReportRow) => {
    setDeleting(true);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-analysis`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            "Authorization": `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          },
          body: JSON.stringify({ analysis_date: report.analysis_date, platform: report.platform }),
        }
      );
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || "Fehler beim Löschen");

      await supabase.from("analysis_reports").delete().eq("id", report.id);
      await supabase.storage.from("report-files").remove([report.file_path]);

      toast.success(`Analyse vom ${new Date(report.analysis_date).toLocaleDateString("de-DE")} gelöscht.`);
      if (result && report.analysis_date === new Date().toISOString().split("T")[0]) {
        setResult(null);
        setFile(null);
        setCsvData("");
        setStatusLog([]);
      }
      fetchReports();
    } catch (err: any) {
      toast.error(err.message || "Fehler beim Löschen");
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
      setDeleteTarget(null);
    }
  };

  const downloadReport = async (report: ReportRow) => {
    try {
      const { data, error } = await supabase.storage.from("report-files").download(report.file_path);
      if (error || !data) throw new Error("Download fehlgeschlagen");
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = report.file_name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast.error(err.message || "Download fehlgeschlagen");
    }
  };

  const viewReport = (report: ReportRow) => {
    if (report.result_json && isAnalysisResult(report.result_json)) {
      setResult(report.result_json);
    }
  };

  const progressPercent = progress.total > 1 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div className="flex h-full min-h-0">
      <div className={`flex-1 min-w-0 overflow-y-auto transition-all duration-500`}>
        <AnimatePresence mode="wait">
          <motion.div
            key={platform}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="max-w-5xl mx-auto space-y-8 sm:space-y-12 p-2 sm:p-8 lg:p-12"
          >
            <div className="space-y-3">
              <h1 className="text-2xl sm:text-3xl font-extralight tracking-tight text-foreground">Upload & Analyse</h1>
              <p className="text-white/30 text-sm font-light tracking-wide">
                Datei hochladen, KI-Analyse starten — Reports werden automatisch gespeichert.
              </p>
            </div>

            {/* Drop Zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={`relative rounded-2xl p-10 sm:p-20 text-center transition-all duration-700 cursor-pointer ${
                dragOver ? "bg-white/[0.03] border border-primary/15 gold-glow-sm"
                  : file ? "bg-white/[0.02] border border-white/[0.06]"
                    : "bg-white/[0.015] border border-white/[0.04] hover:border-white/[0.08] hover:bg-white/[0.025]"
              }`}
              onClick={() => document.getElementById("file-input")?.click()}
            >
              <input id="file-input" type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={onFileChange} />
              {file ? (
                <div className="flex items-center justify-center gap-5">
                  <div className="p-3 rounded-xl bg-primary/8"><FileSpreadsheet className="h-6 w-6 text-primary/70" /></div>
                  <div className="text-left">
                    <p className="font-medium text-foreground/90 text-sm tracking-wide">{file.name}</p>
                    <p className="text-xs text-white/25 mt-0.5 font-light">{(file.size / 1024).toFixed(1)} KB</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="mx-auto w-12 h-12 rounded-xl bg-white/[0.03] border border-white/[0.05] flex items-center justify-center">
                    <UploadIcon className="h-5 w-5 text-white/20" />
                  </div>
                  <div>
                    <p className="text-foreground/70 font-light text-sm tracking-wide">Datei hierher ziehen oder klicken</p>
                    <p className="text-[11px] text-white/20 mt-1 font-light tracking-wider uppercase">CSV · XLSX · XLS</p>
                  </div>
                </div>
              )}
            </div>

            {/* Buttons */}
            <div className="flex gap-3">
              <Button
                onClick={analyze}
                disabled={!file || loading}
                className="flex-1 bg-white/[0.04] hover:bg-white/[0.06] text-foreground/80 font-light text-sm py-7 rounded-xl border border-white/[0.06] hover:border-primary/15 transition-all duration-700 disabled:opacity-20 disabled:cursor-not-allowed tracking-wide"
              >
                {loading ? (
                  <span className="flex items-center gap-3">
                    <span className="h-4 w-4 border border-white/20 border-t-white/60 rounded-full" style={{ animation: "spin-slow 1s linear infinite" }} />
                    <span className="text-white/50">Analysiert…</span>
                  </span>
                ) : (
                  <span className="flex items-center gap-2.5">
                    <Sparkles className="h-4 w-4 text-primary/60" />
                    Analyse starten
                  </span>
                )}
              </Button>
              {showCancel && loading && (
                <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
                  <Button onClick={cancelAnalysis} variant="destructive" className="py-7 px-6 rounded-xl">
                    <XCircle className="h-4 w-4 mr-2" />Abbrechen
                  </Button>
                </motion.div>
              )}
            </div>

            {/* Status Log */}
            {(loading || statusLog.length > 0) && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 rounded-2xl bg-white/[0.02] border border-white/[0.06] p-6">
                {loading && progress.total > 1 && (
                  <>
                    <div className="flex items-center justify-between text-xs font-light tracking-wider">
                      <span className="text-primary/70 uppercase">{progress.step}</span>
                      <span className="text-white/40">{progressPercent}%</span>
                    </div>
                    <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/[0.04]">
                      <motion.div
                        className="absolute inset-y-0 left-0 rounded-full"
                        style={{ background: "linear-gradient(90deg, hsl(var(--primary)), hsl(var(--primary) / 0.6))" }}
                        initial={{ width: "0%" }}
                        animate={{ width: `${progressPercent}%` }}
                        transition={{ duration: 0.6, ease: "easeOut" }}
                      />
                    </div>
                  </>
                )}
                <div className="max-h-48 overflow-y-auto space-y-1 font-mono text-[11px] leading-relaxed scrollbar-thin">
                  {statusLog.map((line, i) => (
                    <div key={i} className={`${i === statusLog.length - 1 ? "text-white/60" : "text-white/25"} transition-colors duration-300`}>
                      {line}
                    </div>
                  ))}
                  {loading && <div className="text-white/30 animate-pulse">▌</div>}
                </div>
              </motion.div>
            )}

            {/* Current Result */}
            {result && (
              <ErrorBoundary>
                <div className={animationsReady ? "" : "!transition-none !animate-none"}>
                  <CategoryResultCards data={result} onChatterSelect={setSelectedChatter} />
                </div>
              </ErrorBoundary>
            )}

            {/* Report History */}
            <div className="space-y-4">
              <h2 className="text-lg font-light text-foreground/80 tracking-wide">Gespeicherte Reports</h2>
              {loadingReports ? (
                <div className="text-white/20 text-sm font-light">Lade Reports…</div>
              ) : reports.length === 0 ? (
                <div className="text-white/20 text-sm font-light">Noch keine Reports für {platform}.</div>
              ) : (
                <div className="space-y-2">
                  {reports.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between rounded-xl bg-white/[0.02] border border-white/[0.06] px-3 sm:px-5 py-3 sm:py-4 hover:bg-white/[0.03] transition-all duration-300 gap-2"
                    >
                      <div
                        className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0 cursor-pointer"
                        onClick={() => viewReport(r)}
                      >
                        <div className="p-2 rounded-lg bg-primary/8 shrink-0 hidden sm:block">
                          <FileSpreadsheet className="h-4 w-4 text-primary/60" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm text-foreground/80 font-light truncate">{r.file_name}</p>
                          <div className="flex items-center gap-3 text-[11px] text-white/25 mt-0.5">
                            <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{new Date(r.analysis_date).toLocaleDateString("de-DE")}</span>
                            <span>{r.chatter_count} Chatter</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5 sm:gap-1.5 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-white/30 hover:text-white/60"
                          onClick={() => downloadReport(r)}
                        >
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-white/30 hover:text-red-400/70"
                          onClick={() => { setDeleteTarget(r); setDeleteDialogOpen(true); }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
      <ChatterSlideOver open={!!selectedChatter} onClose={() => setSelectedChatter(null)} chatterName={selectedChatter || ""} platform={platform} />

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="bg-background border-white/10">
          <DialogHeader>
            <DialogTitle className="text-foreground">Analyse löschen?</DialogTitle>
            <DialogDescription className="text-white/50">
              Möchtest du die Analyse vom{" "}
              <strong className="text-foreground/80">
                {deleteTarget ? new Date(deleteTarget.analysis_date).toLocaleDateString("de-DE") : ""}
              </strong>{" "}
              für <strong className="text-foreground/80">{platform}</strong> wirklich löschen?
              Die Originaldatei und alle Ergebnisse werden entfernt.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="ghost" className="text-white/50">Abbrechen</Button>
            </DialogClose>
            <Button
              onClick={() => deleteTarget && deleteReport(deleteTarget)}
              disabled={deleting}
              variant="destructive"
              className="bg-red-600 hover:bg-red-700"
            >
              {deleting ? "Löscht…" : "Ja, löschen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
