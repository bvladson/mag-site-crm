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
        <div className="editorial-container py-10 lg:py-16">
          <nav className="text-xs text-muted-foreground"><Link to="/">Início</Link> / Produtos</nav>
          <h1 className="display-title mt-5">Produtos</h1>
        </div>
      </div>
      <Catalog key={q ?? ""} q={q ?? ""} />
    </>
  );
}
