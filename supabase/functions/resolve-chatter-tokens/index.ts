import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CONTROLLING_CHATS_ENDPOINT =
  "https://acznyhzgbkdcmnbqvptt.supabase.co/functions/v1/controlling-chats";

function normalizeKey(v: unknown): string {
  return String(v ?? "")
    .normalize("NFKD")
    .replace(/[\uFE00-\uFE0F\u200B-\u200D\u2060]/g, "")
    .trim()
    .toLowerCase();
}

function objectKeys(v: unknown): string[] {
  if (!v || typeof v !== "object" || Array.isArray(v)) return [];
  return Object.keys(v as Record<string, unknown>);
}

function rowHasModel(row: any, model: string | null | undefined): boolean {
  const key = normalizeKey(model);
  if (!key) return true;
  const keys = [
    ...objectKeys(row?.stats_details),
    ...objectKeys(row?.revenue_details),
  ].map(normalizeKey);
  return keys.includes(key);
}

function modelKeysFromRow(row: any): string[] {
  const keys = [...objectKeys(row?.stats_details), ...objectKeys(row?.revenue_details)];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of keys) {
    const n = normalizeKey(k);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(k);
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (status: number, body: any) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(401, { error: "Missing Authorization" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) return json(401, { error: "Unauthorized" });

    const { chatter_name, platform, model_username } = (await req.json().catch(() => ({}))) ?? {};
    if (!chatter_name || !platform) return json(400, { error: "chatter_name, platform required" });

    const { data: liveRows, error } = await supabase
      .from("chatter_history_live")
      .select("telegram_id, chatter_name, platform, stats_details, revenue_details, updated_at")
      .eq("platform", platform)
      .not("telegram_id", "is", null)
      .order("updated_at", { ascending: false })
      .limit(1000);
    if (error) return json(500, { error: `Live-Daten: ${error.message}` });

    const chatterKey = normalizeKey(chatter_name);
    const chatterRows = (liveRows ?? []).filter((r: any) => normalizeKey(r.chatter_name) === chatterKey);
    const exactRows = chatterRows.filter((r: any) => rowHasModel(r, model_username));
    const modelRows = (liveRows ?? []).filter((r: any) => rowHasModel(r, model_username));
    const scopedRows = exactRows.length ? exactRows : chatterRows.length ? chatterRows : modelRows;
    const telegramId = scopedRows[0]?.telegram_id;
    if (!telegramId) {
      return json(404, {
        error: `Keine telegram_id für ${chatter_name} / ${model_username ?? "?"} auf ${platform}.`,
      });
    }

    const preferred = new Set<string>();
    if (normalizeKey(model_username)) preferred.add(normalizeKey(model_username));
    for (const row of scopedRows) {
      for (const k of modelKeysFromRow(row)) preferred.add(normalizeKey(k));
    }

    const controllingKey = (Deno.env.get("CONTROLLING_CHAT_KEY") ?? "").trim();
    if (!controllingKey) return json(500, { error: "CONTROLLING_CHAT_KEY missing" });

    const ctrlResp = await fetch(CONTROLLING_CHATS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": controllingKey },
      body: JSON.stringify({ telegram_id: telegramId }),
    });
    const ctrlText = await ctrlResp.text();
    if (!ctrlResp.ok) return json(502, { error: `controlling-chats ${ctrlResp.status}: ${ctrlText}` });
    const ctrl = JSON.parse(ctrlText || "{}");
    const allTokens: Array<{ platform: string; username: string; token: string }> = Array.isArray(ctrl?.tokens) ? ctrl.tokens : [];
    const platformKey = normalizeKey(platform);
    const platformTokens = allTokens.filter((t) => normalizeKey(t.platform) === platformKey);

    const selected: Array<{ platform: string; username: string; token: string }> = [];
    const seen = new Set<string>();
    const add = (t: { platform: string; username: string; token: string }) => {
      const k = `${normalizeKey(t.platform)}:${normalizeKey(t.username)}`;
      if (seen.has(k)) return;
      seen.add(k);
      selected.push(t);
    };
    for (const key of preferred) {
      const m = platformTokens.find((t) => normalizeKey(t.username) === key);
      if (m) add(m);
    }
    if (selected.length === 0) for (const t of platformTokens.slice(0, 3)) add(t);
    if (selected.length === 0) return json(404, { error: `Kein Token für ${model_username ?? "?"} auf ${platform}.` });

    return json(200, { telegram_id: telegramId, tokens: selected });
  } catch (e) {
    return json(500, { error: String((e as Error).message ?? e) });
  }
});
