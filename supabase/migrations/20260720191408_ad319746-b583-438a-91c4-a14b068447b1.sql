CREATE OR REPLACE FUNCTION public.append_chats_to_request(p_id uuid, p_chats jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.chats_fetch_requests
  SET result_json = COALESCE(result_json, '[]'::jsonb) || COALESCE(p_chats, '[]'::jsonb),
      updated_at = now()
  WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.append_chats_to_request(uuid, jsonb) TO service_role;