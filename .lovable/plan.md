## Was du bekommst

Im **Wechsel-Mode** zwei neue Stufen, wenn dir ein vorgeschlagenes Tauschpaar nicht zusagt — plus ein durchgängig hochwertiges Premium-Design (Navy/Charcoal + Gold-Akzent), das auch als installierte Web-App auf dem Homescreen smooth läuft.

---

## 1. Zwei-Stufen-Ablehnung (Logik)

Wenn ein Tauschpaar erscheint (`Underplaced ↔ Overplaced`):

**Stufe 1 — Pair komplett verwerfen** (Swipe links auf der ganzen Karte)
- Das ganze Paar fliegt raus.
- Nächster Auto-Vorschlag wird gezeigt.
- Bleibt für den aktuellen Report ausgeblendet (an `analysis_date` gebunden — neuer Report = neuer Vorschlag möglich).

**Stufe 2 — Nur einen Chatter ersetzen** (Pfeil-Icon "Chatter tauschen" auf der jeweiligen Mini-Karte)
- Öffnet ein **Challenger-Picker-Sheet** mit den 5–8 besten Alternativen:
  - **Links (Underplaced) ersetzen** → Pool: andere Underplaced-Chatter, sortiert nach `expectedGain` für genau diesen Account rechts.
  - **Rechts (Overplaced) ersetzen** → Pool: andere Overplaced-Chatter, sortiert nach Fit für genau diesen Account links.
- Jeder Challenger zeigt: Name, Account, Tier, Skill-Score, 7T-Ø Umsatz, **erwarteter Gain (€/Tag)** für genau dieses neu kombinierte Paar.
- Bestätigen → das gewählte Paar ersetzt das vorherige in der Stack-Position.
- "Schließen" → ursprüngliches Paar bleibt.

**Zusätzlich: Bestätigung-Stufe**
- Beim Swipe nach rechts (= "Tausch durchführen") kommt ein kurzer Confirm-Sheet mit beiden Chattern, Accounts und erwartetem Gain → "Bestätigen" oder "Doch ändern" (zurück zum Challenger-Picker).

### Inaktivitäts-Bonus (kleiner Hinweis-Chip)
Wenn der `Overplaced`-Chatter rechts in den letzten 7 Tagen unter 30% seines historischen Durchschnitts ist, erscheint ein dezenter `Im Rückgang`-Chip auf seiner Karte (Wording laut Memory — kein "absäuft").

---

## 2. Premium-Design (Dark · Navy/Charcoal · Gold-Akzent)

**Farbsystem (Tokens in `index.css`):**
- `--background`: `240 18% 4%` (tiefes Navy-Schwarz)
- `--surface-1`: `240 14% 7%` (Karten-Basis)
- `--surface-2`: `240 12% 10%` (gehobene Sektionen)
- `--border`: `240 10% 14%`
- `--foreground`: `40 30% 96%` (warmes Off-White)
- `--muted-foreground`: `240 6% 60%`
- `--accent-gold`: `42 55% 54%` (`#c9a84c`)
- `--accent-gold-soft`: `42 60% 70%`
- `--success`: `152 60% 50%` (Underplaced/Gewinn)
- `--danger`: `0 70% 58%` (Overplaced/Verlust)
- Gradients: `--gradient-card` (radialer Akzent oben + linearer Surface-Verlauf), `--gradient-gold` (Buttons, Confirm-CTA)
- Shadows: `--shadow-elevated` (24px / -24px, sehr weich), `--shadow-gold-glow` (subtiler Gold-Hauch auf Confirm-Buttons)

**Typografie:**
- Headlines: **Instrument Serif** (edel, magazinhaft)
- Body / Numbers: **Inter Tight** mit `tabular-nums` für alle Geld-/Skill-Werte
- Beide via `@fontsource` — kein Google-CDN

**Karten-Stil:**
- `rounded-3xl`, 1px Hairline-Border `border-white/[0.06]`
- Top-Akzentlinie 2px in Side-Farbe (Grün links / Rot rechts / Gold im Picker)
- Inset-Highlight oben (`inset 0 1px 0 hsl(0 0% 100% / 0.04)`)
- Skill-Bar: weicher Gradient mit Glow am rechten Ende

**Motion (framer-motion):**
- Karten-Stack: gestaffelter Fade-In (0.06s Delay pro Karte)
- Swipe: Spring (stiffness 300, damping 28) — wie heute, Distanz-Schwelle 120px (Memory-konform, kein Velocity-Check)
- Challenger-Picker: Sheet von unten, `ease-out-expo`, 280ms
- Confirm-Sheet: Scale-In 0.96 → 1 mit Gold-Glow-Pulse auf CTA
- Subtile Hover-Lift auf Desktop (`y: -2px`), entfällt auf Touch

---

## 3. Mobile- & PWA-Optimierung

- **Touch-Targets:** alle Action-Icons min. 44×44px
- **Safe-Area:** `env(safe-area-inset-*)` Padding für iOS Notch/Home-Indicator
- **Viewport-Meta:** `viewport-fit=cover` (für edge-to-edge auf installierter App)
- **Manifest (`public/manifest.webmanifest`):**
  - `display: "standalone"`, `theme_color: "#0a0a14"`, `background_color: "#0a0a14"`
  - Icons 192/512/maskable
  - Apple-Touch-Icon + Status-Bar `black-translucent`
- **Performance:**
  - Challenger-Picker lazy-loaded
  - Skill-Pills nur auf Desktop (`hidden lg:grid`) — Mobile zeigt nur Top-3 Kennzahlen
  - `will-change: transform` nur während Drag aktiv
- Kein Service-Worker / kein Offline-Mode (du hast Offline nie verlangt — Manifest-only Installation)

---

## 4. Technische Details

**Dateien:**
- `src/lib/swap-suggestions.ts` — neue Funktion `computeChallengersForSlot(pair, side, allChatters, ...)` die für eine konkrete Pair-Slot die besten Alternativen rankt
- `src/components/SwapModeView.tsx`:
  - Neue State: `challengerPickerSide: "left" | "right" | null`, `pendingConfirm: SwapPair | null`
  - Neuer Sub-Component `ChallengerPickerSheet`
  - Neuer Sub-Component `ConfirmSwapSheet`
  - Mini-Karte bekommt Icon-Button `↻` (oben rechts, neben Tier-Badge) für "Diesen Chatter ersetzen"
- `src/index.css` — Token-Refresh (Gold-Palette + neue Gradients/Shadows)
- `tailwind.config.ts` — `fontFamily.serif: ["Instrument Serif", ...]`, `fontFamily.sans: ["Inter Tight", ...]`
- `src/main.tsx` — Font-Imports
- `public/manifest.webmanifest` + Icon-Set + Head-Tags in `index.html`

**Persistenz:**
- Verworfene Paare: weiter über `swap_report_dismissed::*` (existiert schon)
- Per-Slot-Replacements werden NICHT persistiert — nur in-memory während der Session

---

## Was sich NICHT ändert

- Skill-Score-Berechnung, Mismatch-Logik, Tier-System, 7-Tage-Fenster — alles bleibt wie es ist
- Swipe-Schwelle bleibt 120px Distanz (Memory)
- Channel/Wochenplan und andere Bereiche werden nicht angefasst
