-- Doppelschreiber entfernen: Trigger weg, Edge-Function bleibt einzige Quelle
DROP TRIGGER IF EXISTS record_live_activity_from_history_live_trg ON public.chatter_history_live;
DROP TRIGGER IF EXISTS trg_record_live_activity_from_history_live ON public.chatter_history_live;
DROP TRIGGER IF EXISTS record_live_activity_trg ON public.chatter_history_live;
DROP FUNCTION IF EXISTS public.record_live_activity_from_history_live() CASCADE;

-- Verseuchte Hourly-Stats der letzten 14 Tage löschen — sauberer Neustart
DELETE FROM public.chatter_hourly_stats WHERE date >= CURRENT_DATE - 14;