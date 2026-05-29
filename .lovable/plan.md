# Hot-Streak Alerts: Chatter über Pace

## Trigger-Logik
Ein Chatter löst einen Hot-Streak-Alert aus, wenn beim Live-Update gilt:
- **Heutiger Umsatz ≥ 150% der erwarteten Pace** (basierend auf 14-Tage-Schnitt × Tagesfortschritt seit 06:00 Berlin)
- Mindestens **30 €** heute (Spam-Filter für kleine Tage)
- Letzter Alert für diesen Chatter heute liegt **>2h zurück** (Dedupe — sonst spamt's bei jedem Live-Tick)

## Komponenten

### 1. Datenbank (Migration)
- `push_subscriptions` (user_id, endpoint UNIQUE, p256dh, auth, created_at)
- `hot_streak_alerts` (user_id, platform, chatter_name, date, revenue_at_alert, pace_pct, sent_at) — für Dedupe + History

### 2. Secrets
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (mailto:) — generiere ich, du fügst sie ein

### 3. Edge Functions
- **`save-push-subscription`** — speichert die Browser-Subscription nach Permission-Grant
- **`hot-streak-check`** — wird am Ende von `upsert-chatter-live` aufgerufen, scannt frische Live-Zeilen, vergleicht gegen 14-Tage-Profile, sendet Push via `web-push` (npm:) an alle Subscriptions des Owners

### 4. Frontend
- **Service Worker** `public/sw.js` — empfängt Push, zeigt OS-Notification mit Chatter-Name + "💰 250% vs Pace · 180€"
- **Settings → "Hot-Streak Alerts"**: Button "Browser-Push aktivieren" → fragt Permission, registriert SW, speichert Subscription
  - Sichtbarer Hinweis: "Funktioniert nur in der veröffentlichten App, nicht im Lovable-Editor. Auf iPhone: zuerst zum Home-Screen hinzufügen."
- **In-App Fallback im Live-Tracking**:
  - Realtime-Subscription auf `hot_streak_alerts`
  - Sonner-Toast (🔥 "Lena läuft heiß · 220% · 180€")
  - "🔥"-Badge an Chatter-Karte solange Streak heute aktiv

### 5. PWA-Manifest
Minimal-Manifest (`manifest.json` existiert schon) — keine `vite-plugin-pwa` Integration, kein Caching, **nur** der Push-SW. Der SW wird im Editor-Iframe nicht registriert (Guard auf `window.self !== window.top`).

## Was du danach tust
1. Migration freigeben
2. VAPID-Secrets eintragen (zeige ich dir, sobald generiert)
3. Auf der veröffentlichten URL einmal "Push aktivieren" klicken + Permission geben
4. (iPhone) App zum Home-Screen hinzufügen, dann dort Permission geben

## Was bewusst NICHT drin ist
- Kein Vollkasko-PWA (keine Offline-Cache, kein Install-Prompt-Banner) — vermeidet die SW-Stale-Cache-Probleme im Preview
- Keine Sound-/Vibration-Customization (nutzt OS-Defaults)
- Keine "kalte" Streak-Erkennung am Tagesende — feuert nur live während Aktivität