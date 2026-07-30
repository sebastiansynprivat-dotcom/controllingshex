ALTER TABLE public.ai_threads
  ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS super_prompt text,
  ADD COLUMN IF NOT EXISTS title_custom boolean NOT NULL DEFAULT false;