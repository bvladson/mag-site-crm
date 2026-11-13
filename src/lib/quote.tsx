import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useCatalog } from "@/components/site/CatalogProvider";

export type QuoteItem = { slug: string; qty: number };
type Ctx = {
  items: QuoteItem[];
  count: number;
  add: (slug: string, qty?: number) => void;
  setQty: (slug: string, qty: number) => void;
  remove: (slug: string) => void;
  clear: () => void;
};

const QuoteContext = createContext<Ctx | null>(null);
const KEY = "mag-quote-v1";

export function QuoteProvider({ children }: { children: ReactNode }) {
  const catalog = useCatalog();
  const [items, setItems] = useState<QuoteItem[]>([]);
  const quantity = (qty: number) => Math.min(999, Math.max(1, Number.isFinite(qty) ? Math.floor(qty) : 1));
  // Listas salvas antes de 05/10/2026 guardam "produto-<id>": convertidas para o slug atual (sem perder itens).
  const known = new Set(catalog.map((p) => p.slug));
  const byLegacyId = new Map<string, string>(catalog.flatMap((p) => (p.id ? [[`produto-${p.id}`, p.slug] as [string, string]] : [])));
  const merged = new Map<string, number>();
  for (const i of items) {
    const slug = known.has(i.slug) ? i.slug : byLegacyId.get(i.slug);
    if (slug) merged.set(slug, quantity((merged.get(slug) ?? 0) + i.qty));
  }
  const validItems: QuoteItem[] = [...merged].map(([slug, qty]) => ({ slug, qty }));

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) setItems(parsed.filter((i): i is QuoteItem => i != null && typeof i.slug === "string" && typeof i.qty === "number" && Number.isFinite(i.qty)).slice(0, 100).map((i) => ({ slug: i.slug, qty: quantity(i.qty) })));
      }
    } catch {}
  }, []);

  const persist = (next: QuoteItem[]) => {
    setItems(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {}
  };

  const value: Ctx = {
    items: validItems,
    count: validItems.reduce((s, i) => s + i.qty, 0),
    add: (slug, qty = 1) => {
      if (!catalog.some((p) => p.slug === slug)) return;
      const found = validItems.find((i) => i.slug === slug);
      if (!found && validItems.length >= 100) { toast.error("Sua lista já tem 100 produtos. Envie este orçamento antes de adicionar outros."); return; }
      persist(found ? validItems.map((i) => (i.slug === slug ? { ...i, qty: quantity(i.qty + qty) } : i)) : [...validItems, { slug, qty: quantity(qty) }]);
      toast.success("Adicionado ao orçamento");
    },
    setQty: (slug, qty) => persist(validItems.map((i) => (i.slug === slug ? { ...i, qty: quantity(qty) } : i))),
    remove: (slug) => persist(validItems.filter((i) => i.slug !== slug)),
    clear: () => persist([]),
  };

  return <QuoteContext.Provider value={value}>{children}</QuoteContext.Provider>;
}

export function useQuote() {
  const ctx = useContext(QuoteContext);
  if (!ctx) throw new Error("useQuote must be used inside QuoteProvider");
  return ctx;
}
