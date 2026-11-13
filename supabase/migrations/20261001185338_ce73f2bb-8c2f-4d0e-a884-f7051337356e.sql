CREATE TYPE public.app_role AS ENUM ('admin', 'comercial', 'dho');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "Own roles readable" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- Contatos
CREATE TABLE public.contact_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  status text NOT NULL DEFAULT 'novo',
  nome text NOT NULL, empresa text, email text NOT NULL, whatsapp text NOT NULL,
  assunto text NOT NULL, mensagem text NOT NULL, origem text,
  utm jsonb NOT NULL DEFAULT '{}'::jsonb, internal_notes text
);
GRANT ALL ON public.contact_requests TO service_role;
GRANT SELECT, UPDATE ON public.contact_requests TO authenticated;
ALTER TABLE public.contact_requests ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.quote_requests ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(), ADD COLUMN updated_by uuid, ADD COLUMN internal_notes text;
ALTER TABLE public.job_applications ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(), ADD COLUMN updated_by uuid, ADD COLUMN internal_notes text;

GRANT SELECT, UPDATE ON public.quote_requests TO authenticated;
GRANT SELECT ON public.quote_request_items TO authenticated;
GRANT SELECT, UPDATE ON public.job_applications TO authenticated;

CREATE POLICY "Comercial reads quotes" ON public.quote_requests FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'comercial'));
CREATE POLICY "Comercial updates quotes" ON public.quote_requests FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'comercial'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'comercial'));
CREATE POLICY "Comercial reads quote items" ON public.quote_request_items FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'comercial'));
CREATE POLICY "Comercial reads contacts" ON public.contact_requests FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'comercial'));
CREATE POLICY "Comercial updates contacts" ON public.contact_requests FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'comercial'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'comercial'));
CREATE POLICY "DHO reads applications" ON public.job_applications FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'dho'));
CREATE POLICY "DHO updates applications" ON public.job_applications FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'dho'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'dho'));

CREATE POLICY "DHO reads resumes" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'curriculos' AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'dho')));

CREATE OR REPLACE FUNCTION public.touch_updated()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); NEW.updated_by = COALESCE(auth.uid(), NEW.updated_by); RETURN NEW; END $$;
CREATE TRIGGER t_quote_upd BEFORE UPDATE ON public.quote_requests FOR EACH ROW EXECUTE FUNCTION public.touch_updated();
CREATE TRIGGER t_contact_upd BEFORE UPDATE ON public.contact_requests FOR EACH ROW EXECUTE FUNCTION public.touch_updated();
CREATE TRIGGER t_app_upd BEFORE UPDATE ON public.job_applications FOR EACH ROW EXECUTE FUNCTION public.touch_updated();

-- Rate limiting (server-only)
CREATE TABLE public.rate_limits (
  key text PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  count int NOT NULL DEFAULT 0
);
GRANT ALL ON public.rate_limits TO service_role;
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.check_rate_limit(_key text, _max int, _window_seconds int)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.rate_limits;
BEGIN
  INSERT INTO public.rate_limits AS rl (key, window_start, count) VALUES (_key, now(), 1)
  ON CONFLICT (key) DO UPDATE SET
    count = CASE WHEN rl.window_start < now() - make_interval(secs => _window_seconds) THEN 1 ELSE rl.count + 1 END,
    window_start = CASE WHEN rl.window_start < now() - make_interval(secs => _window_seconds) THEN now() ELSE rl.window_start END
  RETURNING * INTO r;
  RETURN r.count <= _max;
END $$;
REVOKE EXECUTE ON FUNCTION public.check_rate_limit(text, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, int, int) TO service_role;