

## Plan: Authentifizierung mit E-Mail/Passwort + Google Login

### Was sich ändert

Nutzer müssen sich anmelden, bevor sie die App nutzen können. Alle Daten (Reports, Chatter-History, etc.) werden einem Benutzer zugeordnet und sind nur nach Login sichtbar — auch vom Handy aus.

### Schritte

**1. Datenbank: `user_id` zu allen Tabellen hinzufügen**
- Migration: `user_id UUID REFERENCES auth.users(id)` als neue Spalte zu `analysis_reports`, `chatter_history`, `coaching_notes`, `models`, `settings` hinzufügen
- Bestehende Daten bekommen einen NULL-Wert (nullable, damit nichts kaputt geht)
- RLS-Policies aktualisieren: Nur eigene Daten lesen/schreiben (`auth.uid() = user_id`)

**2. Auth-Seite erstellen**
- Neue Seite `src/pages/Auth.tsx` mit Login/Signup-Formular (E-Mail + Passwort)
- Google-Login-Button via Lovable Cloud OAuth
- Passwort-Vergessen-Funktion mit Reset-Seite (`/reset-password`)

**3. Auth-Context & Route-Schutz**
- `src/contexts/AuthContext.tsx` erstellen mit `onAuthStateChange` Listener
- Alle Routes außer `/auth` und `/reset-password` schützen (Redirect wenn nicht eingeloggt)
- Logout-Button in der Sidebar

**4. Daten an Benutzer binden**
- Alle Supabase-Inserts (Upload, Models, Settings, etc.) um `user_id: session.user.id` erweitern
- Alle Queries filtern automatisch per RLS

**5. Edge Functions anpassen**
- `analyze-csv`, `delete-analysis`, `save-api-key` etc.: Benutzer-ID aus Auth-Header extrahieren und bei DB-Operationen verwenden

### Dateien

| Datei | Aktion |
|---|---|
| `src/pages/Auth.tsx` | Neu — Login/Signup |
| `src/pages/ResetPassword.tsx` | Neu — Passwort zurücksetzen |
| `src/contexts/AuthContext.tsx` | Neu — Session-Management |
| `src/App.tsx` | Route-Schutz + neue Routes |
| `src/components/AppSidebar.tsx` | Logout-Button |
| `src/pages/Upload.tsx` | `user_id` bei Inserts |
| `src/pages/Dashboard.tsx` | Query mit Auth |
| `src/pages/Models.tsx` | Query mit Auth |
| `src/pages/SettingsPage.tsx` | Query mit Auth |
| Edge Functions | Auth-Header auswerten |
| Migration SQL | `user_id` + RLS-Policies |

