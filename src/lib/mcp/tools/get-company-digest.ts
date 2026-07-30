import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, supabaseForUser, textResult } from "../supabase";

export default defineTool({
  name: "get_company_digest",
  title: "Company-Digest heute",
  description:
    "Liefert den aktuellen AI-Company-Digest für den Workspace: rollenbasierte Beobachtungen zu Umsatz, Operations, Besetzung und Accounts inkl. Empfehlungen und Signalen. Für Fragen wie 'Wie sieht die Company heute aus?' oder 'Welche kritischen Signale gibt es?'.",
  inputSchema: {
    platform: z.string().describe("Plattform, z.B. 'Maloum' oder 'Brezzels'."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ platform }, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabaseForUser(ctx)
      .from("company_digests")
      .select("status,sections_json,signals_json,error_message")
      .eq("platform", platform)
      .eq("digest_date", today)
      .maybeSingle();
    if (error) return errorResult(error.message);
    if (!data) return textResult({ status: "missing", message: `Noch kein Company-Digest für ${platform} am ${today}.` });
    return textResult({
      platform,
      date: today,
      status: data.status,
      sections: data.sections_json ?? [],
      signals: data.signals_json ?? [],
      error: data.error_message,
    });
  },
});
