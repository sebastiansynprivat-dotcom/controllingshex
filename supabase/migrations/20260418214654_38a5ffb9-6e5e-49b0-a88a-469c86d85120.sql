ALTER TABLE public.swap_decisions
  ADD COLUMN IF NOT EXISTS snoozed_until timestamp with time zone;

CREATE INDEX IF NOT EXISTS idx_swap_decisions_user_platform_snooze
  ON public.swap_decisions (user_id, platform, snoozed_until);