

## Custom Labels für Chatter

Frei wählbare Tags (z.B. "Fokus", "Probephase", "Talent") die du selbst erstellen und einzelnen Chattern zuweisen kannst — mehrere pro Chatter möglich.

### Was gebaut wird

1. **Neue Datenbank-Tabelle `chatter_labels`** — speichert die verfügbaren Labels pro User (Name + Farbe)
2. **Neue Datenbank-Tabelle `chatter_label_assignments`** — verknüpft Labels mit Chattern (many-to-many)
3. **Label-Badge auf der Chatter-Karte** — kleine farbige Tags direkt unter dem Namen sichtbar
4. **Label-Verwaltung im ChatterSlideOver** — Labels zuweisen/entfernen wenn man einen Chatter öffnet, plus neue Labels erstellen
5. **Filter nach Labels** — im bestehenden Filter-Dropdown auch nach Labels filtern können

### Technische Details

**Migration SQL:**
- `chatter_labels`: id, user_id, platform, label_name, color (hex), created_at — mit RLS
- `chatter_label_assignments`: id, user_id, chatter_name, platform, label_id (FK), created_at — mit RLS

**UI-Änderungen:**
- `CategoryResultCards.tsx`: Labels laden und als kleine farbige Badges unter dem Chatter-Namen anzeigen
- `ChatterSlideOver.tsx`: Neuer Abschnitt "Labels" mit Dropdown zum Zuweisen + kleines Formular zum Erstellen neuer Labels (Name + Farbauswahl)
- Optional: Filter-Erweiterung um Label-basierte Filterung

**Farbauswahl:** 6-8 vordefinierte Farben zur Auswahl (Rot, Blau, Grün, Gelb, Lila, Orange, Pink, Türkis)

