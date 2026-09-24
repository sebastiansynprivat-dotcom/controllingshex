import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { classifyError, NotConfiguredError } from "./errors.ts";
import { createSupabaseStore } from "./supabase-store.ts";
import { json, MODEL_A, PROFILE_MARKER } from "./test-helpers.ts";

async function withPostgrestError(
  code: string,
  work: (store: ReturnType<typeof createSupabaseStore>, paths: string[]) => Promise<void>,
) {
  const originalFetch = globalThis.fetch;
  const paths: string[] = [];
  globalThis.fetch = (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assertEquals(url.origin, "https://supabase.example.org");
    paths.push(url.pathname);
    return Promise.resolve(json({
      code,
      message: `synthetic@example.org ${MODEL_A} ${PROFILE_MARKER}`,
      details: "synthetic database details",
      hint: "synthetic database hint",
    }, 404));
  };
  try {
    const store = createSupabaseStore((name) => ({
      SUPABASE_URL: "https://supabase.example.org",
      SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key",
    } as Record<string, string>)[name]);
    await work(store, paths);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

Deno.test("store maps both missing links table codes to closed not_configured errors", async () => {
  for (const code of ["42P01", "PGRST205"]) {
    await withPostgrestError(code, async (store, paths) => {
      const error = await assertRejects(
        () => store.getLinksPage(0, 999),
        NotConfiguredError,
      );
      assertEquals(error.message, "not_configured");
      assertEquals(error.cause, undefined);
      assertEquals(classifyError(error), { status: 503, code: "not_configured" });
      assertEquals(paths, ["/rest/v1/model_steckbrief_links"]);
    });
  }
});

Deno.test("store keeps other links errors and missing unrelated tables as closed generic errors", async () => {
  for (const code of ["42P01", "PGRST205", "42501", "XX000"]) {
    await withPostgrestError(code, async (store, paths) => {
      const reads = [
        () => store.getModelsPage(0, 999),
        () => store.getAdminUserIdsPage(0, 999),
        ...(code === "42501" || code === "XX000"
          ? [() => store.getLinksPage(0, 999)]
          : []),
      ];
      for (const read of reads) {
        const error = await assertRejects(read, Error);
        assertEquals(error.message, "store_failed");
        assertEquals(error.cause, undefined);
        assertEquals(classifyError(error), { status: 500, code: "internal_error" });
      }
      assertEquals(paths.length, reads.length);
    });
  }
});
