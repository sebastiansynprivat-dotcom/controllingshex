# Controlling

PROMPT FÜR LOVABLE: Baue mir eine hochmoderne, visuell extrem ansprechende Web-App (Dashboard) für das interne Management meiner Chat-Agentur.

1. DESIGN & UI/UX (PREMIUM LOOK):

Farbpalette: Ein luxuriöses Dark Mode Theme. Tiefe Schwarz- und Anthrazit-Töne für den Hintergrund (z.B. bg-zinc-950, Karten in bg-zinc-900). Akzentfarbe ist ein edles Gold (z.B. #D4AF37 oder ein moderner Gold-Gradient) für Buttons, aktive Tabs und Highlights. Text in klarem Weiß/Grau für perfekte Lesbarkeit.

Animationen & Feeling: Nutze softe Fade-ins beim Laden der Seiten. Buttons sollen beim Hover leicht aufleuchten (Glow-Effekt in Gold) und sich sanft vergrößern (Scale). Nutze subtiles Glassmorphism für Overlays oder Header.

Struktur: Die App muss extrem aufgeräumt sein. Nutze eine seitliche Navigation (Sidebar) zum Wechseln der Ansichten.

2. SEITEN & FUNKTIONEN: Die App besteht aus drei Hauptseiten:

A) Haupt-Dashboard (Der Workspace):

Upload-Zone: Ein visuell ansprechender Drag & Drop Bereich (gestrichelt, goldener Hover-Effekt) für den Upload der täglichen Excel/CSV-Datei.

Ergebnis-Bereich: Sobald die KI die Auswertung beendet hat, soll das Ergebnis (die Markdown-Tabelle) hier extrem übersichtlich und gut formatiert gerendert werden. Keine gequetschten Layouts.

Copy-Button: Ein auffälliger, goldener Button "Tabelle für Google Sheets kopieren" direkt über dem Ergebnis, der die Tabelle fehlerfrei in die Zwischenablage legt.

B) Models & Follower (Datenbank):

Eine saubere Listen-/Tabellenansicht, in der ich meine Models eintragen kann (Spalten: "Model Name" und "Follower-Zahl").

Features: Neues Model hinzufügen, Followerzahl bearbeiten, Model löschen.

C) Einstellungen (Admin & Prompt-Gehirn):

System-Prompt Feld: Ein großes Textfeld (Textarea), in dem ich meinen sehr langen KI-Master-Prompt speichern kann.

API Key Feld: Ein sicheres Password-Input-Feld für meinen Anthropic (Claude) API-Key.

3. DATENBANK & BACKEND (SUPABASE):

Verbinde die App mit Supabase.

Speichere die Models und den System-Prompt in der Supabase Datenbank, damit sie dauerhaft erhalten bleiben.

Speichere den Anthropic API-Key zwingend in den Supabase Secrets, damit er geschützt ist.

4. KI LOGIK (EDGE FUNCTION):

Wenn ich im Dashboard eine Datei hochlade und auf "Analysieren" klicke, starte eine sichere Edge Function.

Diese Function nimmt: 1. Die hochgeladenen CSV-Daten, 2. Die Liste aller Models/Follower aus der Datenbank, 3. Den gespeicherten System-Prompt aus den Einstellungen.

Sie sendet alles an die Anthropic API (Modell: Claude 3.5 Sonnet) und gibt das Markdown-Ergebnis an das Frontend zurück. Während des Ladens soll ein cooler, goldener Loading-Spinner (z.B. "KI analysiert Daten...") angezeigt werden.

Bitte baue das komplette Grundgerüst, setze das Design pixelperfekt um und richte die Backend-Logik ein!

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://controllingshex.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/44639bf0-93f9-4b7c-87d4-70640a53beb1).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
