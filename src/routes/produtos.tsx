import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { Catalog } from "@/components/site/Catalog";

export const Route = createFileRoute("/produtos")({
  validateSearch: z.object({ q: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "Produtos — MAG Móveis Corporativos" },
      { name: "description", content: "Catálogo de cadeiras, mesas, estações de trabalho, recepção e armazenamento para empresas." },
      { property: "og:title", content: "Produtos — MAG Móveis Corporativos" },
      { property: "og:description", content: "Encontre o produto certo para o seu ambiente." },
    ],
    links: [{ rel: "canonical", href: "/produtos" }],
  }),
  component: ProductsPage,
});

function ProductsPage() {
  const { q } = Route.useSearch();
  return (
    <>
      <div className="border-b bg-surface">
        <div className="mx-auto max-w-7xl px-4 py-6 lg:px-6 lg:py-10">
          <nav className="text-xs text-muted-foreground"><Link to="/">Início</Link> / Produtos</nav>
          <h1 className="mt-2 text-4xl font-semibold lg:text-5xl">Produtos</h1>
        </div>
      </div>
      <Catalog key={q ?? ""} q={q ?? ""} />
    </>
  );
}
