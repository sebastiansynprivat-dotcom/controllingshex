REVOKE ALL ON FUNCTION public.recompute_live_now() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_live_now() TO service_role, postgres;