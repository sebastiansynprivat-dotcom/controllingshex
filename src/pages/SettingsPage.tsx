import { useState, useEffect } from "react";
import { Save, Eye, EyeOff, KeyRound, Brain } from "lucide-react";
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

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    const { data } = await supabase
      .from("settings")
      .select("*")
      .eq("key", "system_prompt")
      .single();
    if (data) setSystemPrompt(data.value);
  };

  const savePrompt = async () => {
    setSavingPrompt(true);
    const { error } = await supabase
      .from("settings")
      .update({ value: systemPrompt })
      .eq("key", "system_prompt");
    if (error) toast.error("Fehler beim Speichern");
    else toast.success("System-Prompt gespeichert!");
    setSavingPrompt(false);
  };

  const saveApiKey = async () => {
    if (!apiKey.trim()) return;
    setSavingKey(true);
    try {
      const { error } = await supabase.functions.invoke("save-api-key", {
        body: { apiKey: apiKey.trim() },
      });
      if (error) throw error;
      toast.success("API-Key sicher gespeichert!");
      setApiKey("");
    } catch {
      toast.error("Fehler beim Speichern des API-Keys");
    }
    setSavingKey(false);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8 animate-fade-in">
      <div>
        <h1 className="font-display text-3xl font-bold gold-text">Einstellungen</h1>
        <p className="text-muted-foreground mt-1">Verwalte deinen KI-Prompt und API-Zugang.</p>
      </div>

      {/* System Prompt */}
      <div className="bg-surface-2 border border-border rounded-xl p-6 space-y-4 animate-fade-in-delay">
        <div className="flex items-center gap-3">
          <Brain className="h-5 w-5 text-primary" />
          <h2 className="font-display text-lg font-semibold text-foreground">System-Prompt (KI-Gehirn)</h2>
        </div>
        <Textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="Dein Master-Prompt für die KI-Analyse..."
          rows={16}
          className="bg-surface-3 border-border text-foreground placeholder:text-muted-foreground resize-y font-mono text-sm"
        />
        <Button
          onClick={savePrompt}
          disabled={savingPrompt}
          className="gold-gradient text-primary-foreground font-semibold hover:gold-glow-sm transition-all"
        >
          <Save className="h-4 w-4 mr-2" />
          {savingPrompt ? "Speichert..." : "Prompt speichern"}
        </Button>
      </div>

      {/* API Key */}
      <div className="bg-surface-2 border border-border rounded-xl p-6 space-y-4 animate-fade-in-delay-2">
        <div className="flex items-center gap-3">
          <KeyRound className="h-5 w-5 text-primary" />
          <h2 className="font-display text-lg font-semibold text-foreground">Anthropic API-Key</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Dein API-Key wird sicher im Backend gespeichert und nie im Frontend angezeigt.
        </p>
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Input
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-..."
              className="bg-surface-3 border-border text-foreground placeholder:text-muted-foreground pr-10"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <Button
            onClick={saveApiKey}
            disabled={savingKey || !apiKey.trim()}
            className="gold-gradient text-primary-foreground font-semibold hover:gold-glow-sm transition-all shrink-0"
          >
            <Save className="h-4 w-4 mr-2" />
            {savingKey ? "Speichert..." : "Key speichern"}
          </Button>
        </div>
      </div>
    </div>
  );
}
