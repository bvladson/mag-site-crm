/**
 * Consulta rápida (painel interno): busca LOCAL no catálogo sincronizado e no cadastro completo do Omie — nunca chama o Omie.
 * Mesma função no navegador (filtra a cada tecla) e na API interna (?q=). Sem imports: roda direto no Node nos testes.
 */
export type EstoqueSelo = "PRONTA_ENTREGA" | "DISPONIVEL" | "SOB_CONSULTA";
export type ProdutoInterno = {
  id: string;
  /** Endereço do produto no site; null = fora do site. */
  slug: string | null;
  sku: string; nome: string; nomeOmie: string;
  /** Categoria do site ("" = nenhuma). Fora do site: a mesma regra de categoria do catálogo, quando o nome a indica. */
  categoria: string;
  marca: string; familia: string;
  /** EAN/código de barras do cadastro do Omie ("" = sem código). */
  ean: string;
  unidade: string;
  /** Foto pequena (vitrine, 480 px) e a grande (página do produto, 1200 px): as mesmas do site, já locais; fora do site, a imagem neutra. */
  imagem: string; foto: string;
  /** Selo da sincronização; null = fora do site (estoque não calculado à noite: só pelo "Consultar Omie agora"). */
  estoque: EstoqueSelo | null;
  /** INTERNO: disponível para venda na última sincronização (null = sem posição no local padrão, ou fora do site). */
  disponivel: number | null;
  publicado: boolean;
  inativo: boolean;
  bloqueado: boolean;
};

export const CATEGORIAS: Record<string, string> = {
  cadeiras: "Cadeiras", mesas: "Mesas", estacoes: "Estações de trabalho", reuniao: "Reunião", recepcao: "Recepção",
  armazenamento: "Armazenamento", escolar: "Escolar", "home-office": "Home office", pecas: "Peças e reposição", outros: "Outros",
};

export const FILTROS = [
  { id: "todos", rotulo: "Todos" }, { id: "com-estoque", rotulo: "Com estoque" }, { id: "sem-estoque", rotulo: "Sem estoque" },
  { id: "cadeiras", rotulo: "Cadeiras" }, { id: "mesas", rotulo: "Mesas" }, { id: "armazenamento", rotulo: "Armários" },
  { id: "estacoes", rotulo: "Estações" }, { id: "pecas", rotulo: "Peças/reposição" },
] as const;
export type FiltroId = (typeof FILTROS)[number]["id"];
export const MAX_CONSULTA = 120;

export function filtroValido(valor: unknown): FiltroId {
  return FILTROS.some((filtro) => filtro.id === valor) ? (valor as FiltroId) : "todos";
}

export function normalizar(texto: string) {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Palavras da busca: sem acento, sem pontuação, no máximo 8 (busca muito longa é cortada em 120 caracteres). */
export function termos(consulta: string) {
  return normalizar(String(consulta ?? "").slice(0, MAX_CONSULTA)).split(/[^a-z0-9]+/).filter(Boolean).slice(0, 8);
}

const semZeros = (valor: string) => valor.replace(/^0+(?=\d)/, "");
type Chave = { texto: string; nome: string; sku: string; skuCurto: string; id: string; ean: string };
const chaves = new WeakMap<ProdutoInterno, Chave>();
function chaveDe(produto: ProdutoInterno): Chave {
  let chave = chaves.get(produto);
  if (!chave) {
    const sku = normalizar(produto.sku);
    chave = {
      texto: normalizar([produto.nome, produto.nomeOmie, produto.sku, semZeros(produto.sku), produto.id, produto.marca, produto.familia,
        produto.ean, CATEGORIAS[produto.categoria] ?? ""].join(" ")),
      nome: normalizar(produto.nome), sku, skuCurto: semZeros(sku.replace(/[^a-z0-9]/g, "")), id: produto.id, ean: produto.ean,
    };
    chaves.set(produto, chave);
  }
  return chave;
}

function passaFiltro(produto: ProdutoInterno, filtro: FiltroId) {
  if (filtro === "todos") return true;
  if (filtro === "com-estoque") return produto.disponivel !== null && produto.disponivel > 0;
  // Fora do site o estoque não é calculado à noite: não entra em "Sem estoque" (seria um "zero" que ninguém conferiu).
  if (filtro === "sem-estoque") return produto.estoque !== null && !(produto.disponivel !== null && produto.disponivel > 0);
  return produto.categoria === filtro;
}

const ativo = (produto: ProdutoInterno) => !produto.inativo && !produto.bloqueado;

/**
 * Todas as palavras precisam aparecer (em qualquer ordem) no nome, nome do Omie, SKU, código do Omie, marca, família,
 * EAN ou categoria. Ordem: SKU/código/EAN exato → SKU começando pela busca → nome começando pela busca → frase no nome
 * → demais; no empate, publicados no site e ativos primeiro.
 */
export function buscarProdutos(lista: ProdutoInterno[], consulta: string, filtro: FiltroId = "todos", limite = 60) {
  const palavras = termos(consulta);
  const frase = palavras.join(" ");
  const junta = palavras.join("");
  const compacta = semZeros(junta);
  const achados: { produto: ProdutoInterno; pontos: number }[] = [];
  for (const produto of lista) {
    if (!passaFiltro(produto, filtro)) continue;
    if (!palavras.length) { achados.push({ produto, pontos: 0 }); continue; }
    const chave = chaveDe(produto);
    if (!palavras.every((palavra) => chave.texto.includes(palavra) || (/^\d+$/.test(palavra) && chave.skuCurto === semZeros(palavra)))) continue;
    let pontos = 100;
    if (chave.skuCurto === compacta || chave.id === frase || chave.sku === frase || (chave.ean !== "" && chave.ean === junta)) pontos = 1000;
    else if (chave.sku.startsWith(palavras[0]!)) pontos = 500;
    else if (chave.nome.startsWith(frase)) pontos = 300;
    else if (chave.nome.includes(frase)) pontos = 200;
    achados.push({ produto, pontos });
  }
  achados.sort((a, b) => b.pontos - a.pontos || Number(b.produto.publicado) - Number(a.produto.publicado)
    || Number(ativo(b.produto)) - Number(ativo(a.produto)) || a.produto.nome.localeCompare(b.produto.nome, "pt-BR"));
  return { total: achados.length, itens: achados.slice(0, limite).map((achado) => achado.produto) };
}

/** Quantidade para exibição interna (até 3 casas, vírgula decimal). */
export function quantidade(valor: number | null | undefined, unidade = "UN") {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return "—";
  return `${valor.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} ${unidade}`;
}
