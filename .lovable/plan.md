# Fix: 4Based Models hinzufügen schlägt fehl

## Ursache
Auf der Tabelle `public.models` liegt ein CHECK-Constraint:

```
models_platform_check: platform IN ('Maloum', 'Brezzels', 'FansyMe')
```

"4Based" ist dort nicht enthalten, daher wirft Postgres beim Insert einen Constraint-Fehler. Der Frontend-Code in `src/pages/Models.tsx` ist korrekt — er sendet `platform: "4Based"` aus dem `PlatformContext`, aber die DB lehnt ab.

Nebenbefund: Der alte Wert "FansyMe" entspricht offenbar dem heutigen "4Based" (Umbenennung), wurde aber nie im Constraint nachgezogen.

## Änderung
Eine Migration, die den Constraint austauscht:

- `models_platform_check` droppen
- Neuen Constraint setzen: `platform IN ('Maloum', 'Brezzels', '4Based')`
- Bestehende Zeilen mit `platform = 'FansyMe'` auf `'4Based'` migrieren (falls vorhanden), damit die neue Whitelist nicht greift

Kein Code-Change nötig.

## Technisch
```sql
UPDATE public.models SET platform = '4Based' WHERE platform = 'FansyMe';
ALTER TABLE public.models DROP CONSTRAINT models_platform_check;
ALTER TABLE public.models ADD CONSTRAINT models_platform_check
  CHECK (platform IN ('Maloum', 'Brezzels', '4Based'));
```
