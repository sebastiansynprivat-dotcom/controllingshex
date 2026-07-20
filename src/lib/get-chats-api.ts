import { supabase } from "@/integrations/supabase/client";
import type { SubmittedFilters } from "@/components/get-chats/GetChatsButton";

export interface FetchedMediaItem {
  type: string;
  url: string;
  text?: string;
  [k: string]: unknown;
}

export interface FetchedMessage {
  id: string;
  type: string;
  sender: string;
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

export function summarizeMessage(lm: any): string | null {
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

export function normalizeChats(raw: any): FetchedChat[] {
  const arr: any[] = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.chats)
    ? raw.chats
    : [];
  return arr.map((c) => ({ ...c, last_message: summarizeMessage(c?.last_message) } as FetchedChat));
}

export async function requestChats(payload: SubmittedFilters): Promise<{ request_id: string }> {
  const { model_username: _mu, ...body } = payload;
  const { data, error } = await supabase.functions.invoke("request-chats", { body });
  if (error) throw new Error(error.message || "request-chats failed");
  if (!data?.request_id) throw new Error("No request_id in response");
  return { request_id: data.request_id as string };
}
