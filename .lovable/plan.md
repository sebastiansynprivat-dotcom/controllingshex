## Goal
Switch chat fetching from synchronous to an async webhook flow:
1. Frontend triggers a fetch and gets a `request_id` immediately.
2. External service processes in the background and POSTs the result back to a public Edge Function.
3. UI subscribes via Supabase Realtime and renders as soon as chats arrive. While waiting, a pulsing skeleton (10 rows) is shown for up to 1 minute.

## 1. Database: `chats_fetch_requests`
```text
- id                  uuid pk (= request_id)
- user_id             uuid
- telegram_id, platform, model_username, token, recipient_username
- date_range_start, date_range_end (date)
- status              text  ('pending' | 'completed' | 'failed')
- result_json         jsonb (array of chats)
- error_message       text
- created_at, updated_at
```
- RLS: user can select/insert/update own rows; service_role full.
- GRANTs for `authenticated` + `service_role`.
- Add table to `supabase_realtime` publication; `REPLICA IDENTITY FULL`.

## 2. Edge Function `request-chats` (JWT-verified in code)
- Validates session.
- Inserts a `chats_fetch_requests` row (`status = 'pending'`).
- POSTs to `https://api.controlling.shexadmin.ngrok.pro/fetch-chats` with the original payload **plus `request_id`** (no `webhook_url` — external service already knows the callback endpoint).
- Uses `CONTROLLING_CHAT_KEY` as `x-api-key`.
- Returns `{ request_id }` immediately (does not wait for chats).

## 3. Edge Function `chats-webhook` (public, `verify_jwt = false`)
- Validates incoming `x-api-key` against `CONTROLLING_CHAT_KEY`.
- Body: `{ request_id, success, chats?, error? }`.
- Updates the matching row: `status = 'completed'` + `result_json = chats`, or `status = 'failed'` + `error_message`.
- Returns `{ ok: true }`.
- Register in `supabase/config.toml`:
  ```toml
  [functions.chats-webhook]
  verify_jwt = false
  ```

## 4. Frontend

### `src/lib/get-chats-api.ts`
- Replace `fetchChats()` with `requestChats(payload)` → calls `supabase.functions.invoke('request-chats')` → returns `{ request_id }`.
- Keep `FetchedChat` / `FetchedMessage` types and `summarizeMessage()` for rendering the arrived data.

### `GetChatsButton.tsx`
- On filter submit: `const { request_id } = await requestChats(payload)`, store `requestId`, open viewer.
- Refresh button creates a fresh request (new `request_id`).

### `ChatsViewerModal.tsx`
- Props: add `requestId?: string`; remove/ignore `chats` + `loading` from parent (state now lives inside modal driven by Realtime).
- On open, subscribe to `chats_fetch_requests` filtered by `id=eq.<requestId>` via `postgres_changes` (UPDATE + INSERT). Also do one initial `select` to catch a row that already completed.
- State machine:
  - `pending` → show **pulsing skeleton with 10 rows** (both left list rows and right message pane placeholders). Start a 60s timer; if still pending after 1 min → show a soft "Dauert länger als erwartet…" message with a manual retry (keeps skeleton or turns into a subtle text state).
  - `completed` → parse `result_json` into `FetchedChat[]`, run each `last_message` through `summarizeMessage`, render current UI.
  - `failed` → render `error_message` in the existing error slot.
- Clean up channel + timer on unmount / close / new `requestId`.

### Skeleton
Small local component inside the modal file — 10 rows in the left list (avatar-line block + short line), each with `animate-pulse bg-white/[0.06]`. Right pane shows 3–4 skeleton bubbles alternating left/right, same pulse.

## Files touched
- `supabase/migrations/...` — new table, RLS, grants, realtime publication
- `supabase/functions/request-chats/index.ts` — new
- `supabase/functions/chats-webhook/index.ts` — new
- `supabase/config.toml` — add `chats-webhook` block
- `src/lib/get-chats-api.ts`
- `src/components/get-chats/GetChatsButton.tsx`
- `src/components/get-chats/ChatsViewerModal.tsx`

## Assumption
The external ngrok service already knows the callback URL for `chats-webhook` and will POST results there with `x-api-key: CONTROLLING_CHAT_KEY` and body `{ request_id, success, chats?, error? }`.