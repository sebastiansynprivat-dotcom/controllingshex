ALTER TABLE public.ai_memories ADD COLUMN IF NOT EXISTS platform text;
CREATE INDEX IF NOT EXISTS ai_memories_user_platform_idx ON public.ai_memories (user_id, platform);
CREATE INDEX IF NOT EXISTS ai_threads_user_platform_idx ON public.ai_threads (user_id, platform);