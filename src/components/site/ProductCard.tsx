import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { ProductImage } from "./ProductImage";
import type { ProductSummary } from "@/data/catalog";
import { categoryName } from "@/data/catalog";
import { useQuote } from "@/lib/quote";

export const formatPrice = (v: number | null) =>
  v == null ? "Valor sob consulta" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function ProductCard({ product }: { product: ProductSummary }) {
  const { add } = useQuote();
  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-md border bg-card transition hover:shadow-card">
      <Link to="/produto/$slug" params={{ slug: product.slug }} className="relative block aspect-square overflow-hidden bg-surface">
        <ProductImage src={product.image} alt={product.name} loading="lazy" className="h-full w-full object-contain p-2 transition duration-500 group-hover:scale-[1.04]" />
        <div className="absolute left-2 top-2 flex flex-col gap-1">
          {product.featured && <span className="rounded-sm bg-brand px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">Destaque</span>}
        </div>
      </Link>
      <div className="flex flex-1 flex-col p-3 sm:p-4">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{categoryName(product.category)}</p>
        <Link to="/produto/$slug" params={{ slug: product.slug }} className="mt-1 line-clamp-2 text-sm font-semibold leading-snug hover:text-brand sm:text-[15px]">
          {product.name}
        </Link>
        <p className="mt-2 text-sm text-muted-foreground">{formatPrice(product.price)}</p>
        {/* Sem quantidade pública: só o selo (a quantidade fica no servidor). */}
        {product.stock === "PRONTA_ENTREGA" && <p className="mt-0.5 text-[11px] font-medium text-success">Pronta entrega</p>}
        <div className="mt-auto flex gap-2 pt-3">
          <Link to="/produto/$slug" params={{ slug: product.slug }} className="flex h-9 flex-1 items-center justify-center rounded-md border text-xs font-semibold hover:bg-accent sm:text-sm">
            Ver produto
          </Link>
          <button onClick={() => add(product.slug)} aria-label={`Adicionar ${product.name} ao orçamento`} className="grid size-9 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="size-4" />
          </button>
        </div>
      </div>
    </article>
  );
}
