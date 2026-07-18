import { useMemo, useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, ChevronLeft } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { PLACEHOLDER_LINKED_USERS, type LinkedUser } from "@/lib/get-chats-mocks";
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
  const [from, setFrom] = useState<Date | undefined>();
  const [to, setTo] = useState<Date | undefined>();
  const [user, setUser] = useState<LinkedUser | null>(null);
  const [fromOpen, setFromOpen] = useState(false);
  const [toOpen, setToOpen] = useState(false);

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
            <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
              <button
                type="button"
                onClick={() => setUser(null)}
                className={cn(
                  "w-full text-left px-2.5 py-2 rounded-md border text-xs font-light transition-all",
                  user === null
                    ? "bg-white/[0.06] border-white/20 text-white/90"
                    : "bg-white/[0.02] border-white/[0.06] text-white/55 hover:bg-white/[0.04]",
                )}
              >
                Alle Kunden
              </button>
              {PLACEHOLDER_LINKED_USERS.map((u) => (
                <button
                  key={u.chatid}
                  type="button"
                  onClick={() => setUser(u)}
                  className={cn(
                    "w-full flex items-center justify-between px-2.5 py-2 rounded-md border text-xs font-light transition-all",
                    user?.chatid === u.chatid
                      ? "bg-white/[0.06] border-white/20 text-white/90"
                      : "bg-white/[0.02] border-white/[0.06] text-white/55 hover:bg-white/[0.04]",
                  )}
                >
                  <span>{u.username}</span>
                  <span className="text-[10px] text-white/30 font-mono">{u.chatid}</span>
                </button>
              ))}
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
