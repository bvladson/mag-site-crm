import { Link } from "@tanstack/react-router";
import {
  createContext,
  useContext,
  useState,
  type ReactNode,
  type ComponentProps,
} from "react";
import { ArrowRight, ArrowUpRight, Quote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Section, SectionHeader } from "@/components/site/Section";
import { ProductCard } from "@/components/site/ProductCard";
import { MAGHeroFilm } from "./MAGHeroFilm";
import {
  FinalCta as EditorialFinalCta,
  MAGProcess,
  SectionIndex,
  TextLink,
} from "./Editorial";
import { PostCard } from "@/components/site/PostCard";
import {
  showcaseCategories,
  environments,
  cases,
  posts,
  images,
  testimonials,
  clientLogos,
  type ProductSummary,
} from "@/data/catalog";
import { useSiteContent } from "./SiteContentProvider";
import {
  siteImageUrl,
  type SiteSection,
  type SiteBanner,
} from "@/lib/site-content";
import { isInLinkSchedule } from "@/lib/links";
import { useCatalog } from "@/components/site/CatalogProvider";
import { FollowLinks, SocialGrid } from "@/components/site/Social";
import type { SocialItem, SocialProfile } from "@/config/social";

export type HomeContentProps = {
  showcase: { ready: string[]; featured: string[] };
  social: {
    profiles: SocialProfile[];
    videos: SocialItem[];
    others: SocialItem[];
  };
};
export function HomeContent({ showcase, social }: HomeContentProps) {
  const products = useCatalog();
  const { content } = useSiteContent();
  // Vitrine: só mobiliário, alternando categorias e preferindo foto + estoque — ordem calculada no servidor.
  const bySlug = new Map(products.map((p) => [p.slug, p]));
  const pick = (slugs: string[]) =>
    slugs
      .map((slug) => bySlug.get(slug))
      .filter((p): p is ProductSummary => Boolean(p));
  const ready = pick(showcase.ready);
  const featured = pick(showcase.featured);
  const render = (section: SiteSection) => {
    switch (section.id) {
      case "manifesto":
        return <Manifesto />;
      case "process":
        return <MAGProcess section={section} />;
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
        return <Cases />;
      case "clients":
        return clientLogos.length ? <Clients /> : null;
      case "stats":
        return content.home.stats.some((entry) => entry.value) ? (
          <Stats />
        ) : null;
      case "social":
        return social.profiles.length ||
          social.videos.length ||
          social.others.length ? (
          <SocialHome data={social} />
        ) : null;
      case "people":
        return <People />;
      case "blog":
        return posts.length ? <Blog /> : null;
      case "testimonials":
        return testimonials.length ? <Testimonials /> : null;
      case "cta":
        return <EditorialFinalCta section={section} />;
    }
  };
  return (
    <>
      <MAGHeroFilm />
      {content.home.sections
        .filter((section) => section.enabled)
        .map((section) => {
          const element =
            render(section) ??
            (section.image ? (
              <Section
                tone={section.tone === "dark" ? "graphite" : section.tone}
              >
                <HomeSectionHeader
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
                {!["manifesto", "process", "project", "people", "cta"].includes(
                  section.id,
                ) &&
                  section.image && (
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
                  !["manifesto", "process", "project", "cta"].includes(
                    section.id,
                  ) && (
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
      {...(/^https:\/\//.test(href)
        ? { target: "_blank", rel: "noopener noreferrer" }
        : {})}
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
        <source
          media="(max-width: 639px)"
          srcSet={siteImageUrl(mobileImage, preview)}
        />
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
      <HomeSectionHeader
        eyebrow={section.eyebrow}
        title={section.title}
        text={section.text}
        action={
          <ViewAll label={featured ? "Ver todos os produtos" : "Ver todos"} />
        }
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

const sectionNumbers: Record<string, string> = {
  manifesto: "01",
  process: "02",
  cases: "03",
  environments: "04",
  ready: "05",
  featured: "05",
  solutions: "06",
  people: "07",
  social: "08",
  blog: "09",
  categories: "10",
  project: "11",
  clients: "12",
  stats: "13",
  banners: "14",
  testimonials: "15",
};
function HomeSectionHeader({
  eyebrow,
  title,
  text,
  action,
}: ComponentProps<typeof SectionHeader>) {
  const section = useSection();
  return (
    <>
      <SectionIndex
        index={sectionNumbers[section.id] || "MAG"}
        label={eyebrow || "MAG Móveis Corporativos"}
      />
      <div className="section-heading">
        <div>
          <h2 className="display-title max-w-3xl">{title}</h2>
          {text && <p className="editorial-support mt-6 max-w-xl">{text}</p>}
        </div>
        {action}
      </div>
    </>
  );
}
function Manifesto() {
  const section = useSection();
  const { content } = useSiteContent();
  const editorial = (
    content.home as typeof content.home & {
      editorial?: { manifestoSupport?: string };
    }
  ).editorial;
  return (
    <Section tone={section.tone === "dark" ? "graphite" : section.tone}>
      <SectionIndex index="01" label={section.eyebrow} />
      <div className="manifesto-grid mt-10 lg:mt-14">
        <div>
          <h2 className="display-title">{section.title}</h2>
          {section.text && (
            <p className="editorial-copy mt-8">{section.text}</p>
          )}
          {editorial?.manifestoSupport && (
            <p className="editorial-support mt-6 max-w-lg">
              {editorial.manifestoSupport}
            </p>
          )}
          {section.buttonLabel && section.buttonHref && (
            <SiteAction
              href={section.buttonHref}
              className="editorial-link mt-8"
            >
              {section.buttonLabel}
              <ArrowUpRight />
            </SiteAction>
          )}
        </div>
        <figure className="manifesto-image">
          <div className="image-reveal">
            <SiteResponsiveImage
              image={section.image}
              fallback={images.envOperacional}
              alt={
                section.imageAlt ||
                "Ambiente corporativo com estações de trabalho"
              }
            />
          </div>
          <figcaption>
            <span>MAG / MOBILIÁRIO CORPORATIVO</span>
            <span>
              {section.image ? section.imageAlt : "Imagem ilustrativa"}
            </span>
          </figcaption>
        </figure>
      </div>
    </Section>
  );
}

/** Um de cada categoria por vez, mantendo a ordem de relevância dentro de cada uma. */

function Categories() {
  const section = useSection();
  return (
    <Section tone={section.tone === "dark" ? "graphite" : section.tone}>
      <HomeSectionHeader
        eyebrow={section.eyebrow}
        title={section.title}
        text={section.text}
      />
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
  const selection = ["diretoria", "reuniao", "operacional", "recepcao"].flatMap(
    (slug) => environments.filter((entry) => entry.slug === slug),
  );
  return (
    <Section tone={section.tone === "dark" ? "graphite" : section.tone}>
      <HomeSectionHeader
        eyebrow={section.eyebrow}
        title={section.title}
        text={section.text}
        action={<TextLink to="/ambientes">Todos os ambientes</TextLink>}
      />
      <div className="environment-portfolio" data-site-list>
        {selection.map((environment, index) => (
          <Link
            key={environment.slug}
            to="/ambientes/$slug"
            params={{ slug: environment.slug }}
            className="environment-entry group"
          >
            <div className="image-reveal">
              <img
                src={environment.image}
                alt={environment.name}
                loading="lazy"
              />
            </div>
            <div className="mt-5 flex items-center gap-4">
              <span className="technical-label">0{index + 1}</span>
              <h3 className="font-display text-4xl">{environment.name}</h3>
              <ArrowUpRight className="ml-auto size-5" />
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {environment.tagline}
            </p>
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
            <p className="mt-4 max-w-md text-graphite-foreground/80 lg:text-lg">
              {section.text}
            </p>
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
            <span className="font-display text-3xl font-semibold text-brand">
              0{i + 1}
            </span>
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
    {
      title: "Projetos completos",
      text: "Planejamento, mobiliário, entrega e montagem.",
    },
    {
      title: "Renovação de ambientes",
      text: "Novas possibilidades para espaços que já fazem parte da sua empresa.",
    },
    {
      title: "Compra corporativa",
      text: "Atendimento para demandas em volume e diferentes setores.",
    },
    {
      title: "Atendimento consultivo",
      text: "Orientação para escolher o mobiliário de acordo com a sua rotina.",
    },
  ];
  return (
    <Section tone={section.tone === "dark" ? "graphite" : section.tone}>
      <SectionIndex index="06" label={section.eyebrow} />
      <div className="corporate-grid mt-10 lg:mt-14">
        <div>
          <h2 className="display-title">{section.title}</h2>
          {section.text && (
            <p className="editorial-support mt-7 max-w-md">{section.text}</p>
          )}
          <div className="mt-8">
            <TextLink to="/empresas">Conhecer soluções corporativas</TextLink>
          </div>
        </div>
        <ul className="typographic-list" data-site-list>
          {items.map((item, index) => (
            <li key={item.title}>
              <span className="technical-label">0{index + 1}</span>
              <div>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </div>
              <ArrowUpRight className="size-5" aria-hidden="true" />
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

function Campaigns() {
  const { content } = useSiteContent();
  const section = useSection();
  const banners = content.home.banners.filter((banner) =>
    isInLinkSchedule({
      active: banner.enabled,
      startsAt: banner.startsAt,
      endsAt: banner.endsAt,
    }),
  );
  if (!banners.length) return null;
  return (
    <section className="py-4 lg:py-6">
      <div className="mx-auto max-w-7xl px-4 lg:px-6">
        {(section.eyebrow || section.title || section.text) && (
          <HomeSectionHeader
            eyebrow={section.eyebrow}
            title={section.title}
            text={section.text}
          />
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
        {(banner.eyebrow ||
          banner.title ||
          banner.text ||
          (banner.href && banner.buttonLabel)) && (
          <div
            className={`mx-auto max-w-7xl p-6 lg:p-10 ${banner.align === "center" ? "text-center" : ""}`}
          >
            {banner.eyebrow && <p className="eyebrow mb-2">{banner.eyebrow}</p>}
            {banner.title && (
              <h2 className="text-3xl font-semibold lg:text-5xl">
                {banner.title}
              </h2>
            )}
            {banner.text && (
              <p className="mt-3 whitespace-pre-line">{banner.text}</p>
            )}
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
  if (!cases.length)
    return (
      <Section tone={section.tone === "dark" ? "graphite" : section.tone}>
        <HomeSectionHeader
          eyebrow={section.eyebrow}
          title={section.title}
          text={section.text}
          action={<TextLink to="/projetos">Conhecer projetos</TextLink>}
        />
        <div className="project-composition" data-site-list>
          <Link to="/projetos" className="editorial-image-link">
            <img
              src={images.envReuniao}
              alt="Ambiente de reunião ilustrativo"
              loading="lazy"
            />
            <div>
              <span className="technical-label">VISÃO DO TODO</span>
              <h3>Ambientes que fazem sentido juntos.</h3>
              <ArrowUpRight />
            </div>
          </Link>
          <Link
            to="/ambientes/$slug"
            params={{ slug: "diretoria" }}
            className="editorial-image-link"
          >
            <img
              src={images.heroOffice}
              alt="Ambiente de diretoria ilustrativo"
              loading="lazy"
            />
            <div>
              <span className="technical-label">CADA DETALHE</span>
              <h3>Um espaço para decidir.</h3>
              <ArrowUpRight />
            </div>
          </Link>
          <Link to="/contato" className="editorial-image-link">
            <img
              src={images.projeto}
              alt="Montagem de mobiliário corporativo"
              loading="lazy"
            />
            <div>
              <span className="technical-label">DO INÍCIO AO FIM</span>
              <h3>Planejar. Entregar. Montar.</h3>
              <ArrowUpRight />
            </div>
          </Link>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Imagens ilustrativas de ambientes e soluções.
        </p>
      </Section>
    );
  return (
    <Section tone={section.tone === "dark" ? "graphite" : section.tone}>
      <HomeSectionHeader
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
        <HomeSectionHeader
          eyebrow={section.eyebrow}
          title={section.title}
          text={section.text}
        />
        <div className="mt-6 grid grid-cols-3 gap-3 md:grid-cols-6">
          {clientLogos.map((c) => (
            <div
              key={c.name}
              className="grid h-14 place-items-center rounded-md border"
            >
              <img
                src={c.logo}
                alt={c.name}
                className="max-h-8 w-auto"
                loading="lazy"
              />
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
        <HomeSectionHeader
          eyebrow={section.eyebrow}
          title={section.title}
          text={section.text}
        />
      )}
      <div data-site-list className="grid grid-cols-2 gap-6 lg:grid-cols-4">
        {content.home.stats
          .filter((s) => s.value)
          .map((s, index) => (
            <div
              key={`${s.label}-${index}`}
              className="border-l-2 border-brand pl-4"
            >
              <p className="font-display text-4xl font-semibold lg:text-5xl">
                {s.value}
              </p>
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
  data: {
    profiles: SocialProfile[];
    videos: SocialItem[];
    others: SocialItem[];
  };
}) {
  const section = useSection();
  const items = [...data.videos, ...data.others];
  if (!items.length && !data.profiles.length) return null;
  return (
    <Section tone={section.tone === "dark" ? "graphite" : section.tone}>
      <HomeSectionHeader
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
  return (
    <Section tone={section.tone === "dark" ? "graphite" : section.tone}>
      <SectionIndex index="07" label={section.eyebrow} />
      <div className="people-editorial mt-10 lg:mt-14">
        <figure className="image-reveal">
          <SiteResponsiveImage
            image={section.image}
            fallback={images.team}
            alt={
              section.imageAlt ||
              "Pessoas em ambiente de trabalho, imagem ilustrativa"
            }
            pictureClassName="block h-full"
            className="h-full w-full object-cover"
          />
          {!section.image && (
            <figcaption className="editorial-image-caption">
              Imagem ilustrativa
            </figcaption>
          )}
        </figure>
        <div className="people-copy">
          <h2 className="display-title">{section.title}</h2>
          {section.text && (
            <p className="editorial-copy mt-7">{section.text}</p>
          )}
          <div className="mt-8 flex flex-col items-start gap-5">
            <TextLink to="/sobre">Conheça nossa cultura</TextLink>
            <TextLink to="/carreiras">Trabalhe com a gente</TextLink>
          </div>
        </div>
      </div>
    </Section>
  );
}

function Blog() {
  const section = useSection();
  return (
    <Section tone={section.tone === "dark" ? "graphite" : section.tone}>
      <HomeSectionHeader
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
      <HomeSectionHeader
        eyebrow={section.eyebrow}
        title={section.title}
        text={section.text}
      />
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
