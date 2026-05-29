import { useEffect, useState } from "react";
import { Bell, BellOff, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  pushAvailableHere,
  subscribeToPush,
  unsubscribeFromPush,
  isCurrentlySubscribed,
  getPushPermission,
} from "@/lib/push-notifications";

export function HotStreakSettings() {
  const [subscribed, setSubscribed] = useState(false);
  const [perm, setPerm] = useState<NotificationPermission>("default");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const avail = pushAvailableHere();

  useEffect(() => {
    (async () => {
      setLoading(true);
      setPerm(await getPushPermission());
      setSubscribed(await isCurrentlySubscribed());
      setLoading(false);
    })();
  }, []);

  const handleEnable = async () => {
    setBusy(true);
    const res = await subscribeToPush();
    if (res.ok) {
      toast.success("🔥 Hot-Streak Push aktiviert");
      setSubscribed(true);
      setPerm("granted");
    } else {
      toast.error(res.error ?? "Konnte nicht aktivieren");
    }
    setBusy(false);
  };

  const handleDisable = async () => {
    setBusy(true);
    try {
      await unsubscribeFromPush();
      toast.success("Push deaktiviert");
      setSubscribed(false);
    } catch (e) {
      toast.error("Konnte nicht deaktivieren");
    }
    setBusy(false);
  };
  const handleTest = async () => {
    setTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("test-push");
      if (error) throw error;
      if (data?.ok) {
        toast.success(`Test-Push an ${data.sent}/${data.total} Gerät(e) gesendet 🏻`);
      } else {
        toast.error(data?.error ?? "Konnte Test-Push nicht senden");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Test-Push fehlgeschlagen");
    }
    setTesting(false);
  };


  return (
    <div className="bg-white/[0.02] border border-primary/10 rounded-2xl p-5 sm:p-8 space-y-5 backdrop-blur-2xl">
      <div>
        <h2 className="text-sm lg:text-base font-medium text-foreground/70 tracking-wide flex items-center gap-2">
          <Bell className="h-4 w-4 text-primary/60" />
          Hot-Streak Push-Alerts
        </h2>
        <p className="text-xs lg:text-sm text-white/25 mt-0.5 font-light leading-relaxed">
          Browser-Benachrichtigung wenn ein Chatter ≥150% über seinem normalen Pace läuft. Funktioniert auch wenn die App geschlossen ist.
        </p>
      </div>

      {!avail.ok ? (
        <div className="text-[11px] text-amber-400/70 bg-amber-500/[0.04] border border-amber-500/10 rounded-lg p-3 font-light leading-relaxed">
          {avail.reason}
          <br />
          <span className="text-white/30">→ Öffne <span className="text-white/50">controllingshex.lovable.app</span> direkt im Browser (nicht im Editor).</span>
        </div>
      ) : loading ? (
        <div className="flex items-center gap-2 text-white/30 text-xs">
          <Loader2 className="h-3 w-3 animate-spin" /> Status laden…
        </div>
      ) : subscribed ? (
        <div className="space-y-3">
          <div className="text-[11px] text-emerald-400/70 bg-emerald-500/[0.04] border border-emerald-500/10 rounded-lg p-3 font-light">
            ✓ Aktiv auf diesem Gerät
          </div>
          <Button
            onClick={handleDisable}
            disabled={busy}
            variant="outline"
            className="bg-white/[0.02] hover:bg-white/[0.04] border-white/10 text-white/60 font-light text-[12px] tracking-wider"
          >
            <BellOff className="h-3.5 w-3.5 mr-2" />
            {busy ? "Deaktiviere…" : "Push deaktivieren"}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {perm === "denied" && (
            <div className="text-[11px] text-rose-400/70 bg-rose-500/[0.04] border border-rose-500/10 rounded-lg p-3 font-light leading-relaxed">
              Berechtigung blockiert. Geh in die Browser-Einstellungen → Benachrichtigungen → erlaube diese Seite.
            </div>
          )}
          <p className="text-[11px] text-white/30 font-light leading-relaxed">
            📱 <span className="text-white/50">Auf iPhone:</span> erst die App via Safari-Teilen-Menü zum Home-Screen hinzufügen, dann von dort öffnen und hier aktivieren.
          </p>
          <Button
            onClick={handleEnable}
            disabled={busy || perm === "denied"}
            className="bg-primary/10 hover:bg-primary/15 text-primary border border-primary/20 hover:border-primary/30 font-light text-[12px] tracking-wider transition-all duration-500"
          >
            <Bell className="h-3.5 w-3.5 mr-2" />
            {busy ? "Aktiviere…" : "Browser-Push aktivieren"}
          </Button>
        </div>
      )}
    </div>
  );
}
