
## Goal

Add a "Get-Chats" button to the Live Tracking page (`/live`) that walks the user through a 3-step flow to fetch and view a chatter's chat history. Everything is scaffolded with placeholders now; real API/backend gets wired later.

## Flow

```text
[Get-Chats button on /live]
        │ click
        ▼
[Modal 1: Model Picker]
  - Calls placeholder edge function `get-assigned-models`
  - Renders list of { platform, username }
        │ click a model
        ▼
[Modal 2: Filters]
  - Mandatory: date range (from / to) via shadcn Calendar (range mode)
  - Optional : user select from static placeholder list [{username, chatid}]
  - Submit builds payload:
      { telegram_id, platform, token, date_range:{start,end}, user?:{username,chatid} }
        │ submit
        ▼
[Modal 3: Chats Viewer — large]
  - Two-pane: chat list (left) │ messages (right)
  - Populated from client-side mock array for now
```

## Files to create

- `supabase/functions/get-assigned-models/index.ts` — placeholder edge function. Accepts `{ telegram_id? }`, returns a hardcoded array like `[{ platform: "maloum", username: "modelA" }, ...]`. CORS + basic zod validation.
- `src/components/get-chats/GetChatsButton.tsx` — trigger button, owns the modal state machine (`"models" | "filters" | "viewer" | null`) and the selected model/filters.
- `src/components/get-chats/ModelPickerModal.tsx` — invokes `get-assigned-models` via `supabase.functions.invoke`, renders list, click → advances.
- `src/components/get-chats/FiltersModal.tsx` — date range (shadcn Calendar range, `pointer-events-auto`) + optional user select (Combobox over static placeholder list). Submit disabled until range is set.
- `src/components/get-chats/ChatsViewerModal.tsx` — large Dialog (`max-w-5xl`), left pane chat list, right pane messages of the selected chat. Uses `MOCK_CHATS` constant defined in the same file.
- `src/lib/get-chats-mocks.ts` — placeholder users list and mock chats/messages shape, so it's obvious where to swap in real data later.

## Files to modify

- `src/pages/LiveTracking.tsx` — mount `<GetChatsButton />` in the page header row, next to existing controls.

## Payload placeholders

- `telegram_id`: read from the currently selected chatter context on Live Tracking if available, else empty string placeholder.
- `token`: hardcoded `"PLACEHOLDER_TOKEN"` for now with a `// TODO: wire real token` comment.

## Explicitly out of scope (per your answers)

- No real API integration for models, users, or chats/messages — all placeholders.
- No DB schema changes, no new tables, no auth changes.
- No changes to Today tab, sidebar, or other pages.

## Notes

- All modals use existing shadcn `Dialog`.
- Styling matches the current dark/premium look (`border-white/10`, `bg-background`, font-light labels) used across `AnomalyDetailModal` etc.
