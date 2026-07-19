## Problem

In `ChatsViewerModal.tsx`, `modelUsername` is derived from `filters.user.username` — but `filters.user` is the selected recipient (customer), not the model. So:
- When no customer is selected, `model_username` is saved as `""`.
- When a customer is selected, the recipient's username is (wrongly) stored as `model_username`.

That's why `FiltersModal`'s query `.eq("model_username", model.username)` returns nothing — no row was ever saved with the real model username.

The model picker already knows the correct model username (`SelectedModel.username`), it just isn't threaded into `SubmittedFilters`.

## Fix

### `src/components/get-chats/GetChatsButton.tsx`
- Add `model_username: string` to `SubmittedFilters`.
- Populate it in `FiltersModal.submit()` from the current `model.username`.

### `src/components/get-chats/FiltersModal.tsx`
- Include `model_username: model.username` in the `onSubmit` payload.

### `src/components/get-chats/ChatsViewerModal.tsx`
- Replace `const modelUsername = filters?.user?.username ?? ""` with `filters?.model_username ?? ""`.
- Header string keeps using `modelUsername` (now correct).

### `src/lib/get-chats-api.ts`
- Strip `model_username` from the outgoing body to `/fetch-chats` (external API shape unchanged), or leave it in if the endpoint tolerates extra fields. Preferred: strip, to keep the external contract clean.

## Backfill note

Existing `chats_preview` rows with empty `model_username` will remain orphaned and won't appear in the picker. No migration proposed unless you want one — say the word and I'll add a one-off UPDATE (would need a reliable mapping from `chat_id` to model, which we don't have server-side, so likely just leave stale rows and let new saves populate correctly).
