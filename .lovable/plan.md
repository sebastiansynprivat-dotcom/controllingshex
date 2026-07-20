## Update chat message rendering for new payload shape

Update `src/components/get-chats/ChatsViewerModal.tsx` and the types in `src/lib/get-chats-api.ts` so incoming messages render correctly with the new `content` shape.

### Type changes (`src/lib/get-chats-api.ts`)
- Widen `FetchedMessage`:
  - `type: "text" | "media" | "chat_product" | "tip" | "unknown" | string`
  - `timestamp?: string`
  - `content`: `{ text?: string; price?: string; media?: Array<{ type: "picture" | "video" | string; url: string; text?: string }>; [k: string]: unknown }`
- Update `last_message` fallback in `fetchChats` to also handle new types (e.g. show `[media]`, `[tip €50]`, `[product €200]` instead of just `[type]`).

### Rendering changes (`ChatsViewerModal.tsx`)
Replace the message bubble body with a small renderer that switches on `m.type`:

- **text** — render `content.text`.
- **media** — render grid of `content.media[]`:
  - `picture` → `<img>` (lazy, rounded, max-h-64, object-cover). Multiple images → 2-column grid.
  - `video` → video placeholder chip (or `<video>` if url present).
  - If `content.text` present, render below media.
- **chat_product** — same media grid as above, plus:
  - Price badge (e.g. pill with `content.price`) at top of bubble.
  - `content.text` below media.
- **tip** — render a highlighted "Tip" row:
  - Price badge (`content.price`) + heart/tip icon.
  - `content.text` below.
- **unknown** / fallback — small muted chip `[unbekannter Nachrichtentyp]`; if `content` is a string/object, don't crash.

All existing bubble alignment (`isModel` right vs. user left), colors, and rounding remain unchanged. Only the inner content rendering is swapped.

### Notes
- No backend/API changes; purely presentation.
- Guards for missing `content`, missing `media` array, and unknown media `type` so bad payloads never crash the modal.
- Keep it in one file — no new components — since it's a small switch block.
