CREATE TABLE public.quote_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'novo',
  nome text NOT NULL, empresa text, cnpj text, whatsapp text NOT NULL, email text NOT NULL,
  cidade text NOT NULL, estado text NOT NULL, mensagem text,
  utm jsonb NOT NULL DEFAULT '{}'::jsonb, origem text
);
CREATE TABLE public.quote_request_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_request_id uuid NOT NULL REFERENCES public.quote_requests(id) ON DELETE CASCADE,
  sku text NOT NULL, slug text NOT NULL, name text NOT NULL, qty int NOT NULL CHECK (qty > 0)
);
CREATE TABLE public.job_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'recebida',
  job_slug text, job_title text, area_interesse text,
  nome text NOT NULL, email text NOT NULL, whatsapp text NOT NULL, cidade text,
  linkedin text, mensagem text, resume_path text,
  lgpd_consent boolean NOT NULL, lgpd_consent_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.quote_requests, public.quote_request_items, public.job_applications TO service_role;
ALTER TABLE public.quote_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_request_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_applications ENABLE ROW LEVEL SECURITY;