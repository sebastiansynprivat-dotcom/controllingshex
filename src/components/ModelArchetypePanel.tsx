import { useState, useEffect, useMemo } from "react";
import { Sparkles, Upload, Loader2, Link as LinkIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

export interface ModelAttributes {
  id: string;
  model_id: string;
  age_group: string | null;
  body_type: string | null;
  hair_color: string | null;
  style: string | null;
  specials: string[];
  ai_summary: string | null;
  source_image_url: string | null;
  analyzed_at: string;
}

export const AGE_LABELS: Record<string, string> = {
  young: "Jung",
  mature: "Mature",
  milf: "MILF",
};
export const BODY_LABELS: Record<string, string> = {
  slim: "Schlank",
  curvy: "Curvy",
  bbw: "BBW",
  athletic: "Athletisch",
  average: "Normal",
};
export const HAIR_LABELS: Record<string, string> = {
  blonde: "Blond",
  brunette: "Brünett",
  red: "Rot",
  black: "Schwarz",
  other: "Andere",
};
export const STYLE_LABELS: Record<string, string> = {
  "girl-next-door": "Girl-next-door",
  dominant: "Dominant",
  alternative: "Alternative",
  glamour: "Glamour",
  sporty: "Sporty",
};
export const SPECIAL_LABELS: Record<string, string> = {
  tattoos: "Tattoos",
  piercings: "Piercings",
  "big-boobs": "Große Brüste",
  "small-boobs": "Kleine Brüste",
  glasses: "Brille",
  lingerie: "Lingerie",
  fitness: "Fitness",
  natural: "Natural",
};

interface Props {
  modelId: string;
  modelName: string;
  profileUrl: string | null;
  profileImageUrl: string | null;
  attributes: ModelAttributes | null;
  onChange: () => void;
}

export default function ModelArchetypePanel({
  modelId,
  modelName,
  profileUrl: initialProfileUrl,
  profileImageUrl,
  attributes,
  onChange,
}: Props) {
  const { user } = useAuth();
  const [profileUrl, setProfileUrl] = useState(initialProfileUrl ?? "");
  const [analyzing, setAnalyzing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showEditor, setShowEditor] = useState(false);

  useEffect(() => {
    setProfileUrl(initialProfileUrl ?? "");
  }, [initialProfileUrl]);

  const saveProfileUrl = async () => {
    const { error } = await supabase
      .from("models")
      .update({ profile_url: profileUrl.trim() || null })
      .eq("id", modelId);
    if (error) toast.error("Speichern fehlgeschlagen");
    else {
      toast.success("Profil-URL gespeichert");
      onChange();
    }
  };

  const handleUpload = async (file: File) => {
    if (!user) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${user.id}/${modelId}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("model-photos")
        .upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: signed } = await supabase.storage
        .from("model-photos")
        .createSignedUrl(path, 60 * 60 * 24 * 365);
      if (!signed) throw new Error("Kein URL");
      const { error } = await supabase
        .from("models")
        .update({ profile_image_url: signed.signedUrl })
        .eq("id", modelId);
      if (error) throw error;
      toast.success("Foto hochgeladen");
      onChange();
    } catch (e) {
      toast.error("Upload fehlgeschlagen");
      console.error(e);
    }
    setUploading(false);
  };

  const runAnalysis = async () => {
    setAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "analyze-model-profile",
        {
          body: {
            model_id: modelId,
            image_url: profileImageUrl || undefined,
            profile_url: profileUrl.trim() || undefined,
          },
        },
      );
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      toast.success(`${modelName} analysiert`);
      onChange();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Analyse fehlgeschlagen";
      toast.error(msg);
    }
    setAnalyzing(false);
  };

  const hasSource = !!(profileImageUrl || profileUrl.trim());

  return (
    <div className="mt-2 space-y-2">
      {attributes ? (
        <div className="flex flex-wrap gap-1.5">
          {attributes.age_group && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300/80 font-light">
              {AGE_LABELS[attributes.age_group] ?? attributes.age_group}
            </span>
          )}
          {attributes.body_type && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-300/80 font-light">
              {BODY_LABELS[attributes.body_type] ?? attributes.body_type}
            </span>
          )}
          {attributes.hair_color && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-yellow-500/10 border border-yellow-500/20 text-yellow-300/80 font-light">
              {HAIR_LABELS[attributes.hair_color] ?? attributes.hair_color}
            </span>
          )}
          {attributes.style && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300/80 font-light">
              {STYLE_LABELS[attributes.style] ?? attributes.style}
            </span>
          )}
          {attributes.specials?.map((s) => (
            <span
              key={s}
              className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.08] text-white/55 font-light"
            >
              {SPECIAL_LABELS[s] ?? s}
            </span>
          ))}
          <button
            onClick={() => setShowEditor((v) => !v)}
            className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.03] border border-white/[0.06] text-white/35 hover:text-white/70 transition-colors font-light"
          >
            ⋯
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowEditor((v) => !v)}
          className="text-[11px] px-2.5 py-1 rounded-md bg-primary/10 hover:bg-primary/20 border border-primary/30 text-primary/90 hover:text-primary inline-flex items-center gap-1.5 transition-colors font-light"
        >
          <Sparkles className="h-3 w-3" /> Archetyp analysieren
        </button>
      )}

      {showEditor && (
        <div className="bg-white/[0.02] border border-white/[0.05] rounded-lg p-3 space-y-2 text-[11px]">
          <div className="flex items-center gap-1.5 text-white/40 font-light">
            <LinkIcon className="h-3 w-3" />
            <span>Maloum-Profil-URL</span>
          </div>
          <div className="flex gap-1.5">
            <Input
              value={profileUrl}
              onChange={(e) => setProfileUrl(e.target.value)}
              placeholder="https://app.maloum.com/creator/..."
              className="bg-white/[0.03] border-white/[0.06] h-7 text-[11px] font-light"
            />
            <Button
              size="sm"
              onClick={saveProfileUrl}
              className="h-7 px-2 text-[10px] bg-white/[0.04] border border-white/[0.08]"
            >
              OK
            </Button>
          </div>

          <label className="inline-flex items-center gap-1.5 text-white/40 hover:text-white/70 cursor-pointer transition-colors">
            <Upload className="h-3 w-3" />
            <span className="font-light">
              {profileImageUrl ? "Foto ersetzen" : "Foto hochladen (Fallback)"}
            </span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f);
              }}
            />
          </label>
          {uploading && (
            <div className="text-[10px] text-white/30 inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Lädt hoch...
            </div>
          )}

          <Button
            size="sm"
            disabled={!hasSource || analyzing}
            onClick={runAnalysis}
            className="w-full h-7 text-[10px] bg-primary/10 hover:bg-primary/15 text-primary border border-primary/20"
          >
            {analyzing ? (
              <>
                <Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> Analysiere...
              </>
            ) : (
              <>
                <Sparkles className="h-3 w-3 mr-1.5" />
                {attributes ? "Neu analysieren" : "Analysieren"}
              </>
            )}
          </Button>
          {attributes?.ai_summary && (
            <p className="text-[10px] text-white/40 italic font-light leading-relaxed">
              {attributes.ai_summary}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
