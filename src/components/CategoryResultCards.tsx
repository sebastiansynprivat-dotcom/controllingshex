import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { toast } from "sonner";

interface CategoryBlock {
  title: string;
  emoji: string;
  headers: string[];
  rows: string[][];
}

function parseMarkdownIntoCategories(markdown: string): CategoryBlock[] {
  const lines = markdown.split("\n");
  const blocks: CategoryBlock[] = [];
  let currentBlock: CategoryBlock | null = null;
  let headersParsed = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect category header lines like "| ⚠️ ACCOUNT-EINBRUCH |" or "⚠️ ACCOUNT-EINBRUCH"
    const categoryMatch = trimmed.match(
      /^\|?\s*([\u{1F300}-\u{1FAF6}\u{2600}-\u{27BF}\u{FE00}-\u{FEFF}][\uFE0F]?\s+[A-ZÄÖÜ€0-9][A-ZÄÖÜ€0-9 /-]+)/u
    );

    if (categoryMatch) {
      // Save previous block
      if (currentBlock && currentBlock.rows.length > 0) {
        blocks.push(currentBlock);
      }
      const fullTitle = categoryMatch[1].trim();
      const emojiMatch = fullTitle.match(/^([\u{1F300}-\u{1FAF6}\u{2600}-\u{27BF}\u{FE00}-\u{FEFF}][\uFE0F]?)\s*/u);
      const emoji = emojiMatch ? emojiMatch[1] : "";
      const title = fullTitle.replace(/^[\u{1F300}-\u{1FAF6}\u{2600}-\u{27BF}\u{FE00}-\u{FEFF}][\uFE0F]?\s*/u, "");

      currentBlock = { title, emoji, headers: [], rows: [] };
      headersParsed = false;
      continue;
    }

    // Skip separator lines (|---|---|)
    if (trimmed.match(/^\|[\s-:|]+\|$/)) {
      headersParsed = true;
      continue;
    }

    // Parse table rows
    if (trimmed.startsWith("|") && currentBlock) {
      const cells = trimmed
        .split("|")
        .filter((c) => c.trim() !== "")
        .map((c) => c.trim());

      if (!headersParsed && currentBlock.headers.length === 0) {
        currentBlock.headers = cells;
      } else if (headersParsed) {
        currentBlock.rows.push(cells);
      }
    }
  }

  // Push last block
  if (currentBlock && currentBlock.rows.length > 0) {
    blocks.push(currentBlock);
  }

  return blocks;
}

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

interface CategoryResultCardsProps {
  markdown: string;
}

export default function CategoryResultCards({ markdown }: CategoryResultCardsProps) {
  const [copied, setCopied] = useState(false);
  const blocks = parseMarkdownIntoCategories(markdown);

  const copyToClipboard = async () => {
    const tsv = extractRawTableForClipboard(markdown);
    await navigator.clipboard.writeText(tsv);
    setCopied(true);
    toast.success("Tabelle kopiert!");
    setTimeout(() => setCopied(false), 2000);
  };

  // Fallback: if no category blocks detected, render as raw
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
    <div className="space-y-6 animate-fade-in-delay">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl font-bold text-foreground">Ergebnis</h2>
        <CopyButton copied={copied} onClick={copyToClipboard} />
      </div>

      <div className="grid gap-5">
        {blocks.map((block, idx) => (
          <div
            key={idx}
            className="glass-card-gold rounded-2xl overflow-hidden animate-fade-in"
            style={{ animationDelay: `${idx * 80}ms` }}
          >
            {/* Category Header */}
            <div className="px-6 py-4 border-b border-border flex items-center gap-3">
              <span className="text-2xl">{block.emoji}</span>
              <h3 className="font-display text-lg font-bold gold-text tracking-wide">
                {block.title}
              </h3>
              <span className="ml-auto text-xs text-muted-foreground font-medium tabular-nums">
                {block.rows.length} {block.rows.length === 1 ? "Eintrag" : "Einträge"}
              </span>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {block.headers.map((h, i) => (
                      <th
                        key={i}
                        className="text-left py-3 px-6 text-muted-foreground font-semibold text-xs uppercase tracking-wider"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, i) => (
                    <tr
                      key={i}
                      className="border-b border-border/40 hover:bg-muted/30 transition-colors"
                    >
                      {row.map((cell, j) => (
                        <td key={j} className="py-3 px-6 text-foreground/90">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CopyButton({ copied, onClick }: { copied: boolean; onClick: () => void }) {
  return (
    <Button
      onClick={onClick}
      variant="outline"
      className="glass-card border-primary/20 text-primary hover:gold-glow-sm hover:border-primary/40 transition-all duration-300"
    >
      {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
      {copied ? "Kopiert!" : "Für Google Sheets kopieren"}
    </Button>
  );
}
