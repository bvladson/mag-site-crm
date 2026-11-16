import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  Home,
  LayoutGrid,
  Search,
  ClipboardList,
  MessageCircle,
  ChevronRight,
} from "lucide-react";
import { useQuote } from "@/lib/quote";
import {
  usePublicSite,
  useSiteContent,
  usePublicSiteTheme,
} from "./SiteContentProvider";
import { SITE_NAVIGATION } from "@/lib/site-content";
import { categories, showcaseCategories } from "@/data/catalog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

// Mobiliário primeiro; "Peças e reposição" no fim. "Outros" fica só nos filtros do catálogo.
const drawerCats = [
  ...showcaseCategories.map((category) => category.slug),
  "pecas",
];

export function MobileNav() {
  const themeStyle = usePublicSiteTheme();
  const { whatsappUrl, hasWhatsapp } = usePublicSite();
  const { content } = useSiteContent();
  const nav = content.navigation
    .filter((item) => item.enabled)
    .map((item) => ({
      ...item,
      href: SITE_NAVIGATION.find((entry) => entry.id === item.id)!.href,
    }));
  const showProducts = nav.some((item) => item.id === "products");
  const { count } = useQuote();
  const [open, setOpen] = useState(false);
  const item =
    "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-muted-foreground";
  const active = { className: "text-brand!" };
  const row =
    "flex items-center justify-between border-b py-3.5 text-base font-medium";
  return (
    <>
      <nav
        className="mag-mobile-nav fixed inset-x-0 bottom-0 z-40 flex border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
        aria-label="Navegação principal"
      >
        <Link
          to="/"
          className={item}
          activeProps={active}
          activeOptions={{ exact: true }}
        >
          <Home className="size-5" /> Início
        </Link>
        <button
          onClick={() => setOpen(true)}
          className={`${item} ${open ? "text-brand" : ""}`}
          aria-expanded={open}
        >
          <LayoutGrid className="size-5" />{" "}
          {showProducts ? "Categorias" : "Menu"}
        </button>
        {showProducts && (
          <Link to="/produtos" className={item} activeProps={active}>
            <Search className="size-5" /> Buscar
          </Link>
        )}
        <Link
          to="/orcamento"
          className={`${item} relative`}
          activeProps={active}
        >
          <ClipboardList className="size-5" /> Orçamento
          {count > 0 && (
            <span className="absolute right-[22%] top-1 grid min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] text-primary-foreground">
              {count}
            </span>
          )}
        </Link>
        <a
          href={whatsappUrl()}
          target={hasWhatsapp ? "_blank" : undefined}
          rel="noreferrer"
          className={`${item} text-success`}
        >
          <MessageCircle className="size-5" />{" "}
          {hasWhatsapp ? "WhatsApp" : "Contato"}
        </a>
      </nav>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          style={themeStyle}
          side="bottom"
          className="public-site mag-mobile-drawer max-h-[85vh] overflow-y-auto"
        >
          <SheetHeader>
            <SheetTitle>{showProducts ? "Categorias" : "Menu"}</SheetTitle>
          </SheetHeader>
          <ul className="px-4 pb-8">
            {showProducts &&
              drawerCats.map((slug) => {
                const c = categories.find((x) => x.slug === slug)!;
                return (
                  <li key={slug}>
                    <Link
                      to="/categoria/$slug"
                      params={{ slug }}
                      onClick={() => setOpen(false)}
                      className={row}
                    >
                      <span className="flex items-center gap-3">
                        <img
                          src={c.image}
                          alt=""
                          className="size-10 rounded-sm bg-surface object-cover"
                        />
                        {c.name}
                      </span>
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </Link>
                  </li>
                );
              })}
            {nav.map((entry) => (
              <li key={entry.id}>
                <Link
                  to={entry.href}
                  onClick={() => setOpen(false)}
                  className={row}
                >
                  {entry.label}
                  <ChevronRight className="size-4" />
                </Link>
              </li>
            ))}
          </ul>
        </SheetContent>
      </Sheet>
    </>
  );
}
