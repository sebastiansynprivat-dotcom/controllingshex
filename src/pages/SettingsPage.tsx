import { useState, useEffect, useMemo } from "react";
import { Save, Eye, EyeOff, Mail, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

export default function SettingsPage() {
  const [systemPrompt, setSystemPrompt] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const { user } = useAuth();

  // Link email/password state
  const [linkEmail, setLinkEmail] = useState("");
  const [linkPassword, setLinkPassword] = useState("");
  const [linkConfirm, setLinkConfirm] = useState("");
  const [showLinkPw, setShowLinkPw] = useState(false);
  const [savingLink, setSavingLink] = useState(false);

  // Check if user signed up via OAuth (no email identity yet)
  const hasEmailIdentity = useMemo(() => {
    if (!user) return false;
    return user.identities?.some((i) => i.provider === "email") ?? false;
  }, [user]);

  const isOAuthOnly = useMemo(() => {
    if (!user) return false;
    return !hasEmailIdentity && (user.identities?.some((i) => i.provider !== "email") ?? false);
  }, [user, hasEmailIdentity]);

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

  const handleLinkCredentials = async () => {
    if (!linkEmail.trim() || !linkPassword.trim()) {
      toast.error("Bitte E-Mail und Passwort eingeben");
      return;
    }
    if (linkPassword !== linkConfirm) {
      toast.error("Passwörter stimmen nicht überein");
      return;
    }
    if (linkPassword.length < 6) {
      toast.error("Passwort muss mindestens 6 Zeichen haben");
      return;
    }

    setSavingLink(true);
    try {
      const { error } = await supabase.auth.updateUser({
        email: linkEmail.trim(),
        password: linkPassword,
      });

      if (error) {
        if (error.message.includes("already")) {
          toast.error("Diese E-Mail wird bereits verwendet");
        } else {
          toast.error(error.message);
        }
      } else {
        toast.success("Login-Daten hinzugefügt! Prüfe dein E-Mail-Postfach zur Bestätigung.");
        setLinkEmail("");
        setLinkPassword("");
        setLinkConfirm("");
      }
    } catch {
      toast.error("Fehler beim Verknüpfen");
    }
    setSavingLink(false);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8 sm:space-y-10 animate-fade-in">
      <div>
        <h1 className="text-2xl font-extralight tracking-tight text-foreground">
          Einstellungen
        </h1>
        <p className="text-[11px] text-white/25 mt-1.5 font-light tracking-wider uppercase">
          KI-Prompt & API-Zugang
        </p>
      </div>

      {/* Link Email/Password — only show for OAuth-only users */}
      {isOAuthOnly && (
        <div className="bg-white/[0.02] border border-primary/10 rounded-2xl p-5 sm:p-8 space-y-5 backdrop-blur-2xl">
          <div>
            <h2 className="text-[13px] font-medium text-foreground/70 tracking-wide flex items-center gap-2">
              <Lock className="h-3.5 w-3.5 text-primary/60" />
              Login-Daten hinzufügen
            </h2>
            <p className="text-[11px] text-white/20 mt-0.5 font-light">
              Füge eine E-Mail und ein Passwort hinzu, um dich auch ohne Google einloggen zu können
            </p>
          </div>
          <div className="space-y-3">
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/20" />
              <Input
                type="email"
                value={linkEmail}
                onChange={(e) => setLinkEmail(e.target.value)}
                placeholder="E-Mail-Adresse"
                className="bg-white/[0.02] border-white/[0.05] text-foreground/80 placeholder:text-white/15 pl-9 font-light text-sm"
              />
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/20" />
              <Input
                type={showLinkPw ? "text" : "password"}
                value={linkPassword}
                onChange={(e) => setLinkPassword(e.target.value)}
                placeholder="Passwort (min. 6 Zeichen)"
                className="bg-white/[0.02] border-white/[0.05] text-foreground/80 placeholder:text-white/15 pl-9 pr-10 font-light text-sm"
              />
              <button
                type="button"
                onClick={() => setShowLinkPw(!showLinkPw)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/20 hover:text-white/40 transition-colors duration-500"
              >
                {showLinkPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/20" />
              <Input
                type={showLinkPw ? "text" : "password"}
                value={linkConfirm}
                onChange={(e) => setLinkConfirm(e.target.value)}
                placeholder="Passwort bestätigen"
                className="bg-white/[0.02] border-white/[0.05] text-foreground/80 placeholder:text-white/15 pl-9 font-light text-sm"
              />
            </div>
          </div>
          <Button
            onClick={handleLinkCredentials}
            disabled={savingLink || !linkEmail.trim() || !linkPassword.trim() || !linkConfirm.trim()}
            className="bg-primary/10 hover:bg-primary/15 text-primary border border-primary/20 hover:border-primary/30 font-light text-[12px] tracking-wider transition-all duration-500"
          >
            <Save className="h-3.5 w-3.5 mr-1.5" />
            {savingLink ? "Wird verknüpft..." : "Login-Daten verknüpfen"}
          </Button>
        </div>
      )}

      {/* System Prompt */}
      <div className="bg-white/[0.02] border border-white/[0.05] rounded-2xl p-5 sm:p-8 space-y-5 backdrop-blur-2xl">
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
      <div className="bg-white/[0.02] border border-white/[0.05] rounded-2xl p-5 sm:p-8 space-y-5 backdrop-blur-2xl">
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
