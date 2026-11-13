import { Link } from "@tanstack/react-router";
import { createContext, useContext, useState, type ReactNode } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Building2,
  Layers,
  RefreshCw,
  GraduationCap,
  MessagesSquare,
  HeartHandshake,
  Compass,
  Wrench,
  TrendingUp,
  Quote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Section, SectionHeader } from "@/components/site/Section";
import { ProductCard } from "@/components/site/ProductCard";
import { SearchBox } from "@/components/site/Header";
import { PostCard } from "@/components/site/PostCard";
import {
  categories,
  showcaseCategories,
  environments,
  cases,
  posts,
  images,
  testimonials,
  clientLogos,
  type ProductSummary,
} from "@/data/catalog";
import { usePublicSite, useSiteContent } from "./SiteContentProvider";
import { siteImageUrl, type SiteSection, type SiteBanner } from "@/lib/site-content";
import { isInLinkSchedule } from "@/lib/links";
import { useCatalog } from "@/components/site/CatalogProvider";
import { FollowLinks, SocialGrid } from "@/components/site/Social";
import type { SocialItem, SocialProfile } from "@/config/social";

export type HomeContentProps = {
  showcase: { ready: string[]; featured: string[] };
  social: { profiles: SocialProfile[]; videos: SocialItem[]; others: SocialItem[] };
};
export function HomeContent({ showcase, social }: HomeContentProps) {
  const products = useCatalog();
  const { content } = useSiteContent();
  // Vitrine: só mobiliário, alternando categorias e preferindo foto + estoque — ordem calculada no servidor.
  const bySlug = new Map(products.map((p) => [p.slug, p]));
  const pick = (slugs: string[]) =>
    slugs.map((slug) => bySlug.get(slug)).filter((p): p is ProductSummary => Boolean(p));
  const ready = pick(showcase.ready);
  const featured = pick(showcase.featured);
  const render = (section: SiteSection) => {
    switch (section.id) {
      case "categories":
        return <Categories />;
      case "ready":
        return ready.length ? <Products products={ready} /> : null;
      case "featured":
        return featured.length ? <Products products={featured} /> : null;
      case "environments":
        return <Environments />;
      case "project":
        return <CorporateProject />;
      case "solutions":
        return <Solutions />;
      case "banners":
        return content.home.banners.some((banner) =>
          isInLinkSchedule({
            active: banner.enabled,
            startsAt: banner.startsAt,
            endsAt: banner.endsAt,
          }),
        ) ? (
          <Campaigns />
        ) : null;
      case "cases":
        return cases.length ? <Cases /> : null;
      case "clients":
        return clientLogos.length ? <Clients /> : null;
      case "stats":
        return content.home.stats.some((entry) => entry.value) ? <Stats /> : null;
      case "social":
        return social.profiles.length || social.videos.length || social.others.length ? (
          <SocialHome data={social} />
        ) : null;
      case "people":
        return <People />;
      case "blog":
        return posts.length ? <Blog /> : null;
      case "testimonials":
        return testimonials.length ? <Testimonials /> : null;
      case "cta":
        return <FinalCta />;
    }
  };
  return (
    <>
      <Hero />
      {content.home.sections
        .filter((section) => section.enabled)
        .map((section) => {
          const element =
            render(section) ??
            (section.image ? (
              <Section tone={section.tone === "dark" ? "graphite" : section.tone}>
                <SectionHeader
                  title={section.title}
                  eyebrow={section.eyebrow}
                  text={section.text}
                />
              </Section>
            ) : null);
          if (!element) return null;
          return (
            <SectionContext.Provider key={section.id} value={section}>
              <div
                id={`home-${section.id}`}
                className="cms-home-section"
                data-site-section={section.id}
                data-tone={section.tone}
                data-layout={section.layout}
              >
                {!["project", "people", "cta"].includes(section.id) && section.image && (
                  <div className="mx-auto max-w-7xl px-4 pt-8 lg:px-6">
                    <SiteResponsiveImage
                      image={section.image}
                      alt={section.imageAlt}
                      className="mx-auto max-h-[32rem] w-full rounded-md object-contain"
                    />
                  </div>
                )}
                {element}
                {section.buttonLabel &&
                  section.buttonHref &&
                  !["project", "cta"].includes(section.id) && (
                    <div className="mx-auto max-w-7xl px-4 pb-8 lg:px-6">
                      <Button asChild>
                        <SiteAction href={section.buttonHref}>
                          {section.buttonLabel}
                          <ArrowRight />
                        </SiteAction>
                      </Button>
                    </div>
                  )}
              </div>
            </SectionContext.Provider>
          );
        })}
    </>
  );
}

const SectionContext = createContext<SiteSection | null>(null);
function useSection() {
  const section = useContext(SectionContext);
  if (!section) throw new Error("Seção do site ausente");
  return section;
}
export function SiteAction({
  href,
  children,
  className = "",
  ...props
}: {
  href: string;
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <a
      href={href}
      className={className}
      {...props}
      {...(/^https:\/\//.test(href) ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {children}
    </a>
  );
}
export function SiteResponsiveImage({
  image,
  mobileImage,
  fallback,
  alt,
  className = "",
  pictureClassName = "",
  eager = false,
  fit,
}: {
  image?: string | null;
  mobileImage?: string | null;
  fallback?: string;
  alt: string;
  className?: string;
  pictureClassName?: string;
  eager?: boolean;
  fit?: "natural" | "cover";
}) {
  const { preview } = useSiteContent();
  const src = siteImageUrl(image, preview) || fallback;
  if (!src) return null;
  return (
    <picture className={pictureClassName}>
      {mobileImage && (
        <source media="(max-width: 639px)" srcSet={siteImageUrl(mobileImage, preview)} />
      )}
      <img
        src={src}
        alt={alt}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        className={className}
        data-fit={fit}
      />
    </picture>
  );
}
function Products({ products }: { products: ProductSummary[] }) {
  const section = useSection();
  const featured = section.id === "featured";
  return (
    <Section tone={section.tone === "dark" ? "graphite" : section.tone}>
      <SectionHeader
        eyebrow={section.eyebrow}
        title={section.title}
        text={section.text}
        action={<ViewAll label={featured ? "Ver todos os produtos" : "Ver todos"} />}
      />
      <div
        data-site-list
        className={
          featured
            ? "scroll-row -mx-4 gap-3 px-4 pb-2 sm:gap-4"
            : "grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4"
        }
      >
        {products.map((product) => (
          <div
            key={product.slug}
            className={featured ? "w-[46%] sm:w-[31%] lg:w-[23.5%]" : "min-w-0"}
          >
            <ProductCard product={product} />
          </div>
        ))}
      </div>
    </Section>
  );
}

function ViewAll({ label = "Ver todos" }: { label?: string }) {
  return (
    <Link
      to="/produtos"
      className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline"
    >
      {label} <ArrowRight className="size-4" />
    </Link>
  );
}

function Hero() {
  const { content } = useSiteContent();
  const hero = content.home.hero;
  const centered = hero.align === "center";
  const quick = ["cadeiras", "mesas", "estacoes", "recepcao", "armazenamento"];
  const copy = (
    <div className={`site-hero-copy flex flex-col ${centered ? "items-center text-center" : ""}`}>
      {hero.eyebrow && <p className="eyebrow mb-3">{hero.eyebrow}</p>}
      <h1 className="max-w-3xl text-[2.4rem] font-semibold leading-[0.95] tracking-tight sm:text-5xl lg:text-[4.25rem]">
        {hero.title}
      </h1>
      {hero.text && <p className="mt-4 max-w-md text-muted-foreground lg:text-lg">{hero.text}</p>}
      {hero.layout === "split" && (
        <>
          <div className="mt-6 hidden w-full max-w-md lg:block">
            <SearchBox />
          </div>
          <div className={`mt-4 flex flex-wrap gap-2 ${centered ? "justify-center" : ""}`}>
            {quick.map((slug) => {
              const category = categories.find((entry) => entry.slug === slug);
              return category ? (
                <Link
                  key={slug}
                  to="/categoria/$slug"
                  params={{ slug }}
                  className="rounded-full border bg-card px-3.5 py-1.5 text-sm font-medium hover:border-brand hover:text-brand"
                >
                  {category.name}
                </Link>
              ) : null;
            })}
          </div>
        </>
      )}
      <div className={`mt-6 flex flex-col gap-2 sm:flex-row ${centered ? "justify-center" : ""}`}>
        {hero.primaryLabel && hero.primaryHref && (
          <Button asChild size="lg">
            <SiteAction href={hero.primaryHref}>
              {hero.primaryLabel}
              <ArrowRight />
            </SiteAction>
          </Button>
        )}
        {hero.secondaryLabel && hero.secondaryHref && (
          <Button asChild size="lg" variant="outline">
            <SiteAction
              href={hero.secondaryHref}
              className={hero.layout === "overlay" ? "bg-card text-card-foreground" : ""}
            >
              {hero.secondaryLabel}
            </SiteAction>
          </Button>
        )}
      </div>
    </div>
  );
  const image = (
    <SiteResponsiveImage
      image={hero.desktopImage}
      mobileImage={hero.mobileImage}
      fallback={images.heroOffice}
      alt={hero.imageAlt}
      eager
      className={
        hero.layout === "banner" && hero.imageFit === "contain"
          ? "site-natural-hero"
          : `${hero.imageFit === "contain" ? "object-contain" : "object-cover"} ${hero.layout === "split" ? "aspect-[16/11] w-full rounded-md lg:aspect-[16/12]" : hero.layout === "banner" ? "aspect-[16/6] w-full max-sm:aspect-[4/3]" : ""}`
      }
    />
  );
  if (hero.layout === "overlay")
    return (
      <section className="site-hero-overlay text-white">
        {image}
        <div className={`mx-auto max-w-7xl px-4 lg:px-6 ${centered ? "flex justify-center" : ""}`}>
          {copy}
        </div>
      </section>
    );
  if (hero.layout === "banner")
    return (
      <section className="overflow-hidden border-b bg-surface">
        {image}
        <div
          className={`mx-auto flex max-w-7xl flex-col px-4 py-8 lg:px-6 lg:py-12 ${centered ? "items-center" : ""}`}
        >
          {copy}
        </div>
      </section>
    );
  return (
    <section className="relative overflow-hidden border-b bg-surface">
      <div className="mx-auto grid max-w-7xl gap-6 px-4 pb-8 pt-5 lg:grid-cols-12 lg:gap-10 lg:px-6 lg:pb-14 lg:pt-12">
        <div className="order-2 flex flex-col justify-center lg:order-1 lg:col-span-5">{copy}</div>
        <div className="relative order-1 lg:order-2 lg:col-span-7">
          {image}
          {!hero.desktopImage && (
            <Link
              to="/ambientes/$slug"
              params={{ slug: "diretoria" }}
              className="absolute bottom-3 left-3 flex items-center gap-3 rounded-md bg-card/95 px-4 py-3 shadow-card backdrop-blur hover:bg-card"
            >
              <span>
                <span className="block text-[11px] uppercase tracking-wider text-muted-foreground">
                  Ambiente
                </span>
                <span className="text-sm font-semibold">Diretoria</span>
              </span>
              <ArrowUpRight className="size-4 text-brand" />
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}

/** Um de cada categoria por vez, mantendo a ordem de relevância dentro de cada uma. */

function Categories() {
  const section = useSection();
  return (
    <Section tone={section.tone === "dark" ? "graphite" : section.tone}>
      <SectionHeader eyebrow={section.eyebrow} title={section.title} text={section.text} />
      <div
        data-site-list
        className="scroll-row -mx-4 gap-3 px-4 md:mx-0 md:grid md:grid-cols-4 md:gap-4 md:overflow-visible md:px-0"
      >
        {showcaseCategories.map((c) => (
          <Link
            key={c.slug}
            to="/categoria/$slug"
            params={{ slug: c.slug }}
            className="group w-[40%] overflow-hidden rounded-md border bg-card sm:w-[28%] md:w-auto"
          >
            <div className="aspect-[4/3] overflow-hidden bg-surface">
              <img
                src={c.image}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.05]"
              />
            </div>
            <div className="flex items-center justify-between px-3 py-3">
              <span className="text-sm font-semibold">{c.name}</span>
              <ArrowUpRight className="size-4 text-muted-foreground transition group-hover:text-brand" />
            </div>
          </Link>
        ))}
      </div>
    </Section>
  );
}

function Environments() {
  const section = useSection();
  const [main, ...rest] = environments;
  return (
    <Section tone={section.tone === "dark" ? "graphite" : section.tone}>
      <SectionHeader
        eyebrow={section.eyebrow}
        title={section.title}
        text={section.text}
        action={
          <Link
            to="/ambientes"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand"
          >
            Todos os ambientes <ArrowRight className="size-4" />
          </Link>
        }
      />
      <div
        data-site-list
        className="scroll-row -mx-4 gap-3 px-4 md:mx-0 md:grid md:grid-cols-4 md:grid-rows-[repeat(3,minmax(0,200px))] md:gap-4 md:overflow-visible md:px-0 lg:grid-rows-[repeat(3,minmax(0,230px))]"
      >
        {[main!, ...rest.slice(0, 5)].map((e, i) => (
          <Link
            key={e.slug}
            to="/ambientes/$slug"
            params={{ slug: e.slug }}
            className={`group relative w-[78%] shrink-0 overflow-hidden rounded-md md:w-auto ${i === 0 ? "md:col-span-2 md:row-span-3" : i === 1 ? "md:col-span-2" : ""}`}
          >
            <img
              src={e.image}
              alt=""
              loading="lazy"
              className={`aspect-[4/5] h-full w-full object-cover transition ${e.slug === "recepcao" ? "object-[20%_70%]" : ""} duration-700 group-hover:scale-[1.04] md:aspect-auto`}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-graphite/85 via-graphite/5 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4 text-graphite-foreground lg:p-6">
              <div>
                {i === 0 && (
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-graphite-foreground/75">
                    Ambiente em destaque
                  </p>
                )}
                <h3
                  className={`font-semibold leading-none ${i === 0 ? "text-4xl lg:text-5xl" : "text-2xl"}`}
                >
                  {e.name}
                </h3>
                <p
                  className={`mt-2 text-sm text-graphite-foreground/80 ${i === 0 ? "max-w-sm lg:text-base" : "line-clamp-1"}`}
                >
                  {e.tagline}
                </p>
              </div>
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-card text-foreground transition group-hover:bg-brand group-hover:text-primary-foreground">
                <ArrowUpRight className="size-4" />
              </span>
            </div>
          </Link>
        ))}
      </div>
    </Section>
  );
}

function CorporateProject() {
  const section = useSection();
  const steps = [
    "Entendemos sua necessidade",
    "Avaliamos o ambiente",
    "Indicamos as soluções",
    "Fornecemos e montamos",
  ];
  return (
    <section className="bg-graphite text-graphite-foreground">
      <div className="relative">
        <SiteResponsiveImage
          image={section.image}
          fallback={images.projeto}
          alt={section.imageAlt || "Equipe MAG montando estações de trabalho"}
          className="h-[340px] w-full object-cover sm:h-[440px] lg:h-[560px]"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-graphite via-graphite/70 to-transparent" />
        <div className="absolute inset-0">
          <div className="mx-auto flex h-full max-w-7xl flex-col justify-end px-4 pb-8 lg:justify-center lg:px-6 lg:pb-0">
            <p className="eyebrow mb-3">{section.eyebrow}</p>
            <h2 className="max-w-xl text-4xl font-semibold leading-[0.98] lg:text-6xl">
              {section.title}
            </h2>
            <p className="mt-4 max-w-md text-graphite-foreground/80 lg:text-lg">{section.text}</p>
            {section.buttonLabel && section.buttonHref && (
              <Button asChild size="lg" className="mt-6 w-fit">
                <SiteAction href={section.buttonHref}>
                  {section.buttonLabel} <ArrowRight />
                </SiteAction>
              </Button>
            )}
          </div>
        </div>
      </div>
      <ol className="mx-auto grid max-w-7xl grid-cols-2 border-graphite-foreground/10 px-4 lg:grid-cols-4 lg:px-6">
        {steps.map((s, i) => (
          <li
            key={s}
            className="flex flex-col gap-2 border-t border-graphite-foreground/10 py-6 pr-4 lg:border-l lg:border-t-0 lg:px-6 lg:py-9 lg:first:border-l-0 lg:first:pl-0"
          >
            <span className="font-display text-3xl font-semibold text-brand">0{i + 1}</span>
            <span className="text-sm font-medium lg:text-base">{s}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Solutions() {
  const section = useSection();
  const items = [
    { icon: Building2, t: "Compra corporativa", d: "Atendimento para demandas em volume." },
    { icon: Layers, t: "Projetos completos", d: "Do planejamento ao mobiliário." },
    { icon: RefreshCw, t: "Renovação de ambientes", d: "Modernização de escritórios existentes." },
    { icon: GraduationCap, t: "Mobiliário escolar", d: "Soluções para instituições de ensino." },
    {
      icon: MessagesSquare,
      t: "Atendimento consultivo",
      d: "Ajuda para escolher os produtos adequados.",
    },
  ];
  return (
    <Section tone={section.tone === "dark" ? "graphite" : section.tone}>
      <SectionHeader
        eyebrow={section.eyebrow}
        title={section.title}
        text={section.text}
        action={
          <Link
            to="/empresas"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand"
          >
            Conhecer soluções corporativas <ArrowRight className="size-4" />
          </Link>
        }
      />
      <div data-site-list className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {items.map(({ icon: Icon, t, d }) => (
          <div key={t} className="rounded-md border bg-card p-5">
            <Icon className="size-6 text-brand" />
            <h3 className="mt-4 text-lg font-semibold">{t}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{d}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Campaigns() {
  const { content } = useSiteContent();
  const section = useSection();
  const banners = content.home.banners.filter((banner) =>
    isInLinkSchedule({ active: banner.enabled, startsAt: banner.startsAt, endsAt: banner.endsAt }),
  );
  if (!banners.length) return null;
  return (
    <section className="py-4 lg:py-6">
      <div className="mx-auto max-w-7xl px-4 lg:px-6">
        {(section.eyebrow || section.title || section.text) && (
          <SectionHeader eyebrow={section.eyebrow} title={section.title} text={section.text} />
        )}
      </div>
      {banners.map((banner) => (
        <Banner key={banner.id} banner={banner} />
      ))}
    </section>
  );
}
function Banner({ banner }: { banner: SiteBanner }) {
  const image = (
    <SiteResponsiveImage
      image={banner.image}
      mobileImage={banner.mobileImage}
      alt={banner.alt}
      className="site-banner-image"
      fit={banner.fit}
    />
  );
  return (
    <article
      className={`site-banner ${banner.width === "contained" ? "mx-auto max-w-7xl px-4 lg:px-6" : "w-full"}`}
    >
      <div
        className={`overflow-hidden ${banner.width === "contained" ? "rounded-md border" : ""} ${banner.tone === "dark" ? "bg-graphite text-graphite-foreground" : "bg-card text-card-foreground"}`}
      >
        {banner.href && !banner.buttonLabel ? (
          <SiteAction
            href={banner.href}
            aria-label={banner.title || banner.alt || "Conheça a campanha"}
          >
            {image}
          </SiteAction>
        ) : (
          image
        )}
        {(banner.eyebrow || banner.title || banner.text || (banner.href && banner.buttonLabel)) && (
          <div
            className={`mx-auto max-w-7xl p-6 lg:p-10 ${banner.align === "center" ? "text-center" : ""}`}
          >
            {banner.eyebrow && <p className="eyebrow mb-2">{banner.eyebrow}</p>}
            {banner.title && <h2 className="text-3xl font-semibold lg:text-5xl">{banner.title}</h2>}
            {banner.text && <p className="mt-3 whitespace-pre-line">{banner.text}</p>}
            {banner.href && banner.buttonLabel && (
              <Button asChild className="mt-5">
                <SiteAction href={banner.href}>
                  {banner.buttonLabel}
                  <ArrowRight />
                </SiteAction>
              </Button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function Cases() {
  const section = useSection();
  const [view, setView] = useState<"result" | "before">("result");
  return (
    <Section tone={section.tone === "dark" ? "graphite" : section.tone}>
      <SectionHeader
        eyebrow={section.eyebrow}
        title={section.title}
        text={section.text}
        action={
          <div className="flex rounded-md border p-1 text-sm">
            {(["before", "result"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded px-3 py-1.5 font-medium ${view === v ? "bg-graphite text-graphite-foreground" : "text-muted-foreground"}`}
              >
                {v === "before" ? "Projeto" : "Resultado"}
              </button>
            ))}
          </div>
        }
      />
      <div
        data-site-list
        className="scroll-row -mx-4 gap-4 px-4 md:mx-0 md:grid md:grid-cols-3 md:px-0"
      >
        {cases.map((c) => (
          <Link
            key={c.slug}
            to="/projetos/$slug"
            params={{ slug: c.slug }}
            className="group w-[85%] md:w-auto"
          >
            <div className="overflow-hidden rounded-md">
              <img
                src={view === "result" ? c.image : c.before}
                alt=""
                loading="lazy"
                className="aspect-[4/3] w-full object-cover transition duration-500 group-hover:scale-[1.03]"
              />
            </div>
            <p className="mt-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {c.type} · {c.city}
            </p>
            <h3 className="mt-1 text-xl font-semibold">{c.company}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{c.summary}</p>
          </Link>
        ))}
      </div>
      <div className="mt-8">
        <Button asChild variant="outline">
          <Link to="/projetos">
            Conheça nossos projetos <ArrowRight />
          </Link>
        </Button>
      </div>
    </Section>
  );
}

function Clients() {
  const section = useSection();
  return (
    <section className="border-y py-10">
      <div className="mx-auto max-w-7xl px-4 lg:px-6">
        <SectionHeader eyebrow={section.eyebrow} title={section.title} text={section.text} />
        <div className="mt-6 grid grid-cols-3 gap-3 md:grid-cols-6">
          {clientLogos.map((c) => (
            <div key={c.name} className="grid h-14 place-items-center rounded-md border">
              <img src={c.logo} alt={c.name} className="max-h-8 w-auto" loading="lazy" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Stats() {
  const section = useSection();
  const { content } = useSiteContent();
  return (
    <Section
      tone={section.tone === "dark" ? "graphite" : section.tone}
      className="py-10! lg:py-14!"
    >
      {(section.eyebrow || section.title || section.text) && (
        <SectionHeader eyebrow={section.eyebrow} title={section.title} text={section.text} />
      )}
      <div data-site-list className="grid grid-cols-2 gap-6 lg:grid-cols-4">
        {content.home.stats
          .filter((s) => s.value)
          .map((s, index) => (
            <div key={`${s.label}-${index}`} className="border-l-2 border-brand pl-4">
              <p className="font-display text-4xl font-semibold lg:text-5xl">{s.value}</p>
              <p className="mt-1 text-sm text-muted-foreground">{s.label}</p>
            </div>
          ))}
      </div>
    </Section>
  );
}

/** "MAG nas redes": seleção curta (até 3 vídeos + 3 itens). Sem conteúdo, só os perfis; sem perfil, nada. */
function SocialHome({
  data,
}: {
  data: { profiles: SocialProfile[]; videos: SocialItem[]; others: SocialItem[] };
}) {
  const section = useSection();
  const items = [...data.videos, ...data.others];
  if (!items.length && !data.profiles.length) return null;
  return (
    <Section tone={section.tone === "dark" ? "graphite" : section.tone}>
      <SectionHeader
        eyebrow={section.eyebrow}
        title={section.title}
        text={section.text}
        action={
          <Link
            to="/redes"
            className="inline-flex items-center gap-1 text-sm font-semibold hover:text-brand"
          >
            Ver tudo <ArrowRight className="size-4" />
          </Link>
        }
      />
      {items.length > 0 && (
        <div className="cms-social-list">
          <SocialGrid items={items} />
        </div>
      )}
      <div className={items.length ? "mt-6" : ""}>
        <FollowLinks profiles={data.profiles} />
      </div>
    </Section>
  );
}

function People() {
  const section = useSection();
  const pillars = [
    { icon: HeartHandshake, t: "Acolher", d: "Ouvir antes de indicar." },
    { icon: Compass, t: "Orientar", d: "Ajudar a escolher com clareza." },
    { icon: Wrench, t: "Resolver", d: "Entregar e montar com cuidado." },
    { icon: TrendingUp, t: "Evoluir", d: "Aprender a cada projeto." },
  ];
  return (
    <section className="bg-surface">
      <div className="mx-auto grid max-w-7xl lg:grid-cols-12">
        <div className="relative lg:col-span-7">
          <SiteResponsiveImage
            image={section.image}
            fallback={images.envOperacional}
            alt={section.imageAlt || "Ambiente de trabalho ilustrativo com mobiliário corporativo"}
            pictureClassName="block h-full"
            className="aspect-[4/3] h-full w-full object-cover lg:aspect-auto lg:min-h-[620px]"
          />
          {!section.image && (
            <p className="absolute bottom-4 left-4 rounded-md bg-card/95 px-4 py-2 text-sm font-semibold shadow-card">
              Espaços para trabalhar melhor · imagem ilustrativa
            </p>
          )}
        </div>
        <div className="flex flex-col justify-center px-4 py-12 lg:col-span-5 lg:px-12 lg:py-16">
          <p className="eyebrow mb-3">{section.eyebrow}</p>
          <h2 className="text-4xl font-semibold leading-[0.98] lg:text-6xl">{section.title}</h2>
          <p className="mt-4 text-muted-foreground lg:text-lg">{section.text}</p>
          <ul className="mt-8 divide-y border-y">
            {pillars.map(({ icon: Icon, t, d }) => (
              <li key={t} className="flex items-center gap-4 py-3.5">
                <Icon className="size-5 shrink-0 text-brand" />
                <span className="font-display text-xl font-semibold">{t}</span>
                <span className="ml-auto text-right text-sm text-muted-foreground">{d}</span>
              </li>
            ))}
          </ul>
          <div className="mt-8 flex flex-col gap-2 sm:flex-row">
            <Button asChild variant="secondary">
              <Link to="/sobre">Conheça nossa cultura</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/carreiras">Trabalhe com a gente</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Blog() {
  const section = useSection();
  return (
    <Section tone={section.tone === "dark" ? "graphite" : section.tone}>
      <SectionHeader
        eyebrow={section.eyebrow}
        title={section.title}
        text={section.text}
        action={
          <Link
            to="/blog"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand"
          >
            Ver blog <ArrowRight className="size-4" />
          </Link>
        }
      />
      <div
        data-site-list
        className="scroll-row -mx-4 gap-4 px-4 md:mx-0 md:grid md:grid-cols-4 md:px-0"
      >
        {posts.map((p) => (
          <PostCard key={p.slug} post={p} />
        ))}
      </div>
    </Section>
  );
}

function Testimonials() {
  const section = useSection();
  return (
    <Section tone={section.tone === "dark" ? "graphite" : section.tone}>
      <SectionHeader eyebrow={section.eyebrow} title={section.title} text={section.text} />
      <div data-site-list className="grid gap-4 md:grid-cols-3">
        {testimonials.map((t) => (
          <figure key={t.name} className="rounded-md border bg-card p-6">
            <Quote className="size-6 text-brand" />
            <blockquote className="mt-3">{t.quote}</blockquote>
            <figcaption className="mt-5 flex items-center gap-3">
              <span className="text-sm">
                <b className="block">{t.name}</b>
                <span className="text-muted-foreground">{t.role}</span>
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    </Section>
  );
}

function FinalCta() {
  const section = useSection();
  const { whatsappUrl, hasWhatsapp } = usePublicSite();
  return (
    <section className="py-12 lg:py-20">
      <div className="mx-auto max-w-7xl px-4 lg:px-6">
        <div className="relative overflow-hidden rounded-md bg-graphite p-8 text-graphite-foreground lg:p-16">
          <div className="absolute inset-y-0 right-0 hidden w-1/2 lg:block">
            <SiteResponsiveImage
              image={section.image}
              fallback={images.envReuniao}
              alt={section.imageAlt}
              pictureClassName="block h-full"
              className="h-full w-full object-cover opacity-40"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-graphite to-transparent" />
          </div>
          <div className="relative max-w-xl">
            <span className="mb-5 block h-1 w-12 bg-brand" />
            {section.eyebrow && <p className="eyebrow mb-3">{section.eyebrow}</p>}
            <h2 className="text-4xl font-semibold leading-[1] lg:text-6xl">{section.title}</h2>
            <p className="mt-4 text-graphite-foreground/75 lg:text-lg">{section.text}</p>
            <div className="mt-7 flex flex-col gap-2 sm:flex-row">
              {section.buttonLabel && section.buttonHref && (
                <Button asChild size="lg">
                  <SiteAction href={section.buttonHref}>{section.buttonLabel}</SiteAction>
                </Button>
              )}
              <Button asChild size="lg" variant="whatsapp">
                <a
                  href={whatsappUrl()}
                  target={hasWhatsapp ? "_blank" : undefined}
                  rel="noreferrer"
                >
                  {hasWhatsapp ? "Falar no WhatsApp" : "Falar com a MAG"}
                </a>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
