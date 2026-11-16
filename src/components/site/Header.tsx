import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import {
  Search,
  ClipboardList,
  MessageCircle,
  Menu,
  ArrowUpRight,
} from "lucide-react";
import { useCatalog } from "./CatalogProvider";
import { ProductImage } from "./ProductImage";
import { categoryName } from "@/data/catalog";
import { suggest } from "@/lib/search";
import { useQuote } from "@/lib/quote";
import {
  usePublicSite,
  useSiteContent,
  usePublicSiteTheme,
} from "./SiteContentProvider";
import { SITE_NAVIGATION } from "@/lib/site-content";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import "./Editorial.css";

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
  const go = (term: string) =>
    navigate({ to: "/produtos", search: { q: term } });
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
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Buscas sugeridas
          </p>
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
          const empty =
            !s.products.length &&
            !s.categories.length &&
            !s.environments.length;
          const h =
            "px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
          const it =
            "flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-accent";
          return (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[70vh] overflow-y-auto rounded-md border bg-popover pb-2 shadow-card">
              {empty && (
                <p className="p-3 text-sm text-muted-foreground">
                  Nenhum resultado para “{q}”.
                </p>
              )}
              {s.products.length > 0 && <p className={h}>Produtos</p>}
              {s.products.map((p) => (
                <button
                  key={p.slug}
                  type="button"
                  onMouseDown={() =>
                    navigate({ to: "/produto/$slug", params: { slug: p.slug } })
                  }
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
                  onMouseDown={() =>
                    navigate({
                      to: "/categoria/$slug",
                      params: { slug: c.slug },
                    })
                  }
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
                  onMouseDown={() =>
                    navigate({
                      to: "/ambientes/$slug",
                      params: { slug: e.slug },
                    })
                  }
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
  const { content, preview } = useSiteContent();
  const themeStyle = usePublicSiteTheme();
  const { site, whatsappUrl, hasWhatsapp } = usePublicSite();
  const nav = content.navigation
    .filter((item) => item.enabled)
    .map((item) => ({
      ...item,
      to: SITE_NAVIGATION.find((entry) => entry.id === item.id)!.href,
    }));
  const { count } = useQuote();
  const home = useRouterState({
    select: (state) =>
      state.location.pathname === "/" ||
      (preview && state.location.pathname === "/site-preview"),
  });
  const locationKey = useRouterState({
    select: (state) => state.location.href,
  });
  const [scrolled, setScrolled] = useState(false);
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState(false);
  useEffect(() => {
    setSearch(false);
    setMenu(false);
  }, [locationKey]);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 40);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  const overlay =
    home &&
    content.home.hero.layout === "overlay" &&
    !(content.announcement.enabled && content.announcement.text);
  const transparent = overlay && !scrolled;
  return (
    <>
      {content.announcement.enabled && content.announcement.text && (
        <div className="site-announcement">
          <span>{content.announcement.text}</span>
          {content.announcement.href && (
            <a href={content.announcement.href}>
              {content.announcement.label || "Saiba mais"}
            </a>
          )}
        </div>
      )}
      <header
        className={[
          "mag-header",
          overlay ? "mag-header-home" : "",
          transparent ? "mag-header-transparent" : "mag-header-solid",
        ].join(" ")}
      >
        <div className="editorial-container mag-header-row">
          <Link
            to="/"
            aria-label={site.name + " — Início"}
            className="shrink-0"
          >
            <Logo className="h-10 lg:h-12 mag-header-logo" />
          </Link>
          <nav aria-label="Navegação institucional" className="mag-desktop-nav">
            {nav.map((item) => (
              <Link
                key={item.id}
                to={item.to}
                activeProps={{ className: "mag-nav-active" }}
                className="mag-nav-link"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="mag-header-actions">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Abrir busca de produtos"
              title="Buscar produtos"
              onClick={() => setSearch(true)}
              className="mag-header-tool"
            >
              <Search />
            </Button>
            <Button asChild variant="ghost" className="mag-header-tool px-2">
              <Link to="/orcamento" aria-label="Orçamento">
                <ClipboardList />
                <span className="hidden md:inline">Orçamento</span>
                {count > 0 && <span className="quote-count">{count}</span>}
              </Link>
            </Button>
            <a
              href={whatsappUrl()}
              target={hasWhatsapp ? "_blank" : undefined}
              rel="noopener noreferrer"
              className="editorial-button mag-header-contact"
            >
              <MessageCircle className="size-4" />
              {hasWhatsapp ? "WhatsApp" : "Atendimento"}
            </a>
            <Button
              variant="ghost"
              size="icon"
              className="mag-menu-trigger mag-header-tool"
              aria-label="Abrir menu"
              aria-expanded={menu}
              onClick={() => setMenu(true)}
            >
              <Menu />
            </Button>
          </div>
        </div>
      </header>
      <Sheet open={menu} onOpenChange={setMenu}>
        <SheetContent
          className="public-site mag-menu w-full sm:max-w-lg"
          style={themeStyle}
        >
          <SheetHeader>
            <SheetTitle>
              <Logo className="h-12" />
            </SheetTitle>
          </SheetHeader>
          <nav className="px-6 pb-10 pt-8" aria-label="Menu institucional">
            {nav.map((item, index) => (
              <Link
                key={item.id}
                to={item.to}
                onClick={() => setMenu(false)}
                className="mag-menu-link"
              >
                <span className="technical-label">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span>{item.label}</span>
                <ArrowUpRight className="ml-auto size-5" />
              </Link>
            ))}
            <Link
              to="/contato"
              onClick={() => setMenu(false)}
              className="editorial-button mt-8 w-full"
            >
              Falar com a MAG
              <ArrowUpRight />
            </Link>
          </nav>
        </SheetContent>
      </Sheet>
      <Sheet open={search} onOpenChange={setSearch}>
        <SheetContent
          side="top"
          className="public-site mag-search"
          style={themeStyle}
        >
          <SheetHeader>
            <SheetTitle className="text-3xl font-display">
              Encontrar mobiliário
            </SheetTitle>
          </SheetHeader>
          <div className="mx-auto w-full max-w-3xl px-6 pb-10">
            <SearchBox autoFocus />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
