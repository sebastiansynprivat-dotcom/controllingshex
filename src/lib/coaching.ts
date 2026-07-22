import { supabase } from "@/integrations/supabase/client";
import { jsPDF } from "jspdf";
import { ensurePdfFonts, drawRichLine, wrapRich, segmentText } from "./pdf-fonts";


export interface CoachingMaterial {
  id: string;
  title: string;
  content: string;
  is_active: boolean;
  updated_at: string;
}

export interface QuoteMoment {
  situation?: string;
  quote: string;
}

export interface ChatAnalysis {
  chat_id: string;
  customer_username?: string;
  score?: number;
  one_line_verdict?: string;
  chat_context?: string;
  pricing_check?: string;
  dos?: Array<{ situation?: string; quote: string; why_good: string }>;
  donts?: Array<{ situation?: string; quote: string; problem: string; better: string }>;
  revenue_levers?: string[];
  error?: string;
}

export interface Pattern {
  title: string;
  type: "positive" | "negative";
  description: string;
  moments?: QuoteMoment[];
  example_quotes?: string[]; // backward compat
  better_approach?: string;
}

export interface AnalysisResult {
  overall_score: number | null;
  executive_summary: string;
  personal_intro?: string;
  personal_closing?: string;
  top_focus?: string[];
  patterns: Pattern[];
  chats: ChatAnalysis[];
  chats_analyzed: number;
  chats_total?: number;
}

export interface CoachingAnalysisRow {
  id: string;
  chatter_name: string;
  platform: string;
  model_username: string | null;
  date_from: string;
  date_to: string;
  pdf_path: string;
  summary_json: AnalysisResult;
  chats_analyzed: number;
  created_at: string;
}

/* ---------------- Materials ---------------- */

export async function listMaterials(): Promise<CoachingMaterial[]> {
  const { data, error } = await supabase
    .from("coaching_materials")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CoachingMaterial[];
}

export async function saveMaterial(m: { id?: string; title: string; content: string; is_active: boolean }) {
  if (m.id) {
    const { error } = await supabase
      .from("coaching_materials")
      .update({ title: m.title, content: m.content, is_active: m.is_active })
      .eq("id", m.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("coaching_materials")
      .insert({ title: m.title, content: m.content, is_active: m.is_active });
    if (error) throw error;
  }
}

export async function deleteMaterial(id: string) {
  const { error } = await supabase.from("coaching_materials").delete().eq("id", id);
  if (error) throw error;
}

/* ---------------- Chatters (from last report per platform) ---------------- */

export interface ChatterCandidate {
  chatter_name: string;
  account: string | null;
  last_analysis_date: string;
}

export async function listChattersForPlatform(platform: string): Promise<ChatterCandidate[]> {
  const { data: latest } = await supabase
    .from("analysis_reports")
    .select("analysis_date")
    .eq("platform", platform)
    .order("analysis_date", { ascending: false })
    .limit(1);

  if (!latest || latest.length === 0) return [];
  const latestDate = latest[0].analysis_date;

  const { data, error } = await supabase
    .from("chatter_history")
    .select("chatter_name, account")
    .eq("platform", platform)
    .eq("analysis_date", latestDate);

  if (error) throw error;

  const map = new Map<string, ChatterCandidate>();
  for (const row of data ?? []) {
    if (!row.chatter_name) continue;
    if (!map.has(row.chatter_name)) {
      map.set(row.chatter_name, {
        chatter_name: row.chatter_name,
        account: row.account,
        last_analysis_date: latestDate,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.chatter_name.localeCompare(b.chatter_name));
}

/* ---------------- Analyses ---------------- */

export async function listAnalyses(chatter_name: string, platform: string): Promise<CoachingAnalysisRow[]> {
  const { data, error } = await supabase
    .from("coaching_analyses")
    .select("*")
    .eq("chatter_name", chatter_name)
    .eq("platform", platform)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as CoachingAnalysisRow[];
}

interface ResolvedToken {
  platform: string;
  username: string;
  token: string;
}

async function resolveTokens(input: {
  chatter_name: string;
  platform: string;
  model_username: string | null;
}): Promise<{ telegram_id: string; tokens: ResolvedToken[] }> {
  const { data, error } = await supabase.functions.invoke("resolve-chatter-tokens", {
    body: {
      chatter_name: input.chatter_name,
      platform: input.platform,
      model_username: input.model_username,
    },
  });
  if (error) throw new Error(error.message || "resolve-chatter-tokens failed");
  if (!data?.telegram_id || !Array.isArray(data?.tokens) || data.tokens.length === 0) {
    throw new Error(data?.error || "Keine Tokens gefunden");
  }
  return { telegram_id: data.telegram_id as string, tokens: data.tokens as ResolvedToken[] };
}

function awaitRequestCompletion(
  requestId: string,
  onProgress?: (n: number) => void,
  timeoutMs = 300_000,
  idleMs = 20_000,
): Promise<any[]> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let lastChats: any[] = [];
    let lastChangeAt = Date.now();
    const cleanup = () => {
      try { channel.unsubscribe(); } catch { /* noop */ }
      clearInterval(poll);
      clearInterval(idleCheck);
      clearTimeout(timer);
    };
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const handleRow = (row: any) => {
      if (!row) return;
      const chats = Array.isArray(row.result_json) ? row.result_json : [];
      if (chats.length !== lastChats.length) {
        lastChats = chats;
        lastChangeAt = Date.now();
        onProgress?.(chats.length);
      }
      if (row.status === "completed") done(() => resolve(chats));
      else if (row.status === "failed") {
        // If we already have chats, prefer using them rather than failing hard.
        if (chats.length > 0) done(() => resolve(chats));
        else done(() => reject(new Error(row.error_message || "Chat-Fetch fehlgeschlagen")));
      }
    };

    const channel = supabase
      .channel(`chats_fetch_requests:${requestId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chats_fetch_requests", filter: `id=eq.${requestId}` },
        (payload) => handleRow(payload.new),
      )
      .subscribe();

    const pollOnce = async () => {
      const { data } = await supabase
        .from("chats_fetch_requests")
        .select("status, result_json, error_message")
        .eq("id", requestId)
        .maybeSingle();
      handleRow(data);
    };
    const poll = setInterval(pollOnce, 5000);
    pollOnce();

    // If chats have arrived but no new chat for `idleMs`, treat stream as complete.
    const idleCheck = setInterval(() => {
      if (lastChats.length > 0 && Date.now() - lastChangeAt >= idleMs) {
        done(() => resolve(lastChats));
      }
    }, 2000);

    const timer = setTimeout(() => {
      if (lastChats.length > 0) done(() => resolve(lastChats));
      else done(() => reject(new Error("Timeout beim Laden der Chats (5 min).")));
    }, timeoutMs);
  });
}

export async function runAnalysis(input: {
  chatter_name: string;
  platform: string;
  model_username: string | null;
  date_from: string;
  date_to: string;
  onStage?: (stage: string) => void;
}): Promise<AnalysisResult> {
  input.onStage?.("Tokens werden aufgelöst…");
  const { telegram_id, tokens } = await resolveTokens({
    chatter_name: input.chatter_name,
    platform: input.platform,
    model_username: input.model_username,
  });

  input.onStage?.(`Fordere Chats für ${tokens.length} Model(s) an…`);
  const date_range = { start: input.date_from, end: input.date_to };

  const requestIds = await Promise.all(
    tokens.map(async (t) => {
      const { data, error } = await supabase.functions.invoke("request-chats", {
        body: {
          telegram_id,
          platform: t.platform,
          token: t.token,
          model_username: t.username,
          date_range,
        },
      });
      if (error) throw new Error(error.message || "request-chats failed");
      return { request_id: data.request_id as string, username: t.username };
    }),
  );

  input.onStage?.("Warte auf Chats vom externen Dienst…");
  const counts = new Map<string, number>();
  const chatArrays = await Promise.all(
    requestIds.map(({ request_id, username }) =>
      awaitRequestCompletion(request_id, (n) => {
        counts.set(username, n);
        const total = Array.from(counts.values()).reduce((s, v) => s + v, 0);
        input.onStage?.(`Lade Chats… ${total}`);
      }).catch((e) => {
        console.warn(`Chat-Fetch für ${username} fehlgeschlagen:`, e);
        return [] as any[];
      }),
    ),
  );

  const aggregated: any[] = [];
  for (let i = 0; i < chatArrays.length; i++) {
    const username = requestIds[i].username;
    for (const c of chatArrays[i]) {
      aggregated.push({ ...c, model_username: (c && c.model_username) || username });
    }
  }

  if (aggregated.length === 0) {
    throw new Error("Keine Chats vom externen Dienst erhalten.");
  }

  input.onStage?.(`Analysiere ${aggregated.length} Chats mit KI…`);
  const url = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/generate-coaching-analysis`;
  const { data: { session } } = await supabase.auth.getSession();
  const anon = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${session?.access_token ?? anon}`,
      "apikey": anon,
    },
    body: JSON.stringify({
      chatter_name: input.chatter_name,
      platform: input.platform,
      model_username: input.model_username,
      date_from: input.date_from,
      date_to: input.date_to,
      chats: aggregated,
    }),
  });
  const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json as AnalysisResult;
}

/* ---------------- PDF rendering — Black & Gold ---------------- */

const GOLD: [number, number, number] = [201, 168, 76];      // #C9A84C
const GOLD_SOFT: [number, number, number] = [232, 208, 138]; // lighter accent
const INK: [number, number, number] = [22, 22, 22];          // near-black
const PAPER: [number, number, number] = [252, 251, 247];     // warm off-white
const MUTED: [number, number, number] = [110, 110, 110];
const HAIRLINE: [number, number, number] = [220, 214, 196];

export function renderAnalysisPDF(input: {
  chatter_name: string;
  platform: string;
  model_username: string | null;
  date_from: string;
  date_to: string;
  result: AnalysisResult;
}): Blob {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 56;
  const contentW = pageW - margin * 2;

  // Sanitize text for jsPDF's WinAnsi encoding — replace glyphs that render as
  // garbage boxes / random letters ("P") in helvetica.
  const sanitize = (s: string): string =>
    (s ?? "")
      .replace(/[\u2192\u2794\u27A1\u2B95]/g, ">")   // → arrows
      .replace(/[\u2190\u2B05]/g, "<")               // ← arrows
      .replace(/[\u2013\u2014]/g, "-")               // – — dashes
      .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"') // curly / German quotes
      .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'") // curly single quotes
      .replace(/[\u2026]/g, "...")                   // ellipsis
      .replace(/[\u2022\u25CF\u25CB\u25AA\u25AB]/g, "-") // bullets
      .replace(/[\u00A0]/g, " ")                     // nbsp
      // Strip everything jsPDF's WinAnsi font can't render (emojis, CJK,
      // symbol pictographs, variation selectors, ZWJ). Otherwise they render
      // as random letters like "Ø=Þ" or "þþ þþþ".
      .replace(/[\u{1F000}-\u{1FFFF}]/gu, "")
      .replace(/[\u2600-\u27BF]/g, "")
      .replace(/[\uFE00-\uFE0F\u200B-\u200D\u2060\uFEFF]/g, "")
      // Final safety net: drop any remaining char outside Latin-1.
      .replace(/[^\x00-\xFF]/g, "");

  const _text = doc.text.bind(doc);
  (doc as any).text = (text: any, x: number, y: number, opts?: any) => {
    if (Array.isArray(text)) return _text(text.map((t) => sanitize(String(t))), x, y, opts);
    return _text(sanitize(String(text)), x, y, opts);
  };
  const _split = doc.splitTextToSize.bind(doc);
  (doc as any).splitTextToSize = (text: any, w: number, opts?: any) =>
    _split(sanitize(String(text)), w, opts);

  const setFill = (c: [number, number, number]) => doc.setFillColor(c[0], c[1], c[2]);
  const setDraw = (c: [number, number, number]) => doc.setDrawColor(c[0], c[1], c[2]);
  const setText = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);

  const paintBackground = (color: [number, number, number] = PAPER) => {
    setFill(color);
    doc.rect(0, 0, pageW, pageH, "F");
  };

  // ---------- Graphics helpers ----------
  const drawArc = (
    cx: number,
    cy: number,
    r: number,
    startDeg: number,
    endDeg: number,
    stroke: [number, number, number],
    width: number,
  ) => {
    setDraw(stroke);
    doc.setLineWidth(width);
    doc.setLineCap("round");
    const steps = Math.max(24, Math.ceil(Math.abs(endDeg - startDeg) / 4));
    const toRad = (d: number) => (d * Math.PI) / 180;
    let px = cx + r * Math.cos(toRad(startDeg));
    let py = cy + r * Math.sin(toRad(startDeg));
    for (let i = 1; i <= steps; i++) {
      const t = startDeg + ((endDeg - startDeg) * i) / steps;
      const nx = cx + r * Math.cos(toRad(t));
      const ny = cy + r * Math.sin(toRad(t));
      doc.line(px, py, nx, ny);
      px = nx;
      py = ny;
    }
    doc.setLineCap("butt");
  };

  const drawDotGrid = (
    x: number,
    y: number,
    cols: number,
    rows: number,
    gap: number,
    dot: number,
    color: [number, number, number],
    opacityFade = false,
  ) => {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const fadeFactor = opacityFade ? 1 - r / (rows + 2) : 1;
        setFill([
          Math.round(color[0] * fadeFactor + 20 * (1 - fadeFactor)),
          Math.round(color[1] * fadeFactor + 20 * (1 - fadeFactor)),
          Math.round(color[2] * fadeFactor + 20 * (1 - fadeFactor)),
        ]);
        doc.circle(x + c * gap, y + r * gap, dot, "F");
      }
    }
  };

  const drawHBar = (
    x: number,
    y: number,
    w: number,
    h: number,
    pct: number, // 0..1
    trackColor: [number, number, number],
    fillColor: [number, number, number],
  ) => {
    setFill(trackColor);
    doc.roundedRect(x, y, w, h, h / 2, h / 2, "F");
    const fillW = Math.max(h, w * Math.max(0, Math.min(1, pct)));
    setFill(fillColor);
    doc.roundedRect(x, y, fillW, h, h / 2, h / 2, "F");
  };


  // ---------- Cover Page (black + gold) ----------
  paintBackground(INK);

  // Decorative dot grid, top right
  drawDotGrid(pageW - margin - 140, margin + 20, 14, 8, 10, 0.8, [90, 75, 30], true);
  // Bottom-left dot grid (faded)
  drawDotGrid(margin, pageH - margin - 90, 10, 6, 10, 0.7, [70, 58, 22], true);

  // Gold hairline frame
  setDraw(GOLD);
  doc.setLineWidth(0.6);
  doc.rect(margin - 18, margin - 18, contentW + 36, pageH - (margin - 18) * 2);

  // Diagonal gold accent lines (bottom right)
  setDraw(GOLD);
  doc.setLineWidth(0.4);
  for (let i = 0; i < 6; i++) {
    const off = i * 6;
    doc.line(pageW - margin - 80 + off, pageH - margin - 20, pageW - margin - 20 + off, pageH - margin - 80);
  }

  // SheX wordmark
  doc.setFont("helvetica", "bold");
  doc.setFontSize(44);
  setText(GOLD);
  doc.text("SheX", margin, margin + 38);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  setText(GOLD_SOFT);
  doc.text("COACHING  ·  PERSONAL REPORT", margin, margin + 54);

  // Kicker
  setText(GOLD_SOFT);
  doc.setFontSize(9);
  doc.text("PERSÖNLICHE ANALYSE FÜR", margin, pageH / 2 - 100);

  // Chatter name — adaptive size using real text width so long names never clip
  setText([245, 240, 224]);
  doc.setFont("helvetica", "bold");
  let nameSize = 56;
  doc.setFontSize(nameSize);
  while (nameSize > 22 && doc.getTextWidth(input.chatter_name) > contentW) {
    nameSize -= 3;
    doc.setFontSize(nameSize);
  }
  doc.text(input.chatter_name, margin, pageH / 2 - 40);

  // Gold rule
  setDraw(GOLD);
  doc.setLineWidth(1.2);
  doc.line(margin, pageH / 2 - 20, margin + 72, pageH / 2 - 20);

  // Meta grid — values wrapped so long ranges/usernames never overlap
  setText([200, 195, 180]);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const metaY = pageH / 2 + 20;
  const col = contentW / 3;
  const metaCell = (label: string, value: string, i: number) => {
    setText(GOLD_SOFT);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.text(label.toUpperCase(), margin + col * i, metaY);
    setText([235, 230, 215]);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    const lines = doc.splitTextToSize(value, col - 12) as string[];
    lines.slice(0, 3).forEach((l, li) => doc.text(l, margin + col * i, metaY + 16 + li * 13));
  };
  metaCell("Model", input.model_username ?? "-", 0);
  metaCell("Plattform", input.platform, 1);
  metaCell("Zeitraum", `${input.date_from} bis ${input.date_to}`, 2);

  // Radial gauge (score)
  const score = input.result.overall_score;
  if (score !== null && score !== undefined) {
    const cx = pageW / 2;
    const cy = pageH - margin - 130;
    const r = 58;
    drawArc(cx, cy, r, 135, 405, [55, 45, 20], 7);
    const pct = Math.max(0, Math.min(100, score)) / 100;
    const endDeg = 135 + 270 * pct;
    drawArc(cx, cy, r, 135, endDeg, GOLD, 7);
    setText(GOLD);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(38);
    doc.text(String(score), cx, cy + 8, { align: "center" });
    setText(GOLD_SOFT);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text("von 100", cx, cy + 24, { align: "center" });
    doc.setFontSize(8);
    doc.text("GESAMT-SCORE", cx, cy + 82, { align: "center" });
  }

  // Footer on cover
  setText([150, 140, 110]);
  doc.setFontSize(7);
  doc.text(
    `${input.result.chats_analyzed} Chats analysiert · vertraulich · nur für dich`,
    margin,
    pageH - margin + 6,
  );

  // ---------- Content pages ----------
  const drawPageHeader = () => {
    setText(GOLD);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("SheX", margin, margin - 22);
    setText(MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text("COACHING REPORT", margin + 34, margin - 22);
    doc.text(input.chatter_name, pageW - margin, margin - 22, { align: "right" });
    setDraw(HAIRLINE);
    doc.setLineWidth(0.4);
    doc.line(margin, margin - 14, pageW - margin, margin - 14);
  };

  const drawContentFooter = () => {
    setDraw(HAIRLINE);
    doc.setLineWidth(0.4);
    doc.line(margin, pageH - margin, pageW - margin, pageH - margin);
    setText(MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text("SheX Coaching", margin, pageH - margin + 12);
    doc.text(
      `Für ${input.chatter_name} · ${input.date_from} – ${input.date_to}`,
      pageW - margin,
      pageH - margin + 12,
      { align: "right" },
    );
  };

  doc.addPage();
  paintBackground(PAPER);
  drawPageHeader();

  let y = margin + 4;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageH - margin - 20) {
      drawContentFooter();
      doc.addPage();
      paintBackground(PAPER);
      drawPageHeader();
      y = margin + 4;
    }
  };

  const writeText = (
    text: string,
    opts: { size?: number; bold?: boolean; italic?: boolean; color?: [number, number, number]; indent?: number; gapAfter?: number; lineHeight?: number } = {},
  ) => {
    const size = opts.size ?? 10;
    const style = opts.bold ? (opts.italic ? "bolditalic" : "bold") : opts.italic ? "italic" : "normal";
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    setText(opts.color ?? INK);
    const indent = opts.indent ?? 0;
    const lh = (opts.lineHeight ?? 1.35) * size;
    const lines = doc.splitTextToSize(text, contentW - indent) as string[];
    for (const l of lines) {
      ensureSpace(lh);
      doc.text(l, margin + indent, y);
      y += lh;
    }
    y += opts.gapAfter ?? 0;
  };

  const sectionHeading = (kicker: string, title: string) => {
    ensureSpace(90);
    y += 22; // breathing room above every section
    setText(GOLD);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(kicker.toUpperCase(), margin, y);
    y += 6;
    setDraw(GOLD);
    doc.setLineWidth(1);
    doc.line(margin, y, margin + 28, y);
    y += 20;
    setText(INK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    const titleLines = doc.splitTextToSize(title, contentW) as string[];
    for (const l of titleLines) { doc.text(l, margin, y); y += 24; }
    y += 4;
  };

  const goldCard = (title: string, body: string) => {
    ensureSpace(80);
    const startY = y;
    // measure body
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    const bodyLines = doc.splitTextToSize(body, contentW - 32) as string[];
    const cardH = 22 + 14 + bodyLines.length * 14 + 18;
    ensureSpace(cardH);
    setFill([250, 246, 232]);
    doc.rect(margin, y, contentW, cardH, "F");
    setDraw(GOLD);
    doc.setLineWidth(1.4);
    doc.line(margin, y, margin, y + cardH); // left gold bar
    y += 20;
    setText(GOLD);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(title.toUpperCase(), margin + 16, y);
    y += 16;
    setText(INK);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    for (const l of bodyLines) {
      doc.text(l, margin + 16, y);
      y += 14;
    }
    y += 12;
  };

  const pill = (label: string, color: [number, number, number]) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    const w = doc.getTextWidth(label) + 14;
    const h = 14;
    setFill(color);
    doc.roundedRect(margin, y, w, h, 3, 3, "F");
    setText([255, 255, 255]);
    doc.text(label, margin + 7, y + 9.5);
    y += h + 8;
    return w;
  };

  // Rich quote block — situation kicker + quote + verdict, all in one card.
  // Renders any moment (Do / Dont / Pattern) with the same visual language so
  // the reader always sees: WORAUF → WAS GESAGT → WARUM.
  const quoteBlock = (opts: {
    situation?: string;
    quote: string;
    verdictLabel?: string;
    verdictText?: string;
    accent: [number, number, number];
    extraLabel?: string;
    extraText?: string;
    extraAccent?: [number, number, number];
  }) => {
    const innerW = contentW - 28;
    // measure
    doc.setFont("helvetica", "italic");
    doc.setFontSize(11);
    const quoteLines = doc.splitTextToSize(`\u201E${opts.quote}\u201C`, innerW) as string[];
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    const sitLines = opts.situation ? (doc.splitTextToSize(opts.situation, innerW) as string[]) : [];
    doc.setFontSize(10);
    const verdictLines = opts.verdictText ? (doc.splitTextToSize(opts.verdictText, innerW) as string[]) : [];
    const extraLines = opts.extraText ? (doc.splitTextToSize(opts.extraText, innerW) as string[]) : [];
    const cardH =
      14 + // top pad
      (sitLines.length ? 10 + sitLines.length * 12 + 6 : 0) +
      quoteLines.length * 15 + 8 +
      (verdictLines.length ? 10 + verdictLines.length * 13 : 0) +
      (extraLines.length ? 10 + extraLines.length * 13 : 0) +
      14;
    ensureSpace(cardH + 6);
    const startY = y;
    setFill([252, 250, 244]);
    doc.roundedRect(margin, startY, contentW, cardH, 4, 4, "F");
    setFill(opts.accent);
    doc.rect(margin, startY, 3, cardH, "F");
    let cy = startY + 18;
    const tx = margin + 18;

    if (sitLines.length) {
      setText(MUTED);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.text("SITUATION", tx, cy);
      cy += 10;
      setText([70, 70, 70]);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      for (const l of sitLines) { doc.text(l, tx, cy); cy += 12; }
      cy += 6;
    }

    setText(INK);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(11);
    for (const l of quoteLines) { doc.text(l, tx, cy); cy += 15; }
    cy += 8;

    if (verdictLines.length) {
      setText(opts.accent);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.text((opts.verdictLabel ?? "WARUM").toUpperCase(), tx, cy);
      cy += 10;
      setText(INK);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      for (const l of verdictLines) { doc.text(l, tx, cy); cy += 13; }
    }

    if (extraLines.length) {
      const acc = opts.extraAccent ?? GOLD;
      setText(acc);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.text((opts.extraLabel ?? "SO STÄRKER").toUpperCase(), tx, cy);
      cy += 10;
      setText(INK);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      for (const l of extraLines) { doc.text(l, tx, cy); cy += 13; }
    }

    y = startY + cardH + 10;
  };

  // ---------- Zahlen-Dashboard ----------
  const validChats = input.result.chats.filter((c) => typeof c.score === "number") as Array<ChatAnalysis & { score: number }>;
  if (validChats.length > 0 || score !== null) {
    sectionHeading("Zahlen", "Deine Analyse auf einen Blick");

    // KPI row: 3 stat cards
    const totalDos = input.result.chats.reduce((s, c) => s + (c.dos?.length ?? 0), 0);
    const totalDonts = input.result.chats.reduce((s, c) => s + (c.donts?.length ?? 0), 0);
    const totalLevers = input.result.chats.reduce((s, c) => s + (c.revenue_levers?.length ?? 0), 0);
    const cardH = 62;
    const gap = 12;
    const cardW = (contentW - gap * 2) / 3;
    ensureSpace(cardH + 14);
    const kpiY = y;
    const kpis: Array<[string, string | number, [number, number, number]]> = [
      ["Starke Moves", totalDos, [60, 120, 70]],
      ["Wachstums-Chancen", totalDonts, GOLD],
      ["Umsatz-Hebel", totalLevers, INK],
    ];
    kpis.forEach(([label, value, accent], i) => {
      const x = margin + i * (cardW + gap);
      setFill([250, 247, 238]);
      doc.roundedRect(x, kpiY, cardW, cardH, 6, 6, "F");
      // top accent bar
      setFill(accent);
      doc.rect(x, kpiY, cardW, 3, "F");
      setText(accent);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(26);
      doc.text(String(value), x + 14, kpiY + 36);
      setText(MUTED);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(label.toUpperCase(), x + 14, kpiY + 52);
    });
    y = kpiY + cardH + 18;

    // Chart: per-chat scores (horizontal bars)
    if (validChats.length > 0) {
      const rowH = 20;
      ensureSpace(40);
      setText(INK);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text("Score je Chat", margin, y);
      setText(MUTED);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text("0 — 100", pageW - margin, y, { align: "right" });
      y += 16;

      const labelW = 130;
      const valueW = 34;
      const barX = margin + labelW;
      const barMaxW = contentW - labelW - valueW - 8;

      validChats.forEach((c) => {
        ensureSpace(rowH + 2);
        // per-row baseline guides (redrawn each row so pagination stays clean)
        setDraw([238, 232, 218]);
        doc.setLineWidth(0.3);
        [0.25, 0.5, 0.75, 1].forEach((t) => {
          const gx = barX + barMaxW * t;
          doc.line(gx, y, gx, y + rowH - 6);
        });

        const label = (c.customer_username ?? "?").slice(0, 22);
        setText(INK);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.text(label, margin, y + 11);
        const pct = c.score / 100;
        const fillCol: [number, number, number] =
          c.score >= 75 ? [60, 120, 70] : c.score >= 50 ? GOLD : [180, 90, 60];
        drawHBar(barX, y + 5, barMaxW, 8, pct, [235, 230, 215], fillCol);
        setText(INK);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.text(String(c.score), pageW - margin, y + 11, { align: "right" });
        y += rowH;
      });
      y += 14;
    }

    // Do vs Don't donut + Score verteilung side-by-side
    if (totalDos + totalDonts > 0 || validChats.length > 0) {
      ensureSpace(180);
      const boxH = 160;
      const halfW = (contentW - 16) / 2;
      const leftX = margin;
      const rightX = margin + halfW + 16;

      // Left: Do vs Don't donut
      setFill([250, 247, 238]);
      doc.roundedRect(leftX, y, halfW, boxH, 6, 6, "F");
      setText(INK);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text("Balance", leftX + 14, y + 20);
      setText(MUTED);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text("Stark vs. Wachstum", leftX + 14, y + 32);

      const total = totalDos + totalDonts || 1;
      const dosPct = totalDos / total;
      const donutCX = leftX + halfW - 55;
      const donutCY = y + boxH / 2 + 6;
      const donutR = 38;
      // Track
      drawArc(donutCX, donutCY, donutR, 0, 360, [230, 224, 205], 10);
      // Dos slice (green)
      if (dosPct > 0) drawArc(donutCX, donutCY, donutR, -90, -90 + 360 * dosPct, [60, 120, 70], 10);
      // Donts slice (gold)
      if (dosPct < 1) drawArc(donutCX, donutCY, donutR, -90 + 360 * dosPct, 270, GOLD, 10);
      setText(INK);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text(`${Math.round(dosPct * 100)}%`, donutCX, donutCY + 4, { align: "center" });
      setText(MUTED);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.text("stark", donutCX, donutCY + 16, { align: "center" });
      // Legend
      setFill([60, 120, 70]);
      doc.circle(leftX + 18, y + 60, 3, "F");
      setText(INK);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(`Stark  ${totalDos}`, leftX + 28, y + 63);
      setFill(GOLD);
      doc.circle(leftX + 18, y + 80, 3, "F");
      setText(INK);
      doc.text(`Wachstum  ${totalDonts}`, leftX + 28, y + 83);

      // Right: score distribution buckets
      setFill([250, 247, 238]);
      doc.roundedRect(rightX, y, halfW, boxH, 6, 6, "F");
      setText(INK);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text("Verteilung", rightX + 14, y + 20);
      setText(MUTED);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text("Wie deine Chats streuen", rightX + 14, y + 32);

      const buckets = [
        { label: "0–49", color: [180, 90, 60] as [number, number, number], count: validChats.filter((c) => c.score < 50).length },
        { label: "50–74", color: GOLD, count: validChats.filter((c) => c.score >= 50 && c.score < 75).length },
        { label: "75+", color: [60, 120, 70] as [number, number, number], count: validChats.filter((c) => c.score >= 75).length },
      ];
      const maxCount = Math.max(1, ...buckets.map((b) => b.count));
      const chartInnerW = halfW - 28;
      const barSlot = chartInnerW / 3;
      const barW = 36;
      const baseY = y + boxH - 30;
      const maxBarH = boxH - 70;
      buckets.forEach((b, i) => {
        const bx = rightX + 14 + i * barSlot + (barSlot - barW) / 2;
        const bh = (b.count / maxCount) * maxBarH;
        setFill(b.color);
        doc.roundedRect(bx, baseY - bh, barW, bh, 3, 3, "F");
        setText(INK);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.text(String(b.count), bx + barW / 2, baseY - bh - 6, { align: "center" });
        setText(MUTED);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.text(b.label, bx + barW / 2, baseY + 14, { align: "center" });
      });

      y += boxH + 16;
    }
  }

  // Personal intro
  const intro = input.result.personal_intro?.trim();
  if (intro) {
    sectionHeading("Persönliche Nachricht", `Hi ${input.chatter_name},`);
    writeText(intro, { size: 11, lineHeight: 1.5, gapAfter: 10 });
  }


  // Executive summary
  if (input.result.executive_summary) {
    goldCard("Kern der Analyse", input.result.executive_summary);
  }

  // Roadmap — the "Fahrplan"
  if (input.result.top_focus?.length) {
    sectionHeading("Dein Fahrplan", "Die 3 Schritte, mit denen du sofort mehr verdienst");
    input.result.top_focus.forEach((f, i) => {
      ensureSpace(60);
      const stepY = y;
      // Numbered gold disc
      setFill(GOLD);
      doc.circle(margin + 14, stepY + 6, 14, "F");
      setText(PAPER);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text(String(i + 1), margin + 14, stepY + 10, { align: "center" });
      // Step body
      writeText(f, { size: 11, indent: 40, lineHeight: 1.5, gapAfter: 14 });
      // Faint connector line between steps (except last)
      if (i < (input.result.top_focus?.length ?? 0) - 1) {
        setDraw(HAIRLINE);
        doc.setLineWidth(0.4);
        doc.line(margin + 14, y - 8, margin + 14, y - 2);
      }
    });
    y += 6;
  }



  // Per-chat
  if (input.result.chats?.length) {
    sectionHeading("Chat-für-Chat", "Deep-Dive in deine Gespräche");
    for (const c of input.result.chats) {
      ensureSpace(140);
      y += 6;
      // Hairline separator between chats
      setDraw(HAIRLINE);
      doc.setLineWidth(0.4);
      doc.line(margin, y, pageW - margin, y);
      y += 22;
      // Customer name (wrap if too long) with score aligned right
      setText(INK);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      const scoreLabel = typeof c.score === "number" ? `${c.score}/100` : "";
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      const scoreW = scoreLabel ? doc.getTextWidth(scoreLabel) + 12 : 0;
      doc.setFontSize(14);
      const nameLines = doc.splitTextToSize(c.customer_username ?? "Kunde", contentW - scoreW) as string[];
      doc.text(nameLines[0], margin, y);
      if (scoreLabel) {
        setText(GOLD);
        doc.setFontSize(12);
        doc.text(scoreLabel, pageW - margin, y, { align: "right" });
      }
      y += 20;

      if (c.error) {
        writeText(`Hinweis: ${c.error}`, { size: 9, color: MUTED, gapAfter: 10 });
        continue;
      }

      // Chat-Kontext: worum ging es überhaupt in diesem Chat
      if (c.chat_context) {
        writeText("WORUM ES GING", { size: 7, bold: true, color: MUTED, gapAfter: 3 });
        writeText(c.chat_context, { size: 10, color: [55, 55, 55], lineHeight: 1.55, gapAfter: 10 });
      }

      if (c.one_line_verdict) {
        setFill([250, 246, 232]);
        doc.setFont("helvetica", "italic");
        doc.setFontSize(11);
        const vLines = doc.splitTextToSize(c.one_line_verdict, contentW - 24) as string[];
        const vh = vLines.length * 15 + 20;
        ensureSpace(vh + 4);
        doc.roundedRect(margin, y, contentW, vh, 4, 4, "F");
        setFill(GOLD);
        doc.rect(margin, y, 3, vh, "F");
        let vy = y + 15;
        setText(INK);
        for (const l of vLines) { doc.text(l, margin + 18, vy); vy += 15; }
        y += vh + 10;
      }

      if (c.pricing_check) {
        writeText("PRICING", { size: 8, bold: true, color: GOLD, gapAfter: 3 });
        writeText(c.pricing_check, { size: 10, lineHeight: 1.55, gapAfter: 12 });
      }

      if (c.dos?.length) {
        writeText("STARK GEMACHT", { size: 8, bold: true, color: [60, 120, 70], gapAfter: 6 });
        for (const d of c.dos) {
          quoteBlock({
            situation: d.situation,
            quote: d.quote,
            accent: [60, 120, 70],
            verdictLabel: "Warum das stark war",
            verdictText: d.why_good,
          });
        }
        y += 4;
      }

      if (c.donts?.length) {
        writeText("WACHSTUMSPOTENZIAL", { size: 8, bold: true, color: GOLD, gapAfter: 6 });
        for (const d of c.donts) {
          quoteBlock({
            situation: d.situation,
            quote: d.quote,
            accent: GOLD,
            verdictLabel: "Was hier Cash liegen lässt",
            verdictText: d.problem,
            extraLabel: "Beim nächsten Mal so",
            extraText: `\u201E${d.better}\u201C`,
            extraAccent: [60, 120, 70],
          });
        }
        y += 4;
      }

      if (c.revenue_levers?.length) {
        writeText("DEINE HEBEL", { size: 8, bold: true, color: GOLD, gapAfter: 4 });
        for (const l of c.revenue_levers) {
          writeText(`- ${l}`, { size: 10, indent: 10, gapAfter: 3, lineHeight: 1.5 });
        }
      }
      y += 18;

    }
  }

  // Closing
  const closing = input.result.personal_closing?.trim();
  if (closing) {
    sectionHeading("Und jetzt du", "Dein nächster Schritt");
    writeText(closing, { size: 11, lineHeight: 1.55, gapAfter: 10 });
    y += 6;
    setDraw(GOLD);
    doc.setLineWidth(0.8);
    doc.line(margin, y, margin + 40, y);
    y += 18;
    writeText("— SheX Coaching", { size: 10, italic: true, color: GOLD });
  }

  drawContentFooter();

  return doc.output("blob");
}

export async function saveAnalysis(input: {
  chatter_name: string;
  platform: string;
  model_username: string | null;
  date_from: string;
  date_to: string;
  result: AnalysisResult;
  pdf: Blob;
}): Promise<CoachingAnalysisRow> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Nicht eingeloggt");
  const ts = Date.now();
  const safeName = input.chatter_name.replace(/[^a-zA-Z0-9-_]/g, "_");
  const pdfPath = `${user.id}/${input.platform}_${safeName}_${ts}.pdf`;

  const { error: upErr } = await supabase.storage
    .from("coaching-pdfs")
    .upload(pdfPath, input.pdf, { contentType: "application/pdf", upsert: false });
  if (upErr) throw upErr;

  const { data, error } = await supabase
    .from("coaching_analyses")
    .insert({
      user_id: user.id,
      chatter_name: input.chatter_name,
      platform: input.platform,
      model_username: input.model_username,
      date_from: input.date_from,
      date_to: input.date_to,
      pdf_path: pdfPath,
      summary_json: input.result as any,
      chats_analyzed: input.result.chats_analyzed,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as CoachingAnalysisRow;
}

export async function downloadAnalysisPDF(pdfPath: string): Promise<Blob> {
  const { data, error } = await supabase.storage.from("coaching-pdfs").download(pdfPath);
  if (error) throw error;
  return data;
}

export async function deleteAnalysis(row: CoachingAnalysisRow) {
  await supabase.storage.from("coaching-pdfs").remove([row.pdf_path]);
  const { error } = await supabase.from("coaching_analyses").delete().eq("id", row.id);
  if (error) throw error;
}
