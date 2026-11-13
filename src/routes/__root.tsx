import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Header } from "@/components/site/Header";
import { Footer } from "@/components/site/Footer";
import { MobileNav } from "@/components/site/MobileNav";
import { QuoteProvider } from "@/lib/quote";
import { Toaster } from "@/components/ui/sonner";
import { CookieConsent } from "@/components/site/CookieConsent";
import { captureUtm } from "@/lib/utm";
import { listProducts } from "@/lib/omie";
import { getSocialProfiles } from "@/lib/social.functions";
import { CatalogProvider } from "@/components/site/CatalogProvider";
import { jsonLd } from "@/lib/seo";
import { getPublicUnits } from "@/lib/units.functions";
import { getPublicSiteContent } from "@/lib/site-content.functions";
import { defaultSiteContent } from "@/lib/site-content";
import { SiteContentProvider } from "@/components/site/SiteContentProvider";

function NotFoundComponent() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-4 text-center">
      <p className="eyebrow">Erro 404</p>
      <h1 className="mt-3 text-5xl font-semibold">Esta página saiu do lugar.</h1>
      <p className="mt-3 text-muted-foreground">
        O endereço não existe ou foi movido. Que tal procurar o produto certo?
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Link
          to="/produtos"
          className="rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
        >
          Ver produtos
        </Link>
        <Link to="/" className="rounded-md border px-5 py-2.5 text-sm font-semibold">
          Voltar ao início
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Esta página não carregou
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Algo deu errado. Tente novamente ou volte ao início.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Tentar novamente
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium"
          >
            Início
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  // Índice leve do catálogo e perfis oficiais das redes, carregados uma vez por visita.
  loader: async ({ location, context }) => {
    // A árvore de links não depende do catálogo: o visitante vem para contato rápido.
    if (/^\/(?:links|interno|site-preview)(?:\/|$)/.test(location.pathname))
      return { products: [], social: [], units: [], publication: null };
    const [layout, publication] = await Promise.all([
      context.queryClient.ensureQueryData({
        queryKey: ["public", "site-layout"],
        staleTime: 60_000,
        queryFn: async () => {
          const [products, social, units] = await Promise.all([
            listProducts(),
            getSocialProfiles(),
            getPublicUnits(),
          ]);
          return { products, social, units };
        },
      }),
      getPublicSiteContent(),
    ]);
    return { ...layout, publication };
  },
  // Alternar /links/ e catálogo troca os dados do layout; a query acima evita consultas repetidas entre produtos.
  shouldReload: true,
  head: ({ loaderData }) => {
    const content = loaderData?.publication?.content ?? defaultSiteContent();
    const absolute = (path: string) => new URL(path, "https://magmoveiscorporativos.com.br").href;
    return {
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title: content.seo.title },
        {
          name: "description",
          content: content.seo.description,
        },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "theme-color", content: content.appearance.brandColor },
        { property: "og:site_name", content: content.general.name },
        { property: "og:title", content: content.seo.title },
        { property: "og:description", content: content.seo.description },
        { property: "og:locale", content: "pt_BR" },
        { property: "og:image", content: absolute(content.seo.image || content.general.logo) },
      ],
      scripts: [
        {
          type: "application/ld+json",
          children: jsonLd({
            "@context": "https://schema.org",
            "@type": "Organization",
            name: content.general.name,
            slogan: content.general.tagline,
            url: "https://magmoveiscorporativos.com.br",
            logo: absolute(content.general.logo),
            ...(loaderData?.social.length
              ? { sameAs: loaderData.social.map((profile) => profile.url) }
              : {}),
          }),
        },
      ],
      links: [
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:ital,wght@0,500;0,600;0,700;1,600;1,700&display=swap",
        },
        { rel: "stylesheet", href: appCss },
        {
          rel: "icon",
          type: content.general.favicon.endsWith(".webp") ? "image/webp" : "image/png",
          href: content.general.favicon,
        },
      ],
    };
  },
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  const internal = useRouterState({
    select: (s) => /^\/interno(?:\/|$)/.test(s.location.pathname),
  });
  return (
    <html lang="pt-BR">
      <head>
        <HeadContent />
      </head>
      <body data-mag-internal={internal ? "true" : undefined}>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const { products, social, units, publication } = Route.useLoaderData();
  useEffect(() => {
    captureUtm();
  }, []);
  const compact = useRouterState({
    select: (s) =>
      s.location.pathname.startsWith("/interno") ||
      /^\/(?:links|site-preview)(?:\/|$)/.test(s.location.pathname),
  });
  if (compact) {
    return (
      <QueryClientProvider client={queryClient}>
        <Outlet />
        <Toaster position="top-center" />
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <SiteContentProvider content={publication?.content ?? defaultSiteContent()}>
        <CatalogProvider products={products}>
          <QuoteProvider>
            <Header />
            <main className="min-h-[60vh]">
              <Outlet />
            </main>
            <Footer social={social} units={units} />
            <MobileNav />
            <Toaster position="top-center" />
            <CookieConsent />
          </QuoteProvider>
        </CatalogProvider>
      </SiteContentProvider>
    </QueryClientProvider>
  );
}
