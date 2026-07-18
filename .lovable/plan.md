## Goal
Replace placeholder customer list in `FiltersModal` with real recipients from `chats_preview`, scoped by `platform` + `model_username`. Add a search input and scrollable list. Selected user changes request payload to `{ username, chat_id }`.

## Request payload shape

When a customer is selected, the POST body to `api.controlling.shexadmin.ngrok.pro/fetch-chats` is:

```json
{
  "telegram_id": "…",
  "platform": "…",
  "token": "…",
  "date_range": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
  "user": { "username": "<recipient_username>", "chat_id": "<chat_id>" }
}
```

When no customer is selected, `user` is omitted.

## Changes

### `src/lib/get-chats-mocks.ts`
- Update `LinkedUser` type to `{ username: string; chat_id: string }`.
- Remove `PLACEHOLDER_LINKED_USERS`.

### `src/components/get-chats/FiltersModal.tsx`
- Use `model` prop (`platform` + `username`) to query.
- On modal open, fetch from `chats_preview`:
  ```
  supabase.from("chats_preview")
    .select("chat_id, recipient_username, updated_at")
    .eq("platform", model.platform)
    .eq("model_username", model.username)
    .not("recipient_username", "is", null)
    .order("updated_at", { ascending: false })
  ```
- Dedupe by `recipient_username` (keep most recent `chat_id`).
- Add a search `Input` above the list, case-insensitive substring match on `recipient_username`. Local `query` state.
- List container: `max-h-64 overflow-y-auto` (already has similar styling); "Alle Kunden" row stays pinned above the scrollable list (outside the scroll area).
- States: loading (spinner), empty ("Keine gespeicherten Kunden"), no-match ("Keine Treffer für …").

### `src/components/get-chats/GetChatsButton.tsx`
- `SubmittedFilters.user` becomes `{ username: string; chat_id: string }` — flows straight into the fetch payload.

### `src/lib/get-chats-api.ts`
- No change.

## Notes
- `recipient_username` displayed verbatim.
- No migration needed — `chats_preview` already readable by authenticated users.
