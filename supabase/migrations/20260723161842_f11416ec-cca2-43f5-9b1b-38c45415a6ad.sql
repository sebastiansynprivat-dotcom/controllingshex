ALTER TABLE public.coaching_analyses
  ADD COLUMN IF NOT EXISTS xp_earned integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_card_index integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commitment_text text,
  ADD COLUMN IF NOT EXISTS boss_fight_result jsonb;