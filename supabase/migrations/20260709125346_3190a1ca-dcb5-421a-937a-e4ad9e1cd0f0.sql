CREATE TABLE public.hidden_upgrade_chatters (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  platform TEXT NOT NULL,
  chatter_key TEXT NOT NULL,
  original_name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform, chatter_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hidden_upgrade_chatters TO authenticated;
GRANT ALL ON public.hidden_upgrade_chatters TO service_role;

ALTER TABLE public.hidden_upgrade_chatters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own hidden upgrade chatters"
  ON public.hidden_upgrade_chatters
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX hidden_upgrade_chatters_user_platform_idx
  ON public.hidden_upgrade_chatters (user_id, platform);