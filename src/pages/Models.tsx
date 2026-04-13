import { useState, useEffect } from "react";
import { Plus, Pencil, Trash2, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { usePlatform } from "@/contexts/PlatformContext";
import { useAuth } from "@/contexts/AuthContext";
import { motion, AnimatePresence } from "framer-motion";

interface Model {
  id: string;
  model_name: string;
  follower_count: number;
  platform: string;
  created_at: string;
}

export default function Models() {
  const { platform } = usePlatform();
  const { user } = useAuth();
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
      user_id: user?.id,
    });
    if (error) { toast.error("Fehler beim Hinzufügen"); return; }
    toast.success(`Model hinzugefügt`);
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
    toast.success("Aktualisiert");
    setEditId(null);
    fetchModels();
  };

  const deleteModel = async (id: string) => {
    const { error } = await supabase.from("models").delete().eq("id", id);
    if (error) { toast.error("Fehler beim Löschen"); return; }
    toast.success("Gelöscht");
    fetchModels();
  };

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={platform}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="max-w-4xl mx-auto space-y-8 sm:space-y-10"
      >
        <div>
          <h1 className="text-2xl font-extralight tracking-tight text-foreground">
            Models & Follower
          </h1>
          <p className="text-[11px] text-white/25 mt-1.5 font-light tracking-wider uppercase">
            {platform} · {models.length} Models
          </p>
        </div>

        {/* Add New */}
        <div className="bg-white/[0.02] border border-white/[0.05] rounded-2xl p-5 sm:p-8 backdrop-blur-2xl">
          <h2 className="text-[13px] font-medium text-foreground/70 mb-4 sm:mb-5 tracking-wide">Neues Model</h2>
          <div className="flex flex-col sm:flex-row gap-3">
            <Input
              placeholder="Name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="bg-white/[0.03] border-white/[0.06] text-foreground placeholder:text-white/20 font-light text-sm"
            />
            <Input
              placeholder="Follower"
              type="number"
              value={newFollowers}
              onChange={(e) => setNewFollowers(e.target.value)}
              className="bg-white/[0.03] border-white/[0.06] text-foreground placeholder:text-white/20 font-light text-sm sm:w-40"
            />
            <Button
              onClick={addModel}
              className="bg-white/[0.04] hover:bg-white/[0.06] text-foreground/70 border border-white/[0.06] hover:border-primary/15 font-light text-[12px] tracking-wider transition-all duration-500 shrink-0"
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Hinzufügen
            </Button>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white/[0.02] border border-white/[0.05] rounded-2xl overflow-hidden backdrop-blur-2xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.04]">
                <th className="text-left py-3 sm:py-4 px-4 sm:px-8 text-[10px] text-white/25 font-light uppercase tracking-[0.2em]">Model</th>
                <th className="text-left py-3 sm:py-4 px-4 sm:px-8 text-[10px] text-white/25 font-light uppercase tracking-[0.2em]">Follower</th>
                <th className="text-left py-3 sm:py-4 px-4 sm:px-8 text-[10px] text-white/25 font-light uppercase tracking-[0.2em] hidden sm:table-cell">Hinzugefügt</th>
                <th className="text-right py-3 sm:py-4 px-4 sm:px-8 text-[10px] text-white/25 font-light uppercase tracking-[0.2em]">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {models.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center py-16 text-white/20 font-light text-sm">
                    Keine Models
                  </td>
                </tr>
              )}
              {models.map((m) => (
                <tr key={m.id} className="border-b border-white/[0.03] hover:bg-white/[0.01] transition-colors duration-500">
                  {editId === m.id ? (
                    <>
                      <td className="py-3 sm:py-4 px-4 sm:px-8">
                        <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="bg-white/[0.03] border-white/[0.06] text-foreground h-8 text-sm font-light" />
                      </td>
                      <td className="py-3 sm:py-4 px-4 sm:px-8">
                        <Input value={editFollowers} onChange={(e) => setEditFollowers(e.target.value)} type="number" className="bg-white/[0.03] border-white/[0.06] text-foreground h-8 w-20 sm:w-28 text-sm font-light" />
                      </td>
                      <td className="py-3 sm:py-4 px-4 sm:px-8 hidden sm:table-cell text-white/20 text-xs font-light">
                        {new Date(m.created_at).toLocaleDateString("de-DE")}
                      </td>
                      <td className="py-3 sm:py-4 px-4 sm:px-8 text-right space-x-1">
                        <Button size="sm" variant="ghost" onClick={saveEdit} className="text-primary/60 hover:text-primary hover:bg-primary/5 h-7 w-7 p-0"><Save className="h-3.5 w-3.5" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditId(null)} className="text-white/25 hover:text-white/50 h-7 w-7 p-0"><X className="h-3.5 w-3.5" /></Button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="py-4 sm:py-5 px-4 sm:px-8">
                        <span className="text-foreground/85 font-light text-[13px] tracking-wide">{m.model_name}</span>
                        <span className="block sm:hidden text-[10px] text-white/20 font-light mt-0.5">seit {new Date(m.created_at).toLocaleDateString("de-DE")}</span>
                      </td>
                      <td className="py-4 sm:py-5 px-4 sm:px-8 text-foreground/60 font-extralight text-base sm:text-lg tracking-tight">{m.follower_count.toLocaleString()}</td>
                      <td className="py-4 sm:py-5 px-4 sm:px-8 text-white/25 font-light text-xs hidden sm:table-cell">{new Date(m.created_at).toLocaleDateString("de-DE")}</td>
                      <td className="py-4 sm:py-5 px-4 sm:px-8 text-right space-x-1">
                        <Button size="sm" variant="ghost" onClick={() => { setEditId(m.id); setEditName(m.model_name); setEditFollowers(String(m.follower_count)); }} className="text-white/15 hover:text-white/50 hover:bg-white/[0.03] h-7 w-7 p-0"><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => deleteModel(m.id)} className="text-white/15 hover:text-red-400/60 hover:bg-red-400/5 h-7 w-7 p-0"><Trash2 className="h-3.5 w-3.5" /></Button>
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
