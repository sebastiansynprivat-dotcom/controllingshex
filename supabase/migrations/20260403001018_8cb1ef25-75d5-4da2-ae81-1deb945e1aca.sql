ALTER TABLE public.chatter_history ADD COLUMN open_chats integer DEFAULT 0;
ALTER TABLE public.chatter_history ADD COLUMN response_delay_days integer DEFAULT 0;