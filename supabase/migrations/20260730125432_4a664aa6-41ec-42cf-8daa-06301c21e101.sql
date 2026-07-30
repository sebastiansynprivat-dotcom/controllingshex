CREATE TABLE public.company_digests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform text NOT NULL,
  digest_date date NOT NULL,
  status text NOT NULL DEFAULT 'running',
  sections_json jsonb DEFAULT '[]'::jsonb,
  signals_json jsonb DEFAULT '[]'::jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform, digest_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_digests TO authenticated;
GRANT ALL ON public.company_digests TO service_role;

ALTER TABLE public.company_digests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own company digests"
ON public.company_digests
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.update_company_digests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_company_digests_updated_at
BEFORE UPDATE ON public.company_digests
FOR EACH ROW
EXECUTE FUNCTION public.update_company_digests_updated_at();