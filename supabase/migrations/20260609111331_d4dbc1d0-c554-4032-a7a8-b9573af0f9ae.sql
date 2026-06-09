DROP FUNCTION IF EXISTS public.get_chatter_onboarding(text);

CREATE OR REPLACE FUNCTION public.get_chatter_onboarding(p_platform text)
 RETURNS TABLE(chatter_name text, onboarded_on date, report_day integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    chatter_name,
    MIN(analysis_date)::date AS onboarded_on,
    COUNT(DISTINCT analysis_date)::int AS report_day
  FROM public.chatter_history
  WHERE user_id = auth.uid()
    AND platform = p_platform
    AND chatter_name IS NOT NULL
    AND chatter_name <> ''
  GROUP BY chatter_name;
$function$;