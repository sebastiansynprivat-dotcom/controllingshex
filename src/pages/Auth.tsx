import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Mail, Lock, Loader2 } from "lucide-react";

export default function Auth() {
  const { session, loading: authLoading } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showReset, setShowReset] = useState(false);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="h-6 w-6 border border-white/20 border-t-white/60 rounded-full animate-spin" />
      </div>
    );
  }

  if (session) return <Navigate to="/" replace />;

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Erfolgreich angemeldet!");
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast.success("Bestätigungs-E-Mail gesendet! Bitte prüfe dein Postfach.");
      }
    } catch (err: any) {
      toast.error(err.message || "Fehler bei der Anmeldung");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) {
        toast.error("Google Login fehlgeschlagen");
      }
      if (result.redirected) return;
    } catch {
      toast.error("Google Login fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      toast.error("Bitte E-Mail-Adresse eingeben");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      toast.success("Reset-Link gesendet! Prüfe dein Postfach.");
      setShowReset(false);
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
          <h1 className="text-2xl font-extralight tracking-tight text-foreground gold-text-subtle">
            Controlling
          </h1>
          <p className="text-white/25 text-xs font-light tracking-wider uppercase">
            {showReset ? "Passwort zurücksetzen" : isLogin ? "Anmelden" : "Konto erstellen"}
          </p>
        </div>

        {showReset ? (
          <form onSubmit={handlePasswordReset} className="space-y-4">
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/20" />
              <Input
                type="email"
                placeholder="E-Mail-Adresse"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-10 bg-white/[0.03] border-white/[0.06] text-foreground placeholder:text-white/20 font-light text-sm"
                required
              />
            </div>
            <Button disabled={loading} className="w-full bg-white/[0.04] hover:bg-white/[0.06] text-foreground/80 border border-white/[0.06] hover:border-primary/15 font-light text-sm tracking-wide transition-all duration-500">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reset-Link senden"}
            </Button>
            <button type="button" onClick={() => setShowReset(false)} className="w-full text-xs text-white/30 hover:text-white/50 transition-colors">
              Zurück zum Login
            </button>
          </form>
        ) : (
          <>
            <form onSubmit={handleAuth} className="space-y-4">
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/20" />
                <Input
                  type="email"
                  placeholder="E-Mail-Adresse"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10 bg-white/[0.03] border-white/[0.06] text-foreground placeholder:text-white/20 font-light text-sm"
                  required
                />
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/20" />
                <Input
                  type="password"
                  placeholder="Passwort"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 bg-white/[0.03] border-white/[0.06] text-foreground placeholder:text-white/20 font-light text-sm"
                  required
                  minLength={6}
                />
              </div>
              <Button disabled={loading} className="w-full bg-white/[0.04] hover:bg-white/[0.06] text-foreground/80 border border-white/[0.06] hover:border-primary/15 font-light text-sm tracking-wide transition-all duration-500">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : isLogin ? "Anmelden" : "Registrieren"}
              </Button>
            </form>

            <div className="relative">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/[0.06]" /></div>
              <div className="relative flex justify-center text-xs"><span className="bg-background px-3 text-white/20 font-light">oder</span></div>
            </div>

            <Button onClick={handleGoogleLogin} disabled={loading} variant="outline" className="w-full bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04] text-foreground/70 font-light text-sm tracking-wide">
              <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              Mit Google anmelden
            </Button>

            <div className="flex justify-between text-xs">
              <button type="button" onClick={() => setIsLogin(!isLogin)} className="text-white/30 hover:text-white/50 transition-colors">
                {isLogin ? "Noch kein Konto? Registrieren" : "Schon ein Konto? Anmelden"}
              </button>
              {isLogin && (
                <button type="button" onClick={() => setShowReset(true)} className="text-white/30 hover:text-white/50 transition-colors">
                  Passwort vergessen?
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
