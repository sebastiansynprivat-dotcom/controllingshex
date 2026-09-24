import { useRef, useState } from "react";
import { Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  conflictWithShex, describeSource, describeStatus, normalizeLogin,
  removeOverride, saveAssignment, saveBlock,
  type ShexModelEntry, type ShexProfileStatus, type SteckbriefDescription, type SteckbriefIdentity,
} from "@/lib/steckbrief-links";
import { cn } from "@/lib/utils";

const toneClasses: Record<SteckbriefDescription["tone"], string> = {
  ok: "bg-emerald-500/10 border-emerald-500/20 text-emerald-300/80",
  warn: "bg-amber-500/10 border-amber-500/20 text-amber-300/80",
  bad: "bg-red-500/10 border-red-500/20 text-red-300/80",
  muted: "bg-white/[0.04] border-white/[0.08] text-white/45",
};

const profileBadges: Record<ShexProfileStatus, { label: string; tone: SteckbriefDescription["tone"] }> = {
  approved: { label: "freigegeben", tone: "ok" },
  not_approved: { label: "wartet", tone: "warn" },
  unusable: { label: "fehlerhaft", tone: "warn" },
  none: { label: "kein Steckbrief", tone: "muted" },
};

interface Props {
  platform: string;
  email?: string | null;
  identity?: SteckbriefIdentity;
  models: readonly ShexModelEntry[];
  modelsById: ReadonlyMap<string, ShexModelEntry>;
  onChanged: () => void;
}

export default function SteckbriefPanel({ platform, email, identity, models, modelsById, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const chipClasses = "premium-chip inline-flex rounded-full border px-2 py-0.5 text-[10px] font-light";

  if (!normalizeLogin(email)) {
    return (
      <div className="mt-2">
        <span className={cn(chipClasses, toneClasses.muted)}>Keine Login-Mail</span>
      </div>
    );
  }

  const description = describeStatus(identity, modelsById);
  const source = describeSource(identity?.assignment_source ?? null);
  const conflictNames = conflictWithShex(identity)
    ? identity.shex_model_ids.map((id) => modelsById.get(id)?.name ?? "Unbekanntes Model").join(", ")
    : "";

  const write = async (action: () => Promise<{ ok: boolean }>, successMessage: string) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    const result = await action();
    savingRef.current = false;
    setSaving(false);
    if (!result.ok) {
      toast.error("Speichern fehlgeschlagen");
      return;
    }
    setOpen(false);
    toast.success(successMessage);
    onChanged();
  };

  return (
    <div className="mt-2 space-y-1 text-[10px] font-light">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={cn(chipClasses, toneClasses[description.tone])}>{description.label}</span>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={saving}
              aria-label="Steckbrief-Zuordnung ändern"
              title="Steckbrief-Zuordnung ändern"
              className="rounded-full border border-white/[0.06] bg-white/[0.03] p-1 text-white/35 transition-colors hover:text-white/70 disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Pencil className="h-3 w-3" />}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] border-white/[0.08] p-0">
            <Command>
              <CommandInput placeholder="SheX-Model suchen…" aria-label="SheX-Model suchen" className="h-9 text-xs font-light" />
              <CommandList>
                <CommandEmpty className="py-4 text-center text-[11px] text-white/35">Keine Models gefunden</CommandEmpty>
                <CommandGroup>
                  {models.map((model) => {
                    const badge = profileBadges[model.profile_status];
                    return (
                      <CommandItem
                        key={model.model_id}
                        value={model.model_id}
                        keywords={[model.name, model.username ?? ""]}
                        disabled={saving}
                        onSelect={() => { void write(() => saveAssignment(platform, email, model), "Steckbrief zugeordnet"); }}
                        className="gap-2 text-[11px] font-light"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{model.name}</span>
                          {model.username && <span className="block truncate text-[10px] text-white/35">{model.username}</span>}
                        </span>
                        <span className={cn("shrink-0 rounded-full border px-1.5 py-0.5 text-[9px]", toneClasses[badge.tone])}>
                          {badge.label}
                        </span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
            <div className="space-y-1 border-t border-white/[0.06] p-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => { void write(() => saveBlock(platform, email), "Als 'kein Steckbrief' markiert"); }}
                className="block w-full rounded px-2 py-1.5 text-left text-[11px] font-light text-white/55 hover:bg-white/[0.05] hover:text-white/85 disabled:opacity-40"
              >
                Keinen Steckbrief verwenden
              </button>
              {identity?.override && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => { void write(() => removeOverride(platform, email), "Ausnahme entfernt"); }}
                  className="block w-full rounded px-2 py-1.5 text-left text-[11px] font-light text-white/55 hover:bg-white/[0.05] hover:text-white/85 disabled:opacity-40"
                >
                  SheX-Zuordnung verwenden
                </button>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
      {description.detail && <p className="text-white/50">{description.detail}</p>}
      {source && <p className="text-white/35">{source}</p>}
      {conflictNames && <p className="text-amber-300/70">SheX ordnet dieses Konto {conflictNames} zu</p>}
    </div>
  );
}
