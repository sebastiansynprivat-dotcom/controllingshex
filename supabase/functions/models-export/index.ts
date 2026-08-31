import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);

  const secrets = [
    Deno.env.get("MODELS_EXPORT_KEY"),
    Deno.env.get("LIVE_STATUS_KEY"),
  ].filter(Boolean) as string[];
  const provided =
    req.headers.get("x-api-key")?.trim() ||
    url.searchParams.get("key")?.trim() ||
    "";
  let authorized = provided !== "" && secrets.includes(provided);

  if (!authorized) {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const authClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { auth: { persistSession: false } },
      );
      const { data, error } = await authClient.auth.getUser(token);
      if (!error && data?.user?.id) authorized = true;
    }
  }

  if (!authorized) return json({ error: "Unauthorized" }, 401);

  let body: Record<string, unknown> = {};
  if (req.method === "POST") body = await req.json().catch(() => ({}));
  const platform =
    (body.platform as string | undefined) ??
    url.searchParams.get("platform") ??
    undefined;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  let q = supabase
    .from("models")
    .select("id,platform,model_name,email,password,updated_at")
    .order("platform", { ascending: true })
    .order("model_name", { ascending: true });

  if (platform) q = q.ilike("platform", platform);

  const { data, error } = await q;
  if (error) return json({ error: error.message }, 500);

  const rows = await Promise.all(
    (data ?? []).map(async (m) => {
      const email = (m.email ?? "").trim().toLowerCase();
      const password = m.password ?? "";
      const fingerprint =
        email && password ? await sha256Hex(`${email}\n${password}`) : null;
      return {
        id: m.id,
        platform: m.platform,
        model_name: m.model_name,
        email: m.email ?? null,
        fingerprint,
        updated_at: new Date(m.updated_at).toISOString(),
      };
    }),
  );

  return json(rows);
});
