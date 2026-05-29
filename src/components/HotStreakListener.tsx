// Listens on hot_streak_alerts via Supabase Realtime and shows an in-app toast.
// Runs as a sibling inside the Layout so it's active on every authenticated page.
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";

export function HotStreakListener() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const mountedAt = useRef<number>(Date.now());

  useEffect(() => {
    if (!user?.id) return;
    mountedAt.current = Date.now();

    const channel = supabase
      .channel(`hot-streak-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "hot_streak_alerts",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as {
            chatter_name: string;
            pace_pct: number;
            revenue_at_alert: number;
            baseline_avg: number;
            sent_at: string;
          };
          // Ignore replayed events from before mount
          const ts = new Date(row.sent_at).getTime();
          if (ts < mountedAt.current - 60_000) return;

          const pacePct = Math.round((Number(row.pace_pct) || 0) * 100);
          const rev = Math.round(Number(row.revenue_at_alert) || 0);
          const base = Math.round(Number(row.baseline_avg) || 0);

          toast.success(`🔥 ${row.chatter_name} läuft heiß`, {
            description: `${pacePct}% vs. Pace · ${rev} € heute (Ø ${base} €)`,
            duration: 8000,
            action: {
              label: "Ansehen",
              onClick: () => navigate("/live"),
            },
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, navigate]);

  return null;
}
