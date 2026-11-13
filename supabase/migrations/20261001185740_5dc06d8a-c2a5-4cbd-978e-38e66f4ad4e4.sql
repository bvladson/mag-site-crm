ALTER TABLE public.quote_requests ADD COLUMN protocolo text GENERATED ALWAYS AS (upper(left(id::text, 8))) STORED;
ALTER TABLE public.contact_requests ADD COLUMN protocolo text GENERATED ALWAYS AS (upper(left(id::text, 8))) STORED;
ALTER TABLE public.job_applications ADD COLUMN protocolo text GENERATED ALWAYS AS (upper(left(id::text, 8))) STORED;