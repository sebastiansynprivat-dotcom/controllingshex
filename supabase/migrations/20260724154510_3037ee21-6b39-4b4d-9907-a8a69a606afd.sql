
CREATE TABLE public.coaching_pending_memos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  audio_path TEXT NOT NULL,
  duration_ms INTEGER,
  consumed_at TIMESTAMPTZ,
  consumed_coaching_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX coaching_pending_memos_one_active_per_user
  ON public.coaching_pending_memos(user_id)
  WHERE consumed_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.coaching_pending_memos TO authenticated;
GRANT ALL ON public.coaching_pending_memos TO service_role;

ALTER TABLE public.coaching_pending_memos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner manages own pending memos"
  ON public.coaching_pending_memos
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_coaching_pending_memos_updated_at
  BEFORE UPDATE ON public.coaching_pending_memos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
