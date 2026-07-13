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
  const CONCURRENT_PAGES = 4;

  const loadPage = async (from: number): Promise<T[]> => {
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await build(from, from + pageSize - 1);
      if (!res.error && res.data) return res.data;
      lastErr = res.error;
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
    }
    throw new Error(`fetchAllPaged failed at offset ${from}: ${String(lastErr)}`);
  };

  const out: T[] = [];
  const first = await loadPage(0);
  out.push(...first);
  if (first.length < pageSize) return out;

  for (let nextFrom = pageSize; ; nextFrom += pageSize * CONCURRENT_PAGES) {
    const starts = Array.from({ length: CONCURRENT_PAGES }, (_, i) => nextFrom + i * pageSize);
    const pages = await Promise.all(starts.map(loadPage));
    for (const page of pages) out.push(...page);
    if (pages.some((page) => page.length < pageSize)) break;
  }
  return out;
}
