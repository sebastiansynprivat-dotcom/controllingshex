REVOKE ALL ON FUNCTION public.cleanup_stale_live_for_latest_report(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_stale_live_after_report_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._roster_name_key(text) FROM PUBLIC, anon, authenticated;