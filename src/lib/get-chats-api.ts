import type { SubmittedFilters } from "@/components/get-chats/GetChatsButton";

const ENDPOINT = "https://api.controlling.shexadmin.ngrok.pro/fetch-chats";

export interface FetchedMediaItem {
  type: string; // "picture" | "video" | ...
  url: string;
  text?: string;
  [k: string]: unknown;
}

export interface FetchedMessage {
  id: string;
  type: string; // "text" | "media" | "chat_product" | "tip" | "unknown" | ...
  sender: string; // "model" | "user" | ...
  timestamp?: string;
  content: {
    text?: string;
    url?: string;
    price?: string;
    media?: FetchedMediaItem[];
    duration_seconds?: number;
    [k: string]: unknown;
  };
}

export interface FetchedChat {
  id: string;
  recipient_username: string;
  recipient_id: string;
  messages_count: number;
  last_message: string | null;
  messages: FetchedMessage[];
  is_unread?: boolean;
}

function summarizeMessage(lm: any): string | null {
  if (lm == null) return null;
  if (typeof lm === "string") return lm;
  const t = lm?.type;
  const text = lm?.content?.text;
  const price = lm?.content?.price;
  if (t === "text") return text ?? null;
  if (t === "media") return text || "[Bilder/Video]";
  if (t === "chat_product") return `[Produkt${price ? ` ${price}` : ""}]${text ? ` ${text}` : ""}`;
  if (t === "tip") return `[Tip${price ? ` ${price}` : ""}]${text ? ` ${text}` : ""}`;
  if (text) return text;
  return t ? `[${t}]` : null;
}

export async function fetchChats(payload: SubmittedFilters): Promise<FetchedChat[]> {
  const { model_username: _mu, ...body } = payload;
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`fetch-chats ${res.status}: ${text || res.statusText}`);
  }
  const data = await res.json();
  const raw: any[] = Array.isArray(data)
    ? data
    : Array.isArray(data?.chats)
    ? data.chats
    : [];
  return raw.map((c) => ({ ...c, last_message: summarizeMessage(c?.last_message) } as FetchedChat));
}
