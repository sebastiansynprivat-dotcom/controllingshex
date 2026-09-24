import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { NotConfiguredError } from "./errors.ts";
import type { AuthStore, InventoryStore, Page } from "./inventory.ts";
import type { LinkRow, ModelRow } from "./types.ts";

function page<T>(
  result: { data: T[] | null; count: number | null; error: unknown },
): Page<T> {
  if (result.error) throw new Error("store_failed");
  return { rows: result.data ?? [], count: result.count };
}

/** Clients are created lazily so handler method/auth checks precede store configuration. */
export function createSupabaseStore(
  env: (name: string) => string | undefined,
): InventoryStore & AuthStore {
  let serviceClient: ReturnType<typeof createClient> | undefined;
  let anonClient: ReturnType<typeof createClient> | undefined;
  const service = () =>
    serviceClient ??= createClient(
      env("SUPABASE_URL") ?? "",
      env("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  const anon = () =>
    anonClient ??= createClient(
      env("SUPABASE_URL") ?? "",
      env("SUPABASE_ANON_KEY") ?? "",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  return {
    async getModelsPage(from, to) {
      const result = await service().from("models")
        .select("id,platform,model_name,email,user_id", { count: "exact" })
        .order("platform").order("model_name").order("id").range(from, to)
        .returns<ModelRow[]>();
      return page<ModelRow>(result);
    },
    async getLinksPage(from, to) {
      const result = await service().from("model_steckbrief_links")
        .select(
          "id,platform,email_normalized,mode,external_model_id,external_model_name,created_by,created_at,updated_at",
          { count: "exact" },
        )
        .order("id").range(from, to).returns<LinkRow[]>();
      if (
        result.error?.code === "42P01" || result.error?.code === "PGRST205"
      ) throw new NotConfiguredError();
      return page<LinkRow>(result);
    },
    async getAdminUserIdsPage(from, to) {
      const result = await service().from("user_roles")
        .select("user_id", { count: "exact" }).eq("role", "admin")
        .order("user_id").range(from, to).returns<{ user_id: string }[]>();
      return page<{ user_id: string }>(result);
    },
    async getUserIdFromToken(token) {
      const { data, error } = await anon().auth.getUser(token);
      return error ? null : data.user?.id ?? null;
    },
    async isAdmin(userId) {
      const { data, error } = await service().from("user_roles")
        .select("user_id").eq("user_id", userId).eq("role", "admin").limit(1);
      if (error) throw new Error("store_failed");
      return (data?.length ?? 0) === 1;
    },
  };
}
