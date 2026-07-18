import type { SubmittedFilters } from "@/components/get-chats/GetChatsButton";

const ENDPOINT = "https://api.controlling.shexadmin.ngrok.pro/fetch-chats";

export interface FetchedMessage {
  id: string;
  type: string; // "text" | "image" | "video" | ...
  sender: string; // "model" | ...
  content: {
    text?: string;
    url?: string;
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

export async function fetchChats(payload: SubmittedFilters): Promise<FetchedChat[]> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`fetch-chats ${res.status}: ${text || res.statusText}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? (data as FetchedChat[]) : [];
}
