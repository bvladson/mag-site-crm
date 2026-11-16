import { useEffect, useMemo, useState } from "react";
import "./EditorialPages.css";
import { SlidersHorizontal, X, SearchX } from "lucide-react";
import { categories, environments, type ProductSummary } from "@/data/catalog";
import { useCatalog } from "./CatalogProvider";
import { ProductCard } from "./ProductCard";
import { highlightScore, searchProducts } from "@/lib/search";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

type Filters = { category: string[]; env: string[]; stock: boolean };
const sorts = ["Destaques", "Nome", "Menor preço", "Maior preço"] as const;
const PAGE_SIZE = 24;


export function Catalog({ q = "", initialCategory, initialEnv }: { q?: string; initialCategory?: string; initialEnv?: string }) {
  const products = useCatalog();
  const [term, setTerm] = useState(q);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<(typeof sorts)[number]>("Destaques");
  const [f, setF] = useState<Filters>({ category: initialCategory ? [initialCategory] : [], env: initialEnv ? [initialEnv] : [], stock: false });
  useEffect(() => { setTerm(q); }, [q]);
  useEffect(() => { setF({ category: initialCategory ? [initialCategory] : [], env: initialEnv ? [initialEnv] : [], stock: false }); }, [initialCategory, initialEnv]);
  useEffect(() => { setPage(1); }, [term, f, sort]);

  const list = useMemo(() => {
    let r: ProductSummary[] = searchProducts(term, products);
    if (f.category.length) r = r.filter((p) => f.category.includes(p.category));
    if (f.env.length) r = r.filter((p) => p.environments.some((e) => f.env.includes(e)));
    if (f.stock) r = r.filter((p) => p.stock === "PRONTA_ENTREGA");
    if (sort === "Destaques" && !term.trim()) r = [...r].sort((a, b) => highlightScore(b) - highlightScore(a));
    if (sort === "Nome") r = [...r].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "Menor preço") r = [...r].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
    if (sort === "Maior preço") r = [...r].sort((a, b) => (b.price ?? -1) - (a.price ?? -1));
    return r;
  }, [products, term, f, sort]);
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const visible = list.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const availableSorts = products.some((p) => p.price != null) ? sorts : sorts.filter((s) => !s.includes("preço"));

  // Só oferece categorias que têm produto no catálogo atual (ex.: "Outros" some quando vazia).
  const presentCategories = useMemo(() => new Set(products.map((p) => p.category)), [products]);
  const toggle = (key: "category" | "env", v: string) =>
    setF((s) => ({ ...s, [key]: s[key].includes(v) ? s[key].filter((x) => x !== v) : [...s[key], v] }));

  const chips = [
    ...f.category.map((c) => ({ k: "category" as const, v: c, label: categories.find((x) => x.slug === c)?.name ?? c })),
    ...f.env.map((c) => ({ k: "env" as const, v: c, label: environments.find((x) => x.slug === c)?.name ?? c })),
  ];

  const filters = (
    <div className="space-y-7">
      <FilterGroup title="Categoria">
        {categories.filter((c) => presentCategories.has(c.slug) || f.category.includes(c.slug)).map((c) => <Check key={c.slug} label={c.name} checked={f.category.includes(c.slug)} onChange={() => toggle("category", c.slug)} />)}
      </FilterGroup>
      <FilterGroup title="Ambiente">
        {environments.map((e) => <Check key={e.slug} label={e.name} checked={f.env.includes(e.slug)} onChange={() => toggle("env", e.slug)} />)}
      </FilterGroup>
      <FilterGroup title="Disponibilidade">
        <Check label="Pronta entrega" checked={f.stock} onChange={() => setF((s) => ({ ...s, stock: !s.stock }))} />
      </FilterGroup>
      <p className="text-xs text-muted-foreground">A disponibilidade será confirmada pela equipe MAG no orçamento.</p>
    </div>
  );

  return (
    <div className="mag-catalog editorial-container py-10 lg:py-16">
      <div className="mb-8">
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Buscar por nome, categoria ou ambiente"
          aria-label="Buscar no catálogo"
          className="mag-catalog-search h-14 w-full border-b border-input bg-transparent px-0 text-base outline-none focus:border-brand"
        />
      </div>
      <div className="grid gap-10 lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-14">
        <aside className="mag-catalog-filters hidden lg:block">{filters}</aside>
        <div>
          <div className="mb-7 flex items-center justify-between gap-3 border-b pb-5">
            <p className="text-sm text-muted-foreground"><b className="text-foreground">{list.length}</b> resultados</p>
            <div className="flex min-w-0 items-center gap-2">
              <Sheet>
                <SheetTrigger className="flex h-10 items-center gap-2 rounded-md border px-3 text-sm font-medium lg:hidden">
                  <SlidersHorizontal className="size-4" /> Filtrar
                </SheetTrigger>
                <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-xl">
                  <SheetHeader><SheetTitle>Filtros</SheetTitle></SheetHeader>
                  <div className="px-4 pb-8">{filters}</div>
                </SheetContent>
              </Sheet>
              <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Ordenar" className="h-10 min-w-0 rounded-md border bg-card px-2 text-sm sm:px-3">
                {availableSorts.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>
          {chips.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-2">
              {chips.map((c) => (
                <button key={c.k + c.v} onClick={() => toggle(c.k, c.v)} className="flex items-center gap-1 rounded-full bg-brand-soft px-3 py-1 text-sm font-medium text-brand">
                  {c.label} <X className="size-3.5" />
                </button>
              ))}
              <button onClick={() => setF({ category: [], env: [], stock: false })} className="text-sm text-muted-foreground underline">Limpar</button>
            </div>
          )}
          {products.length === 0 ? (
            <div className="rounded-md border border-dashed py-16 text-center">
              <SearchX className="mx-auto size-8 text-muted-foreground" />
              <p className="mt-3 font-semibold">Catálogo em atualização</p>
              <p className="mt-1 text-sm text-muted-foreground">Os produtos voltam em instantes. Enquanto isso, conte o que você precisa pela página de contato.</p>
            </div>
          ) : list.length === 0 ? (
            <div className="rounded-md border border-dashed py-16 text-center">
              <SearchX className="mx-auto size-8 text-muted-foreground" />
              <p className="mt-3 font-semibold">Nenhum produto encontrado</p>
              <p className="mt-1 text-sm text-muted-foreground">Tente outros termos ou fale com um consultor.</p>
            </div>
          ) : (
            <div className="mag-catalog-grid grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3 xl:grid-cols-4">
              {visible.map((p) => <ProductCard key={p.slug} product={p} />)}
            </div>
          )}
          {pages > 1 && <nav aria-label="Páginas do catálogo" className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-40">Anterior</button>
            <span className="text-sm text-muted-foreground">Página {currentPage} de {pages}</span>
            <button type="button" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)} className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-40">Próxima</button>
          </nav>}
        </div>
      </div>
    </div>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="technical-label mb-4 text-sm font-semibold">{title}</legend>
      <div className="space-y-2">{children}</div>
    </fieldset>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-sm text-muted-foreground hover:text-foreground">
      <input type="checkbox" checked={checked} onChange={onChange} className="size-4 accent-[var(--brand)]" />
      {label}
    </label>
  );
}
