import { createFileRoute, Link, notFound, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Minus, Plus, Headset, Truck, ShieldCheck } from "lucide-react";
import { categoryName, stockLabel } from "@/data/catalog";
import { lookupProduct } from "@/lib/omie";
import { useCatalog } from "@/components/site/CatalogProvider";
import { ProductImage, productPlaceholder } from "@/components/site/ProductImage";
import { useQuote } from "@/lib/quote";
import { ProductCard, formatPrice } from "@/components/site/ProductCard";
import { Button } from "@/components/ui/button";
import { usePublicSite } from "@/components/site/SiteContentProvider";
import { breadcrumb, jsonLd } from "@/lib/seo";
import "@/components/site/EditorialPages.css";

/** Texto para busca e compartilhamento: SEO editorial → resumo → descrição → frase segura com nome e categoria. */
const summaryOf = (p: {
  name: string;
  description: string;
  category: string;
  seoDescription?: string;
  shortDescription?: string;
}) =>
  p.seoDescription ||
  p.shortDescription ||
  p.description ||
  `${p.name} — ${categoryName(p.category)} da MAG Móveis Corporativos. Solicite seu orçamento.`;

/** "hoje às 04:03", "ontem às 04:03" ou "em 03/10 às 04:03" (horário de Fortaleza). */
function updatedLabel(iso: string) {
  const zone = { timeZone: "America/Fortaleza" } as const;
  const day = (d: Date) =>
    d.toLocaleDateString("pt-BR", { ...zone, day: "2-digit", month: "2-digit", year: "numeric" });
  const when = new Date(iso);
  const now = new Date();
  const time = when.toLocaleTimeString("pt-BR", { ...zone, hour: "2-digit", minute: "2-digit" });
  if (day(when) === day(now)) return `hoje às ${time}`;
  if (day(when) === day(new Date(now.getTime() - 86400000))) return `ontem às ${time}`;
  return `em ${when.toLocaleDateString("pt-BR", { ...zone, day: "2-digit", month: "2-digit" })} às ${time}`;
}

export const Route = createFileRoute("/produto/$slug")({
  loader: async ({ params }) => {
    // Endereço malformado (maiúscula, acento, ../): 404 aqui, sem chegar à validação do servidor (que daria 500).
    if (!/^[a-z0-9-]{1,200}$/.test(params.slug)) throw notFound();
    const { product, redirectTo } = await lookupProduct(params.slug);
    // URL antiga (/produto/produto-<id> ou slug anterior): 301 direto para a canônica, num salto só.
    // Location relativa: atrás do Nginx o Node vê http://, e uma URL absoluta criaria um salto extra.
    if (redirectTo) throw redirect({ href: `/produto/${redirectTo}`, statusCode: 301 });
    if (!product) throw notFound();
    return { product };
  },
  head: ({ loaderData }) => {
    if (!loaderData)
      return {
        meta: [{ title: "Produto não encontrado — MAG" }, { name: "robots", content: "noindex" }],
      };
    const p = loaderData.product;
    return {
      meta: [
        { title: p.seoTitle || `${p.name} — MAG Móveis Corporativos` },
        { name: "description", content: summaryOf(p) },
        { property: "og:title", content: p.seoTitle || `${p.name} — MAG Móveis Corporativos` },
        { property: "og:description", content: summaryOf(p) },
        { property: "og:type", content: "product" },
        { property: "og:url", content: `https://magmoveiscorporativos.com.br/produto/${p.slug}` },
        {
          property: "og:image",
          content: `https://magmoveiscorporativos.com.br${p.images[0] || p.image || productPlaceholder}`,
        },
      ],
      links: [{ rel: "canonical", href: `https://magmoveiscorporativos.com.br/produto/${p.slug}` }],
      scripts: [
        // Nome, SKU, descrição, marca e cor vêm do Omie/editorial: sempre serializar com jsonLd (nunca JSON.stringify cru).
        {
          type: "application/ld+json",
          children: jsonLd({
            "@context": "https://schema.org",
            "@type": "Product",
            name: p.name,
            sku: p.sku,
            description: summaryOf(p),
            ...(p.brand ? { brand: { "@type": "Brand", name: p.brand } } : {}),
            category: categoryName(p.category),
            ...(p.color ? { color: p.color } : {}),
            ...(p.price != null
              ? {
                  offers: {
                    "@type": "Offer",
                    priceCurrency: "BRL",
                    price: p.price,
                    ...(p.stock !== "SOB_CONSULTA"
                      ? { availability: "https://schema.org/InStock" }
                      : {}),
                  },
                }
              : {}),
          }),
        },
        {
          type: "application/ld+json",
          children: jsonLd(
            breadcrumb([
              ["Início", "/"],
              ["Produtos", "/produtos"],
              [categoryName(p.category), `/categoria/${p.category}`],
              [p.name, `/produto/${p.slug}`],
            ]),
          ),
        },
      ],
    };
  },
  component: ProductPage,
});

function ProductPage() {
  const { whatsappUrl, hasWhatsapp } = usePublicSite();
  const { product: p } = Route.useLoaderData();
  const products = useCatalog();
  const { add } = useQuote();
  const [qty, setQty] = useState(1);
  const gallery = p.images.length ? p.images : [p.image || productPlaceholder];
  const [active, setActive] = useState(0);
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    setActive(0);
    setQty(1);
    setZoom(false);
  }, [p.slug]);
  const related = products
    .filter(
      (x) =>
        x.slug !== p.slug &&
        (x.category === p.category || x.environments.some((e) => p.environments.includes(e))),
    )
    .slice(0, 4);
  const specs: [string, string][] = [
    ["SKU", p.sku],
    ["Categoria", categoryName(p.category)],
    ["Marca", p.brand],
    ["Linha", p.line],
    ["Cor", p.color],
    // Ficha técnica editorial (catalog/editorial.json → technical_specs)
    ...(p.specs ?? []).map(({ label, value }): [string, string] => [label, value]),
  ];

  return (
    <div className="mag-product-detail editorial-container py-8 lg:py-16">
      <nav className="mb-8 text-xs text-muted-foreground">
        <Link to="/">Início</Link> / <Link to="/produtos">Produtos</Link> /{" "}
        <Link to="/categoria/$slug" params={{ slug: p.category }}>
          {categoryName(p.category)}
        </Link>
      </nav>
      <div className="grid gap-8 lg:grid-cols-[1.15fr_1fr] lg:gap-14">
        <div>
          <button
            onClick={() => setZoom((z) => !z)}
            className={`block w-full overflow-hidden bg-surface ${zoom ? "cursor-zoom-out" : "cursor-zoom-in"}`}
            aria-label="Ampliar imagem"
          >
            <ProductImage
              src={gallery[active] || gallery[0]}
              alt={p.name}
              className={`aspect-square w-full object-contain transition duration-300 ${zoom ? "scale-150" : ""}`}
            />
          </button>
          {gallery.length > 1 && (
            <div className="mt-3 flex gap-2 overflow-x-auto">
              {gallery.map((g, i) => (
                <button
                  key={i}
                  onClick={() => setActive(i)}
                  aria-label={`Ver imagem ${i + 1} de ${p.name}`}
                  className={`size-20 shrink-0 overflow-hidden rounded-md border-2 bg-surface ${active === i ? "border-brand" : "border-transparent"}`}
                >
                  <ProductImage src={g} alt="" className="h-full w-full object-contain" />
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <div className="flex flex-wrap gap-2">
            <span
              className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${p.stock === "PRONTA_ENTREGA" ? "bg-success-soft text-success" : "bg-muted text-muted-foreground"}`}
            >
              {stockLabel[p.stock]}
            </span>
            {p.featured && (
              <span className="rounded-sm bg-brand px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                Destaque
              </span>
            )}
          </div>
          <h1 className="mag-product-title mt-4 text-4xl font-medium leading-[1.05] lg:text-5xl">{p.name}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {[`SKU ${p.sku}`, p.brand, categoryName(p.category)].filter(Boolean).join(" · ")}
          </p>
          {/* Sem quantidade pública: o selo "Pronta entrega" acima basta; aqui só a data da disponibilidade. */}
          {p.stock === "PRONTA_ENTREGA" && p.stockUpdatedAt && (
            <p className="mt-2 text-xs text-muted-foreground" suppressHydrationWarning>
              Disponibilidade atualizada {updatedLabel(p.stockUpdatedAt)}
            </p>
          )}
          <p className="mt-5 text-2xl font-semibold">{formatPrice(p.price)}</p>
          {/* Resumo e destaques editoriais; a descrição completa fica só em "Sobre este produto" (sem repetir texto). */}
          {p.shortDescription && <p className="mt-4 text-muted-foreground">{p.shortDescription}</p>}
          {p.highlights && p.highlights.length > 0 && (
            <ul className="mt-4 grid gap-1.5 text-sm">
              {p.highlights.map((item) => (
                <li key={item} className="flex gap-2">
                  <span aria-hidden className="text-brand">
                    •
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-7 flex items-center gap-3">
            <span className="text-sm font-medium">Quantidade</span>
            <div className="flex items-center rounded-md border">
              <button
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                className="grid size-10 place-items-center"
                aria-label="Diminuir"
              >
                <Minus className="size-4" />
              </button>
              <input
                value={qty}
                onChange={(e) =>
                  setQty(Math.min(999, Math.max(1, Math.floor(Number(e.target.value) || 1))))
                }
                className="w-12 text-center outline-none"
                aria-label="Quantidade"
                inputMode="numeric"
              />
              <button
                onClick={() => setQty((q) => Math.min(999, q + 1))}
                className="grid size-10 place-items-center"
                aria-label="Aumentar"
              >
                <Plus className="size-4" />
              </button>
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button size="lg" className="flex-1" onClick={() => add(p.slug, qty)}>
              Adicionar ao orçamento
            </Button>
            <Button size="lg" variant="outline" className="flex-1" asChild>
              <a
                href={whatsappUrl(`Olá! Tenho interesse em ${qty}x ${p.name} (${p.sku}).`)}
                target={hasWhatsapp ? "_blank" : undefined}
                rel="noreferrer"
              >
                <Headset /> Falar com um consultor
              </a>
            </Button>
          </div>
          <ul className="mt-6 grid gap-2 text-sm text-muted-foreground">
            <li className="flex items-center gap-2">
              <Truck className="size-4 text-brand" /> Entrega e montagem a combinar com o consultor
            </li>
            <li className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-brand" /> Garantia conforme ficha oficial do
              produto
            </li>
          </ul>
        </div>
      </div>

      <div className="mt-16 grid gap-10 border-t pt-12 lg:grid-cols-2">
        <section>
          {p.description ? (
            <>
              <h2 className="text-2xl font-semibold">Sobre este produto</h2>
              <p className="mt-3 text-muted-foreground">{p.description}</p>
              <h3 className="mt-8 text-xl font-semibold">Especificações técnicas</h3>
            </>
          ) : (
            <h2 className="text-2xl font-semibold">Especificações técnicas</h2>
          )}
          <table className="mt-3 w-full text-sm">
            <tbody>
              {specs
                .filter(([, v]) => Boolean(v))
                .map(([k, v], index) => (
                  <tr key={`${k}-${index}`} className="border-b">
                    <td className="py-2.5 text-muted-foreground">{k}</td>
                    <td className="py-2.5 text-right font-medium">{v}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted-foreground">
            Consulte a equipe MAG sobre medidas, materiais, acabamentos e condições de entrega.
          </p>
        </section>
      </div>

      {related.length > 0 && (
        <section className="mt-16 border-t pt-12">
          <h2 className="mb-5 text-2xl font-semibold">Complete seu ambiente</h2>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
            {related.map((r) => (
              <ProductCard key={r.slug} product={r} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
