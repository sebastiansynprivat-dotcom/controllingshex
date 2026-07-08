Ziel: Direkt oben im Nachrichten-Tab konkrete Warnungen sehen — "Chatter X sitzt auf Account Y, viel Traffic, wenig Umsatz." Kein Toggle, keine zweite Ansicht, nichts zum selbst filtern.

## Was neu ist

Ein einziger neuer Block **ganz oben** im Nachrichten-Tab, direkt nach dem Header:

> **Potenzial verschenkt**
> - **Lena** auf **@sophie_dreams** — 420 Msg / 85 € (0,20 €/Msg)
> - **Tom** auf **@mia_official** — 310 Msg / 60 € (0,19 €/Msg)
> - **Anna** auf **@bella_x** — 280 Msg / 55 € (0,20 €/Msg)

Nur wenn solche Fälle existieren. Sonst wird der Block gar nicht angezeigt.

Jede Zeile ist klickbar → scrollt/springt zur passenden Chatter-Karte in der Liste unten (bestehende Modell-Aufteilung zeigt dann Details).

## Wie die Fälle erkannt werden

Automatisch im Hintergrund, ohne Bedienung:
- Zeitraum: **letzte 30 Tage** (fix, long-term stabil).
- Für jede Chatter-Account-Kombination: Nachrichten und Umsatz aus `chatter_history` (Feld `open_chats` als Msg-Proxy, `revenue_today` als Umsatz).
- Kombi gilt als "Potenzial verschenkt" wenn:
  - Nachrichten im oberen Drittel aller Kombis **und**
  - €/Msg im unteren Drittel aller Kombis
- Sortiert nach Nachrichten-Volumen absteigend (die dicksten Fische zuerst).
- Maximal 5 Zeilen, sonst wird's Wall of Text.

## Technisch

- Rein frontend, keine neue Tabelle, keine Migration.
- Datei: `src/pages/Messages.tsx` — eine neue Query beim Load, ein neuer Block über der Chatter-Liste.
- Läuft unabhängig vom oben eingestellten Zeitraum (der bleibt für die Chatter-Liste wie bisher).