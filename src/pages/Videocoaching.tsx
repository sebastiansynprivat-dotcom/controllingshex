import { useState, useEffect } from "react";
import { Video, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePlatform } from "@/contexts/PlatformContext";
import { toast } from "sonner";

interface VideoCoaching {
  id: string;
  chatter_name: string;
  platform: string;
  sent_at: string;
}

export default function Videocoaching() {
  const { user } = useAuth();
  const { platform } = usePlatform();
  const [name, setName] = useState("");
  const [entries, setEntries] = useState<VideoCoaching[]>([]);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [allChatterNames, setAllChatterNames] = useState<string[]>([]);

  const fetchEntries = async () => {
    const { data } = await supabase
      .from("video_coachings")
      .select("*")
      .eq("platform", platform)
      .order("sent_at", { ascending: false });
    if (data) setEntries(data as VideoCoaching[]);
  };

  const fetchChatterNames = async () => {
    const { data } = await supabase
      .from("chatter_history")
      .select("chatter_name")
      .eq("platform", platform);
    if (data) {
      const unique = [...new Set(data.map((r: any) => r.chatter_name as string))];
      setAllChatterNames(unique);
    }
  };

  useEffect(() => {
    fetchEntries();
    fetchChatterNames();
  }, [platform]);

  useEffect(() => {
    if (name.length < 2) { setSuggestions([]); return; }
    const q = name.toLowerCase();
    setSuggestions(allChatterNames.filter((n) => n.toLowerCase().includes(q)).slice(0, 6));
  }, [name, allChatterNames]);

  const handleAdd = async () => {
    const trimmed = name.trim();
    if (!trimmed || !user) return;
    setLoading(true);
    const { error } = await supabase.from("video_coachings").insert({
      user_id: user.id,
      chatter_name: trimmed,
      platform,
    });
    setLoading(false);
    if (error) { toast.error("Fehler beim Speichern"); return; }
    toast.success(`Videocoaching für ${trimmed} eingetragen`);
    setName("");
    fetchEntries();
  };

  const handleDelete = async (id: string) => {
    await supabase.from("video_coachings").delete().eq("id", id);
    toast.success("Eintrag gelöscht");
    fetchEntries();
  };

  const daysAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    return Math.floor(diff / 86400000);
  };

  return (
    <div className="min-h-full p-6 sm:p-10 max-w-2xl mx-auto space-y-10">
      <div>
        <h1 className="text-xl font-extralight text-foreground tracking-tight flex items-center gap-3">
          <Video className="h-5 w-5 text-primary/60" />
          Videocoaching
        </h1>
        <p className="text-[11px] text-white/25 mt-1.5 font-light tracking-wider">
          Trage ein, wenn du einem Chatter ein Videocoaching geschickt hast.
        </p>
      </div>

      {/* Input */}
      <div className="relative">
        <div className="flex gap-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder="Chatter-Name eingeben…"
            className="bg-white/[0.03] border-white/[0.06] text-foreground placeholder:text-white/20 font-light"
          />
          <Button
            onClick={handleAdd}
            disabled={!name.trim() || loading}
            className="shrink-0 bg-primary/20 hover:bg-primary/30 text-primary border border-primary/20 font-light"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Eintragen
          </Button>
        </div>

        {/* Autocomplete */}
        {suggestions.length > 0 && (
          <div className="absolute z-50 top-full mt-1 w-full bg-popover border border-white/[0.08] rounded-xl shadow-2xl overflow-hidden">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => { setName(s); setSuggestions([]); }}
                className="w-full text-left px-4 py-2.5 text-sm text-white/60 hover:bg-white/[0.04] hover:text-white/80 font-light transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* List */}
      <div className="space-y-2">
        <h2 className="text-[11px] text-white/20 font-light tracking-[0.15em] uppercase">
          Einträge ({entries.length})
        </h2>
        {entries.length === 0 ? (
          <p className="text-sm text-white/25 font-light py-8 text-center">Noch keine Einträge vorhanden.</p>
        ) : (
          <div className="rounded-2xl bg-white/[0.02] border border-white/[0.05] divide-y divide-white/[0.03] overflow-hidden">
            {entries.map((e) => {
              const days = daysAgo(e.sent_at);
              return (
                <div key={e.id} className="flex items-center justify-between px-5 py-4 hover:bg-white/[0.015] transition-colors">
                  <div>
                    <span className="text-sm font-medium text-foreground/80">{e.chatter_name}</span>
                    <span className="ml-3 text-[11px] text-white/25 font-light">
                      vor {days === 0 ? "heute" : `${days} Tag${days !== 1 ? "en" : ""}`}
                    </span>
                    <span className="ml-2 text-[10px] text-white/15 font-light">
                      {new Date(e.sent_at).toLocaleDateString("de-DE")}
                    </span>
                  </div>
                  <button
                    onClick={() => handleDelete(e.id)}
                    className="text-white/15 hover:text-red-400/60 transition-colors p-1"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
