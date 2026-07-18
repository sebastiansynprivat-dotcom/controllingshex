## Goals
1. Persist chats into a new `chats_preview` table via a save button per chat.
2. Show the model's username in the viewer modal's description line.

## Database
New table `public.chats_preview`:
- `id` uuid pk
- `chat_id` text
- `platform` text
- `model_username` text
- `recipient_username` text
- `chat` jsonb
- `created_at`, `updated_at` timestamptz
- Unique `(platform, model_username, chat_id)` → upsert.

Grants + RLS:
- `GRANT SELECT, INSERT, UPDATE, DELETE ON public.chats_preview TO authenticated;`
- `GRANT ALL TO service_role;`
- RLS enabled; permissive policy for `authenticated` (all ops).
- `updated_at` trigger via existing `public.update_updated_at_column()`.

## Frontend
`src/components/get-chats/ChatsViewerModal.tsx`:
- Update `DialogDescription` to include the model username, e.g.:
  `{platform} · {modelUsername} · {start} – {end}`.
  (Currently: `{platform} · {start} – {end}${user ? " · " + user.username : ""}`.)
- Add a floating "Save" button in the top-right corner of the messages pane.
  - Icon from lucide-react (`Bookmark`).
  - States: idle / saving (spinner) / saved (checkmark).
  - Toast via `sonner` on success/error.
  - On click: upsert active chat into `chats_preview` with `platform`, `modelUsername`, `chat_id`, `recipient_username`, full chat as `chat`.

## Technical notes
- Model username source: `filters.user?.username` (assigned model account whose token fetched the chats).
- Upsert: `supabase.from("chats_preview").upsert(row, { onConflict: "platform,model_username,chat_id" })`.
