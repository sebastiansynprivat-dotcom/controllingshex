## Ziel

Die Seite **Texte** wird zu einem sauberen Snippet-System: vorformulierte Texte, gruppiert nach „Tag X" (wann sie an den Chatter rausgehen sollen), mit One-Click-Copy.

## UI / UX

```text
┌─ Texte ──────────────────────────── [Sperren] ┐
│                                                │
│  [+ Neuer Text]   [+ Neuer Tag-Bucket]         │
│                                                │
│  ▼ Tag 0  (Erstkontakt)                    ⋮  │
│    ┌────────────────────────────────────────┐  │
│    │ Hey Süßer, schön dich kennenzulernen…  │  │
│    │                                  [Copy]│  │
│    └────────────────────────────────────────┘  │
│    ┌────────────────────────────────────────┐  │
│    │ Wie war dein Tag? …              [Copy]│  │
│    └────────────────────────────────────────┘  │
│                                                │
│  ▼ Tag 2  (Follow-up)                      ⋮  │
│    ...                                         │
│                                                │
│  ▼ Tag 3                                   ⋮  │
│  ▼ Tag 7                                   ⋮  │
└────────────────────────────────────────────────┘
```

- Buckets sind **kollabierbar** und nach `day_offset` aufsteigend sortiert
- Jede Karte: kompletter Text sichtbar (max-height + scroll bei langen Texten), großer **„Kopieren"**-Button → schreibt Text in Zwischenablage + Toast „Kopiert"
- Hover/Klick auf Karte: **Bearbeiten** (inline) und **Löschen** (Trash-Icon)
- Drag-Handle zum Umsortieren innerhalb eines Buckets (`position`-Feld)
- Optionaler **Titel/Label** pro Snippet (z. B. „Sexy Opener", „Soft Reminder") — wird über dem Text als kleines Tag angezeigt
- Bucket-Header zeigt Anzahl Snippets + optional kurze Beschreibung („Erstkontakt", „Follow-up" …)

## Neuer Text / neuer Bucket

- **„+ Neuer Text"**: Modal/Sheet mit
  - Tag-Auswahl (Dropdown mit existierenden Tag-Werten + „Anderer Tag…" für freie Zahl)
  - Optionaler Titel
  - Großes Textarea
  - Speichern → erscheint sofort im richtigen Bucket
- **„+ Neuer Tag-Bucket"**: nur Zahl eingeben (z. B. 14) — leerer Bucket erscheint

## Datenbank

Neue Tabelle `text_snippets`:

| Spalte | Typ | Notizen |
|---|---|---|
| id | uuid PK | gen_random_uuid() |
| user_id | uuid | RLS-Owner |
| platform | text | default 'Maloum' |
| day_offset | int | 0, 2, 3, 7, 14 … |
| title | text nullable | optionales Label |
| body | text | der Text selbst |
| position | int default 0 | Reihenfolge im Bucket |
| created_at / updated_at | timestamptz |

RLS-Policies analog zu `todos` (user_id = auth.uid() für SELECT/INSERT/UPDATE/DELETE). Tabelle wird per Migration angelegt.

Die bestehende `todos`-Tabelle bleibt unverändert. Falls der Lock-Schutz (Passwort) für die Texte-Seite weiter gewünscht ist, behalten wir ihn — die neue Snippet-Liste lebt einfach unter dem gleichen Schutz.

**Frage:** Behalten wir den Passwort-Schutz für die Texte-Seite, oder soll die Seite frei zugänglich sein?

## Geänderte / neue Dateien

- **Migration**: Tabelle `text_snippets` + RLS
- **`src/pages/Notes.tsx`** (umgebaut): zeigt jetzt das Snippet-System statt Todos. Lock-Logik bleibt, falls gewünscht. Todo-CRUD raus.
- ggf. neue kleine Komponenten `SnippetCard.tsx`, `SnippetEditor.tsx` (Sheet)

## Offen

- Passwort-Schutz behalten? (Default: ja)
- Sollen Todos komplett verschwinden oder weiter als zweiter Reiter auf der Seite verfügbar bleiben?
