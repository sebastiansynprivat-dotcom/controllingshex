import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Loader2 } from "lucide-react";

// The supabase.auth.oauth namespace is beta; typed locally until the SDK ships types.
type OAuthApi = {
  getAuthorizationDetails: (id: string) => Promise<{ data: any; error: any }>;
  approveAuthorization: (id: string) => Promise<{ data: any; error: any }>;
  denyAuthorization: (id: string) => Promise<{ data: any; error: any }>;
};
const oauthApi = () => (supabase.auth as unknown as { oauth: OAuthApi }).oauth;

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) {
        setError("Es fehlt die authorization_id in der URL.");
        return;
      }
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        const next = window.location.pathname + window.location.search;
        window.location.href = "/auth?next=" + encodeURIComponent(next);
        return;
      }
      const { data, error: err } = await oauthApi().getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (err) {
        setError(err.message);
        return;
      }
      const immediate = data?.redirect_url ?? data?.redirect_to;
      if (immediate && !data?.client) {
        window.location.href = immediate;
        return;
      }
      setDetails(data);
    })();
    return () => {
      active = false;
    };
  }, [authorizationId]);

  const decide = async (approve: boolean) => {
    setBusy(true);
    const { data, error: err } = approve
      ? await oauthApi().approveAuthorization(authorizationId)
      : await oauthApi().denyAuthorization(authorizationId);
    if (err) {
      setBusy(false);
      setError(err.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("Der Authorization-Server hat keine Weiterleitung zurückgegeben.");
      return;
    }
    window.location.href = target;
  };

  const clientName = details?.client?.name ?? "Diese App";

  return (
    <main className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl bg-white/[0.02] border border-white/[0.06] p-8 space-y-6">
        <div className="w-12 h-12 rounded-xl bg-primary/5 border border-primary/10 flex items-center justify-center">
          <ShieldCheck className="h-5 w-5 text-primary/60" />
        </div>

        {error ? (
          <div className="space-y-2">
            <h1 className="text-xl font-extralight text-foreground tracking-tight">Zugriff nicht möglich</h1>
            <p className="text-sm text-white/40 font-light">{error}</p>
          </div>
        ) : !details ? (
          <div className="flex items-center gap-3 text-sm text-white/30 font-light">
            <Loader2 className="h-4 w-4 animate-spin" />
            Anfrage wird geladen…
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <h1 className="text-xl font-extralight text-foreground tracking-tight">
                {clientName} mit deinem Account verbinden
              </h1>
              <p className="text-sm text-white/40 font-light leading-relaxed">
                {clientName} kann danach in deinem Namen auf deine Controlling-Daten zugreifen — Chatter, Models,
                Echtzeit-Status und Memos. Du kannst den Zugriff jederzeit widerrufen.
              </p>
            </div>

            <div className="flex gap-3">
              <Button onClick={() => decide(true)} disabled={busy} className="flex-1">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Erlauben"}
              </Button>
              <Button onClick={() => decide(false)} disabled={busy} variant="outline" className="flex-1">
                Ablehnen
              </Button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
