import { Link } from "@tanstack/react-router";
import { usePublicSite, useSiteContent } from "./SiteContentProvider";
import { SITE_NAVIGATION } from "@/lib/site-content";
import { categories } from "@/data/catalog";
import type { SocialProfile } from "@/config/social";
import { Logo } from "./Header";
import { NetworkIcon } from "./Social";
import { unitMapUrl, unitPhoneLabel, type Unit } from "@/lib/units";

/** Perfis oficiais vêm da configuração de redes (painel); rede desligada ou sem endereço não aparece. */
export function Footer({ social = [], units }: { social?: SocialProfile[]; units?: Unit[] }) {
  const { site, whatsappUrl, hasWhatsapp } = usePublicSite();
  const { content } = useSiteContent();
  const showProducts = content.navigation.some((item) => item.id === "products" && item.enabled);
  const nav = content.navigation
    .filter((item) => item.enabled && item.id !== "products")
    .map((item) => ({
      ...item,
      href: SITE_NAVIGATION.find((entry) => entry.id === item.id)!.href,
    }));
  const h = "mb-3 text-sm font-semibold text-graphite-foreground";
  const l = "text-sm text-graphite-foreground/65 hover:text-graphite-foreground";
  return (
    <footer className="bg-graphite pb-24 text-graphite-foreground lg:pb-0">
      <div className="mx-auto max-w-7xl px-4 py-14 lg:px-6">
        <div
          className={`grid gap-10 md:grid-cols-2 ${showProducts ? "lg:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]" : "lg:grid-cols-[1.4fr_1fr_1fr_1fr]"}`}
        >
          <div>
            <div className="inline-block rounded-md bg-card p-3">
              <Logo className="h-10" />
            </div>
            <p className="mt-4 max-w-xs text-sm text-graphite-foreground/65">
              {content.general.footerText}
            </p>
            <div className="mt-5 flex gap-2">
              {social.map((profile) => (
                <a
                  key={profile.network}
                  href={profile.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`MAG no ${profile.label}`}
                  className="grid size-9 place-items-center rounded-md border border-graphite-foreground/15 hover:border-brand hover:text-brand"
                >
                  <NetworkIcon network={profile.network} />
                </a>
              ))}
              {social.length > 0 && (
                <Link
                  to="/redes"
                  className="flex items-center rounded-md border border-graphite-foreground/15 px-3 text-xs font-medium text-graphite-foreground/80 hover:border-brand hover:text-brand"
                >
                  Redes
                </Link>
              )}
            </div>
          </div>
          {showProducts && (
            <div>
              <p className={h}>Produtos</p>
              <ul className="space-y-2">
                {categories.slice(0, 7).map((c) => (
                  <li key={c.slug}>
                    <Link to="/categoria/$slug" params={{ slug: c.slug }} className={l}>
                      {c.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <p className={h}>MAG</p>
            <ul className="space-y-2">
              {nav.map((item) => (
                <li key={item.id}>
                  <Link to={item.href} className={l}>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className={h}>Atendimento</p>
            <ul className="space-y-2">
              <li>
                <a href={whatsappUrl()} className={l}>
                  {hasWhatsapp ? "WhatsApp" : "Fale com a MAG"}
                </a>
              </li>
              {site.phone && (
                <li>
                  <a href={`tel:${site.phone.replace(/[^+0-9]/g, "")}`} className={l}>
                    {site.phone}
                  </a>
                </li>
              )}
              {site.email && (
                <li>
                  <a href={`mailto:${site.email}`} className={l}>
                    {site.email}
                  </a>
                </li>
              )}
              {units === undefined && site.address && <li className={l}>{site.address}</li>}
              {units?.map((unit) => (
                <li key={unit.id} className="border-t border-graphite-foreground/15 pt-3">
                  <p className="mb-1 text-sm font-semibold">Unidade {unit.name}</p>
                  <a
                    href={unitMapUrl(unit)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={l}
                  >
                    {unit.address}
                  </a>
                  {unit.phone && (
                    <a href={`tel:+${unit.phone}`} className={`mt-1 block ${l}`}>
                      {unitPhoneLabel(unit.phone)}
                    </a>
                  )}
                  {unit.whatsapp && (
                    <a
                      href={`https://wa.me/${unit.whatsapp}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`mt-1 block ${l}`}
                    >
                      WhatsApp {unitPhoneLabel(unit.whatsapp)}
                    </a>
                  )}
                  {unit.hours && <p className={`mt-1 ${l}`}>{unit.hours}</p>}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className={h}>Empresa</p>
            <ul className="space-y-2">
              <li>
                <Link to="/privacidade" className={l}>
                  Política de Privacidade
                </Link>
              </li>
              <li>
                <Link to="/termos" className={l}>
                  Termos de Uso
                </Link>
              </li>
              <li>
                <Link to="/cookies" className={l}>
                  Cookies
                </Link>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => window.dispatchEvent(new Event("mag:open-cookies"))}
                  className={l}
                >
                  Preferências de cookies
                </button>
              </li>
              <li>
                <Link to="/privacidade" className={l}>
                  LGPD
                </Link>
              </li>
              <li>
                <Link to="/contato" className={l}>
                  Acessibilidade
                </Link>
              </li>
            </ul>
          </div>
        </div>
        <div className="mt-12 flex flex-col gap-2 border-t border-graphite-foreground/10 pt-6 text-xs text-graphite-foreground/50 md:flex-row md:justify-between">
          <p>
            © {new Date().getFullYear()} {site.name}
            {site.cnpj && ` · CNPJ ${site.cnpj}`}
          </p>
          {site.hours && <p>{site.hours}</p>}
        </div>
      </div>
    </footer>
  );
}
