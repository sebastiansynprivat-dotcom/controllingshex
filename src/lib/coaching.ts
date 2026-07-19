import { supabase } from "@/integrations/supabase/client";
import { jsPDF } from "jspdf";

export interface CoachingMaterial {
  id: string;
  title: string;
  content: string;
  is_active: boolean;
  updated_at: string;
}

export interface ChatAnalysis {
  chat_id: string;
  customer_username?: string;
  score?: number;
  one_line_verdict?: string;
  pricing_check?: string;
  dos?: Array<{ quote: string; why_good: string }>;
  donts?: Array<{ quote: string; problem: string; better: string }>;
  revenue_levers?: string[];
  error?: string;
}

export interface Pattern {
  title: string;
  type: "positive" | "negative";
  description: string;
  example_quotes?: string[];
  better_approach?: string;
}

export interface AnalysisResult {
  overall_score: number | null;
  executive_summary: string;
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

export async function runAnalysis(input: {
  chatter_name: string;
  platform: string;
  model_username: string | null;
  date_from: string;
  date_to: string;
  onStage?: (stage: string) => void;
}): Promise<AnalysisResult> {
  input.onStage?.("Chats werden geladen und analysiert…");

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
    }),
  });
  const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json as AnalysisResult;
}

/* ---------------- PDF rendering ---------------- */

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
  const margin = 40;
  let y = margin;

  const line = (text: string, opts: { size?: number; bold?: boolean; color?: [number, number, number]; gap?: number; indent?: number } = {}) => {
    const size = opts.size ?? 10;
    doc.setFontSize(size);
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    const [r, g, b] = opts.color ?? [30, 30, 30];
    doc.setTextColor(r, g, b);
    const indent = opts.indent ?? 0;
    const maxWidth = pageW - margin * 2 - indent;
    const lines = doc.splitTextToSize(text, maxWidth) as string[];
    for (const l of lines) {
      if (y > pageH - margin) {
        doc.addPage();
        y = margin;
      }
      doc.text(l, margin + indent, y);
      y += size * 1.25;
    }
    y += opts.gap ?? 2;
  };

  const rule = () => {
    if (y > pageH - margin - 10) { doc.addPage(); y = margin; }
    doc.setDrawColor(220);
    doc.line(margin, y, pageW - margin, y);
    y += 10;
  };

  // Header
  line("Coaching-Analyse", { size: 20, bold: true, color: [20, 20, 20], gap: 4 });
  line(`Chatter: ${input.chatter_name}`, { size: 11, bold: true, gap: 2 });
  line(`Model: ${input.model_username ?? "—"}   ·   Plattform: ${input.platform}`, { size: 9, color: [90, 90, 90] });
  line(`Zeitraum: ${input.date_from}  →  ${input.date_to}`, { size: 9, color: [90, 90, 90], gap: 6 });

  const score = input.result.overall_score;
  if (score !== null && score !== undefined) {
    const scoreColor: [number, number, number] = score >= 75 ? [30, 130, 60] : score >= 50 ? [200, 140, 20] : [200, 40, 40];
    line(`Gesamt-Score: ${score}/100`, { size: 14, bold: true, color: scoreColor, gap: 4 });
  }
  line(`Analysiert: ${input.result.chats_analyzed} von ${input.result.chats_total ?? input.result.chats_analyzed} Chats`, { size: 9, color: [90, 90, 90], gap: 6 });
  rule();

  // Executive Summary
  if (input.result.executive_summary) {
    line("Executive Summary", { size: 13, bold: true, gap: 4 });
    line(input.result.executive_summary, { size: 10, gap: 6 });
    rule();
  }

  // Patterns
  if (input.result.patterns?.length) {
    line("Wiederkehrende Muster", { size: 13, bold: true, gap: 4 });
    for (const p of input.result.patterns) {
      const badge = p.type === "positive" ? "✓ STÄRKE" : "✗ SCHWÄCHE";
      const badgeColor: [number, number, number] = p.type === "positive" ? [30, 130, 60] : [200, 40, 40];
      line(`${badge} — ${p.title}`, { size: 11, bold: true, color: badgeColor, gap: 2 });
      line(p.description, { size: 10, gap: 3, indent: 12 });
      if (p.example_quotes?.length) {
        for (const q of p.example_quotes.slice(0, 3)) {
          line(`„${q}"`, { size: 9, color: [90, 90, 90], indent: 20, gap: 1 });
        }
      }
      if (p.type === "negative" && p.better_approach) {
        line(`Besser: ${p.better_approach}`, { size: 10, color: [30, 100, 30], indent: 12, gap: 4 });
      }
      y += 4;
    }
    rule();
  }

  // Per-chat
  if (input.result.chats?.length) {
    line("Chat-für-Chat-Analyse", { size: 13, bold: true, gap: 6 });
    for (const c of input.result.chats) {
      if (y > pageH - margin - 80) { doc.addPage(); y = margin; }
      const scoreTxt = typeof c.score === "number" ? ` — ${c.score}/100` : "";
      line(`Kunde: ${c.customer_username ?? "?"}${scoreTxt}`, { size: 11, bold: true, gap: 2 });
      if (c.error) {
        line(`Fehler: ${c.error}`, { size: 9, color: [200, 40, 40], gap: 6 });
        continue;
      }
      if (c.one_line_verdict) line(c.one_line_verdict, { size: 10, color: [60, 60, 60], gap: 3 });
      if (c.pricing_check) {
        line("Pricing", { size: 10, bold: true, gap: 1 });
        line(c.pricing_check, { size: 10, indent: 12, gap: 3 });
      }
      if (c.dos?.length) {
        line("Do's", { size: 10, bold: true, color: [30, 130, 60], gap: 1 });
        for (const d of c.dos) {
          line(`„${d.quote}"`, { size: 9, color: [90, 90, 90], indent: 12, gap: 1 });
          line(`→ ${d.why_good}`, { size: 9, indent: 20, gap: 2 });
        }
      }
      if (c.donts?.length) {
        line("Don'ts", { size: 10, bold: true, color: [200, 40, 40], gap: 1 });
        for (const d of c.donts) {
          line(`„${d.quote}"`, { size: 9, color: [90, 90, 90], indent: 12, gap: 1 });
          line(`Problem: ${d.problem}`, { size: 9, indent: 20, gap: 1 });
          line(`Besser: ${d.better}`, { size: 9, color: [30, 100, 30], indent: 20, gap: 2 });
        }
      }
      if (c.revenue_levers?.length) {
        line("Umsatzhebel", { size: 10, bold: true, gap: 1 });
        for (const l of c.revenue_levers) line(`• ${l}`, { size: 9, indent: 12, gap: 1 });
      }
      y += 8;
      rule();
    }
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
