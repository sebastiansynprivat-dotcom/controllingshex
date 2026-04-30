-- Fix: Upload schreibt seit Tagen nicht mehr in chatter_history, weil der vorhandene
-- Unique-Index eine Expression (COALESCE(account,'')) nutzt und PostgREST onConflict
-- nur echte Spalten referenzieren kann. Wir ersetzen den Expression-Index durch
-- einen regulären Unique-Constraint auf den vier Spalten. NULL-Accounts werden
-- vorher zu '' normalisiert (so wie der App-Code es ohnehin tut).

UPDATE public.chatter_history SET account = '' WHERE account IS NULL;

-- Duplikate (sollte es nach dem Normalisieren keine geben, aber zur Sicherheit)
-- behalten den jüngsten Eintrag pro (chatter_name, account, platform, analysis_date).
DELETE FROM public.chatter_history a
USING public.chatter_history b
WHERE a.ctid < b.ctid
  AND a.chatter_name = b.chatter_name
  AND a.account = b.account
  AND a.platform = b.platform
  AND a.analysis_date = b.analysis_date;

ALTER TABLE public.chatter_history
  ALTER COLUMN account SET DEFAULT '',
  ALTER COLUMN account SET NOT NULL;

DROP INDEX IF EXISTS public.unique_chatter_day_account;

ALTER TABLE public.chatter_history
  ADD CONSTRAINT chatter_history_unique_day
  UNIQUE (chatter_name, account, platform, analysis_date);