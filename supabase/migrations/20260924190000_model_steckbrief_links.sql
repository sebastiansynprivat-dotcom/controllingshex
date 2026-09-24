CREATE TABLE public.model_steckbrief_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL CHECK (platform IN ('Maloum', 'Brezzels', '4Based')),
  email_normalized text NOT NULL CHECK (
    email_normalized <> ''
    AND email_normalized = lower(email_normalized)
    AND email_normalized = btrim(email_normalized)
  ),
  mode text NOT NULL CHECK (mode IN ('assign', 'block')),
  external_model_id uuid,
  external_model_name text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT model_steckbrief_links_mode_model_check CHECK (
    (mode = 'assign' AND external_model_id IS NOT NULL)
    OR (mode = 'block' AND external_model_id IS NULL)
  ),
  CONSTRAINT model_steckbrief_links_identity_key UNIQUE (platform, email_normalized)
);

ALTER TABLE public.model_steckbrief_links ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.model_steckbrief_links FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.model_steckbrief_links TO authenticated;
GRANT ALL ON public.model_steckbrief_links TO service_role;

CREATE POLICY "Admins can manage model_steckbrief_links"
  ON public.model_steckbrief_links FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service role full access to model_steckbrief_links"
  ON public.model_steckbrief_links FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE TRIGGER update_model_steckbrief_links_updated_at
  BEFORE UPDATE ON public.model_steckbrief_links
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
