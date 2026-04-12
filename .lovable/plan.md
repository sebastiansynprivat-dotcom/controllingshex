

## Kategorie-Filter im Swipe Mode

### Was wird gebaut

1. **Horizontaler Kategorie-Filter** oberhalb der Progress-Bar — scrollbare Chips mit Emoji + Kategoriename. Ein "Alle"-Chip ist standardmäßig aktiv.

2. **Filterlogik** — bei Auswahl einer Kategorie werden nur Karten dieser Kategorie im Swipe-Stack angezeigt. Progress-Anzeige passt sich an (z.B. "3/8 gecheckt" nur für die aktive Kategorie).

3. **"Kategorie fertig"-Prompt** — wenn alle Karten einer Kategorie durchgeswipt sind, erscheint ein Dialog: "Alle [Kategorie] durchgegangen! Mit [nächste Kategorie] weitermachen?" mit Buttons "Ja" und "Zurück zur Übersicht".

### Technische Umsetzung

**`src/pages/TinderMode.tsx`:**

- Neuer State: `selectedCategory: string | null` (null = alle)
- Kategorien aus `chatters` extrahieren via `useMemo` → `uniqueCategories` Array mit `{ emoji, name, count }`
- `uncheckedChatters` wird zusätzlich nach `selectedCategory` gefiltert
- Horizontale scrollbare Chip-Leiste mit `overflow-x-auto` zwischen Progress-Bar und Card-Stack
- Wenn `isDone` für die gefilterte Liste: nächste Kategorie mit unchecked Chattern ermitteln → Dialog mit "Weiter mit [nächste Kategorie]?" anzeigen statt dem finalen 🎉-Screen. Nur wenn wirklich alle fertig sind → finaler Screen.

