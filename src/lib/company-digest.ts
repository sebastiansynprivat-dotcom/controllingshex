import { supabase } from "@/integrations/supabase/client";

export interface CompanyDigestCard {
  title: string;
  detail: string;
  severity: "info" | "warn" | "critical";
  recommendation: string;
  impact_eur: number;
  tags?: string[];
}

export interface CompanyDigestSection {
  section_key: string;
  section_title: string;
  summary: string;
  cards: CompanyDigestCard[];
  signals: { severity: "info" | "warn" | "critical"; message: string }[];
}

export interface CompanyDigest {
  id: string;
  platform: string;
  digest_date: string;
  status: "running" | "ready" | "error";
  sections_json: CompanyDigestSection[];
  signals_json: { severity: "info" | "warn" | "critical"; message: string }[];
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export async function getTodayDigest(platform: string): Promise<CompanyDigest | null> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("company_digests")
    .select("*")
    .eq("platform", platform)
    .eq("digest_date", today)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as CompanyDigest) ?? null;
}

export async function generateDigest(platform: string, force = false): Promise<{ digest_id: string; status: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Nicht eingeloggt");
  const { data, error } = await supabase.functions.invoke("generate-company-digest", {
    body: { platform, force },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) throw new Error((data as any)?.error || error.message);
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as { digest_id: string; status: string };
}

export function countCriticalSignals(digest: CompanyDigest | null): number {
  if (!digest?.signals_json) return 0;
  return digest.signals_json.filter((s) => s.severity === "warn" || s.severity === "critical").length;
}

export function countCards(digest: CompanyDigest | null): number {
  if (!digest?.sections_json) return 0;
  return digest.sections_json.reduce((sum, s) => sum + (s.cards?.length ?? 0), 0);
}
