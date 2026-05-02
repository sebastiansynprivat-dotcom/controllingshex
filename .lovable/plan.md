## Was passiert

**1. Bilder/Videos hochladen (Backend)**

Migration:
```sql
ALTER TABLE public.text_snippets
  ADD COLUMN IF NOT EXISTS media_urls TEXT[] NOT NULL DEFAULT '{}';

INSERT INTO storage.buckets (id, name, public)
VALUES ('snippet-media', 'snippet-media', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users can view own snippet media"   ON storage.objects FOR SELECT TO authenticated USING (bucket_id='snippet-media' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can upload own snippet media" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id='snippet-media' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can update own snippet media" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id='snippet-media' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can delete own snippet media" ON storage.objects FOR DELETE TO authenticated USING (bucket_id='snippet-media' AND auth.uid()::text = (storage.foldername(name))[1]);
```

- Privater Bucket `snippet-media`, jeder Nutzer hat seinen eigenen Ordner = `userId/…`
- Neue Spalte `media_urls TEXT[]` speichert die Storage-Pfade pro Snippet
- Anzeige läuft über **Signed URLs** (1 h gültig, on-demand erzeugt)

**2. Frontend (`src/pages/Notes.tsx`)**

Editor-Dialog:
- „Datei hinzufügen"-Button mit `accept="image/*,video/*"` (Multi-Select)
- Upload nach `snippet-media/{userId}/{uuid}-{filename}`
- Thumbnails der hochgeladenen Medien direkt im Editor mit Lösch-X
- Speichern aktualisiert auch `media_urls`

Snippet-Karte:
- Mediengrid (1–3 Spalten) oberhalb des Texts
- Bilder als `<img>`, Videos als `<video controls muted>`
- Klick auf Medium → Lightbox mit großer Vorschau + „URL kopieren"
- Text-Klick kopiert weiterhin nur den Text

**3. UI Premium-Polish (Buttons lesbar)**

Aktuelle Buttons sind teilweise zu transparent → Anpassungen:
- „Neuer Text"-Hauptbutton: voller Primary-Hintergrund mit `text-primary-foreground` (statt Primary-auf-Primary)
- „Bucket"-Button: dezenter Border statt nur Ghost
- Bucket-Header-Aktionen (Plus, X) bekommen sichtbaren Hintergrund-Chip statt nur Hover
- Snippet-Card: „Klick zum Kopieren"-Hint mit besserem Kontrast (`text-white/55` statt `/30`)
- Edit/Delete-Floating-Buttons immer sichtbar (nicht nur on hover) auf Touch-Geräten — opacity 60 → 100 on hover

## Geänderte Dateien

- Migration (oben)
- `src/pages/Notes.tsx` — Upload, Mediengrid, Lightbox, lesbare Buttons

## Limits

- Max 50 MB pro Datei (Storage-Default). Größere Videos vorher komprimieren.
