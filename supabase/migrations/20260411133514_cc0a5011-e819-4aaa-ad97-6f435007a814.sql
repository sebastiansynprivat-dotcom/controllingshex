
ALTER TABLE public.chatter_history ADD COLUMN category text;
ALTER TABLE public.chatter_history ADD COLUMN recommendation text;

-- Remove duplicates before adding unique constraint (keep latest)
DELETE FROM public.chatter_history a
USING public.chatter_history b
WHERE a.id < b.id
  AND a.chatter_name = b.chatter_name
  AND a.platform = b.platform
  AND a.analysis_date = b.analysis_date;

ALTER TABLE public.chatter_history ADD CONSTRAINT unique_chatter_day UNIQUE (chatter_name, platform, analysis_date);
