import { useState, useEffect } from "react";
import { Save, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export default function SettingsPage() {
  const [systemPrompt, setSystemPrompt] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [savingKey, setSavingKey] = useState(false);

  useEffect(() => { loadSettings(); }, []);

  const loadSettings = async () => {
    const { data } = await supabase.from("settings").select("*").eq("key", "system_prompt").single();
    if (data) setSystemPrompt(data.value);
  };

  const savePrompt = async () => {
    setSavingPrompt(true);
    const { error } = await supabase.from("settings").update({ value: systemPrompt }).eq("key", "system_prompt");
    if (error) toast.error("Fehler beim Speichern");
    else toast.success("Gespeichert");
    setSavingPrompt(false);
  };

  const saveApiKey = async () => {
    if (!apiKey.trim()) return;
    setSavingKey(true);
    try {
      const { error } = await supabase.functions.invoke("save-api-key", { body: { apiKey: apiKey.trim() } });
      if (error) throw error;
      toast.success("API-Key gespeichert");
      setApiKey("");
    } catch {
      toast.error("Fehler beim Speichern");
    }
    setSavingKey(false);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-10 animate-fade-in">
      <div>
        <h1 className="text-2xl font-extralight tracking-tight text-foreground">
          Einstellungen
        </h1>
        <p className="text-[11px] text-white/25 mt-1.5 font-light tracking-wider uppercase">
          KI-Prompt & API-Zugang
        </p>
      </div>

      {/* System Prompt */}
      <div className="bg-white/[0.02] border border-white/[0.05] rounded-2xl p-8 space-y-5 backdrop-blur-2xl">
        <div>
          <h2 className="text-[13px] font-medium text-foreground/70 tracking-wide">System-Prompt</h2>
          <p className="text-[11px] text-white/20 mt-0.5 font-light">Das Gehirn deiner KI-Analyse</p>
        </div>
        <Textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="Master-Prompt..."
          rows={18}
          className="bg-white/[0.02] border-white/[0.05] text-foreground/80 placeholder:text-white/15 resize-y font-light text-sm leading-relaxed tracking-wide"
        />
        <Button
          onClick={savePrompt}
          disabled={savingPrompt}
          className="bg-white/[0.04] hover:bg-white/[0.06] text-foreground/70 border border-white/[0.06] hover:border-primary/15 font-light text-[12px] tracking-wider transition-all duration-500"
        >
          <Save className="h-3.5 w-3.5 mr-1.5" />
          {savingPrompt ? "Speichert..." : "Speichern"}
        </Button>
      </div>

      {/* API Key */}
      <div className="bg-white/[0.02] border border-white/[0.05] rounded-2xl p-8 space-y-5 backdrop-blur-2xl">
        <div>
          <h2 className="text-[13px] font-medium text-foreground/70 tracking-wide">Anthropic API-Key</h2>
          <p className="text-[11px] text-white/20 mt-0.5 font-light">Wird sicher im Backend gespeichert</p>
        </div>
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Input
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-..."
              className="bg-white/[0.02] border-white/[0.05] text-foreground/80 placeholder:text-white/15 pr-10 font-light text-sm"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/20 hover:text-white/40 transition-colors duration-500"
            >
              {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
          <Button
            onClick={saveApiKey}
            disabled={savingKey || !apiKey.trim()}
            className="bg-white/[0.04] hover:bg-white/[0.06] text-foreground/70 border border-white/[0.06] hover:border-primary/15 font-light text-[12px] tracking-wider transition-all duration-500 shrink-0"
          >
            <Save className="h-3.5 w-3.5 mr-1.5" />
            {savingKey ? "..." : "Speichern"}
          </Button>
        </div>
      </div>
    </div>
  );
}
