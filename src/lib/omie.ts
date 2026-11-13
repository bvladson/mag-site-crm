/**
 * PONTO DE INTEGRAÇÃO OMIE (isolado)
 * ---------------------------------------------------------------
 * O site só lê o catálogo gerado pelo worker `scripts/sync-omie.mjs`, que roda
 * de madrugada e é o único a conhecer app_key/app_secret. Nenhuma visita
 * consulta o Omie e nenhuma credencial chega ao navegador.
 * O estoque exato NÃO vai ao cliente: apenas `stock` (PRONTA_ENTREGA | DISPONIVEL | SOB_CONSULTA); desde 05/10/2026
 * nem a quantidade disponível sai nos dados públicos (a ordenação da home que a usa roda no servidor).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Product, ProductSummary } from "@/data/catalog";

const readIndex = createServerFn({ method: "GET" }).handler(async () => {
  const { readCatalogIndex } = await import("@/lib/omie.server");
  return readCatalogIndex();
});

const readOne = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => z.string().min(1).max(200).regex(/^[a-z0-9-]+$/).parse(data))
  .handler(async ({ data }) => {
    const { readProduct, resolveProductRedirect } = await import("@/lib/omie.server");
    const product = await readProduct(data);
    return { product: product ?? null, redirectTo: product ? null : await resolveProductRedirect(data) };
  });

const readShowcase = createServerFn({ method: "GET" }).handler(async () => {
  const { readHomeShowcase } = await import("@/lib/omie.server");
  return readHomeShowcase();
});

/** Vitrines da home já ordenadas no servidor (o desempate usa a quantidade disponível, que não vai ao navegador). */
export async function homeShowcase(): Promise<{ ready: string[]; featured: string[] }> {
  return readShowcase();
}

/** Lista leve (sem descrição e só com a foto de capa) para vitrines, busca e orçamento. */
export async function listProducts(): Promise<ProductSummary[]> {
  return readIndex();
}

/** Produto pelo slug canônico; para URL antiga (produto-<id> ou slug anterior) devolve o slug atual. */
export async function lookupProduct(slug: string): Promise<{ product: Product | null; redirectTo: string | null }> {
  return readOne({ data: slug });
}
