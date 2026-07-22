import type { jsPDF } from "jspdf";

// Font URLs — .ttf files hosted on jsdelivr. Fetched once, cached in memory.
const FONT_URLS = {
  regular: "https://cdn.jsdelivr.net/npm/@expo-google-fonts/noto-sans/NotoSans_400Regular.ttf",
  bold: "https://cdn.jsdelivr.net/npm/@expo-google-fonts/noto-sans/NotoSans_700Bold.ttf",
  italic: "https://cdn.jsdelivr.net/npm/@expo-google-fonts/noto-sans/NotoSans_400Regular_Italic.ttf",
  bolditalic: "https://cdn.jsdelivr.net/npm/@expo-google-fonts/noto-sans/NotoSans_700Bold_Italic.ttf",
  emoji: "https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji/fonts/NotoEmoji-Regular.ttf",
} as const;

type FontKind = keyof typeof FONT_URLS;

let cache: Partial<Record<FontKind, string>> | null = null;
let pending: Promise<void> | null = null;

async function fetchAsBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Font fetch failed: ${url}`);
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // Byte-by-byte to avoid "Maximum call stack size exceeded" from
  // String.fromCharCode.apply(...largeArray) on big font files.
  let bin = "";
  const CHUNK = 0x1000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, bytes.length);
    let s = "";
    for (let j = i; j < end; j++) s += String.fromCharCode(bytes[j]);
    bin += s;
  }
  return btoa(bin);
}

async function loadAll() {
  if (cache) return;
  const entries = await Promise.all(
    (Object.keys(FONT_URLS) as FontKind[]).map(async (k) => {
      try {
        return [k, await fetchAsBase64(FONT_URLS[k])] as const;
      } catch (e) {
        console.warn("[pdf-fonts] failed", k, e);
        return [k, null] as const;
      }
    }),
  );
  cache = {};
  for (const [k, v] of entries) if (v) cache[k] = v;
}

export async function ensurePdfFonts(doc: jsPDF): Promise<{ hasText: boolean; hasEmoji: boolean }> {
  if (!pending) pending = loadAll();
  await pending;
  const c = cache!;
  const register = (name: string, style: string, kind: FontKind) => {
    if (!c[kind]) return false;
    doc.addFileToVFS(`${kind}.ttf`, c[kind]!);
    doc.addFont(`${kind}.ttf`, name, style);
    return true;
  };
  const family = "NotoSans";
  const okR = register(family, "normal", "regular");
  register(family, "bold", "bold");
  register(family, "italic", "italic");
  register(family, "bolditalic", "bolditalic");
  const okE = register("NotoEmoji", "normal", "emoji");
  if (okR) doc.setFont(family, "normal");
  return { hasText: okR, hasEmoji: okE };
}

/** Regex matching most emoji + pictographic chars. */
const EMOJI_RE =
  /(?:\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)+/gu;

export type Seg = { text: string; emoji: boolean };

export function segmentText(str: string): Seg[] {
  const out: Seg[] = [];
  let last = 0;
  const s = str ?? "";
  for (const m of s.matchAll(EMOJI_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ text: s.slice(last, idx), emoji: false });
    out.push({ text: m[0], emoji: true });
    last = idx + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last), emoji: false });
  return out;
}

/** Draw one line, mixing text + emoji fonts. Returns total width drawn. */
export function drawRichLine(
  doc: jsPDF,
  line: string,
  x: number,
  y: number,
  opts: { size: number; style: "normal" | "bold" | "italic" | "bolditalic"; textFamily?: string; emojiFamily?: string; align?: "left" | "right" | "center" } = {
    size: 10,
    style: "normal",
  },
): number {
  const textFam = opts.textFamily ?? "NotoSans";
  const emojiFam = opts.emojiFamily ?? "NotoEmoji";
  const segs = segmentText(line);
  // measure
  let total = 0;
  const widths: number[] = [];
  for (const s of segs) {
    doc.setFont(s.emoji ? emojiFam : textFam, s.emoji ? "normal" : opts.style);
    doc.setFontSize(opts.size);
    const w = doc.getTextWidth(s.text);
    widths.push(w);
    total += w;
  }
  let cursor = x;
  if (opts.align === "right") cursor = x - total;
  else if (opts.align === "center") cursor = x - total / 2;
  segs.forEach((s, i) => {
    doc.setFont(s.emoji ? emojiFam : textFam, s.emoji ? "normal" : opts.style);
    doc.setFontSize(opts.size);
    doc.text(s.text, cursor, y);
    cursor += widths[i];
  });
  return total;
}

/** Wrap a string into lines that fit maxWidth, taking mixed fonts into account. */
export function wrapRich(
  doc: jsPDF,
  str: string,
  maxWidth: number,
  opts: { size: number; style: "normal" | "bold" | "italic" | "bolditalic"; textFamily?: string; emojiFamily?: string },
): string[] {
  const textFam = opts.textFamily ?? "NotoSans";
  const emojiFam = opts.emojiFamily ?? "NotoEmoji";
  const measure = (s: string) => {
    const segs = segmentText(s);
    let w = 0;
    for (const seg of segs) {
      doc.setFont(seg.emoji ? emojiFam : textFam, seg.emoji ? "normal" : opts.style);
      doc.setFontSize(opts.size);
      w += doc.getTextWidth(seg.text);
    }
    return w;
  };
  const paragraphs = String(str ?? "").split(/\r?\n/);
  const out: string[] = [];
  for (const para of paragraphs) {
    if (para === "") { out.push(""); continue; }
    const words = para.split(/(\s+)/); // keep spaces
    let line = "";
    for (const w of words) {
      const candidate = line + w;
      if (measure(candidate) <= maxWidth || line === "") {
        line = candidate;
      } else {
        out.push(line.trimEnd());
        line = w.trimStart();
      }
    }
    if (line) out.push(line.trimEnd());
  }
  return out;
}
