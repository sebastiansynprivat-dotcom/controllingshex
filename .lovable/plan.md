## Goal

Replace the placeholder `get-assigned-models` call with a real POST to `https://acznyhzgbkdcmnbqvptt.supabase.co/functions/v1/controlling-chats`, fetch tokens per model, and carry each token through the flow so a later backend request can use it.

## Changes

### 1. Resolve real `telegram_id` for the opened chatter
Currently `ChatterSlideOver` passes `chatterName` as `telegramId` — that's wrong. Look up the chatter's actual `telegram_id` from `chatter_history_live` (unique per chatter_name + platform) once when the slide-over opens, and pass that value into all three `<GetChatsButton>` instances.

- File: `src/components/ChatterSlideOver.tsx`
  - Add `telegramId` state, populate via `supabase.from('chatter_history_live').select('telegram_id').eq('chatter_name', chatterName).eq('platform', platform).limit(1)`.
  - Replace `telegramId={chatterName}` on all three usages with the resolved id (empty string while loading; button stays enabled but Modal will show a clear error if missing).

### 2. Call the real controlling-chats endpoint
- File: `src/components/get-chats/ModelPickerModal.tsx`
  - Replace `supabase.functions.invoke("get-assigned-models", ...)` with a `fetch('https://acznyhzgbkdcmnbqvptt.supabase.co/functions/v1/controlling-chats', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ telegram_id: telegramId }) })`.
  - Parse response `{ telegram_id, tokens: [{ platform, username, token }] }` and render the list (platform + username shown, token kept internally on each item).
  - Show empty state / error unchanged.

### 3. Carry `token` through the flow
- File: `src/components/get-chats/GetChatsButton.tsx`
  - Extend `SelectedModel` to `{ platform, username, token }`.
  - `SubmittedFilters.token` is now sourced from the selected model (not the hardcoded `PLACEHOLDER_TOKEN`).
- File: `src/components/get-chats/FiltersModal.tsx`
  - Remove `PLACEHOLDER_TOKEN`; use `model.token` when building the submit payload.

### 4. Cleanup
- Delete the now-unused placeholder edge function `supabase/functions/get-assigned-models/`.

## Out of scope
- The actual "load chats" backend call (viewer still uses `MOCK_CHATS`). Token is only threaded through, ready for wiring later.
- No auth/JWT header — endpoint is called anonymously as described. If it needs an api-key header later, add it then.
