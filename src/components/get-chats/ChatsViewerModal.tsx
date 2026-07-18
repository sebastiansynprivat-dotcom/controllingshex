import { useMemo, useState, useEffect } from "react";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { MOCK_CHATS, type MockChat } from "@/lib/get-chats-mocks";
import type { SubmittedFilters } from "./GetChatsButton";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: SubmittedFilters | null;
}

export default function ChatsViewerModal({ open, onOpenChange, filters }: Props) {
  // TODO: replace MOCK_CHATS with real POST response using `filters`
  const chats = useMemo<MockChat[]>(() => {
    if (!filters?.user) return MOCK_CHATS;
    return MOCK_CHATS.filter((c) => c.chatid === filters.user!.chatid);
  }, [filters]);

  const [activeChatId, setActiveChatId] = useState<string | null>(chats[0]?.chatid ?? null);

  useEffect(() => {
    setActiveChatId(chats[0]?.chatid ?? null);
  }, [chats]);

  const active = chats.find((c) => c.chatid === activeChatId) ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl bg-background border-white/10 p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-white/[0.06]">
          <DialogTitle className="text-lg font-semibold tracking-tight">Chats</DialogTitle>
          <DialogDescription className="text-white/55 font-light text-xs">
            {filters
              ? `${filters.platform} · ${filters.date_range.start} – ${filters.date_range.end}${filters.user ? ` · ${filters.user.username}` : ""}`
              : "—"}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-[280px_1fr] h-[560px]">
          {/* Left: chat list */}
          <div className="border-r border-white/[0.06] overflow-y-auto">
            {chats.length === 0 && (
              <div className="p-4 text-xs text-white/45 font-light">Keine Chats im Zeitraum.</div>
            )}
            {chats.map((c) => (
              <button
                key={c.chatid}
                onClick={() => setActiveChatId(c.chatid)}
                className={cn(
                  "w-full text-left px-4 py-3 border-b border-white/[0.04] transition-colors",
                  activeChatId === c.chatid
                    ? "bg-white/[0.05]"
                    : "hover:bg-white/[0.025]",
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm text-white/85 font-medium truncate">{c.username}</span>
                  <span className="text-[10px] text-white/35 font-light shrink-0">
                    {format(new Date(c.lastMessageAt), "d.M. HH:mm")}
                  </span>
                </div>
                <div className="text-xs text-white/45 font-light truncate mt-0.5">{c.preview}</div>
              </button>
            ))}
          </div>

          {/* Right: messages */}
          <div className="overflow-y-auto p-5 space-y-2">
            {!active && (
              <div className="text-xs text-white/45 font-light">Wähle einen Chat.</div>
            )}
            {active?.messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  "flex",
                  m.from === "chatter" ? "justify-end" : "justify-start",
                )}
              >
                <div
                  className={cn(
                    "max-w-[70%] rounded-2xl px-3.5 py-2 text-sm font-light leading-relaxed",
                    m.from === "chatter"
                      ? "bg-primary text-primary-foreground rounded-br-sm"
                      : "bg-white/[0.06] text-white/85 rounded-bl-sm",
                  )}
                >
                  <div>{m.text}</div>
                  <div
                    className={cn(
                      "text-[9px] mt-1 tracking-wide",
                      m.from === "chatter" ? "text-primary-foreground/60" : "text-white/35",
                    )}
                  >
                    {format(new Date(m.at), "d.M. HH:mm")}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
