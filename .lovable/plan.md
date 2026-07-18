## Goal
After the user picks a date range in `FiltersModal`, POST to `https://api.controlling.shexadmin.ngrok.pro/fetch-chats` and render the real chats (with message bubbles per type) in `ChatsViewerModal`, replacing `MOCK_CHATS`.

## Assumptions
- Endpoint requires no auth header (none mentioned) → call directly from the browser, no new edge function.
- Default range: today and yesterday (`start = today - 1d`, `end = today`), pre-filled in `FiltersModal` but still editable.
- Response is an array of conversations; each has `messages[]` with `type ∈ {text, image, video, ...}` and `sender ∈ {model, user}` (assumption — anything not `model` is rendered as the customer side).

## Changes

### 1. Default date range
- `src/components/get-chats/FiltersModal.tsx`
  - Initialize `from = today - 1d`, `to = today` instead of `undefined`, so the user can submit immediately.

### 2. Fetch real chats
- `src/lib/get-chats-api.ts` (new)
  - `export async function fetchChats(payload: SubmittedFilters): Promise<FetchedChat[]>` — POSTs to `https://api.controlling.shexadmin.ngrok.pro/fetch-chats` with the exact body shape from `SubmittedFilters` (`{ telegram_id, platform, token, date_range, user? }`).
  - Export types `FetchedChat` and `FetchedMessage` matching the response shape (`id`, `recipient_username`, `recipient_id`, `messages_count`, `last_message`, `is_unread?`, `messages[]`).

### 3. Trigger the fetch on submit
- `src/components/get-chats/GetChatsButton.tsx`
  - Add `chats` + `loading` + `error` state. In `onSubmit`, call `fetchChats(payload)` and stash results; open viewer only after the promise resolves (or open immediately and let viewer show its own loading — see viewer changes).
  - Pass `chats`, `loading`, `error` down to `ChatsViewerModal`.

### 4. Render real data in the viewer
- `src/components/get-chats/ChatsViewerModal.tsx`
  - Drop `MOCK_CHATS`. Accept `chats: FetchedChat[]`, `loading`, `error` as props.
  - Left list: iterate `chats`, use `recipient_username`, show `messages_count`, show `last_message` as preview (fallback: last item in `messages[]` if present), highlight `is_unread`. Key = `id`.
  - Right pane: iterate `active.messages`. Right-align when `sender === "model"`, else left. Render by `type`:
    - `text` → `content.text`
    - `image` → `<img src={content.url} />` in a rounded container (lazy-loaded, `max-h-80 object-cover`)
    - `video` → placeholder tile `"🎥 Video · {duration_seconds}s"` (no URL provided in sample, so no `<video>` element).
    - unknown → small muted `"[type]"` label so nothing crashes.
  - No `at`/timestamp field in the sample → drop the time footer on bubbles; the sidebar can hide the timestamp too.
  - Loading state: spinner in the left column. Error state: inline red text. Empty state: keep existing "Keine Chats im Zeitraum."

### 5. Cleanup
- `src/lib/get-chats-mocks.ts`: keep `PLACEHOLDER_LINKED_USERS` and `LinkedUser` (still used by `FiltersModal`); remove `MOCK_CHATS` and `MockChat` types.

## Out of scope
- Auth header for the ngrok endpoint (add only if it starts 401'ing).
- Video playback (no URL in sample).
- Pagination / infinite scroll of chats.
