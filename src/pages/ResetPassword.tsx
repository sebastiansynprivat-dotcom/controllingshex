import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { Lock, Loader2 } from "lucide-react";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Check for recovery event
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setReady(true);
      }
    });
    // Also check hash params
    if (window.location.hash.includes("type=recovery")) {
      setReady(true);
    }
    return () => subscription.unsubscribe();
  }, []);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast.error("Passwort muss mindestens 6 Zeichen lang sein");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Passwort erfolgreich geändert!");
      navigate("/");
    } catch (err: any) {
      toast.error(err.message || "Fehler");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-extralight tracking-tight text-foreground gold-text-subtle">Neues Passwort</h1>
          <p className="text-white/25 text-xs font-light tracking-wider uppercase">Passwort zurücksetzen</p>
        </div>
        {ready ? (
          <form onSubmit={handleReset} className="space-y-4">
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/20" />
              <Input
                type="password"
                placeholder="Neues Passwort"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pl-10 bg-white/[0.03] border-white/[0.06] text-foreground placeholder:text-white/20 font-light text-sm"
                required
                minLength={6}
              />
            </div>
            <Button disabled={loading} className="w-full bg-white/[0.04] hover:bg-white/[0.06] text-foreground/80 border border-white/[0.06] hover:border-primary/15 font-light text-sm tracking-wide transition-all duration-500">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Passwort ändern"}
            </Button>
          </form>
        ) : (
          <p className="text-center text-white/30 text-sm font-light">Lade Recovery-Session…</p>
        )}
      </div>
    </div>
  );
}
