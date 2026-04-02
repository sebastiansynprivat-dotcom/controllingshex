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
/*  EMOJI COLOR MAP — muted, luxury tones                              */
/* ------------------------------------------------------------------ */

const emojiAccent: Record<string, string> = {
  "⚠️": "text-amber-400/80",
  "🔴": "text-red-400/70",
  "📉": "text-red-400/60",
  "🔵": "text-blue-400/70",
  "🌟": "text-yellow-300/70",
  "🟢": "text-emerald-400/70",
  "🔄": "text-violet-400/70",
  "❌": "text-rose-400/70",
  "🟡": "text-yellow-400/70",
  "💰": "text-emerald-300/70",
  "🚀": "text-sky-400/70",
};

function getAccentColor(emoji: string) {
  return emojiAccent[emoji] || "text-primary/70";
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

    if (trimmed.match(/^\|[\s-:|]+\|$/)) {
      headersParsed = true;
      continue;
    }

    if (trimmed.startsWith("|") && currentBlock) {
      const cells = trimmed.split("|").filter((c) => c.trim() !== "").map((c) => c.trim());
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
    const nameIdx = findColIndex(h, ["chatter", "name", "kunde", "user"]);
    const dateIdx = findColIndex(h, ["start", "datum", "date", "seit", "tag"]);
    const accountIdx = findColIndex(h, ["account", "model", "profil"]);
    const recIdx = findColIndex(h, ["empfehlung", "aktion", "maßnahme", "action", "handlung", "recommendation"]);

    const name = nameIdx >= 0 && row[nameIdx] ? row[nameIdx] : row[0] || "";
    const date = dateIdx >= 0 && row[dateIdx] ? row[dateIdx] : "";
    const account = accountIdx >= 0 && row[accountIdx] ? row[accountIdx] : "";
    const recommendation = recIdx >= 0 && row[recIdx] ? row[recIdx] : "";

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

function extractRawTableForClipboard(markdown: string): string {
  const lines = markdown.split("\n").filter((l) => l.trim().startsWith("|"));
  const tsv = lines
    .filter((l) => !l.match(/^\|[\s-:|]+\|$/))
    .map((l) => l.split("|").filter((c) => c.trim() !== "").map((c) => c.trim()).join("\t"))
    .join("\n");
  return tsv || markdown;
}

function isMoneyValue(value: string): boolean {
  return /\d+[\.,]?\d*\s*€|€\s*\d+|umsatz/i.test(value);
}

/* ------------------------------------------------------------------ */
/*  MAIN COMPONENT                                                     */
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

  if (blocks.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-light text-foreground/80 tracking-wide">Ergebnis</h2>
          <CopyButton copied={copied} onClick={copyToClipboard} />
        </div>
        <div className="bg-white/[0.02] border border-white/[0.05] rounded-2xl p-8 backdrop-blur-2xl overflow-x-auto">
          <pre className="whitespace-pre-wrap text-sm text-white/50 font-light">{markdown}</pre>
        </div>
      </div>
    );
  }

  const totalEntries = blocks.reduce((a, b) => a + b.entries.length, 0);

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Toolbar */}
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-extralight text-foreground tracking-tight">
            Analyse-Ergebnis
          </h2>
          <p className="text-[11px] text-white/25 mt-1 font-light tracking-wider">
            {totalEntries} Einträge · {blocks.length} Kategorien
          </p>
        </div>
        <CopyButton copied={copied} onClick={copyToClipboard} />
      </div>

      {/* Filter Pills */}
      <div className="flex flex-wrap gap-2 items-center">
        <Filter className="h-3 w-3 text-white/15 mr-1" />
        {blocks.map((block) => {
          const isActive = activeFilters.has(block.title);
          return (
            <button
              key={block.title}
              onClick={() => toggleFilter(block.title)}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-light transition-all duration-500 border tracking-wide ${
                isActive
                  ? "bg-primary/8 border-primary/15 text-primary/90"
                  : "bg-white/[0.02] border-white/[0.05] text-white/30 hover:text-white/55 hover:border-white/[0.08]"
              }`}
            >
              <span className="text-xs">{block.emoji}</span>
              <span>{block.title}</span>
              <span className="text-white/15 ml-0.5">{block.entries.length}</span>
            </button>
          );
        })}
        {activeFilters.size > 0 && (
          <button
            onClick={clearFilters}
            className="text-[10px] text-white/25 hover:text-white/50 ml-2 transition-colors duration-500 tracking-wider uppercase"
          >
            Reset
          </button>
        )}
      </div>

      {/* Category Cards */}
      <div className="grid gap-8">
        <AnimatePresence mode="popLayout">
          {visibleBlocks.map((block, idx) => (
            <motion.div
              key={block.title}
              layout
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ duration: 0.45, delay: idx * 0.04, ease: [0.16, 1, 0.3, 1] }}
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
  const accent = getAccentColor(block.emoji);

  return (
    <div className="rounded-2xl bg-white/[0.02] border border-white/[0.05] backdrop-blur-2xl overflow-hidden">
      {/* Header */}
      <div className="px-8 py-5 border-b border-white/[0.04] flex items-center gap-3">
        <span className="text-lg">{block.emoji}</span>
        <h3 className="text-sm font-medium tracking-wide text-foreground/85">
          {block.title}
        </h3>
        <span className="ml-auto text-[10px] text-white/20 font-light tracking-wider">
          {block.entries.length} {block.entries.length === 1 ? "Eintrag" : "Einträge"}
        </span>
      </div>

      {/* Entries */}
      <div className="divide-y divide-white/[0.03]">
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
    <div className="px-8 py-6 hover:bg-white/[0.01] transition-colors duration-500">
      <div className="flex flex-col lg:flex-row lg:items-start gap-5 lg:gap-8">
        {/* Left: Name & Date */}
        <div className="shrink-0 lg:w-48">
          <p className="font-medium text-foreground/90 text-[13px] tracking-wide leading-tight">
            {entry.name || "—"}
          </p>
          {entry.date && (
            <p className="text-[11px] text-white/20 mt-1 font-light tracking-wide">{entry.date}</p>
          )}
          {entry.account && (
            <span className="inline-block mt-2 text-[10px] font-light px-2.5 py-0.5 rounded-full bg-white/[0.03] text-white/40 border border-white/[0.06] tracking-wider">
              {entry.account}
            </span>
          )}
        </div>

        {/* Middle: Stats */}
        {entry.stats.length > 0 && (
          <div className="flex flex-wrap gap-x-8 gap-y-3 flex-1 min-w-0">
            {entry.stats.map((stat, j) => (
              <div key={j} className="flex flex-col">
                <span className="text-[9px] uppercase tracking-[0.2em] text-white/20 font-light">
                  {stat.label}
                </span>
                {isMoneyValue(stat.value) ? (
                  <span className="text-xl font-extralight tracking-tight gold-text mt-0.5">
                    {stat.value}
                  </span>
                ) : (
                  <span className="text-sm font-light text-foreground/75 mt-0.5">
                    {stat.value}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Right: Recommendation */}
        {entry.recommendation && (
          <div className="lg:max-w-sm shrink-0 border-l-[1.5px] border-primary/15 pl-4">
            <p className="text-[12px] leading-relaxed text-white/35 font-light italic">
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
      className="bg-white/[0.02] border-white/[0.06] text-white/40 hover:text-white/70 hover:border-white/[0.1] hover:bg-white/[0.03] transition-all duration-500 text-[11px] font-light tracking-wider h-8"
    >
      {copied ? <Check className="h-3 w-3 mr-1.5 text-emerald-400/60" /> : <Copy className="h-3 w-3 mr-1.5" />}
      {copied ? "Kopiert" : "Kopieren"}
    </Button>
  );
}
