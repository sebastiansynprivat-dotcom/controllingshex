import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Loader2, RefreshCw, Bookmark, BookmarkCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { SubmittedFilters } from "./GetChatsButton";
import { normalizeChats, type FetchedChat } from "@/lib/get-chats-api";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: SubmittedFilters | null;
  requestId: string | null;
  error: string | null;
  onRefresh?: () => void;
}

type Status = "idle" | "pending" | "completed" | "failed";

function SkeletonList() {
  return (
    <div className="divide-y divide-white/[0.04]">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="px-4 py-3 animate-pulse">
          <div className="flex items-baseline justify-between gap-2">
            <div className="h-3.5 w-32 rounded bg-white/[0.08]" />
            <div className="h-2.5 w-10 rounded bg-white/[0.06]" />
          </div>
          <div className="mt-2 h-3 w-48 rounded bg-white/[0.05]" />
        </div>
      ))}
    </div>
  );
}

function SkeletonMessages() {
  const rows = [
    { align: "start", w: "w-40" },
    { align: "end", w: "w-56" },
    { align: "start", w: "w-64" },
    { align: "end", w: "w-32" },
    { align: "start", w: "w-48" },
  ] as const;
  return (
    <div className="space-y-3 animate-pulse">
      {rows.map((r, i) => (
        <div key={i} className={cn("flex", r.align === "end" ? "justify-end" : "justify-start")}>
          <div
            className={cn(
              "h-10 rounded-2xl",
              r.w,
              r.align === "end" ? "bg-primary/25 rounded-br-sm" : "bg-white/[0.06] rounded-bl-sm",
            )}
          />
        </div>
      ))}
    </div>
  );
}

export default function ChatsViewerModal({ open, onOpenChange, filters, requestId, error, onRefresh }: Props) {
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<Status>("idle");
  const [chats, setChats] = useState<FetchedChat[]>([]);
  const [rowError, setRowError] = useState<string | null>(null);
  const [tookTooLong, setTookTooLong] = useState(false);

  // Reset + subscribe whenever requestId changes.
  useEffect(() => {
    if (!requestId || !open) return;

    setStatus("pending");
    setChats([]);
    setActiveChatId(null);
    setSavedIds(new Set());
    setRowError(null);
    setTookTooLong(false);

    let cancelled = false;

    const apply = (row: any) => {
      if (cancelled || !row) return;
      // Stream partial results as they arrive, regardless of terminal status.
      if (row.result_json != null) {
        const parsed = normalizeChats(row.result_json);
        setChats(parsed);
        setActiveChatId((cur) => cur ?? parsed[0]?.id ?? null);
      }
      if (row.status === "completed") {
        setStatus("completed");
      } else if (row.status === "failed") {
        setRowError(row.error_message || "Chat-Abruf fehlgeschlagen");
        setStatus("failed");
      }
    };

    // Initial check in case rows already exist / it already completed.
    supabase
      .from("chats_fetch_requests")
      .select("id, status, result_json, error_message")
      .eq("id", requestId)
      .maybeSingle()
      .then(({ data }) => apply(data));

    const channel = supabase
      .channel(`chats-req-${requestId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chats_fetch_requests", filter: `id=eq.${requestId}` },
        (payload) => apply(payload.new),
      )
      .subscribe();

    const timer = window.setTimeout(() => {
      if (!cancelled) setTookTooLong(true);
    }, 60_000);

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
      window.clearTimeout(timer);
    };
  }, [requestId, open]);

  const active = useMemo(() => chats.find((c) => c.id === activeChatId) ?? null, [chats, activeChatId]);
  const modelUsername = filters?.model_username ?? "";
  const pending = status === "pending";
  const loading = pending && chats.length === 0;
  const streaming = pending && chats.length > 0;
  const shownError = error || rowError;

  const handleSave = async () => {
    if (!active || !filters) return;
    setSavingId(active.id);
    try {
      const { error: err } = await supabase.from("chats_preview").upsert(
        {
          chat_id: active.id,
          platform: filters.platform,
          model_username: modelUsername,
          recipient_username: active.recipient_username ?? null,
          chat: active as any,
        },
        { onConflict: "platform,model_username,chat_id" },
      );
      if (err) throw err;
      setSavedIds((prev) => new Set(prev).add(active.id));
      toast.success("Chat saved");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save chat");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl bg-background border-white/10 p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            <DialogTitle className="text-lg font-semibold tracking-tight">Chats</DialogTitle>
            {onRefresh && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onRefresh}
                disabled={loading}
                title="Aktualisieren"
                className="h-8 w-8 text-white/60 hover:text-white hover:bg-white/[0.06]"
              >
                <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              </Button>
            )}
          </div>
          <DialogDescription className="text-white/55 font-light text-xs">
            {filters
              ? `${filters.platform}${modelUsername ? ` · ${modelUsername}` : ""} · ${filters.date_range.start} – ${filters.date_range.end}`
              : "—"}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-[280px_1fr] h-[560px]">
          {/* Left: chat list */}
          <div className="border-r border-white/[0.06] overflow-y-auto">
            {loading && <SkeletonList />}
            {!loading && shownError && (
              <div className="p-4 text-xs text-red-300/80 font-light">{shownError}</div>
            )}
            {!loading && !shownError && chats.length === 0 && (
              <div className="p-4 text-xs text-white/45 font-light">Keine Chats im Zeitraum.</div>
            )}
            {!loading && chats.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveChatId(c.id)}
                className={cn(
                  "w-full text-left px-4 py-3 border-b border-white/[0.04] transition-colors",
                  activeChatId === c.id
                    ? "bg-white/[0.05]"
                    : "hover:bg-white/[0.025]",
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className={cn("text-sm font-medium truncate", c.is_unread ? "text-primary" : "text-white/85")}>
                    {c.recipient_username}
                  </span>
                  <span className="text-[10px] text-white/35 font-light shrink-0">
                    {c.messages_count} msg
                  </span>
                </div>
                <div className="text-xs text-white/45 font-light truncate mt-0.5">
                  {c.last_message ?? "—"}
                </div>
              </button>
            ))}
          </div>

          {/* Right: messages */}
          <div className="relative overflow-y-auto p-5 space-y-2">
            {loading && (
              <div className="space-y-3">
                {tookTooLong && (
                  <div className="text-[11px] text-white/45 font-light">
                    Dauert länger als erwartet… wir warten weiter.
                  </div>
                )}
                <SkeletonMessages />
              </div>
            )}
            {!loading && active && (
              <Button
                variant="ghost"
                size="icon"
                onClick={handleSave}
                disabled={savingId === active.id}
                title={savedIds.has(active.id) ? "Saved" : "Save chat"}
                className="absolute top-3 right-3 z-10 h-8 w-8 text-white/60 hover:text-white bg-background/70 backdrop-blur border border-white/[0.08] hover:bg-white/[0.08]"
              >
                {savingId === active.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : savedIds.has(active.id) ? (
                  <BookmarkCheck className="h-4 w-4 text-primary" />
                ) : (
                  <Bookmark className="h-4 w-4" />
                )}
              </Button>
            )}
            {!loading && !active && (
              <div className="text-xs text-white/45 font-light">Wähle einen Chat.</div>
            )}
            {!loading && active?.messages.map((m) => {
              const isModel = m.sender === "model";
              const content: any = m.content ?? {};
              const media: any[] = Array.isArray(content.media) ? content.media : [];
              const price: string | undefined = content.price;
              const text: string | undefined = content.text;

              const renderMedia = () => {
                if (media.length === 0) return null;
                return (
                  <div className={cn("grid gap-1.5", media.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
                    {media.map((mi, idx) => {
                      const url = mi?.url;
                      const mt = mi?.type;
                      if (mt === "picture" && url) {
                        return (
                          <img
                            key={idx}
                            src={url}
                            alt=""
                            loading="lazy"
                            className="rounded-lg max-h-64 w-full object-cover"
                          />
                        );
                      }
                      if (mt === "video") {
                        return url ? (
                          <video key={idx} src={url} controls className="rounded-lg max-h-64 w-full" />
                        ) : (
                          <div key={idx} className="text-xs opacity-80 rounded-lg bg-black/20 px-2 py-1">
                            🎥 Video
                          </div>
                        );
                      }
                      return (
                        <div key={idx} className="text-xs opacity-60 rounded-lg bg-black/20 px-2 py-1">
                          [{mt || "media"}]
                        </div>
                      );
                    })}
                  </div>
                );
              };

              const priceBadge = price ? (
                <div className="inline-flex items-center rounded-full bg-black/25 px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase">
                  {m.type === "tip" ? "Tip" : "Produkt"} · {price}
                </div>
              ) : null;

              let body: React.ReactNode;
              if (m.type === "text") {
                body = text ? <div>{text}</div> : <div className="text-xs opacity-60">[leer]</div>;
              } else if (m.type === "media") {
                body = (
                  <div className="space-y-1.5">
                    {renderMedia()}
                    {text && <div>{text}</div>}
                  </div>
                );
              } else if (m.type === "chat_product") {
                body = (
                  <div className="space-y-1.5">
                    {priceBadge}
                    {renderMedia()}
                    {text && <div>{text}</div>}
                  </div>
                );
              } else if (m.type === "tip") {
                body = (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <span>❤️‍🔥</span>
                      {priceBadge}
                    </div>
                    {text && <div>{text}</div>}
                  </div>
                );
              } else if (m.type === "image" && content.url) {
                body = (
                  <img src={content.url} alt="" loading="lazy" className="rounded-lg max-h-80 object-cover" />
                );
              } else if (m.type === "video") {
                body = (
                  <div className="flex items-center gap-2 text-xs opacity-80">
                    🎥 Video{typeof content.duration_seconds === "number" ? ` · ${content.duration_seconds}s` : ""}
                  </div>
                );
              } else {
                body = (
                  <div className="space-y-1.5">
                    <div className="text-xs opacity-60">[{m.type || "unbekannt"}]</div>
                    {text && <div>{text}</div>}
                    {renderMedia()}
                  </div>
                );
              }

              return (
                <div
                  key={m.id}
                  className={cn("flex", isModel ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "max-w-[70%] rounded-2xl px-3.5 py-2 text-sm font-light leading-relaxed",
                      isModel
                        ? "bg-primary text-primary-foreground rounded-br-sm"
                        : "bg-white/[0.06] text-white/85 rounded-bl-sm",
                    )}
                  >
                    {body}
                  </div>
                </div>
              );
            })}

          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
