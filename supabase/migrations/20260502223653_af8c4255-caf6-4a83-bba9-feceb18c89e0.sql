CREATE OR REPLACE FUNCTION public.get_chatter_onboarding(p_platform text)
RETURNS TABLE (chatter_name text, onboarded_on date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT chatter_name, MIN(analysis_date)::date AS onboarded_on
  FROM public.chatter_history
  WHERE user_id = auth.uid()
    AND platform = p_platform
    AND chatter_name IS NOT NULL
    AND chatter_name <> ''
  GROUP BY chatter_name;
$$;