import { createSupabaseStore } from "../_shared/steckbrief/supabase-store.ts";
import { createExportHandler } from "./handler.ts";

const env = (name: string) => Deno.env.get(name);

Deno.serve(createExportHandler({
  env,
  store: createSupabaseStore(env),
  fetchImpl: globalThis.fetch,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => new Date(),
  log: (line) => console.log(line),
}));
