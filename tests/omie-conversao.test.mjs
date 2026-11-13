// node --test tests/omie-conversao.test.mjs — orçamento interno → Pedido de Venda no Omie, ponta a ponta sem navegador:
// módulos do painel + serviço omie-pedidos REAL + Omie SIMULADO (com estado). Banco temporário; nenhuma rede externa.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { omieSimulado, VENDEDORES } from "./omie-simulado.mjs";
import { criarServidor } from "../scripts/omie-pedidos.mjs";

const TOKEN = "q".repeat(48);
const dir = await mkdtemp(join(tmpdir(), "mag-conversao-"));
process.env.SITE_DATA_DIR = join(dir, "data");
// Relógio comum ao serviço e ao Omie simulado: `desvio += 66_000` = "o usuário esperou um minuto" (janela do Omie).
let desvio = 0;
const relogio = () => Date.now() + desvio;
const omie = omieSimulado({ relogio, skus: { "8764749209": "00003", "8764751407": "00471" } });
const config = { appKey: "K-SECRETA-123", appSecret: "S-SECRETA-456", nonCommercialLocations: ["avaria", "licitacao", "importacao"], token: TOKEN, escrita: false,
  apiUrl: "https://omie.teste/api/v1/", porta: 0, intervaloMs: 1100, tetoHora: 5000, timeoutMs: 30000, timeoutEscritaMs: 45000, repetirMs: 65000 };
const logs = []; const logOriginal = console.log;
console.log = (...args) => logs.push(args.join(" "));
const servidor = criarServidor(config, { fetchImpl: omie.fetchImpl, sleepImpl: async () => {}, now: relogio });
await new Promise((pronto) => servidor.listen(0, "127.0.0.1", pronto));
process.env.OMIE_PEDIDOS_URL = `http://127.0.0.1:${servidor.address().port}`;
process.env.OMIE_PEDIDOS_TOKEN = TOKEN;

const db = await import("../src/lib/local-db.server.ts");
const auth = await import("../src/lib/local-auth-core.server.ts");
const ref = await import("../src/lib/omie-referencias.server.ts");
const orc = await import("../src/lib/orcamentos.server.ts");
const conv = await import("../src/lib/omie-conversao.server.ts");
const prop = await import("../src/lib/propostas.server.ts");
const { hojeFortaleza } = await import("../src/lib/orcamento-regras.ts");

test.after(async () => {
  console.log = logOriginal;
  servidor.close();
  db.closeDb();
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

const usuario = async (email, roles) => ({ id: (await auth.createUser(email, "Senha-Forte-123", roles)).id, email, roles, created_at: "" });
const admin = await usuario("admin@teste.example", ["admin"]);
const comercial = await usuario("vladson.vendas@teste.example", ["comercial"]);
const outro = await usuario("samantha@teste.example", ["comercial"]);
const PRODUTOS = new Map([
  ["8764749209", { id: "8764749209", sku: "00003", nome: "ARMARIO ALTO FEC 2 P 30MM ALMERIA", unidade: "UN", slug: "armario-alto-00003" }],
  ["8764751407", { id: "8764751407", sku: "00471", nome: "A/E PRISMA MR 800 AMARELO", unidade: "UN", slug: null }],
]);
const amanha = new Date(Date.parse(`${hojeFortaleza()}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
const acoes = (quoteId) => db.getDb().prepare("SELECT action FROM audit_log WHERE target_id=? ORDER BY id").all(quoteId).map((l) => l.action);

/** Orçamento completo e aceito, do usuário `dono`. */
async function orcamentoAceito(dono, cliente = { documento: "11.222.333/0001-81", email: "compras@cliente.com.br" }, emailNf = "nf@cliente.com.br") {
  const { id } = orc.criarOrcamento(dono, [...PRODUTOS.values()]);
  orc.salvarOrcamento(dono, id, {
    versao: 1,
    cliente: { nome: "Cliente Teste Ltda", fantasia: "Teste", documento: cliente.documento, email: cliente.email, telefone: "(85) 3333-4444", cidade: "Fortaleza", uf: "CE" },
    itens: [{ produtoId: "8764749209", quantidade: "2", preco: "1.500,00", descontoTipo: "percentual", desconto: "10" },
      { produtoId: "8764751407", quantidade: "10", preco: "25,50", descontoTipo: "", desconto: "" }],
    condicoes: { formaPagamento: "000", previsao: amanha, consumidorFinal: true, emailNf, observacoes: "Entregar no térreo", notasInternas: "", conta: "8765103276" },
  }, PRODUTOS);
  orc.mudarEstado(dono, id, "salvar", 2);
  // Desde 08/10/2026 o aceite é de uma versão da proposta (a vigente): gera a v1 antes de enviar e aceitar.
  const versaoDe = () => Number(db.getDb().prepare("SELECT version FROM internal_quotes WHERE id=?").get(id).version);
  await prop.gerarProposta(dono, id, { versaoOrcamento: versaoDe(), mostrarSku: true }, () => null, { carregarLogo: async () => null });
  orc.mudarEstado(dono, id, "enviar", versaoDe());
  orc.mudarEstado(dono, id, "aceitar", versaoDe());
  return id;
}

test("referências do Omie, configuração do Admin e vínculo do vendedor só com confirmação", async () => {
  const r = await ref.sincronizarReferencias(admin.id);
  assert.deepEqual({ ok: r.ok, vend: r.vendedores, ativos: r.vendedoresAtivos, etapas: r.etapas, formas: r.formasPagamento, cat: r.categorias, contas: r.contas },
    { ok: true, vend: 3, ativos: 2, etapas: 4, formas: 3, cat: 1, contas: 1 });
  const opcoes = ref.opcoesValidas();
  assert.deepEqual(opcoes.etapas.map((e) => e.codigo), ["10", "20"], "só 10–40 ativas da Venda de Produto (50 = Faturar fica fora)");
  assert.deepEqual(opcoes.formasPagamento.map((f) => f.codigo), ["000", "S01"], "999 (parcelas manuais) fora");
  assert.throws(() => ref.salvarConfiguracao(admin.id, { etapa: "50", formaPagamento: "000", categoria: "1.01.01", conta: "8765103276", consumidorFinal: "S", semEstoque: "confirmar" }), /etapa inválida/);
  ref.salvarConfiguracao(admin.id, { etapa: "10", formaPagamento: "000", categoria: "1.01.01", conta: "8765103276", consumidorFinal: "S", semEstoque: "confirmar" });
  assert.equal("conta" in ref.lerConfiguracao(), false, "não existe conta corrente padrão: a conta é escolhida em cada venda");
  const vinculos = ref.vinculosDoPainel();
  const sugestao = (email) => vinculos.find((v) => v.usuario.email === email).sugestoes.map((s) => `${s.nome} (${s.motivo})`);
  assert.deepEqual(sugestao("vladson.vendas@teste.example"), ["VLADSON (nome parecido)"]);
  assert.deepEqual(sugestao("samantha@teste.example"), ["SAMANTHA ROCHA (nome parecido)"], "a Samantha inativa não é sugerida");
  assert.equal(ref.vendedorDoUsuario(comercial.id), null, "sugestão nunca vira vínculo sozinha");
  assert.throws(() => ref.confirmarVinculo(admin.id, comercial.id, "8766948065"), /inativo/);
  ref.confirmarVinculo(admin.id, comercial.id, "8766947629");
  assert.equal(ref.vendedorDoUsuario(comercial.id).nome, "VLADSON");
  assert.deepEqual(db.getDb().prepare("SELECT action FROM audit_log WHERE action='seller_mapping:changed'").all().length, 1);
});

test("orçamento: estados, trava depois do aceite e dono (outro Comercial não vê; Admin vê)", async () => {
  const id = await orcamentoAceito(comercial);
  const { orcamento, itens } = orc.lerOrcamento(comercial, id);
  assert.match(orcamento.numero, /^MAG-Q-\d{4}-\d{5}$/);
  assert.equal(orcamento.estado, "aceito");
  assert.deepEqual(orcamento.totais, { brutoCentavos: 325500, descontoCentavos: 30000, totalCentavos: 295500 });
  assert.deepEqual(itens.map((i) => [i.sku, i.totalCentavos, i.precoAplicadoCentavos]), [["00003", 270000, 135000], ["00471", 25500, 2550]]);
  assert.ok(acoes(id).includes("quote:accepted"));
  assert.throws(() => orc.salvarOrcamento(comercial, id, { versao: orcamento.versao, cliente: { nome: "X", fantasia: "", documento: "", email: "", telefone: "", cidade: "", uf: "" },
    itens: [], condicoes: { formaPagamento: "", previsao: "", consumidorFinal: true, emailNf: "", observacoes: "", notasInternas: "" } }, PRODUTOS), /não pode ser alterado/);
  assert.throws(() => orc.lerOrcamento(outro, id), /Forbidden/);
  assert.equal(orc.lerOrcamento(admin, id).orcamento.id, id);
  const rascunho = orc.criarOrcamento(comercial, [...PRODUTOS.values()]);
  assert.throws(() => orc.mudarEstado(comercial, rascunho.id, "aceitar", 1), /Não é possível/);
  assert.throws(() => orc.mudarEstado(comercial, rascunho.id, "salvar", 1), /Falta: informe o cliente; inclua pelo menos um item/);
});

test("revisão obrigatória + escrita DESLIGADA: vincula cliente por CNPJ, mostra estoque e só simula", async () => {
  const id = await orcamentoAceito(comercial);
  omie.estado.estoque["8764751407"] = 4; // pede 10, disponível 3 (4 − 1 pendente)
  const primeira = await conv.prepararRevisao(comercial, id);
  assert.equal(primeira.situacao, "pendente");
  assert.match(primeira.bloqueios.join(" "), /Vincule o cliente do Omie/);
  assert.deepEqual(primeira.candidatos.map((c) => [c.codigo, c.documento]), [["5551", "11…81"]], "candidato pelo CNPJ (mascarado)");
  await conv.vincularCliente(comercial, id, "5551");
  const revisao = await conv.prepararRevisao(comercial, id);
  assert.equal(revisao.situacao, "pronto");
  assert.equal(revisao.escrita, false);
  // Conferência explícita: versão aceita × payload final (item a item e total), com o SKU que o Omie informou agora.
  assert.equal(revisao.conferencia.confere, true, revisao.conferencia.divergencias.join(" | "));
  assert.deepEqual([revisao.conferencia.totalAceitoCentavos, revisao.conferencia.totalOmieCentavos, revisao.conferencia.diferencaCentavos], [295500, 295500, 0]);
  assert.deepEqual(revisao.conferencia.itens.map((l) => [l.sku, l.skuOmie, l.omie.produtoId, l.omie.quantidade, l.omie.precoCentavos, l.omie.descontoCentavos, l.omie.totalCentavos, l.diferencas.length]),
    [["00003", "00003", "8764749209", 2, 150000, 30000, 270000, 0], ["00471", "00471", "8764751407", 10, 2550, 0, 25500, 0]]);
  assert.equal(revisao.resumo.observacoesComerciais, false);
  // Integridade da conversão: cliente e vendedor do Pedido = os da versão aceita; tudo confere → "PEDIDO ÍNTEGRO".
  assert.deepEqual(revisao.integridade, { versao: 1, cliente: { nome: "CLIENTE TESTE LTDA", codigo: "5551", confere: true },
    vendedor: { nome: "VLADSON", codigo: "8766947629", confere: true }, conta: { nome: "Bradesco Mag Filial", codigo: "8765103276", confere: true }, integro: true });
  assert.deepEqual(revisao.resumo.conta, { codigo: "8765103276", descricao: "Bradesco Mag Filial", ativa: true, versao: 1 }, "conta selecionada para esta venda (não padrão)");
  assert.deepEqual(revisao.conferencia.itens.map((l) => l.nome), ["ARMARIO ALTO FEC 2 P 30MM ALMERIA", "A/E PRISMA MR 800 AMARELO"]);
  assert.match(revisao.token, /^[0-9a-f]{48}$/);
  assert.equal(revisao.resumo.vendedor.codigo, "8766947629");
  assert.deepEqual(revisao.resumo.itens.map((i) => [i.sku, i.quantidade, i.disponivel, i.falta]), [["00003", 2, 2, false], ["00471", 10, 3, true]]);
  assert.equal(revisao.estoque.falta, true);
  await assert.rejects(conv.gerarPedido(comercial, id, revisao.token, { revisado: true, semEstoque: false }), /confirme que o pedido segue/);
  const nova = await conv.prepararRevisao(comercial, id);
  const sim = await conv.gerarPedido(comercial, id, nova.token, { revisado: true, semEstoque: true });
  assert.deepEqual({ ok: sim.ok, simulado: sim.simulado }, { ok: false, simulado: true });
  assert.equal(sim.payload.cabecalho.codigo_pedido_integracao, orc.lerOrcamento(comercial, id).orcamento.numero);
  assert.equal(sim.payload.informacoes_adicionais.codVend, 8766947629, "codVend = código do ListarVendedores");
  assert.equal(sim.payload.informacoes_adicionais.utilizar_emails, "n•••@c•••.com.br", "e-mail da NF só mascarado na tela");
  assert.ok(!JSON.stringify(nova).includes("nf@cliente.com.br"), "a revisão nunca devolve o e-mail inteiro");
  assert.equal(omie.inclusoes(), 0, "nada incluído no Omie");
  assert.equal(orc.lerOrcamento(comercial, id).orcamento.estado, "aceito");
  assert.equal(db.getDb().prepare("SELECT count(*) n FROM omie_orders").get().n, 0);
  assert.ok(acoes(id).includes("omie_order:simulated"));
  await assert.rejects(conv.gerarPedido(comercial, id, nova.token, { revisado: true, semEstoque: true }), /revisão expirou ou já foi usada/, "token de uso único");
});

test("escrita LIGADA: cria o pedido uma vez; duplo clique e repetição não duplicam; status do Omie", async () => {
  config.escrita = true;
  const id = await orcamentoAceito(comercial);
  await conv.vincularCliente(comercial, id, "5551");
  const revisao = await conv.prepararRevisao(comercial, id);
  const antes = omie.inclusoes();
  const [a, b] = await Promise.allSettled([
    conv.gerarPedido(comercial, id, revisao.token, { revisado: true, semEstoque: true }),
    conv.gerarPedido(comercial, id, revisao.token, { revisado: true, semEstoque: true }),
  ]);
  assert.equal([a, b].filter((x) => x.status === "fulfilled" && x.value.ok).length, 1, "um clique cria");
  assert.equal([a, b].filter((x) => x.status === "rejected").length, 1, "o outro é recusado (revisão já usada)");
  assert.equal(omie.inclusoes() - antes, 1, "uma única inclusão no Omie");
  const { orcamento } = orc.lerOrcamento(comercial, id);
  assert.equal(orcamento.estado, "enviado_omie");
  const envio = db.getDb().prepare("SELECT * FROM omie_orders WHERE quote_id=?").get(id);
  assert.deepEqual({ estado: envio.state, numero: Boolean(envio.omie_order_number), tentativas: envio.attempts }, { estado: "criado", numero: true, tentativas: 1 });
  assert.equal(JSON.parse(envio.verification).confere, true, "lido de volta no Omie: igual ao revisado");
  assert.match(db.getDb().prepare("SELECT details FROM audit_log WHERE target_id=? AND action='omie_order:created'").get(id).details, /"conferido":true/);
  assert.deepEqual(acoes(id).filter((x) => x.startsWith("omie_order")), ["omie_order:create_attempt", "omie_order:created"]);
  const de_novo = await conv.prepararRevisao(comercial, id);
  assert.equal(de_novo.situacao, "ja_enviado");
  const status = await conv.atualizarStatus(comercial, id);
  assert.deepEqual({ etapa: status.envio.status.etapa, descricao: status.envio.status.etapaDescricao, faturado: status.envio.status.faturado }, { etapa: "20", descricao: "Pedidos Varejo", faturado: false });
  assert.throws(() => orc.mudarEstado(comercial, id, "cancelar", orc.lerOrcamento(comercial, id).orcamento.versao), /Não é possível/, "pedido já no Omie não se cancela pelo painel");
  const pedidoNoOmie = omie.pedidos.get(orcamento.numero).payload;
  assert.equal(pedidoNoOmie.cabecalho.etapa, "10");
  assert.equal(omie.chamadas.filter((c) => c.call === "ConsultarPedido" && c.param.codigo_pedido_integracao === orcamento.numero).length, 1,
    "a consulta do site e a do serviço antes de incluir = UMA consulta no Omie (repetir seria recusado)");
  assert.equal(pedidoNoOmie.det[0].produto.valor_desconto, 300, "desconto em valor (10% de 2 × 1.500,00)");
});

test("tempo esgotado DEPOIS de o Omie criar: 'incerto', e a nova revisão acha o pedido — nunca duplica", async () => {
  const id = await orcamentoAceito(comercial);
  await conv.vincularCliente(comercial, id, "5551");
  omie.estado.perderRespostaDaInclusao = true;
  const antes = omie.inclusoes();
  const r = await conv.gerarPedido(comercial, id, (await conv.prepararRevisao(comercial, id)).token, { revisado: true, semEstoque: true });
  assert.equal(r.incerto, true);
  assert.match(r.mensagem, /PODE ter sido criado/);
  assert.equal(orc.lerOrcamento(comercial, id).orcamento.estado, "erro_omie");
  assert.throws(() => orc.mudarEstado(comercial, id, "reabrir", orc.lerOrcamento(comercial, id).orcamento.versao), /Verificar no Omie/, "não reabre com envio incerto");
  const cedo = await conv.prepararRevisao(comercial, id);
  assert.equal(cedo.situacao, "indisponivel", "a mesma consulta em menos de 1 minuto não vai ao Omie");
  assert.match(cedo.mensagem, /só aceita repetir a mesma consulta depois de 1 minuto/);
  desvio += 66_000;
  const revisao = await conv.prepararRevisao(comercial, id);
  assert.equal(revisao.situacao, "ja_enviado", "a revisão consultou o Omie e achou o pedido");
  assert.equal(omie.inclusoes() - antes, 1, "uma única inclusão");
  assert.equal(orc.lerOrcamento(comercial, id).orcamento.estado, "enviado_omie");
  assert.ok(acoes(id).includes("omie_order:failed") && acoes(id).includes("omie_order:created"));
});

test("pedido que já existe no Omie com o mesmo código: o mesmo cliente e itens registra; outro cliente = conflito, nada enviado", async () => {
  const id = await orcamentoAceito(comercial);
  await conv.vincularCliente(comercial, id, "5551");
  const numero = orc.lerOrcamento(comercial, id).orcamento.numero;
  const det = [{ produto: { codigo_produto: 8764749209, quantidade: 2 } }, { produto: { codigo_produto: 8764751407, quantidade: 10 } }];
  omie.pedidos.set(numero, { codigo: 9998, numero: "7776", payload: { cabecalho: { etapa: "10", codigo_cliente: 6000 }, det }, total: 1 });
  const antes = omie.inclusoes();
  const conflito = await conv.gerarPedido(comercial, id, (await conv.prepararRevisao(comercial, id)).token, { revisado: true, semEstoque: true });
  assert.equal(conflito.ok, false);
  assert.match(conflito.mensagem, /NÃO corresponde/);
  assert.equal(orc.lerOrcamento(comercial, id).orcamento.estado, "erro_omie", "não vinculado ao pedido de outro cliente");
  omie.pedidos.set(numero, { codigo: 9999, numero: "7777", payload: { cabecalho: { etapa: "10", codigo_cliente: 5551 }, det }, total: 1 });
  desvio += 66_000;
  const r = await conv.gerarPedido(comercial, id, (await conv.prepararRevisao(comercial, id)).token, { revisado: true, semEstoque: true });
  assert.equal(r.ok && r.jaExistia, true);
  assert.equal(r.envio.numeroPedido, "7777");
  assert.equal(omie.inclusoes(), antes);
});

test("leitura de volta diferente do revisado (ex.: imposto somado ao total): pedido criado e SINALIZADO, sem nova inclusão", async () => {
  ref.confirmarVinculo(admin.id, admin.id, "8788268737"); // outro usuário e outro vendedor ativo (limite de tentativas é por usuário)
  const id = await orcamentoAceito(admin);
  await conv.vincularCliente(admin, id, "5551");
  omie.estado.ipiNoTotal = 45.9;
  const antes = omie.inclusoes();
  const r = await conv.gerarPedido(admin, id, (await conv.prepararRevisao(admin, id)).token, { revisado: true, semEstoque: true });
  omie.estado.ipiNoTotal = 0;
  assert.equal(r.ok, true);
  assert.deepEqual(r.envio.conferencia.divergencias, ["total do pedido"]);
  assert.equal(r.envio.conferencia.lido.valorTotal, 3000.9);
  assert.equal(omie.inclusoes() - antes, 1, "uma inclusão só");
  assert.match(db.getDb().prepare("SELECT details FROM audit_log WHERE target_id=? AND action='omie_order:created'").get(id).details, /"conferido":false,"divergencias":"total do pedido"/);
});

test("o Pedido nasce SÓ da versão aceita: orçamento vivo diferente, previsão aceita vencida ou sem versão aceita = bloqueio", async () => {
  const vendedora = await usuario("vendedora.aceite@teste.example", ["comercial"]);
  ref.confirmarVinculo(admin.id, vendedora.id, "8788268737");
  const id = await orcamentoAceito(vendedora);
  const aceita = db.getDb().prepare("SELECT p.* FROM internal_quotes q JOIN quote_proposals p ON p.id=q.accepted_proposal_id WHERE q.id=?").get(id);
  const retrato = JSON.parse(aceita.snapshot);
  // Alguém mexe no orçamento depois do aceite (preço) → bloqueia: o Pedido nunca sai do orçamento vivo.
  db.getDb().prepare("UPDATE internal_quote_items SET unit_price_cents=unit_price_cents+100 WHERE quote_id=? AND position=1").run(id);
  desvio += 66_000;
  const alterado = await conv.prepararRevisao(vendedora, id);
  assert.equal(alterado.situacao, "pendente");
  assert.ok(alterado.bloqueios.some((b) => b.includes(`diferente da proposta aceita (v${aceita.version})`)), alterado.bloqueios.join(" | "));
  db.getDb().prepare("UPDATE internal_quote_items SET unit_price_cents=unit_price_cents-100 WHERE quote_id=? AND position=1").run(id);
  // Previsão comercial aceita já passou → bloqueia (nova revisão).
  db.getDb().prepare("UPDATE quote_proposals SET snapshot=json_set(snapshot,'$.condicoes.previsao','2026-01-02') WHERE id=?").run(aceita.id);
  desvio += 66_000;
  const vencida = await conv.prepararRevisao(vendedora, id);
  assert.ok(vencida.bloqueios.some((b) => b.includes("previsão comercial aceita (02/01/2026) já passou")), vencida.bloqueios.join(" | "));
  db.getDb().prepare("UPDATE quote_proposals SET snapshot=? WHERE id=?").run(aceita.snapshot, aceita.id);
  // Aceito sem versão aceita registrada (ex.: dado antigo) → bloqueia.
  db.getDb().prepare("UPDATE internal_quotes SET accepted_proposal_id=NULL WHERE id=?").run(id);
  desvio += 66_000;
  const semVersao = await conv.prepararRevisao(vendedora, id);
  assert.ok(semVersao.bloqueios.some((b) => b.includes("não tem a versão aceita da proposta")), semVersao.bloqueios.join(" | "));
  db.getDb().prepare("UPDATE internal_quotes SET accepted_proposal_id=? WHERE id=?").run(aceita.id, id);
  // Previsão congelada depois do aceite.
  assert.throws(() => orc.atualizarPrevisao(vendedora, id, amanha), /congelada/);
  // Revisão pronta: itens, preços, condição e previsão do pedido = os da versão aceita.
  desvio += 66_000;
  const rev = await conv.prepararRevisao(vendedora, id);
  assert.equal(rev.situacao, "pronto", rev.bloqueios?.join(" | "));
  assert.equal(rev.resumo.propostaAceita.versao, aceita.version);
  assert.deepEqual(rev.resumo.itens.map((i) => [i.produtoId, i.quantidade, i.precoCentavos, i.descontoCentavos]),
    retrato.itens.map((i) => [i.produtoId, i.quantidade, i.precoCentavos, i.descontoCentavos]));
  assert.equal(rev.resumo.previsao, retrato.condicoes.previsao);
  assert.equal(rev.resumo.formaPagamento.codigo, retrato.condicoes.pagamentoCodigo);
  const r = await conv.gerarPedido(vendedora, id, rev.token, { revisado: true, semEstoque: true });
  // Com a escrita do simulador ligada ou desligada, o pedido enviado/simulado é o da versão aceita.
  const payload = r.simulado ? r.payload : omie.pedidos.get(orc.lerOrcamento(vendedora, id).orcamento.numero).payload;
  assert.deepEqual(payload.det.map((d) => [String(d.produto.codigo_produto), d.produto.quantidade, Math.round(d.produto.valor_unitario * 100), Math.round(d.produto.valor_desconto * 100)]),
    retrato.itens.map((i) => [i.produtoId, i.quantidade, i.precoCentavos, i.descontoCentavos]));
  assert.equal(payload.cabecalho.codigo_parcela, retrato.condicoes.pagamentoCodigo);
  assert.equal(payload.cabecalho.data_previsao, retrato.condicoes.previsao.split("-").reverse().join("/"));
  assert.equal(payload.informacoes_adicionais.codVend, 8788268737, "vendedor do dono da versão aceita");
  const auditoria = db.getDb().prepare("SELECT details FROM audit_log WHERE target_id=? AND action IN ('omie_order:simulated','omie_order:created') ORDER BY id DESC").get(id).details;
  assert.match(auditoria, new RegExp(`"proposta_versao":${aceita.version}`));
});

test("conferência proposta aceita × Pedido Omie: SKU trocado no Omie bloqueia a revisão; retrato adulterado depois da revisão bloqueia a criação", async () => {
  // Usuário próprio: os limites de revisão/criação por usuário (30 e 10 em 10 min) não se misturam com os dos outros testes.
  const conferente = await usuario("conferencia@teste.example", ["comercial"]);
  ref.confirmarVinculo(admin.id, conferente.id, "8766947629");
  const inclusoesAntes = omie.inclusoes();
  const id = await orcamentoAceito(conferente);
  await conv.vincularCliente(conferente, id, "5551");
  omie.estado.skus["8764751407"] = "00471-B"; // o Omie passou a informar outro SKU para o mesmo código de produto
  desvio += 66_000;
  const trocado = await conv.prepararRevisao(conferente, id);
  assert.equal(trocado.situacao, "pendente");
  assert.equal(trocado.token, null);
  assert.deepEqual([trocado.integridade.cliente.confere, trocado.integridade.vendedor.confere, trocado.integridade.integro], [true, true, false], "SKU diferente = não íntegro");
  assert.match(trocado.bloqueios.join(" | "), /não confere com a proposta aceita \(v1\) — 1 diferença, nada será enviado: item 2 \(SKU 00471\): SKU — aceito 00471, Omie 00471-B/);
  omie.estado.skus["8764751407"] = "00471";
  desvio += 66_000;
  const ok = await conv.prepararRevisao(conferente, id);
  assert.equal(ok.situacao, "pronto", ok.bloqueios.join(" | "));
  // Alguém adultera o total do retrato aceito no banco depois da revisão: a criação confere de novo e não envia nada.
  const aceita = db.getDb().prepare("SELECT accepted_proposal_id AS p FROM internal_quotes WHERE id=?").get(id).p;
  const original = db.getDb().prepare("SELECT snapshot FROM quote_proposals WHERE id=?").get(aceita).snapshot;
  db.getDb().prepare("UPDATE quote_proposals SET snapshot=json_set(snapshot,'$.totais.totalCentavos',json_extract(snapshot,'$.totais.totalCentavos')-100) WHERE id=?").run(aceita);
  await assert.rejects(conv.gerarPedido(conferente, id, ok.token, { revisado: true, semEstoque: true }),
    /O Pedido não confere com a proposta aceita \(v1\): total: aceito R\$\s2\.954,00, Omie R\$\s2\.955,00 \(diferença R\$\s1,00\)\. Nada foi enviado\./);
  db.getDb().prepare("UPDATE quote_proposals SET snapshot=? WHERE id=?").run(original, aceita);
  assert.equal(omie.inclusoes(), inclusoesAntes, "nada incluído no Omie");
  assert.equal(db.getDb().prepare("SELECT count(*) n FROM omie_orders WHERE quote_id=?").get(id).n, 0);
  assert.equal(acoes(id).filter((a) => a.startsWith("omie_order:")).length, 0, "nada simulado nem tentado");
});

test("conta corrente POR VENDA: sem padrão; obrigatória no aceite; congelada na versão aceita; o Pedido usa só a da versão aceita", async () => {
  const contaUsuario = await usuario("conta.venda@teste.example", ["comercial"]);
  ref.confirmarVinculo(admin.id, contaUsuario.id, "8766947629");
  const { id } = orc.criarOrcamento(contaUsuario, [...PRODUTOS.values()]);
  const base = {
    cliente: { nome: "Cliente Teste Ltda", fantasia: "Teste", documento: "11.222.333/0001-81", email: "compras@cliente.com.br", telefone: "(85) 3333-4444", cidade: "Fortaleza", uf: "CE" },
    itens: [{ produtoId: "8764751407", quantidade: "1", preco: "25,50", descontoTipo: "", desconto: "" }],
    condicoes: { formaPagamento: "000", previsao: amanha, consumidorFinal: false, emailNf: "nf@cliente.com.br", observacoes: "", notasInternas: "" },
  };
  const versaoDe = () => Number(db.getDb().prepare("SELECT version FROM internal_quotes WHERE id=?").get(id).version);
  assert.throws(() => orc.salvarOrcamento(contaUsuario, id, { versao: versaoDe(), ...base, condicoes: { ...base.condicoes, conta: "999" } }, PRODUTOS), /conta corrente não existe/);
  orc.salvarOrcamento(contaUsuario, id, { versao: versaoDe(), ...base }, PRODUTOS);
  assert.equal(orc.lerOrcamento(contaUsuario, id).orcamento.condicoes.conta, "", "orçamento novo começa SEM conta (não há padrão)");
  orc.mudarEstado(contaUsuario, id, "salvar", versaoDe());
  await prop.gerarProposta(contaUsuario, id, { versaoOrcamento: versaoDe(), mostrarSku: true }, () => null, { carregarLogo: async () => null });
  assert.throws(() => orc.mudarEstado(contaUsuario, id, "aceitar", versaoDe()), /escolha a conta corrente da venda/, "aceite exige a conta escolhida");
  // A conta faz parte da versão: escolhida DEPOIS da v1 → a v1 não pode ser aceita; nova versão → marcar enviada → aceite.
  orc.salvarOrcamento(contaUsuario, id, { versao: versaoDe(), ...base, condicoes: { ...base.condicoes, conta: "8765103276" } }, PRODUTOS);
  const lido = orc.lerOrcamento(contaUsuario, id).orcamento;
  assert.deepEqual([lido.condicoes.conta, lido.condicoes.contaDescricao, lido.contaAceita], ["8765103276", "Bradesco Mag Filial", null]);
  assert.throws(() => orc.mudarEstado(contaUsuario, id, "aceitar", versaoDe()), /A conta corrente, o consumidor final ou as observações do pedido mudaram depois da v1/);
  await prop.gerarProposta(contaUsuario, id, { versaoOrcamento: versaoDe(), mostrarSku: true }, () => null, { carregarLogo: async () => null });
  assert.throws(() => orc.mudarEstado(contaUsuario, id, "aceitar", versaoDe()), /Marque a v2 como enviada ao cliente antes do aceite/);
  prop.marcarVersaoEnviada(contaUsuario, id, 2);
  orc.mudarEstado(contaUsuario, id, "aceitar", versaoDe());
  const versao = db.getDb().prepare("SELECT p.version, p.accepted_account_id, p.accepted_account_label FROM internal_quotes q JOIN quote_proposals p ON p.id=q.accepted_proposal_id WHERE q.id=?").get(id);
  assert.deepEqual([versao.version, versao.accepted_account_id, versao.accepted_account_label], [2, "8765103276", "Bradesco Mag Filial"], "conta congelada na versão aceita");
  assert.deepEqual(orc.lerOrcamento(contaUsuario, id).orcamento.contaAceita, { codigo: "8765103276", descricao: "Bradesco Mag Filial", versao: 2 });
  assert.match(db.getDb().prepare("SELECT details FROM audit_log WHERE target_id=? AND action='quote:accepted'").get(id).details, /"conta_corrente":"8765103276"/);
  assert.throws(() => orc.salvarOrcamento(contaUsuario, id, { versao: versaoDe(), ...base, condicoes: { ...base.condicoes, conta: "" } }, PRODUTOS), /não pode ser alterado/, "trocar depois do aceite = nova revisão");
  // Alguém mexe nos dados do pedido do orçamento vivo direto no banco (conta, consumidor final): a revisão BLOQUEIA.
  await conv.vincularCliente(contaUsuario, id, "5551");
  for (const [mexe, desfaz] of [["UPDATE internal_quotes SET selected_account_id='1234567890' WHERE id=?", "UPDATE internal_quotes SET selected_account_id='8765103276' WHERE id=?"],
    ["UPDATE internal_quotes SET final_consumer=1 WHERE id=?", "UPDATE internal_quotes SET final_consumer=0 WHERE id=?"]]) {
    db.getDb().prepare(mexe).run(id);
    desvio += 66_000;
    assert.match((await conv.prepararRevisao(contaUsuario, id)).bloqueios.join(" | "), /Conta corrente, consumidor final ou observações do pedido estão diferentes da versão aceita \(v2\)/, mexe);
    db.getDb().prepare(desfaz).run(id);
  }
  desvio += 66_000;
  const rev = await conv.prepararRevisao(contaUsuario, id);
  assert.equal(rev.situacao, "pronto", rev.bloqueios.join(" | "));
  assert.deepEqual(rev.integridade.conta, { nome: "Bradesco Mag Filial", codigo: "8765103276", confere: true });
  // Conta inativa no Omie depois do aceite → bloqueia (nova revisão); aceite antigo sem conta registrada → bloqueia.
  db.getDb().prepare("UPDATE omie_refs SET inactive=1 WHERE kind='conta' AND code='8765103276'").run();
  desvio += 66_000;
  const inativa = await conv.prepararRevisao(contaUsuario, id);
  assert.match(inativa.bloqueios.join(" | "), /conta corrente escolhida para esta venda \(Bradesco Mag Filial\) não existe mais ou está inativa/);
  assert.equal(inativa.integridade.conta.confere, false);
  db.getDb().prepare("UPDATE omie_refs SET inactive=0 WHERE kind='conta' AND code='8765103276'").run();
  const aceitaId = db.getDb().prepare("SELECT accepted_proposal_id AS p FROM internal_quotes WHERE id=?").get(id).p;
  db.getDb().prepare("UPDATE quote_proposals SET accepted_account_id=NULL, accepted_account_label=NULL WHERE id=?").run(aceitaId);
  desvio += 66_000;
  const semConta = await conv.prepararRevisao(contaUsuario, id);
  assert.match(semConta.bloqueios.join(" | "), /não registrou a conta corrente da venda/);
  db.getDb().prepare("UPDATE quote_proposals SET accepted_account_id='8765103276', accepted_account_label='Bradesco Mag Filial' WHERE id=?").run(aceitaId);
  // Versão aceita anterior ao registro dos dados do pedido (sem order_hash) → bloqueia (nova revisão).
  const ordem = db.getDb().prepare("SELECT order_hash FROM quote_proposals WHERE id=?").get(aceitaId).order_hash;
  db.getDb().prepare("UPDATE quote_proposals SET order_hash=NULL WHERE id=?").run(aceitaId);
  desvio += 66_000;
  assert.match((await conv.prepararRevisao(contaUsuario, id)).bloqueios.join(" | "), /anterior ao registro dos dados do pedido/);
  db.getDb().prepare("UPDATE quote_proposals SET order_hash=? WHERE id=?").run(ordem, aceitaId);
  // Pedido (simulado ou criado no simulador): a conta é a da versão aceita, nunca a do orçamento vivo nem um padrão.
  desvio += 66_000;
  const pronta = await conv.prepararRevisao(contaUsuario, id);
  assert.equal(pronta.situacao, "pronto", pronta.bloqueios.join(" | "));
  const r = await conv.gerarPedido(contaUsuario, id, pronta.token, { revisado: true, semEstoque: true });
  const payload = r.simulado ? r.payload : omie.pedidos.get(orc.lerOrcamento(contaUsuario, id).orcamento.numero).payload;
  assert.equal(payload.informacoes_adicionais.codigo_conta_corrente, 8765103276);
  assert.equal(payload.informacoes_adicionais.consumidor_final, "N", "consumidor final do retrato aceito");
  assert.match(db.getDb().prepare("SELECT details FROM audit_log WHERE target_id=? AND action IN ('omie_order:simulated','omie_order:created') ORDER BY id DESC").get(id).details, /"conta_corrente":"8765103276"/);
});

test("Admin executa o orçamento de um Comercial: codVend do DONO; auditoria separa quem criou o orçamento, quem criou o pedido e o vendedor", async () => {
  const id = await orcamentoAceito(comercial); // dono: Comercial (vendedor VLADSON); o Admin tem outro vínculo (SAMANTHA ROCHA)
  await conv.vincularCliente(admin, id, "5551");
  const revisao = await conv.prepararRevisao(admin, id);
  assert.deepEqual({ dono: revisao.resumo.responsavel, executor: revisao.resumo.executor, vendedor: revisao.resumo.vendedor.codigo },
    { dono: comercial.email, executor: admin.email, vendedor: "8766947629" }, "o vendedor é o do dono, nunca o de quem executa");
  const r = await conv.gerarPedido(admin, id, revisao.token, { revisado: true, semEstoque: true });
  assert.equal(r.ok, true);
  assert.equal(omie.pedidos.get(orc.lerOrcamento(admin, id).orcamento.numero).payload.informacoes_adicionais.codVend, 8766947629);
  for (const acao of ["omie_order:create_attempt", "omie_order:created"]) {
    const det = JSON.parse(db.getDb().prepare("SELECT details FROM audit_log WHERE target_id=? AND action=?").get(id, acao).details);
    assert.deepEqual({ q: det.quote_created_by, o: det.omie_order_created_by, s: det.omie_seller, n: det.omie_seller_nome },
      { q: comercial.id, o: admin.id, s: "8766947629", n: "VLADSON" }, acao);
  }
  assert.equal(r.envio.enviadoPorEmail, admin.email);
});

test("erro do Omie: orçamento intacto em erro_omie, mensagem sem dado pessoal, nova tentativa segura", async () => {
  const id = await orcamentoAceito(comercial);
  await conv.vincularCliente(comercial, id, "5551");
  omie.estado.falhaInclusao = "ERROR: Cliente 11.222.333/0001-81 sem endereço cadastrado (nf@cliente.com.br)";
  const r = await conv.gerarPedido(comercial, id, (await conv.prepararRevisao(comercial, id)).token, { revisado: true, semEstoque: true });
  assert.equal(r.ok, false);
  assert.match(r.mensagem, /recusou/);
  assert.ok(!/11\.222|nf@cliente/.test(r.mensagem), r.mensagem);
  const lido = orc.lerOrcamento(comercial, id);
  assert.equal(lido.orcamento.estado, "erro_omie");
  assert.equal(lido.itens.length, 2, "orçamento intacto");
  omie.estado.falhaInclusao = null;
  desvio += 66_000;
  const ok = await conv.gerarPedido(comercial, id, (await conv.prepararRevisao(comercial, id)).token, { revisado: true, semEstoque: true });
  assert.equal(ok.ok, true);
  assert.equal(db.getDb().prepare("SELECT attempts FROM omie_orders WHERE quote_id=?").get(id).attempts, 2);
});

test("vendedor sem vínculo, inativo ou removido; Omie fora do ar: bloqueia com mensagem clara, sem enviar", async () => {
  const semVinculo = await orcamentoAceito(outro);
  const r1 = await conv.prepararRevisao(outro, semVinculo);
  assert.ok(r1.bloqueios.includes("Seu usuário ainda não está vinculado a um vendedor do Omie. Solicite ao Admin."));
  assert.equal(r1.token, null);
  const r2 = await conv.prepararRevisao(admin, semVinculo);
  assert.match(r2.bloqueios.join(" "), /responsável por este orçamento ainda não está vinculado/);
  const id = await orcamentoAceito(comercial);
  omie.estado.vendedores = VENDEDORES.map((v) => (v.codigo === 8766947629 ? { ...v, inativo: "S" } : v));
  desvio += 66_000; // a lista guardada no serviço vale 65 s
  assert.match((await conv.prepararRevisao(comercial, id)).bloqueios.join(" "), /inativo no Omie/);
  omie.estado.vendedores = VENDEDORES.filter((v) => v.codigo !== 8766947629);
  desvio += 66_000;
  assert.match((await conv.prepararRevisao(comercial, id)).bloqueios.join(" "), /não existe mais no Omie/);
  omie.estado.vendedores = VENDEDORES;
  omie.estado.fora = true;
  desvio += 66_000;
  const fora = await conv.prepararRevisao(comercial, id);
  assert.equal(fora.situacao, "pendente");
  assert.equal(fora.token, null);
  omie.estado.fora = false;
  desvio += 66_000;
});

test("cliente inexistente: criação controlada (simulada com escrita desligada), sem duplicar", async () => {
  const id = await orcamentoAceito(comercial, { documento: "529.982.247-25", email: "pessoa@exemplo.com.br" });
  const revisao = await conv.prepararRevisao(comercial, id);
  assert.deepEqual(revisao.candidatos, [], "ninguém com esse CPF no Omie");
  config.escrita = false;
  const sim = await conv.criarClienteOmie(comercial, id);
  assert.equal(sim.simulado, true);
  config.escrita = true;
  const criado = await conv.criarClienteOmie(comercial, id);
  assert.equal(criado.ok, true);
  await assert.rejects(conv.criarClienteOmie(comercial, id), /já tem cliente do Omie vinculado/);
  const outroOrcamento = await orcamentoAceito(comercial, { documento: "529.982.247-25", email: "pessoa@exemplo.com.br" });
  assert.equal(orc.lerOrcamento(comercial, outroOrcamento).orcamento.clienteOmie, criado.codigoCliente, "o vínculo vale para pedidos futuros do mesmo CPF");
  assert.equal(omie.metodos().filter((m) => m === "IncluirCliente").length, 1);
});

test("e-mail da NF obrigatório: sem ele a revisão bloqueia; 'usar o do cadastro do cliente' grava sem mostrar inteiro", async () => {
  const id = await orcamentoAceito(comercial, undefined, "");
  await conv.vincularCliente(comercial, id, "5551");
  const antes = await conv.prepararRevisao(comercial, id);
  assert.equal(antes.situacao, "pendente");
  assert.match(antes.bloqueios.join(" "), /e-mail para a nota fiscal/);
  assert.equal(antes.resumo.emailCadastro, "s•••@c•••.com", "e-mail do cadastro do Omie só mascarado");
  assert.ok(!JSON.stringify(antes).includes("segredo@cliente.com"));
  const r = await conv.usarEmailDoCadastro(comercial, id);
  assert.deepEqual(r, { ok: true, emailNf: "s•••@c•••.com" });
  assert.equal(db.getDb().prepare("SELECT nf_email FROM internal_quotes WHERE id=?").get(id).nf_email, "segredo@cliente.com", "o completo fica no orçamento (vai ao Omie)");
  const depois = await conv.prepararRevisao(comercial, id);
  assert.equal(depois.situacao, "pronto");
  assert.equal(depois.resumo.emailNf, "s•••@c•••.com");
  const det = db.getDb().prepare("SELECT details FROM audit_log WHERE target_id=? AND action='quote:nf_email'").get(id).details;
  assert.ok(det.includes('"origem":"cadastro_omie"') && !det.includes("@"), det);
});

test("estoque repetido: compara a soma por produto com o saldo, preservando as linhas da proposta", async () => {
  const { id } = orc.criarOrcamento(comercial, [...PRODUTOS.values()]);
  orc.salvarOrcamento(comercial, id, {
    versao: 1, cliente: {nome:"Cliente Teste Ltda",fantasia:"",documento:"11.222.333/0001-81",email:"compras@cliente.com.br",telefone:"8533334444",cidade:"Fortaleza",uf:"CE"},
    itens: [{produtoId:"8764749209",quantidade:"4",preco:"1,01",descontoTipo:"",desconto:""},{produtoId:"8764749209",quantidade:"2",preco:"1,01",descontoTipo:"",desconto:""}],
    condicoes:{formaPagamento:"000",previsao:amanha,consumidorFinal:true,emailNf:"nf@cliente.com.br",observacoes:"",notasInternas:"",conta:"8765103276"},
  },PRODUTOS);
  const version=() => Number(db.getDb().prepare('SELECT version FROM internal_quotes WHERE id=?').get(id).version);
  await prop.gerarProposta(comercial,id,{versaoOrcamento:version(),mostrarSku:true},() => null,{carregarLogo:async() => null});
  orc.mudarEstado(comercial,id,"enviar",version()); orc.mudarEstado(comercial,id,"aceitar",version());
  await conv.vincularCliente(comercial,id,"5551");
  omie.estado.estoque["8764749209"]=6; // 6 físico − 1 pendente = 5; linhas 4 e 2 somam 6.
  desvio+=66_000;
  const review=await conv.prepararRevisao(comercial,id);
  assert.equal(review.estoque.falta,true);
  assert.equal(review.resumo.itens.length,2,"mantém as linhas e preços originais, agregando só a comparação de saldo");
  assert.ok(review.resumo.itens.every((line) => line.falta));
  const cfg=ref.lerConfiguracao();
  ref.salvarConfiguracao(admin.id,{...cfg,semEstoque:"bloquear"});
  const blocked=await conv.prepararRevisao(comercial,id);
  assert.equal(blocked.token,null);
  assert.match(blocked.bloqueios.join(' '),/Estoque insuficiente/);
  ref.salvarConfiguracao(admin.id,{...cfg,semEstoque:"confirmar"});
  const fraction=orc.criarOrcamento(comercial,[...PRODUTOS.values()]);
  orc.salvarOrcamento(comercial,fraction.id,{
    versao:1,cliente:{nome:"Cliente Teste Ltda",fantasia:"",documento:"11.222.333/0001-81",email:"compras@cliente.com.br",telefone:"8533334444",cidade:"Fortaleza",uf:"CE"},
    itens:[{produtoId:"8764749209",quantidade:"1,1",preco:"100,00",descontoTipo:"",desconto:""},{produtoId:"8764749209",quantidade:"2,2",preco:"100,00",descontoTipo:"",desconto:""}],
    condicoes:{formaPagamento:"000",previsao:amanha,consumidorFinal:true,emailNf:"nf@cliente.com.br",observacoes:"",notasInternas:"",conta:"8765103276"},
  },PRODUTOS);
  const fv=() => Number(db.getDb().prepare('SELECT version FROM internal_quotes WHERE id=?').get(fraction.id).version);
  await prop.gerarProposta(comercial,fraction.id,{versaoOrcamento:fv(),mostrarSku:true},() => null,{carregarLogo:async() => null});
  orc.mudarEstado(comercial,fraction.id,"enviar",fv()); orc.mudarEstado(comercial,fraction.id,"aceitar",fv());
  await conv.vincularCliente(comercial,fraction.id,"5551");
  omie.estado.estoque["8764749209"]=4.3; desvio+=66_000;
  const fractionalReview=await conv.prepararRevisao(comercial,fraction.id);
  assert.equal(fractionalReview.estoque.falta,false,"1,1 + 2,2 cabe no saldo 3,3; arredondamento binário não vira falta de estoque");
});

test("logs do serviço: sem chave, documento, e-mail ou payload; nenhuma consulta repetida dentro da janela do Omie", () => {
  assert.equal(omie.redundantes(), 0, "o Omie nunca recusou uma consulta por repetição");
  const tudo = logs.join("\n");
  for (const proibido of ["K-SECRETA-123", "S-SECRETA-456", "11.222.333", "11222333000181", "compras@cliente", "nf@cliente", "segredo@cliente", "Entregar no térreo", "MAG-Q-"]) {
    assert.ok(!tudo.includes(proibido), `log com ${proibido}`);
  }
  const auditoria = db.getDb().prepare("SELECT details FROM audit_log WHERE details IS NOT NULL").all().map((l) => l.details).join("\n");
  for (const proibido of ["11222333000181", "compras@cliente", "Cliente Teste", "Entregar"]) assert.ok(!auditoria.includes(proibido), `auditoria com ${proibido}`);
});
