import { useState, useEffect } from "react";
import { Plus, Pencil, Trash2, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { usePlatform } from "@/contexts/PlatformContext";
import { motion, AnimatePresence } from "framer-motion";

interface Model {
  id: string;
  model_name: string;
  follower_count: number;
  platform: string;
}

export default function Models() {
  const { platform } = usePlatform();
  const [models, setModels] = useState<Model[]>([]);
  const [newName, setNewName] = useState("");
  const [newFollowers, setNewFollowers] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editFollowers, setEditFollowers] = useState("");

  const fetchModels = async () => {
    const { data } = await supabase
      .from("models")
      .select("*")
      .eq("platform", platform)
      .order("created_at", { ascending: true });
    if (data) setModels(data);
  };

  useEffect(() => {
    fetchModels();
    setEditId(null);
  }, [platform]);

  const addModel = async () => {
    if (!newName.trim()) return;
    const { error } = await supabase.from("models").insert({
      model_name: newName.trim(),
      follower_count: parseInt(newFollowers) || 0,
      platform,
    });
    if (error) { toast.error("Fehler beim Hinzufügen"); return; }
    toast.success(`Model zu ${platform} hinzugefügt!`);
    setNewName("");
    setNewFollowers("");
    fetchModels();
  };

  const saveEdit = async () => {
    if (!editId || !editName.trim()) return;
    const { error } = await supabase.from("models").update({
      model_name: editName.trim(),
      follower_count: parseInt(editFollowers) || 0,
    }).eq("id", editId);
    if (error) { toast.error("Fehler beim Speichern"); return; }
    toast.success("Model aktualisiert!");
    setEditId(null);
    fetchModels();
  };

  const deleteModel = async (id: string) => {
    const { error } = await supabase.from("models").delete().eq("id", id);
    if (error) { toast.error("Fehler beim Löschen"); return; }
    toast.success("Model gelöscht!");
    fetchModels();
  };

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={platform}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -12 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="max-w-4xl mx-auto space-y-8"
      >
        <div>
          <h1 className="font-display text-3xl font-bold gold-text">
            Models & Follower — {platform}
          </h1>
          <p className="text-muted-foreground mt-1">
            Verwalte die Models für <span className="text-foreground font-medium">{platform}</span>.
          </p>
        </div>

        {/* Add New */}
        <div className="bg-surface-2 border border-border rounded-xl p-6">
          <h2 className="font-display text-lg font-semibold text-foreground mb-4">Neues Model hinzufügen</h2>
          <div className="flex flex-col sm:flex-row gap-3">
            <Input
              placeholder="Model Name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="bg-surface-3 border-border text-foreground placeholder:text-muted-foreground"
            />
            <Input
              placeholder="Follower-Zahl"
              type="number"
              value={newFollowers}
              onChange={(e) => setNewFollowers(e.target.value)}
              className="bg-surface-3 border-border text-foreground placeholder:text-muted-foreground sm:w-48"
            />
            <Button
              onClick={addModel}
              className="gold-gradient text-primary-foreground font-semibold hover:gold-glow-sm transition-all shrink-0"
            >
              <Plus className="h-4 w-4 mr-2" />
              Hinzufügen
            </Button>
          </div>
        </div>

        {/* Table */}
        <div className="bg-surface-2 border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-3/50">
                <th className="text-left py-4 px-6 text-primary font-semibold">Model Name</th>
                <th className="text-left py-4 px-6 text-primary font-semibold">Follower</th>
                <th className="text-right py-4 px-6 text-primary font-semibold">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {models.length === 0 && (
                <tr>
                  <td colSpan={3} className="text-center py-12 text-muted-foreground">
                    Noch keine Models für {platform} vorhanden.
                  </td>
                </tr>
              )}
              {models.map((m) => (
                <tr key={m.id} className="border-b border-border/50 hover:bg-surface-3/30 transition-colors">
                  {editId === m.id ? (
                    <>
                      <td className="py-3 px-6">
                        <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="bg-surface-3 border-border text-foreground h-9" />
                      </td>
                      <td className="py-3 px-6">
                        <Input value={editFollowers} onChange={(e) => setEditFollowers(e.target.value)} type="number" className="bg-surface-3 border-border text-foreground h-9 w-32" />
                      </td>
                      <td className="py-3 px-6 text-right space-x-2">
                        <Button size="sm" variant="ghost" onClick={saveEdit} className="text-primary hover:text-primary hover:bg-primary/10"><Save className="h-4 w-4" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditId(null)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></Button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="py-4 px-6 text-foreground font-medium">{m.model_name}</td>
                      <td className="py-4 px-6 text-foreground">{m.follower_count.toLocaleString()}</td>
                      <td className="py-4 px-6 text-right space-x-2">
                        <Button size="sm" variant="ghost" onClick={() => { setEditId(m.id); setEditName(m.model_name); setEditFollowers(String(m.follower_count)); }} className="text-muted-foreground hover:text-primary hover:bg-primary/10"><Pencil className="h-4 w-4" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => deleteModel(m.id)} className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"><Trash2 className="h-4 w-4" /></Button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
