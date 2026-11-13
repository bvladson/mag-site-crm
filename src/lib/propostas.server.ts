/**
 * Proposta comercial do orçamento interno. Admin: todos os orçamentos; Comercial: só os próprios (a mesma regra do
 * orçamento, conferida aqui); DHO e sem sessão são barrados antes, nas funções do servidor e na rota do PDF.
 * Cada "Gerar proposta" grava uma VERSÃO (v1, v2…) com o retrato dos dados usados; o PDF é sempre refeito a partir desse
 * retrato, então a proposta enviada não muda se produto, preço, foto ou cadastro mudarem depois. Nada aqui chama o Omie.
 * Versões: uma VIGENTE por orçamento (WhatsApp, e-mail, imprimir, compartilhar e aceite usam só ela); enviada ou aceita
 * fica imutável; arquivar e excluir (só rascunho nunca enviado) apenas marcam — o número da versão nunca é reutilizado.
 * Consultor(a) = perfil comercial do DONO do orçamento, nunca de quem clicou em Gerar.
 * Auditoria: só ids, versão e ação — nunca documento, contato, endereço, e-mail ou conteúdo do PDF.
 */
import { createHash, randomUUID } from "node:crypto";
import { getDb, transaction, audit, consumeRateLimit } from "./local-db.server.ts";
import type { SiteUser } from "./local-auth-core.server.ts";
import { orcamentoDoUsuario, ehAdmin, pendencias } from "./orcamentos.server.ts";
import { vendedorDoUsuario } from "./omie-referencias.server.ts";
import { documentoFormatado, editavel, hojeFortaleza, type Estado } from "./orcamento-regras.ts";
import {
  totaisDaProposta, validarExtras, nomeArquivoProposta, nomeDeExibicao, rotuloDesconto, somarDias, telefoneBR, telefoneWhatsApp, mensagemWhatsApp,
  assuntoEmail, mensagemEmail, validarEmitente, validarPerfil, consultorDoPerfil, compararRetratos, CARGO_PADRAO,
  type DadosEmitente, type SnapshotProposta, type ItemProposta, type PerfilComercial,
} from "./proposta-regras.ts";
import { itensDo, extrasDo, hashDoOrcamento, versaoVigente, dadosDoPedido, hashDoPedido } from "./proposta-conteudo.server.ts";
import { renderizarProposta, type DependenciasPdf } from "./proposta-pdf.server.ts";
import { site } from "../config/site.ts";
import { assertDiscountApproval } from "./discounts.server.ts";

type Linha = Record<string, unknown>;
const s = (valor: unknown) => (valor === null || valor === undefined ? "" : String(valor));
const sha = (dados: string | Uint8Array) => createHash("sha256").update(dados).digest("hex");
const limparTexto = (t: unknown, multilinha = false) => {
  const v = s(t).replace(multilinha ? /[\x00-\x09\x0b-\x1f\x7f]/g : /[\x00-\x1f\x7f]/g, " ");
  return (multilinha ? v.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 3).join("\n") : v.replace(/\s+/g, " ")).trim();
};

// ---------- Dados institucionais do cabeçalho/rodapé (Admin) ----------
const PADRAO_EMITENTE: DadosEmitente = {
  nomeComercial: site.name, razaoSocial: "MAGAZINE DOS MOVEIS LTDA", cnpj: site.cnpj, endereco: site.address, telefone: site.phone,
  whatsapp: telefoneBR(site.whatsapp), email: site.email, site: "magmoveiscorporativos.com.br", rodape: "", validadeDias: 7,
  inscricaoEstadual: "", dadosBancarios: "", pix: "",
};
const CHAVES = Object.keys(PADRAO_EMITENTE) as (keyof DadosEmitente)[];

export function lerEmitente(): DadosEmitente {
  const gravados = new Map((getDb().prepare("SELECT key, value FROM proposal_settings").all() as Linha[]).map((l) => [s(l["key"]), s(l["value"])]));
  const emitente: DadosEmitente = { ...PADRAO_EMITENTE };
  for (const chave of CHAVES) {
    const valor = gravados.get(chave);
    if (valor === undefined) continue;
    if (chave === "validadeDias") emitente.validadeDias = Number(valor) || PADRAO_EMITENTE.validadeDias;
    else (emitente as Record<string, unknown>)[chave] = valor;
  }
  return emitente;
}

export function salvarEmitente(ator: SiteUser, dados: DadosEmitente) {
  if (!ehAdmin(ator)) throw new Error("Forbidden: só o Admin altera os dados da proposta");
  const limpo = { ...dados } as DadosEmitente;
  for (const chave of CHAVES) {
    if (chave !== "validadeDias") (limpo as Record<string, unknown>)[chave] = limparTexto(dados[chave]);
  }
  const erros = validarEmitente(limpo);
  if (erros.length) throw new Error(erros.join("; "));
  const atual = lerEmitente();
  const alterados = CHAVES.filter((chave) => String(atual[chave]) !== String(limpo[chave]));
  transaction(() => {
    const gravar = getDb().prepare(`INSERT INTO proposal_settings(key,value,updated_at,updated_by) VALUES (?,?,?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by`);
    const agora = new Date().toISOString();
    for (const chave of CHAVES) gravar.run(chave, String(limpo[chave]), agora, ator.id);
    // Só os NOMES dos campos alterados (os valores ficam na tabela, não na auditoria).
    audit(ator.id, "proposal_settings:changed", null, { campos: alterados.join(",") || "nenhum" });
  });
  return lerEmitente();
}

// ---------- Perfil comercial (Minha conta) ----------
/**
 * Perfil efetivo de um usuário: o gravado em "Minha conta" ou o padrão — só o NOME (do vendedor no Omie ou do e-mail).
 * Contato nunca tem preenchimento automático: sem e-mail/telefone/WhatsApp da proposta gravados e marcados, nada aparece.
 */
export function perfilDe(usuarioId: string): PerfilComercial & { configurado: boolean } {
  const u = getDb().prepare("SELECT email, display_name FROM users WHERE id=?").get(usuarioId) as Linha | undefined;
  const p = getDb().prepare("SELECT * FROM proposal_profiles WHERE user_id=?").get(usuarioId) as Linha | undefined;
  const nomePadrao = u ? nomeDeExibicao(s(u["display_name"]), vendedorDoUsuario(usuarioId)?.nome ?? null, s(u["email"])) : "Equipe comercial";
  if (!p) {
    return { nome: nomePadrao, cargo: CARGO_PADRAO, telefone: "", whatsapp: "", email: "", assinatura: "",
      exibirTelefone: false, exibirWhatsapp: false, exibirEmail: false, configurado: false };
  }
  return {
    nome: s(p["name"]) || nomePadrao, cargo: s(p["role"]) || CARGO_PADRAO, telefone: s(p["phone"]), whatsapp: s(p["whatsapp"]), email: s(p["email"]),
    assinatura: s(p["signature"]), exibirTelefone: Boolean(p["show_phone"]), exibirWhatsapp: Boolean(p["show_whatsapp"]), exibirEmail: Boolean(p["show_email"]),
    configurado: true,
  };
}
export const nomeDoUsuario = (usuarioId: string) => perfilDe(usuarioId).nome;
/** O que aparece para o cliente (e na prévia para quem não é o dono): só os contatos marcados para exibição. */
export const consultorPublico = (usuarioId: string) => consultorDoPerfil(perfilDe(usuarioId));

/** Perfil completo SÓ para a própria pessoa (contatos não exibidos nunca vão para a tela de outra pessoa). */
export function lerMeuPerfil(u: SiteUser) {
  const perfil = perfilDe(u.id);
  return { perfil, comoAparece: consultorDoPerfil(perfil) };
}
export function salvarMeuPerfil(u: SiteUser, dados: PerfilComercial) {
  const limpo: PerfilComercial = {
    nome: limparTexto(dados.nome), cargo: limparTexto(dados.cargo), telefone: limparTexto(dados.telefone), whatsapp: limparTexto(dados.whatsapp),
    email: limparTexto(dados.email).toLowerCase(), assinatura: limparTexto(dados.assinatura, true),
    exibirTelefone: Boolean(dados.exibirTelefone), exibirWhatsapp: Boolean(dados.exibirWhatsapp), exibirEmail: Boolean(dados.exibirEmail),
  };
  const erros = validarPerfil(limpo);
  if (erros.length) throw new Error(erros.join("; "));
  const anterior = perfilDe(u.id);
  const campos = (Object.keys(limpo) as (keyof PerfilComercial)[]).filter((k) => String(anterior[k]) !== String(limpo[k]));
  transaction(() => {
    getDb().prepare(`INSERT INTO proposal_profiles(user_id,name,role,phone,whatsapp,email,signature,show_phone,show_whatsapp,show_email,updated_at,updated_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET name=excluded.name, role=excluded.role, phone=excluded.phone,
      whatsapp=excluded.whatsapp, email=excluded.email, signature=excluded.signature, show_phone=excluded.show_phone, show_whatsapp=excluded.show_whatsapp,
      show_email=excluded.show_email, updated_at=excluded.updated_at, updated_by=excluded.updated_by`)
      .run(u.id, limpo.nome || null, limpo.cargo || null, limpo.telefone || null, limpo.whatsapp || null, limpo.email || null, limpo.assinatura || null,
        limpo.exibirTelefone ? 1 : 0, limpo.exibirWhatsapp ? 1 : 0, limpo.exibirEmail ? 1 : 0, new Date().toISOString(), u.id);
    // Só os nomes dos campos (nunca telefone, e-mail ou assinatura).
    audit(u.id, "user:proposal_profile", u.id, { campos: campos.join(",") || "nenhum" });
  });
  return lerMeuPerfil(u);
}

// ---------- Retrato (snapshot) de uma versão ----------
/** O que o catálogo do site diz de um produto: selo "pronta entrega", quantidade (só para conferir, nunca impressa) e foto. */
export type InfoCatalogo = { prontaEntrega: boolean; disponivel: number | null; foto: string | null };
export type Catalogo = (produtoId: string) => InfoCatalogo | null;

function montarRetrato(q: Linha, itens: Linha[], ctx: { versao: number; geradaEm: string; validade: string; mostrarSku: boolean; emitente: DadosEmitente; catalogo: Catalogo }): SnapshotProposta {
  // O mesmo produto em mais de uma linha: o disponível precisa cobrir a SOMA das quantidades.
  const pedidoPorProduto = new Map<string, number>();
  for (const i of itens) pedidoPorProduto.set(s(i["omie_product_id"]), (pedidoPorProduto.get(s(i["omie_product_id"])) ?? 0) + Math.round(Number(i["quantity"]) * 1000));
  const linhas: ItemProposta[] = itens.map((i, n) => {
    const info = ctx.catalogo(s(i["omie_product_id"]));
    const quantidade = Number(i["quantity"]);
    const pedido = (pedidoPorProduto.get(s(i["omie_product_id"])) ?? Math.round(quantidade * 1000)) / 1000;
    return {
      posicao: n + 1, produtoId: s(i["omie_product_id"]), sku: s(i["sku"]), nome: s(i["name"]), unidade: s(i["unit"]) || "UN", quantidade,
      precoCentavos: Number(i["unit_price_cents"]), brutoCentavos: Number(i["gross_cents"]), descontoCentavos: Number(i["discount_cents"]),
      descontoRotulo: rotuloDesconto(i["discount_type"] as string | null, Number(i["discount_value"])), totalCentavos: Number(i["total_cents"]),
      // "Pronta entrega" só com o selo do catálogo E disponível que cobre a quantidade pedida (o número nunca sai do servidor).
      prontaEntrega: info !== null && info.prontaEntrega && (info.disponivel === null || info.disponivel >= pedido),
      foto: info?.foto ?? null,
    };
  });
  const documento = s(q["customer_document"]);
  const dadosPedido = dadosDoPedido(q);
  return {
    versao: ctx.versao, numero: s(q["number"]), geradaEm: ctx.geradaEm, layout: 2, emitente: ctx.emitente,
    cliente: {
      empresa: s(q["customer_name"]), fantasia: s(q["customer_trade_name"]), contato: s(q["customer_contact"]), documento: documento ? documentoFormatado(documento) : "",
      cidade: s(q["customer_city"]), uf: s(q["customer_state"]), email: s(q["customer_email"]), telefone: s(q["customer_phone"]) ? telefoneBR(s(q["customer_phone"])) : "",
    },
    // Consultor(a) = perfil comercial do DONO do orçamento (mesmo quando quem gera é o Admin), só com os contatos exibidos.
    consultor: consultorPublico(s(q["owner_id"])),
    itens: linhas, totais: totaisDaProposta(linhas, extrasDo(q)),
    condicoes: { pagamento: s(q["payment_label"]) || null, pagamentoCodigo: s(q["payment_code"]) || null, previsao: s(q["forecast_date"]) || null, validade: ctx.validade },
    observacoes: s(q["proposal_notes"]) || null, opcoes: { mostrarSku: ctx.mostrarSku },
    // Dados do pedido desta versão (não saem no PDF): o aceite e o Pedido no Omie exigem que continuem iguais.
    pedido: { ...dadosPedido, contaDescricao: dadosPedido.conta
      ? s((getDb().prepare("SELECT label FROM omie_refs WHERE kind='conta' AND code=?").get(dadosPedido.conta) as Linha | undefined)?.["label"]) : "" },
  };
}

/** Maior número já usado (inclusive excluídas): o número nunca é reutilizado. */
const maiorVersao = (quoteId: string) => Number((getDb().prepare("SELECT max(version) v FROM quote_proposals WHERE quote_id=?").get(quoteId) as Linha | undefined)?.["v"] ?? 0);

/**
 * Gera a próxima versão, que vira a VIGENTE. Rascunho vira "salvo" (exige o mesmo de "Salvar orçamento"); a validade vazia
 * vira hoje + o padrão do Admin e fica gravada no orçamento. Gerar NÃO é aceite: o aceite continua manual.
 */
export async function gerarProposta(u: SiteUser, quoteId: string, pedido: { versaoOrcamento: number; mostrarSku: boolean }, catalogo: Catalogo, dep: DependenciasPdf = {}) {
  if (!consumeRateLimit(`proposta:${sha(u.id)}`, 30, 600)) throw new Error("Muitas propostas geradas em pouco tempo. Aguarde alguns minutos.");
  const q = orcamentoDoUsuario(u, quoteId);
  if (!editavel(q["status"] as Estado)) throw new Error("Nova versão da proposta só para orçamento em rascunho, salvo ou enviado ao cliente. Depois do aceite, use \"Criar nova revisão\".");
  if (Number(q["version"]) !== pedido.versaoOrcamento) throw new Error("Este orçamento foi alterado por outra pessoa. Recarregue a página.");
  const itens = itensDo(quoteId);
  const subtotal = itens.reduce((soma, i) => soma + Number(i["total_cents"]), 0);
  const faltam = [...pendencias(q, itens, "salvar"), ...validarExtras(extrasDo(q), subtotal)];
  if (faltam.length) throw new Error(`Falta: ${faltam.join("; ")}`);
  const hoje = hojeFortaleza();
  const emitente = lerEmitente();
  const validade = s(q["valid_until"]) || somarDias(hoje, emitente.validadeDias);
  if (validade < hoje) throw new Error("A validade da proposta já passou: ajuste a data em \"Dados da proposta\" e salve.");
  const hash = hashDoOrcamento(q, itens, validade);
  const hashPedido = hashDoPedido(q);
  const vigente = getDb().prepare(`SELECT version, content_hash, order_hash, created_at, json_extract(snapshot,'$.opcoes.mostrarSku') AS sku FROM quote_proposals
    WHERE quote_id=? AND current=1`).get(quoteId) as Linha | undefined;
  // Clique duplo: mesmo conteúdo, mesmos dados do pedido e mesmas opções há menos de 30 s → devolve a versão recém-gerada.
  if (vigente && s(vigente["content_hash"]) === hash && s(vigente["order_hash"]) === hashPedido && Boolean(vigente["sku"]) === pedido.mostrarSku
    && Date.now() - Date.parse(s(vigente["created_at"])) < 30_000) {
    return { versao: Number(vigente["version"]), nova: false };
  }
  const anterior = maiorVersao(quoteId);
  const versao = anterior + 1;
  const geradaEm = new Date().toISOString();
  const dono = s(q["owner_id"]);
  const retrato = montarRetrato(q, itens, { versao, geradaEm, validade, mostrarSku: pedido.mostrarSku, emitente, catalogo });
  const pdf = await renderizarProposta(retrato, dep); // antes de gravar: proposta que não vira PDF não vira versão
  return transaction(() => {
    const atual = orcamentoDoUsuario(u, quoteId);
    if (Number(atual["version"]) !== pedido.versaoOrcamento) throw new Error("Este orçamento foi alterado enquanto a proposta era gerada. Recarregue a página.");
    if (maiorVersao(quoteId) !== anterior) throw new Error("Outra versão da proposta acabou de ser gerada. Recarregue a página.");
    getDb().prepare("UPDATE quote_proposals SET current=0 WHERE quote_id=? AND current=1").run(quoteId);
    getDb().prepare(`INSERT INTO quote_proposals(id,quote_id,version,created_at,created_by,owner_id,consultant_id,content_hash,order_hash,snapshot,pdf_sha256,current)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,1)`).run(randomUUID(), quoteId, versao, geradaEm, u.id, dono, dono, hash, hashPedido, JSON.stringify(retrato), sha(pdf.bytes));
    const estado = s(atual["status"]);
    if (estado === "rascunho" || !atual["valid_until"]) {
      getDb().prepare(`UPDATE internal_quotes SET status=CASE WHEN status='rascunho' THEN 'salvo' ELSE status END, valid_until=COALESCE(valid_until, ?),
        version=version+1, updated_at=? WHERE id=?`).run(validade, geradaEm, quoteId);
      if (estado === "rascunho") audit(u.id, "quote:status:salvo", quoteId, { de: "rascunho", via: "proposta" });
    }
    // Três papéis separados: dono do orçamento, consultor(a) impresso (= dono) e quem clicou em Gerar.
    audit(u.id, "quote:proposta:gerada", quoteId, { versao, quote_owner: dono, proposal_consultant: dono, proposal_generated_by: u.id });
    return { versao, nova: true };
  });
}

/**
 * Histórico ("v2 — 08/10 11:05 — gerada por Mateus") com o estado de cada versão, a vigente, a aceita, o aviso de
 * orçamento alterado depois da vigente e a prévia do consultor (só os contatos exibidos; editar só o próprio dono).
 */
export function resumoPropostas(quoteId: string, quem?: SiteUser) {
  const q = getDb().prepare("SELECT * FROM internal_quotes WHERE id=?").get(quoteId) as Linha;
  const linhas = getDb().prepare(`SELECT id, version, created_at, created_by, content_hash, order_hash, current, sent_at, accepted_at, archived_at, share_started_at, share_channel, refused_at,
      json_extract(snapshot,'$.totais.totalCentavos') AS total, json_extract(snapshot,'$.numero') AS numero, json_extract(snapshot,'$.cliente.empresa') AS empresa,
      json_extract(snapshot,'$.opcoes.mostrarSku') AS sku, json_extract(snapshot,'$.consultor.nome') AS consultor
    FROM quote_proposals WHERE quote_id=? AND deleted_at IS NULL ORDER BY version DESC`).all(quoteId) as Linha[];
  const nomes = new Map<string, string>();
  const nome = (id: string) => { if (!nomes.has(id)) nomes.set(id, nomeDoUsuario(id)); return nomes.get(id)!; };
  const aceitaId = s(q["accepted_proposal_id"]);
  const versoes = linhas.map((l) => {
    const vigente = Boolean(l["current"]); const enviada = Boolean(l["sent_at"]); const aceita = Boolean(l["accepted_at"]); const arquivada = Boolean(l["archived_at"]);
    const recusada = Boolean(l["refused_at"]); const compartilhamentoIniciado = Boolean(l["share_started_at"]);
    return {
      versao: Number(l["version"]), criadaEm: s(l["created_at"]), geradaPor: nome(s(l["created_by"])), consultor: s(l["consultor"]), totalCentavos: Number(l["total"]),
      arquivo: nomeArquivoProposta(s(l["numero"]), s(l["empresa"]), Number(l["version"])), mostrarSku: Boolean(l["sku"]),
      vigente, enviada, aceita, aceitaAtual: aceita && s(l["id"]) === aceitaId, arquivada, recusada, compartilhamentoIniciado,
      canal: s(l["share_channel"]) || null, substituida: !vigente && !aceita && !recusada,
      // Só compartilhar (sem marcar "enviada") não congela: o painel não sabe se o vendedor apertou "Enviar".
      podeExcluir: !vigente && !enviada && !aceita && !recusada, podeArquivar: !vigente && !aceita && !arquivada,
    };
  });
  const vigente = linhas.find((l) => Boolean(l["current"]));
  const alterado = vigente ? hashDoOrcamento(q, itensDo(quoteId), s(q["valid_until"])) !== s(vigente["content_hash"]) : false;
  // Dados do pedido (conta, consumidor final, observações do pedido) diferentes dos da vigente; versão anterior a essa regra
  // não os registra. Em ambos os casos a vigente não pode ser aceita: nova versão → marcar enviada → aceite.
  const pedidoAlterado = Boolean(vigente?.["order_hash"]) && s(vigente!["order_hash"]) !== hashDoPedido(q);
  const semDadosDoPedido = Boolean(vigente) && !vigente!["order_hash"];
  const excluidas = Number((getDb().prepare("SELECT count(*) n FROM quote_proposals WHERE quote_id=? AND deleted_at IS NOT NULL").get(quoteId) as Linha)["n"]);
  const dono = s(q["owner_id"]);
  return {
    versoes, alterado, pedidoAlterado, semDadosDoPedido, excluidas, vigente: vigente ? Number(vigente["version"]) : null, proxima: maiorVersao(quoteId) + 1,
    aceita: versoes.find((v) => v.aceitaAtual)?.versao ?? null,
    consultor: { ...consultorPublico(dono), eDono: quem ? quem.id === dono : false },
  };
}

function linhaDaVersao(quoteId: string, versao: number) {
  const l = getDb().prepare("SELECT * FROM quote_proposals WHERE quote_id=? AND version=? AND deleted_at IS NULL").get(quoteId, versao) as Linha | undefined;
  if (!l) throw new Error("Proposta não encontrada");
  return l;
}
const retratoDe = (l: Linha) => JSON.parse(s(l["snapshot"])) as SnapshotProposta;
function exigirVigente(quoteId: string, versao: number) {
  const v = versaoVigente(quoteId);
  if (!v || Number(v["version"]) !== versao) throw new Error(`Envio, impressão e compartilhamento usam só a versão vigente${v ? ` (v${v["version"]})` : ""}.`);
}
/**
 * "Enviada ao cliente": só quando o vendedor MARCA (ou o orçamento é marcado enviado/aceito, ou um provedor oficial de
 * e-mail confirma o despacho). Deixa de poder ser excluída.
 */
export function marcarEnviada(quoteId: string, versao: number, usuarioId: string) {
  getDb().prepare(`UPDATE quote_proposals SET sent_at=COALESCE(sent_at, ?), sent_by=COALESCE(sent_by, ?) WHERE quote_id=? AND version=? AND deleted_at IS NULL`)
    .run(new Date().toISOString(), usuarioId, quoteId, versao);
}
/** Abriu WhatsApp/e-mail/compartilhamento: o painel só sabe que o compartilhamento COMEÇOU (não que o cliente recebeu). */
export function iniciarCompartilhamento(quoteId: string, versao: number, canal: "whatsapp" | "email" | "compartilhar", usuarioId: string) {
  assertDiscountApproval(quoteId, versao);
  getDb().prepare(`UPDATE quote_proposals SET share_started_at=COALESCE(share_started_at, ?), share_channel=? WHERE quote_id=? AND version=? AND deleted_at IS NULL`)
    .run(new Date().toISOString(), canal, quoteId, versao);
  audit(usuarioId, "quote:proposta:compartilhamento_iniciado", quoteId, { versao, canal });
}

/** PDF de uma versão gravada (refeito do retrato; `confere` = mesmo arquivo gerado na hora da versão). Excluída: não existe. */
export async function pdfDaProposta(u: SiteUser, quoteId: string, versao: number, dep: DependenciasPdf = {}, opcoes: { somenteVigente?: boolean; distribuir?: boolean } = {}) {
  orcamentoDoUsuario(u, quoteId);
  const l = linhaDaVersao(quoteId, versao);
  if (opcoes.somenteVigente) exigirVigente(quoteId, versao);
  if (opcoes.distribuir || opcoes.somenteVigente) assertDiscountApproval(quoteId, versao);
  const retrato = retratoDe(l);
  const pdf = await renderizarProposta(retrato, dep);
  orcamentoDoUsuario(u, quoteId);
  if (opcoes.distribuir || opcoes.somenteVigente) assertDiscountApproval(quoteId, versao);
  return { bytes: pdf.bytes, paginas: pdf.paginas.length, arquivo: nomeArquivoProposta(retrato.numero, retrato.cliente.empresa, retrato.versao), confere: sha(pdf.bytes) === s(l["pdf_sha256"]) };
}

/** Textos prontos para WhatsApp e e-mail (só da versão vigente). Vão só para a tela de quem pode ver o orçamento. */
export function dadosParaEnvio(u: SiteUser, quoteId: string, versao: number) {
  orcamentoDoUsuario(u, quoteId);
  assertDiscountApproval(quoteId, versao);
  exigirVigente(quoteId, versao);
  const r = retratoDe(linhaDaVersao(quoteId, versao));
  return {
    versao: r.versao, arquivo: nomeArquivoProposta(r.numero, r.cliente.empresa, r.versao),
    whatsapp: { telefone: telefoneWhatsApp(r.cliente.telefone), texto: mensagemWhatsApp(r) },
    email: { para: r.cliente.email, assunto: assuntoEmail(r), mensagem: mensagemEmail(r) },
  };
}

export const ACOES_REGISTRADAS = ["whatsapp", "email"] as const;
/** "Abriu o WhatsApp" / "abriu o e-mail": compartilhamento iniciado (o envio acontece fora do painel; "enviada" é marcada à parte). */
export function registrarAcao(u: SiteUser, quoteId: string, versao: number, acao: (typeof ACOES_REGISTRADAS)[number]) {
  orcamentoDoUsuario(u, quoteId);
  linhaDaVersao(quoteId, versao);
  exigirVigente(quoteId, versao);
  transaction(() => iniciarCompartilhamento(quoteId, versao, acao, u.id));
  return { ok: true };
}

/** "✓ Marcar como enviada ao cliente" (só a vigente): o orçamento "salvo" passa a "enviado ao cliente". */
export function marcarVersaoEnviada(u: SiteUser, quoteId: string, versao: number) {
  return transaction(() => {
    const q = orcamentoDoUsuario(u, quoteId);
    assertDiscountApproval(quoteId, versao);
    const l = linhaDaVersao(quoteId, versao);
    exigirVigente(quoteId, versao);
    if (l["refused_at"]) throw new Error(`A v${versao} foi recusada pelo cliente`);
    if (!["salvo", "enviado"].includes(s(q["status"]))) throw new Error("Só para orçamento salvo ou enviado ao cliente");
    marcarEnviada(quoteId, versao, u.id);
    if (s(q["status"]) === "salvo") {
      getDb().prepare("UPDATE internal_quotes SET status='enviado', version=version+1, updated_at=? WHERE id=?").run(new Date().toISOString(), quoteId);
      audit(u.id, "quote:status:enviado", quoteId, { de: "salvo", via: "proposta", proposta_versao: versao, total_centavos: Number(q["total_cents"]) });
    }
    audit(u.id, "quote:proposta:enviada", quoteId, { versao });
    return { ok: true };
  });
}

/** "Cliente recusou esta versão" (só a vigente, ainda não aceita): fica registrada e congelada; aceite só de outra versão. */
export function marcarVersaoRecusada(u: SiteUser, quoteId: string, versao: number) {
  return transaction(() => {
    const q = orcamentoDoUsuario(u, quoteId);
    const l = linhaDaVersao(quoteId, versao);
    exigirVigente(quoteId, versao);
    if (l["accepted_at"] && s(q["accepted_proposal_id"]) === s(l["id"])) throw new Error(`A v${versao} está aceita: para mudar, use "Criar nova revisão"`);
    if (!editavel(q["status"] as Estado)) throw new Error("Só para orçamento ainda não aceito");
    getDb().prepare("UPDATE quote_proposals SET refused_at=COALESCE(refused_at, ?), refused_by=COALESCE(refused_by, ?) WHERE id=?").run(new Date().toISOString(), u.id, s(l["id"]));
    audit(u.id, "quote:proposta:recusada", quoteId, { versao });
    return { ok: true };
  });
}

// ---------- Gestão das versões ----------
export type AcaoVersoes = "arquivar" | "desarquivar" | "excluir";
/**
 * Arquivar (some do histórico principal; continua para ver e baixar), desarquivar e excluir (soft-delete: só rascunho
 * nunca enviado nem aceito). A vigente e a aceita nunca são arquivadas nem excluídas. Cada versão: feita ou recusada com o motivo.
 */
export function gerenciarVersoes(u: SiteUser, quoteId: string, acao: AcaoVersoes, versoes: number[]) {
  orcamentoDoUsuario(u, quoteId);
  return transaction(() => {
    const feitas: number[] = []; const recusadas: { versao: number; motivo: string }[] = [];
    const agora = new Date().toISOString();
    for (const versao of [...new Set(versoes)].sort((a, b) => a - b)) {
      const l = getDb().prepare("SELECT id, current, sent_at, accepted_at, refused_at, archived_at, deleted_at FROM quote_proposals WHERE quote_id=? AND version=?").get(quoteId, versao) as Linha | undefined;
      const recusar = (motivo: string) => recusadas.push({ versao, motivo });
      if (!l || l["deleted_at"]) { recusar("não encontrada"); continue; }
      if (acao === "excluir") {
        if (l["current"]) recusar("é a versão vigente");
        else if (l["accepted_at"]) recusar("aceita pelo cliente (congelada)");
        else if (l["refused_at"]) recusar("recusada pelo cliente (imutável)");
        else if (l["sent_at"]) recusar("já enviada ao cliente (imutável)");
        else {
          getDb().prepare("UPDATE quote_proposals SET deleted_at=?, deleted_by=? WHERE id=?").run(agora, u.id, s(l["id"]));
          audit(u.id, "quote:proposta:excluida", quoteId, { versao });
          feitas.push(versao);
        }
      } else if (acao === "arquivar") {
        if (l["current"]) recusar("é a versão vigente");
        else if (l["accepted_at"]) recusar("aceita pelo cliente (congelada)");
        else if (l["archived_at"]) recusar("já arquivada");
        else {
          getDb().prepare("UPDATE quote_proposals SET archived_at=?, archived_by=? WHERE id=?").run(agora, u.id, s(l["id"]));
          audit(u.id, "quote:proposta:arquivada", quoteId, { versao });
          feitas.push(versao);
        }
      } else if (!l["archived_at"]) recusar("não está arquivada");
      else {
        getDb().prepare("UPDATE quote_proposals SET archived_at=NULL, archived_by=NULL WHERE id=?").run(s(l["id"]));
        audit(u.id, "quote:proposta:desarquivada", quoteId, { versao });
        feitas.push(versao);
      }
    }
    return { feitas, recusadas };
  });
}

/** Diferenças entre duas versões (a menor número = "antes"). */
export function compararVersoes(u: SiteUser, quoteId: string, versaoA: number, versaoB: number) {
  orcamentoDoUsuario(u, quoteId);
  if (versaoA === versaoB) throw new Error("Escolha duas versões diferentes");
  const [de, para] = versaoA < versaoB ? [versaoA, versaoB] : [versaoB, versaoA];
  const a = linhaDaVersao(quoteId, de); const b = linhaDaVersao(quoteId, para);
  return { de, para, deEm: s(a["created_at"]), paraEm: s(b["created_at"]), ...compararRetratos(retratoDe(a), retratoDe(b)) };
}

// ---------- E-mail pelo servidor (preparado; só com PROPOSTA_EMAIL_ENVIO=ligado e provedor configurado) ----------
export type EnvioEmail = (msg: { para: string[]; assunto: string; texto: string; responderPara: string; anexo: { arquivo: string; bytes: Uint8Array } }) => Promise<{ enviado: boolean }>;
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/** Envia só depois da confirmação na tela (Para, Assunto, Mensagem e o PDF anexado à vista). Nada do conteúdo vai para log. */
export async function enviarPorEmail(u: SiteUser, quoteId: string, versao: number, dados: { para: string; assunto: string; mensagem: string }, enviar: EnvioEmail | null, dep: DependenciasPdf = {}) {
  if (!enviar) return { ok: false as const, motivo: "nao_configurado" };
  const q = orcamentoDoUsuario(u, quoteId);
  exigirVigente(quoteId, versao);
  const para = [...new Set(dados.para.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const erros: string[] = [];
  if (!para.length || para.length > 3 || para.some((e) => !EMAIL.test(e) || e.length > 120)) erros.push("Para: informe de 1 a 3 e-mails válidos");
  if (!dados.assunto.trim() || dados.assunto.length > 200) erros.push("Assunto: obrigatório, até 200 caracteres");
  if (!dados.mensagem.trim() || dados.mensagem.length > 6000) erros.push("Mensagem: obrigatória, até 6.000 caracteres");
  if (erros.length) throw new Error(erros.join("; "));
  if (!consumeRateLimit(`proposta-email:${sha(u.id)}`, 10, 3600)) throw new Error("Muitos e-mails em pouco tempo. Aguarde e tente de novo.");
  const pdf = await pdfDaProposta(u, quoteId, versao, dep, { somenteVigente: true });
  const responderPara = s((getDb().prepare("SELECT email FROM users WHERE id=?").get(s(q["owner_id"])) as Linha | undefined)?.["email"]) || u.email;
  let enviado = false;
  try {
    enviado = (await enviar({ para, assunto: dados.assunto.trim(), texto: dados.mensagem, responderPara, anexo: { arquivo: pdf.arquivo, bytes: pdf.bytes } })).enviado;
  } catch {
    enviado = false;
  }
  if (enviado) marcarEnviada(quoteId, versao, u.id);
  audit(u.id, enviado ? "quote:proposta:email_enviado" : "quote:proposta:email_falhou", quoteId, { versao, destinatarios: para.length });
  return enviado ? { ok: true as const } : { ok: false as const, motivo: "falha" };
}
