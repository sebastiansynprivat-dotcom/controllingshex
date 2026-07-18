import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Loader2, ChevronRight } from "lucide-react";
import type { SelectedModel } from "./GetChatsButton";

const CONTROLLING_CHATS_URL = "https://acznyhzgbkdcmnbqvptt.supabase.co/functions/v1/controlling-chats";
const CONTROLLING_CHAT_KEY = import.meta.env.VITE_CONTROLLING_CHAT_KEY as string | undefined;


interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  telegramId: string;
  onSelect: (model: SelectedModel) => void;
}

export default function ModelPickerModal({ open, onOpenChange, telegramId, onSelect }: Props) {
  const [loading, setLoading] = useState(false);
  const [models, setModels] = useState<SelectedModel[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (!telegramId) {
      setError("Keine telegram_id für diesen Chatter gefunden.");
      setModels([]);
      return;
    }
    setLoading(true);
    setError(null);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (CONTROLLING_CHAT_KEY) headers["x-api-key"] = CONTROLLING_CHAT_KEY;
    fetch(CONTROLLING_CHATS_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ telegram_id: telegramId }),
    })
      .then(async (r) => {
        const text = await r.text();
        if (!r.ok) throw new Error(text || `HTTP ${r.status}`);
        return text ? JSON.parse(text) : {};
      })
      .then((data) => {
        const tokens = (data as { tokens?: Array<{ platform: string; username: string; token: string }> })?.tokens ?? [];
        setModels(tokens);
      })
      .catch((e) => setError(e?.message ?? "Konnte Models nicht laden"))
      .finally(() => setLoading(false));
  }, [open, telegramId]);


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-background border-white/10">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold tracking-tight">Model wählen</DialogTitle>
          <DialogDescription className="text-white/55 font-light">
            Wähle den Account, für den du Chats laden willst.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-1.5 min-h-[120px]">
          {loading && (
            <div className="flex items-center justify-center py-10 text-white/50 text-sm font-light">
              <Loader2 className="h-4 w-4 mr-2 animate-spin" /> lade Models…
            </div>
          )}
          {error && <div className="text-sm text-red-300/80 font-light py-4">{error}</div>}
          {!loading && !error && models.length === 0 && (
            <div className="text-sm text-white/45 font-light py-4">Keine Models gefunden.</div>
          )}
          {!loading &&
            models.map((m) => (
              <button
                key={`${m.platform}:${m.username}`}
                onClick={() => onSelect(m)}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/[0.12] transition-all group"
              >
                <div className="flex flex-col items-start">
                  <div className="text-sm text-white/85 font-medium">{m.username}</div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-white/40 font-light mt-0.5">
                    {m.platform}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-white/30 group-hover:text-white/60 transition-colors" />
              </button>
            ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
