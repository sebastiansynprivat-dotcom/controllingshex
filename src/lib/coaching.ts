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
    const modelList = requestIds.map((r) => r.username).join(", ");
    throw new Error(
      `Für ${modelList} wurden im Zeitraum ${input.date_from} – ${input.date_to} keine Chats gefunden. Bitte Zeitraum vergrößern oder anderes Model wählen.`,
    );
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
  drawText("PERSÖNLICHE ANALYSE FÜR", pageW / 2, margin + 100, { size: 9, color: GOLD_SOFT, align: "center" });

  // Chatter name — adaptive size
  doc.setFont("helvetica", "bold");
  let nameSize = 46;
  doc.setFontSize(nameSize);
  while (nameSize > 22 && doc.getTextWidth(input.chatter_name) > contentW - 20) {
    nameSize -= 2;
    doc.setFontSize(nameSize);
  }
  setText([245, 240, 224]);
  doc.text(input.chatter_name, pageW / 2, margin + 138, { align: "center" });

  // Gold rule
  setDraw(GOLD);
  doc.setLineWidth(1);
  doc.line(pageW / 2 - 30, margin + 152, pageW / 2 + 30, margin + 152);

  // Headline promise — the ONE promise
  const promise = (result.headline_promise ?? "Diese 3 Moves bringen dir mehr Verkäufe.").trim();
  const promiseLines = wrapLines(promise, contentW - 40, 15, "italic");
  let promiseY = margin + 190;
  promiseLines.slice(0, 3).forEach((l) => {
    drawText(l, pageW / 2, promiseY, { size: 15, style: "italic", color: [235, 230, 215], align: "center" });
    promiseY += 22;
  });

  // Weekly comparison card — Cover
  const wc = result.weekly_comparison;
  if (wc && (wc.summary || typeof wc.current_revenue_eur === "number")) {
    const cardW = Math.min(360, contentW - 40);
    const cardH = 78;
    const cardX = (pageW - cardW) / 2;
    const cardY = margin + 280;
    setDraw(GOLD);
    doc.setLineWidth(0.5);
    setFill([28, 22, 10]);
    doc.roundedRect(cardX, cardY, cardW, cardH, 6, 6, "FD");

    drawText("VS. VORPERIODE", cardX + cardW / 2, cardY + 14, {
      size: 7, style: "bold", color: GOLD_SOFT, align: "center",
    });

    const delta = wc.delta_pct;
    const deltaLabel = delta === null || delta === undefined
      ? "—"
      : `${delta > 0 ? "+" : ""}${delta}%`;
    const deltaColor: [number, number, number] = delta === null || delta === undefined
      ? [200, 190, 160]
      : delta >= 0 ? [140, 220, 160] : [235, 150, 120];
    drawText(deltaLabel, cardX + cardW / 2, cardY + 38, {
      size: 22, style: "bold", color: deltaColor, align: "center",
    });

    const head = (wc.headline ?? "").trim();
    if (head) {
      drawText(head, cardX + cardW / 2, cardY + 54, {
        size: 9, style: "bold", color: [235, 230, 215], align: "center",
      });
    }
    const sum = (wc.summary ?? "").trim();
    if (sum) {
      const sumLines = wrapLines(sum, cardW - 24, 8);
      drawText(sumLines[0] ?? "", cardX + cardW / 2, cardY + 68, {
        size: 8, color: [200, 190, 160], align: "center",
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
  setDraw(GOLD);
  doc.setLineWidth(0.6);
  doc.line(margin, y, pageW - margin, y);
  y += 14;
  drawText("DEIN FOKUS", margin, y, { size: 7.5, style: "bold", color: GOLD });
  y += 18;
  drawText("Diese 3 Hebel bringen dir am meisten", margin, y, { size: 18, style: "bold", color: INK });
  y += 26;
  drawText("Alles andere ist Bonus. Fang mit Hebel 1 an — der bringt am meisten Cash.", margin, y, { size: 10, color: MUTED, style: "italic" });
  y += 24;

  if (levers.length === 0) {
    drawText("Noch keine Hebel gefunden. Prüfe ob genug Chats geladen wurden.", margin, y, { size: 11, color: MUTED });
  } else {
    // 3 compact cards stacked
    const cardH = 82;
    levers.forEach((lev, i) => {
      const cardY = y;
      // background
      setFill([250, 247, 238]);
      doc.roundedRect(margin, cardY, contentW, cardH, 6, 6, "F");
      // gold left accent
      setFill(GOLD);
      doc.rect(margin, cardY, 3, cardH, "F");
      // Number disc
      setFill(INK);
      doc.circle(margin + 26, cardY + 24, 12, "F");
      drawText(String(i + 1), margin + 26, cardY + 28, { size: 12, style: "bold", color: GOLD, align: "center" });
      // Title
      drawFitText(lev.title ?? "-", margin + 48, cardY + 22, contentW - 60, { size: 13, style: "bold", color: INK });
      // Principle
      const principleLines = wrapLines(lev.principle ?? "", contentW - 60, 10);
      let py = cardY + 40;
      principleLines.slice(0, 3).forEach((l) => {
        drawText(l, margin + 48, py, { size: 10, color: [55, 55, 55] });
        py += 13;
      });
      y = cardY + cardH + 12;
    });
  }

  drawContentFooter("Seite 2 · Deine 3 Hebel");

  // ========== PAGES 3+ — one page per lever (Hebel 1 full, Hebel 2+3 combined) ==========
  const renderLeverDetail = (lev: Lever, index: number, compact = false) => {
    const startY = y;
    // Kicker + title
    setDraw(GOLD);
    doc.setLineWidth(0.6);
    doc.line(margin, startY, margin + 60, startY);
    y = startY + 12;
    drawText(`HEBEL ${index + 1}`, margin, y, { size: 7.5, style: "bold", color: GOLD });
    y += 18;
    drawFitText(lev.title ?? "-", margin, y, contentW, { size: compact ? 16 : 20, style: "bold", color: INK });
    y += compact ? 22 : 28;

    // Principle
    const pLines = wrapLines(lev.principle ?? "", contentW, compact ? 10 : 11);
    for (const l of pLines) {
      drawText(l, margin, y, { size: compact ? 10 : 11, color: [55, 55, 55] });
      y += compact ? 14 : 16;
    }
    y += compact ? 8 : 12;

    // Wrong → Better side-by-side
    const halfW = (contentW - 12) / 2;
    const wrongLines = wrapLines(`„${lev.wrong_example ?? ""}"`, halfW - 24, 10, "italic");
    const betterLines = wrapLines(`„${lev.better_example ?? ""}"`, halfW - 24, 10, "italic");
    const boxH = Math.max(wrongLines.length, betterLines.length) * 14 + 40;

    // Wrong box
    setFill([250, 244, 240]);
    doc.roundedRect(margin, y, halfW, boxH, 5, 5, "F");
    setFill([180, 90, 60]);
    doc.rect(margin, y, 3, boxH, "F");
    drawText("STATT SO", margin + 14, y + 16, { size: 7, style: "bold", color: [180, 90, 60] });
    let wy = y + 32;
    wrongLines.forEach((l) => { drawText(l, margin + 14, wy, { size: 10, style: "italic", color: INK }); wy += 14; });

    // Better box
    setFill([242, 250, 244]);
    doc.roundedRect(margin + halfW + 12, y, halfW, boxH, 5, 5, "F");
    setFill([60, 120, 70]);
    doc.rect(margin + halfW + 12, y, 3, boxH, "F");
    drawText("BESSER SO", margin + halfW + 26, y + 16, { size: 7, style: "bold", color: [60, 120, 70] });
    let by = y + 32;
    betterLines.forEach((l) => { drawText(l, margin + halfW + 26, by, { size: 10, style: "italic", color: INK }); by += 14; });

    y += boxH + 14;

    // If-Then script — highlighted
    if (lev.if_then_script) {
      const scriptLines = wrapLines(lev.if_then_script, contentW - 36, 11, "bold");
      const sh = scriptLines.length * 16 + 34;
      setFill(INK);
      doc.roundedRect(margin, y, contentW, sh, 6, 6, "F");
      drawText("DEIN SKRIPT ZUM MERKEN", margin + 18, y + 18, { size: 7.5, style: "bold", color: GOLD });
      let sy = y + 38;
      scriptLines.forEach((l) => { drawText(l, margin + 18, sy, { size: 11, style: "bold", color: [245, 240, 224] }); sy += 16; });
      y += sh + 12;
    }
  };

  // Page 3 — Hebel 1 full
  if (levers[0]) {
    newContentPage();
    y = margin + 4;
    renderLeverDetail(levers[0], 0, false);
    drawContentFooter(`Seite 3 · Hebel 1`);
  }

  // Page 4 — Hebel 2 + 3 side by side vertically (compact)
  if (levers[1] || levers[2]) {
    newContentPage();
    y = margin + 4;
    if (levers[1]) renderLeverDetail(levers[1], 1, true);
    y += 8;
    if (levers[2]) renderLeverDetail(levers[2], 2, true);
    drawContentFooter(`Seite 4 · Hebel 2 & 3`);
  }

  // ========== PAGE 5 — SBI Feedback ==========
  newContentPage();
  y = margin + 4;

  setDraw(GOLD);
  doc.setLineWidth(0.6);
  doc.line(margin, y, pageW - margin, y);
  y += 14;
  drawText("PERSÖNLICH", margin, y, { size: 7.5, style: "bold", color: GOLD });
  y += 18;
  drawText("Was besonders auffiel", margin, y, { size: 20, style: "bold", color: INK });
  y += 28;

  const sbiCard = (opts: {
    kicker: string;
    kickerColor: [number, number, number];
    situation: string;
    behavior: string;
    impact: string;
    ifThen?: string;
  }) => {
    const innerW = contentW - 36;
    const sitLines = wrapLines(opts.situation, innerW, 10);
    const behLines = wrapLines(opts.behavior, innerW, 10);
    const impLines = wrapLines(opts.impact, innerW, 10);
    const ifLines = opts.ifThen ? wrapLines(opts.ifThen, innerW - 12, 10, "bold") : [];
    const rowH = 12;
    const labelH = 14;
    const gap = 8;
    const ifBlockH = ifLines.length ? ifLines.length * 14 + 30 : 0;
    const cardH =
      18 + // top pad
      labelH + sitLines.length * rowH + gap +
      labelH + behLines.length * rowH + gap +
      labelH + impLines.length * rowH + gap +
      (ifBlockH ? ifBlockH + 4 : 0) +
      14;

    setFill([250, 247, 238]);
    doc.roundedRect(margin, y, contentW, cardH, 6, 6, "F");
    setFill(opts.kickerColor);
    doc.rect(margin, y, 3, cardH, "F");
    drawText(opts.kicker.toUpperCase(), margin + 18, y + 20, { size: 8, style: "bold", color: opts.kickerColor });

    let cy = y + 38;
    const writeLabelled = (label: string, lines: string[]) => {
      drawText(label, margin + 18, cy, { size: 7, style: "bold", color: MUTED });
      cy += 12;
      for (const l of lines) { drawText(l, margin + 18, cy, { size: 10, color: INK }); cy += rowH; }
      cy += gap;
    };
    writeLabelled("SITUATION", sitLines);
    writeLabelled("WAS DU GETAN HAST", behLines);
    writeLabelled("WAS DAS BEWIRKT HAT", impLines);

    if (ifLines.length) {
      setFill(INK);
      doc.roundedRect(margin + 12, cy - 2, contentW - 24, ifBlockH - 4, 5, 5, "F");
      drawText("SO BEIM NÄCHSTEN MAL", margin + 26, cy + 14, { size: 7, style: "bold", color: GOLD });
      let ify = cy + 30;
      ifLines.forEach((l) => { drawText(l, margin + 26, ify, { size: 10, style: "bold", color: [245, 240, 224] }); ify += 14; });
    }

    y += cardH + 14;
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

  drawContentFooter("Seite 5 · Dein Feedback");

  // ========== PAGE 6 — Action Plan + Tracker ==========
  newContentPage();
  y = margin + 4;

  setDraw(GOLD);
  doc.setLineWidth(0.6);
  doc.line(margin, y, pageW - margin, y);
  y += 14;
  drawText("DEIN NÄCHSTER SCHRITT", margin, y, { size: 7.5, style: "bold", color: GOLD });
  y += 18;
  drawText("Eine Sache. Sieben Tage.", margin, y, { size: 20, style: "bold", color: INK });
  y += 28;

  drawText(
    "Alles andere kommt später. Nur diese eine Handlung, jeden Tag.",
    margin, y, { size: 10, color: MUTED, style: "italic" },
  );
  y += 24;

  // Big micro-action card
  const action = (result.micro_action ?? "").trim() || "Vor jedem PPV-Angebot: erst 2 echte Fragen zum Kunden stellen.";
  const actionLines = wrapLines(action, contentW - 40, 15, "bold");
  const actionH = actionLines.length * 20 + 44;
  setFill(INK);
  doc.roundedRect(margin, y, contentW, actionH, 8, 8, "F");
  setFill(GOLD);
  doc.rect(margin, y, 4, actionH, "F");
  drawText("MIKRO-AKTION FÜR DIESE WOCHE", margin + 22, y + 22, { size: 8, style: "bold", color: GOLD });
  let ay = y + 44;
  actionLines.forEach((l) => { drawText(l, margin + 22, ay, { size: 15, style: "bold", color: [245, 240, 224] }); ay += 20; });
  y += actionH + 22;

  // 7-day tracker
  drawText("HAKE JEDEN TAG AB, AN DEM DU ES GEMACHT HAST", margin, y, { size: 8, style: "bold", color: MUTED });
  y += 14;
  const days = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  const boxSize = 42;
  const gapX = (contentW - boxSize * 7) / 6;
  days.forEach((d, i) => {
    const bx = margin + i * (boxSize + gapX);
    setDraw(GOLD);
    doc.setLineWidth(0.8);
    doc.roundedRect(bx, y, boxSize, boxSize, 5, 5, "S");
    drawText(d, bx + boxSize / 2, y + boxSize + 12, { size: 9, color: MUTED, align: "center" });
  });
  y += boxSize + 30;

  // Retrieval question
  if (result.retrieval_question) {
    setFill([250, 247, 238]);
    const qLines = wrapLines(result.retrieval_question, contentW - 40, 12, "italic");
    const qH = qLines.length * 18 + 44;
    doc.roundedRect(margin, y, contentW, qH, 6, 6, "F");
    setFill(GOLD);
    doc.rect(margin, y, 3, qH, "F");
    drawText("FRAG DICH SELBST", margin + 22, y + 20, { size: 8, style: "bold", color: GOLD });
    let qy = y + 38;
    qLines.forEach((l) => { drawText(l, margin + 22, qy, { size: 12, style: "italic", color: INK }); qy += 18; });
    y += qH + 18;
  }

  // Reflection frame
  drawText("PLATZ FÜR DEINE GEDANKEN", margin, y, { size: 8, style: "bold", color: MUTED });
  y += 10;
  const reflectH = Math.max(60, pageH - margin - 30 - y);
  setDraw(HAIRLINE);
  doc.setLineWidth(0.5);
  doc.roundedRect(margin, y, contentW, reflectH, 6, 6, "S");
  // faint ruled lines
  const lineGap = 22;
  for (let ly = y + lineGap; ly < y + reflectH - 8; ly += lineGap) {
    setDraw([240, 236, 224]);
    doc.setLineWidth(0.3);
    doc.line(margin + 14, ly, pageW - margin - 14, ly);
  }

  drawContentFooter("Seite 6 · Dein Fahrplan");

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
