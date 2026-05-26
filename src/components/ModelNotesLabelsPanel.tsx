import { useEffect, useState, useCallback } from "react";
import { Tag, StickyNote, Plus, X, Send, Trash2, KeyRound, Copy, Pencil, Check, Eye, EyeOff, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ModelLabel {
  id: string;
  label_name: string;
  color: string;
}

interface LabelAssignment {
  id: string;
  label_id: string;
}

interface ModelNote {
  id: string;
  note_text: string;
  created_at: string;
}

interface Props {
  platform: string;
  modelName: string;
}

export default function ModelNotesLabelsPanel({ platform, modelName }: Props) {
  const [labels, setLabels] = useState<ModelLabel[]>([]);
  const [assignments, setAssignments] = useState<LabelAssignment[]>([]);
  const [notes, setNotes] = useState<ModelNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAddLabel, setShowAddLabel] = useState(false);

  const labelsById = new Map(labels.map((l) => [l.id, l]));
  const assignedLabelIds = new Set(assignments.map((a) => a.label_id));
  const availableLabels = labels.filter((l) => !assignedLabelIds.has(l.id));

  const reload = useCallback(async () => {
    setLoading(true);
    const [labelsRes, assignRes, notesRes] = await Promise.all([
      supabase.from("model_labels").select("id, label_name, color").eq("platform", platform).order("label_name"),
      supabase.from("model_label_assignments").select("id, label_id").eq("platform", platform).eq("model_name", modelName),
      supabase.from("model_notes").select("id, note_text, created_at").eq("platform", platform).eq("model_name", modelName).order("created_at", { ascending: false }),
    ]);
    if (!labelsRes.error && labelsRes.data) setLabels(labelsRes.data as ModelLabel[]);
    if (!assignRes.error && assignRes.data) setAssignments(assignRes.data as LabelAssignment[]);
    if (!notesRes.error && notesRes.data) setNotes(notesRes.data as ModelNote[]);
    setLoading(false);
  }, [platform, modelName]);

  useEffect(() => { reload(); }, [reload]);

  const handleAssign = async (labelId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase
      .from("model_label_assignments")
      .insert({ user_id: user.id, platform, model_name: modelName, label_id: labelId })
      .select("id, label_id")
      .single();
    if (error) toast.error("Label konnte nicht zugewiesen werden");
    else if (data) setAssignments((p) => [...p, data as LabelAssignment]);
    setShowAddLabel(false);
  };

  const handleUnassign = async (id: string) => {
    const prev = assignments;
    setAssignments(assignments.filter((a) => a.id !== id));
    const { error } = await supabase.from("model_label_assignments").delete().eq("id", id);
    if (error) { toast.error("Entfernen fehlgeschlagen"); setAssignments(prev); }
  };

  const handleSave = async () => {
    const text = draft.trim();
    if (!text) return;
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }
    const { data, error } = await supabase
      .from("model_notes")
      .insert({ user_id: user.id, platform, model_name: modelName, note_text: text })
      .select("id, note_text, created_at")
      .single();
    if (error) toast.error("Notiz konnte nicht gespeichert werden");
    else if (data) { setNotes((p) => [data as ModelNote, ...p]); setDraft(""); }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    const prev = notes;
    setNotes(notes.filter((n) => n.id !== id));
    const { error } = await supabase.from("model_notes").delete().eq("id", id);
    if (error) { toast.error("Löschen fehlgeschlagen"); setNotes(prev); }
  };

  return (
    <div className="premium-card rounded-2xl p-4 sm:p-5 space-y-4">
      <p className="text-[10px] gold-text-subtle font-medium tracking-[0.2em] uppercase">
        Notizen & Labels
      </p>

      {/* Labels */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider text-white/45 font-semibold">
          <Tag className="h-3 w-3" />
          Labels
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {assignments.length === 0 && !showAddLabel && (
            <span className="text-[11px] text-white/30 font-light italic">Keine Labels zugewiesen.</span>
          )}
          {assignments.map((a) => {
            const l = labelsById.get(a.label_id);
            if (!l) return null;
            return (
              <span
                key={a.id}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-medium"
                style={{ backgroundColor: `${l.color}22`, color: l.color, border: `1px solid ${l.color}55` }}
              >
                {l.label_name}
                <button onClick={() => handleUnassign(a.id)} className="opacity-60 hover:opacity-100" aria-label="Entfernen">
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            );
          })}
          {availableLabels.length > 0 && (
            showAddLabel ? (
              <div className="inline-flex items-center gap-1 bg-white/[0.04] border border-white/[0.1] rounded-full px-1">
                <select
                  autoFocus
                  defaultValue=""
                  onChange={(e) => { if (e.target.value) handleAssign(e.target.value); }}
                  className="bg-transparent text-[10.5px] text-foreground/90 py-0.5 pl-1 pr-1 focus:outline-none"
                >
                  <option value="" disabled>Label wählen …</option>
                  {availableLabels.map((l) => (
                    <option key={l.id} value={l.id} className="bg-[#1a1a1a]">{l.label_name}</option>
                  ))}
                </select>
                <button onClick={() => setShowAddLabel(false)} className="text-white/40 hover:text-white/80 pr-1">
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowAddLabel(true)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] text-white/55 border border-dashed border-white/15 hover:text-white/90 hover:border-white/30 transition-colors"
              >
                <Plus className="h-3 w-3" />
                Label
              </button>
            )
          )}
          {labels.length === 0 && (
            <span className="text-[10px] text-white/30 italic">Erst Labels im Model-Tracking anlegen.</span>
          )}
        </div>
      </div>

      {/* Notes */}
      <div className="space-y-2 pt-1">
        <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider text-white/45 font-semibold">
          <StickyNote className="h-3 w-3" />
          Notizen
        </div>
        <div className="flex gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSave(); } }}
            placeholder="Notiz zu diesem Model … (⌘+Enter)"
            rows={2}
            className="flex-1 bg-white/[0.025] border border-white/[0.07] rounded-md px-2.5 py-1.5 text-[12px] text-foreground/90 placeholder:text-white/25 focus:outline-none focus:border-white/15 resize-none"
          />
          <button
            onClick={handleSave}
            disabled={!draft.trim() || saving}
            className="self-start px-3 py-1.5 rounded-md bg-white/[0.08] border border-white/15 text-[11px] text-foreground/90 hover:bg-white/[0.12] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            <Send className="h-3 w-3" />
            Speichern
          </button>
        </div>

        {loading ? (
          <div className="text-[11px] text-white/30 font-light">Lade …</div>
        ) : notes.length === 0 ? (
          <div className="text-[11px] text-white/30 font-light italic">Noch keine Notizen.</div>
        ) : (
          <ul className="space-y-1.5">
            {notes.map((n) => (
              <li key={n.id} className="group flex items-start gap-2 bg-white/[0.02] border border-white/[0.05] rounded-md px-2.5 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] text-foreground/85 font-light whitespace-pre-wrap break-words">{n.note_text}</p>
                  <p className="text-[10px] text-white/30 font-light mt-1 tabular-nums">
                    {new Date(n.created_at).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(n.id)}
                  className="opacity-0 group-hover:opacity-100 text-white/30 hover:text-red-300 transition-all p-1"
                  aria-label="Notiz löschen"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
