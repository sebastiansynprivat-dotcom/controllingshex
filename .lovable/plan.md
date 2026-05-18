## Ziel

Die Today-Page wird auf eine Ebene reduziert (Unterkategorien als Tabs) und die Karten bekommen das gewählte Apple-Minimalist-Glass-Design mit inline Signal-Liste.

## 1. Tab-Struktur umbauen (`src/pages/Today.tsx`)

Aktuell: zwei Tab-Ebenen + Section-Header in der Liste = 4-fache Redundanz.

Neu: eine Ebene.

- **Section-Tabs raus**: "Jetzt machen / Im Auge behalten / Wins / Erledigt" verschwinden komplett aus der UI.
- **Unterkategorien werden die Haupt-Tabs**: "Alle · N", "Verzug · N", "Recovery · N", "Account-Tausch · N", "Talent · N". "Alle" ist Default.
- **Status-Filter** (Wins / Erledigt / Snoozed) wandert in ein dezentes Dropdown rechts oben neben den Tabs ("Status: Offen ▾"). Default = Offen (= bisheriges "Jetzt machen" + "Im Auge behalten" zusammen).
- **Section-Header in der Liste raus** (kein "VERZUG · 1" mehr über jeder Karte) — die Kategorie ist durch den aktiven Tab schon klar. Bei Tab "Alle" werden Karten weiterhin nach Kategorie gruppiert mit einem ganz dezenten Trenner (kleine Caps-Überschrift, kein farbiger Punkt, kein €-Wert rechts — das ist bereits in der Karte).
- Header-KPI ("Offener €-Hebel / Wo +12.426 €") und Progressbar bleiben unverändert.

## 2. Karte redesignen (`src/components/PersonActionCard.tsx`)

Komplette visuelle Überarbeitung nach gewählter v3-Vorlage. Funktionalität (Done / Snooze / Dismiss / Expand / Belege) bleibt 1:1 erhalten, nur Layout & Optik ändern sich.

**Aufbau:**

```text
┌──────────────────────────────────────────────────┐
│ Jonas Jo   [Verzug-Bundle]      ~+613 €/Wo       │
│ 4 AKTIVE SIGNALE DETEKTIERT     • Kritisch       │
├──────────────────────────────────────────────────┤
│ ▍ Zahlungsziel überschritten        →           │
│   Vor 12 Min.                                    │
│ ▍ Lastschrift fehlgeschlagen        →           │
│ ▍ Mahnung Stufe 2                   →           │
│ ▍ Inaktivität Dashboard             →           │
├──────────────────────────────────────────────────┤
│ [JJ●] System-Agent      ⏱  ✕   [Abschließen ✓]  │
└──────────────────────────────────────────────────┘
```

**Konkrete Änderungen:**

- Karten-Container: `rounded-2xl bg-card border border-border/40`, dezenter Tone-Glow oben (Gradient `from-{tone}/10 to-transparent`, nur sichtbar).
- Header-Zone: Name (xl, bold, weiß), kleines Bundle-Pill (Verzug-Bundle / Recovery-Bundle …), darunter Caps-Hinweis "N AKTIVE SIGNALE". Rechts: €-Wert in Tone-Farbe (rot/amber/cyan/emerald je Kategorie), darunter Status-Pill mit pulsierendem Dot.
- Signal-Liste **inline immer sichtbar** (nicht mehr nur per Expand). Jedes Signal: linker Tone-Balken (Intensität spiegelt Recency/Severity), Titel in Caps + Zeitstempel darunter, Chevron rechts. Bei Klick → Beleg/Detail-Drawer (gleiche Datenquelle wie bisheriges Expand).
- Footer-Bar (eigene innere Pill `bg-white/[0.02] border-white/[0.05] rounded-xl p-2`): links Avatar + Zuordnung, rechts Snooze-Icon, Dismiss-Icon (klein, dezent) und primärer Button "Abschließen" (weiß auf schwarz statt grün, premium).
- Confidence (`~`) bleibt vor €-Wert wie bisher.
- Bei nur 1 Signal: Signal-Liste zeigt 1 Eintrag, kein "+N Bundle"-Label.
- Wins / Erledigt-Variante: Footer-Button verschwindet, Karte wirkt grayed-out (opacity 60, kein Glow).

## 3. Tone-Farben

Bleiben semantisch wie heute:
- Verzug → `red`
- Recovery → `cyan`
- Account-Tausch → `amber`
- Talent → `violet`/`emerald`

Werden via Token-Map angesteuert, nicht hardcoded.

## 4. Aufwand & Scope

- Nur Frontend, keine Datenmodell-Änderungen.
- Bestehende Filter-/Aggregations-Logik in Today.tsx bleibt; nur die Tab-Quelle wechselt von Section → Kategorie und Status-Filter wird Dropdown.
- Mobile bleibt funktional (Tabs horizontal scrollbar, Karten vollbreit).

## Out of scope

- Keine Änderungen am Dashboard-Widget "Heute zu tun".
- Keine Änderungen an Swipe-Mode.
- Keine neuen Daten oder Edge Functions.
