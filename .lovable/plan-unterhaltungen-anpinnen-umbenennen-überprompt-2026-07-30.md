# Unterhaltungen: Anpinnen, Umbenennen, Überprompt

Drei Erweiterungen im AI-Konsulenten, alle in der Sidebar-Liste der Unterhaltungen.

## 1. Anpinnen

- Jede Unterhaltung bekommt einen Pin-Button (erscheint beim Hover, auf Mobile dauerhaft sichtbar).
- Gepinnte Unterhaltungen stehen oben in einer eigenen Gruppe "Angepinnt", darunter "Zuletzt" mit dem Rest.
- Sortierung innerhalb der Gruppen bleibt nach letzter Aktivität.
- Der Pin-Status wird gespeichert und bleibt nach Reload erhalten.

## 2. Titel bearbeiten

- Umbenennen-Button pro Zeile (Stift-Icon), ohne die Unterhaltung öffnen zu müssen.
- Klick verwandelt die Zeile in ein Eingabefeld: Enter speichert, Escape bricht ab, Klick nach außen speichert ebenfalls.
- Der Titel wird sofort in der Liste und in der Mobile-Kopfzeile aktualisiert.
- Der Auto-Titel aus der ersten Nachricht bleibt Standard, wird aber nach manueller Umbenennung nicht mehr überschrieben.

## 3. Überprompt pro Unterhaltung

- Pro Unterhaltung kann ein Überprompt hinterlegt werden (eigener Text, z. B. eine wiederkehrende Analyse-Anweisung).
- Bearbeitet wird er über einen kleinen Bereich oberhalb der Eingabezeile: Button "Überprompt" öffnet ein Feld zum Schreiben/Ändern/Löschen.
- Ist ein Überprompt hinterlegt, erscheint neben der Eingabe der Button "Prompt ausführen". Klick schickt den Prompt als normale Nachricht in genau diese Unterhaltung — die AI antwortet wie gewohnt inkl. Tools.
- Kein Dauer-Kontext: Der Prompt wirkt nur beim Ausführen, nicht automatisch bei jeder Nachricht.
- In der Sidebar zeigt eine kleine Markierung, welche Unterhaltungen einen Überprompt haben.

## Technische Umsetzung

- Migration auf `ai_threads`: neue Spalten `pinned boolean not null default false`, `super_prompt text`, `title_custom boolean not null default false`. Bestehende RLS-Policies decken Update bereits ab; ggf. fehlende `UPDATE`-Policy und Grants ergänzen.
- `src/pages/AIConsultant.tsx`:
  - `Thread`-Interface und `loadThreads` um die neuen Felder erweitern, Sortierung `pinned desc, updated_at desc`.
  - Sidebar-Zeile in eine eigene Komponente `src/components/ai/ThreadRow.tsx` auslagern (Select / Rename-Inline-Edit / Pin / Delete) — keine verschachtelten Buttons, Row als `div`.
  - Neue Handler `togglePin`, `renameThread`, `saveSuperPrompt`, `runSuperPrompt` (ruft das bestehende `sendMessage` mit dem gespeicherten Text auf).
  - Überprompt-Editor als kleines Panel `src/components/ai/SuperPromptBar.tsx` über der Eingabezeile; nur sichtbar in echten Unterhaltungen (nicht bei Fahrplan / Rückblick / Company).
  - Neue Unterhaltung: Überprompt wird nach dem Anlegen des Threads gespeichert, falls vorher eingegeben.
- Bestehende Streaming-/Routing-Logik bleibt unangetastet.
