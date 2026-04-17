import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Clock, ChevronDown, AlertTriangle, TrendingDown, Inbox, MessageSquareOff, Sparkles } from "lucide-react";

type Severity = "critical" | "high" | "medium" | "info";
type Status = "new" | "seen" | "resolved" | "snoozed";

interface AnomalyAlert {
  id: string;
  chatter_name: string;
  alert_type: string;
  severity: Severity;
  metric_value: number | null;
  baseline_value: number | null;
  delta_pct: number | null;
  message: string;
  status: Status;
  detection_date: string;
  snoozed_until: string | null;
}

interface Props {
  platform: string;
  onChatterSelect?: (name: string) => void;
}

const TYPE_META: Record<string, { icon: typeof AlertTriangle; label: string }> = {
  verzug_spike: { icon: AlertTriangle, label: "Verzug" },
  mass_dm_drop: { icon: MessageSquareOff, label: "Mass-DMs" },
  chat_jam: { icon: Inbox, label: "Chat-Stau" },
  revenue_drop: { icon: TrendingDown, label: "Umsatz" },
  positive_outlier: { icon: Sparkles, label: "Top" },
};

const SEVERITY_STYLES: Record<Severity, { dot: string; ring: string; label: string }> = {
  critical: { dot: "bg-red-500", ring: "border-l-red-500/70 bg-red-500/[0.04]", label: "Kritisch" },
  high: { dot: "bg-orange-400", ring: "border-l-orange-400/70 bg-orange-400/[0.04]", label: "Hoch" },
  medium: { dot: "bg-yellow-400", ring: "border-l-yellow-400/70 bg-yellow-400/[0.03]", label: "Mittel" },
  info: { dot: "bg-emerald-400", ring: "border-l-emerald-400/70 bg-emerald-400/[0.04]", label: "Info" },
};

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "info"];

export default function AlertCockpit({ platform, onChatterSelect }: Props) {
  const [alerts, setAlerts] = useState<AnomalyAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [filterSeverity, setFilterSeverity] = useState<"all" | "actionable">("actionable");

  const fetchAlerts = useCallback(async () => {
    const nowIso = new Date().toISOString();
    const { data } = await supabase
      .from("anomaly_alerts")
      .select("id, chatter_name, alert_type, severity, metric_value, baseline_value, delta_pct, message, status, detection_date, snoozed_until")
      .eq("platform", platform)
      .in("status", ["new", "seen", "snoozed"])
      .or(`snoozed_until.is.null,snoozed_until.lte.${nowIso}`)
      .order("created_at", { ascending: false })
      .limit(100);
    setAlerts((data as AnomalyAlert[]) || []);
    setLoading(false);
  }, [platform]);

  const runDetection = useCallback(async () => {
    setRunning(true);
    try {
      await supabase.functions.invoke("detect-anomalies", { body: { platform } });
      await fetchAlerts();
    } catch (err) {
      console.error("[AlertCockpit] detection failed:", err);
    } finally {
      setRunning(false);
    }
  }, [platform, fetchAlerts]);

  useEffect(() => {
    setLoading(true);
    setAlerts([]);
    runDetection();
  }, [platform, runDetection]);

  const resolveAlert = async (id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
    await supabase
      .from("anomaly_alerts")
      .update({ status: "resolved", resolved_at: new Date().toISOString() })
      .eq("id", id);
  };

  const snoozeAlert = async (id: string, hours: number) => {
    const until = new Date(Date.now() + hours * 3600_000).toISOString();
    setAlerts((prev) => prev.filter((a) => a.id !== id));
    await supabase
      .from("anomaly_alerts")
      .update({ status: "snoozed", snoozed_until: until })
      .eq("id", id);
  };

  // Sort by severity then by abs(delta)
  const sorted = [...alerts].sort((a, b) => {
    const s = SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
    if (s !== 0) return s;
    return Math.abs(b.delta_pct ?? 0) - Math.abs(a.delta_pct ?? 0);
  });

  const visible = filterSeverity === "actionable"
    ? sorted.filter((a) => a.severity !== "info")
    : sorted;

  const counts = {
    critical: sorted.filter((a) => a.severity === "critical").length,
    high: sorted.filter((a) => a.severity === "high").length,
    medium: sorted.filter((a) => a.severity === "medium").length,
    info: sorted.filter((a) => a.severity === "info").length,
  };

  const displayed = expanded ? visible : visible.slice(0, 5);

  if (loading) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="flex items-center gap-2 text-xs text-white/30 font-light">
          <div className="h-3 w-3 border border-white/20 border-t-white/60 rounded-full animate-spin" />
          Anomalien werden analysiert…
        </div>
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-white/40 font-light">
            <div className="h-1.5 w-1.5 rounded-full bg-emerald-400/70" />
            Keine Auffälligkeiten erkannt.
          </div>
          <button
            onClick={runDetection}
            disabled={running}
            className="text-[10px] uppercase tracking-wider text-white/30 hover:text-white/60 transition-colors disabled:opacity-40"
          >
            {running ? "Prüft…" : "Neu prüfen"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.04]">
        <div className="flex items-center gap-3">
          <div className="text-xs text-foreground/70 font-light">
            <span className="text-foreground font-normal">{visible.length}</span> Auto-Alerts
          </div>
          <div className="flex items-center gap-2 text-[10px] text-white/40 font-light">
            {counts.critical > 0 && <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-red-500" />{counts.critical}</span>}
            {counts.high > 0 && <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-orange-400" />{counts.high}</span>}
            {counts.medium > 0 && <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-yellow-400" />{counts.medium}</span>}
            {counts.info > 0 && <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />{counts.info}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilterSeverity((v) => v === "actionable" ? "all" : "actionable")}
            className="text-[10px] uppercase tracking-wider text-white/30 hover:text-white/60 transition-colors"
          >
            {filterSeverity === "actionable" ? "Alle zeigen" : "Nur To-Do"}
          </button>
          <button
            onClick={runDetection}
            disabled={running}
            className="text-[10px] uppercase tracking-wider text-white/30 hover:text-white/60 transition-colors disabled:opacity-40"
          >
            {running ? "Prüft…" : "Neu prüfen"}
          </button>
        </div>
      </div>

      {/* List */}
      <AnimatePresence initial={false}>
        {displayed.map((alert) => {
          const Icon = TYPE_META[alert.alert_type]?.icon ?? AlertTriangle;
          const sev = SEVERITY_STYLES[alert.severity];
          return (
            <motion.div
              key={alert.id}
              layout
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className={`group border-l-2 ${sev.ring} border-b border-white/[0.04] last:border-b-0`}
            >
              <div className="flex items-center gap-3 px-4 py-3">
                <Icon className="h-3.5 w-3.5 text-white/40 shrink-0" />
                <button
                  onClick={() => onChatterSelect?.(alert.chatter_name)}
                  className="flex-1 min-w-0 text-left"
                >
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-sm text-foreground font-normal truncate">{alert.chatter_name}</span>
                    <span className="text-[10px] uppercase tracking-wider text-white/30 font-light">
                      {TYPE_META[alert.alert_type]?.label}
                    </span>
                  </div>
                  <div className="text-xs text-white/50 font-light truncate">{alert.message}</div>
                </button>
                <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity shrink-0">
                  <button
                    onClick={() => snoozeAlert(alert.id, 24)}
                    title="24h snoozen"
                    className="p-1.5 rounded-md hover:bg-white/[0.06] text-white/40 hover:text-white/80 transition-colors"
                  >
                    <Clock className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => resolveAlert(alert.id)}
                    title="Als erledigt markieren"
                    className="p-1.5 rounded-md hover:bg-white/[0.06] text-white/40 hover:text-emerald-300 transition-colors"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>

      {visible.length > 5 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center justify-center gap-1 py-2 text-[10px] uppercase tracking-wider text-white/30 hover:text-white/60 hover:bg-white/[0.02] transition-colors"
        >
          {expanded ? "Weniger" : `${visible.length - 5} weitere`}
          <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      )}
    </div>
  );
}
