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

export interface Lever {
  icon_hint?: string;
  title: string;
  principle: string;
  wrong_example: string;
  better_example: string;
  if_then_script: string;
  story?: string;
  money_example?: string;
}

export interface SBIStrength {
  situation: string;
  behavior: string;
  impact: string;
}

export interface SBIGrowth extends SBIStrength {
  alternative_if_then: string;
}

export interface AnalysisResult {
  overall_score: number | null;
  chats_analyzed: number;
  chats_total?: number;
  // New focused schema
  personal_intro?: string;
  headline_promise?: string;
  weekly_comparison?: {
    current_revenue_eur?: number;
    previous_revenue_eur?: number;
    delta_pct?: number | null;
    headline?: string;
    summary?: string;
  } | null;
  top_3_levers?: Lever[];
  sbi_feedback?: { strength: SBIStrength; growth: SBIGrowth } | null;
  micro_action?: string;
  retrieval_question?: string;
  // Legacy fields kept optional for old saved analyses
  executive_summary?: string;
  personal_closing?: string;
  top_focus?: string[];
  patterns?: any[];
  chats?: any[];
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

export async function fetchChatsForAnalysis(input: {
  chatter_name: string;
  platform: string;
  model_username: string | null;
  date_from: string;
  date_to: string;
  onStage?: (stage: string) => void;
}): Promise<any[]> {
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
    const modelList = requestIds.map((r) => r.username).join(", ");
    throw new Error(
      `Für ${modelList} wurden im Zeitraum ${input.date_from} – ${input.date_to} keine Chats gefunden. Bitte Zeitraum vergrößern oder anderes Model wählen.`,
    );
  }

  return aggregated;
}

export async function analyzeChats(input: {
  chatter_name: string;
  platform: string;
  model_username: string | null;
  date_from: string;
  date_to: string;
  chats: any[];
  onStage?: (stage: string) => void;
}): Promise<AnalysisResult> {
  input.onStage?.(`Analysiere ${input.chats.length} Chats mit KI…`);
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
      chats: input.chats,
    }),
  });
  const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json as AnalysisResult;
}

export async function runAnalysis(input: {
  chatter_name: string;
  platform: string;
  model_username: string | null;
  date_from: string;
  date_to: string;
  onStage?: (stage: string) => void;
}): Promise<AnalysisResult> {
  const chats = await fetchChatsForAnalysis(input);
  return analyzeChats({ ...input, chats });
}

/* ---------------- PDF rendering — Black & Gold ---------------- */

const GOLD: [number, number, number] = [201, 168, 76];      // #C9A84C
const GOLD_SOFT: [number, number, number] = [232, 208, 138]; // lighter accent
const INK: [number, number, number] = [22, 22, 22];          // near-black
const PAPER: [number, number, number] = [252, 251, 247];     // warm off-white
const MUTED: [number, number, number] = [110, 110, 110];
const HAIRLINE: [number, number, number] = [220, 214, 196];

// --- Typographic scale (points) — used across the whole document ---
const T = {
  MICRO: 7.5,        // footer, tiny meta
  META: 8,           // in-card labels, meta trio labels
  CAPTION: 9,        // eyebrow / kicker (uppercase, tracked bold gold)
  BODY_SM: 10,       // secondary body
  BODY: 11,          // default body
  LEAD: 13,          // intro paragraph, script emphasis
  CARD_TITLE: 15,    // lever card title
  H3: 18,            // in-page section subheads
  H2: 22,            // page primary heading
  H1: 30,            // large heading
  DISPLAY: 46,       // cover name
};

// --- Spacing scale (points) — vertical rhythm ---
const S = {
  XS: 6,
  SM: 10,
  MD: 16,
  LG: 24,
  XL: 32,
};

// --- Card style constants ---
const CARD_RADIUS = 8;
const CARD_PAD = 20;
const CARD_ACCENT_W = 3;



export async function renderAnalysisPDF(input: {
  chatter_name: string;
  platform: string;
  model_username: string | null;
  date_from: string;
  date_to: string;
  result: AnalysisResult;
}): Promise<Blob> {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 56;
  const contentW = pageW - margin * 2;

  const fonts = await ensurePdfFonts(doc);
  const TEXT_FAM = fonts.hasText ? "NotoSans" : "helvetica";
  const EMOJI_FAM = fonts.hasEmoji ? "NotoEmoji" : TEXT_FAM;

  // Sanitize — normalize dashes/nbsp AND strip all emoji/pictographic sequences.
  // Noto Emoji (monochrome TTF) does not shape ZWJ/VS16 compound emoji correctly
  // in jsPDF, which produced the "komisches Spiel" of stray glyphs. Safer to drop.
  const EMOJI_STRIP =
    /(?:\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*)+/gu;
  const sanitize = (s: string): string =>
    (s ?? "")
      .replace(EMOJI_STRIP, "")
      .replace(/[\u2013\u2014]/g, "-")
      .replace(/[\u00A0]/g, " ")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\s+([,.;:!?])/g, "$1")
      .trim();

  const originalText = doc.text.bind(doc);
  (doc as any).__richTextOriginalText = originalText;

  // Override doc.text and splitTextToSize so every existing layout call
  // renders emoji-safely via the mixed-font rich text pipeline.
  const styleOf = (): "normal" | "bold" | "italic" | "bolditalic" => {
    const s = (doc as any).internal?.getFont?.()?.fontStyle ?? "normal";
    if (s === "bold" || s === "italic" || s === "bolditalic" || s === "normal") return s;
    return "normal";
  };
  const sizeOf = (): number => doc.getFontSize();
  // Validation: any rendered text that leaves the safe content box gets recorded.
  // safe box = [margin - 4, pageW - margin + 4] horizontally,
  //            [margin - 30, pageH - margin + 12] vertically (small tolerance for headers/footers).
  const layoutIssues: { page: number; kind: string; detail: string }[] = [];
  const RIGHT_LIMIT = pageW - margin + 4;
  const LEFT_LIMIT = margin - 6;
  const BOTTOM_LIMIT = pageH - margin + 14;
  const measureLine = (s: string): number => (doc as any).getTextWidth(s);

  (doc as any).text = (text: any, x: number, y: number, opts?: any) => {
    const lines = Array.isArray(text) ? text : [text];
    const align = opts?.align as "left" | "right" | "center" | undefined;
    const lh = sizeOf() * 1.15;
    lines.forEach((ln: any, i: number) => {
      const safe = sanitize(String(ln));
      const yy = y + i * lh;
      drawRichLine(doc, safe, x, yy, {
        size: sizeOf(),
        style: styleOf(),
        textFamily: TEXT_FAM,
        emojiFamily: EMOJI_FAM,
        align,
      });
      // Overflow check (skip empty strings and cover-page decor above margin)
      if (safe && yy > margin - 30) {
        const w = measureLine(safe);
        let left = x;
        if (align === "right") left = x - w;
        else if (align === "center") left = x - w / 2;
        const right = left + w;
        const pageNum = (doc as any).internal?.getCurrentPageInfo?.()?.pageNumber ?? 0;
        if (right > RIGHT_LIMIT) {
          layoutIssues.push({
            page: pageNum,
            kind: "right-overflow",
            detail: `"${safe.slice(0, 60)}" ragt ${(right - RIGHT_LIMIT).toFixed(1)}pt über den rechten Rand.`,
          });
        }
        if (left < LEFT_LIMIT) {
          layoutIssues.push({
            page: pageNum,
            kind: "left-overflow",
            detail: `"${safe.slice(0, 60)}" ragt ${(LEFT_LIMIT - left).toFixed(1)}pt über den linken Rand.`,
          });
        }
        if (yy > BOTTOM_LIMIT) {
          layoutIssues.push({
            page: pageNum,
            kind: "bottom-overflow",
            detail: `"${safe.slice(0, 60)}" liegt ${(yy - BOTTOM_LIMIT).toFixed(1)}pt unterhalb des Content-Bereichs (abgeschnitten).`,
          });
        }
      }
    });
    return doc;
  };
  (doc as any).splitTextToSize = (text: any, w: number) =>
    wrapRich(doc, sanitize(String(text)), w, {
      size: sizeOf(),
      style: styleOf(),
      textFamily: TEXT_FAM,
      emojiFamily: EMOJI_FAM,
    });
  // Also patch getTextWidth to account for emoji glyphs when present.
  const _getTextWidth = doc.getTextWidth.bind(doc);
  (doc as any).getTextWidth = (s: string) => {
    const segs = segmentText(sanitize(String(s)));
    let total = 0;
    const style = styleOf();
    const size = sizeOf();
    for (const seg of segs) {
      doc.setFont(seg.emoji ? EMOJI_FAM : TEXT_FAM, seg.emoji ? "normal" : style);
      doc.setFontSize(size);
      total += _getTextWidth(seg.text);
    }
    doc.setFont(TEXT_FAM, style);
    doc.setFontSize(size);
    return total;
  };


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


  // ==============================================================
  // NEW 6-PAGE FOCUSED LAYOUT
  // Cover → 3 Levers overview → Lever 1 deep dive → Lever 2+3 →
  // SBI Feedback → Action Plan
  // ==============================================================

  const result = input.result;
  const levers: Lever[] = Array.isArray(result.top_3_levers) ? result.top_3_levers.slice(0, 3) : [];
  const sbi = result.sbi_feedback ?? null;
  const score = result.overall_score;

  // ---------- helpers reused across pages ----------
  const paintPaper = () => paintBackground(PAPER);

  const drawPageHeader = () => {
    setText(GOLD);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("SheX", margin, margin - 22);
    setText(MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text("COACHING REPORT", margin + 34, margin - 22);
    const headerName = doc.splitTextToSize(input.chatter_name, contentW / 2)[0] ?? input.chatter_name;
    doc.text(headerName, pageW - margin, margin - 22, { align: "right" });
    setDraw(HAIRLINE);
    doc.setLineWidth(0.4);
    doc.line(margin, margin - 14, pageW - margin, margin - 14);
  };

  const drawContentFooter = (pageLabel: string) => {
    setDraw(HAIRLINE);
    doc.setLineWidth(0.4);
    doc.line(margin, pageH - margin, pageW - margin, pageH - margin);
    setText(MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text("SheX Coaching", margin, pageH - margin + 12);
    doc.text(pageLabel, pageW - margin, pageH - margin + 12, { align: "right" });
  };

  const newContentPage = () => {
    doc.addPage();
    paintPaper();
    drawPageHeader();
  };

  const wrapLines = (text: string, w: number, size: number, style: "normal" | "bold" | "italic" = "normal") => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    return doc.splitTextToSize(text ?? "", w) as string[];
  };

  const drawText = (
    text: string,
    x: number,
    yy: number,
    opts: { size?: number; style?: "normal" | "bold" | "italic"; color?: [number, number, number]; align?: "left" | "right" | "center" } = {},
  ) => {
    doc.setFont("helvetica", opts.style ?? "normal");
    doc.setFontSize(opts.size ?? 10);
    setText(opts.color ?? INK);
    doc.text(text, x, yy, opts.align ? { align: opts.align } : undefined);
  };

  // Draws one line and auto-shrinks font size so it fits maxWidth (never overflows).
  const drawFitText = (
    text: string,
    x: number,
    yy: number,
    maxWidth: number,
    opts: { size: number; minSize?: number; style?: "normal" | "bold" | "italic"; color?: [number, number, number]; align?: "left" | "right" | "center" },
  ) => {
    const minSize = opts.minSize ?? Math.max(9, Math.floor(opts.size * 0.6));
    let size = opts.size;
    doc.setFont("helvetica", opts.style ?? "normal");
    doc.setFontSize(size);
    while (size > minSize && doc.getTextWidth(text) > maxWidth) {
      size -= 1;
      doc.setFontSize(size);
    }
    setText(opts.color ?? INK);
    doc.text(text, x, yy, opts.align ? { align: opts.align } : undefined);
  };

  // Standardized page intro: gold rule → CAPTION kicker → H2 title → optional italic subtitle.
  // Guarantees the same visual rhythm and hierarchy on every content page.
  const pageIntro = (
    startY: number,
    kicker: string,
    title: string,
    subtitle?: string,
  ): number => {
    let cy = startY;
    setDraw(GOLD);
    doc.setLineWidth(0.7);
    doc.line(margin, cy, margin + 44, cy);
    cy += 20;
    drawText(kicker.toUpperCase(), margin, cy, {
      size: T.CAPTION, style: "bold", color: GOLD,
    });
    cy += 22;
    drawText(title, margin, cy, { size: T.H2, style: "bold", color: INK });
    cy += subtitle ? 24 : 28;
    if (subtitle) {
      const lines = wrapLines(subtitle, contentW, T.BODY, "italic");
      lines.slice(0, 2).forEach((l) => {
        drawText(l, margin, cy, { size: T.BODY, style: "italic", color: MUTED });
        cy += 16;
      });
      cy += S.SM;
    }
    return cy;
  };



  // ========== PAGE 1 — Cover ==========
  paintBackground(INK);
  setDraw(GOLD);
  doc.setLineWidth(0.5);
  doc.rect(margin - 20, margin - 20, contentW + 40, pageH - (margin - 20) * 2);

  // Wordmark
  drawText("SheX", margin, margin + 20, { size: 28, style: "bold", color: GOLD });
  drawText("COACHING REPORT", pageW - margin, margin + 20, { size: 7.5, color: GOLD_SOFT, align: "right" });
  setDraw([90, 78, 40]);
  doc.setLineWidth(0.4);
  doc.line(margin, margin + 34, pageW - margin, margin + 34);

  // Kicker
  drawText("PERSÖNLICHE ANALYSE FÜR", pageW / 2, margin + 110, { size: 9, color: GOLD_SOFT, align: "center" });

  // Chatter name — adaptive size
  doc.setFont("helvetica", "bold");
  let nameSize = 42;
  doc.setFontSize(nameSize);
  while (nameSize > 22 && doc.getTextWidth(input.chatter_name) > contentW - 40) {
    nameSize -= 2;
    doc.setFontSize(nameSize);
  }
  setText([245, 240, 224]);
  doc.text(input.chatter_name, pageW / 2, margin + 150, { align: "center" });

  // Gold rule — clear separation below descenders
  setDraw(GOLD);
  doc.setLineWidth(1);
  doc.line(pageW / 2 - 32, margin + 172, pageW / 2 + 32, margin + 172);

  // Headline promise — the ONE promise
  const promise = (result.headline_promise ?? "Diese 3 Moves bringen dir mehr Verkäufe.").trim();
  const promiseLines = wrapLines(promise, contentW - 40, 15, "italic");
  let promiseY = margin + 210;
  promiseLines.slice(0, 3).forEach((l) => {
    drawText(l, pageW / 2, promiseY, { size: 15, style: "italic", color: [235, 230, 215], align: "center" });
    promiseY += 22;
  });

  // Weekly comparison card — Cover
  const wc = result.weekly_comparison;
  if (wc && (wc.summary || typeof wc.current_revenue_eur === "number")) {
    const cardW = Math.min(420, contentW - 20);
    const cardH = 140;
    const cardX = (pageW - cardW) / 2;
    const cardY = margin + 265;
    setDraw(GOLD);
    doc.setLineWidth(0.5);
    setFill([28, 22, 10]);
    doc.roundedRect(cardX, cardY, cardW, cardH, 8, 8, "FD");

    drawText("VERGLEICH ZUR VORPERIODE", cardX + cardW / 2, cardY + 15, {
      size: 7.5, style: "bold", color: GOLD_SOFT, align: "center",
    });

    const rangeDays = Math.max(
      1,
      Math.round(
        (new Date(input.date_to).getTime() - new Date(input.date_from).getTime()) /
          (1000 * 60 * 60 * 24),
      ) + 1,
    );
    drawText(
      `(die ${rangeDays} Tage direkt davor, gleiche Länge)`,
      cardX + cardW / 2,
      cardY + 26,
      { size: 6.5, style: "italic", color: [150, 140, 110], align: "center" },
    );

    const delta = wc.delta_pct;
    const deltaLabel = delta === null || delta === undefined
      ? "—"
      : `${delta > 0 ? "+" : ""}${delta}%`;
    const deltaColor: [number, number, number] = delta === null || delta === undefined
      ? [200, 190, 160]
      : delta >= 0 ? [140, 220, 160] : [235, 150, 120];
    drawText(deltaLabel, cardX + cardW / 2, cardY + 56, {
      size: 26, style: "bold", color: deltaColor, align: "center",
    });

    const head = (wc.headline ?? "").trim();
    if (head) {
      drawText(head, cardX + cardW / 2, cardY + 74, {
        size: 9.5, style: "bold", color: [235, 230, 215], align: "center",
      });
    }

    const cur = typeof wc.current_revenue_eur === "number" ? Math.round(wc.current_revenue_eur) : null;
    const prev = typeof wc.previous_revenue_eur === "number" ? Math.round(wc.previous_revenue_eur) : null;
    const colY = cardY + 92;
    const leftCx = cardX + cardW * 0.28;
    const rightCx = cardX + cardW * 0.72;

    drawText("DIESE PERIODE", leftCx, colY, {
      size: 6.5, style: "bold", color: GOLD_SOFT, align: "center",
    });
    drawText(cur === null ? "—" : `${cur.toLocaleString("de-DE")}€`, leftCx, colY + 14, {
      size: 13, style: "bold", color: [235, 230, 215], align: "center",
    });

    setDraw([90, 78, 40]);
    doc.setLineWidth(0.3);
    doc.line(cardX + cardW / 2, colY - 4, cardX + cardW / 2, colY + 22);

    drawText("VORPERIODE", rightCx, colY, {
      size: 6.5, style: "bold", color: GOLD_SOFT, align: "center",
    });
    drawText(prev === null ? "—" : `${prev.toLocaleString("de-DE")}€`, rightCx, colY + 14, {
      size: 13, style: "bold", color: [200, 190, 160], align: "center",
    });

    const sum = (wc.summary ?? "").trim();
    if (sum) {
      const sumLines = wrapLines(sum, cardW - 28, 8);
      drawText(sumLines[0] ?? "", cardX + cardW / 2, cardY + cardH - 8, {
        size: 8, style: "italic", color: [200, 190, 160], align: "center",
      });
    }
  }

  // Small dezent gauge — lower, smaller than before
  if (score !== null && score !== undefined) {
    const cx = pageW / 2;
    const gCy = pageH - margin - 180;
    const r = 46;
    drawArc(cx, gCy, r, 135, 405, [55, 45, 20], 6);
    const pct = Math.max(0, Math.min(100, score)) / 100;
    drawArc(cx, gCy, r, 135, 135 + 270 * pct, GOLD, 6);
    drawText(String(score), cx, gCy + 8, { size: 30, style: "bold", color: GOLD, align: "center" });
    drawText("SCORE VON 100", cx, gCy + 24, { size: 7, color: GOLD_SOFT, align: "center" });
  }

  // Meta trio
  const metaY = pageH - margin - 80;
  const col = contentW / 3;
  const metaCell = (label: string, value: string, i: number) => {
    drawText(label.toUpperCase(), margin + col * i + col / 2, metaY, { size: 7, style: "bold", color: GOLD_SOFT, align: "center" });
    const lines = wrapLines(value, col - 16, 10);
    lines.slice(0, 2).forEach((l, li) =>
      drawText(l, margin + col * i + col / 2, metaY + 16 + li * 13, { size: 10, color: [235, 230, 215], align: "center" }),
    );
  };
  metaCell("Model", input.model_username ?? "-", 0);
  metaCell("Plattform", input.platform, 1);
  metaCell("Zeitraum", `${input.date_from} — ${input.date_to}`, 2);

  setDraw([90, 78, 40]);
  doc.setLineWidth(0.3);
  doc.line(margin, pageH - margin - 30, pageW - margin, pageH - margin - 30);
  drawText(
    `${result.chats_analyzed} Chats analysiert · vertraulich · nur für dich`,
    pageW / 2,
    pageH - margin - 14,
    { size: 7.5, color: [150, 140, 110], align: "center" },
  );

  // ========== PAGE 2 — Persönliche Nachricht + 3 Hebel Übersicht ==========
  newContentPage();
  let y = margin + 4;

  // Personal intro
  const intro = (result.personal_intro ?? "").trim();
  if (intro) {
    drawText("HI " + input.chatter_name.toUpperCase() + ",", margin, y + 8, { size: 8, style: "bold", color: GOLD });
    y += 22;
    const introLines = wrapLines(intro, contentW, 12);
    for (const l of introLines) {
      drawText(l, margin, y, { size: 12, color: INK });
      y += 18;
    }
    y += 14;
  }

  // Section: "Deine 3 Hebel"
  y = pageIntro(
    y,
    "Dein Fokus",
    "Diese 3 Hebel bringen dir am meisten",
    "Alles andere ist Bonus. Fang mit Hebel 1 an — der bringt am meisten Cash.",
  );


  if (levers.length === 0) {
    drawText("Noch keine Hebel gefunden. Prüfe ob genug Chats geladen wurden.", margin, y, { size: 11, color: MUTED });
  } else {
    // 3 compact cards stacked
    const cardH = 88;
    levers.forEach((lev, i) => {
      const cardY = y;
      setFill([250, 247, 238]);
      doc.roundedRect(margin, cardY, contentW, cardH, CARD_RADIUS, CARD_RADIUS, "F");
      setFill(GOLD);
      doc.rect(margin, cardY, CARD_ACCENT_W, cardH, "F");
      // Number disc
      setFill(INK);
      doc.circle(margin + 28, cardY + 26, 13, "F");
      drawText(String(i + 1), margin + 28, cardY + 30, { size: T.LEAD, style: "bold", color: GOLD, align: "center" });
      // Title
      drawFitText(lev.title ?? "-", margin + 52, cardY + 24, contentW - 68, {
        size: T.CARD_TITLE, style: "bold", color: INK,
      });
      // Principle
      const principleLines = wrapLines(lev.principle ?? "", contentW - 68, T.BODY_SM);
      let py = cardY + 46;
      principleLines.slice(0, 3).forEach((l) => {
        drawText(l, margin + 52, py, { size: T.BODY_SM, color: [70, 70, 70] });
        py += 14;
      });
      y = cardY + cardH + S.MD;
    });
  }


  drawContentFooter("Seite 2 · Deine 3 Hebel");

  // ========== PAGES 3+ — one page per lever (Hebel 1 full, Hebel 2+3 combined) ==========
  const renderLeverDetail = (lev: Lever, index: number, compact = false) => {
    const startY = y;
    // Kicker + title (matches pageIntro rhythm)
    setDraw(GOLD);
    doc.setLineWidth(0.7);
    doc.line(margin, startY, margin + 44, startY);
    y = startY + 20;
    drawText(`HEBEL ${index + 1}`, margin, y, { size: T.CAPTION, style: "bold", color: GOLD });
    y += 22;
    drawFitText(lev.title ?? "-", margin, y, contentW, {
      size: compact ? T.H3 : T.H2, style: "bold", color: INK,
    });
    y += compact ? 24 : 28;

    // Principle
    const principleSize = compact ? T.BODY_SM : T.BODY;
    const pLines = wrapLines(lev.principle ?? "", contentW, principleSize);
    for (const l of pLines) {
      drawText(l, margin, y, { size: principleSize, color: [60, 60, 60] });
      y += compact ? 14 : 16;
    }
    y += S.SM;

    // Wrong → Better side-by-side (equal padding, uniform radius/kicker)
    const gap = 14;
    const halfW = (contentW - gap) / 2;
    const innerPad = 16;
    const wrongLines = wrapLines(`„${lev.wrong_example ?? ""}"`, halfW - innerPad * 2, T.BODY_SM, "italic");
    const betterLines = wrapLines(`„${lev.better_example ?? ""}"`, halfW - innerPad * 2, T.BODY_SM, "italic");
    const rowH = 14;
    const boxH = Math.max(wrongLines.length, betterLines.length) * rowH + 46;

    // Wrong box
    setFill([250, 244, 240]);
    doc.roundedRect(margin, y, halfW, boxH, CARD_RADIUS, CARD_RADIUS, "F");
    setFill([180, 90, 60]);
    doc.rect(margin, y, CARD_ACCENT_W, boxH, "F");
    drawText("STATT SO", margin + innerPad, y + 18, {
      size: T.META, style: "bold", color: [180, 90, 60],
    });
    let wy = y + 36;
    wrongLines.forEach((l) => {
      drawText(l, margin + innerPad, wy, { size: T.BODY_SM, style: "italic", color: INK });
      wy += rowH;
    });

    // Better box
    const bx = margin + halfW + gap;
    setFill([242, 250, 244]);
    doc.roundedRect(bx, y, halfW, boxH, CARD_RADIUS, CARD_RADIUS, "F");
    setFill([60, 120, 70]);
    doc.rect(bx, y, CARD_ACCENT_W, boxH, "F");
    drawText("BESSER SO", bx + innerPad, y + 18, {
      size: T.META, style: "bold", color: [60, 120, 70],
    });
    let by = y + 36;
    betterLines.forEach((l) => {
      drawText(l, bx + innerPad, by, { size: T.BODY_SM, style: "italic", color: INK });
      by += rowH;
    });

    y += boxH + S.MD;

    // If-Then script — highlighted
    if (lev.if_then_script) {
      const scriptLines = wrapLines(lev.if_then_script, contentW - CARD_PAD * 2, T.BODY, "bold");
      const sh = scriptLines.length * 16 + 40;
      setFill(INK);
      doc.roundedRect(margin, y, contentW, sh, CARD_RADIUS, CARD_RADIUS, "F");
      drawText("DEIN SKRIPT ZUM MERKEN", margin + CARD_PAD, y + 20, {
        size: T.META, style: "bold", color: GOLD,
      });
      let sy = y + 40;
      scriptLines.forEach((l) => {
        drawText(l, margin + CARD_PAD, sy, { size: T.BODY, style: "bold", color: [245, 240, 224] });
        sy += 16;
      });
      y += sh + S.MD;
    }

    // Story — mini narrative that makes it click ("das kenn ich, das will ich auch")
    if (lev.story) {
      const storyLines = wrapLines(lev.story, contentW - CARD_PAD * 2, T.BODY_SM, "italic");
      const storyH = storyLines.length * 14 + 44;
      setFill([250, 247, 238]);
      doc.roundedRect(margin, y, contentW, storyH, CARD_RADIUS, CARD_RADIUS, "F");
      setFill(GOLD);
      doc.rect(margin, y, CARD_ACCENT_W, storyH, "F");
      drawText("SO LIEF DAS SCHON MAL", margin + CARD_PAD, y + 20, {
        size: T.META, style: "bold", color: GOLD,
      });
      let sty = y + 40;
      storyLines.forEach((l) => {
        drawText(l, margin + CARD_PAD, sty, { size: T.BODY_SM, style: "italic", color: INK });
        sty += 14;
      });
      y += storyH + S.MD;
    }

    // Money example — concrete cash potential ("so viel mehr wäre drin gewesen")
    if (lev.money_example) {
      const moneyLines = wrapLines(lev.money_example, contentW - CARD_PAD * 2 - 16, T.BODY_SM);
      const moneyH = moneyLines.length * 14 + 44;
      setFill([28, 22, 10]);
      doc.roundedRect(margin, y, contentW, moneyH, CARD_RADIUS, CARD_RADIUS, "F");
      setFill(GOLD);
      doc.rect(margin, y, CARD_ACCENT_W, moneyH, "F");
      drawText("WAS DAS BEDEUTET", margin + CARD_PAD, y + 20, {
        size: T.META, style: "bold", color: GOLD,
      });
      let my = y + 40;
      moneyLines.forEach((l) => {
        drawText(l, margin + CARD_PAD, my, { size: T.BODY_SM, color: [245, 240, 224] });
        my += 14;
      });
      y += moneyH + S.MD;
    }
  };


  // Pages 3+ — one full page per Hebel (prevents overflow of script/story/money blocks)
  let leverPageNum = 3;
  for (let i = 0; i < levers.length && i < 3; i++) {
    newContentPage();
    y = margin + 4;
    renderLeverDetail(levers[i], i, false);
    drawContentFooter(`Seite ${leverPageNum} · Hebel ${i + 1}`);
    leverPageNum++;
  }

  // ========== PAGE 5 — SBI Feedback ==========
  newContentPage();
  y = margin + 4;

  y = pageIntro(y, "Persönlich", "Was besonders auffiel");


  const sbiCard = (opts: {
    kicker: string;
    kickerColor: [number, number, number];
    situation: string;
    behavior: string;
    impact: string;
    ifThen?: string;
  }) => {
    const innerW = contentW - CARD_PAD * 2;
    const sitLines = wrapLines(opts.situation, innerW, T.BODY_SM);
    const behLines = wrapLines(opts.behavior, innerW, T.BODY_SM);
    const impLines = wrapLines(opts.impact, innerW, T.BODY_SM);
    const ifLines = opts.ifThen ? wrapLines(opts.ifThen, innerW - 12, T.BODY_SM, "bold") : [];
    const rowH = 13;
    const labelH = 14;
    const gap = S.SM;
    const ifBlockH = ifLines.length ? ifLines.length * 14 + 34 : 0;
    const cardH =
      22 + // top pad (kicker)
      labelH + sitLines.length * rowH + gap +
      labelH + behLines.length * rowH + gap +
      labelH + impLines.length * rowH + gap +
      (ifBlockH ? ifBlockH + 6 : 0) +
      16;

    setFill([250, 247, 238]);
    doc.roundedRect(margin, y, contentW, cardH, CARD_RADIUS, CARD_RADIUS, "F");
    setFill(opts.kickerColor);
    doc.rect(margin, y, CARD_ACCENT_W, cardH, "F");
    drawText(opts.kicker.toUpperCase(), margin + CARD_PAD, y + 22, {
      size: T.META, style: "bold", color: opts.kickerColor,
    });

    let cy = y + 44;
    const writeLabelled = (label: string, lines: string[]) => {
      drawText(label, margin + CARD_PAD, cy, { size: T.MICRO, style: "bold", color: MUTED });
      cy += 12;
      for (const l of lines) {
        drawText(l, margin + CARD_PAD, cy, { size: T.BODY_SM, color: INK });
        cy += rowH;
      }
      cy += gap;
    };
    writeLabelled("SITUATION", sitLines);
    writeLabelled("WAS DU GETAN HAST", behLines);
    writeLabelled("WAS DAS BEWIRKT HAT", impLines);

    if (ifLines.length) {
      setFill(INK);
      doc.roundedRect(margin + 12, cy - 2, contentW - 24, ifBlockH - 6, CARD_RADIUS - 2, CARD_RADIUS - 2, "F");
      drawText("SO BEIM NÄCHSTEN MAL", margin + 26, cy + 16, {
        size: T.META, style: "bold", color: GOLD,
      });
      let ify = cy + 34;
      ifLines.forEach((l) => {
        drawText(l, margin + 26, ify, { size: T.BODY_SM, style: "bold", color: [245, 240, 224] });
        ify += 14;
      });
    }

    y += cardH + S.MD;
  };


  if (sbi?.strength) {
    sbiCard({
      kicker: "Deine Stärke",
      kickerColor: [60, 120, 70],
      situation: sbi.strength.situation,
      behavior: sbi.strength.behavior,
      impact: sbi.strength.impact,
    });
  }
  if (sbi?.growth) {
    sbiCard({
      kicker: "Deine Wachstums-Chance",
      kickerColor: GOLD,
      situation: sbi.growth.situation,
      behavior: sbi.growth.behavior,
      impact: sbi.growth.impact,
      ifThen: sbi.growth.alternative_if_then,
    });
  }
  if (!sbi) {
    drawText("Kein Feedback verfügbar.", margin, y, { size: 11, color: MUTED });
  }

  drawContentFooter(`Seite ${leverPageNum} · Dein Feedback`);

  // ========== PAGE 6 — Action Plan + Tracker ==========
  newContentPage();
  y = margin + 4;

  y = pageIntro(
    y,
    "Dein nächster Schritt",
    "Eine Sache. Sieben Tage.",
    "Alles andere kommt später. Nur diese eine Handlung, jeden Tag.",
  );


  // Big micro-action card
  const action = (result.micro_action ?? "").trim() || "Vor jedem PPV-Angebot: erst 2 echte Fragen zum Kunden stellen.";
  const actionLines = wrapLines(action, contentW - CARD_PAD * 2, T.CARD_TITLE, "bold");
  const actionH = actionLines.length * 20 + 50;
  setFill(INK);
  doc.roundedRect(margin, y, contentW, actionH, CARD_RADIUS, CARD_RADIUS, "F");
  setFill(GOLD);
  doc.rect(margin, y, CARD_ACCENT_W, actionH, "F");
  drawText("MIKRO-AKTION FÜR DIESE WOCHE", margin + CARD_PAD, y + 22, {
    size: T.META, style: "bold", color: GOLD,
  });
  let ay = y + 46;
  actionLines.forEach((l) => {
    drawText(l, margin + CARD_PAD, ay, { size: T.CARD_TITLE, style: "bold", color: [245, 240, 224] });
    ay += 20;
  });
  y += actionH + S.LG;

  // Retrieval question
  if (result.retrieval_question) {
    setFill([250, 247, 238]);
    const qLines = wrapLines(result.retrieval_question, contentW - CARD_PAD * 2, T.LEAD, "italic");
    const qH = qLines.length * 18 + 48;
    doc.roundedRect(margin, y, contentW, qH, CARD_RADIUS, CARD_RADIUS, "F");
    setFill(GOLD);
    doc.rect(margin, y, CARD_ACCENT_W, qH, "F");
    drawText("FRAG DICH SELBST", margin + CARD_PAD, y + 22, {
      size: T.META, style: "bold", color: GOLD,
    });
    let qy = y + 42;
    qLines.forEach((l) => {
      drawText(l, margin + CARD_PAD, qy, { size: T.LEAD, style: "italic", color: INK });
      qy += 18;
    });
    y += qH + S.MD;
  }

  drawContentFooter(`Seite ${leverPageNum + 1} · Dein Fahrplan`);


  // --------- Automatische PDF-Validierung ---------
  // Blockiert den Download, wenn Text über den Rand ragt oder abgeschnitten ist.
  if (layoutIssues.length > 0) {
    const grouped = new Map<number, string[]>();
    for (const iss of layoutIssues) {
      if (!grouped.has(iss.page)) grouped.set(iss.page, []);
      grouped.get(iss.page)!.push(`  · [${iss.kind}] ${iss.detail}`);
    }
    const summary = Array.from(grouped.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([p, arr]) => `Seite ${p}:\n${arr.slice(0, 4).join("\n")}${arr.length > 4 ? `\n  · … +${arr.length - 4} weitere` : ""}`)
      .join("\n");
    console.warn("[coaching-pdf] Layout-Validierung fehlgeschlagen:", layoutIssues);
    const err = new Error(
      `PDF-Validierung fehlgeschlagen — ${layoutIssues.length} Layout-Problem(e). Datei wurde NICHT freigegeben.\n${summary}`,
    );
    (err as any).layoutIssues = layoutIssues;
    throw err;
  }

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
