import { useEffect, useState } from "react";
import { Wand2, Play, ChevronDown, Trash2 } from "lucide-react";

interface SuperPromptBarProps {
  value: string;
  disabled?: boolean;
  onSave: (value: string) => void;
  onRun: (value: string) => void;
}

export default function SuperPromptBar({ value, disabled, onSave, onRun }: SuperPromptBarProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!open) setDraft(value);
  }, [value, open]);

  const dirty = draft.trim() !== (value ?? "").trim();

  return (
    <div className="max-w-3xl mx-auto px-3 sm:px-8 pt-2.5">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setOpen((o) => !o)}
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-light transition-colors ${
            value.trim()
              ? "border-primary/25 bg-primary/10 text-primary"
              : "border-white/[0.07] bg-white/[0.02] text-white/45 hover:text-white/70"
          }`}
        >
          <Wand2 className="h-3 w-3" /> Überprompt
          <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>

        {value.trim() && !open && (
          <>
            <button
              onClick={() => onRun(value)}
              disabled={disabled}
              className="flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-[11px] font-light text-primary hover:bg-primary/15 transition-colors disabled:opacity-30"
            >
              <Play className="h-3 w-3" /> Prompt ausführen
            </button>
            <span className="min-w-0 flex-1 truncate text-[11px] font-light text-white/20">{value}</span>
          </>
        )}
      </div>

      {open && (
        <div className="mt-2 rounded-xl border border-white/[0.07] bg-white/[0.02] p-2.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            placeholder="z. B. Analysiere die Top-5-Chatter der letzten 7 Tage und gib mir konkrete Maßnahmen…"
            className="w-full resize-y bg-transparent px-1 text-[12px] font-light text-foreground/80 placeholder:text-white/15 focus:outline-none"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => { onSave(draft.trim()); setOpen(false); }}
              disabled={!dirty}
              className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-1.5 text-[11px] font-light text-primary hover:bg-primary/15 transition-colors disabled:opacity-25"
            >
              Speichern
            </button>
            <button
              onClick={() => { onSave(draft.trim()); onRun(draft.trim()); setOpen(false); }}
              disabled={disabled || !draft.trim()}
              className="flex items-center gap-1.5 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-1.5 text-[11px] font-light text-white/60 hover:text-white/85 transition-colors disabled:opacity-25"
            >
              <Play className="h-3 w-3" /> Speichern & ausführen
            </button>
            {value.trim() && (
              <button
                onClick={() => { setDraft(""); onSave(""); setOpen(false); }}
                aria-label="Überprompt löschen"
                className="ml-auto p-1.5 rounded-md text-white/25 hover:text-red-400 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
