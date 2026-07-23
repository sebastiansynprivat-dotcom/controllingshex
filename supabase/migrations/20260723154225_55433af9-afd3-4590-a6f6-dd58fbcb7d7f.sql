
ALTER TABLE public.coaching_analyses
  ADD COLUMN IF NOT EXISTS share_token text,
  ADD COLUMN IF NOT EXISTS progress_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

ALTER TABLE public.coaching_analyses ALTER COLUMN pdf_path DROP NOT NULL;

UPDATE public.coaching_analyses
SET share_token = encode(gen_random_bytes(16), 'hex')
WHERE share_token IS NULL;

ALTER TABLE public.coaching_analyses ALTER COLUMN share_token SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS coaching_analyses_share_token_idx
  ON public.coaching_analyses(share_token);
