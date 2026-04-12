import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  open: boolean;
  onClose: () => void;
  chatterName: string;
  platform: string;
  onDone: () => void;
}

export default function SwipeActionPanel({ open, onClose, chatterName, platform, onDone }: Props) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSaveNote = async () => {
    if (!note.trim()) return;
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }

    const { error } = await supabase.from("coaching_notes").insert({
      chatter_name: chatterName,
      note_text: note.trim(),
      platform,
      user_id: user.id,
    });

    if (error) {
      toast.error("Notiz konnte nicht gespeichert werden");
    } else {
      toast.success("Notiz gespeichert");
      setNote("");
      onDone();
    }
    setSaving(false);
  };

  const handleMarkCoaching = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase.from("video_coachings").insert({
      chatter_name: chatterName,
      platform,
      user_id: user.id,
    });

    if (error) {
      toast.error("Fehler beim Markieren");
    } else {
      toast.success("Coaching markiert");
      onDone();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="absolute inset-0 z-30 flex items-end"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/40" onClick={onClose} />
          <motion.div
            className="relative w-full rounded-t-2xl bg-[hsl(var(--surface-1))] border-t border-border p-5"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-foreground capitalize">
                Aktion: {chatterName.replace(/_/g, " ")}
              </h3>
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Schnelle Notiz..."
              className="mb-3 bg-secondary border-border text-sm resize-none"
              rows={2}
            />

            <div className="flex gap-2">
              <Button
                onClick={handleSaveNote}
                disabled={!note.trim() || saving}
                size="sm"
                className="flex-1"
              >
                <Send className="h-3.5 w-3.5 mr-1.5" />
                Notiz speichern
              </Button>
              <Button
                onClick={handleMarkCoaching}
                variant="outline"
                size="sm"
                className="flex-1"
              >
                🎥 Coaching nötig
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
