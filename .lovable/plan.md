# Heute-Tab Bug-Fix

## Problem 1 — Zu wenige Aufgaben (Maloum 54, Magma unvollständig)

**Ursache:** `today-engine.ts` liest `chatter_history` per `supabase.from(...).select(...)` ohne Limit. Supabase liefert dann still nur **die ersten 1000 Zeilen**. Maloum hat in 30 Tagen 6103 Zeilen (Brezzels 5473). Bei großen Plattformen fallen ~80 % der Chatter unter den Tisch → Zählwerte zu klein, Aufgaben fehlen.

**Fix:** Pagination via `.range()` in Batches à 1000 einführen. Betroffen:
- `loadChatterStats` — `chatter_history` (30 Tage) + `chatter_hourly_stats` (21 Tage)
- `detectWakeups` — `chatter_history` (5 Tage) — hier meist unkritisch, aber vorsorglich mitfixen

Neue Helper-Funktion `fetchAllPaged(query, pageSize=1000)` im selben File, die so lange nachlädt, bis eine Seite weniger als `pageSize` Zeilen liefert. Danach alle Aufrufer umstellen.

Kein Schema-Change nötig, keine RLS-Änderung.

## Problem 2 — Filter-Leiste lässt sich nicht bis zum Ende scrollen

**Ursache:** Kombination aus `snap-x snap-proximity` + `mask-image`-Fade + `scroll-px-3` in `src/pages/Today.tsx` (Zeilen ~1341). Die letzten Chips liegen unter dem Fade und snap zieht in die Mitte zurück → Enden wirken "gesperrt".

**Fix:**
- `snap-x snap-proximity` entfernen (freies Scrollen bleibt, kein aggressives Zurücksnappen)
- `scroll-padding-inline-end: 24px` ergänzen, damit die letzten Chips über den Fade hinaus scrollbar sind
- `touch-action: pan-x` explizit setzen, damit iOS die Geste sicher als Horizontal-Scroll erkennt

## Problem 3 (Folgefehler) — "Offen"-Count in der Filter-Leiste

Sobald Problem 1 gefixt ist, korrigiert sich `filtered.primary.length + filtered.watchlist.length` automatisch, weil die zugrundeliegende Datenmenge vollständig geladen wird. Kein separater Fix nötig.

## Technische Details

```ts
// today-engine.ts — neuer Helper
async function fetchAllPaged<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error || !data) break;
    out.push(...data);
    if (data.length < pageSize) break;
  }
  return out;
}
```

Aufrufer-Umbau z. B.:
```ts
const rows = await fetchAllPaged<HistoryRow>((from, to) =>
  supabase.from("chatter_history")
    .select("chatter_name, analysis_date, revenue_today, mass_dms, open_chats, response_delay_days, account")
    .eq("user_id", user.id)
    .ilike("platform", platform)
    .gte("analysis_date", since)
    .order("analysis_date", { ascending: false })
    .range(from, to)
);
```

## Verifikation nach Umsetzung

1. Konsole: Log der geladenen Row-Anzahl pro Query kurz einbauen und in Preview prüfen (danach wieder entfernen).
2. Maloum "Offen"-Zähler sollte deutlich höher liegen als 54.
3. Filter-Leiste auf Mobile bis zum letzten Chip ("Wins-Signal") durchscrollen können.

## Bewusst nicht enthalten

- Kein Refactor der Sortier-/Filter-Logik.
- Kein neuer Cache, keine RPC.
- Keine Änderung an anderen Tabs — nur der Ladepfad.
