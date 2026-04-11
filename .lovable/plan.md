

## Chatter-Suche / Schnellzugriff

### Was wird gebaut
Eine Suchleiste oben im Dashboard-Header, mit der du einen Chatter-Namen eintippen kannst. Während du tippst, erscheinen passende Vorschläge aus der aktuellen Analyse. Ein Klick auf einen Vorschlag öffnet sofort das ChatterSlideOver — ohne durch Kategorien scrollen zu müssen.

### Technischer Ansatz

**Datei: `src/pages/Dashboard.tsx`**
- Neuen State `searchQuery` hinzufügen
- Alle Chatter-Namen aus `result.categories` extrahieren (flat map über alle Kategorien)
- Gefilterte Liste bei Eingabe berechnen (case-insensitive Substring-Match)
- Suchleiste zwischen Header und TrendWidget platzieren
- Popover/Dropdown mit Treffern anzeigen (max. 8 Ergebnisse)
- Bei Klick auf Treffer: `setSelectedChatter(name)` aufrufen → SlideOver öffnet sich
- Bei Escape oder Blur: Dropdown schließen

**UI-Komponente**
- Einfaches `<input>` mit Search-Icon (Lucide), kein Command-Menü nötig
- Darunter ein absolut positioniertes Dropdown mit den Treffern
- Jeder Treffer zeigt: Kategorie-Emoji + Chatter-Name + Kategorie-Name (dezent)
- Styling passend zum bestehenden Dark-Theme (bg-white/[0.03], border-white/[0.06])

**Keine DB-Änderungen nötig** — die Chatter-Daten kommen aus dem bereits geladenen `result_json`.

### Dateien
- `src/pages/Dashboard.tsx` — Suchleiste + Logik hinzufügen (einzige Änderung)

