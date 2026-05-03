
-- Add profile URL fields to models
ALTER TABLE public.models
  ADD COLUMN IF NOT EXISTS profile_url text,
  ADD COLUMN IF NOT EXISTS profile_image_url text;

-- Create model_attributes table
CREATE TABLE IF NOT EXISTS public.model_attributes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  model_id uuid NOT NULL REFERENCES public.models(id) ON DELETE CASCADE,
  age_group text,           -- 'young' | 'mature' | 'milf'
  body_type text,           -- 'slim' | 'curvy' | 'bbw' | 'athletic' | 'average'
  hair_color text,          -- 'blonde' | 'brunette' | 'red' | 'black' | 'other'
  style text,               -- 'girl-next-door' | 'dominant' | 'alternative' | 'glamour' | 'sporty'
  specials text[] DEFAULT '{}', -- ['tattoos','piercings','big-boobs',...]
  ai_summary text,
  source_image_url text,
  analyzed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (model_id)
);

ALTER TABLE public.model_attributes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "model_attributes_select_own" ON public.model_attributes
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "model_attributes_insert_own" ON public.model_attributes
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "model_attributes_update_own" ON public.model_attributes
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "model_attributes_delete_own" ON public.model_attributes
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER update_model_attributes_updated_at
  BEFORE UPDATE ON public.model_attributes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Storage bucket for fallback model photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('model-photos', 'model-photos', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "model_photos_select_own" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'model-photos' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "model_photos_insert_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'model-photos' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "model_photos_update_own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'model-photos' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "model_photos_delete_own" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'model-photos' AND auth.uid()::text = (storage.foldername(name))[1]);
