import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { readInternalCatalog } from "./omie.server";
import { audit, consumeRateLimit } from "./local-db.server";
import type { ProdutoInterno } from "./produtos-busca";

/**
 * Consulta rápida — USO INTERNO (Admin e Comercial; as rotas conferem sessão e perfil no servidor).
 * Busca: só arquivos locais, nenhuma chamada ao Omie — o catálogo publicado (com o disponível da sincronização) e, para
 * "Mostrar todos os produtos do Omie", o cadastro completo gerado às 05:20 (scripts/omie-indice.mjs: só metadados,
 * sem estoque nem foto). "Consultar Omie agora": pelo serviço interno omie-consulta (com as chaves), cache de 5 min
 * compartilhado, limite por usuário e pausa durante a sincronização noturna. Nenhuma página pública usa este módulo.
 * Falha do Omie nunca vira erro 500: a resposta diz o motivo e devolve a última sincronização.
 */
const PLACEHOLDER = "/images/product-placeholder.svg";

// Cadastro completo do Omie (catalog/interno/omie-produtos.json). Arquivo inválido nunca substitui o último bom.
const cadastroSchema = z.object({
  schemaVersion: z.literal(1), geradoEm: z.string().datetime(),
  produtos: z.array(z.object({
    id: z.string().regex(/^\d{1,20}$/), sku: z.string().max(100), nome: z.string().max(240),
    ean: z.string().regex(/^(\d{8}|\d{12,14})?$/), marca: z.string().max(120), familia: z.string().max(120),
    unidade: z.string().max(8), categoria: z.string().max(30), inativo: z.boolean(), bloqueado: z.boolean(),
  })).max(200000),
});
type Cadastro = z.infer<typeof cadastroSchema> & { porId: Map<string, z.infer<typeof cadastroSchema>["produtos"][number]> };
let cadastroLido: { caminho: string; mtime: number; valor: Cadastro } | null = null;
let ultimaFalhaCadastro: { erro: string; em: string } | null = null;
let conferido = { caminho: "", em: 0 };

const pastaInterna = () => resolve(process.env["OMIE_INDICE_DIR"]
  || join(dirname(resolve(process.env["OMIE_CATALOG_PATH"] || "./data/catalog.json")), "interno"));

async function lerCadastro(): Promise<Cadastro | null> {
  const pasta = pastaInterna();
  const caminho = join(pasta, "omie-produtos.json");
  if (conferido.caminho !== caminho || Date.now() - conferido.em > 15000) {
    conferido = { caminho, em: Date.now() };
    try {
      const arquivo = await stat(caminho);
      if (arquivo.size > 64 * 1024 * 1024) throw new Error("cadastro_grande");
      if (cadastroLido?.caminho !== caminho || cadastroLido.mtime !== arquivo.mtimeMs) {
        const valor = cadastroSchema.parse(JSON.parse(await readFile(caminho, "utf8")));
        cadastroLido = { caminho, mtime: arquivo.mtimeMs, valor: { ...valor, porId: new Map(valor.produtos.map((item) => [item.id, item])) } };
      }
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") console.warn("[consulta-rapida] Cadastro completo do Omie ilegível; mantendo o último válido.");
    }
    try {
      const status = JSON.parse(await readFile(join(pasta, "omie-produtos.status.json"), "utf8")) as { estado?: unknown; erro?: unknown; ultimaTentativa?: unknown };
      ultimaFalhaCadastro = status.estado === "erro" && typeof status.ultimaTentativa === "string"
        ? { erro: String(status.erro ?? "erro").replace(/[^a-z0-9_]/gi, "").slice(0, 60), em: status.ultimaTentativa } : null;
    } catch {
      ultimaFalhaCadastro = null;
    }
  }
  return cadastroLido?.caminho === caminho ? cadastroLido.valor : null;
}

/**
 * Índice da Consulta rápida: os publicados no site (com o disponível da sincronização e o EAN/família do cadastro
 * completo) e, com `todos`, também os demais produtos do Omie — sem estoque calculado e com a imagem neutra
 * (fotos locais só existem para quem está no site: o sincronizador apaga as dos que saem).
 */
export async function indiceInterno({ todos = false }: { todos?: boolean } = {}) {
  const [catalogo, completo] = await Promise.all([readInternalCatalog(), lerCadastro()]);
  const itens: ProdutoInterno[] = (catalogo?.products ?? []).flatMap((produto): ProdutoInterno[] => {
    if (!produto.id) return [];
    const omie = completo?.porId.get(produto.id);
    return [{
      id: produto.id, slug: produto.slug, sku: produto.sku, nome: produto.name, nomeOmie: produto.omieName ?? produto.name,
      categoria: produto.category, marca: produto.brand || omie?.marca || "", familia: omie?.familia ?? "", ean: omie?.ean ?? "",
      unidade: produto.unit || "UN", imagem: produto.image || PLACEHOLDER, foto: produto.images[0] || produto.image || PLACEHOLDER,
      estoque: produto.stock, disponivel: produto.available ?? null, publicado: true, inativo: false, bloqueado: false,
    }];
  });
  let foraDoSite = 0;
  if (completo) {
    const publicados = new Set(itens.map((item) => item.id));
    for (const omie of completo.produtos) {
      if (publicados.has(omie.id)) continue;
      foraDoSite += 1;
      if (todos) {
        itens.push({
          id: omie.id, slug: null, sku: omie.sku, nome: omie.nome, nomeOmie: omie.nome, categoria: omie.categoria, marca: omie.marca,
          familia: omie.familia, ean: omie.ean, unidade: omie.unidade || "UN", imagem: PLACEHOLDER, foto: PLACEHOLDER,
          estoque: null, disponivel: null, publicado: false, inativo: omie.inativo, bloqueado: omie.bloqueado,
        });
      }
    }
  }
  const idade = completo ? Date.now() - Date.parse(completo.geradoEm) : 0;
  const cadastro = completo ? {
    geradoEm: completo.geradoEm, total: completo.produtos.length, foraDoSite,
    // Mais de 30 h = a atualização das 05:20 não deu certo (o painel avisa e segue com o último cadastro bom).
    fresco: idade >= -300000 && idade <= 30 * 3600 * 1000,
    ultimaFalha: ultimaFalhaCadastro && Date.parse(ultimaFalhaCadastro.em) > Date.parse(completo.geradoEm) ? ultimaFalhaCadastro.erro : null,
  } : null;
  return { sincronizadoEm: catalogo?.generatedAt ?? null, fresco: catalogo?.fresh ?? false, cadastro, itens };
}

/** Um produto do índice (publicado ou só do cadastro completo do Omie). */
export async function produtoInterno(id: string) {
  const indice = await indiceInterno({ todos: true });
  const produto = indice.itens.find((item) => item.id === id) ?? null;
  return { produto, sincronizadoEm: indice.sincronizadoEm, fresco: indice.fresco, ultimaConsulta: produto ? emCache(id) : null };
}

type Local = { id: string; nome: string; comercial: boolean; padrao: boolean; saldo: number | null; fisico: number | null; pendente: number | null; reservado: number | null };
type Resumo = { conhecido: boolean; brutoComercial: number; pendentes: number; reservas: number; comprometido: number; disponivel: number | null; totalFisico: number };
export type ConsultaOk = { ok: true; fonte: "omie" | "cache"; consultadoEm: string; omie: { sku: string; descricao: string } | null; locais: Local[]; resumo: Resumo };
export type ConsultaFalha = { ok: false; motivo: string; mensagem: string; ultimaSincronizacao: string | null };

const MENSAGENS: Record<string, string> = {
  sincronizacao: "A sincronização diária com o Omie está em andamento. Tente de novo em alguns minutos.",
  limite_usuario: "Muitas consultas ao Omie em pouco tempo. Aguarde alguns minutos.",
  bloqueado: "O Omie pediu uma pausa nas consultas. Tente de novo mais tarde.",
  pausado: "As consultas ao Omie estão em pausa por alguns minutos (proteção da integração).",
  limite: "O Omie pediu uma pausa nas consultas. Tente de novo em alguns minutos.",
  teto_horario: "Limite de consultas ao Omie por hora atingido. Tente mais tarde.",
  nao_configurado: "A consulta ao Omie não está disponível neste servidor.",
  credenciais: "A consulta ao Omie não está disponível no momento.",
  indisponivel: "O Omie não respondeu a tempo. Tente de novo em instantes.",
  omie_erro: "O Omie não concluiu esta consulta. Tente de novo em instantes.",
};
const mensagem = (motivo: string) => MENSAGENS[motivo] ?? "Não foi possível consultar o Omie agora.";

const cache = new Map<string, { em: number; valor: ConsultaOk }>();
const cacheMs = () => Math.min(900, Math.max(60, Number(process.env["OMIE_CONSULTA_CACHE_SECONDS"]) || 300)) * 1000;
function emCache(id: string): ConsultaOk | null {
  const item = cache.get(id);
  if (!item) return null;
  if (Date.now() - item.em > cacheMs()) { cache.delete(id); return null; }
  return { ...item.valor, fonte: "cache" };
}

/** A sincronização noturna está rodando? (trava do worker ao lado do catálogo) — então o site não chama o Omie. */
function sincronizando() {
  return existsSync(`${resolve(process.env["OMIE_CATALOG_PATH"] || "./data/catalog.json")}.lock`);
}

export async function consultarOmie(id: string, usuarioId: string): Promise<ConsultaOk | ConsultaFalha> {
  const { sincronizadoEm } = await indiceInterno();
  const falha = (motivo: string, registrar = true): ConsultaFalha => {
    if (registrar) audit(usuarioId, `omie:consulta:erro:${motivo}`, id);
    return { ok: false, motivo, mensagem: mensagem(motivo), ultimaSincronizacao: sincronizadoEm };
  };
  const recente = emCache(id);
  if (recente) return recente;
  const url = process.env["OMIE_CONSULTA_URL"];
  const token = process.env["OMIE_CONSULTA_TOKEN"];
  if (!url || !token) return falha("nao_configurado", false);
  if (sincronizando()) return falha("sincronizacao", false);
  const quem = createHash("sha256").update(usuarioId).digest("hex");
  if (!consumeRateLimit(`omie-consulta:${quem}`, 30, 600)) return falha("limite_usuario", false);
  let resposta: unknown;
  try {
    const http = await fetch(`${url.replace(/\/$/, "")}/estoque/${id}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(25000) });
    resposta = await http.json();
  } catch {
    return falha("indisponivel");
  }
  const corpo = resposta as Partial<ConsultaOk> & { motivo?: string };
  if (!corpo || corpo.ok !== true || !Array.isArray(corpo.locais) || !corpo.resumo || typeof corpo.consultadoEm !== "string") {
    return falha(typeof corpo?.motivo === "string" ? corpo.motivo.replace(/[^a-z_]/g, "").slice(0, 40) || "omie_erro" : "omie_erro");
  }
  const valor: ConsultaOk = {
    ok: true, fonte: corpo.fonte === "cache" ? "cache" : "omie", consultadoEm: corpo.consultadoEm, omie: corpo.omie ?? null,
    locais: corpo.locais, resumo: corpo.resumo,
  };
  if (valor.fonte === "omie") audit(usuarioId, "omie:consulta", id);
  cache.set(id, { em: Date.parse(valor.consultadoEm) || Date.now(), valor });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return valor;
}
