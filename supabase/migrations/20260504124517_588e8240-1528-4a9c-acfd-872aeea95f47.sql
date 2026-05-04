ALTER TABLE public.chatter_history_live
ADD CONSTRAINT chatter_history_live_platform_chatter_date_key
UNIQUE (platform, chatter_name, date);