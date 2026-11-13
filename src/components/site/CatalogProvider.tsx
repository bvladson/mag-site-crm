import { createContext, useContext, type ReactNode } from "react";
import type { ProductSummary } from "@/data/catalog";

const CatalogContext = createContext<ProductSummary[]>([]);

/** One public catalog snapshot shared by search, listings and the quote list. */
export function CatalogProvider({ products, children }: { products: ProductSummary[]; children: ReactNode }) {
  return <CatalogContext.Provider value={products}>{children}</CatalogContext.Provider>;
}

export const useCatalog = () => useContext(CatalogContext);
