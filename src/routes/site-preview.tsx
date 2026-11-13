import { createFileRoute, redirect, useBlocker } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getCurrentUser } from "@/lib/auth.functions";
import { getSiteContentAdmin } from "@/lib/site-content-admin.functions";
import { siteContentSchema } from "@/lib/site-content";
import { listProducts, homeShowcase } from "@/lib/omie";
import { getSocialHome, getSocialProfiles } from "@/lib/social.functions";
import { getPublicUnits } from "@/lib/units.functions";
import { SiteContentProvider } from "@/components/site/SiteContentProvider";
import { CatalogProvider } from "@/components/site/CatalogProvider";
import { QuoteProvider } from "@/lib/quote";
import { Header } from "@/components/site/Header";
import { Footer } from "@/components/site/Footer";
import { MobileNav } from "@/components/site/MobileNav";
import { HomeContent } from "@/components/site/HomeContent";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "same-origin",
};
export const Route = createFileRoute("/site-preview")({
  beforeLoad: async () => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/interno/login", headers: privateHeaders });
    if (!user.roles.includes("admin")) throw redirect({ to: "/interno", headers: privateHeaders });
  },
  loader: async () => {
    const admin = await getSiteContentAdmin();
    const [products, showcase, social, profiles, units] = await Promise.all([
      listProducts(),
      homeShowcase(),
      getSocialHome(),
      getSocialProfiles(),
      getPublicUnits(),
    ]);
    return { content: admin.draft.content, products, showcase, social, profiles, units };
  },
  headers: () => privateHeaders,
  head: () => ({
    meta: [
      { title: "Prévia privada do site — MAG" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: SitePreview,
});

function SitePreview() {
  useBlocker({ shouldBlockFn: () => true, enableBeforeUnload: false });
  const data = Route.useLoaderData();
  const [content, setContent] = useState(data.content);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== window.parent ||
        event.data?.type !== "mag:site-preview"
      )
        return;
      const result = siteContentSchema.safeParse(event.data.content);
      if (result.success) setContent(result.data);
    };
    window.addEventListener("message", receive);
    if (window.parent !== window)
      window.parent.postMessage({ type: "mag:site-preview-ready" }, window.location.origin);
    return () => window.removeEventListener("message", receive);
  }, []);
  return (
    <SiteContentProvider content={content} preview>
      <CatalogProvider products={data.products}>
        <QuoteProvider>
          <div
            onClickCapture={(event) => {
              if (
                event.target instanceof Element &&
                event.target.closest(
                  "a[href], button[aria-label^='Adicionar '], .cms-social-list button",
                )
              ) {
                event.preventDefault();
                event.stopPropagation();
              }
            }}
            onMouseDownCapture={(event) => {
              if (
                event.target instanceof Element &&
                event.target.closest("form[role='search'] button")
              ) {
                event.preventDefault();
                event.stopPropagation();
              }
            }}
            onSubmitCapture={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            <Header />
            <main className="min-h-[60vh]">
              <HomeContent showcase={data.showcase} social={data.social} />
            </main>
            <Footer social={data.profiles} units={data.units} />
            <MobileNav />
          </div>
        </QuoteProvider>
      </CatalogProvider>
    </SiteContentProvider>
  );
}
