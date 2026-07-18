import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, ChevronLeft, Search, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { type LinkedUser } from "@/lib/get-chats-mocks";
import type { SelectedModel, SubmittedFilters } from "./GetChatsButton";


interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  model: SelectedModel | null;
  telegramId: string;
  onBack: () => void;
  onSubmit: (payload: SubmittedFilters) => void;
}

export default function FiltersModal({ open, onOpenChange, model, telegramId, onBack, onSubmit }: Props) {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const [from, setFrom] = useState<Date | undefined>(yesterday);
  const [to, setTo] = useState<Date | undefined>(today);
  const [user, setUser] = useState<LinkedUser | null>(null);
  const [fromOpen, setFromOpen] = useState(false);
  const [toOpen, setToOpen] = useState(false);
  const [users, setUsers] = useState<LinkedUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open || !model) return;
    let cancelled = false;
    setUsersLoading(true);
    setUsers([]);
    setUser(null);
    setQuery("");
    (async () => {
      const { data, error } = await supabase
        .from("chats_preview")
        .select("chat_id, recipient_username, updated_at")
        .eq("platform", model.platform)
        .eq("model_username", model.username)
        .not("recipient_username", "is", null)
        .order("updated_at", { ascending: false });
      if (cancelled) return;
      if (error) {
        setUsers([]);
      } else {
        const seen = new Set<string>();
        const deduped: LinkedUser[] = [];
        for (const row of data ?? []) {
          const uname = (row as any).recipient_username as string | null;
          const cid = (row as any).chat_id as string | null;
          if (!uname || !cid || seen.has(uname)) continue;
          seen.add(uname);
          deduped.push({ username: uname, chat_id: cid });
        }
        setUsers(deduped);
      }
      setUsersLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, model]);

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => u.username.toLowerCase().includes(q));
  }, [users, query]);

  const canSubmit = useMemo(() => !!(from && to && model && to >= from), [from, to, model]);

  const submit = () => {
    if (!from || !to || !model) return;
    onSubmit({
      telegram_id: telegramId,
      platform: model.platform,
      token: model.token,
      date_range: {
        start: format(from, "yyyy-MM-dd"),
        end: format(to, "yyyy-MM-dd"),
      },
      user: user ?? undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-background border-white/10">
        <DialogHeader>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-white/40 font-light">
            <button onClick={onBack} className="flex items-center gap-1 hover:text-white/70">
              <ChevronLeft className="h-3 w-3" /> zurück
            </button>
            {model && (
              <span className="ml-auto">
                {model.platform} · {model.username}
              </span>
            )}
          </div>
          <DialogTitle className="text-lg font-semibold tracking-tight">Filter</DialogTitle>
          <DialogDescription className="text-white/55 font-light">
            Zeitraum ist Pflicht, Kunde optional.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-white/40 font-light mb-1.5">
                Von *
              </div>
              <Popover open={fromOpen} onOpenChange={setFromOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-light border-white/10 bg-white/[0.02] hover:bg-white/[0.05]",
                      !from && "text-white/40",
                    )}
                  >
                    <CalendarIcon className="h-3.5 w-3.5 mr-2 opacity-70" />
                    {from ? format(from, "d.M.yyyy") : "Startdatum"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 bg-black/95 border-white/10 backdrop-blur-xl" align="start">
                  <Calendar
                    mode="single"
                    selected={from}
                    onSelect={(d) => {
                      setFrom(d);
                      if (d && to && to < d) setTo(undefined);
                      setFromOpen(false);
                    }}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-white/40 font-light mb-1.5">
                Bis *
              </div>
              <Popover open={toOpen} onOpenChange={setToOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-light border-white/10 bg-white/[0.02] hover:bg-white/[0.05]",
                      !to && "text-white/40",
                    )}
                  >
                    <CalendarIcon className="h-3.5 w-3.5 mr-2 opacity-70" />
                    {to ? format(to, "d.M.yyyy") : "Enddatum"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 bg-black/95 border-white/10 backdrop-blur-xl" align="start">
                  <Calendar
                    mode="single"
                    selected={to}
                    onSelect={(d) => {
                      setTo(d);
                      setToOpen(false);
                    }}
                    disabled={from ? { before: from } : undefined}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>


          <div>
            <div className="text-[10px] uppercase tracking-wider text-white/40 font-light mb-1.5">
              Kunde (optional)
            </div>
            <button
              type="button"
              onClick={() => setUser(null)}
              className={cn(
                "w-full text-left px-2.5 py-2 rounded-md border text-xs font-light transition-all mb-2",
                user === null
                  ? "bg-white/[0.06] border-white/20 text-white/90"
                  : "bg-white/[0.02] border-white/[0.06] text-white/55 hover:bg-white/[0.04]",
              )}
            >
              Alle Kunden
            </button>
            <div className="relative mb-2">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/30" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Kunde suchen…"
                className="h-8 pl-8 text-xs bg-white/[0.02] border-white/10 font-light"
              />
            </div>
            <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
              {usersLoading ? (
                <div className="flex items-center justify-center py-6 text-white/40">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : filteredUsers.length === 0 ? (
                <div className="px-2.5 py-4 text-center text-[11px] text-white/40 font-light">
                  {users.length === 0
                    ? "Keine gespeicherten Kunden"
                    : `Keine Treffer für „${query}"`}
                </div>
              ) : (
                filteredUsers.map((u) => (
                  <button
                    key={u.chat_id}
                    type="button"
                    onClick={() => setUser(u)}
                    className={cn(
                      "w-full flex items-center justify-between px-2.5 py-2 rounded-md border text-xs font-light transition-all",
                      user?.chat_id === u.chat_id
                        ? "bg-white/[0.06] border-white/20 text-white/90"
                        : "bg-white/[0.02] border-white/[0.06] text-white/55 hover:bg-white/[0.04]",
                    )}
                  >
                    <span className="truncate">{u.username}</span>
                    <span className="text-[10px] text-white/30 font-mono ml-2 shrink-0">{u.chat_id}</span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Abbrechen
            </Button>
            <Button size="sm" disabled={!canSubmit} onClick={submit}>
              Chats laden
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
