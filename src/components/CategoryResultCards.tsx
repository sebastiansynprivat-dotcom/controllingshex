import { Copy, Check, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { usePlatform } from "@/contexts/PlatformContext";
import ChatterSlideOver from "@/components/ChatterSlideOver";

/* ------------------------------------------------------------------ */
/*  TYPES                                                              */
/* ------------------------------------------------------------------ */

interface Chatter {
  name: string;
  startDate?: string;
  account?: string;
  kpis: Record<string, string>;
  recommendation?: string;
}

interface Category {
  emoji: string;
  categoryName: string;
  chatters: Chatter[];
}

interface AnalysisResult {
  categories: Category[];
}

/* ------------------------------------------------------------------ */
/*  EMOJI COLOR MAP                                                    */
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

function isMoneyValue(value: string): boolean {
  return /\d+[\.,]?\d*\s*€|€\s*\d+/i.test(value);
}

function toTitleCase(name: string): string {
  return name
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ------------------------------------------------------------------ */
/*  CLIPBOARD                                                          */
/* ------------------------------------------------------------------ */

function buildClipboardTSV(categories: Category[]): string {
  const allHeaders = new Set<string>();
  categories.forEach((cat) =>
    cat.chatters.forEach((c) => Object.keys(c.kpis).forEach((k) => allHeaders.add(k)))
  );
  const kpiCols = Array.from(allHeaders);
  const header = ["Kategorie", "Chatter", "Startdatum", "Account", ...kpiCols, "Empfehlung"].join("\t");

  const rows = categories.flatMap((cat) =>
    cat.chatters.map((c) =>
      [
        `${cat.emoji} ${cat.categoryName}`,
        c.name,
        c.startDate || "",
        c.account || "",
        ...kpiCols.map((k) => c.kpis[k] || ""),
        c.recommendation || "",
      ].join("\t")
    )
  );

  return [header, ...rows].join("\n");
}

/* ------------------------------------------------------------------ */
/*  MAIN COMPONENT                                                     */
/* ------------------------------------------------------------------ */

interface CategoryResultCardsProps {
  data: AnalysisResult | null;
  raw?: string;
}

export default function CategoryResultCards({ data, raw }: CategoryResultCardsProps) {
  const [copied, setCopied] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());

  const categories = data?.categories ?? [];

  const toggleFilter = (name: string) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const visibleCategories =
    activeFilters.size === 0
      ? categories
      : categories.filter((c) => activeFilters.has(c.categoryName));

  const copyToClipboard = async () => {
    const text = categories.length > 0 ? buildClipboardTSV(categories) : raw || "";
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("Tabelle kopiert!");
    setTimeout(() => setCopied(false), 2000);
  };

  // Fallback: raw text if JSON parsing failed
  if (!data || categories.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-light text-foreground/80 tracking-wide">Ergebnis</h2>
          <CopyButton copied={copied} onClick={copyToClipboard} />
        </div>
        <div className="bg-white/[0.02] border border-white/[0.05] rounded-2xl p-8 backdrop-blur-2xl overflow-x-auto">
          <pre className="whitespace-pre-wrap text-sm text-white/50 font-light">{raw || "Keine Daten."}</pre>
        </div>
      </div>
    );
  }

  const totalChatters = categories.reduce((a, c) => a + c.chatters.length, 0);

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Toolbar */}
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-extralight text-foreground tracking-tight">
            Analyse-Ergebnis
          </h2>
          <p className="text-[11px] text-white/25 mt-1 font-light tracking-wider">
            {totalChatters} Einträge · {categories.length} Kategorien
          </p>
        </div>
        <CopyButton copied={copied} onClick={copyToClipboard} />
      </div>

      {/* Filter Pills */}
      <div className="flex flex-wrap gap-2 items-center">
        <Filter className="h-3 w-3 text-white/15 mr-1" />
        {categories.map((cat) => {
          const isActive = activeFilters.has(cat.categoryName);
          return (
            <button
              key={cat.categoryName}
              onClick={() => toggleFilter(cat.categoryName)}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-light transition-all duration-500 border tracking-wide ${
                isActive
                  ? "bg-primary/8 border-primary/15 text-primary/90"
                  : "bg-white/[0.02] border-white/[0.05] text-white/30 hover:text-white/55 hover:border-white/[0.08]"
              }`}
            >
              <span className="text-xs">{cat.emoji}</span>
              <span>{cat.categoryName}</span>
              <span className="text-white/15 ml-0.5">{cat.chatters.length}</span>
            </button>
          );
        })}
        {activeFilters.size > 0 && (
          <button
            onClick={() => setActiveFilters(new Set())}
            className="text-[10px] text-white/25 hover:text-white/50 ml-2 transition-colors duration-500 tracking-wider uppercase"
          >
            Reset
          </button>
        )}
      </div>

      {/* Category Cards */}
      <div className="grid gap-8">
        <AnimatePresence mode="popLayout">
          {visibleCategories.map((cat, idx) => (
            <motion.div
              key={cat.categoryName}
              layout
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ duration: 0.45, delay: idx * 0.04, ease: [0.16, 1, 0.3, 1] }}
            >
              <CategoryCard category={cat} />
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

function CategoryCard({ category }: { category: Category }) {
  const accent = emojiAccent[category.emoji] || "text-primary/70";

  return (
    <div className="rounded-2xl bg-white/[0.02] border border-white/[0.05] backdrop-blur-2xl overflow-hidden">
      <div className="px-10 py-7 border-b border-white/[0.04] flex items-center gap-4">
        <span className="text-2xl">{category.emoji}</span>
        <h3 className="text-2xl font-semibold tracking-wide gold-text">
          {category.categoryName}
        </h3>
        <span className="ml-auto text-xs text-white/25 font-light tracking-wider">
          {category.chatters.length} {category.chatters.length === 1 ? "Eintrag" : "Einträge"}
        </span>
      </div>

      <div className="divide-y divide-white/[0.03]">
        {category.chatters.map((chatter, i) => (
          <ChatterItem key={i} chatter={chatter} />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  CHATTER ITEM                                                       */
/* ------------------------------------------------------------------ */

function ChatterItem({ chatter }: { chatter: Chatter }) {
  const kpiEntries = Object.entries(chatter.kpis);
  const [nameCopied, setNameCopied] = useState(false);
  const formattedName = toTitleCase(chatter.name || "—");

  const copyName = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(formattedName);
    setNameCopied(true);
    toast.success(`Copied: ${formattedName}`);
    setTimeout(() => setNameCopied(false), 1500);
  };

  return (
    <div className="px-10 py-8 hover:bg-white/[0.015] transition-colors duration-500">
      <div className="flex flex-col lg:flex-row lg:items-start gap-6 lg:gap-10">
        {/* Left: Name & Date */}
        <div className="shrink-0 lg:w-56">
          <button
            onClick={copyName}
            className="group flex items-center gap-2 text-left"
          >
            <span className="text-xl font-semibold text-foreground/95 tracking-wide group-hover:underline underline-offset-4 decoration-primary/30 transition-all duration-300">
              {formattedName}
            </span>
            {nameCopied ? (
              <Check className="h-3.5 w-3.5 text-emerald-400/70 shrink-0" />
            ) : (
              <Copy className="h-3.5 w-3.5 text-white/15 group-hover:text-white/40 transition-colors duration-300 shrink-0" />
            )}
          </button>
          {chatter.startDate && (
            <p className="text-sm text-white/25 mt-1.5 font-light tracking-wide">
              {chatter.startDate}
            </p>
          )}
          {chatter.account && (
            <span className="inline-block mt-2.5 text-xs font-light px-3 py-1 rounded-full bg-white/[0.03] text-white/45 border border-white/[0.06] tracking-wider">
              {chatter.account}
            </span>
          )}
        </div>

        {/* Middle: KPIs */}
        {kpiEntries.length > 0 && (
          <div className="flex flex-wrap gap-x-10 gap-y-4 flex-1 min-w-0">
            {kpiEntries.map(([label, value]) => (
              <div key={label} className="flex flex-col">
                <span className="text-[10px] uppercase tracking-[0.2em] text-white/25 font-light">
                  {label}
                </span>
                {isMoneyValue(value) ? (
                  <span className="text-2xl font-extralight tracking-tight gold-text mt-1">
                    {value}
                  </span>
                ) : (
                  <span className="text-base font-light text-foreground/75 mt-1">
                    {value}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Right: Recommendation */}
        {chatter.recommendation && (
          <div className="lg:max-w-md shrink-0 border-l-2 border-primary/20 pl-5">
            <p className="text-base leading-relaxed text-zinc-200/60 font-light italic">
              {chatter.recommendation}
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
