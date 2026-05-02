## Ziel

Im Chatter-Profil (Slide-Over) wird ein neuer Bereich **"Models & Logins"** angezeigt, der alle Models listet, die dieser Chatter laut `chatter_history.account` betreut. Pro Model: zwei Klick-Aktionen — **Mail kopieren** und **Passwort kopieren**.

## Verhalten

- Beim Öffnen des Chatters werden die Distinct-`account`-Werte aus `chatter_history` (für diesen Chatter + Plattform) geladen.
- Diese werden gegen `models.model_name` gematcht und Mail/Passwort daraus gezogen.
- Pro Model eine kleine Karte:
  - Modelname als Titel
  - Button **"✉ Mail"** → `navigator.clipboard.writeText(email)` + Toast "Mail kopiert"
  - Button **"🔑 Passwort"** → `navigator.clipboard.writeText(password)` + Toast "Passwort kopiert"
  - Buttons zeigen den Wert maskiert/abgekürzt (z. B. erste Zeichen der Mail, Punkte für Passwort) — kein Vollklartext im UI.
- Models ohne Logindaten werden nur namentlich gelistet, ohne Buttons.
- Wenn kein Account zugeordnet ist, wird der ganze Bereich nicht angezeigt.

## Technische Umsetzung

**Datei:** `src/components/ChatterSlideOver.tsx`

1. Neuen State `models: { name: string; email: string|null; password: string|null }[]` hinzufügen.
2. Neuer Effect (analog zu bestehenden Loads), getriggert von `chatterName` + `platform`:
   - `select('account').from('chatter_history').eq('chatter_name', chatterName).eq('platform', platform)` → Distinct-Accounts.
   - `select('model_name,email,password').from('models').in('model_name', accounts).eq('platform', platform)`.
   - Reihenfolge: alphabetisch.
3. Neuer Render-Block direkt unter dem Header (über Notes/Charts), nur wenn `models.length > 0`:
   - `SectionHeader` "Models & Logins" mit goldenem Akzent
   - Grid (1 Spalte mobile, 2 Spalten ab `sm`) mit Model-Cards
4. Copy-Handler (gleiches Pattern wie `Models.tsx` Z. 463–480): `navigator.clipboard.writeText` + `toast.success`.

**Keine** Backend-/DB-Änderungen nötig — `models.email` und `models.password` existieren bereits.

## Files

- `src/components/ChatterSlideOver.tsx` (einziger Eingriff)
