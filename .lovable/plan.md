## Problem

Du hast Chatter, die **konstant aktiv und zuverlässig** sind, aber auf kleinen Accounts (wenig Follower) sitzen. Diese sollen automatisch als "Account Upgrade"-Kandidaten erkannt werden — nicht nur basierend auf Umsatz-Streaks, sondern auch auf **Zuverlässigkeit und Konsistenz**.

Aktuell erkennt das System nur `ACCOUNT UPGRADE (UMSATZ-STREAK)` wenn jemand 5 Tage ≥30€ macht. Das verpasst zuverlässige Chatter auf kleinen Accounts, die zwar weniger Umsatz machen, aber **jeden Tag da sind und arbeiten**.

---

## Lösung: Zuverlässigkeits-Score aus Historie

Die Edge Function bekommt bereits die letzten 14 Tage Historie. Wir ergänzen die Kategorie-Logik um einen neuen Schritt:

```text
NEU — SCHRITT zwischen 4 und 5:

🔼 ACCOUNT UPGRADE (ZUVERLÄSSIG)
  Bedingungen (ALLE müssen erfüllt sein):
  1. Mindestens 5 Tage in der Historie vorhanden
  2. An mindestens 80% dieser Tage Umsatz > 0€ gemacht
  4. Kein aktueller Warnung/Einbruch
  
  → Empfehlung: Konkreten größeren Account vorschlagen
```

---

## Technische Umsetzung

### 1. Edge Function `analyze-csv-batch` — Prompt erweitern

Neuer Kategorie-Schritt im `formatInstructions` zwischen SCHRITT 4 (MODEL-TAUSCH) und SCHRITT 5 (0€ UMSATZ):

```
SCHRITT 4b — ACCOUNT UPGRADE (ZUVERLÄSSIG) prüfen:
→ 🔼 ACCOUNT UPGRADE (ZUVERLÄSSIG) — NUR wenn ALLE Bedingungen erfüllt:
  1. Chatter hat mindestens 7 Tage in den HISTORISCHEN DATEN
  2. An mindestens 80% dieser Tage war der Tagesumsatz > 0€
  3. Der Account hat weniger als 50.000 Follower (siehe Models-Liste)
  4. Chatter ist NICHT in WARNUNG oder ACCOUNT-EINBRUCH
  → Empfehlung: "Zuverlässiger Chatter auf kleinem Account. 
     Upgrade auf [größeren Account] empfohlen."
```

### 2. Historie-Block verbessern

Den `historyBlock` um eine Zusammenfassung pro Chatter ergänzen, damit die AI die Konsistenz leichter erkennen kann:

```
Max Mustermann (Account: modelXY, 12.000 Follower):
  Aktive Tage: 10/14 (71%)
  Ø Tagesumsatz: 25,50€
  Historie: 2026-04-01: 30€, 2026-04-02: 0€, ...
```

So muss die AI nicht selbst zählen, sondern bekommt die Zuverlässigkeitsrate direkt geliefert.

### 3. CategoryResultCards — Darstellung

Die neue Kategorie `ACCOUNT UPGRADE (ZUVERLÄSSIG)` mit dem Emoji 🔼 wird automatisch von den bestehenden CategoryResultCards dargestellt — keine UI-Änderung nötig.

---

## Dateien die geändert werden

1. `**supabase/functions/analyze-csv-batch/index.ts**`
  - Neue Kategorie `ACCOUNT UPGRADE (ZUVERLÄSSIG)` im Prompt (Schritt 4b)
  - Historie-Block um Zusammenfassungs-Zeile ergänzen (aktive Tage %, Ø Umsatz, Follower)
  - Models-Daten in den Historie-Block integrieren, damit die AI Follower pro Account sieht

---

## Schwellenwerte (anpassbar)


| Parameter             | Wert   | Begründung                               |
| --------------------- | ------ | ---------------------------------------- |
| Min. Tage in Historie | 5      | Genug Daten für Zuverlässigkeits-Aussage |
| Min. aktive Tage (%)  | 70%    | 4 von 5 Tagen aktiv = zuverlässig        |
| &nbsp;                | &nbsp; | &nbsp;                                   |
| Min. Ø Tagesumsatz    | 0€     | Zeigt dass der Chatter Umsatz generiert  |
