import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export type Consent = { essenciais: true; analytics: boolean; marketing: boolean; at: string };
const KEY = "mag-cookie-consent-v1";

export function getConsent(): Consent | null {
  if (typeof window === "undefined") return null;
  try { return JSON.parse(localStorage.getItem(KEY) ?? "null"); } catch { return null; }
}

/**
 * Banner LGPD. Pixels (Meta, TikTok, LinkedIn, GA) só devem ser carregados
 * escutando o evento "mag:consent" e checando analytics/marketing === true.
 */
export function CookieConsent() {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    if (!getConsent()) setOpen(true);
    const reopen = () => { setOpen(true); setCustom(true); };
    window.addEventListener("mag:open-cookies", reopen);
    return () => window.removeEventListener("mag:open-cookies", reopen);
  }, []);

  const save = (a: boolean, m: boolean) => {
    const c: Consent = { essenciais: true, analytics: a, marketing: m, at: new Date().toISOString() };
    localStorage.setItem(KEY, JSON.stringify(c));
    window.dispatchEvent(new CustomEvent("mag:consent", { detail: c }));
    setOpen(false);
  };

  if (!open) return null;
  return (
    <div role="dialog" aria-label="Preferências de cookies" className="fixed inset-x-3 bottom-20 z-50 mx-auto max-w-xl rounded-md border bg-card p-5 shadow-card lg:bottom-5">
      <p className="font-semibold">Sua privacidade</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Usamos cookies essenciais para o site funcionar e, com sua permissão, cookies de análise e marketing. Saiba mais na <Link to="/cookies" className="underline">Política de Cookies</Link>.
      </p>
      {custom && (
        <div className="mt-4 space-y-2 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked disabled /> Essenciais (sempre ativos)</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={analytics} onChange={(e) => setAnalytics(e.target.checked)} /> Análise (ex.: Google Analytics)</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} /> Marketing (Meta, TikTok, LinkedIn)</label>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => save(true, true)}>Aceitar todos</Button>
        <Button size="sm" variant="outline" onClick={() => save(false, false)}>Somente essenciais</Button>
        {custom ? (
          <Button size="sm" variant="ghost" onClick={() => save(analytics, marketing)}>Salvar escolhas</Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setCustom(true)}>Personalizar</Button>
        )}
      </div>
    </div>
  );
}
