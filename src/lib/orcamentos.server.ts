/**
 * Orçamento interno (painel, só Admin e Comercial). Comercial vê e altera só os próprios; Admin vê todos.
 * Número MAG-Q-AAAA-NNNNN criado uma vez e nunca alterado (é o código de integração do Pedido no Omie).
 * Preços digitados pelo Comercial; o servidor recalcula tudo e relê nome/SKU/unidade do produto no índice interno.
 * Nada é apagado: orçamento só é cancelado; depois de aceito, itens e preços ficam travados.
 */
import { randomUUID } from "node:crypto";
import { getDb, transaction, audit, readLead } from "./local-db.server.ts";
import type { SiteUser } from "./local-auth-core.server.ts";
import {
  calcularItem, calcularTotais, centavos, quantidade, percentual, documentoValido, digitos, hojeFortaleza, numeroOrcamento,
  proximoEstado, editavel, type Acao, type Estado, type DescontoTipo,
} from "./orcamento-regras.ts";
import { referencia, referencias } from "./omie-referencias.server.ts";
import { hashDoOrcamento, hashDoPedido, itensDo, versaoVigente } from "./proposta-conteudo.server.ts";
import { assignmentsSchema, leadAssignment, validateAssignedOwner } from "./assignments.server.ts";
import { requireActiveUser } from "./local-auth-core.server.ts";
import { assertDiscountApproval, assertDiscountCeiling } from "./discounts.server.ts";

type Linha = Record<string, unknown>;
const agoraIso = () => new Date().toISOString();
const texto = (valor: unknown, max: number) => String(valor ?? "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").trim().slice(0, max);

export const ehAdmin = (u: SiteUser) => u.roles.includes("admin");
function carregar(id: string) {
  const q = getDb().prepare("SELECT * FROM internal_quotes WHERE id=?").get(id) as Linha | undefined;
  if (!q) throw new Error("Orçamento não encontrado");
  return q;
}
/** Comercial só mexe nos próprios orçamentos; Admin em todos. */
export function orcamentoDoUsuario(u: SiteUser, id: string) {
  u = requireActiveUser(u, ["admin", "comercial"]);
  const q = carregar(id);
  if (!ehAdmin(u) && q["owner_id"] !== u.id) throw new Error("Forbidden: este orçamento é de outro usuário");
  return q;
}
function pedidoOmie(quoteId: string) {
  return (getDb().prepare("SELECT * FROM omie_orders WHERE quote_id=?").get(quoteId) as Linha | undefined) ?? null;
}

function numeroNovo() {
  const ano = Number(hojeFortaleza().slice(0, 4));
  const linha = getDb().prepare(`INSERT INTO counters(name,value) VALUES (?,1) ON CONFLICT(name) DO UPDATE SET value=value+1 RETURNING value`)
    .get(`orcamento-${ano}`) as Linha;
  return numeroOrcamento(ano, Number(linha["value"]));
}

/** Cliente interno por CPF/CNPJ (é por ele que o vínculo com o Omie é reaproveitado em pedidos futuros). */
function clientePorDocumento(documento: string, nome: string) {
  const db = getDb();
  const existente = db.prepare("SELECT id FROM customers WHERE document=?").get(documento) as Linha | undefined;
  if (existente) return String(existente["id"]);
  const id = randomUUID();
  db.prepare("INSERT INTO customers(id,document,name,created_at,updated_at) VALUES (?,?,?,?,?)").run(id, documento, nome || "Cliente", agoraIso(), agoraIso());
  return id;
}

type ProdutoIndice = { id: string; sku: string; nome: string; unidade: string; slug: string | null };
/** Cria rascunho (vazio ou a partir de um pedido do site: cliente e itens; preços ficam para o Comercial). */
export function criarOrcamento(u: SiteUser, produtos: ProdutoIndice[], pedidoSiteId?: string) {
  u = requireActiveUser(u, ['admin', 'comercial']);
  assignmentsSchema();
  return transaction(() => {
    const assignment = pedidoSiteId ? leadAssignment(pedidoSiteId) : null;
    if (assignment?.ownerId && !ehAdmin(u) && assignment.ownerId !== u.id) throw new Error('Forbidden: este lead é de outro consultor');
    if (pedidoSiteId) {
      const existing = getDb().prepare('SELECT id,number,owner_id FROM internal_quotes WHERE source_request_id=? ORDER BY created_at LIMIT 1').get(pedidoSiteId) as Linha | undefined;
      if (existing) {
        if (!ehAdmin(u) && existing['owner_id'] !== u.id) throw new Error('Forbidden: negociação existente de outro consultor');
        return { id: String(existing['id']), numero: String(existing['number']) };
      }
    }
    const ownerId = assignment?.ownerId || u.id;
    validateAssignedOwner(ownerId);
    const id = randomUUID();
    const numero = numeroNovo();
    const agora = agoraIso();
    let cliente = { nome: "", fantasia: "", documento: "", email: "", telefone: "", cidade: "", uf: "" };
    let contato = "";
    let notas = "";
    const itens: { produto: ProdutoIndice; qtd: number }[] = [];
    if (pedidoSiteId) {
      const r = readLead("quote_requests", pedidoSiteId);
      const doc = digitos(r["cnpj"]);
      cliente = {
        nome: texto(r["empresa"] || r["nome"], 120), fantasia: texto(r["empresa"] || r["nome"], 120), documento: documentoValido(doc) ? doc : "",
        email: texto(r["email"], 120).toLowerCase(), telefone: digitos(r["whatsapp"]).slice(0, 13), cidade: texto(r["cidade"], 60), uf: texto(r["estado"], 2).toUpperCase(),
      };
      // Pedido do site com empresa: quem pediu vira o contato (A/C) da proposta.
      if (r["empresa"]) contato = texto(r["nome"], 120);
      const porSlug = new Map(produtos.filter((p) => p.slug).map((p) => [p.slug!, p]));
      const faltando: string[] = [];
      const linhas = getDb().prepare("SELECT slug, sku, name, qty FROM quote_request_items WHERE quote_request_id=? ORDER BY rowid").all(pedidoSiteId) as Linha[];
      for (const l of linhas) {
        const p = porSlug.get(String(l["slug"]));
        if (p) itens.push({ produto: p, qtd: Number(l["qty"]) }); else faltando.push(`${l["sku"]} (${l["name"]})`);
      }
      notas = `Criado a partir do pedido do site ${r["protocolo"]}.` + (faltando.length ? ` Itens que não estão mais no catálogo: ${faltando.join("; ")}.` : "");
    }
    const customerId = cliente.documento ? clientePorDocumento(cliente.documento, cliente.nome) : null;
    getDb().prepare(`INSERT INTO internal_quotes(id,number,status,owner_id,customer_id,source_request_id,customer_name,customer_trade_name,customer_document,
      customer_email,customer_phone,customer_city,customer_state,nf_email,internal_notes,customer_contact,created_at,updated_at)
      VALUES (?,?,'rascunho',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, numero, ownerId, customerId, pedidoSiteId ?? null, cliente.nome, cliente.fantasia || null,
      cliente.documento || null, cliente.email || null, cliente.telefone || null, cliente.cidade || null, cliente.uf || null, cliente.email || null, notas || null,
      contato || null, agora, agora);
    const inserir = getDb().prepare(`INSERT INTO internal_quote_items(id,quote_id,position,omie_product_id,sku,name,unit,quantity,unit_price_cents,discount_type,
      discount_value,gross_cents,discount_cents,total_cents,applied_price_cents) VALUES (?,?,?,?,?,?,?,?,0,NULL,0,0,0,0,0)`);
    itens.slice(0, 199).forEach((item, i) => inserir.run(randomUUID(), id, i + 1, item.produto.id, item.produto.sku, item.produto.nome, item.produto.unidade || "UN", item.qtd));
    audit(u.id, "quote:created", id, { origem: pedidoSiteId ? "pedido_site" : "manual", itens: itens.length, owner_id: ownerId });
    return { id, numero };
  });
}

/**
 * Acrescenta itens a uma negociação editável com preço ZERO — o mesmo que a conversão do pedido do site faz: preço,
 * desconto e condições continuam sendo definidos pelo vendedor no editor (nenhuma regra financeira nova aqui).
 * `naMesmaTransacao` roda antes do COMMIT (o rascunho do Atendimento confere a revisão e se apaga junto: exatamente uma vez).
 */
export function adicionarItens(
  u: SiteUser,
  id: string,
  itens: { produto: ProdutoIndice; qtd: number }[],
  naMesmaTransacao?: () => void,
) {
  return transaction(() => {
    const q = orcamentoDoUsuario(u, id);
    if (!editavel(q["status"] as Estado)) throw new Error("Orçamento aceito, enviado ao Omie ou cancelado não pode ser alterado");
    if (!itens.length) throw new Error("Nenhum item para acrescentar");
    const db = getDb();
    const atual = db.prepare("SELECT count(*) n, COALESCE(max(position),0) p FROM internal_quote_items WHERE quote_id=?").get(id) as Linha;
    if (Number(atual["n"]) + itens.length > 199) throw new Error("no máximo 199 itens por pedido");
    const inserir = db.prepare(`INSERT INTO internal_quote_items(id,quote_id,position,omie_product_id,sku,name,unit,quantity,unit_price_cents,discount_type,
      discount_value,gross_cents,discount_cents,total_cents,applied_price_cents) VALUES (?,?,?,?,?,?,?,?,0,NULL,0,0,0,0,0)`);
    itens.forEach((item, i) =>
      inserir.run(randomUUID(), id, Number(atual["p"]) + i + 1, item.produto.id, item.produto.sku, item.produto.nome, item.produto.unidade || "UN", item.qtd));
    db.prepare("UPDATE internal_quotes SET version=version+1, updated_at=? WHERE id=?").run(agoraIso(), id);
    naMesmaTransacao?.();
    audit(u.id, "quote:items:added", id, { itens: itens.length, versao: Number(q["version"]) + 1 });
    return { id, numero: s(q["number"]), versao: Number(q["version"]) + 1, adicionados: itens.length };
  });
}

/**
 * "Duplicar orçamento": nova negociação/opção com número novo (= código de integração novo), copiando cliente, itens,
 * condições e dados da proposta. Histórico separado: nenhuma versão de proposta, aceite, envio ao Omie ou nota interna vem
 * junto. O dono continua o mesmo (o vendedor não muda, mesmo quando quem duplica é o Admin).
 */
export function duplicarOrcamento(u: SiteUser, origemId: string) {
  return transaction(() => {
    const o = orcamentoDoUsuario(u, origemId);
    const id = randomUUID();
    const numero = numeroNovo();
    const agora = agoraIso();
    getDb().prepare(`INSERT INTO internal_quotes(id,number,status,owner_id,customer_id,source_request_id,customer_name,customer_trade_name,customer_document,
      customer_email,customer_phone,customer_city,customer_state,omie_customer_id,payment_code,payment_label,forecast_date,final_consumer,nf_email,order_notes,
      internal_notes,gross_cents,discount_cents,total_cents,customer_contact,proposal_notes,valid_until,freight_cents,assembly_cents,general_discount_cents,
      version,created_at,updated_at)
      VALUES (?,?,'rascunho',?,?,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,1,?,?)`).run(
      id, numero, String(o["owner_id"]), (o["customer_id"] as string | null) ?? null, String(o["customer_name"] ?? ""), sn(o["customer_trade_name"]),
      sn(o["customer_document"]), sn(o["customer_email"]), sn(o["customer_phone"]), sn(o["customer_city"]), sn(o["customer_state"]), sn(o["omie_customer_id"]),
      sn(o["payment_code"]), sn(o["payment_label"]), sn(o["forecast_date"]), Number(o["final_consumer"] ?? 1), sn(o["nf_email"]), sn(o["order_notes"]),
      `Duplicado de ${String(o["number"])}.`, Number(o["gross_cents"]), Number(o["discount_cents"]), Number(o["total_cents"]), sn(o["customer_contact"]),
      sn(o["proposal_notes"]), Number(o["freight_cents"] ?? 0), Number(o["assembly_cents"] ?? 0), Number(o["general_discount_cents"] ?? 0), agora, agora);
    const itens = getDb().prepare("SELECT * FROM internal_quote_items WHERE quote_id=? ORDER BY position").all(origemId) as Linha[];
    const inserir = getDb().prepare(`INSERT INTO internal_quote_items(id,quote_id,position,omie_product_id,sku,name,unit,quantity,unit_price_cents,discount_type,
      discount_value,gross_cents,discount_cents,total_cents,applied_price_cents) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const i of itens) {
      inserir.run(randomUUID(), id, Number(i["position"]), String(i["omie_product_id"]), String(i["sku"]), String(i["name"]), String(i["unit"]), Number(i["quantity"]),
        Number(i["unit_price_cents"]), (i["discount_type"] as string | null) ?? null, Number(i["discount_value"]), Number(i["gross_cents"]), Number(i["discount_cents"]),
        Number(i["total_cents"]), Number(i["applied_price_cents"]));
    }
    audit(u.id, "quote:created", id, { origem: "duplicado", itens: itens.length, duplicado_de: origemId });
    audit(u.id, "quote:duplicated", origemId, { novo: id });
    return { id, numero };
  });
}

const s = (valor: unknown) => (valor === null || valor === undefined ? "" : String(valor));
const sn = (valor: unknown) => (valor === null || valor === undefined || valor === "" ? null : String(valor));

/** O que a tela recebe (lista branca de campos). */
export function lerOrcamento(u: SiteUser, id: string) {
  const q = orcamentoDoUsuario(u, id);
  const itens = getDb().prepare("SELECT * FROM internal_quote_items WHERE quote_id=? ORDER BY position").all(id) as Linha[];
  const dono = getDb().prepare("SELECT email FROM users WHERE id=?").get(s(q["owner_id"])) as Linha | undefined;
  const cliente = q["customer_id"] ? getDb().prepare("SELECT omie_customer_id FROM customers WHERE id=?").get(s(q["customer_id"])) as Linha | undefined : undefined;
  // Conta corrente: a escolhida para esta venda e, depois do aceite, a congelada na versão aceita (a que vai ao Omie).
  const aceita = q["accepted_proposal_id"]
    ? getDb().prepare("SELECT version, accepted_account_id, accepted_account_label FROM quote_proposals WHERE id=?").get(s(q["accepted_proposal_id"])) as Linha | undefined : undefined;
  const contaEscolhida = s(q["selected_account_id"]);
  return {
    orcamento: {
      id: s(q["id"]), numero: s(q["number"]), estado: s(q["status"]) as Estado, versao: Number(q["version"]), donoId: s(q["owner_id"]), donoEmail: sn(dono?.["email"]),
      origemPedidoSite: sn(q["source_request_id"]),
      cliente: { nome: s(q["customer_name"]), fantasia: s(q["customer_trade_name"]), documento: s(q["customer_document"]), email: s(q["customer_email"]),
        telefone: s(q["customer_phone"]), cidade: s(q["customer_city"]), uf: s(q["customer_state"]) },
      clienteOmie: sn(cliente?.["omie_customer_id"]) ?? sn(q["omie_customer_id"]),
      condicoes: { formaPagamento: s(q["payment_code"]), formaPagamentoDescricao: s(q["payment_label"]), previsao: s(q["forecast_date"]), consumidorFinal: Boolean(q["final_consumer"]),
        emailNf: s(q["nf_email"]), observacoes: s(q["order_notes"]), notasInternas: s(q["internal_notes"]), conta: contaEscolhida,
        contaDescricao: contaEscolhida ? referencias("conta").find((r) => r.codigo === contaEscolhida)?.descricao ?? "" : "" },
      contaAceita: aceita?.["accepted_account_id"]
        ? { codigo: s(aceita["accepted_account_id"]), descricao: s(aceita["accepted_account_label"]), versao: Number(aceita["version"]) } : null,
      totais: { brutoCentavos: Number(q["gross_cents"]), descontoCentavos: Number(q["discount_cents"]), totalCentavos: Number(q["total_cents"]) },
      // Só na proposta ao cliente (frete, montagem e desconto geral ainda não vão para o Pedido no Omie).
      proposta: { contato: s(q["customer_contact"]), validade: s(q["valid_until"]), observacoes: s(q["proposal_notes"]),
        descontoGeralCentavos: Number(q["general_discount_cents"] ?? 0), freteCentavos: Number(q["freight_cents"] ?? 0), montagemCentavos: Number(q["assembly_cents"] ?? 0) },
      aceitoEm: sn(q["accepted_at"]), criadoEm: s(q["created_at"]), atualizadoEm: s(q["updated_at"]),
    },
    itens: itens.map((i) => ({
      produtoId: s(i["omie_product_id"]), sku: s(i["sku"]), nome: s(i["name"]), unidade: s(i["unit"]), quantidade: Number(i["quantity"]),
      precoCentavos: Number(i["unit_price_cents"]), descontoTipo: (sn(i["discount_type"]) as DescontoTipo | null), descontoValor: Number(i["discount_value"]),
      brutoCentavos: Number(i["gross_cents"]), descontoCentavos: Number(i["discount_cents"]), totalCentavos: Number(i["total_cents"]), precoAplicadoCentavos: Number(i["applied_price_cents"]),
    })),
    pedidoOmie: pedidoOmie(id),
  };
}

export function listarOrcamentos(u: SiteUser, filtro: { status?: string | undefined; busca?: string | undefined }) {
  const where: string[] = []; const params: string[] = [];
  if (!ehAdmin(u)) { where.push("q.owner_id=?"); params.push(u.id); }
  if (filtro.status) { where.push("q.status=?"); params.push(filtro.status); }
  if (filtro.busca) {
    where.push("(q.number LIKE ? ESCAPE '\\' OR q.customer_name LIKE ? ESCAPE '\\')");
    const like = `%${filtro.busca.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    params.push(like, like);
  }
  const linhas = getDb().prepare(`SELECT q.id, q.number, q.status, q.customer_name, q.total_cents, q.updated_at, q.created_at, u.email AS owner_email,
      q.total_cents - q.general_discount_cents + q.freight_cents + q.assembly_cents AS proposal_total,
      o.omie_order_number, o.state AS omie_state, (SELECT max(p.version) FROM quote_proposals p WHERE p.quote_id=q.id) AS proposal_version
    FROM internal_quotes q LEFT JOIN users u ON u.id=q.owner_id LEFT JOIN omie_orders o ON o.quote_id=q.id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY q.updated_at DESC LIMIT 300`).all(...params) as Linha[];
  return linhas.map((l) => ({
    id: s(l["id"]), numero: s(l["number"]), estado: s(l["status"]) as Estado, cliente: s(l["customer_name"]), totalCentavos: Number(l["proposal_total"]),
    atualizadoEm: s(l["updated_at"]), criadoEm: s(l["created_at"]), dono: sn(l["owner_email"]), pedidoOmie: sn(l["omie_order_number"]), envio: sn(l["omie_state"]),
    proposta: l["proposal_version"] === null || l["proposal_version"] === undefined ? null : Number(l["proposal_version"]),
  }));
}

export type DadosOrcamento = {
  versao: number;
  cliente: { nome: string; fantasia: string; documento: string; email: string; telefone: string; cidade: string; uf: string };
  itens: { produtoId: string; quantidade: string; preco: string; descontoTipo: DescontoTipo | ""; desconto: string }[];
  /** `conta`: conta corrente do Omie escolhida para ESTA venda (não há padrão); ausente = mantém a gravada (telas antigas). */
  condicoes: { formaPagamento: string; previsao: string; consumidorFinal: boolean; emailNf: string; observacoes: string; notasInternas: string; conta?: string | undefined };
  /** Dados que só aparecem na proposta ao cliente. Ausente = mantém o que está gravado (telas antigas). */
  proposta?: { contato: string; validade: string; descontoGeral: string; frete: string; montagem: string; observacoes: string } | undefined;
};

/** Salva cliente, itens e condições (só antes do aceite). Recalcula tudo no servidor; produto conferido no índice interno. */
export function salvarOrcamento(u: SiteUser, id: string, d: DadosOrcamento, produtos: Map<string, ProdutoIndice>) {
  const erros: string[] = [];
  const doc = digitos(d.cliente.documento);
  if (doc && !documentoValido(doc)) erros.push("CPF/CNPJ inválido");
  const email = texto(d.cliente.email, 120).toLowerCase();
  if (email && !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(email)) erros.push("e-mail do cliente inválido");
  const emailNf = texto(d.condicoes.emailNf, 300).toLowerCase().replace(/\s+/g, "");
  if (emailNf && !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+(,[^\s@,]+@[^\s@,]+\.[^\s@,]+)*$/.test(emailNf)) erros.push("e-mail para a nota inválido");
  const uf = texto(d.cliente.uf, 2).toUpperCase();
  if (uf && !/^[A-Z]{2}$/.test(uf)) erros.push("UF inválida");
  const previsao = texto(d.condicoes.previsao, 10);
  if (previsao && !/^\d{4}-\d{2}-\d{2}$/.test(previsao)) erros.push("previsão inválida");
  const forma = texto(d.condicoes.formaPagamento, 3);
  const formaRef = forma ? referencia("forma_pagamento", forma) : null;
  if (forma && (!formaRef || forma === "999")) erros.push("condição de pagamento não existe no Omie (atualize os dados do Omie)");
  const conta = d.condicoes.conta === undefined ? undefined : texto(d.condicoes.conta, 20);
  if (conta && !referencia("conta", conta)) erros.push("conta corrente não existe ou está inativa no Omie (atualize os dados do Omie)");
  if (d.itens.length > 199) erros.push("no máximo 199 itens por pedido");
  const itens = d.itens.map((item, i) => {
    const produto = produtos.get(String(item.produtoId));
    const qtd = quantidade(item.quantidade);
    const preco = centavos(item.preco);
    const tipo = item.descontoTipo || null;
    const valorDesconto = tipo === "percentual" ? percentual(item.desconto || "0") : tipo === "valor" ? centavos(item.desconto || "0") : 0;
    if (!produto) erros.push(`item ${i + 1}: produto não encontrado no cadastro do Omie`);
    if (qtd === null) erros.push(`item ${i + 1}: quantidade inválida`);
    if (preco === null) erros.push(`item ${i + 1}: preço inválido`);
    if (valorDesconto === null) erros.push(`item ${i + 1}: desconto inválido`);
    const entrada = { quantidade: qtd ?? 0, precoCentavos: preco ?? 0, descontoTipo: tipo, descontoValor: valorDesconto ?? 0 };
    return { produto, entrada, calculado: calcularItem(entrada) };
  });
  // Proposta: valores vazios = zero; desconto geral nunca maior que o total dos itens; validade só confere o formato aqui
  // (a data no passado só bloqueia ao gerar a proposta, para não travar a edição de um orçamento antigo).
  const valorExtra = (rotulo: string, v: string) => {
    if (!v.trim()) return 0;
    const c = centavos(v);
    if (c === null) erros.push(`${rotulo} inválido`);
    return c ?? 0;
  };
  const proposta = d.proposta ? {
    contato: texto(d.proposta.contato, 120), validade: texto(d.proposta.validade, 10), observacoes: texto(d.proposta.observacoes, 2000),
    descontoGeral: valorExtra("desconto geral", d.proposta.descontoGeral), frete: valorExtra("frete", d.proposta.frete), montagem: valorExtra("montagem", d.proposta.montagem),
  } : null;
  if (proposta?.validade && !/^\d{4}-\d{2}-\d{2}$/.test(proposta.validade)) erros.push("validade da proposta inválida");
  if (proposta && proposta.descontoGeral > calcularTotais(itens.map((i) => i.calculado)).totalCentavos) erros.push("o desconto geral não pode passar do total dos itens");
  if (erros.length) throw new Error(erros.join("; "));
  return transaction(() => {
    const q = orcamentoDoUsuario(u, id);
    if (!editavel(q["status"] as Estado)) throw new Error("Orçamento aceito, enviado ao Omie ou cancelado não pode ser alterado");
    if (Number(q["version"]) !== d.versao) throw new Error("Este orçamento foi alterado por outra pessoa. Recarregue a página.");
    const nome = texto(d.cliente.nome, 120);
    const customerId = doc ? clientePorDocumento(doc, nome) : null;
    const totais = calcularTotais(itens.map((i) => i.calculado));
    const db = getDb();
    db.prepare(`UPDATE internal_quotes SET customer_id=?, customer_name=?, customer_trade_name=?, customer_document=?, customer_email=?, customer_phone=?,
      customer_city=?, customer_state=?, omie_customer_id=CASE WHEN customer_document IS ? THEN omie_customer_id ELSE NULL END,
      payment_code=?, payment_label=?, forecast_date=?, final_consumer=?, nf_email=?, order_notes=?, internal_notes=?,
      gross_cents=?, discount_cents=?, total_cents=?, version=version+1, updated_at=? WHERE id=?`).run(
      customerId, nome, texto(d.cliente.fantasia, 120) || null, doc || null, email || null, digitos(d.cliente.telefone).slice(0, 13) || null,
      texto(d.cliente.cidade, 60) || null, uf || null, doc || null,
      forma || null, formaRef?.descricao ?? null, previsao || null, d.condicoes.consumidorFinal ? 1 : 0, emailNf || null,
      texto(d.condicoes.observacoes, 2000) || null, texto(d.condicoes.notasInternas, 5000) || null,
      totais.brutoCentavos, totais.descontoCentavos, totais.totalCentavos, agoraIso(), id);
    if (conta !== undefined) db.prepare("UPDATE internal_quotes SET selected_account_id=? WHERE id=?").run(conta || null, id);
    if (proposta) {
      db.prepare(`UPDATE internal_quotes SET customer_contact=?, valid_until=?, proposal_notes=?, general_discount_cents=?, freight_cents=?, assembly_cents=? WHERE id=?`)
        .run(proposta.contato || null, proposta.validade || null, proposta.observacoes || null, proposta.descontoGeral, proposta.frete, proposta.montagem, id);
    } else if (Number(q["general_discount_cents"] ?? 0) > totais.totalCentavos) {
      throw new Error("o desconto geral da proposta passou do total dos itens: ajuste em \"Dados da proposta\"");
    }
    db.prepare("DELETE FROM internal_quote_items WHERE quote_id=?").run(id);
    const inserir = db.prepare(`INSERT INTO internal_quote_items(id,quote_id,position,omie_product_id,sku,name,unit,quantity,unit_price_cents,discount_type,
      discount_value,gross_cents,discount_cents,total_cents,applied_price_cents) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    itens.forEach((item, i) => {
      const p = item.produto!;
      inserir.run(randomUUID(), id, i + 1, p.id, p.sku, p.nome, p.unidade || "UN", item.entrada.quantidade, item.entrada.precoCentavos, item.entrada.descontoTipo,
        item.entrada.descontoValor, item.calculado.brutoCentavos, item.calculado.descontoCentavos, item.calculado.totalCentavos, item.calculado.precoAplicadoCentavos);
    });
    assertDiscountCeiling(id);
    // Auditoria da edição (valores e descontos), sem dados do cliente: quem salvou, versão e totais.
    audit(u.id, "quote:saved", id, {
      versao: Number(q["version"]) + 1, itens: itens.length, total_cents: totais.totalCentavos, desconto_itens_cents: totais.descontoCentavos,
      desconto_geral_cents: proposta ? proposta.descontoGeral : Number(q["general_discount_cents"] ?? 0),
    });
    return { ok: true, versao: Number(q["version"]) + 1 };
  });
}

/** Pendências que impedem salvar/aceitar (a tela mostra todas de uma vez). */
export function pendencias(q: Linha, itens: Linha[], acao: Acao) {
  const lista: string[] = [];
  if (acao === "salvar" || acao === "enviar" || acao === "aceitar") {
    if (!String(q["customer_name"] ?? "").trim()) lista.push("informe o cliente");
    if (!itens.length) lista.push("inclua pelo menos um item");
    if (itens.some((i) => !(Number(i["unit_price_cents"]) > 0))) lista.push("todos os itens precisam de preço");
  }
  if (acao === "aceitar") {
    if (!q["payment_code"]) lista.push("escolha a condição de pagamento");
    if (!q["forecast_date"]) lista.push("informe a previsão de faturamento");
    // Sem conta padrão: a conta corrente é escolhida para cada venda e fica congelada com a versão aceita.
    if (!q["selected_account_id"]) lista.push("escolha a conta corrente da venda");
  }
  return lista;
}

/** Salvar → enviado → aceito → (Omie) / reabrir / cancelar. Reabrir e cancelar são barrados se já houve envio ao Omie. */
export function mudarEstado(u: SiteUser, id: string, acao: Acao, versao: number) {
  return transaction(() => {
    const q = orcamentoDoUsuario(u, id);
    if (Number(q["version"]) !== versao) throw new Error("Este orçamento foi alterado por outra pessoa. Recarregue a página.");
    const atual = q["status"] as Estado;
    const novo = proximoEstado(atual, acao);
    if (!novo) throw new Error(`Não é possível "${acao}" um orçamento ${atual.replace("_", " ")}`);
    const itens = getDb().prepare("SELECT unit_price_cents FROM internal_quote_items WHERE quote_id=?").all(id) as Linha[];
    const faltam = pendencias(q, itens, acao);
    if (faltam.length) throw new Error(`Falta: ${faltam.join("; ")}`);
    const envio = pedidoOmie(id);
    if ((acao === "reabrir" || acao === "cancelar") && envio && ["enviando", "incerto", "criado"].includes(String(envio["state"]))) {
      throw new Error("Há um envio ao Omie criado ou sem confirmação: use \"Verificar no Omie\" antes de reabrir ou cancelar");
    }
    // O aceite é de uma VERSÃO da proposta: a vigente, e só se o orçamento não mudou depois dela (o cliente aceitou o que recebeu).
    const vigente = versaoVigente(id);
    if (acao === "enviar" || acao === "aceitar") assertDiscountApproval(id, vigente ? Number(vigente["version"]) : undefined);
    const conta = acao === "aceitar" ? referencia("conta", s(q["selected_account_id"])) : null;
    if (acao === "aceitar") {
      // Sequência obrigatória (09/10/2026, tarde): alteração → nova versão → marcar ENVIADA → aceite. Uma versão já aceita
      // (e depois revisada) nunca é aceita de novo: o retrato dela não é reutilizado.
      const nova = "gere uma nova versão, marque como enviada ao cliente e registre o aceite";
      if (!vigente) throw new Error("Falta: gere a proposta — o aceite é sempre de uma versão da proposta");
      const v = `v${vigente["version"]}`;
      if (vigente["refused_at"]) throw new Error(`A proposta vigente (${v}) foi recusada pelo cliente: gere uma nova versão`);
      if (vigente["accepted_at"]) throw new Error(`A ${v} já foi aceita e depois revisada ("Criar nova revisão"): ela não pode ser aceita de novo — ${nova}`);
      if (hashDoOrcamento(q, itensDo(id), String(q["valid_until"] ?? "")) !== String(vigente["content_hash"])) {
        throw new Error(`O orçamento mudou depois da proposta vigente (${v}): ${nova}`);
      }
      if (!vigente["order_hash"]) throw new Error(`A ${v} é anterior ao registro dos dados do pedido (conta corrente, consumidor final, observações do pedido): ${nova}`);
      if (String(vigente["order_hash"]) !== hashDoPedido(q)) {
        throw new Error(`A conta corrente, o consumidor final ou as observações do pedido mudaram depois da ${v}: ${nova}`);
      }
      if (!vigente["sent_at"]) throw new Error(`Marque a ${v} como enviada ao cliente antes do aceite (o cliente só aceita o que recebeu)`);
      if (!conta) throw new Error("A conta corrente escolhida para esta venda não existe mais ou está inativa no Omie: escolha outra antes do aceite");
    }
    const agora = agoraIso();
    getDb().prepare(`UPDATE internal_quotes SET status=?, version=version+1, updated_at=?, accepted_at=CASE WHEN ?='aceito' THEN ? ELSE accepted_at END,
      accepted_by=CASE WHEN ?='aceito' THEN ? ELSE accepted_by END WHERE id=?`).run(novo, agora, novo, agora, novo, u.id, id);
    if (vigente && (acao === "enviar" || acao === "aceitar")) {
      // Enviada ao cliente (e, no aceite, congelada como a versão aceita): deixa de poder ser excluída.
      getDb().prepare(`UPDATE quote_proposals SET sent_at=COALESCE(sent_at, ?), sent_by=COALESCE(sent_by, ?),
        accepted_at=CASE WHEN ?='aceitar' THEN ? ELSE accepted_at END, accepted_by=CASE WHEN ?='aceitar' THEN ? ELSE accepted_by END WHERE id=?`)
        .run(agora, u.id, acao, agora, acao, u.id, String(vigente["id"]));
    }
    // Qual versão foi aceita e com qual conta corrente (congelada junto: o Pedido usa só a da versão aceita); "Criar nova
    // revisão" (reabrir) desfaz o aceite: a versão aceita — com a conta dela — fica congelada no histórico.
    if (acao === "aceitar") {
      getDb().prepare("UPDATE internal_quotes SET accepted_proposal_id=? WHERE id=?").run(String(vigente!["id"]), id);
      getDb().prepare("UPDATE quote_proposals SET accepted_account_id=?, accepted_account_label=? WHERE id=?").run(conta!.codigo, conta!.descricao, String(vigente!["id"]));
    }
    if (acao === "reabrir") getDb().prepare("UPDATE internal_quotes SET accepted_proposal_id=NULL WHERE id=?").run(id);
    audit(u.id, novo === "aceito" ? "quote:accepted" : `quote:status:${novo}`, id, {
      de: atual, total_centavos: Number(q["total_cents"]), ...(acao === "aceitar" || acao === "enviar" ? { proposta_versao: vigente ? Number(vigente["version"]) : null } : {}),
      ...(acao === "aceitar" ? { conta_corrente: conta!.codigo } : {}),
    });
    return { ok: true, estado: novo };
  });
}

/**
 * Previsão de faturamento depois do aceite: CONGELADA (08/10/2026). A previsão comercial pertence à versão aceita e vai ao
 * Pedido no Omie como foi aceita. Antes do Pedido: "Criar nova revisão" → nova proposta → novo aceite. Depois do Pedido:
 * a previsão operacional muda no próprio Omie, sem tocar na proposta aceita.
 */
export function atualizarPrevisao(u: SiteUser, id: string, _previsao: string) {
  orcamentoDoUsuario(u, id);
  throw new Error("A previsão aceita pelo cliente fica congelada: para mudar antes do Pedido no Omie, use \"Criar nova revisão\" (nova proposta e novo aceite); depois do Pedido, a previsão operacional é ajustada no próprio Omie.");
}
