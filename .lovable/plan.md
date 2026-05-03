## Models & Follower — Layout-Refresh

Ziel: Cleanes Layout. Filter oben (inkl. "Models in Trouble" als Toggle), Datenbank-Sektion unten mit kompaktem Add-Bereich. Profil-URL ist beim Anlegen direkt mit dabei.

### 1. "Neues Model"-Formular erweitern
Im Add-Card kommt ein zusätzliches Feld **"Maloum-Profil-URL"** dazu (optional). Beim Speichern wird `profile_url` direkt mit gesetzt.

Felder im Formular:
- Name
- Follower
- E-Mail
- Passwort
- **Profil-URL** (neu, full-width unter dem Grid)

### 2. Edit-Modus erweitern
Klick auf den Stift unten in einer Model-Zeile öffnet wie bisher den Inline-Editor — zusätzlich erscheint dort ein Feld **Profil-URL**, sodass der Link nachträglich ergänzt/geändert werden kann.

### 3. Layout-Reorg im Models-Tab

Neue Reihenfolge von oben nach unten:

```text
─────────────────────────────────
Header: Models & Follower · X Models
─────────────────────────────────
[ Filter-Bar ]  ← kompakt, eine Sektion
  • Suche
  • Zeitraum (7/14/30/90/Custom)
  • Umsatz-Status (Alle / Mit / Ohne)
  • Toggle "Models in Trouble"  ← neu, als Filter-Pille
  • Archetyp-Filter (collapsible, nur wenn Daten da)
─────────────────────────────────
[ Datenbank ]  ← Hauptsektion
  Header: "Datenbank · X Models"  
  + dezenter Button "Model hinzufügen" (öffnet collapsible Add-Form)
  
  Tabelle mit allen (gefilterten) Models
─────────────────────────────────
```

### 4. "Models in Trouble" wird Filter, nicht Card

- `ModelsInTroubleCard` wird **nicht mehr als eigene große Karte** gezeigt
- Stattdessen: Filter-Pille **"Im Rückgang"** in der Filter-Bar
  - Aus: alle Models in Tabelle
  - An: Tabelle zeigt nur Models, die laut Trouble-Detection im Rückgang sind
- Logik aus `ModelsInTroubleCard` wird in einen kleinen Helper extrahiert (`useModelsInTrouble(platform, modelNames)`), liefert `Set<string>` der betroffenen Model-Namen
- Click auf Model in Tabelle öffnet weiterhin die Performance-Slide-Over

### 5. Add-Form clean integrieren

- Add-Form ist **standardmäßig eingeklappt**
- Im Header der Datenbank-Sektion: kleiner Button `+ Model hinzufügen`
- Klick → Form klappt auf (innerhalb der Datenbank-Card, oben)
- Nach erfolgreichem Insert → Form klappt automatisch wieder zu, Felder geleert

### 6. Archetyp-Panel in Tabelle bleibt
Der "Archetyp analysieren"-Button unter jedem Model-Namen bleibt wie er jetzt ist (sichtbare Primary-Pille). Die Profil-URL-Eingabe im Panel wird redundant, weil der Link jetzt schon beim Anlegen oder via Stift gepflegt wird — bleibt aber als Fallback-Edit drin.

---

### Technische Details

**Files:**
- `src/pages/Models.tsx`
  - State: `newProfileUrl`, `editProfileUrl`, `showAddForm` (default `false`), `troubleFilter` (default `false`), `troubleNames: Set<string>`
  - `addModel`: `profile_url: newProfileUrl.trim() || null`
  - `saveEdit`: `profile_url: editProfileUrl.trim() || null`
  - `filteredModels`: zusätzlich `if (troubleFilter && !troubleNames.has(m.model_name)) return false`
  - JSX-Reorg: Filter-Bar zusammenfassen, Datenbank-Card mit collapsible Add
- `src/components/ModelsInTroubleCard.tsx`
  - Logik (Detection) in einen exportierten Hook `useModelsInTrouble` extrahieren
  - Card-Variante kann bleiben (wird nicht mehr verwendet) oder entfernt werden
- DB: keine Schema-Änderung nötig — `profile_url` existiert schon auf `models`

**Filter-Bar Aufbau:** Eine `premium-card` mit Search oben, dann zwei Reihen Pillen (Zeitraum + Status + Trouble), dann optional Archetyp-Sektion (collapsible per Default zu, falls vorhanden).
