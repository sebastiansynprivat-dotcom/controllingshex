/**
 * Lädt alle Zeilen einer Supabase-Query in Batches à `pageSize`.
 * Umgeht das stille 1000-Zeilen-Limit von PostgREST.
 * Retryt jede Seite bei transienten Fehlern, wirft dann eine Exception,
 * damit der Aufrufer sauber laden/erneut versuchen kann statt still leer zu bleiben.
 */
export async function fetchAllPaged<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    let lastErr: unknown = null;
    let data: T[] | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await build(from, from + pageSize - 1);
      if (!res.error && res.data) { data = res.data; lastErr = null; break; }
      lastErr = res.error;
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
    }
    if (lastErr || !data) {
      throw new Error(`fetchAllPaged failed at offset ${from}: ${String(lastErr)}`);
    }
    out.push(...data);
    if (data.length < pageSize) break;
  }
  return out;
}
