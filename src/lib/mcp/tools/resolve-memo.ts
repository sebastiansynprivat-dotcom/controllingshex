import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, supabaseForUser, textResult } from "../supabase";

export default defineTool({
  name: "resolve_memo",
  title: "Memo erledigen",
  description: "Markiert ein Memo als erledigt. Nutze das, wenn der Chatter geliefert hat oder das Thema geschlossen wird.",
  inputSchema: {
    memo_id: z.string().describe("ID des Memos (aus read_memos)."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ memo_id }, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    const { error } = await supabaseForUser(ctx)
      .from("chatter_memos")
      .update({ status: "resolved", resolved_at: new Date().toISOString() })
      .eq("id", memo_id);
    if (error) return errorResult(error.message);
    return textResult({ ok: true });
  },
});
