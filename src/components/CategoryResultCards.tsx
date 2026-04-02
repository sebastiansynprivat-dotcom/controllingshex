import { Copy, Check, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

/* ------------------------------------------------------------------ */
/*  TYPES                                                              */
/* ------------------------------------------------------------------ */

interface ChatterEntry {
  raw: string[];
  name: string;
  date: string;
  account: string;
  stats: { label: string; value: string }[];
  recommendation: string;
}

interface CategoryBlock {
  title: string;
  emoji: string;
  fullTitle: string;
  headers: string[];
  entries: ChatterEntry[];
}

/* ------------------------------------------------------------------ */
/*  EMOJI COLOR MAP                                                    */
/* ------------------------------------------------------------------ */

const emojiColorMap: Record<string, string> = {
  "⚠️": "from-amber-500/20 to-amber-900/10 border-amber-500/20",
  "🔴": "from-red-500/20 to-red-900/10 border-red-500/20",
  "📉": "from-red-400/15 to-red-900/10 border-red-400/15",
  "🔵": "from-blue-500/20 to-blue-900/10 border-blue-500/20",
  "🌟": "from-yellow-400/20 to-yellow-900/10 border-yellow-400/15",
  "🟢": "from-emerald-500/20 to-emerald-900/10 border-emerald-500/20",
  "🔄": "from-violet-500/20 to-violet-900/10 border-violet-500/15",
  "❌": "from-rose-500/20 to-rose-900/10 border-rose-500/20",
  "🟡": "from-yellow-500/20 to-yellow-900/10 border-yellow-500/15",
  "💰": "from-emerald-400/20 to-emerald-900/10 border-emerald-400/15",
  "🚀": "from-sky-500/20 to-sky-900/10 border-sky-500/15",
};

const emojiAccent: Record<string, string> = {
  "⚠️": "text-amber-400",
  "🔴": "text-red-400",
  "📉": "text-red-400",
  "🔵": "text-blue-400",
  "🌟": "text-yellow-300",
  "🟢": "text-emerald-400",
  "🔄": "text-violet-400",
  "❌": "text-rose-400",
  "🟡": "text-yellow-400",
  "💰": "text-emerald-300",
  "🚀": "text-sky-400",
};

function getCardGradient(emoji: string) {
  return emojiColorMap[emoji] || "from-primary/15 to-primary/5 border-primary/15";
}

function getAccentColor(emoji: string) {
  return emojiAccent[emoji] || "text-primary";
}

/* ------------------------------------------------------------------ */
/*  PARSER                                                             */
/* ------------------------------------------------------------------ */

function parseMarkdownIntoCategories(markdown: string): CategoryBlock[] {
  const lines = markdown.split("\n");
  const blocks: CategoryBlock[] = [];
  let currentBlock: Omit<CategoryBlock, "entries"> & { rawRows: string[][] } | null = null;
  let headersParsed = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect category header lines
    const categoryMatch = trimmed.match(
      /^\|?\s*\*{0,2}([\u{1F300}-\u{1FAF6}\u{2600}-\u{27BF}\u{FE00}-\u{FEFF}][\uFE0F]?\s+[A-ZÄÖÜ€0-9][A-ZÄÖÜ€0-9 /-]+)\*{0,2}/u
    );

    if (categoryMatch) {
      if (currentBlock && currentBlock.rawRows.length > 0) {
        blocks.push(buildBlock(currentBlock));
      }
      const fullTitle = categoryMatch[1].trim();
      const emojiMatch = fullTitle.match(/^([\u{1F300}-\u{1FAF6}\u{2600}-\u{27BF}\u{FE00}-\u{FEFF}][\uFE0F]?)\s*/u);
      const emoji = emojiMatch ? emojiMatch[1] : "";
      const title = fullTitle.replace(/^[\u{1F300}-\u{1FAF6}\u{2600}-\u{27BF}\u{FE00}-\u{FEFF}][\uFE0F]?\s*/u, "");

      currentBlock = { title, emoji, fullTitle, headers: [], rawRows: [] };
      headersParsed = false;
      continue;
    }

    // Separator lines
    if (trimmed.match(/^\|[\s-:|]+\|$/)) {
      headersParsed = true;
      continue;
    }

    // Table rows
    if (trimmed.startsWith("|") && currentBlock) {
      const cells = trimmed
        .split("|")
        .filter((c) => c.trim() !== "")
        .map((c) => c.trim());

      if (!headersParsed && currentBlock.headers.length === 0) {
        currentBlock.headers = cells;
      } else if (headersParsed) {
        currentBlock.rawRows.push(cells);
      }
    }
  }

  if (currentBlock && currentBlock.rawRows.length > 0) {
    blocks.push(buildBlock(currentBlock));
  }

  return blocks;
}

function buildBlock(raw: { title: string; emoji: string; fullTitle: string; headers: string[]; rawRows: string[][] }): CategoryBlock {
  const entries: ChatterEntry[] = raw.rawRows.map((row) => {
    const h = raw.headers;
    // Try to intelligently map columns
    const nameIdx = findColIndex(h, ["chatter", "name", "kunde", "user"]);
    const dateIdx = findColIndex(h, ["start", "datum", "date", "seit", "tag"]);
    const accountIdx = findColIndex(h, ["account", "model", "profil"]);
    const recIdx = findColIndex(h, ["empfehlung", "aktion", "maßnahme", "action", "handlung", "recommendation"]);

    const name = nameIdx >= 0 && row[nameIdx] ? row[nameIdx] : row[0] || "";
    const date = dateIdx >= 0 && row[dateIdx] ? row[dateIdx] : "";
    const account = accountIdx >= 0 && row[accountIdx] ? row[accountIdx] : "";
    const recommendation = recIdx >= 0 && row[recIdx] ? row[recIdx] : "";

    // Everything else becomes stats
    const usedIndices = new Set([nameIdx, dateIdx, accountIdx, recIdx].filter((i) => i >= 0));
    const stats: { label: string; value: string }[] = [];
    h.forEach((header, i) => {
      if (!usedIndices.has(i) && row[i]) {
        stats.push({ label: header, value: row[i] });
      }
    });

    return { raw: row, name, date, account, stats, recommendation };
  });

  return { title: raw.title, emoji: raw.emoji, fullTitle: raw.fullTitle, headers: raw.headers, entries };
}

function findColIndex(headers: string[], keywords: string[]): number {
  const lower = headers.map((h) => h.toLowerCase().replace(/[*_]/g, ""));
  for (const kw of keywords) {
    const idx = lower.findIndex((h) => h.includes(kw));
    if (idx >= 0) return idx;
  }
  return -1;
}

/* ------------------------------------------------------------------ */
/*  RAW TABLE FOR CLIPBOARD                                            */
/* ------------------------------------------------------------------ */

function extractRawTableForClipboard(markdown: string): string {
  const lines = markdown.split("\n").filter((l) => l.trim().startsWith("|"));
  const tsv = lines
    .filter((l) => !l.match(/^\|[\s-:|]+\|$/))
    .map((l) =>
      l
        .split("|")
        .filter((c) => c.trim() !== "")
        .map((c) => c.trim())
        .join("\t")
    )
    .join("\n");
  return tsv || markdown;
}

/* ------------------------------------------------------------------ */
/*  CURRENCY HIGHLIGHT                                                 */
/* ------------------------------------------------------------------ */

function isMoneyValue(value: string): boolean {
  return /\d+[\.,]?\d*\s*€|€\s*\d+|USD|umsatz/i.test(value);
}

/* ------------------------------------------------------------------ */
/*  COMPONENTS                                                         */
/* ------------------------------------------------------------------ */

interface CategoryResultCardsProps {
  markdown: string;
}

export default function CategoryResultCards({ markdown }: CategoryResultCardsProps) {
  const [copied, setCopied] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());

  const blocks = useMemo(() => parseMarkdownIntoCategories(markdown), [markdown]);

  const toggleFilter = (title: string) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  };

  const clearFilters = () => setActiveFilters(new Set());

  const visibleBlocks = activeFilters.size === 0
    ? blocks
    : blocks.filter((b) => activeFilters.has(b.title));

  const copyToClipboard = async () => {
    const tsv = extractRawTableForClipboard(markdown);
    await navigator.clipboard.writeText(tsv);
    setCopied(true);
    toast.success("Tabelle kopiert!");
    setTimeout(() => setCopied(false), 2000);
  };

  // Fallback
  if (blocks.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold text-foreground">Ergebnis</h2>
          <CopyButton copied={copied} onClick={copyToClipboard} />
        </div>
        <div className="glass-card rounded-2xl p-6 overflow-x-auto">
          <pre className="whitespace-pre-wrap text-sm text-foreground/80">{markdown}</pre>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Toolbar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-display text-2xl font-bold text-foreground">
          Analyse-Ergebnis
          <span className="text-sm font-normal text-muted-foreground ml-3">
            {blocks.reduce((a, b) => a + b.entries.length, 0)} Einträge in {blocks.length} Kategorien
          </span>
        </h2>
        <CopyButton copied={copied} onClick={copyToClipboard} />
      </div>

      {/* Filter Pills */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex items-center gap-1.5 text-muted-foreground mr-1">
          <Filter className="h-3.5 w-3.5" />
          <span className="text-xs font-medium uppercase tracking-wider">Filter</span>
        </div>
        {blocks.map((block) => {
          const isActive = activeFilters.has(block.title);
          return (
            <button
              key={block.title}
              onClick={() => toggleFilter(block.title)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-300 border ${
                isActive
                  ? "bg-primary/15 border-primary/30 text-primary gold-glow-sm"
                  : "bg-muted/30 border-border text-muted-foreground hover:text-foreground hover:border-foreground/20"
              }`}
            >
              <span>{block.emoji}</span>
              <span>{block.title}</span>
              <span className="opacity-60">({block.entries.length})</span>
            </button>
          );
        })}
        {activeFilters.size > 0 && (
          <button
            onClick={clearFilters}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 ml-1 transition-colors"
          >
            Alle zeigen
          </button>
        )}
      </div>

      {/* Category Cards */}
      <div className="grid gap-6">
        <AnimatePresence mode="popLayout">
          {visibleBlocks.map((block, idx) => (
            <motion.div
              key={block.title}
              layout
              initial={{ opacity: 0, y: 20, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95, y: -10 }}
              transition={{ duration: 0.35, delay: idx * 0.05, ease: "easeOut" }}
            >
              <CategoryCard block={block} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  CATEGORY CARD                                                      */
/* ------------------------------------------------------------------ */

function CategoryCard({ block }: { block: CategoryBlock }) {
  const gradient = getCardGradient(block.emoji);
  const accent = getAccentColor(block.emoji);

  return (
    <div
      className={`rounded-2xl border bg-gradient-to-br ${gradient} backdrop-blur-xl overflow-hidden`}
    >
      {/* Header */}
      <div className="px-6 py-4 border-b border-white/[0.06] flex items-center gap-3">
        <span className="text-2xl">{block.emoji}</span>
        <h3 className={`font-display text-lg font-bold tracking-wide ${accent}`}>
          {block.title}
        </h3>
        <span className="ml-auto text-xs text-muted-foreground font-medium bg-white/[0.04] px-2.5 py-1 rounded-full">
          {block.entries.length} {block.entries.length === 1 ? "Eintrag" : "Einträge"}
        </span>
      </div>

      {/* Entries */}
      <div className="divide-y divide-white/[0.04]">
        {block.entries.map((entry, i) => (
          <ChatterItem key={i} entry={entry} accent={accent} />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  CHATTER ITEM                                                       */
/* ------------------------------------------------------------------ */

function ChatterItem({ entry, accent }: { entry: ChatterEntry; accent: string }) {
  return (
    <div className="px-6 py-4 hover:bg-white/[0.02] transition-colors duration-200">
      <div className="flex flex-col lg:flex-row lg:items-start gap-3 lg:gap-6">
        {/* Left: Name & Date */}
        <div className="shrink-0 lg:w-44">
          <p className="font-semibold text-foreground text-sm leading-tight">
            {entry.name || "—"}
          </p>
          {entry.date && (
            <p className="text-xs text-muted-foreground mt-0.5">{entry.date}</p>
          )}
          {entry.account && (
            <span className="inline-block mt-1.5 text-[11px] font-medium px-2 py-0.5 rounded-md bg-white/[0.06] text-foreground/70 border border-white/[0.06]">
              {entry.account}
            </span>
          )}
        </div>

        {/* Middle: Stats */}
        {entry.stats.length > 0 && (
          <div className="flex flex-wrap gap-x-5 gap-y-1.5 flex-1 min-w-0">
            {entry.stats.map((stat, j) => (
              <div key={j} className="flex flex-col">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {stat.label}
                </span>
                <span
                  className={`text-sm font-semibold ${
                    isMoneyValue(stat.value) ? "gold-text" : "text-foreground"
                  }`}
                >
                  {stat.value}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Right: Recommendation */}
        {entry.recommendation && (
          <div className="lg:max-w-xs shrink-0">
            <p className={`text-xs leading-relaxed ${accent} opacity-90`}>
              {entry.recommendation}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  COPY BUTTON                                                        */
/* ------------------------------------------------------------------ */

function CopyButton({ copied, onClick }: { copied: boolean; onClick: () => void }) {
  return (
    <Button
      onClick={onClick}
      variant="outline"
      size="sm"
      className="glass-card border-primary/20 text-primary hover:gold-glow-sm hover:border-primary/40 transition-all duration-300"
    >
      {copied ? <Check className="h-3.5 w-3.5 mr-1.5" /> : <Copy className="h-3.5 w-3.5 mr-1.5" />}
      {copied ? "Kopiert!" : "Für Sheets kopieren"}
    </Button>
  );
}
