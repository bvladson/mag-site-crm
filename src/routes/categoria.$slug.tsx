import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { categories } from "@/data/catalog";
import { Catalog } from "@/components/site/Catalog";

export const Route = createFileRoute("/categoria/$slug")({
  loader: ({ params }) => {
    const category = categories.find((c) => c.slug === params.slug);
    if (!category) throw notFound();
    return { category };
  },
  head: ({ loaderData }) => {
    const name = loaderData?.category.name ?? "Categoria";
    return {
      meta: [
        { title: `${name} — MAG Móveis Corporativos` },
        { name: "description", content: `${name} para escritórios e empresas. Veja os produtos disponíveis na MAG.` },
        { property: "og:title", content: `${name} — MAG Móveis Corporativos` },
        { property: "og:description", content: `Produtos da categoria ${name}.` },
      ],
      links: loaderData ? [{ rel: "canonical", href: `/categoria/${loaderData.category.slug}` }] : [],
    };
  },
  component: CategoryPage,
});

function CategoryPage() {
  const { category } = Route.useLoaderData();
  return (
    <>
      <div className="border-b bg-surface">
        <div className="editorial-container py-10 lg:py-16">
          <nav className="text-xs text-muted-foreground"><Link to="/">Início</Link> / <Link to="/produtos">Produtos</Link> / {category.name}</nav>
          <h1 className="display-title mt-5">{category.name}</h1>
        </div>
      </div>
      <Catalog key={category.slug} initialCategory={category.slug} />
    </>
  );
}
