## Ziel

Den `/tinder`-Bereich (Swipe-Mode, Wechsel-Mode, Vergleichs-Mode) und das Performance-Profil (`ChatterSlideOver`) mobil so sauber machen, dass die App als **Homescreen-PWA** mit Notch/Dynamic Island, ohne Browser-Chrome und ohne Sidebar wirklich funktioniert. Aktuell brechen zwei Sachen sichtbar:

1. **Performance-Profil lässt sich nicht mehr schließen**, sobald es als Overlay über das Tinder-Layout geht — der X-Button verschwindet hinter Notch/Status-Bar, weil `padding-top` zwar `safe-area` addiert, der Header aber durch `Layout`-Konflikt nicht oben bleibt.
2. **Vergleichs-Mode + Wechsel-Mode** quetschen Header, Filter-Pills, Zentral-Badge und Karten so eng zusammen, dass auf 390–414 px Breite Inhalte abgeschnitten oder unklickbar werden.

---

## Befund (was ich konkret gesehen habe)

### A) Performance-Profil (`ChatterSlideOver`, Overlay-Modus)
- `motion.aside` ist `fixed inset-y-0 right-0 w-full sm:w-[520px]` → auf Mobile **vollflächig**, korrekt.
- Header bekommt `paddingTop: calc(env(safe-area-inset-top, 0px) + 0.75rem)` — aber:
  - **Bug 1:** Der `X`-Button (Z. 566–571) hat `p-2.5` und liegt im Header — bei iPhone-Notch (44 px Inset) rutscht der Title nach unten, der Button bleibt aber im normalen Flow → er sitzt **direkt unter der Dynamic Island** und wird vom System-UI verdeckt.
  - **Bug 2:** Im PWA-Standalone-Mode gibt es kein Browser-Chrome → safe-area greift, aber der Header hat keine eigene Hit-Area-Erweiterung. Wenn der User auf Höhe der Status-Bar tippt, kommt das Event nicht beim Button an.
  - **Bug 3:** Doppel-Tipp-Schließen (Z. 504–519) ignoriert Buttons — gut. Aber auf den Charts (recharts) ist `pointer-events` aktiv, dadurch wird Doppel-Tipp dort verschluckt → User findet keinen Weg raus, wenn der X-Button verdeckt ist.
- **Bug 4 (Layout):** `<div ref={scrollRef} className="flex-1 overflow-y-auto …">` hat **kein** `pb-[env(safe-area-inset-bottom)]` → die letzte Zeile (Verlauf-Tabelle) verschwindet hinter der Home-Indicator-Bar.

### B) Vergleichs-Mode (`CompareModeView`)
- Direkt zwei `CompareFilterPanel` nebeneinander in `grid-cols-2 gap-2` (Z. 211–232) → auf 390 px sind die Akkordeons jeweils nur ~185 px breit, die Filter-Pills brechen mit nur 1–2 Items pro Zeile, das Panel wird brutal hoch.
- Die zwei Swipe-Karten (`CompareSlot`) sind ebenfalls `grid-cols-2 gap-2` — auf Mobile passen 2 nebeneinander schlecht (jede Karte ~180 px breit, 280 px hoch). Felder werden truncated, Skill-Bar ist okay, aber Stats darunter quetschen.
- **Compare-Dialog** öffnet `max-w-[1400px] w-[95vw] h-[90vh]` mit `grid-cols-2` — auf Mobile heißt das **zwei `ChatterSlideOver` nebeneinander auf 380 px** → beide Charts laufen über, X-Button ist im DialogContent eingebaut aber sehr klein → **das ist genau das, was du nicht mehr schließen kannst**.

### C) Wechsel-Mode (`SwapModeView`)
- Header (Z. 998–1060) hat `flex items-center justify-between` mit zwei Blocks die je 3–4 Pills enthalten. Auf Mobile bricht das in eine zweite Zeile, aber die rechte Seite hat zusätzlich den `+€/Tag`-Pill, `Follower-Ratio`-Pill **und** den `Manuell wählen`-Button → das kollidiert.
- Karten-Bereich (Z. 1063): `grid-cols-1 lg:grid-cols-2` ist korrekt für Mobile (untereinander). **ABER**: die Karte selbst hat `min-h` nicht gesetzt, dafür inneres Padding `p-3 lg:p-7` plus 4 Skill-Pills die auf Mobile mit `hidden lg:grid` versteckt sind — gut. Trotzdem sind die zwei Karten + zentraler Tausch-Badge zusammen ~ 700 px hoch → mit Filter-/Header-Block oben darüber wird der gesamte Inhalt scroll-bar, aber der äußere Container hat `overflow-hidden` und **`touchAction: 'none'`** (Z. 1144) gesetzt → **vertikales Scrollen ist blockiert, der User sieht nur die obere Hälfte und kann nicht runter scrollen.**

### D) `/tinder`-Container generell
- `TinderMode` hat `style={{ maxHeight: '100dvh', touchAction: 'none' }}` (Z. 1144). Das ist für den Swipe-Mode korrekt (Karte braucht touchAction-none), bricht aber **Wechsel- und Vergleichs-Mode**, wo der Inhalt scrollbar sein muss.
- Beim PWA-Homescreen-Add fehlt `viewport-fit=cover` Verifikation → ich prüfe `index.html`.

---

## Fix-Plan

### 1) `ChatterSlideOver.tsx` — Schließen-Schutz für PWA

- **Header sticky machen** statt im Flow: `sticky top-0 z-20`, `bg-zinc-950/95 backdrop-blur-xl`. Damit bleibt der X-Button auch beim Scrollen erreichbar.
- **Größere Hit-Area für X**: von `p-2.5` (≈ 36×36 px) auf `h-11 w-11` (44×44 px = Apple HIG-Mindestmaß), zusätzlich ein **zweiter unsichtbarer Tap-Hit oben rechts** der bis in die Status-Bar reicht (über safe-area-inset-top expanded).
- **Sticky "Schließen"-Pill am unteren Rand auf Mobile**: schwebender, kleiner Button (`fixed bottom-[calc(env(safe-area-inset-bottom)+12px)] right-4 sm:hidden`) als Fallback — immer erreichbar, egal wo gescrollt.
- **Swipe-down-to-close**: `motion.aside` bekommt `drag="y"` mit `dragConstraints={{ top: 0, bottom: 0 }}` und `onDragEnd` → schließt wenn `offset.y > 120`. Konsistent mit Memory-Regel (nur Distanz, keine Velocity).
- **Bottom-Padding** für Scroll-Container: `pb-[calc(env(safe-area-inset-bottom)+24px)]`.
- Im **Inline-Mode** (für Compare-Dialog): Header muss auch sticky sein, damit beim Scrollen in der gesplitteten Ansicht der Name oben sichtbar bleibt.

### 2) Compare-Dialog → **Mobile = Vollbild-Sheet, kein Side-by-Side**

- Auf `< sm` (< 640 px): statt `grid-cols-2` die zwei Profile als **Tabs** rendern (`Sarah ↔ Tim`-Switch oben). Jedes Profil bekommt volle Breite, scrollbar, eigener Schließen-Button im Sticky-Header.
- Dialog-Container auf Mobile: `w-screen h-[100dvh] max-w-none rounded-none`, `safe-area`-Insets respektieren.
- Auf `≥ sm`: bleibt wie bisher (zwei Spalten).

### 3) `CompareModeView.tsx` — Filter & Karten kompakter

- Die zwei `CompareFilterPanel` bleiben nebeneinander (sind schon mobil als bottom-sheet implementiert — okay) — aber der **Chip-Header darüber** wird auf < 400 px zu hoch. Lösung: Pills nur als kleine Icons (ohne Text-Label) im chip header.
- **Karten side-by-side** auf Mobile beibehalten (das ist die Grundidee des Compare), aber:
  - `min-h` von `280` auf `260` reduzieren auf < 400 px.
  - Stats-Grid `grid-cols-2` → bei sehr schmal `grid-cols-1` mit horizontaler Anordnung.
  - Account-Zeile mit `truncate` ist da, aber Tier-Pill rechts oben überschreibt manchmal — Tier nach unten in Stats-Block verschieben.
- `LiveDeltaBox` (Z. 643): aktuell `flex flex-wrap gap-1.5` mit 3 Pills — passt knapp. Pills bekommen `flex-1 justify-center` auf Mobile damit sie gleich breit werden.

### 4) `SwapModeView.tsx` — Header entwirren + Scroll fixen

- Header (Z. 998–1060) auf Mobile **in zwei Reihen** aufteilen:
  - Reihe 1: `Wechsel-Vorschlag`-Label + `↑↓`-Counter + `+€/Tag`-Hauptpill (groß, rechts).
  - Reihe 2: `Follower-Ratio`-Pill + `Manuell wählen`-Button (kompakter, ohne Icon-Text auf Mobile).
- **Bug-Fix**: Card-Stage Container (Z. 1063) bekommt auf Mobile `overflow-y-auto` (ist drin) — aber das wird vom Outer-Container in `TinderMode.tsx` mit `touchAction: 'none'` blockiert. Lösung: `touchAction: 'none'` **nur im Swipe-Mode** anwenden, nicht in Wechsel/Vergleich.

### 5) `TinderMode.tsx` — Container conditional

```tsx
style={{
  maxHeight: '100dvh',
  touchAction: mode === 'swipe' ? 'none' : 'pan-y',
}}
```
- Padding-Top auf Mobile reduzieren (`pt-2` statt `pt-3`).
- Mode-Toggle (Z. 1148) bekommt `sticky top-0 z-10 bg-background/80 backdrop-blur` auf Mobile, damit er beim Scrollen sichtbar bleibt im Wechsel/Vergleich.

### 6) PWA-Hygiene (`index.html`)

- Verifizieren/setzen: `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`.
- `<meta name="apple-mobile-web-app-capable" content="yes">`, `apple-mobile-web-app-status-bar-style=black-translucent` falls noch nicht vorhanden.
- `theme-color` matchen mit dem dunklen Background.

### 7) Verifikation

Nach Implementierung im Default-Mode:
- Browser auf 390×844 (iPhone 14) öffnen, durch Swipe → Wechsel → Vergleich navigieren.
- Performance-Profil von einer Karte aus öffnen, prüfen: X-Button erreichbar, Swipe-down schließt, Floating-Schließen-Pill sichtbar.
- Compare-Dialog öffnen (Doppel-Tap auf eine Compare-Karte) → Tab-Switch funktioniert, X-Button schließt.
- Wechsel-Mode: Header in zwei Reihen, kein Cut-off, untere Karte erreichbar (scrollbar).

---

## Files

- **edit** `src/components/ChatterSlideOver.tsx` (Sticky-Header, Floating-Close, Swipe-down, safe-area)
- **edit** `src/components/CompareModeView.tsx` (Mobile-Tabs im Dialog, kompaktere Karten)
- **edit** `src/components/CompareFilterPanel.tsx` (chip-header schlanker, Icons-only auf < 400 px)
- **edit** `src/components/SwapModeView.tsx` (Header-Umbruch, `Manuell wählen`-Button kompakt)
- **edit** `src/pages/TinderMode.tsx` (`touchAction` conditional, sticky mode toggle)
- **edit** `index.html` (`viewport-fit=cover`, PWA-Meta-Tags falls fehlend)

**Kein** Schema-Change. **Keine** neuen Dependencies. **Kein** Breaking-Change für Desktop — alle Änderungen sind responsive Erweiterungen.
