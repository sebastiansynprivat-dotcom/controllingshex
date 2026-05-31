import { useEffect, useState } from "react";
import { Loader2, Save, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

type Scenario = "growth" | "flat" | "decline";

const SCENARIO_LABELS: Record<Scenario, { title: string; sub: string }> = {
  growth: { title: "Steigerung", sub: "Letzter Monat besser als der davor (≥ +5 %)" },
  flat: { title: "Keine Steigerung", sub: "Etwa auf Vormonats-Niveau (−5 % bis +5 %)" },
  decline: { title: "Abfall", sub: "Deutlich unter Vormonat (≤ −5 %)" },
};

const PLACEHOLDERS: { key: string; desc: string }[] = [
  { key: "{name}", desc: "Chatter-Name" },
  { key: "{ziel}", desc: "Neues Monatsziel in EUR" },
  { key: "{woche1}", desc: "Woche-1-Ziel (30 %) in EUR" },
  { key: "{monat}", desc: "Name des Folgemonats" },
];

const DEFAULTS: Record<Scenario, string> = {
  growth:
    "Hey {name}, starker Monat 💪🏻 Läuft richtig gut – nächsten Monat legen wir nochmal eine Schippe drauf. Fans haben jetzt frisches Gehalt, leicht zu verkaufen.\n\n*Woche 1* Vollgas: Mass-DMs raus, solange du online bist. Danach wird's entspannter.\n\nNeues Ziel für {monat}: *{ziel}*, davon *{woche1}* in *Woche 1*.",
  flat:
    "Hey {name}, Monat war okay – kein Riesensprung, halb so wild. Nächsten Monat holen wir die Steigerung locker rein. Fans haben jetzt frisches Gehalt, leicht zu verkaufen.\n\n*Woche 1* Vollgas: Mass-DMs raus, solange du online bist. Danach wird's entspannter.\n\nNeues Ziel für {monat}: *{ziel}*, davon *{woche1}* in *Woche 1*.",
  decline:
    "Hey {name}, war nicht unser Monat – halb so wild. Nächsten Monat drehen wir das sauber. Fans haben jetzt frisches Gehalt, leicht zu verkaufen.\n\n*Woche 1* Vollgas: Mass-DMs raus, solange du online bist. Danach wird's entspannter.\n\nNeues Ziel für {monat}: *{ziel}*, davon *{woche1}* in *Woche 1*.",
};

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function GoalMessageTemplatesDialog({ open, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState<Record<Scenario, string>>({ ...DEFAULTS });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("goal_message_templates")
        .select("scenario, template");
      if (cancelled) return;
      if (error) {
        toast.error("Vorlagen konnten nicht geladen werden");
      } else {
        const next: Record<Scenario, string> = { ...DEFAULTS };
        for (const row of (data ?? []) as Array<{ scenario: Scenario; template: string }>) {
          if (row.template) next[row.scenario] = row.template;
        }
        setValues(next);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function handleSave() {
    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id;
      if (!uid) throw new Error("Nicht angemeldet");
      const rows = (Object.keys(values) as Scenario[]).map((s) => ({
        user_id: uid,
        scenario: s,
        template: values[s],
      }));
      const { error } = await supabase
        .from("goal_message_templates")
        .upsert(rows, { onConflict: "user_id,scenario" });
      if (error) throw error;
      toast.success("Vorlagen gespeichert");
      onClose();
    } catch (e: any) {
      toast.error(e?.message || "Fehler beim Speichern");
    } finally {
      setSaving(false);
    }
  }

  function insertPlaceholder(scenario: Scenario, ph: string) {
    setValues((prev) => ({ ...prev, [scenario]: (prev[scenario] || "") + ph }));
  }

  function reset(scenario: Scenario) {
    setValues((prev) => ({ ...prev, [scenario]: DEFAULTS[scenario] }));
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-base">Nachrichten-Vorlagen</DialogTitle>
          <DialogDescription className="text-xs">
            3 Vorlagen je nach Monats-Lage. Platzhalter werden automatisch durch echte Werte ersetzt.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 flex-wrap pb-2 border-b border-white/[0.06]">
          <span className="text-[10px] uppercase tracking-[0.18em] text-white/40 font-light">
            Platzhalter
          </span>
          {PLACEHOLDERS.map((p) => (
            <span
              key={p.key}
              className="text-[11px] px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/10 text-white/70 font-mono"
              title={p.desc}
            >
              {p.key}
              <span className="ml-1.5 text-white/40 font-sans">{p.desc}</span>
            </span>
          ))}
        </div>

        <div className="overflow-y-auto flex-1 space-y-4 pr-1 -mr-1">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-white/45 text-xs">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Lade Vorlagen…
            </div>
          ) : (
            (Object.keys(SCENARIO_LABELS) as Scenario[]).map((s) => (
              <div
                key={s}
                className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3"
              >
                <div className="flex items-start justify-between gap-2 mb-2 flex-wrap">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white/90">
                      {SCENARIO_LABELS[s].title}
                    </div>
                    <div className="text-[11px] text-white/45 font-light">
                      {SCENARIO_LABELS[s].sub}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-wrap">
                    {PLACEHOLDERS.map((p) => (
                      <button
                        key={p.key}
                        onClick={() => insertPlaceholder(s, p.key)}
                        className="text-[10px] px-1.5 py-0.5 rounded-md bg-white/[0.04] border border-white/10 text-white/65 hover:bg-white/[0.08] hover:text-white font-mono transition-colors"
                      >
                        {p.key}
                      </button>
                    ))}
                    <button
                      onClick={() => reset(s)}
                      className="text-[10px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-white/10 text-white/55 hover:text-white/85 transition-colors"
                      title="Auf Standard zurücksetzen"
                    >
                      <RotateCcw className="h-3 w-3" /> Standard
                    </button>
                  </div>
                </div>
                <Textarea
                  value={values[s]}
                  onChange={(e) =>
                    setValues((prev) => ({ ...prev, [s]: e.target.value }))
                  }
                  rows={6}
                  className="bg-white/[0.03] border-white/10 text-sm leading-relaxed resize-none font-light"
                />
              </div>
            ))
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-white/[0.06]">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Abbrechen
          </Button>
          <Button size="sm" onClick={handleSave} disabled={loading || saving}>
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            <span className="ml-1.5">Speichern</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
