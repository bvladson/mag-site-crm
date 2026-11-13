import { Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Search, ClipboardList, MessageCircle, Headset, ChevronDown } from "lucide-react";
import { useCatalog } from "./CatalogProvider";
import { ProductImage } from "./ProductImage";
import { megaMenu, categories, categoryName } from "@/data/catalog";
import { suggest } from "@/lib/search";
import { useQuote } from "@/lib/quote";
import { usePublicSite, useSiteContent } from "./SiteContentProvider";
import { SITE_NAVIGATION } from "@/lib/site-content";

const suggestions = [
  "Cadeira presidente",
  "Mesa executiva",
  "Cadeira telada",
  "Recepção",
  "Estação de trabalho",
];

export function SearchBox({
  autoFocus = false,
  compact = false,
}: {
  autoFocus?: boolean;
  compact?: boolean;
}) {
  const products = useCatalog();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [focus, setFocus] = useState(false);
  const go = (term: string) => navigate({ to: "/produtos", search: { q: term } });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    go(q.trim());
  };
  return (
    <form onSubmit={submit} className="relative w-full" role="search">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
      <input
        autoFocus={autoFocus}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setFocus(true)}
        onBlur={() => setTimeout(() => setFocus(false), 150)}
        placeholder="O que você está procurando?"
        aria-label="Buscar produtos"
        className={`w-full rounded-md border border-input bg-surface pl-11 pr-4 text-[15px] outline-none transition focus:border-foreground/40 focus:bg-card ${compact ? "h-11" : "h-12"}`}
      />
      {focus && !q && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border bg-popover p-3 shadow-card">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Buscas sugeridas</p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onMouseDown={() => go(s)}
                className="rounded-full border px-3 py-1 text-sm hover:border-brand hover:text-brand"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
      {focus &&
        q &&
        (() => {
          const s = suggest(q, products);
          if (!s) return null;
          const empty = !s.products.length && !s.categories.length && !s.environments.length;
          const h =
            "px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
          const it = "flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-accent";
          return (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[70vh] overflow-y-auto rounded-md border bg-popover pb-2 shadow-card">
              {empty && (
                <p className="p-3 text-sm text-muted-foreground">Nenhum resultado para “{q}”.</p>
              )}
              {s.products.length > 0 && <p className={h}>Produtos</p>}
              {s.products.map((p) => (
                <button
                  key={p.slug}
                  type="button"
                  onMouseDown={() => navigate({ to: "/produto/$slug", params: { slug: p.slug } })}
                  className={it}
                >
                  <ProductImage
                    src={p.image}
                    alt=""
                    className="size-9 rounded-sm bg-surface object-contain"
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{p.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {categoryName(p.category)}
                    </span>
                  </span>
                </button>
              ))}
              {s.categories.length > 0 && <p className={h}>Categorias</p>}
              {s.categories.map((c) => (
                <button
                  key={c.slug}
                  type="button"
                  onMouseDown={() => navigate({ to: "/categoria/$slug", params: { slug: c.slug } })}
                  className={it}
                >
                  {c.name}
                </button>
              ))}
              {s.environments.length > 0 && <p className={h}>Ambientes</p>}
              {s.environments.map((e) => (
                <button
                  key={e.slug}
                  type="button"
                  onMouseDown={() => navigate({ to: "/ambientes/$slug", params: { slug: e.slug } })}
                  className={it}
                >
                  {e.name}
                </button>
              ))}
              {!empty && (
                <button
                  type="button"
                  onMouseDown={() => go(q.trim())}
                  className={`${it} mt-1 border-t font-semibold text-brand`}
                >
                  Ver todos os resultados
                </button>
              )}
            </div>
          );
        })()}
    </form>
  );
}

export function Logo({ className = "h-10" }: { className?: string }) {
  const { site } = usePublicSite();
  return (
    <img
      src={site.logo}
      width={427}
      height={354}
      alt={site.name}
      className={`max-w-[180px] w-auto object-contain ${className}`}
    />
  );
}

export function Header() {
  const { content } = useSiteContent();
  const { whatsappUrl, hasWhatsapp } = usePublicSite();
  const nav = content.navigation
    .filter((item) => item.enabled)
    .map((item) => ({ ...item, to: SITE_NAVIGATION.find((entry) => entry.id === item.id)!.href }));
  const { count } = useQuote();
  const [mega, setMega] = useState(false);
  return (
    <>
      {content.announcement.enabled && content.announcement.text && (
        <div className="site-announcement">
          <span>{content.announcement.text}</span>
          {content.announcement.href && (
            <a href={content.announcement.href}>{content.announcement.label || "Saiba mais"}</a>
          )}
        </div>
      )}
      <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto grid max-w-7xl grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 px-4 py-3 lg:gap-8 lg:px-6">
          <Link to="/" aria-label="Início" className="shrink-0">
            <Logo className="h-9 lg:h-11" />
          </Link>
          <div className="hidden lg:block">
            <SearchBox />
          </div>
          <div className="flex items-center justify-end gap-1 lg:gap-2">
            <Link
              to="/contato"
              className="hidden items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent xl:flex"
            >
              <Headset className="size-4" /> Falar com consultor
            </Link>
            <Link
              to="/orcamento"
              className="relative flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent"
              aria-label="Orçamento"
            >
              <ClipboardList className="size-5" />
              <span className="hidden lg:inline">Orçamento</span>
              {count > 0 && (
                <span className="absolute -right-0.5 top-0.5 grid min-w-5 place-items-center rounded-full bg-brand px-1 text-[11px] font-semibold text-primary-foreground lg:static">
                  {count}
                </span>
              )}
            </Link>
            <a
              href={whatsappUrl()}
              target={hasWhatsapp ? "_blank" : undefined}
              rel="noreferrer"
              className="hidden items-center gap-2 rounded-md bg-success px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-success/90 lg:flex"
            >
              <MessageCircle className="size-4" /> {hasWhatsapp ? "WhatsApp" : "Atendimento"}
            </a>
          </div>
        </div>
        <div className="px-4 pb-3 lg:hidden">
          <SearchBox compact />
        </div>
        <nav className="relative hidden border-t lg:block" onMouseLeave={() => setMega(false)}>
          <ul className="mx-auto flex max-w-7xl flex-wrap items-center gap-1 px-6 text-sm font-medium">
            {nav.map((item) =>
              item.id === "products" ? (
                <li key={item.id}>
                  <button
                    onMouseEnter={() => setMega(true)}
                    onClick={() => setMega((value) => !value)}
                    aria-expanded={mega}
                    className={`flex items-center gap-1 border-b-2 px-3 py-3 ${mega ? "border-brand text-brand" : "border-transparent"}`}
                  >
                    {item.label}
                    <ChevronDown className="size-4" />
                  </button>
                </li>
              ) : (
                <li key={item.id}>
                  <Link
                    to={item.to}
                    className="block border-b-2 border-transparent px-3 py-3 hover:text-brand"
                    activeProps={{ className: "border-brand! text-brand" }}
                  >
                    {item.label}
                  </Link>
                </li>
              ),
            )}
          </ul>
          {mega && nav.some((item) => item.id === "products") && (
            <div className="absolute inset-x-0 top-full border-y bg-card shadow-card">
              <div className="mx-auto grid max-w-7xl grid-cols-[1fr_1fr_1fr_1.4fr] gap-8 px-6 py-8">
                {Object.entries(megaMenu).map(([group, list]) => (
                  <div key={group}>
                    <p className="eyebrow mb-3">{group}</p>
                    <ul className="space-y-1.5 text-sm">
                      {list.map((item) => (
                        <li key={item}>
                          <Link
                            to="/produtos"
                            search={{ q: item }}
                            onClick={() => setMega(false)}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            {item}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                <div className="grid grid-cols-2 gap-3">
                  {categories.slice(0, 4).map((c) => (
                    <Link
                      key={c.slug}
                      to="/categoria/$slug"
                      params={{ slug: c.slug }}
                      onClick={() => setMega(false)}
                      className="group overflow-hidden rounded-md bg-surface"
                    >
                      <img
                        src={c.image}
                        alt=""
                        loading="lazy"
                        className="aspect-[4/3] w-full object-cover transition group-hover:scale-[1.03]"
                      />
                      <p className="px-3 py-2 text-sm font-medium">{c.name}</p>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          )}
        </nav>
      </header>
    </>
  );
}
