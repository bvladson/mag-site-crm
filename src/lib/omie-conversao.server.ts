/**
 * Conversão de orçamento ACEITO em Pedido de Venda no Omie — operação crítica (1ª escrita do site no Omie).
 * Desde 08/10/2026 (noite) o Pedido nasce EXCLUSIVAMENTE da versão da proposta que o cliente aceitou (itens, códigos,
 * quantidades, preços, descontos, condição, previsão comercial, total, cliente e vendedor do dono): se o orçamento vivo
 * estiver diferente dela, bloqueia ("Criar nova revisão" → nova proposta → novo aceite).
 * 1) prepararRevisao: estoque em lote, vendedor do DONO do orçamento revalidado no Omie, cliente vinculado (CPF/CNPJ),
 *    condição/etapa/categoria conferidas, conta corrente da VENDA (escolhida no orçamento, congelada no aceite; sem padrão), CONFERÊNCIA EXPLÍCITA versão aceita × payload final (item a item: código/SKU,
 *    quantidade, preço, desconto e total; condição, previsão, extras e total — qualquer diferença bloqueia; refeita na
 *    criação) e o pedido validado; gera um token de revisão de USO ÚNICO (15 min) amarrado ao conteúdo exato do pedido.
 * 2) gerarPedido: só com o token + confirmação explícita. Escrita desligada (OMIE_ORDER_WRITE_ENABLED=false) = simulação.
 *    Idempotência: código de integração = número do orçamento (nunca muda); trava no banco ("enviando"); consulta o Omie
 *    ANTES de incluir (o serviço reaproveita essa resposta: o Omie recusa a mesma consulta repetida em menos de 60 s);
 *    tempo esgotado = "incerto" e a próxima tentativa SEMPRE consulta antes. Pedido achado com o nosso código só é
 *    vinculado se for do mesmo cliente com os mesmos itens (número repetido após restauração = conflito, nada enviado).
 * Nunca fatura, nunca altera estoque, nunca exclui nada no Omie. Auditoria só com ids, resultado e duração.
 */
import { createHash, randomBytes } from "node:crypto";
import { getDb, transaction, audit, consumeRateLimit } from "./local-db.server.ts";
import type { SiteUser } from "./local-auth-core.server.ts";
import { servicoOmie, mensagemOmie, type RespostaOmie } from "./omie-pedidos-cliente.server.ts";
import { lerConfiguracao, referencia, vendedorDoUsuario, ETAPAS_PAINEL, type Configuracao } from "./omie-referencias.server.ts";
import { orcamentoDoUsuario } from "./orcamentos.server.ts";
import { assertDiscountApproval } from "./discounts.server.ts";
import { montarPedidoOmie, validarPedidoOmie, podeGerarPedido, documentoMascarado, hojeFortaleza, resumoDoPedido, pedidoConfere, mascararEmails, digitos,
  dataOmie, extrasDoPedido, bloqueiosDeExtras, conferirAceitaComPedido, type Estado, type ResumoPedido, type ConferenciaPedido } from "./orcamento-regras.ts";
import { hashDoOrcamento, hashDoPedido, hashDosDadosDoPedido } from "./proposta-conteudo.server.ts";
import type { SnapshotProposta } from "./proposta-regras.ts";

type Linha = Record<string, unknown>;
/** Pedido achado no Omie pelo código de integração (o serviço devolve só códigos, etapa e itens). */
type PedidoAchado = { codigoPedido: string; numeroPedido: string; etapa: string } & ResumoPedido;
const agoraIso = () => new Date().toISOString();
const sha = (valor: string) => createHash("sha256").update(valor).digest("hex");
const ENVIO_TRAVADO_MS = 3 * 60_000;

// ---------- Token de revisão (memória do processo; reiniciar o site só obriga a revisar de novo) ----------
type Revisao = { quoteId: string; userId: string; hash: string; faltaEstoque: boolean; politica: Configuracao["semEstoque"]; criadaEm: number };
const revisoes = new Map<string, Revisao>();
const VALIDADE_REVISAO_MS = 15 * 60_000;
function guardarRevisao(r: Revisao) {
  for (const [token, antiga] of revisoes) if (Date.now() - antiga.criadaEm > VALIDADE_REVISAO_MS) revisoes.delete(token);
  for (const [token, antiga] of revisoes) if (antiga.quoteId === r.quoteId) revisoes.delete(token); // só a revisão mais recente vale
  const token = randomBytes(24).toString("hex");
  revisoes.set(token, r);
  return token;
}
function usarRevisao(token: string, quoteId: string, userId: string) {
  const r = revisoes.get(token);
  revisoes.delete(token);
  if (!r || r.quoteId !== quoteId || r.userId !== userId || Date.now() - r.criadaEm > VALIDADE_REVISAO_MS) {
    throw new Error("A revisão expirou ou já foi usada. Abra a revisão de novo antes de gerar o pedido.");
  }
  return r;
}

const envioDo = (quoteId: string) => (getDb().prepare("SELECT * FROM omie_orders WHERE quote_id=?").get(quoteId) as Linha | undefined) ?? null;
const itensDo = (quoteId: string) => getDb().prepare("SELECT * FROM internal_quote_items WHERE quote_id=? ORDER BY position").all(quoteId) as Linha[];
function clienteOmieDo(q: Linha): string | null {
  if (q["customer_id"]) {
    const c = getDb().prepare("SELECT omie_customer_id FROM customers WHERE id=?").get(String(q["customer_id"])) as Linha | undefined;
    if (c?.["omie_customer_id"]) return String(c["omie_customer_id"]);
  }
  return q["omie_customer_id"] ? String(q["omie_customer_id"]) : null;
}

// ---------- Versão aceita: o Pedido nasce SÓ dela ----------
/**
 * `conta`: a conta corrente escolhida para ESTA venda, congelada no aceite (não há conta padrão). `pedidoHash`: identidade dos
 * dados do pedido da versão (conta, consumidor final, observações do pedido) — null nas versões anteriores a essa regra.
 */
type VersaoAceita = { id: string; versao: number; dono: string; hash: string; pedidoHash: string | null; retrato: SnapshotProposta; conta: { codigo: string; descricao: string } | null };
/** A versão da proposta que o cliente aceitou (`internal_quotes.accepted_proposal_id`), congelada no aceite. */
function versaoAceitaDo(q: Linha): VersaoAceita | null {
  if (!q["accepted_proposal_id"]) return null;
  const l = getDb().prepare(`SELECT id, version, owner_id, content_hash, order_hash, snapshot, accepted_at, accepted_account_id, accepted_account_label FROM quote_proposals
    WHERE id=? AND quote_id=? AND deleted_at IS NULL`).get(String(q["accepted_proposal_id"]), String(q["id"])) as Linha | undefined;
  if (!l || !l["accepted_at"]) return null;
  return { id: String(l["id"]), versao: Number(l["version"]), dono: String(l["owner_id"] ?? q["owner_id"]), hash: String(l["content_hash"]),
    pedidoHash: l["order_hash"] ? String(l["order_hash"]) : null, retrato: JSON.parse(String(l["snapshot"])) as SnapshotProposta,
    conta: l["accepted_account_id"] ? { codigo: String(l["accepted_account_id"]), descricao: String(l["accepted_account_label"] ?? "") } : null };
}
const NOVA_REVISAO = "use \"Criar nova revisão\", gere nova proposta e registre novo aceite";
/** O que impede o Pedido de nascer da versão aceita. O orçamento vivo nunca substitui o que o cliente aceitou. */
function conferirVersaoAceita(q: Linha, itens: Linha[], a: VersaoAceita | null): string[] {
  if (!a) return [`Este orçamento aceito não tem a versão aceita da proposta registrada: ${NOVA_REVISAO}.`];
  const r = a.retrato;
  const erros: string[] = [];
  if (hashDoOrcamento(q, itens, String(q["valid_until"] ?? "")) !== a.hash) {
    erros.push(`O orçamento está diferente da proposta aceita (v${a.versao}) — o Pedido nasce só da versão aceita: ${NOVA_REVISAO}.`);
  }
  if (!r.condicoes.pagamentoCodigo) erros.push(`A proposta aceita (v${a.versao}) é de antes de 08/10/2026 e não guarda o código da condição de pagamento: ${NOVA_REVISAO}.`);
  // Conta corrente: a escolhida para esta venda e congelada no aceite (não há conta padrão).
  if (!a.conta) erros.push(`O aceite da v${a.versao} não registrou a conta corrente da venda (aceite anterior a 09/10/2026): ${NOVA_REVISAO}, escolhendo a conta antes do aceite.`);
  else if (!referencia("conta", a.conta.codigo)) erros.push(`A conta corrente escolhida para esta venda (${a.conta.descricao || a.conta.codigo}) não existe mais ou está inativa no Omie: ${NOVA_REVISAO}.`);
  // Dados do pedido da versão aceita (conta, consumidor final, observações do pedido): registrados no retrato, íntegros e
  // iguais aos do orçamento — qualquer diferença exige nova revisão (o retrato aceito nunca é reaproveitado).
  if (!a.pedidoHash || !r.pedido) {
    erros.push(`A versão aceita (v${a.versao}) é anterior ao registro dos dados do pedido (conta corrente, consumidor final e observações do pedido): ${NOVA_REVISAO}.`);
  } else if (hashDosDadosDoPedido(r.pedido) !== a.pedidoHash || (a.conta && r.pedido.conta !== a.conta.codigo)) {
    erros.push(`Os dados do pedido gravados na versão aceita (v${a.versao}) não conferem entre si: ${NOVA_REVISAO}.`);
  } else if (hashDoPedido(q) !== a.pedidoHash) {
    erros.push(`Conta corrente, consumidor final ou observações do pedido estão diferentes da versão aceita (v${a.versao}): ${NOVA_REVISAO}.`);
  }
  if (!r.condicoes.previsao || r.condicoes.previsao < hojeFortaleza()) {
    erros.push(`A previsão comercial aceita (${r.condicoes.previsao ? dataOmie(r.condicoes.previsao) : "sem data"}) já passou: ${NOVA_REVISAO}.`);
  }
  // Desconto geral e frete: suporte preparado e DESLIGADO (EXTRAS_NO_PEDIDO); montagem: sem regra fiscal/contábil da MAG.
  erros.push(...bloqueiosDeExtras(r.totais));
  if (r.itens.reduce((soma, i) => soma + i.totalCentavos, 0) !== r.totais.subtotalCentavos || !r.itens.length) {
    erros.push(`A versão aceita (v${a.versao}) está inconsistente (soma dos itens diferente do subtotal): ${NOVA_REVISAO}.`);
  }
  return erros;
}

/**
 * Pedido do Omie montado EXCLUSIVAMENTE da versão aceita (itens, códigos, quantidades, preços, descontos, condição,
 * previsão comercial, conta corrente da venda, consumidor final e observações do pedido — estes três registrados na versão
 * desde 09/10/2026, tarde) + configuração do Admin (etapa, categoria) + o que se confere na revisão (cliente vinculado no
 * Omie pelo CPF/CNPJ aceito, vendedor do dono, e-mail da NF do cadastro do cliente). Nunca do que veio do navegador.
 */
function montar(q: Linha, aceita: VersaoAceita, config: Configuracao, codVend: string, codigoCliente: string) {
  const r = aceita.retrato;
  const p = r.pedido; // ausente só em versão anterior à regra (bloqueada em conferirVersaoAceita; aqui só para mostrar)
  const pedido = montarPedidoOmie({
    numero: String(q["number"]), codigoClienteOmie: codigoCliente, dataPrevisao: String(r.condicoes.previsao ?? ""), etapa: config.etapa,
    codigoParcela: String(r.condicoes.pagamentoCodigo ?? ""), categoria: config.categoria, contaCorrente: aceita.conta?.codigo ?? "", codVend,
    // Observações: SÓ as do pedido (campo operacional). As comerciais da proposta nunca vão ao Omie.
    consumidorFinal: p ? p.consumidorFinal : Boolean(q["final_consumer"]), emailsNf: String(q["nf_email"] ?? ""), observacoes: p ? p.observacoes : String(q["order_notes"] ?? ""),
    itens: r.itens.map((i) => ({ codigoProdutoOmie: i.produtoId, quantidade: i.quantidade, precoCentavos: i.precoCentavos, descontoCentavos: i.descontoCentavos })),
    // Desconto geral e frete só se a política ligar (hoje desligada: nada a mais vai ao Omie).
    ...extrasDoPedido(r.totais),
  });
  return { pedido, hash: sha(JSON.stringify(pedido)) };
}

const lerConferencia = (valor: unknown): ConferenciaPedido | null => {
  try { return valor ? (JSON.parse(String(valor)) as ConferenciaPedido) : null; } catch { return null; }
};
function resumoEnvio(e: Linha | null) {
  if (!e) return null;
  const etapa = e["status_stage"] ? referencia("etapa", String(e["status_stage"])) : null;
  return {
    estado: String(e["state"]), codigoPedido: (e["omie_order_id"] as string | null) ?? null, numeroPedido: (e["omie_order_number"] as string | null) ?? null,
    enviadoEm: (e["sent_at"] as string | null) ?? null, enviadoPor: (e["sent_by"] as string | null) ?? null, tentativas: Number(e["attempts"] ?? 0),
    enviadoPorEmail: e["sent_by"] ? String((getDb().prepare("SELECT email FROM users WHERE id=?").get(String(e["sent_by"])) as Linha | undefined)?.["email"] ?? "") || null : null,
    ultimoErro: (e["last_error"] as string | null) ?? null, vendedor: (e["omie_seller_id"] as string | null) ?? null, cliente: (e["omie_customer_id"] as string | null) ?? null,
    integracao: String(e["integration_code"] ?? ""), conferencia: lerConferencia(e["verification"]),
    status: e["status_checked_at"] ? {
      etapa: String(e["status_stage"] ?? ""), etapaDescricao: etapa?.descricao ?? null, cancelado: Boolean(e["status_cancelled"]), faturado: Boolean(e["status_invoiced"]),
      totalCentavos: e["status_total_cents"] === null ? null : Number(e["status_total_cents"]), consultadoEm: String(e["status_checked_at"]),
    } : null,
  };
}
export { resumoEnvio };

/**
 * Autoria separada na auditoria: quem criou o orçamento (o dono — não há transferência), quem criou o pedido no Omie
 * (quem clicou; pode ser o Admin) e o vendedor do pedido (SEMPRE o vinculado ao dono; quem executa não escolhe).
 */
function autoriaDoEnvio(quoteId: string) {
  const l = getDb().prepare(`SELECT q.owner_id, o.sent_by, o.omie_seller_id, s.name AS seller_name, p.version AS proposta_versao, p.accepted_account_id FROM internal_quotes q
    LEFT JOIN omie_orders o ON o.quote_id=q.id LEFT JOIN omie_sellers s ON s.omie_seller_id=o.omie_seller_id
    LEFT JOIN quote_proposals p ON p.id=q.accepted_proposal_id WHERE q.id=?`).get(quoteId) as Linha | undefined;
  return {
    quote_created_by: (l?.["owner_id"] as string | null) ?? null, omie_order_created_by: (l?.["sent_by"] as string | null) ?? null,
    omie_seller: (l?.["omie_seller_id"] as string | null) ?? null, omie_seller_nome: (l?.["seller_name"] as string | null) ?? null,
    proposta_versao: l?.["proposta_versao"] === null || l?.["proposta_versao"] === undefined ? null : Number(l["proposta_versao"]),
    conta_corrente: (l?.["accepted_account_id"] as string | null) ?? null,
  };
}

function concluirCriado(u: SiteUser, quoteId: string, pedido: { codigoPedido: string; numeroPedido: string; etapa?: string }, resultado: string, inicio: number,
  conferencia: ConferenciaPedido | null = null) {
  transaction(() => {
    const agora = agoraIso();
    getDb().prepare(`UPDATE omie_orders SET state='criado', omie_order_id=?, omie_order_number=?, sent_at=COALESCE(sent_at, ?), status_stage=COALESCE(?, status_stage),
      last_error=NULL, verification=COALESCE(?, verification), updated_at=? WHERE quote_id=?`)
      .run(pedido.codigoPedido, pedido.numeroPedido || null, agora, pedido.etapa || null, conferencia ? JSON.stringify(conferencia) : null, agora, quoteId);
    getDb().prepare("UPDATE internal_quotes SET status='enviado_omie', version=version+1, updated_at=? WHERE id=?").run(agora, quoteId);
    audit(u.id, "omie_order:created", quoteId, { omie_order_id: pedido.codigoPedido, numero: pedido.numeroPedido || null, resultado, ...autoriaDoEnvio(quoteId),
      conferido: conferencia ? conferencia.confere : null, divergencias: conferencia && !conferencia.confere ? conferencia.divergencias.join(",").slice(0, 200) : null,
      ms: Date.now() - inicio });
  });
}
function registrarFalha(u: SiteUser, quoteId: string, estado: "erro" | "incerto", motivo: string, detalhe: string, inicio: number) {
  transaction(() => {
    const agora = agoraIso();
    getDb().prepare("UPDATE omie_orders SET state=?, last_error=?, updated_at=? WHERE quote_id=?").run(estado, `${motivo}${detalhe ? `: ${detalhe}` : ""}`.slice(0, 400), agora, quoteId);
    getDb().prepare("UPDATE internal_quotes SET status='erro_omie', version=version+1, updated_at=? WHERE id=? AND status IN ('aceito','erro_omie')").run(agora, quoteId);
    audit(u.id, "omie_order:failed", quoteId, { motivo, incerto: estado === "incerto", ms: Date.now() - inicio });
  });
}
const textoFalha = (r: RespostaOmie) => [mensagemOmie(r.motivo), r.mensagem ?? "", ...(Array.isArray(r.erros) ? r.erros : [])].filter(Boolean).join(" ");

/** Envio anterior incerto ou travado: consulta o Omie pelo código de integração e resolve (criado / não criado). */
async function resolverIncerto(u: SiteUser, q: Linha) {
  const e = envioDo(String(q["id"]));
  const pendente = e && (e["state"] === "incerto" || (e["state"] === "enviando" && Date.now() - Date.parse(String(e["updated_at"])) > ENVIO_TRAVADO_MS));
  if (!pendente) return { resolvido: true as const };
  const consulta = await servicoOmie(`/pedidos?integracao=${encodeURIComponent(String(q["number"]))}`);
  if (consulta.ok && consulta["encontrado"] === true) {
    const p = consulta["pedido"] as PedidoAchado;
    // Só é o NOSSO envio se o cliente e os itens forem os da tentativa registrada.
    const tentativa = JSON.parse(String(e["items_snapshot"] ?? "[]")) as { produto: string; qtd: number }[];
    const esperado = { codigoCliente: String(e["omie_customer_id"] ?? ""), itens: tentativa.map((i) => ({ produto: String(i.produto), quantidade: Number(i.qtd) })) };
    if (!pedidoConfere(esperado, p)) {
      transaction(() => {
        getDb().prepare("UPDATE omie_orders SET state='erro', last_error='conflito_integracao: o pedido no Omie com este código não confere', updated_at=? WHERE quote_id=?").run(agoraIso(), String(q["id"]));
        audit(u.id, "omie_order:verified", String(q["id"]), { resultado: "conflito" });
      });
      return { resolvido: true as const, criado: false };
    }
    concluirCriado(u, String(q["id"]), p, "verificado", Date.now());
    return { resolvido: true as const, criado: true };
  }
  if (consulta.ok && consulta["encontrado"] === false) {
    transaction(() => {
      getDb().prepare("UPDATE omie_orders SET state='erro', last_error='nao_criado: conferido no Omie', updated_at=? WHERE quote_id=?").run(agoraIso(), String(q["id"]));
      audit(u.id, "omie_order:verified", String(q["id"]), { resultado: "nao_criado" });
    });
    return { resolvido: true as const, criado: false };
  }
  return { resolvido: false as const, motivo: consulta.motivo ?? "indisponivel" };
}

export async function verificarNoOmie(u: SiteUser, quoteId: string) {
  const q = orcamentoDoUsuario(u, quoteId);
  const r = await resolverIncerto(u, q);
  if (!r.resolvido) return { ok: false, mensagem: `Não foi possível confirmar no Omie agora (${mensagemOmie(r.motivo)}). Nada foi enviado de novo.` };
  return { ok: true, criado: "criado" in r ? Boolean(r.criado) : null, envio: resumoEnvio(envioDo(quoteId)) };
}

// ---------- 1) Revisão obrigatória ----------
export async function prepararRevisao(u: SiteUser, quoteId: string) {
  if (!consumeRateLimit(`omie-revisao:${sha(u.id)}`, 30, 600)) throw new Error("Muitas revisões em pouco tempo. Aguarde alguns minutos.");
  let q = orcamentoDoUsuario(u, quoteId);
  const pendente = await resolverIncerto(u, q);
  if (!pendente.resolvido) return { situacao: "indisponivel" as const, mensagem: `Há um envio anterior sem confirmação e não foi possível consultar o Omie agora (${mensagemOmie(pendente.motivo)}). Nada foi enviado.` };
  q = orcamentoDoUsuario(u, quoteId);
  const envio = envioDo(quoteId);
  if (q["status"] === "enviado_omie" || envio?.["state"] === "criado") return { situacao: "ja_enviado" as const, envio: resumoEnvio(envio) };
  if (!podeGerarPedido(q["status"] as Estado)) throw new Error("Só orçamento ACEITO pelo cliente pode virar Pedido no Omie");

  const itens = itensDo(quoteId);
  const config = lerConfiguracao();
  const bloqueios: string[] = []; const avisos: string[] = [];
  const aceita = versaoAceitaDo(q);
  bloqueios.push(...conferirVersaoAceita(q, itens, aceita));
  const etapa = config.etapa && ETAPAS_PAINEL.includes(config.etapa) ? referencia("etapa", config.etapa) : null;
  const categoria = config.categoria ? referencia("categoria", config.categoria) : null;
  // Conta corrente: a escolhida para ESTA venda e congelada no aceite (sem padrão; ausente/inativa já bloqueia acima).
  const conta = aceita?.conta ? referencia("conta", aceita.conta.codigo) : null;
  if (!etapa) bloqueios.push("O Admin precisa escolher a etapa padrão do pedido (Omie → Configuração).");
  if (!categoria) bloqueios.push("O Admin precisa escolher a categoria padrão do pedido (Omie → Configuração).");
  // Condição de pagamento: a da versão aceita (conferida no cadastro atual do Omie).
  const codigoForma = aceita?.retrato.condicoes.pagamentoCodigo ?? null;
  const forma = codigoForma ? referencia("forma_pagamento", codigoForma) : null;
  if (aceita && codigoForma && (!forma || forma.codigo === "999")) bloqueios.push("A condição de pagamento aceita não existe mais no Omie.");
  if (!String(q["nf_email"] ?? "").trim()) bloqueios.push("Informe o e-mail para a nota fiscal (o Omie exige): use o e-mail do cadastro do cliente no Omie.");

  const servico = await servicoOmie("/verificar");
  if (!servico.ok) bloqueios.push(`Serviço do Omie indisponível: ${mensagemOmie(servico.motivo)}`);
  const escrita = servico.ok && servico["escrita"] === true;

  // Vendedor: o vinculado ao DONO da versão aceita (o dono do orçamento; ninguém escolhe outro), conferido agora no Omie.
  const dono = aceita?.dono ?? String(q["owner_id"]);
  const vinculado = vendedorDoUsuario(dono);
  let vendedor: { codigo: string; nome: string } | null = null;
  if (!vinculado) {
    bloqueios.push(dono === u.id ? "Seu usuário ainda não está vinculado a um vendedor do Omie. Solicite ao Admin."
      : "O responsável por este orçamento ainda não está vinculado a um vendedor do Omie. Vincule em Omie → Vendedores.");
  } else {
    const r = await servicoOmie("/vendedores");
    const atual = r.ok && Array.isArray(r["vendedores"]) ? (r["vendedores"] as { codigo: string; nome: string; inativo: boolean }[]).find((s) => s.codigo === vinculado.codigo) : undefined;
    if (!r.ok) bloqueios.push(`Não foi possível conferir o vendedor no Omie: ${mensagemOmie(r.motivo)}`);
    else if (!atual) bloqueios.push(`O vendedor vinculado (${vinculado.nome}, código ${vinculado.codigo}) não existe mais no Omie. Peça ao Admin para revisar o vínculo.`);
    else if (atual.inativo) bloqueios.push(`O vendedor vinculado (${atual.nome}) está inativo no Omie. Peça ao Admin para revisar o vínculo.`);
    else vendedor = { codigo: atual.codigo, nome: atual.nome };
  }

  // Cliente: vínculo confirmado (por CPF/CNPJ ou seleção manual); conferido agora no Omie.
  const codigoCliente = clienteOmieDo(q);
  let cliente: Linha | null = null;
  let candidatos: Linha[] | null = null;
  if (codigoCliente) {
    const r = await servicoOmie(`/clientes/${codigoCliente}`);
    if (!r.ok) bloqueios.push(`Não foi possível conferir o cliente no Omie: ${mensagemOmie(r.motivo)}`);
    else if (!r["cliente"]) bloqueios.push("O cliente vinculado não existe mais no Omie. Vincule de novo.");
    else if ((r["cliente"] as Linha)["inativo"]) bloqueios.push("O cliente vinculado está inativo no Omie.");
    else cliente = r["cliente"] as Linha;
    // O cliente do Omie precisa ser o da proposta aceita (mesmo CPF/CNPJ).
    const docAceito = digitos(aceita?.retrato.cliente.documento ?? "");
    if (cliente && docAceito && digitos(String(cliente["documento"] ?? "")) !== docAceito) {
      bloqueios.push("O cliente vinculado no Omie não é o da proposta aceita (CPF/CNPJ diferente): vincule o cliente certo.");
    }
  } else {
    bloqueios.push("Vincule o cliente do Omie (busca por CPF/CNPJ) antes de gerar o pedido.");
    if (q["customer_document"]) {
      const r = await servicoOmie(`/clientes?documento=${String(q["customer_document"])}`);
      candidatos = r.ok && Array.isArray(r["clientes"]) ? (r["clientes"] as Linha[]) : null;
      if (!r.ok) avisos.push(`Busca do cliente no Omie indisponível: ${mensagemOmie(r.motivo)}`);
    } else candidatos = [];
  }

  // Itens: os da versão aceita (sem ela, os do orçamento só para mostrar — a revisão fica bloqueada).
  const fonte = aceita ? aceita.retrato.itens.map((i) => ({ produtoId: i.produtoId, sku: i.sku, nome: i.nome, unidade: i.unidade, quantidade: i.quantidade,
    precoCentavos: i.precoCentavos, descontoCentavos: i.descontoCentavos, totalCentavos: i.totalCentavos }))
    : itens.map((i) => ({ produtoId: String(i["omie_product_id"]), sku: String(i["sku"]), nome: String(i["name"]), unidade: String(i["unit"]), quantidade: Number(i["quantity"]),
      precoCentavos: Number(i["unit_price_cents"]), descontoCentavos: Number(i["discount_cents"]), totalCentavos: Number(i["total_cents"]) }));
  // Estoque sob demanda de todos os itens (o mesmo cálculo do disponível comercial). Nunca altera estoque.
  const ids = [...new Set(fonte.map((i) => i.produtoId))];
  const estoque = ids.length ? await servicoOmie("/estoque", { produtos: ids }) : { ok: false, motivo: "sem_itens" } as RespostaOmie;
  const disponiveis = estoque.ok ? (estoque["produtos"] as Record<string, { disponivel: number | null; sku?: string | null }>) : {};
  if (!estoque.ok) avisos.push(`Estoque não conferido agora (${mensagemOmie(estoque.motivo)}): trate como sem confirmação de estoque.`);
  const pedidoPorProduto = new Map<string, number>();
  // Quantidades têm até três casas: somar milésimos evita 0,1 + 0,2 exceder 0,3 por ponto flutuante.
  for (const item of fonte) pedidoPorProduto.set(item.produtoId, (pedidoPorProduto.get(item.produtoId) ?? 0) + Math.round(item.quantidade * 1000));
  const linhas = fonte.map((i) => {
    const disponivel = disponiveis[i.produtoId]?.disponivel ?? null;
    return { ...i, precoAplicadoCentavos: i.quantidade > 0 ? Math.round(i.totalCentavos / i.quantidade) : 0, disponivel, falta: disponivel === null || (pedidoPorProduto.get(i.produtoId) ?? Math.round(i.quantidade * 1000)) / 1000 > disponivel };
  });
  const faltaEstoque = linhas.some((l) => l.falta);
  if (faltaEstoque && config.semEstoque === "bloquear") bloqueios.push("Estoque insuficiente e a configuração não permite pedido sem estoque.");

  // Conferência explícita ANTES de enviar: versão aceita × payload final do Omie (item a item, condição, previsão, desconto
  // geral, frete, montagem e total). Qualquer diferença bloqueia. Sem vendedor/cliente ainda, o payload é montado só para
  // conferir (itens, valores e condição não dependem deles). SKU: o que o Omie informou agora na consulta de estoque.
  const final = aceita && vendedor && codigoCliente ? montar(q, aceita, config, vendedor.codigo, codigoCliente) : null;
  const paraConferir = final?.pedido ?? (aceita ? montar(q, aceita, config, "0", "0").pedido : null);
  const skusOmie = Object.fromEntries(Object.entries(disponiveis).map(([id, d]) => [id, d.sku ?? null]));
  const conferencia = aceita && paraConferir ? conferirAceitaComPedido(aceita.retrato, paraConferir, skusOmie) : null;
  if (aceita && conferencia && !conferencia.confere) {
    const n = conferencia.divergencias.length;
    bloqueios.push(`O Pedido montado não confere com a proposta aceita (v${aceita.versao}) — ${n} diferença${n > 1 ? "s" : ""}, nada será enviado: ${conferencia.divergencias.slice(0, 3).join("; ")}${n > 3 ? "; …" : ""}.`);
  }
  // Integridade da conversão: além de itens, extras e total, o cliente, o vendedor e a conta corrente do Pedido têm de ser os
  // da versão aceita — cliente do Omie ativo com o CPF/CNPJ da proposta aceita; vendedor vinculado ao dono dela, ativo agora
  // no Omie; conta corrente escolhida para esta venda e congelada no aceite, ativa agora (não existe conta padrão).
  const docAceito = digitos(aceita?.retrato.cliente.documento ?? "");
  const integridade = aceita && conferencia && paraConferir ? (() => {
    const clienteConfere = Boolean(cliente && (!docAceito || digitos(String(cliente["documento"] ?? "")) === docAceito)
      && String(paraConferir.cabecalho.codigo_cliente) === String(cliente["codigo"]));
    const vendedorConfere = Boolean(vendedor && String(paraConferir.informacoes_adicionais.codVend) === vendedor.codigo);
    const contaConfere = Boolean(conta && aceita.conta && String(paraConferir.informacoes_adicionais.codigo_conta_corrente) === aceita.conta.codigo);
    return {
      versao: aceita.versao,
      cliente: { nome: cliente ? String(cliente["razaoSocial"]) : aceita.retrato.cliente.empresa, codigo: cliente ? String(cliente["codigo"]) : codigoCliente, confere: clienteConfere },
      vendedor: { nome: vendedor?.nome ?? vinculado?.nome ?? null, codigo: vendedor?.codigo ?? vinculado?.codigo ?? null, confere: vendedorConfere },
      conta: { nome: conta?.descricao ?? aceita.conta?.descricao ?? null, codigo: aceita.conta?.codigo ?? null, confere: contaConfere },
      integro: conferencia.confere && clienteConfere && vendedorConfere && contaConfere,
    };
  })() : null;
  if (integridade && !integridade.integro && !bloqueios.length) bloqueios.push("Integridade da conversão não confirmada (cliente, vendedor ou conta corrente do Pedido diferente da versão aceita): nada será enviado.");
  const semSku = conferencia?.itens.filter((l) => l.omie && l.skuOmie === null).length ?? 0;
  if (semSku) avisos.push(`SKU não conferido no Omie agora em ${semSku} item${semSku > 1 ? "s" : ""} (a consulta de estoque não o informou): o código do produto foi conferido.`);
  let hash = "";
  if (!bloqueios.length && final) {
    hash = final.hash;
    bloqueios.push(...validarPedidoOmie(final.pedido));
  }
  const responsavel = String((getDb().prepare("SELECT email FROM users WHERE id=?").get(dono) as Linha | undefined)?.["email"] ?? "");
  const token = bloqueios.length ? null : guardarRevisao({ quoteId, userId: u.id, hash, faltaEstoque, politica: config.semEstoque, criadaEm: Date.now() });
  return {
    situacao: (bloqueios.length ? "pendente" : "pronto") as "pendente" | "pronto", escrita, token, bloqueios, avisos, conferencia, integridade,
    estoque: { consultadoEm: (estoque["consultadoEm"] as string | undefined) ?? null, falta: faltaEstoque, politica: config.semEstoque },
    resumo: {
      numero: String(q["number"]), propostaAceita: aceita ? { versao: aceita.versao, geradaEm: aceita.retrato.geradaEm } : null,
      totalCentavos: aceita ? aceita.retrato.totais.subtotalCentavos : Number(q["total_cents"]),
      brutoCentavos: aceita ? aceita.retrato.totais.brutoCentavos : Number(q["gross_cents"]),
      descontoCentavos: aceita ? aceita.retrato.totais.descontoItensCentavos : Number(q["discount_cents"]),
      cliente: cliente ? { codigo: String(cliente["codigo"]), razaoSocial: String(cliente["razaoSocial"]), cidade: String(cliente["cidade"] ?? ""), estado: String(cliente["estado"] ?? ""), documento: documentoMascarado(String(cliente["documento"] ?? "")) } : null,
      clienteOrcamento: { nome: String(q["customer_name"] ?? ""), documento: q["customer_document"] ? documentoMascarado(String(q["customer_document"])) : null },
      responsavel, executor: u.email, vendedor, itens: linhas, formaPagamento: forma ? { codigo: forma.codigo, descricao: forma.descricao } : null,
      previsao: aceita?.retrato.condicoes.previsao ?? null, etapa: etapa ? { codigo: etapa.codigo, descricao: etapa.descricao } : null,
      // Conta: a escolhida para esta venda e congelada no aceite da versão aceita (nunca um "padrão").
      categoria: categoria ? { codigo: categoria.codigo, descricao: categoria.descricao } : null,
      conta: aceita?.conta ? { codigo: aceita.conta.codigo, descricao: conta?.descricao ?? aceita.conta.descricao, ativa: Boolean(conta), versao: aceita.versao } : null,
      // E-mails só mascarados na revisão (o completo fica no orçamento e vai ao Omie; nunca em log).
      consumidorFinal: Boolean(q["final_consumer"]), emailNf: q["nf_email"] ? mascararEmails(String(q["nf_email"])) : null,
      emailCadastro: cliente && cliente["email"] ? mascararEmails(String(cliente["email"])) : null, observacoes: (q["order_notes"] as string | null) ?? null,
      // As observações comerciais da proposta aceita ficam só na proposta (nunca vão ao Omie): a tela apenas avisa que existem.
      observacoesComerciais: Boolean(aceita?.retrato.observacoes?.trim()),
    },
    candidatos: candidatos?.map((c) => ({ codigo: String(c["codigo"]), razaoSocial: String(c["razaoSocial"]), nomeFantasia: String(c["nomeFantasia"] ?? ""), cidade: String(c["cidade"] ?? ""), estado: String(c["estado"] ?? ""), inativo: Boolean(c["inativo"]), documento: documentoMascarado(String(c["documento"] ?? "")) })) ?? null,
  };
}

// ---------- E-mail da NF: o do cadastro do cliente no Omie (o mesmo que o ERP usa), sem digitar e sem mostrar inteiro ----------
export async function usarEmailDoCadastro(u: SiteUser, quoteId: string) {
  const q = orcamentoDoUsuario(u, quoteId);
  if (q["status"] === "enviado_omie" || q["status"] === "cancelado") throw new Error("Orçamento já enviado ou cancelado");
  const codigo = clienteOmieDo(q);
  if (!codigo) throw new Error("Vincule primeiro o cliente do Omie");
  const r = await servicoOmie(`/clientes/${codigo}`);
  if (!r.ok) throw new Error(mensagemOmie(r.motivo));
  const lista = String((r["cliente"] as Linha | null)?.["email"] ?? "").split(/[,;]/).map((e) => e.trim().toLowerCase()).filter(Boolean).join(",");
  if (!lista || lista.length > 500 || !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+(,[^\s@,]+@[^\s@,]+\.[^\s@,]+)*$/.test(lista)) throw new Error("O cadastro do cliente no Omie não tem e-mail válido");
  transaction(() => {
    getDb().prepare("UPDATE internal_quotes SET nf_email=?, version=version+1, updated_at=? WHERE id=?").run(lista, agoraIso(), quoteId);
    audit(u.id, "quote:nf_email", quoteId, { origem: "cadastro_omie", enderecos: lista.split(",").length });
  });
  return { ok: true, emailNf: mascararEmails(lista) };
}

// ---------- Cliente: busca, vínculo confirmado e criação controlada ----------
export async function buscarClientesOmie(u: SiteUser, quoteId: string, busca: { documento?: string; nome?: string }) {
  orcamentoDoUsuario(u, quoteId);
  const caminho = busca.documento ? `/clientes?documento=${encodeURIComponent(busca.documento)}` : `/clientes?nome=${encodeURIComponent(busca.nome ?? "")}`;
  const r = await servicoOmie(caminho);
  if (!r.ok) return { ok: false, mensagem: r.motivo === "documento_invalido" ? "CPF/CNPJ inválido." : r.motivo === "busca_invalida" ? "Digite ao menos 3 letras do nome." : mensagemOmie(r.motivo) };
  return { ok: true, mais: r["mais"] === true, clientes: (r["clientes"] as Linha[]).map((c) => ({ codigo: String(c["codigo"]), razaoSocial: String(c["razaoSocial"]), nomeFantasia: String(c["nomeFantasia"] ?? ""), cidade: String(c["cidade"] ?? ""), estado: String(c["estado"] ?? ""), inativo: Boolean(c["inativo"]), documento: documentoMascarado(String(c["documento"] ?? "")) })) };
}

/** Vínculo explícito (clique do usuário). Com CPF/CNPJ no orçamento, o do cliente do Omie TEM de ser o mesmo. */
export async function vincularCliente(u: SiteUser, quoteId: string, codigoCliente: string) {
  const q = orcamentoDoUsuario(u, quoteId);
  if (q["status"] === "enviado_omie" || q["status"] === "cancelado") throw new Error("Orçamento já enviado ou cancelado");
  const r = await servicoOmie(`/clientes/${codigoCliente}`);
  if (!r.ok) throw new Error(mensagemOmie(r.motivo));
  const c = r["cliente"] as Linha | null;
  if (!c) throw new Error("Cliente não encontrado no Omie");
  if (c["inativo"]) throw new Error("Cliente inativo no Omie não pode ser usado");
  const doc = q["customer_document"] ? String(q["customer_document"]) : "";
  if (doc && String(c["documento"]) !== doc) throw new Error("O CPF/CNPJ do cliente escolhido não confere com o do orçamento");
  transaction(() => {
    const agora = agoraIso();
    if (q["customer_id"]) getDb().prepare("UPDATE customers SET omie_customer_id=?, omie_linked_at=?, omie_linked_by=?, updated_at=? WHERE id=?").run(codigoCliente, agora, u.id, agora, String(q["customer_id"]));
    else getDb().prepare("UPDATE internal_quotes SET omie_customer_id=?, updated_at=? WHERE id=?").run(codigoCliente, agora, quoteId);
    audit(u.id, "omie_customer:linked", quoteId, { cliente_omie: codigoCliente, conferido: doc ? "cpf_cnpj" : "selecao_manual" });
  });
  return { ok: true };
}

/** Cliente novo no Omie: só sem nenhum cadastro com o mesmo CPF/CNPJ, com dados confirmados e e-mail (exigido pelo Omie). */
export async function criarClienteOmie(u: SiteUser, quoteId: string) {
  const q = orcamentoDoUsuario(u, quoteId);
  if (clienteOmieDo(q)) throw new Error("Este orçamento já tem cliente do Omie vinculado");
  if (!q["customer_id"] || !q["customer_document"]) throw new Error("Informe um CPF/CNPJ válido no orçamento para criar o cliente");
  if (!q["customer_email"]) throw new Error("Informe o e-mail do cliente no orçamento (o Omie exige para a nota fiscal)");
  const busca = await servicoOmie(`/clientes?documento=${String(q["customer_document"])}`);
  if (!busca.ok) throw new Error(`Não foi possível conferir duplicidade no Omie: ${mensagemOmie(busca.motivo)}`);
  if ((busca["clientes"] as Linha[]).length) throw new Error("Já existe cliente com este CPF/CNPJ no Omie: vincule em vez de criar");
  const inicio = Date.now();
  const r = await servicoOmie("/clientes", {
    codigo_cliente_integracao: `MAG-C-${String(q["customer_id"]).replace(/-/g, "")}`, razao_social: String(q["customer_name"]).slice(0, 60),
    nome_fantasia: String(q["customer_trade_name"] || q["customer_name"]).slice(0, 100), cnpj_cpf: String(q["customer_document"]),
    email: String(q["customer_email"]), telefone: String(q["customer_phone"] ?? ""),
  });
  if (r.simulado) { audit(u.id, "omie_customer:simulated", quoteId, { ms: Date.now() - inicio }); return { ok: false, simulado: true, mensagem: mensagemOmie("escrita_desligada") }; }
  if (!r.ok) {
    audit(u.id, "omie_customer:failed", quoteId, { motivo: r.motivo ?? "erro", ms: Date.now() - inicio });
    return { ok: false, mensagem: textoFalha(r) };
  }
  const codigo = String(r["codigoCliente"]);
  transaction(() => {
    const agora = agoraIso();
    getDb().prepare("UPDATE customers SET omie_customer_id=?, omie_linked_at=?, omie_linked_by=?, updated_at=? WHERE id=?").run(codigo, agora, u.id, agora, String(q["customer_id"]));
    audit(u.id, "omie_customer:created", quoteId, { cliente_omie: codigo, existente: Boolean(r.existente), ms: Date.now() - inicio });
  });
  return { ok: true, codigoCliente: codigo };
}

// ---------- 2) Criação do pedido (só depois da revisão e da confirmação explícita) ----------
export async function gerarPedido(u: SiteUser, quoteId: string, token: string, confirmacoes: { revisado: boolean; semEstoque: boolean }) {
  if (confirmacoes.revisado !== true) throw new Error("Confirme que revisou o pedido antes de criá-lo no Omie");
  if (!consumeRateLimit(`omie-pedido:${sha(u.id)}`, 10, 600)) throw new Error("Muitas tentativas em pouco tempo. Aguarde alguns minutos.");
  const revisao = usarRevisao(token, quoteId, u.id);
  const q = orcamentoDoUsuario(u, quoteId);
  if (q["status"] === "enviado_omie") return { ok: true, jaExistia: true, envio: resumoEnvio(envioDo(quoteId)) };
  assertDiscountApproval(quoteId);
  if (!podeGerarPedido(q["status"] as Estado)) throw new Error("Só orçamento ACEITO pelo cliente pode virar Pedido no Omie");
  const config = lerConfiguracao();
  const aceita = versaoAceitaDo(q);
  const problemas = conferirVersaoAceita(q, itensDo(quoteId), aceita);
  if (problemas.length || !aceita) throw new Error(problemas[0] ?? "Sem versão aceita da proposta.");
  const vendedor = vendedorDoUsuario(aceita.dono);
  const codigoCliente = clienteOmieDo(q);
  if (!vendedor || !codigoCliente) throw new Error("Vendedor ou cliente do Omie mudou depois da revisão. Revise de novo.");
  const itens = aceita.retrato.itens;
  const { pedido, hash } = montar(q, aceita, config, vendedor.codigo, codigoCliente);
  if (hash !== revisao.hash) throw new Error("O orçamento ou a configuração mudou depois da revisão. Revise de novo.");
  // 2ª conferência, no payload exato que vai sair: qualquer diferença com a versão aceita bloqueia (nada é enviado).
  const conferencia = conferirAceitaComPedido(aceita.retrato, pedido);
  if (!conferencia.confere) throw new Error(`O Pedido não confere com a proposta aceita (v${aceita.versao}): ${conferencia.divergencias[0]}. Nada foi enviado.`);
  if (revisao.faltaEstoque && revisao.politica === "bloquear") throw new Error("Estoque insuficiente: a configuração não permite pedido sem estoque.");
  if (revisao.faltaEstoque && revisao.politica === "confirmar" && confirmacoes.semEstoque !== true) {
    throw new Error("Há itens sem estoque suficiente: confirme que o pedido segue mesmo assim (encomenda).");
  }
  const inicio = Date.now();

  // Escrita desligada: o serviço valida de novo e devolve "simulado". Nenhum estado muda, nada vai ao Omie.
  const servico = await servicoOmie("/verificar");
  if (!servico.ok) throw new Error(mensagemOmie(servico.motivo));
  if (servico["escrita"] !== true) {
    const sim = await servicoOmie("/pedidos", pedido);
    audit(u.id, "omie_order:simulated", quoteId, { resultado: sim.simulado ? "simulado" : sim.motivo ?? "erro", itens: itens.length, total_centavos: aceita.retrato.totais.subtotalCentavos,
      quote_created_by: String(q["owner_id"]), omie_order_created_by: u.id, omie_seller: vendedor.codigo, omie_seller_nome: vendedor.nome, proposta_versao: aceita.versao,
      conta_corrente: aceita.conta?.codigo ?? null,
      ms: Date.now() - inicio });
    const mostrado = { ...pedido, informacoes_adicionais: { ...pedido.informacoes_adicionais, utilizar_emails: mascararEmails(pedido.informacoes_adicionais.utilizar_emails) } };
    return { ok: false, simulado: Boolean(sim.simulado), mensagem: sim.simulado ? mensagemOmie("escrita_desligada") : textoFalha(sim), payload: sim.simulado ? mostrado : null };
  }

  // Trava: só um envio por orçamento. Duplo clique / duas abas: a segunda vê "enviando" e não envia.
  const trava = transaction(() => {
    const e = envioDo(quoteId);
    if (e?.["state"] === "criado") return { ja: true as const };
    if (e?.["state"] === "enviando" && Date.now() - Date.parse(String(e["updated_at"])) < ENVIO_TRAVADO_MS) return { emAndamento: true as const };
    const agora = agoraIso();
    const snapshot = JSON.stringify(itens.map((i) => ({ produto: i.produtoId, qtd: i.quantidade, preco: i.precoCentavos, desconto: i.descontoCentavos, total: i.totalCentavos })));
    getDb().prepare(`INSERT INTO omie_orders(quote_id,integration_code,state,omie_customer_id,omie_seller_id,stage_code,payment_code,sent_by,attempts,last_attempt_at,
        payload_sha256,items_snapshot,created_at,updated_at) VALUES (?,?,'enviando',?,?,?,?,?,1,?,?,?,?,?)
      ON CONFLICT(quote_id) DO UPDATE SET state='enviando', omie_customer_id=excluded.omie_customer_id, omie_seller_id=excluded.omie_seller_id,
        stage_code=excluded.stage_code, payment_code=excluded.payment_code, sent_by=excluded.sent_by, attempts=attempts+1, last_attempt_at=excluded.last_attempt_at,
        payload_sha256=excluded.payload_sha256, items_snapshot=excluded.items_snapshot, updated_at=excluded.updated_at`)
      .run(quoteId, String(q["number"]), codigoCliente, vendedor.codigo, config.etapa, String(aceita.retrato.condicoes.pagamentoCodigo), u.id, agora, hash, snapshot, agora, agora);
    audit(u.id, "omie_order:create_attempt", quoteId, { tentativa: Number(e?.["attempts"] ?? 0) + 1, anterior: (e?.["state"] as string | undefined) ?? null, ...autoriaDoEnvio(quoteId) });
    return { anterior: (e?.["state"] as string | undefined) ?? null };
  });
  if ("ja" in trava) return { ok: true, jaExistia: true, envio: resumoEnvio(envioDo(quoteId)) };
  if ("emAndamento" in trava) return { ok: false, emAndamento: true, mensagem: "Este pedido já está sendo enviado. Aguarde alguns segundos e atualize." };

  // Consulta ANTES de incluir: se o Omie já tem esse código de integração, só registra (nunca inclui de novo).
  const consulta = await servicoOmie(`/pedidos?integracao=${encodeURIComponent(String(q["number"]))}`);
  if (consulta.ok && consulta["encontrado"] === true) {
    const achado = consulta["pedido"] as PedidoAchado;
    if (!pedidoConfere(resumoDoPedido(pedido), achado)) {
      registrarFalha(u, quoteId, "erro", "conflito_integracao", "", inicio);
      return { ok: false, mensagem: mensagemOmie("conflito_integracao") };
    }
    concluirCriado(u, quoteId, achado, "existente", inicio);
    return { ok: true, jaExistia: true, envio: resumoEnvio(envioDo(quoteId)) };
  }
  if (!consulta.ok) {
    const incerto = trava.anterior === "incerto" || trava.anterior === "enviando";
    registrarFalha(u, quoteId, incerto ? "incerto" : "erro", consulta.motivo ?? "indisponivel", "consulta antes do envio", inicio);
    return { ok: false, mensagem: `Não foi possível consultar o Omie antes de enviar; nada foi enviado. ${mensagemOmie(consulta.motivo)}` };
  }

  const r = await servicoOmie("/pedidos", pedido);
  if (r.ok) {
    concluirCriado(u, quoteId, { codigoPedido: String(r["codigoPedido"]), numeroPedido: String(r["numeroPedido"] ?? ""), etapa: String(r["etapa"] ?? config.etapa) },
      r.existente ? "existente" : "criado", inicio, (r["conferencia"] as ConferenciaPedido | null | undefined) ?? null);
    return { ok: true, envio: resumoEnvio(envioDo(quoteId)) };
  }
  if (r.motivo === "incerto") {
    registrarFalha(u, quoteId, "incerto", "incerto", "", inicio);
    return { ok: false, incerto: true, mensagem: mensagemOmie("incerto") };
  }
  registrarFalha(u, quoteId, "erro", r.motivo ?? "erro", [r.mensagem, ...(Array.isArray(r.erros) ? r.erros : [])].filter(Boolean).join("; "), inicio);
  return { ok: false, mensagem: textoFalha(r) };
}

/** Status sob demanda (nunca a cada carregamento): etapa, faturado e cancelado como o Omie informa. */
export async function atualizarStatus(u: SiteUser, quoteId: string) {
  if (!consumeRateLimit(`omie-status:${sha(u.id)}`, 30, 600)) throw new Error("Muitas consultas em pouco tempo. Aguarde alguns minutos.");
  orcamentoDoUsuario(u, quoteId);
  const e = envioDo(quoteId);
  if (!e || e["state"] !== "criado" || !e["omie_order_id"]) throw new Error("Este orçamento ainda não tem Pedido no Omie");
  const r = await servicoOmie(`/pedidos/${String(e["omie_order_id"])}/status`);
  if (!r.ok) return { ok: false, mensagem: mensagemOmie(r.motivo) };
  const s = r["status"] as { etapa: string; cancelado: boolean; faturado: boolean; valorTotal: number | null; numeroPedido: string };
  transaction(() => {
    getDb().prepare(`UPDATE omie_orders SET status_stage=?, status_cancelled=?, status_invoiced=?, status_total_cents=?, status_checked_at=?,
      omie_order_number=COALESCE(NULLIF(?, ''), omie_order_number), updated_at=? WHERE quote_id=?`).run(s.etapa || null, s.cancelado ? 1 : 0, s.faturado ? 1 : 0,
      s.valorTotal === null ? null : Math.round(s.valorTotal * 100), agoraIso(), s.numeroPedido ?? "", agoraIso(), quoteId);
    audit(u.id, "omie_order:status_sync", quoteId, { omie_order_id: String(e["omie_order_id"]), etapa: s.etapa || null, faturado: s.faturado, cancelado: s.cancelado });
  });
  return { ok: true, envio: resumoEnvio(envioDo(quoteId)) };
}
