## Ziel
Layout nutzt iPhone-Notch & Home-Indicator korrekt: dunkler Hintergrund läuft randlos in die Safe Areas, Inhalte (Header, Main, Sidebar, Sheets, Bottom-Bars) respektieren `env(safe-area-inset-*)` — keine schwarzen Ränder, kein abgeschnittener Content.

## Änderungen

### 1. `index.html`
- Sicherstellen, dass `viewport-fit=cover` gesetzt bleibt (ist schon da).
- `theme-color` bleibt auf `#0a0a0b`, damit iOS/Android die System-UI in derselben Farbe einfärbt → kein sichtbarer Übergang zur Safe Area.

### 2. `src/index.css`
- Tailwind-Tokens für Safe-Area ergänzen (über `@layer utilities`):
  - `.pt-safe`, `.pb-safe`, `.pl-safe`, `.pr-safe`, `.px-safe`, `.py-safe`, sowie `.mt-safe`, `.mb-safe`, jeweils `max(env(safe-area-inset-*), 0px)`.
  - `.h-safe-top`, `.h-safe-bottom` als Hilfs-Spacer.
- Globale Regel: `html, body` behalten `background: hsl(var(--background))` — füllt die Safe Areas dunkel (verhindert weiße/schwarze Streifen).
- `#root` bekommt `padding-left: env(safe-area-inset-left)` und `padding-right: env(safe-area-inset-right)` für Landscape-Notch (iPhone quer).
- Bestehende `--app-height`-Logik unangetastet lassen.

### 3. `src/components/Layout.tsx`
- Wrapper-Div: kein eigenes Padding für Safe Areas mehr — der Hintergrund (`bg-depth`) reicht weiter bis zum Rand.
- Header: 
  - `padding-top: max(env(safe-area-inset-top), 0px)` (statt nur `env(...)`, damit kein NaN auf Geräten ohne Notch).
  - Mindesthöhe Inhalt 56 px, dazu kommt der Inset → Notch-Bereich ist dunkel + leichter Blur, ohne Inhalt zu überdecken.
- Main:
  - `padding-bottom: max(env(safe-area-inset-bottom), 1.5rem)` bleibt.
  - Zusätzlich `padding-left/right: max(env(safe-area-inset-left/right), 0px)` für Landscape.

### 4. `src/components/AppSidebar.tsx`
- `SidebarContent` paddingTop auf `max(env(safe-area-inset-top), 0px) + 2.5rem` umstellen (`max(...)` statt `calc(env(...) + ...)`, damit Geräte ohne Notch nicht zu wenig Abstand bekommen → korrekt: `calc(max(env(safe-area-inset-top), 0px) + 2.5rem)`).
- Logout-Bereich (`pb-6`) ersetzen durch `padding-bottom: calc(max(env(safe-area-inset-bottom), 0px) + 1.5rem)`, damit Home-Indicator nicht den Logout-Button überdeckt.

### 5. Globale Komponenten mit Bottom-Fixierung prüfen
- Suche nach `fixed bottom-0`, `Sheet`, `Drawer`, `Toast` — und Safe-Area-Bottom-Padding ergänzen wo nötig:
  - Bottom-Sheets/Drawer: `padding-bottom: max(env(safe-area-inset-bottom), 1rem)`.
  - Toast-Container: `bottom: max(env(safe-area-inset-bottom), 1rem)`.

## Technische Details
- `max(env(safe-area-inset-*), 0px)` statt nackt `env(...)` verwenden, damit der Wert in CSS `calc()` immer numerisch ist (Safari-Quirk).
- `viewport-fit=cover` ist Voraussetzung — bereits gesetzt.
- Hintergrundfarbe via `html`/`body` deckt alle Safe-Area-Bereiche dunkel — daher entstehen keine schwarzen Ränder, sondern eine homogene Fläche.

## Out of Scope
- Keine Änderung am Manifest, an Icons oder am PWA-Service-Worker.
- Keine Änderung an der bestehenden `--app-height`-Höhenlogik.
