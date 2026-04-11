

## Videocoaching-Tracker

### Was wird gebaut
Ein neuer Menüpunkt "Videocoaching" in der Sidebar. Dort kannst du Chatter-Namen eintragen, um zu loggen, dass du ein Videocoaching geschickt hast. Das Datum wird automatisch gespeichert. In der Dashboard-Analyse wird dann bei jedem Chatter angezeigt, wie viele Tage das letzte Videocoaching her ist.

### Datenbank
Neue Tabelle `video_coachings`:
- `id` (uuid, PK)
- `user_id` (uuid, für RLS)
- `chatter_name` (text)
- `platform` (text, default 'Maloum')
- `sent_at` (timestamptz, default now())
- `created_at` (timestamptz, default now())

RLS: Nutzer sehen/erstellen/löschen nur eigene Einträge.

### Sidebar
Neuer Eintrag zwischen "Dashboard" und "Upload":
- Titel: "Videocoaching"
- Icon: `Video` (Lucide)
- Route: `/videocoaching`

### Neue Seite: `/videocoaching`
- Eingabefeld für Chatter-Name + Button "Eintragen"
- Darunter eine Liste aller bisherigen Einträge (Name + Datum), sortiert nach Datum absteigend
- Löschen-Option pro Eintrag
- Autocomplete aus bekannten Chatter-Namen (aus `chatter_history`)

### Dashboard-Integration
In `CategoryResultCards.tsx` beim Rendern jedes Chatters:
- Video-Coachings für die aktuelle Platform laden
- Wenn ein Eintrag für den Chatter existiert, ein Badge anzeigen: z.B. "📼 vor 3 Tagen"
- Berechnung: Differenz zwischen heute und `sent_at` des letzten Eintrags

### Dateien
1. **Migration** — Tabelle `video_coachings` + RLS
2. **`src/pages/Videocoaching.tsx`** — Neue Seite
3. **`src/App.tsx`** — Route hinzufügen
4. **`src/components/AppSidebar.tsx`** — Menüpunkt hinzufügen
5. **`src/components/CategoryResultCards.tsx`** — Badge "📼 vor X Tagen" bei Chattern anzeigen

