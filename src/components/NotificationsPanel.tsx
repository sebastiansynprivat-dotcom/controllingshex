// Notifications panel — listet Hot-Streak-Alerts ("läuft heiß") + erlaubt Abhaken.
// Wird über einen Bell-Button im Header geöffnet (Sheet von rechts).
import { useEffect, useMemo, useState } from "react";
import { Bell, Check, Flame, Loader2, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";

interface AlertRow {
  id: string;
  chatter_name: string;
  platform: string;
  pace_pct: number;
  revenue_at_alert: number;
  baseline_avg: number;
  expected_pace: number;
  sent_at: string;
  alert_date: string;
}

const SEEN_KEY = "notif:lastSeenAt";

export function NotificationsPanel() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lastSeenAt, setLastSeenAt] = useState<number>(() => {
    const v = typeof window !== "undefined" ? localStorage.getItem(SEEN_KEY) : null;
    return v ? Number(v) : 0;
  });

  async function load() {
    if (!user?.id) return;
    setLoading(true);
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
    const { data, error } = await supabase
      .from("hot_streak_alerts")
      .select(
        "id, chatter_name, platform, pace_pct, revenue_at_alert, baseline_avg, expected_pace, sent_at, alert_date",
      )
      .eq("user_id", user.id)
      .gte("sent_at", sevenDaysAgo)
      .order("sent_at", { ascending: false })
      .limit(50);
    if (!error) setRows((data ?? []) as AlertRow[]);
    setLoading(false);
  }

  useEffect(() => {
    if (!user?.id) return;
    load();
    const channel = supabase
      .channel(`notif-hot-streak-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "hot_streak_alerts",
          filter: `user_id=eq.${user.id}`,
        },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Beim Öffnen: lastSeen aktualisieren (markiert alles als gesehen)
  useEffect(() => {
    if (open) {
      const now = Date.now();
      localStorage.setItem(SEEN_KEY, String(now));
      setLastSeenAt(now);
    }
  }, [open]);

  const unreadCount = useMemo(
    () => rows.filter((r) => new Date(r.sent_at).getTime() > lastSeenAt).length,
    [rows, lastSeenAt],
  );

  async function ack(id: string) {
    setBusyId(id);
    const { error } = await supabase.from("hot_streak_alerts").delete().eq("id", id);
    setBusyId(null);
    if (error) {
      toast.error("Konnte nicht abhaken");
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  async function ackAll() {
    if (rows.length === 0) return;
    setBusyId("__all__");
    const ids = rows.map((r) => r.id);
    const { error } = await supabase.from("hot_streak_alerts").delete().in("id", ids);
    setBusyId(null);
    if (error) {
      toast.error("Konnte nicht alle abhaken");
      return;
    }
    setRows([]);
    toast.success("Alle abgehakt");
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          aria-label="Benachrichtigungen"
          className="relative h-10 w-10 inline-flex items-center justify-center rounded-full text-white/60 hover:text-white/90 hover:bg-white/[0.04] transition-colors"
        >
          <Bell className="h-[18px] w-[18px]" />
          {unreadCount > 0 && (
            <span className="absolute top-1.5 right-1.5 min-w-[16px] h-[16px] px-1 rounded-full bg-orange-500 text-[10px] font-semibold text-white flex items-center justify-center leading-none">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md bg-background border-l border-white/[0.06] p-0 flex flex-col"
      >
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-white/[0.06]">
          <SheetTitle className="text-base font-semibold text-white/90 flex items-center gap-2">
            <Flame className="h-4 w-4 text-orange-400" />
            Benachrichtigungen
          </SheetTitle>
          <SheetDescription className="text-xs text-white/45 font-light">
            Chatter, die heiß laufen — abhaken, wenn du reagiert hast.
          </SheetDescription>
        </SheetHeader>

        <div className="flex items-center justify-between px-5 py-2 border-b border-white/[0.04]">
          <div className="text-[11px] text-white/40 font-light">
            {loading ? "Lädt…" : `${rows.length} aktiv`}
          </div>
          <Button
            size="sm"
            variant="ghost"
            disabled={rows.length === 0 || busyId === "__all__"}
            onClick={ackAll}
            className="h-7 text-[11px] text-white/60 hover:text-white"
          >
            {busyId === "__all__" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Check className="h-3 w-3" />
            )}
            <span className="ml-1.5">Alle abhaken</span>
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
          {!loading && rows.length === 0 && (
            <div className="text-center py-12 text-white/30 text-sm font-light">
              Aktuell keine heißen Chatter 🔥
            </div>
          )}
          {rows.map((r) => {
            const pacePct = Math.round((Number(r.pace_pct) || 0) * 100);
            const rev = Math.round(Number(r.revenue_at_alert) || 0);
            const base = Math.round(Number(r.baseline_avg) || 0);
            const when = formatDistanceToNow(new Date(r.sent_at), {
              addSuffix: true,
              locale: de,
            });
            return (
              <div
                key={r.id}
                className="rounded-xl border border-white/[0.06] bg-gradient-to-br from-orange-500/[0.05] via-white/[0.02] to-transparent p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Flame className="h-3.5 w-3.5 text-orange-400 shrink-0" />
                      <span className="text-sm font-semibold text-white/90 truncate">
                        {r.chatter_name}
                      </span>
                      <span className="text-[10px] uppercase tracking-[0.18em] text-orange-300/80 font-light">
                        läuft heiß
                      </span>
                    </div>
                    <div className="text-[11px] text-white/55 font-light">
                      {pacePct}% vs. Pace · {rev} € heute (Ø {base} €)
                    </div>
                    <div className="text-[10px] text-white/30 font-light mt-1">
                      {r.platform} · {when}
                    </div>
                  </div>
                  <button
                    onClick={() => ack(r.id)}
                    disabled={busyId === r.id}
                    aria-label="Abhaken"
                    className="shrink-0 h-8 w-8 inline-flex items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-white/70 hover:bg-emerald-400/15 hover:border-emerald-300/30 hover:text-emerald-200 transition-colors"
                  >
                    {busyId === r.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
