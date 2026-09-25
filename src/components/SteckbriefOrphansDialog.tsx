import { useRef, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { formatSteckbriefDate, identityKey, removeOverride, type OrphanOverride } from "@/lib/steckbrief-links";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orphanOverrides: readonly OrphanOverride[];
  onChanged: () => void;
}

export default function SteckbriefOrphansDialog({ open, onOpenChange, orphanOverrides, onChanged }: Props) {
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const deletingRef = useRef(false);

  const remove = async (entry: OrphanOverride) => {
    if (deletingRef.current) return;
    deletingRef.current = true;
    setDeletingKey(identityKey(entry.platform, entry.email));
    const result = await removeOverride(entry.platform, entry.email);
    deletingRef.current = false;
    setDeletingKey(null);
    if (!result.ok) {
      toast.error("Speichern fehlgeschlagen");
      return;
    }
    toast.success("Ausnahme entfernt");
    if (orphanOverrides.length === 1) onOpenChange(false);
    onChanged();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg border-white/[0.08] bg-[#141414]">
        <DialogHeader>
          <DialogTitle className="text-base font-light text-foreground/85">Zuordnungen ohne Konto ({orphanOverrides.length})</DialogTitle>
          <DialogDescription className="text-[11px] font-light text-white/40">
            Diese Ausnahmen gehören zu keinem Konto im aktuellen Bestand.
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-[60vh] space-y-2 overflow-y-auto">
          {orphanOverrides.map((entry) => {
            const key = identityKey(entry.platform, entry.email);
            return (
              <li key={key} className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                <div className="min-w-0 flex-1 space-y-1 text-[11px] font-light">
                  <p className="break-all text-white/70">{entry.platform} · {entry.email}</p>
                  <p className="text-white/45">
                    {entry.mode === "assign" ? "Zuordnung" : "Kein Steckbrief"}
                    {entry.external_model_name && ` · ${entry.external_model_name}`}
                  </p>
                  <p className="text-[10px] text-white/30">{formatSteckbriefDate(entry.updated_at) || "–"}</p>
                </div>
                <button
                  type="button"
                  disabled={deletingKey !== null}
                  onClick={() => { void remove(entry); }}
                  aria-label={`Ausnahme für ${entry.platform} ${entry.email} entfernen`}
                  title="Ausnahme entfernen"
                  className="shrink-0 rounded p-1.5 text-white/30 transition-colors hover:bg-red-400/5 hover:text-red-400/70 disabled:opacity-40"
                >
                  {deletingKey === key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </button>
              </li>
            );
          })}
        </ul>
        {orphanOverrides.length === 0 && <p className="text-[11px] font-light text-white/35">Keine Zuordnungen ohne Konto</p>}
      </DialogContent>
    </Dialog>
  );
}
