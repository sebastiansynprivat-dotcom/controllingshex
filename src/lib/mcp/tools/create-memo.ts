import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, supabaseForUser, textResult } from "../supabase";

export default defineTool({
  name: "create_memo",
  title: "Memo anlegen",
  description:
    "Legt ein Memo / eine Vereinbarung für einen Chatter an, optional mit Frist. Nutze das bei 'notier:', 'merk dir', 'gib X noch N Tage', 'erinner mich'.",
  inputSchema: {
    platform: z.string().describe("Plattform, z.B. 'Maloum'."),
    chatter_name: z.string().describe("Name des Chatters."),
    text: z.string().min(1).describe("Was wurde vereinbart bzw. die Notiz."),
    follow_up_days: z.number().nullable().describe("Tage bis zur Erinnerung, optional."),
    topic: z.string().nullable().describe("Kurz-Tag, z.B. 'frist', 'mass_dms_low'."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ platform, chatter_name, text, follow_up_days, topic }, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    let followUp: string | null = null;
    if (typeof follow_up_days === "number") {
      const d = new Date();
      d.setDate(d.getDate() + follow_up_days);
      d.setHours(8, 0, 0, 0);
      followUp = d.toISOString();
    }
    const { data, error } = await supabaseForUser(ctx)
      .from("chatter_memos")
      .insert({
        user_id: ctx.getUserId(),
        platform,
        chatter_name,
        text,
        topic: topic ?? null,
        follow_up_at: followUp,
        status: "open",
      })
      .select()
      .single();
    if (error) return errorResult(error.message);
    return textResult({ ok: true, memo: data });
  },
});
