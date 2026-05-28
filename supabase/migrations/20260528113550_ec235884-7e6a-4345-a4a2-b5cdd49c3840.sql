UPDATE public.models SET platform = '4Based' WHERE platform = 'FansyMe';
ALTER TABLE public.models DROP CONSTRAINT models_platform_check;
ALTER TABLE public.models ADD CONSTRAINT models_platform_check
  CHECK (platform IN ('Maloum', 'Brezzels', '4Based'));