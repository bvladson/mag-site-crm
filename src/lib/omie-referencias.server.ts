/**
 * Referências do Omie para o Pedido de Venda (vendedores, etapas, formas de pagamento, categorias e contas), a
 * configuração escolhida pelo Admin e o vínculo usuário do painel → vendedor do Omie (sempre confirmado por um Admin).
 * Usado pelo painel e pelo cron diário (scripts/omie-referencias.mjs): por isso só imports relativos que o Node roda direto.
 * Falha do Omie nunca apaga o cache: fica o último válido e o erro (só o motivo) é registrado.
 */
import { getDb, transaction, audit } from "./local-db.server.ts";
import { servicoOmie } from "./omie-pedidos-cliente.server.ts";

type Linha = Record<string, unknown>;
type Vendedor = { codigo: string; codInt: string; nome: string; email: string; inativo: boolean; faturaPedido: boolean; visualizaPedido: boolean };
type Etapa = { operacao: string; codigo: string; descricao: string; descricaoPadrao: string; inativo: boolean };
type Forma = { codigo: string; descricao: string; parcelas: number };
type Categoria = { codigo: string; descricao: string; totalizadora: boolean; inativa: boolean };
type Conta = { codigo: string; descricao: string; tipo: string; inativo: boolean };

/** Venda de Produto no Omie; só ela gera Pedido de Venda. Etapas 50+ (faturar/faturado/entrega) nunca são usadas. */
export const OPERACAO_VENDA = "11";
export const ETAPAS_PAINEL = ["10", "20", "30", "40"];

/**
 * Padrões do Admin. NÃO há conta corrente padrão (09/10/2026): a conta é escolhida em cada venda, no orçamento, e congelada na
 * versão aceita (a chave antiga "conta" em omie_settings não é mais lida).
 */
export type Configuracao = {
  etapa: string; formaPagamento: string; categoria: string; consumidorFinal: "S" | "N";
  /** Pedido com quantidade acima do disponível: confirmar (padrão), permitir sem pergunta ou bloquear. */
  semEstoque: "confirmar" | "permitir" | "bloquear";
};
const PADRAO: Configuracao = { etapa: "", formaPagamento: "", categoria: "", consumidorFinal: "S", semEstoque: "confirmar" };
const CHAVES = Object.keys(PADRAO) as (keyof Configuracao)[];

export function lerConfiguracao(): Configuracao {
  const linhas = getDb().prepare("SELECT key, value FROM omie_settings").all() as Linha[];
  const mapa = new Map(linhas.map((l) => [String(l["key"]), String(l["value"])]));
  const config = { ...PADRAO };
  for (const chave of CHAVES) if (mapa.has(chave)) (config as Record<string, string>)[chave] = mapa.get(chave)!;
  return config;
}
function lerValor(chave: string) {
  return (getDb().prepare("SELECT value FROM omie_settings WHERE key=?").get(chave) as Linha | undefined)?.["value"] as string | undefined;
}
function gravarValor(chave: string, valor: string, ator: string | null) {
  getDb().prepare(`INSERT INTO omie_settings(key,value,updated_at,updated_by) VALUES (?,?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by`)
    .run(chave, valor, new Date().toISOString(), ator);
}

type Extra = Record<string, string | number | boolean | null>;
export type Referencia = { codigo: string; descricao: string; inativo: boolean; extra: Extra };
export function referencias(tipo: "etapa" | "forma_pagamento" | "categoria" | "conta"): Referencia[] {
  return (getDb().prepare("SELECT code, label, extra, inactive FROM omie_refs WHERE kind=? ORDER BY code").all(tipo) as Linha[]).map((l) => ({
    codigo: String(l["code"]), descricao: String(l["label"]), inativo: Boolean(l["inactive"]), extra: JSON.parse(String(l["extra"] ?? "{}")) as Extra,
  }));
}
const referencia = (tipo: "etapa" | "forma_pagamento" | "categoria" | "conta", codigo: string) => referencias(tipo).find((r) => r.codigo === codigo && !r.inativo) ?? null;

/** O que o Admin pode escolher (e o que o pedido pode usar): etapas 10–40 da Venda de Produto, formas ≠ 999, categorias lançáveis. */
export function opcoesValidas() {
  return {
    etapas: referencias("etapa").filter((r) => !r.inativo && ETAPAS_PAINEL.includes(r.codigo)),
    formasPagamento: referencias("forma_pagamento").filter((r) => !r.inativo && r.codigo !== "999"),
    categorias: referencias("categoria").filter((r) => !r.inativo),
    contas: referencias("conta").filter((r) => !r.inativo),
  };
}

export function salvarConfiguracao(ator: string, dados: Configuracao) {
  const opcoes = opcoesValidas();
  const erros: string[] = [];
  if (dados.etapa && !opcoes.etapas.some((r) => r.codigo === dados.etapa)) erros.push("etapa inválida (só 10 a 40 da Venda de Produto)");
  if (dados.formaPagamento && !opcoes.formasPagamento.some((r) => r.codigo === dados.formaPagamento)) erros.push("condição de pagamento inválida");
  if (dados.categoria && !opcoes.categorias.some((r) => r.codigo === dados.categoria)) erros.push("categoria inválida");
  if (erros.length) throw new Error(erros.join("; "));
  transaction(() => {
    for (const chave of CHAVES) gravarValor(chave, String(dados[chave]), ator);
    audit(ator, "omie_settings:changed", null, { etapa: dados.etapa || null, forma: dados.formaPagamento || null, categoria: dados.categoria || null, consumidorFinal: dados.consumidorFinal, semEstoque: dados.semEstoque });
  });
  return lerConfiguracao();
}

// ---------- Sincronização (cron 05:40 e botão "Atualizar dados do Omie agora") ----------
function gravarReferencias(tipo: "etapa" | "forma_pagamento" | "categoria" | "conta", linhas: { codigo: string; descricao: string; inativo: boolean; extra?: Linha }[], agora: string) {
  const db = getDb();
  const inserir = db.prepare(`INSERT INTO omie_refs(kind,code,label,extra,inactive,synced_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(kind,code) DO UPDATE SET label=excluded.label, extra=excluded.extra, inactive=excluded.inactive, synced_at=excluded.synced_at`);
  for (const l of linhas) inserir.run(tipo, l.codigo, l.descricao || "(sem descrição)", JSON.stringify(l.extra ?? {}), l.inativo ? 1 : 0, agora);
  // O que o Omie deixou de devolver fica marcado como inativo (nunca apagado: a configuração antiga mostra que sumiu).
  db.prepare("UPDATE omie_refs SET inactive=1 WHERE kind=? AND synced_at<>?").run(tipo, agora);
}

export async function sincronizarReferencias(ator: string | null) {
  const agora = new Date().toISOString();
  const inicio = Date.now();
  const erros: string[] = [];
  const contagem: Record<string, number> = {};

  const v = await servicoOmie("/vendedores");
  const vendedores = Array.isArray(v["vendedores"]) ? (v["vendedores"] as Vendedor[]) : null;
  if (v.ok && vendedores && vendedores.length) {
    transaction(() => {
      const db = getDb();
      const inserir = db.prepare(`INSERT INTO omie_sellers(omie_seller_id,integration_code,name,email,inactive,can_invoice,own_orders_only,last_synced_at,missing_since)
        VALUES (?,?,?,?,?,?,?,?,NULL) ON CONFLICT(omie_seller_id) DO UPDATE SET integration_code=excluded.integration_code, name=excluded.name,
        email=excluded.email, inactive=excluded.inactive, can_invoice=excluded.can_invoice, own_orders_only=excluded.own_orders_only,
        last_synced_at=excluded.last_synced_at, missing_since=NULL`);
      for (const s of vendedores) inserir.run(s.codigo, s.codInt || null, s.nome || `Vendedor ${s.codigo}`, s.email || null, s.inativo ? 1 : 0, s.faturaPedido ? 1 : 0, s.visualizaPedido ? 1 : 0, agora);
      // Vendedor que sumiu do Omie: marcado (nunca apagado) e deixa de poder ser usado.
      db.prepare("UPDATE omie_sellers SET missing_since=COALESCE(missing_since, ?) WHERE last_synced_at<>?").run(agora, agora);
    });
    contagem["vendedores"] = vendedores.length;
    contagem["vendedoresAtivos"] = vendedores.filter((s) => !s.inativo).length;
  } else erros.push(`vendedores:${v.ok ? "lista_vazia" : v.motivo}`);

  const e = await servicoOmie("/etapas");
  if (e.ok && Array.isArray(e["etapas"])) {
    const etapas = (e["etapas"] as Etapa[]).filter((x) => x.operacao === OPERACAO_VENDA && /^\d{2}$/.test(x.codigo));
    transaction(() => gravarReferencias("etapa", etapas.map((x) => ({ codigo: x.codigo, descricao: x.descricao || x.descricaoPadrao, inativo: x.inativo, extra: { padrao: x.descricaoPadrao } })), agora));
    contagem["etapas"] = etapas.length;
  } else erros.push(`etapas:${e.motivo}`);

  const f = await servicoOmie("/formas-pagamento");
  if (f.ok && Array.isArray(f["formas"])) {
    const formas = f["formas"] as Forma[];
    transaction(() => gravarReferencias("forma_pagamento", formas.map((x) => ({ codigo: x.codigo, descricao: x.descricao, inativo: false, extra: { parcelas: x.parcelas } })), agora));
    contagem["formasPagamento"] = formas.length;
  } else erros.push(`formas:${f.motivo}`);

  const c = await servicoOmie("/categorias");
  if (c.ok && Array.isArray(c["categorias"])) {
    const categorias = (c["categorias"] as Categoria[]).filter((x) => !x.totalizadora);
    transaction(() => gravarReferencias("categoria", categorias.map((x) => ({ codigo: x.codigo, descricao: x.descricao, inativo: x.inativa })), agora));
    contagem["categorias"] = categorias.length;
  } else erros.push(`categorias:${c.motivo}`);

  const k = await servicoOmie("/contas");
  if (k.ok && Array.isArray(k["contas"])) {
    const contas = k["contas"] as Conta[];
    transaction(() => gravarReferencias("conta", contas.map((x) => ({ codigo: x.codigo, descricao: x.descricao, inativo: x.inativo, extra: { tipo: x.tipo } })), agora));
    contagem["contas"] = contas.length;
  } else erros.push(`contas:${k.motivo}`);

  transaction(() => {
    if (!erros.length) gravarValor("referencias_em", agora, ator);
    gravarValor("referencias_tentativa_em", agora, ator);
    gravarValor("referencias_erro", erros.join(","), ator);
    audit(ator, "omie_reference:sync", null, { ...contagem, erros: erros.join(",") || null, ms: Date.now() - inicio });
  });
  return { ok: erros.length === 0, ...contagem, erros, em: agora };
}

export function situacaoReferencias() {
  return { sincronizadoEm: lerValor("referencias_em") ?? null, tentativaEm: lerValor("referencias_tentativa_em") ?? null, erro: lerValor("referencias_erro") || null };
}

// ---------- Vendedores e vínculo usuário → vendedor ----------
export type VendedorOmie = { codigo: string; nome: string; email: string | null; inativo: boolean; removido: boolean; faturaPedido: boolean };
const vendedor = (l: Linha): VendedorOmie => ({
  codigo: String(l["omie_seller_id"]), nome: String(l["name"]), email: (l["email"] as string | null) ?? null, inativo: Boolean(l["inactive"]),
  removido: Boolean(l["missing_since"]), faturaPedido: Boolean(l["can_invoice"]),
});
export function vendedores(): VendedorOmie[] {
  return (getDb().prepare("SELECT * FROM omie_sellers ORDER BY inactive, name").all() as Linha[]).map(vendedor);
}
const normalizar = (texto: string) => texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const palavras = (texto: string) => normalizar(texto).split(/[^a-z0-9]+/).filter((p) => p.length >= 3);

/**
 * Sugestões (NUNCA vínculo automático): e-mail idêntico ou o 1º nome do e-mail igual ao 1º nome do vendedor.
 * Só vendedores ativos e presentes no Omie. Nomes parecidos (ex.: "CAIO", "CAIO - VAR", "CAIO - REV") aparecem juntos.
 */
export function sugestoesDeVinculo(email: string, lista: VendedorOmie[]) {
  const usaveis = lista.filter((s) => !s.inativo && !s.removido);
  const exatos = usaveis.filter((s) => s.email && s.email.toLowerCase() === email.toLowerCase()).map((s) => ({ ...s, motivo: "e-mail igual" }));
  const local = palavras(email.split("@")[0] ?? "");
  const porNome = local.length ? usaveis.filter((s) => !exatos.some((x) => x.codigo === s.codigo) && palavras(s.nome)[0] === local[0])
    .map((s) => ({ ...s, motivo: "nome parecido" })) : [];
  return [...exatos, ...porNome].slice(0, 6);
}

export function vinculosDoPainel() {
  const db = getDb();
  const lista = vendedores();
  const porCodigo = new Map(lista.map((s) => [s.codigo, s]));
  const usuarios = (db.prepare("SELECT id, email, roles FROM users WHERE disabled=0 ORDER BY email").all() as Linha[])
    .map((u) => ({ id: String(u["id"]), email: String(u["email"]), roles: JSON.parse(String(u["roles"] ?? "[]")) as string[] }))
    .filter((u) => u.roles.includes("admin") || u.roles.includes("comercial"));
  const vinculos = new Map((db.prepare("SELECT * FROM seller_links").all() as Linha[]).map((l) => [String(l["user_id"]), l]));
  return usuarios.map((u) => {
    const v = vinculos.get(u.id);
    const s = v ? porCodigo.get(String(v["omie_seller_id"])) ?? null : null;
    return {
      usuario: u, vendedor: s, confirmadoEm: (v?.["confirmed_at"] as string | undefined) ?? null,
      sugestoes: v ? [] : sugestoesDeVinculo(u.email, lista),
    };
  });
}

export function confirmarVinculo(ator: string, usuarioId: string, codigoVendedor: string) {
  const db = getDb();
  const usuario = db.prepare("SELECT id, roles FROM users WHERE id=? AND disabled=0").get(usuarioId) as Linha | undefined;
  if (!usuario) throw new Error("Usuário não encontrado");
  const roles = JSON.parse(String(usuario["roles"] ?? "[]")) as string[];
  if (!roles.includes("admin") && !roles.includes("comercial")) throw new Error("Só usuários Admin ou Comercial têm vendedor");
  const s = db.prepare("SELECT * FROM omie_sellers WHERE omie_seller_id=?").get(codigoVendedor) as Linha | undefined;
  if (!s) throw new Error("Vendedor não encontrado no cadastro sincronizado do Omie");
  if (s["inactive"] || s["missing_since"]) throw new Error("Vendedor inativo ou removido no Omie não pode ser vinculado");
  return transaction(() => {
    const anterior = db.prepare("SELECT omie_seller_id FROM seller_links WHERE user_id=?").get(usuarioId) as Linha | undefined;
    db.prepare(`INSERT INTO seller_links(user_id,omie_seller_id,confirmed_by,confirmed_at) VALUES (?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET omie_seller_id=excluded.omie_seller_id, confirmed_by=excluded.confirmed_by, confirmed_at=excluded.confirmed_at`)
      .run(usuarioId, codigoVendedor, ator, new Date().toISOString());
    audit(ator, "seller_mapping:changed", usuarioId, { vendedor: codigoVendedor, anterior: (anterior?.["omie_seller_id"] as string | undefined) ?? null });
    return { ok: true };
  });
}

export function removerVinculo(ator: string, usuarioId: string) {
  return transaction(() => {
    const anterior = getDb().prepare("SELECT omie_seller_id FROM seller_links WHERE user_id=?").get(usuarioId) as Linha | undefined;
    getDb().prepare("DELETE FROM seller_links WHERE user_id=?").run(usuarioId);
    audit(ator, "seller_mapping:changed", usuarioId, { vendedor: null, anterior: (anterior?.["omie_seller_id"] as string | undefined) ?? null });
    return { ok: true };
  });
}

/** Vendedor confirmado de um usuário (o dono do orçamento) — null se não houver vínculo. */
export function vendedorDoUsuario(usuarioId: string): VendedorOmie | null {
  const l = getDb().prepare("SELECT s.* FROM seller_links v JOIN omie_sellers s ON s.omie_seller_id=v.omie_seller_id WHERE v.user_id=?").get(usuarioId) as Linha | undefined;
  return l ? vendedor(l) : null;
}
export { referencia };
