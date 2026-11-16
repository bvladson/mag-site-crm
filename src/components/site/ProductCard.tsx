import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Plus } from "lucide-react";
import { ProductImage } from "./ProductImage";
import type { ProductSummary } from "@/data/catalog";
import { categoryName } from "@/data/catalog";
import { useQuote } from "@/lib/quote";

export const formatPrice = (v: number | null) =>
  v == null ? "Valor sob consulta" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function ProductCard({ product }: { product: ProductSummary }) {
  const { add } = useQuote();
  return (
    <article className="mag-product group flex h-full flex-col">
      <Link to="/produto/$slug" params={{ slug: product.slug }} className="mag-product-image relative block aspect-square overflow-hidden bg-surface">
        <ProductImage src={product.image} alt={product.name} loading="lazy" className="h-full w-full object-contain p-4 transition duration-500 group-hover:scale-[1.04]" />
        <div className="absolute left-2 top-2 flex flex-col gap-1">
          {product.featured && <span className="bg-brand px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground">Destaque</span>}
        </div>
      </Link>
      <div className="flex flex-1 flex-col pt-5">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{categoryName(product.category)}</p>
        <Link to="/produto/$slug" params={{ slug: product.slug }} className="mt-2 line-clamp-2 text-sm font-medium leading-snug hover:text-brand sm:text-base">
          {product.name}
        </Link>
        <p className="mt-2 text-sm text-muted-foreground">{formatPrice(product.price)}</p>
        {/* Sem quantidade pública: só o selo (a quantidade fica no servidor). */}
        {product.stock === "PRONTA_ENTREGA" && <p className="mt-0.5 text-[11px] font-medium text-success">Pronta entrega</p>}
        <div className="mt-auto flex items-center justify-between gap-2 pt-5">
          <Link to="/produto/$slug" params={{ slug: product.slug }} className="mag-product-link flex h-9 items-center gap-2 text-xs font-medium hover:text-brand">
            Ver produto <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </Link>
          <button onClick={() => add(product.slug)} aria-label={`Adicionar ${product.name} ao orçamento`} title="Adicionar ao orçamento" className="grid size-9 shrink-0 place-items-center bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="size-4" />
          </button>
        </div>
      </div>
    </article>
  );
}
