// node --test tests/proposta.test.mjs — proposta comercial do orçamento interno: regras puras, versões (retrato), aviso de
// orçamento alterado, permissões, PDF (A4, várias páginas, com e sem foto, sem dados internos), WhatsApp/e-mail e a trava
// do Pedido no Omie para frete/montagem/desconto geral. Banco temporário; nenhuma rede externa; nada chama o Omie.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = await mkdtemp(join(tmpdir(), "mag-proposta-"));
process.env.SITE_DATA_DIR = join(dir, "data");
delete process.env.OMIE_PEDIDOS_URL;
const logs = []; const logOriginal = console.log; const avisoOriginal = console.warn; const erroOriginal = console.error;
console.log = (...a) => logs.push(a.join(" ")); console.warn = (...a) => logs.push(a.join(" ")); console.error = (...a) => logs.push(a.join(" "));

const db = await import("../src/lib/local-db.server.ts");
const auth = await import("../src/lib/local-auth-core.server.ts");
const orc = await import("../src/lib/orcamentos.server.ts");
const prop = await import("../src/lib/propostas.server.ts");
const regras = await import("../src/lib/proposta-regras.ts");
const { renderizarProposta } = await import("../src/lib/proposta-pdf.server.ts");
const { hojeFortaleza } = await import("../src/lib/orcamento-regras.ts");
const LOGO = await readFile(new URL("../public/images/mag-logo.png", import.meta.url));

// Os testes geram muitas versões com o mesmo usuário: o limite de gerações por usuário (30/10 min) é zerado entre eles.
test.beforeEach(() => { db.getDb().prepare("DELETE FROM rate_limits").run(); });

test.after(async () => {
  console.log = logOriginal; console.warn = avisoOriginal; console.error = erroOriginal;
  db.closeDb();
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

const usuario = async (email, roles) => ({ id: (await auth.createUser(email, "Senha-Forte-123", roles)).id, email, roles, created_at: "" });
const admin = await usuario("marketing@teste.example", ["admin"]);
const mateus = await usuario("mateus@teste.example", ["comercial"]);
const outro = await usuario("samantha@teste.example", ["comercial"]);
// Vendedor do Omie vinculado ao Mateus (nome do consultor na proposta vem daqui quando ele não escolheu outro).
db.getDb().prepare("INSERT INTO omie_sellers(omie_seller_id,name,email,inactive,last_synced_at) VALUES ('8830124193','MATEUS OLIVEIRA',NULL,0,?)").run(new Date().toISOString());
db.getDb().prepare("INSERT INTO seller_links(user_id,omie_seller_id,confirmed_by,confirmed_at) VALUES (?,?,?,?)").run(mateus.id, "8830124193", admin.id, new Date().toISOString());
// Contas correntes do Omie (a conta é escolhida em cada venda e fica congelada no aceite).
for (const [codigo, nome] of [["8765103276", "Bradesco Mag Filial"], ["8765116216", "Stone Mag Filial"]]) {
  db.getDb().prepare("INSERT INTO omie_refs(kind,code,label,extra,inactive,synced_at) VALUES ('conta',?,?,'{}',0,?)").run(codigo, nome, new Date().toISOString());
}
db.getDb().prepare("INSERT INTO omie_refs(kind,code,label,extra,inactive,synced_at) VALUES ('forma_pagamento','000','A Vista','{}',0,?)").run(new Date().toISOString());

const PRODUTOS = [
  { id: "8764749588", sku: "00125", nome: "CADEIRA DIRETOR PORTO PRETA", unidade: "UN", slug: "cadeira-diretor-porto-preta" },
  { id: "8764749209", sku: "00003", nome: "ARMARIO ALTO FEC 2 P 30MM ALMERIA", unidade: "UN", slug: "armario-alto-00003" },
];
const FOTO = `/catalog-images/${"a".repeat(64)}-p.webp`;
// Catálogo: a cadeira está em pronta entrega com 3 disponíveis e foto; o armário não (e sem foto).
const catalogo = (id) => (id === "8764749588" ? { prontaEntrega: true, disponivel: 3, foto: FOTO } : id === "8764749209" ? { prontaEntrega: false, disponivel: 0, foto: null } : null);
const dep = { carregarFoto: async () => LOGO };
const amanha = new Date(Date.parse(`${hojeFortaleza()}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
const daqui = (dias) => new Date(Date.parse(`${hojeFortaleza()}T12:00:00Z`) + dias * 86400000).toISOString().slice(0, 10);
const acoes = (id) => db.getDb().prepare("SELECT action, details FROM audit_log WHERE target_id=? ORDER BY id").all(id);

function dados(versao, extra = {}) {
  return {
    versao,
    cliente: { nome: "CAJUINA SAO GERALDO LTDA", fantasia: "Cajuína São Geraldo", documento: "06.942.221/0001-65", email: "compras@cajuina.example", telefone: "(88) 99999-1234", cidade: "Juazeiro do Norte", uf: "CE" },
    itens: [{ produtoId: "8764749588", quantidade: "1", preco: "659,00", descontoTipo: "", desconto: "" },
      { produtoId: "8764749209", quantidade: "2", preco: "1.500,00", descontoTipo: "percentual", desconto: "10" }],
    condicoes: { formaPagamento: "", previsao: amanha, consumidorFinal: false, emailNf: "", observacoes: "NÃO FATURAR — teste interno", notasInternas: "margem apertada, custo alto", conta: "8765103276" },
    proposta: { contato: "Maria Compras", validade: "", descontoGeral: "", frete: "", montagem: "", observacoes: "Entrega no térreo, em horário comercial." },
    ...extra,
  };
}
const novoOrcamento = (dono = mateus, extra = {}) => {
  const { id } = orc.criarOrcamento(dono, PRODUTOS);
  orc.salvarOrcamento(dono, id, dados(1, extra), new Map(PRODUTOS.map((p) => [p.id, p])));
  return id;
};
const versaoDe = (id) => Number(db.getDb().prepare("SELECT version FROM internal_quotes WHERE id=?").get(id).version);
const retrato = (id, v) => JSON.parse(db.getDb().prepare("SELECT snapshot FROM quote_proposals WHERE quote_id=? AND version=?").get(id, v).snapshot);

// ---------- Regras puras ----------
test("nome do arquivo: número + cliente sem acento e sem sufixo; nunca CPF/CNPJ; vN a partir da v2", () => {
  assert.equal(regras.nomeArquivoProposta("MAG-Q-2026-00001", "CAJUINA SAO GERALDO LTDA", 1), "MAG-Orcamento-MAG-Q-2026-00001-Cajuina-Sao-Geraldo.pdf");
  assert.equal(regras.nomeArquivoProposta("MAG-Q-2026-00001", "Cajuína São Geraldo Ltda.", 2), "MAG-Orcamento-MAG-Q-2026-00001-Cajuina-Sao-Geraldo-v2.pdf");
  assert.equal(regras.nomeArquivoProposta("MAG-Q-2026-00002", "12.345.678 JOAO DA SILVA", 1), "MAG-Orcamento-MAG-Q-2026-00002-Joao-Da-Silva.pdf", "raiz do CNPJ do MEI sai");
  assert.equal(regras.nomeArquivoProposta("MAG-Q-2026-00003", "06.942.221/0001-65", 1), "MAG-Orcamento-MAG-Q-2026-00003.pdf");
  assert.equal(regras.nomeArquivoProposta("MAG-Q-2026-00004", "", 1), "MAG-Orcamento-MAG-Q-2026-00004.pdf");
  assert.match(regras.nomeArquivoProposta("MAG-Q-2026-00005", "A\"B/C\\D<E>F;G", 3), /^MAG-Orcamento-MAG-Q-2026-00005-[A-Za-z0-9-]+-v3\.pdf$/);
});

test("totais: itens − desconto geral + frete + montagem; desconto geral nunca passa do subtotal", () => {
  const itens = [{ brutoCentavos: 10000, descontoCentavos: 1000, totalCentavos: 9000 }, { brutoCentavos: 5000, descontoCentavos: 0, totalCentavos: 5000 }];
  assert.deepEqual(regras.totaisDaProposta(itens, { descontoGeralCentavos: 500, freteCentavos: 1800, montagemCentavos: 3500 }),
    { brutoCentavos: 15000, descontoItensCentavos: 1000, subtotalCentavos: 14000, descontoGeralCentavos: 500, freteCentavos: 1800, montagemCentavos: 3500, totalCentavos: 18800 });
  assert.equal(regras.totaisDaProposta(itens, { descontoGeralCentavos: 99999, freteCentavos: 0, montagemCentavos: 0 }).totalCentavos, 0);
  assert.deepEqual(regras.validarExtras({ descontoGeralCentavos: 15000, freteCentavos: -1, montagemCentavos: null }, 14000),
    ["frete inválido", "montagem inválido", "o desconto geral não pode passar do subtotal dos itens"]);
});

test("telefones, nome do consultor e rótulo do desconto", () => {
  assert.equal(regras.telefoneWhatsApp("(88) 99999-1234"), "5588999991234");
  assert.equal(regras.telefoneWhatsApp("123"), null);
  assert.equal(regras.telefoneBR("5585998610074"), "(85) 99861-0074");
  assert.equal(regras.telefoneBR("8531220506"), "(85) 3122-0506");
  assert.equal(regras.nomeDeExibicao("", "MATEUS OLIVEIRA", "mateus@x.com"), "Mateus Oliveira");
  assert.equal(regras.nomeDeExibicao(null, "CAIO - VAR", "caio@x.com"), "Caio", "sufixo interno do Omie sai");
  assert.equal(regras.nomeDeExibicao(null, "MARIA DA SILVA", "m@x.com"), "Maria da Silva");
  assert.equal(regras.nomeDeExibicao("", null, "joao.pedro2@x.com"), "Joao Pedro");
  assert.equal(regras.nomeDeExibicao("  Ana   Paula ", "ANA", "a@x.com"), "Ana Paula");
  assert.equal(regras.rotuloDesconto("percentual", 7.5), "7,5%");
  assert.equal(regras.rotuloDesconto("valor", 1000), null);
});

test("dados da proposta (Admin): validação de limites e formatos", () => {
  const ok = { nomeComercial: "MAG", razaoSocial: "", cnpj: "26.537.584/0003-94", endereco: "", telefone: "", whatsapp: "", email: "a@b.com", site: "magmoveiscorporativos.com.br", rodape: "", validadeDias: 7 };
  assert.deepEqual(regras.validarEmitente(ok), []);
  assert.deepEqual(regras.validarEmitente({ ...ok, nomeComercial: " ", cnpj: "123", email: "x", site: "javascript:alert(1)", validadeDias: 0 }),
    ["Nome comercial: obrigatório", "CNPJ: formato inválido", "E-mail: inválido", "Site: use só o endereço (ex.: magmoveiscorporativos.com.br)", "Validade padrão: de 1 a 90 dias"]);
});

// ---------- Versões, retrato e aviso de alteração ----------
test("gerar proposta: v1 com retrato; rascunho vira salvo; validade padrão gravada; gerar não é aceite", async () => {
  const id = novoOrcamento();
  const r = await prop.gerarProposta(mateus, id, { versaoOrcamento: versaoDe(id), mostrarSku: true }, catalogo, dep);
  assert.deepEqual(r, { versao: 1, nova: true });
  const q = db.getDb().prepare("SELECT status, valid_until, accepted_at FROM internal_quotes WHERE id=?").get(id);
  assert.equal(q.status, "salvo");
  assert.equal(q.valid_until, daqui(7), "validade = hoje + 7 dias (padrão do Admin)");
  assert.equal(q.accepted_at, null, "gerar a proposta NÃO marca aceite");
  const s = retrato(id, 1);
  assert.equal(s.numero.startsWith("MAG-Q-"), true);
  assert.equal(s.consultor.nome, "Mateus Oliveira", "consultor = dono, nome do vendedor no Omie");
  assert.equal(s.cliente.contato, "Maria Compras");
  assert.equal(s.cliente.documento, "06.942.221/0001-65");
  assert.equal(s.itens[0].prontaEntrega, true);
  assert.equal(s.itens[1].prontaEntrega, false);
  assert.equal(s.itens[1].descontoRotulo, "10%");
  assert.equal(s.totais.totalCentavos, 65900 + 270000);
  assert.equal(s.observacoes, "Entrega no térreo, em horário comercial.");
  // Dados do pedido (conta, consumidor final, observações do pedido) ficam no retrato SÓ no bloco interno `pedido` (fora do PDF).
  const { pedido: dadosPedido, ...visivel } = s;
  assert.equal(JSON.stringify(visivel).includes("NÃO FATURAR"), false, "observação do pedido no Omie não entra na parte visível da proposta");
  assert.deepEqual(dadosPedido, { conta: "8765103276", consumidorFinal: false, observacoes: "NÃO FATURAR — teste interno", contaDescricao: "Bradesco Mag Filial" });
  assert.equal(JSON.stringify(s).includes("margem apertada"), false, "notas internas não entram na proposta");
  assert.equal("disponivel" in s.itens[0], false, "quantidade em estoque não entra no retrato");
  const auditoria = acoes(id).filter((a) => a.action.startsWith("quote:proposta") || a.action === "quote:status:salvo");
  assert.deepEqual(auditoria.map((a) => a.action), ["quote:status:salvo", "quote:proposta:gerada"]);
  assert.equal(auditoria[1].details, JSON.stringify({ versao: 1, quote_owner: mateus.id, proposal_consultant: mateus.id, proposal_generated_by: mateus.id }),
    "auditoria: versão e os três papéis (só ids)");
});

test("pronta entrega só quando o disponível cobre a quantidade pedida", async () => {
  const id = novoOrcamento(mateus, { itens: [{ produtoId: "8764749588", quantidade: "5", preco: "659,00", descontoTipo: "", desconto: "" }] });
  await prop.gerarProposta(mateus, id, { versaoOrcamento: versaoDe(id), mostrarSku: true }, catalogo, dep);
  assert.equal(retrato(id, 1).itens[0].prontaEntrega, false, "5 pedidos > 3 disponíveis");
  const repetido = novoOrcamento(mateus, { itens: [{ produtoId: "8764749588", quantidade: "2", preco: "659,00", descontoTipo: "", desconto: "" },
    { produtoId: "8764749588", quantidade: "2", preco: "600,00", descontoTipo: "", desconto: "" }] });
  await prop.gerarProposta(mateus, repetido, { versaoOrcamento: versaoDe(repetido), mostrarSku: true }, catalogo, dep);
  assert.deepEqual(retrato(repetido, 1).itens.map((i) => i.prontaEntrega), [false, false], "mesmo produto em 2 linhas: 2 + 2 > 3 disponíveis");
  const cabe = novoOrcamento(mateus, { itens: [{ produtoId: "8764749588", quantidade: "1", preco: "659,00", descontoTipo: "", desconto: "" },
    { produtoId: "8764749588", quantidade: "2", preco: "600,00", descontoTipo: "", desconto: "" }] });
  await prop.gerarProposta(mateus, cabe, { versaoOrcamento: versaoDe(cabe), mostrarSku: true }, catalogo, dep);
  assert.deepEqual(retrato(cabe, 1).itens.map((i) => i.prontaEntrega), [true, true], "1 + 2 = 3 disponíveis");
  const fracao = novoOrcamento(mateus, {itens:[{produtoId:"8764749588",quantidade:"1,1",preco:"100,00",descontoTipo:"",desconto:""},{produtoId:"8764749588",quantidade:"2,2",preco:"100,00",descontoTipo:"",desconto:""}]});
  await prop.gerarProposta(mateus,fracao,{versaoOrcamento:versaoDe(fracao),mostrarSku:true},() => ({prontaEntrega:true,disponivel:3.3,foto:null}),dep);
  assert.deepEqual(retrato(fracao,1).itens.map((i) => i.prontaEntrega),[true,true],"1,1 + 2,2 = 3,3 sem falso estouro por ponto flutuante");
});

test("alteração depois da proposta: aviso, v1 intacta, v2 nova; clique duplo não duplica versão", async () => {
  const id = novoOrcamento();
  await prop.gerarProposta(mateus, id, { versaoOrcamento: versaoDe(id), mostrarSku: true }, catalogo, dep);
  const pdfV1 = await prop.pdfDaProposta(mateus, id, 1, dep);
  assert.equal(pdfV1.confere, true, "PDF refeito do retrato = o gerado na hora da versão");
  assert.equal(prop.resumoPropostas(id).alterado, false);
  const repetida = await prop.gerarProposta(mateus, id, { versaoOrcamento: versaoDe(id), mostrarSku: true }, catalogo, dep);
  assert.deepEqual(repetida, { versao: 1, nova: false }, "mesmo conteúdo em menos de 30 s = a mesma versão");
  // O vendedor muda o preço: aviso de alterado; a v1 continua igual.
  const validade = db.getDb().prepare("SELECT valid_until FROM internal_quotes WHERE id=?").get(id).valid_until;
  const d = dados(versaoDe(id));
  d.proposta.validade = validade;
  orc.salvarOrcamento(mateus, id, d, new Map(PRODUTOS.map((p) => [p.id, p])));
  assert.equal(prop.resumoPropostas(id).alterado, false, "salvar sem mudar nada não é alteração");
  const mudou = dados(versaoDe(id));
  mudou.proposta.validade = validade;
  mudou.itens[0].preco = "699,00";
  orc.salvarOrcamento(mateus, id, mudou, new Map(PRODUTOS.map((p) => [p.id, p])));
  assert.equal(prop.resumoPropostas(id).alterado, true);
  const v1Depois = await prop.pdfDaProposta(mateus, id, 1, dep);
  assert.equal(v1Depois.confere, true, "a v1 não muda sozinha");
  assert.equal(retrato(id, 1).itens[0].precoCentavos, 65900);
  // Só notas internas mudam: não conta como alteração da proposta.
  const r2 = await prop.gerarProposta(mateus, id, { versaoOrcamento: versaoDe(id), mostrarSku: false }, catalogo, dep);
  assert.deepEqual(r2, { versao: 2, nova: true });
  assert.equal(retrato(id, 2).itens[0].precoCentavos, 69900);
  const notas = dados(versaoDe(id));
  notas.itens[0].preco = "699,00";
  notas.proposta.validade = db.getDb().prepare("SELECT valid_until FROM internal_quotes WHERE id=?").get(id).valid_until; // a tela manda a validade gravada
  notas.condicoes.notasInternas = "outra nota interna";
  orc.salvarOrcamento(mateus, id, notas, new Map(PRODUTOS.map((p) => [p.id, p])));
  const resumo = prop.resumoPropostas(id);
  assert.equal(resumo.alterado, false, "notas internas não aparecem para o cliente");
  assert.deepEqual(resumo.versoes.map((v) => [v.versao, v.geradaPor, v.mostrarSku]), [[2, "Mateus Oliveira", false], [1, "Mateus Oliveira", true]]);
  assert.match(resumo.versoes[0].arquivo, /^MAG-Orcamento-MAG-Q-\d{4}-\d{5}-Cajuina-Sao-Geraldo-v2\.pdf$/);
});

test("permissões: outro Comercial não gera nem baixa; Admin gera no orçamento do Mateus (consultor continua o Mateus)", async () => {
  const id = novoOrcamento();
  await assert.rejects(prop.gerarProposta(outro, id, { versaoOrcamento: versaoDe(id), mostrarSku: true }, catalogo, dep), /Forbidden/);
  const r = await prop.gerarProposta(admin, id, { versaoOrcamento: versaoDe(id), mostrarSku: true }, catalogo, dep);
  assert.equal(r.versao, 1);
  assert.equal(retrato(id, 1).consultor.nome, "Mateus Oliveira");
  assert.equal(prop.resumoPropostas(id).versoes[0].geradaPor, "Marketing", "histórico mostra quem gerou");
  const gerada = db.getDb().prepare("SELECT details FROM audit_log WHERE target_id=? AND action='quote:proposta:gerada'").get(id).details;
  assert.deepEqual(JSON.parse(gerada), { versao: 1, quote_owner: mateus.id, proposal_consultant: mateus.id, proposal_generated_by: admin.id },
    "Admin gerou, mas dono e consultor continuam o Mateus");
  await assert.rejects(prop.pdfDaProposta(outro, id, 1, dep), /Forbidden/);
  assert.throws(() => prop.dadosParaEnvio(outro, id, 1), /Forbidden/);
  assert.throws(() => prop.registrarAcao(outro, id, 1, "whatsapp"), /Forbidden/);
  await assert.rejects(prop.pdfDaProposta(mateus, id, 9, dep), /não encontrada/);
  assert.equal((await prop.pdfDaProposta(admin, id, 1, dep)).confere, true);
});

test("conflito de versão, pendências e validade vencida bloqueiam a geração", async () => {
  const id = novoOrcamento();
  await assert.rejects(prop.gerarProposta(mateus, id, { versaoOrcamento: versaoDe(id) - 1, mostrarSku: true }, catalogo, dep), /alterado por outra pessoa/);
  const vazio = orc.criarOrcamento(mateus, PRODUTOS).id;
  await assert.rejects(prop.gerarProposta(mateus, vazio, { versaoOrcamento: versaoDe(vazio), mostrarSku: true }, catalogo, dep), /informe o cliente; inclua pelo menos um item/);
  const vencido = novoOrcamento(mateus, { proposta: { ...dados(1).proposta, validade: "2026-01-01" } });
  await assert.rejects(prop.gerarProposta(mateus, vencido, { versaoOrcamento: versaoDe(vencido), mostrarSku: true }, catalogo, dep), /validade da proposta já passou/);
  assert.equal(db.getDb().prepare("SELECT count(*) n FROM quote_proposals WHERE quote_id IN (?,?,?)").get(id, vazio, vencido).n, 0);
});

test("depois do aceite: não gera nova versão, mas as versões continuam disponíveis", async () => {
  const id = novoOrcamento(mateus, { condicoes: { ...dados(1).condicoes, formaPagamento: "" } });
  await prop.gerarProposta(mateus, id, { versaoOrcamento: versaoDe(id), mostrarSku: true }, catalogo, dep);
  db.getDb().prepare("UPDATE internal_quotes SET status='aceito', version=version+1 WHERE id=?").run(id);
  await assert.rejects(prop.gerarProposta(mateus, id, { versaoOrcamento: versaoDe(id), mostrarSku: true }, catalogo, dep), /só para orçamento em rascunho, salvo ou enviado/);
  assert.equal((await prop.pdfDaProposta(mateus, id, 1, dep)).confere, true);
});

test("frete, montagem e desconto geral: entram na proposta; desconto geral maior que os itens é recusado", async () => {
  const mapa = new Map(PRODUTOS.map((p) => [p.id, p]));
  const id = novoOrcamento(mateus, { proposta: { ...dados(1).proposta, descontoGeral: "59,00", frete: "180,00", montagem: "350,00" } });
  await prop.gerarProposta(mateus, id, { versaoOrcamento: versaoDe(id), mostrarSku: true }, catalogo, dep);
  const t = retrato(id, 1).totais;
  assert.deepEqual([t.subtotalCentavos, t.descontoGeralCentavos, t.freteCentavos, t.montagemCentavos, t.totalCentavos], [335900, 5900, 18000, 35000, 383000]);
  const lista = orc.listarOrcamentos(mateus, {}).find((o) => o.id === id);
  assert.deepEqual([lista.totalCentavos, lista.proposta], [383000, 1], "a lista mostra o total da proposta e a versão");
  const d = dados(versaoDe(id), { proposta: { ...dados(1).proposta, descontoGeral: "99.999,00" } });
  assert.throws(() => orc.salvarOrcamento(mateus, id, d, mapa), /desconto geral não pode passar do total dos itens/);
  assert.throws(() => orc.salvarOrcamento(mateus, id, dados(versaoDe(id), { proposta: { ...dados(1).proposta, frete: "abc" } }), mapa), /frete inválido/);
});

test("trava do Pedido no Omie: com frete/montagem/desconto geral a revisão bloqueia (o pedido não muda)", async () => {
  const conv = await import("../src/lib/omie-conversao.server.ts");
  const aceitar = async (quoteId) => {
    db.getDb().prepare("UPDATE internal_quotes SET payment_code='000', payment_label='A Vista' WHERE id=?").run(quoteId);
    await prop.gerarProposta(mateus, quoteId, { versaoOrcamento: versaoDe(quoteId), mostrarSku: true }, catalogo, dep);
    prop.marcarVersaoEnviada(mateus, quoteId, prop.resumoPropostas(quoteId).vigente);
    orc.mudarEstado(mateus, quoteId, "aceitar", versaoDe(quoteId));
  };
  const id = novoOrcamento(mateus, { proposta: { ...dados(1).proposta, frete: "180,00" } });
  await aceitar(id);
  const rev = await conv.prepararRevisao(mateus, id);
  assert.ok(rev.bloqueios.some((b) => b.startsWith("Frete (") && b.includes("NÃO foi habilitado")), rev.bloqueios.join(" | "));
  assert.ok(rev.bloqueios.some((b) => b.includes("não confere com a proposta aceita") && b.includes("Frete: aceito")), "a conferência mostra o frete que ficaria fora do pedido");
  assert.equal(rev.conferencia.diferencaCentavos, -18000);
  const semExtras = novoOrcamento();
  await aceitar(semExtras);
  const rev2 = await conv.prepararRevisao(mateus, semExtras);
  assert.equal(rev2.bloqueios.some((b) => /^(Desconto geral|Frete|Montagem) \(/.test(b) || b.includes("não confere com a proposta aceita")), false, rev2.bloqueios.join(" | "));
  assert.equal(rev2.conferencia.confere, true);
});

// ---------- PDF ----------
test("PDF: A4, timbrado, itens com e sem foto, pronta entrega sem número, nada interno", async () => {
  const id = novoOrcamento();
  await prop.gerarProposta(mateus, id, { versaoOrcamento: versaoDe(id), mostrarSku: true }, catalogo, dep);
  const pdf = await renderizarProposta(retrato(id, 1), dep);
  const cabeca = Buffer.from(pdf.bytes.slice(0, 8)).toString("latin1");
  assert.equal(cabeca.startsWith("%PDF-1."), true);
  const { PDFDocument } = await import("pdf-lib");
  const lido = await PDFDocument.load(pdf.bytes);
  assert.equal(lido.getPageCount(), 1);
  const { width, height } = lido.getPage(0).getSize();
  assert.deepEqual([Math.round(width), Math.round(height)], [595, 842], "A4");
  assert.equal(lido.getTitle(), `Proposta ${retrato(id, 1).numero} v1`);
  const textos = pdf.paginas[0].textos.join("\n");
  for (const esperado of ["PROPOSTA COMERCIAL", "MAG Móveis Corporativos", "MAGAZINE DOS MOVEIS LTDA · CNPJ 26.537.584/0003-94", "CAJUINA SAO GERALDO LTDA", "A/C: Maria Compras",
    "CADEIRA DIRETOR PORTO PRETA", "SKU 00125", "Pronta entrega", "TOTAL DA PROPOSTA", "R$ 3.359,00", "Mateus Oliveira", "Página 1 de 1", "Entrega no térreo, em horário comercial."]) {
    assert.ok(textos.includes(esperado), `faltou "${esperado}"`);
  }
  assert.equal(pdf.paginas[0].textos.filter((t) => t === "Pronta entrega").length, 1, "só a cadeira (o armário não está em pronta entrega)");
  assert.equal(pdf.paginas[0].fotos, 1, "uma foto (o armário fica com o quadro neutro)");
  for (const proibido of [/avaria/i, /licita/i, /importa/i, /estoque/i, /custo/i, /margem/i, /omie/i, /8764749588/, /NÃO FATURAR/, /dispon[ií]vel:/i]) {
    assert.equal(proibido.test(textos), false, `não pode aparecer ${proibido}`);
  }
  const semSku = await renderizarProposta({ ...retrato(id, 1), opcoes: { mostrarSku: false } }, dep);
  assert.equal(semSku.paginas[0].textos.some((t) => t.startsWith("SKU ")), false, "SKU opcional");
  const semFoto = await renderizarProposta(retrato(id, 1), { carregarFoto: async () => null });
  assert.equal(semFoto.paginas[0].fotos, 0, "sem arquivo de foto: célula neutra, sem erro");
});

test("PDF: muitos itens viram várias páginas com cabeçalho, tabela e paginação em todas", async () => {
  const { id } = orc.criarOrcamento(mateus, PRODUTOS);
  const d = dados(1);
  d.itens = Array.from({ length: 40 }, (_, i) => ({ produtoId: PRODUTOS[i % 2].id, quantidade: "1", preco: `${100 + i},00`, descontoTipo: i % 3 ? "" : "valor", desconto: i % 3 ? "" : "5,00" }));
  orc.salvarOrcamento(mateus, id, d, new Map(PRODUTOS.map((p) => [p.id, p])));
  await prop.gerarProposta(mateus, id, { versaoOrcamento: versaoDe(id), mostrarSku: true }, catalogo, dep);
  const pdf = await renderizarProposta(retrato(id, 1), dep);
  const n = pdf.paginas.length;
  assert.ok(n >= 3, `esperava 3+ páginas, veio ${n}`);
  pdf.paginas.forEach((p, i) => {
    assert.ok(p.textos.includes("MAG Móveis Corporativos"), `cabeçalho na página ${i + 1}`);
    assert.ok(p.textos.some((t) => t.endsWith(`Página ${i + 1} de ${n}`)), `paginação na página ${i + 1}`);
  });
  assert.ok(pdf.paginas.slice(0, -1).every((p) => p.textos.includes("PRODUTO")), "cabeçalho da tabela repetido");
  assert.ok(pdf.paginas[n - 1].textos.includes("TOTAL DA PROPOSTA"));
});

// ---------- WhatsApp, e-mail e auditoria ----------
test("WhatsApp e e-mail: textos com nome, número, resumo, total, condição e disponibilidade — sem estoque numérico", async () => {
  const id = novoOrcamento(mateus, { itens: [{ produtoId: "8764749588", quantidade: "2", preco: "659,00", descontoTipo: "", desconto: "" }] });
  await prop.gerarProposta(mateus, id, { versaoOrcamento: versaoDe(id), mostrarSku: true }, catalogo, dep);
  const d = prop.dadosParaEnvio(mateus, id, 1);
  assert.equal(d.whatsapp.telefone, "5588999991234");
  const numero = retrato(id, 1).numero;
  assert.equal(d.whatsapp.texto.split("\n")[0], `Olá, Maria Compras! Segue a proposta MAG nº ${numero}, conforme conversamos.`);
  for (const parte of ["• 2 UN — CADEIRA DIRETOR PORTO PRETA", "Valor total: R$ 1.318,00.", "Os produtos estão disponíveis para pronta entrega.", "Segue a proposta para sua análise.", "Mateus Oliveira — MAG Móveis Corporativos"]) {
    assert.ok(d.whatsapp.texto.includes(parte), `WhatsApp sem "${parte}"`);
  }
  assert.equal(/\b3\b/.test(d.whatsapp.texto), false, "o disponível (3) nunca aparece");
  assert.equal(d.email.para, "compras@cajuina.example");
  assert.equal(d.email.assunto, `Proposta MAG nº ${numero} — Cajuína São Geraldo`);
  assert.ok(d.email.mensagem.includes("Segue em anexo a proposta"));
  assert.equal(d.arquivo, regras.nomeArquivoProposta(numero, "CAJUINA SAO GERALDO LTDA", 1));
  prop.registrarAcao(mateus, id, 1, "whatsapp");
  prop.registrarAcao(mateus, id, 1, "email");
  const registradas = acoes(id).filter((a) => a.action === "quote:proposta:compartilhamento_iniciado");
  assert.deepEqual(registradas.map((a) => a.details), ['{"versao":1,"canal":"whatsapp"}', '{"versao":1,"canal":"email"}'], "abrir WhatsApp/e-mail = compartilhamento iniciado (sem dado do cliente)");
  assert.equal(db.getDb().prepare("SELECT sent_at FROM quote_proposals WHERE quote_id=? AND version=1").get(id).sent_at, null, "não vira \"enviada\" sozinha");
});

test("e-mail pelo servidor: desligado por padrão; ligado, só envia após a confirmação, com o PDF anexado e sem conteúdo na auditoria", async () => {
  const id = novoOrcamento();
  await prop.gerarProposta(mateus, id, { versaoOrcamento: versaoDe(id), mostrarSku: true }, catalogo, dep);
  const msg = { para: "compras@cajuina.example", assunto: "Proposta", mensagem: "Olá" };
  assert.deepEqual(await prop.enviarPorEmail(mateus, id, 1, msg, null, dep), { ok: false, motivo: "nao_configurado" });
  const enviados = [];
  const enviar = async (m) => { enviados.push(m); return { enviado: true }; };
  await assert.rejects(prop.enviarPorEmail(mateus, id, 1, { ...msg, para: "nao-e-email" }, enviar, dep), /Para: informe de 1 a 3 e-mails válidos/);
  await assert.rejects(prop.enviarPorEmail(mateus, id, 1, { ...msg, para: "a@a.com, b@b.com, c@c.com, d@d.com" }, enviar, dep), /de 1 a 3/);
  await assert.rejects(prop.enviarPorEmail(outro, id, 1, msg, enviar, dep), /Forbidden/);
  assert.deepEqual(await prop.enviarPorEmail(mateus, id, 1, msg, enviar, dep), { ok: true });
  assert.equal(enviados.length, 1);
  assert.deepEqual(enviados[0].para, ["compras@cajuina.example"]);
  assert.equal(enviados[0].responderPara, "mateus@teste.example", "resposta vai para o consultor");
  assert.equal(Buffer.from(enviados[0].anexo.bytes.slice(0, 5)).toString("latin1"), "%PDF-");
  assert.match(enviados[0].anexo.arquivo, /Cajuina-Sao-Geraldo\.pdf$/);
  assert.deepEqual(await prop.enviarPorEmail(mateus, id, 1, msg, async () => { throw new Error("rede"); }, dep), { ok: false, motivo: "falha" });
  const registros = acoes(id).filter((a) => a.action.startsWith("quote:proposta:email"));
  assert.deepEqual(registros.map((a) => [a.action, a.details]), [["quote:proposta:email_enviado", '{"versao":1,"destinatarios":1}'], ["quote:proposta:email_falhou", '{"versao":1,"destinatarios":1}']]);
});

test("dados institucionais e nome do consultor: só Admin altera os dados; cada pessoa o próprio nome; versões antigas não mudam", async () => {
  assert.throws(() => prop.salvarEmitente(mateus, prop.lerEmitente()), /Forbidden/);
  const id = novoOrcamento();
  await prop.gerarProposta(mateus, id, { versaoOrcamento: versaoDe(id), mostrarSku: true }, catalogo, dep);
  const salvo = prop.salvarEmitente(admin, { ...prop.lerEmitente(), rodape: "Frete e montagem conforme indicado.", validadeDias: 10 });
  assert.equal(salvo.validadeDias, 10);
  assert.equal(db.getDb().prepare("SELECT details FROM audit_log WHERE action='proposal_settings:changed' ORDER BY id DESC LIMIT 1").get().details, '{"campos":"rodape,validadeDias"}');
  assert.throws(() => prop.salvarEmitente(admin, { ...salvo, cnpj: "abc" }), /CNPJ: formato inválido/);
  prop.salvarMeuPerfil(mateus, { ...prop.lerMeuPerfil(mateus).perfil, nome: "Mateus O." });
  assert.equal(prop.lerMeuPerfil(mateus).perfil.nome, "Mateus O.");
  const d = dados(versaoDe(id));
  d.itens[0].quantidade = "2";
  orc.salvarOrcamento(mateus, id, d, new Map(PRODUTOS.map((p) => [p.id, p])));
  await prop.gerarProposta(mateus, id, { versaoOrcamento: versaoDe(id), mostrarSku: true }, catalogo, dep);
  assert.equal(retrato(id, 2).consultor.nome, "Mateus O.");
  assert.equal(retrato(id, 2).emitente.rodape, "Frete e montagem conforme indicado.");
  assert.equal(retrato(id, 1).consultor.nome, "Mateus Oliveira", "a v1 guarda o nome da hora em que foi gerada");
  assert.equal(retrato(id, 1).emitente.rodape, "");
  db.getDb().prepare("DELETE FROM proposal_profiles WHERE user_id=?").run(mateus.id);
  prop.salvarEmitente(admin, { ...salvo, rodape: "", validadeDias: 7 });
});

// ---------- Perfil comercial, versões, aceite, comparação e duplicação (08/10/2026 noite) ----------
const mapa = () => new Map(PRODUTOS.map((p) => [p.id, p]));
const gerar = (quem, id, mostrarSku = true) => prop.gerarProposta(quem, id, { versaoOrcamento: versaoDe(id), mostrarSku }, catalogo, dep);
const linhaV = (id, v) => db.getDb().prepare("SELECT * FROM quote_proposals WHERE quote_id=? AND version=?").get(id, v);
/** Muda o preço do 1º item mantendo a validade gravada (= o orçamento mudou depois da vigente). */
function mudarPreco(id, preco) {
  const d = dados(versaoDe(id));
  d.proposta.validade = db.getDb().prepare("SELECT valid_until FROM internal_quotes WHERE id=?").get(id).valid_until ?? "";
  d.itens[0].preco = preco;
  orc.salvarOrcamento(mateus, id, d, mapa());
}

test("perfil comercial: só contatos marcados saem (PDF, prévia e retrato); o PDF usa o perfil do DONO mesmo quando o Admin gera", async () => {
  const semPerfil = prop.perfilDe(outro.id);
  assert.deepEqual([semPerfil.email, semPerfil.exibirEmail, semPerfil.telefone, semPerfil.whatsapp], ["", false, "", ""], "sem perfil: nenhum contato (nem o e-mail de login)");
  assert.equal(prop.consultorPublico(outro.id).email, "", "e-mail de login nunca vira contato público por padrão");
  assert.deepEqual(regras.validarPerfil({ nome: "", cargo: "", telefone: "123", whatsapp: "", email: "x", assinatura: "", exibirTelefone: false, exibirWhatsapp: true, exibirEmail: true }),
    ["Telefone: use DDD + número", "E-mail: inválido", "WhatsApp: preencha ou desmarque \"exibir\""]);
  prop.salvarMeuPerfil(mateus, { nome: "Mateus Oliveira", cargo: "Consultor de projetos", telefone: "(85) 3122-0506", whatsapp: "85 99777-6655",
    email: "mateus@teste.example", assinatura: "Especialista em mobiliário corporativo", exibirTelefone: false, exibirWhatsapp: true, exibirEmail: true });
  prop.salvarMeuPerfil(admin, { nome: "Vladson", cargo: "Diretor", telefone: "(85) 98888-1111", whatsapp: "(85) 98888-1111", email: "vladson@teste.example",
    assinatura: "", exibirTelefone: true, exibirWhatsapp: true, exibirEmail: true });
  const perfilAudit = db.getDb().prepare("SELECT details FROM audit_log WHERE action='user:proposal_profile' AND actor_id=? ORDER BY id DESC").get(mateus.id).details;
  assert.equal(/99777|mateus@|Especialista/.test(perfilAudit), false, "auditoria do perfil só com nomes de campos");
  const id = novoOrcamento();
  const previa = prop.resumoPropostas(id, admin).consultor;
  assert.deepEqual(previa, { nome: "Mateus Oliveira", cargo: "Consultor de projetos", assinatura: "Especialista em mobiliário corporativo", email: "mateus@teste.example",
    telefone: "", whatsapp: "(85) 99777-6655", eDono: false }, "prévia: telefone NÃO marcado não aparece; Admin não é o dono");
  assert.equal(prop.resumoPropostas(id, mateus).consultor.eDono, true);
  await gerar(admin, id);
  const s = retrato(id, 1);
  assert.equal(s.layout, 2);
  assert.deepEqual(s.consultor, { nome: "Mateus Oliveira", cargo: "Consultor de projetos", assinatura: "Especialista em mobiliário corporativo", email: "mateus@teste.example", telefone: "", whatsapp: "(85) 99777-6655" });
  assert.equal(JSON.stringify(s.emitente).includes("3122-0506"), true, "o telefone da MAG continua no cabeçalho");
  assert.equal(JSON.stringify(s.consultor).includes("3122-0506"), false, "o telefone do Mateus (não marcado) não entra no retrato");
  assert.equal(/Vladson|98888|Diretor/.test(JSON.stringify(s)), false, "nada do perfil do Admin que gerou");
  const pdf = await renderizarProposta(s, dep);
  const textos = pdf.paginas.flatMap((pg) => pg.textos).join("\n");
  for (const esperado of ["Mateus Oliveira", "Consultor de projetos", "mateus@teste.example", "WhatsApp (85) 99777-6655", "Especialista em mobiliário corporativo", "Consultor de projetos · MAG Móveis Corporativos"]) {
    assert.ok(textos.includes(esperado), `PDF sem "${esperado}"`);
  }
  assert.equal(/Diretor|Vladson|98888/.test(textos), false, "PDF nunca usa o perfil de quem clicou em Gerar");
  assert.equal(s.condicoes.pagamentoCodigo, null, "código da condição guardado para o futuro Pedido (vazio neste orçamento)");
  const email = prop.dadosParaEnvio(admin, id, 1).email.mensagem;
  assert.ok(email.includes("Mateus Oliveira\nConsultor de projetos\nMAG Móveis Corporativos\nWhatsApp: (85) 99777-6655 · mateus@teste.example"), email);
  db.getDb().prepare("DELETE FROM proposal_profiles").run();
});

test("versões: uma vigente; arquivar e excluir com regras; número nunca reutilizado; excluída some e não abre", async () => {
  const id = novoOrcamento();
  await gerar(mateus, id);                            // v1
  mudarPreco(id, "700,00"); await gerar(mateus, id);  // v2
  mudarPreco(id, "710,00"); await gerar(mateus, id);  // v3
  mudarPreco(id, "720,00"); await gerar(mateus, id);  // v4 (vigente)
  assert.equal(db.getDb().prepare("SELECT count(*) n FROM quote_proposals WHERE quote_id=? AND current=1").get(id).n, 1);
  assert.equal(prop.resumoPropostas(id).vigente, 4);
  prop.registrarAcao(mateus, id, 4, "whatsapp"); // só compartilhamento iniciado
  assert.deepEqual([linhaV(id, 4).share_started_at !== null, linhaV(id, 4).share_channel, linhaV(id, 4).sent_at], [true, "whatsapp", null], "abrir o WhatsApp não é envio");
  assert.match(acoes(id).map((a) => `${a.action} ${a.details}`).join("\n"), /quote:proposta:compartilhamento_iniciado \{"versao":4,"canal":"whatsapp"\}/);
  assert.throws(() => prop.registrarAcao(mateus, id, 2, "whatsapp"), /só a versão vigente \(v4\)/, "envio só da vigente");
  assert.throws(() => prop.dadosParaEnvio(mateus, id, 3), /só a versão vigente/);
  await assert.rejects(prop.pdfDaProposta(mateus, id, 2, dep, { somenteVigente: true }), /só a versão vigente/, "imprimir/compartilhar só a vigente");
  assert.equal((await prop.pdfDaProposta(mateus, id, 2, dep)).confere, true, "ver/baixar versão antiga continua");
  const r = prop.gerenciarVersoes(mateus, id, "excluir", [2, 4]);
  assert.deepEqual(r, { feitas: [2], recusadas: [{ versao: 4, motivo: "é a versão vigente" }] });
  assert.ok(linhaV(id, 2).deleted_at, "soft-delete: a linha continua");
  assert.equal(linhaV(id, 2).snapshot.length > 100, true, "retrato preservado");
  await assert.rejects(prop.pdfDaProposta(mateus, id, 2, dep), /não encontrada/, "excluída não abre");
  assert.deepEqual(prop.resumoPropostas(id).versoes.map((v) => v.versao), [4, 3, 1]);
  assert.equal(prop.resumoPropostas(id).excluidas, 1);
  prop.marcarVersaoEnviada(mateus, id, 4); // "✓ Marcar como enviada ao cliente"
  assert.ok(linhaV(id, 4).sent_at);
  assert.equal(db.getDb().prepare("SELECT status FROM internal_quotes WHERE id=?").get(id).status, "enviado", "orçamento salvo passa a enviado ao cliente");
  mudarPreco(id, "730,00");
  assert.equal((await gerar(mateus, id)).versao, 5, "depois de excluir a v2, a próxima depois da v4 é a v5");
  assert.equal(prop.resumoPropostas(id).proxima, 6);
  prop.registrarAcao(mateus, id, 5, "email");
  assert.deepEqual(prop.gerenciarVersoes(mateus, id, "excluir", [4]).recusadas, [{ versao: 4, motivo: "já enviada ao cliente (imutável)" }]);
  const r5 = prop.resumoPropostas(id).versoes.find((v) => v.versao === 5);
  assert.deepEqual([r5.compartilhamentoIniciado, r5.enviada, r5.canal], [true, false, "email"]);
  assert.deepEqual(prop.resumoPropostas(id).versoes.find((v) => v.versao === 3).substituida, true);
  assert.deepEqual(prop.gerenciarVersoes(mateus, id, "arquivar", [1, 4, 5]), { feitas: [1, 4], recusadas: [{ versao: 5, motivo: "é a versão vigente" }] });
  assert.deepEqual(prop.resumoPropostas(id).versoes.filter((v) => v.arquivada).map((v) => v.versao), [4, 1]);
  assert.deepEqual(prop.gerenciarVersoes(mateus, id, "desarquivar", [4]).feitas, [4]);
  assert.throws(() => prop.gerenciarVersoes(outro, id, "excluir", [3]), /Forbidden/);
  // Versão só com compartilhamento iniciado (sem marcar enviada) continua podendo ser excluída.
  mudarPreco(id, "740,00"); await gerar(mateus, id); // v6 vigente; a v5 (só compartilhada) pode sair
  assert.deepEqual(prop.gerenciarVersoes(mateus, id, "excluir", [5]).feitas, [5]);
  const auditadas = acoes(id).filter((a) => /excluida|arquivada|desarquivada/.test(a.action) && !/"versao":5/.test(a.details)).map((a) => `${a.action} ${a.details}`);
  assert.deepEqual(auditadas, ['quote:proposta:excluida {"versao":2}', 'quote:proposta:arquivada {"versao":1}', 'quote:proposta:arquivada {"versao":4}', 'quote:proposta:desarquivada {"versao":4}']);
});

test("aceite: é da versão vigente, só sem alteração depois dela; congela; nova revisão exige nova versão e novo aceite", async () => {
  const id = novoOrcamento(mateus, { condicoes: { ...dados(1).condicoes, formaPagamento: "" } });
  db.getDb().prepare("UPDATE internal_quotes SET payment_code='000', payment_label='A Vista' WHERE id=?").run(id);
  orc.mudarEstado(mateus, id, "salvar", versaoDe(id));
  assert.throws(() => orc.mudarEstado(mateus, id, "aceitar", versaoDe(id)), /gere a proposta/, "sem proposta não há aceite");
  await gerar(mateus, id);
  // O orçamento muda depois da v1 → aceite recusado até gerar outra versão.
  db.getDb().prepare("UPDATE internal_quotes SET payment_label='A Vista (balcão)' WHERE id=?").run(id);
  assert.throws(() => orc.mudarEstado(mateus, id, "aceitar", versaoDe(id)), /mudou depois da proposta vigente \(v1\)/);
  db.getDb().prepare("UPDATE internal_quotes SET payment_label='A Vista' WHERE id=?").run(id);
  orc.mudarEstado(mateus, id, "enviar", versaoDe(id));
  assert.ok(linhaV(id, 1).sent_at, "marcar \"enviado ao cliente\" marca a vigente como enviada");
  orc.mudarEstado(mateus, id, "aceitar", versaoDe(id));
  const q = db.getDb().prepare("SELECT status, accepted_proposal_id FROM internal_quotes WHERE id=?").get(id);
  assert.equal(q.status, "aceito");
  assert.equal(q.accepted_proposal_id, linhaV(id, 1).id, "guarda qual versão foi aceita");
  assert.ok(linhaV(id, 1).accepted_at);
  assert.equal(prop.resumoPropostas(id).aceita, 1);
  assert.match(db.getDb().prepare("SELECT details FROM audit_log WHERE target_id=? AND action='quote:accepted'").get(id).details, /"proposta_versao":1/);
  await assert.rejects(gerar(mateus, id), /Criar nova revisão/, "depois do aceite não gera versão");
  // "Criar nova revisão" (reabrir): desfaz o aceite; a v1 aceita fica congelada; exige nova versão e novo aceite.
  orc.mudarEstado(mateus, id, "reabrir", versaoDe(id));
  assert.equal(db.getDb().prepare("SELECT accepted_proposal_id FROM internal_quotes WHERE id=?").get(id).accepted_proposal_id, null);
  mudarPreco(id, "640,00");
  db.getDb().prepare("UPDATE internal_quotes SET payment_code='000', payment_label='A Vista' WHERE id=?").run(id);
  assert.throws(() => orc.mudarEstado(mateus, id, "aceitar", versaoDe(id)), /A v1 já foi aceita e depois revisada/);
  await gerar(mateus, id);
  assert.equal(prop.gerenciarVersoes(mateus, id, "excluir", [1]).recusadas[0].motivo, "aceita pelo cliente (congelada)", "a aceita nunca se exclui");
  assert.equal(prop.gerenciarVersoes(mateus, id, "arquivar", [1]).recusadas[0].motivo, "aceita pelo cliente (congelada)");
  prop.marcarVersaoEnviada(mateus, id, 2);
  orc.mudarEstado(mateus, id, "aceitar", versaoDe(id));
  const resumo = prop.resumoPropostas(id);
  assert.equal(resumo.aceita, 2);
  assert.deepEqual(resumo.versoes.map((v) => [v.versao, v.aceita, v.aceitaAtual]), [[2, true, true], [1, true, false]]);
  assert.equal(retrato(id, 2).itens[0].precoCentavos, 64000, "o retrato aceito tem exatamente o que o cliente aceitou");
  assert.equal(retrato(id, 2).condicoes.pagamentoCodigo, "000", "e o código da condição para o futuro Pedido");
});

test("revisão (passo a passo): v1 → enviada → aceita → nova revisão → muda SÓ a conta → reaceitar a v1 é recusado → v2 → enviada → aceita", async () => {
  const mapa = new Map(PRODUTOS.map((p) => [p.id, p]));
  const condicoes = { ...dados(1).condicoes, formaPagamento: "000" };
  // Salva pelo mesmo caminho da tela, tudo igual (inclusive a validade gravada ao gerar), mudando só o que for pedido.
  const salvarSo = (id, mudanca) => orc.salvarOrcamento(mateus, id, dados(versaoDe(id), { condicoes: { ...condicoes, ...mudanca },
    proposta: { ...dados(1).proposta, validade: orc.lerOrcamento(mateus, id).orcamento.proposta.validade } }), mapa);
  const id = novoOrcamento(mateus, { condicoes });
  // 1. gera a v1
  await gerar(mateus, id);
  assert.throws(() => orc.mudarEstado(mateus, id, "aceitar", versaoDe(id)), /Marque a v1 como enviada ao cliente antes do aceite/, "o cliente só aceita o que recebeu");
  // 2. marca enviada
  prop.marcarVersaoEnviada(mateus, id, 1);
  // 3. aceita
  orc.mudarEstado(mateus, id, "aceitar", versaoDe(id));
  const v1 = linhaV(id, 1);
  assert.deepEqual([retrato(id, 1).pedido.conta, v1.accepted_account_id], ["8765103276", "8765103276"]);
  // 4. cria nova revisão
  orc.mudarEstado(mateus, id, "reabrir", versaoDe(id));
  // 5. altera SOMENTE a conta corrente (Bradesco → Stone), pelo mesmo caminho da tela (o resto idêntico)
  salvarSo(id, { conta: "8765116216" });
  const r = prop.resumoPropostas(id);
  assert.deepEqual([r.alterado, r.pedidoAlterado], [false, true], "conteúdo da proposta igual; dados do pedido mudaram");
  // 6–7. tentar aceitar de novo a v1 → recusado (a v1 aceita nunca é reaceita; o retrato dela não é reaproveitado)
  assert.throws(() => orc.mudarEstado(mateus, id, "aceitar", versaoDe(id)), /A v1 já foi aceita e depois revisada.*não pode ser aceita de novo/);
  // 8. gera a v2
  await gerar(mateus, id);
  assert.throws(() => orc.mudarEstado(mateus, id, "aceitar", versaoDe(id)), /Marque a v2 como enviada/, "v2 ainda não enviada");
  // 9. marca enviada
  prop.marcarVersaoEnviada(mateus, id, 2);
  // 10–11. aceita a v2 → funciona
  orc.mudarEstado(mateus, id, "aceitar", versaoDe(id));
  const q = db.getDb().prepare("SELECT status, accepted_proposal_id FROM internal_quotes WHERE id=?").get(id);
  assert.deepEqual([q.status, q.accepted_proposal_id], ["aceito", linhaV(id, 2).id]);
  assert.deepEqual([retrato(id, 2).pedido.conta, linhaV(id, 2).accepted_account_id], ["8765116216", "8765116216"], "a v2 aceita leva a conta nova");
  // A v1 aceita continua preservada no histórico (mesmo retrato, mesmo aceite, mesma conta), e não é a aceita atual.
  assert.deepEqual([linhaV(id, 1).snapshot, linhaV(id, 1).accepted_at, linhaV(id, 1).accepted_account_id], [v1.snapshot, v1.accepted_at, "8765103276"]);
  assert.deepEqual(prop.resumoPropostas(id).versoes.map((v) => [v.versao, v.aceita, v.aceitaAtual]), [[2, true, true], [1, true, false]]);
});

test("dados do pedido fazem parte da versão: mudar SÓ a conta, SÓ o consumidor final ou SÓ as observações do pedido depois de gerar → aceite recusado", async () => {
  const mapa = new Map(PRODUTOS.map((p) => [p.id, p]));
  const condicoes = { ...dados(1).condicoes, formaPagamento: "000" };
  // Salva pelo mesmo caminho da tela, tudo igual (inclusive a validade gravada ao gerar), mudando só o que for pedido.
  const salvarSo = (id, mudanca) => orc.salvarOrcamento(mateus, id, dados(versaoDe(id), { condicoes: { ...condicoes, ...mudanca },
    proposta: { ...dados(1).proposta, validade: orc.lerOrcamento(mateus, id).orcamento.proposta.validade } }), mapa);
  for (const mudanca of [{ conta: "8765116216" }, { consumidorFinal: true }, { observacoes: "Outra observação do pedido" }]) {
    const id = novoOrcamento(mateus, { condicoes });
    await gerar(mateus, id);
    prop.marcarVersaoEnviada(mateus, id, 1);
    salvarSo(id, mudanca);
    const r = prop.resumoPropostas(id);
    assert.deepEqual([r.alterado, r.pedidoAlterado], [false, true], JSON.stringify(mudanca));
    assert.throws(() => orc.mudarEstado(mateus, id, "aceitar", versaoDe(id)), /A conta corrente, o consumidor final ou as observações do pedido mudaram depois da v1/, JSON.stringify(mudanca));
    // Voltar ao valor da v1 libera o aceite da v1 (nada mudou de fato).
    salvarSo(id, {});
    orc.mudarEstado(mateus, id, "aceitar", versaoDe(id));
  }
  // Versão gerada antes desta regra (sem os dados do pedido registrados): também não é aceita — gerar nova versão.
  const id = novoOrcamento(mateus, { condicoes });
  await gerar(mateus, id);
  prop.marcarVersaoEnviada(mateus, id, 1);
  db.getDb().prepare("UPDATE quote_proposals SET order_hash=NULL WHERE quote_id=?").run(id);
  assert.equal(prop.resumoPropostas(id).semDadosDoPedido, true);
  assert.throws(() => orc.mudarEstado(mateus, id, "aceitar", versaoDe(id)), /anterior ao registro dos dados do pedido/);
});

test("recusada: só a vigente; bloqueia o aceite; fica imutável; nova versão resolve", async () => {
  const id = novoOrcamento();
  db.getDb().prepare("UPDATE internal_quotes SET payment_code='000', payment_label='A Vista' WHERE id=?").run(id);
  await gerar(mateus, id);
  prop.marcarVersaoEnviada(mateus, id, 1);
  prop.marcarVersaoRecusada(mateus, id, 1);
  assert.ok(linhaV(id, 1).refused_at);
  assert.throws(() => orc.mudarEstado(mateus, id, "aceitar", versaoDe(id)), /foi recusada pelo cliente/);
  assert.throws(() => prop.marcarVersaoEnviada(mateus, id, 1), /recusada/);
  mudarPreco(id, "600,00");
  db.getDb().prepare("UPDATE internal_quotes SET payment_code='000', payment_label='A Vista' WHERE id=?").run(id);
  await gerar(mateus, id);
  assert.equal(prop.gerenciarVersoes(mateus, id, "excluir", [1]).recusadas[0].motivo, "recusada pelo cliente (imutável)");
  assert.throws(() => prop.marcarVersaoRecusada(mateus, id, 1), /só a versão vigente/);
  prop.marcarVersaoEnviada(mateus, id, 2);
  orc.mudarEstado(mateus, id, "aceitar", versaoDe(id));
  const r = prop.resumoPropostas(id).versoes;
  assert.deepEqual(r.map((v) => [v.versao, v.aceitaAtual, v.recusada]), [[2, true, false], [1, false, true]]);
  assert.throws(() => prop.marcarVersaoRecusada(mateus, id, 2), /aceita/);
  assert.deepEqual(acoes(id).filter((a) => /proposta:(enviada|recusada)/.test(a.action)).map((a) => `${a.action} ${a.details}`),
    ['quote:proposta:enviada {"versao":1}', 'quote:proposta:recusada {"versao":1}', 'quote:proposta:enviada {"versao":2}']);
});

test("previsão aceita congelada: não muda depois do aceite (só com nova revisão)", async () => {
  const id = novoOrcamento();
  db.getDb().prepare("UPDATE internal_quotes SET payment_code='000', payment_label='A Vista' WHERE id=?").run(id);
  await gerar(mateus, id);
  prop.marcarVersaoEnviada(mateus, id, 1);
  orc.mudarEstado(mateus, id, "aceitar", versaoDe(id));
  assert.throws(() => orc.atualizarPrevisao(mateus, id, daqui(30)), /congelada/);
  assert.equal(db.getDb().prepare("SELECT forecast_date FROM internal_quotes WHERE id=?").get(id).forecast_date, amanha);
});

test("comparar versões: produtos, quantidades, preços, descontos, frete, montagem, condição, validade e total", async () => {
  const id = novoOrcamento();
  await gerar(mateus, id);
  const d = dados(versaoDe(id), { proposta: { ...dados(1).proposta, frete: "150,00", montagem: "80,00", validade: daqui(20) } });
  d.itens = [{ produtoId: "8764749588", quantidade: "3", preco: "650,00", descontoTipo: "percentual", desconto: "5" }];
  orc.salvarOrcamento(mateus, id, d, mapa());
  db.getDb().prepare("UPDATE internal_quotes SET payment_code='006', payment_label='6 Parcelas' WHERE id=?").run(id);
  await gerar(mateus, id);
  const r = prop.compararVersoes(mateus, id, 2, 1);
  assert.equal(r.de, 1); assert.equal(r.para, 2);
  assert.deepEqual(r.itens.map((l) => [l.item, l.mudanca, l.campos.join("+")]), [
    ["CADEIRA DIRETOR PORTO PRETA (SKU 00125)", "alterado", "quantidade+preço+desconto"],
    ["ARMARIO ALTO FEC 2 P 30MM ALMERIA (SKU 00003)", "removido", ""],
  ]);
  assert.equal(r.itens[0].depois, "3 UN × R$ 650,00 − R$ 97,50 (5%) = R$ 1.852,50");
  const campos = Object.fromEntries(r.gerais.map((g) => [g.campo, `${g.antes} → ${g.depois}`]));
  assert.equal(campos["Frete"], "R$ 0,00 → R$ 150,00");
  assert.equal(campos["Montagem"], "R$ 0,00 → R$ 80,00");
  assert.equal(campos["Condição de pagamento"], "— → 6 Parcelas");
  assert.equal(campos["Validade"], `${regras.dataBR(daqui(7))} → ${regras.dataBR(daqui(20))}`);
  assert.equal(campos["Total da proposta"], "R$ 3.359,00 → R$ 2.082,50");
  assert.ok(campos["Descontos nos itens"]);
  assert.throws(() => prop.compararVersoes(outro, id, 1, 2), /Forbidden/);
  assert.throws(() => prop.compararVersoes(mateus, id, 2, 2), /duas versões diferentes/);
});

test("duplicar orçamento: número novo, mesmo cliente/itens/condições, histórico separado, dono mantido (mesmo pelo Admin)", async () => {
  const id = novoOrcamento(mateus, { proposta: { ...dados(1).proposta, frete: "99,00" } });
  await gerar(mateus, id);
  const original = orc.lerOrcamento(mateus, id).orcamento;
  const copia = orc.duplicarOrcamento(admin, id);
  assert.match(copia.numero, /^MAG-Q-\d{4}-\d{5}$/);
  assert.notEqual(copia.numero, original.numero);
  const l = orc.lerOrcamento(mateus, copia.id);
  assert.equal(l.orcamento.estado, "rascunho");
  assert.equal(l.orcamento.donoId, mateus.id, "o vendedor (dono) não muda, mesmo quando quem duplica é o Admin");
  assert.deepEqual(l.orcamento.cliente, original.cliente);
  // Conta corrente NÃO é copiada: cada venda escolhe a sua (não há padrão).
  assert.deepEqual({ ...l.orcamento.condicoes, notasInternas: "" }, { ...original.condicoes, notasInternas: "", conta: "", contaDescricao: "" });
  assert.equal(original.condicoes.conta, "8765103276");
  assert.equal(l.orcamento.condicoes.notasInternas, `Duplicado de ${original.numero}.`);
  assert.equal(l.orcamento.proposta.freteCentavos, 9900);
  assert.equal(l.orcamento.proposta.validade, "", "validade nova na nova negociação");
  assert.deepEqual(l.itens.map((i) => [i.produtoId, i.quantidade, i.precoCentavos]), orc.lerOrcamento(mateus, id).itens.map((i) => [i.produtoId, i.quantidade, i.precoCentavos]));
  assert.equal(prop.resumoPropostas(copia.id).versoes.length, 0, "propostas não vêm junto");
  assert.deepEqual(acoes(copia.id).map((a) => a.action), ["quote:created"]);
  assert.ok(acoes(id).some((a) => a.action === "quote:duplicated" && a.details.includes(copia.id)));
  assert.throws(() => orc.duplicarOrcamento(outro, id), /Forbidden/, "Comercial só duplica os próprios");
});

test("layout 1: versões geradas antes do perfil comercial são refeitas byte a byte", async () => {
  const s = JSON.parse(await readFile(new URL("./fixtures/proposta-layout1.json", import.meta.url), "utf8"));
  const pdf = await renderizarProposta(s, { carregarLogo: async () => LOGO, carregarFoto: async () => LOGO });
  const { createHash } = await import("node:crypto");
  assert.equal(createHash("sha256").update(pdf.bytes).digest("hex"), "0ee94055923d23b4f81e0db3ff3cc2f91fc60d6b90e6150e59ed369e53641ef0");
});

test("migração: banco da release anterior ganha vigente/enviada/aceita sem mudar retrato, PDF, autor ou horário", async () => {
  const { execFileSync } = await import("node:child_process");
  const { writeFile, mkdir } = await import("node:fs/promises");
  const pasta = join(dir, "migracao");
  await mkdir(join(pasta, "data"), { recursive: true });
  const script = join(pasta, "migra.mjs");
  const lib = new URL("../src/lib/local-db.server.ts", import.meta.url).href;
  const antigo = [
    "CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, roles TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0)",
    "CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT, action TEXT NOT NULL, target_id TEXT, created_at TEXT NOT NULL, details TEXT)",
    "CREATE TABLE internal_quotes (id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, status TEXT NOT NULL, owner_id TEXT NOT NULL, customer_id TEXT, source_request_id TEXT, customer_name TEXT NOT NULL DEFAULT '', customer_trade_name TEXT, customer_document TEXT, customer_email TEXT, customer_phone TEXT, customer_city TEXT, customer_state TEXT, omie_customer_id TEXT, payment_code TEXT, payment_label TEXT, forecast_date TEXT, final_consumer INTEGER NOT NULL DEFAULT 1, nf_email TEXT, order_notes TEXT, internal_notes TEXT, gross_cents INTEGER NOT NULL DEFAULT 0, discount_cents INTEGER NOT NULL DEFAULT 0, total_cents INTEGER NOT NULL DEFAULT 0, accepted_at TEXT, accepted_by TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
    "CREATE TABLE quote_proposals (id TEXT PRIMARY KEY, quote_id TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL, content_hash TEXT NOT NULL, snapshot TEXT NOT NULL, pdf_sha256 TEXT, UNIQUE(quote_id, version))",
    "INSERT INTO users VALUES ('u-mateus','mateus@x.com','h','[\"comercial\"]','2026-10-08',0),('u-admin','adm@x.com','h','[\"admin\"]','2026-10-08',0)",
    "INSERT INTO internal_quotes(id,number,status,owner_id,created_at,updated_at,accepted_at,accepted_by) VALUES ('q-real','MAG-Q-2026-00002','salvo','u-mateus','t','t',NULL,NULL),('q-aceito','MAG-Q-2026-00004','aceito','u-mateus','t','t','2026-10-08T10:00:00Z','u-mateus'),('q-enviado','MAG-Q-2026-00005','enviado','u-mateus','2026-10-08T11:00:00Z','2026-10-08T12:00:00Z',NULL,NULL)",
    "INSERT INTO quote_proposals VALUES ('p1','q-real',1,'2026-10-08T16:30:31Z','u-admin','h1','{\"x\":1}','s1'),('p2','q-real',2,'2026-10-08T16:32:27Z','u-admin','h2','{\"x\":2}','s2'),('p3','q-real',3,'2026-10-08T16:32:43Z','u-admin','h3','{\"x\":3}','s3'),('p9','q-aceito',1,'2026-10-08T09:00:00Z','u-mateus','h9','{\"x\":9}','s9'),('p7','q-enviado',1,'2026-10-08T11:30:00Z','u-mateus','h7','{\"x\":7}','s7')",
    "INSERT INTO audit_log(actor_id,action,target_id,created_at,details) VALUES ('u-admin','quote:proposta:whatsapp','q-real','2026-10-08T16:31:07Z','{\"versao\":1}'),('u-admin','quote:proposta:visualizar','q-real','2026-10-08T16:32:29Z','{\"versao\":2}'),('u-mateus','quote:status:enviado','q-enviado','2026-10-08T12:00:00Z','{}')",
  ];
  await writeFile(script, [
    'import { DatabaseSync } from "node:sqlite";',
    `const d = new DatabaseSync(${JSON.stringify(join(pasta, "data", "site.sqlite"))});`,
    `for (const sql of ${JSON.stringify(antigo)}) d.exec(sql);`,
    "d.close();",
    `const { getDb, closeDb } = await import(${JSON.stringify(lib)});`,
    'const linhas = getDb().prepare("SELECT id, version, current, owner_id, consultant_id, sent_at, share_started_at, share_channel, accepted_at, created_at, created_by, snapshot, pdf_sha256, content_hash FROM quote_proposals ORDER BY id").all();',
    'const q = getDb().prepare("SELECT id, accepted_proposal_id FROM internal_quotes ORDER BY id").all();',
    "closeDb();",
    "const indice = Boolean(getDb().prepare(\"SELECT 1 FROM sqlite_master WHERE name='quote_proposals_vigente'\").get());",
    "const vigentes = getDb().prepare('SELECT count(*) n FROM quote_proposals WHERE current=1').get().n;",
    "closeDb();",
    "console.log(JSON.stringify({ linhas, q, indice, vigentes }));",
  ].join("\n"));
  const saida = JSON.parse(execFileSync(process.execPath, [script], { env: { ...process.env, SITE_DATA_DIR: join(pasta, "data") }, encoding: "utf8" }).trim().split("\n").pop());
  const por = Object.fromEntries(saida.linhas.map((l) => [l.id, l]));
  assert.deepEqual(["p1", "p2", "p3"].map((k) => por[k].current), [0, 0, 1], "vigente = a mais recente (v3)");
  assert.deepEqual([por.p1.sent_at, por.p1.share_started_at, por.p1.share_channel], [null, "2026-10-08T16:31:07Z", "whatsapp"], "v1 só teve WhatsApp aberto → compartilhamento iniciado (não enviada)");
  assert.equal(por.p2.sent_at, null, "só visualizar não é envio");
  assert.deepEqual([por.p7.sent_at, por.p7.share_started_at], ["2026-10-08T12:00:00Z", null], "orçamento marcado enviado depois da versão: continua enviada");
  assert.deepEqual([por.p1.owner_id, por.p1.consultant_id, por.p1.created_by], ["u-mateus", "u-mateus", "u-admin"]);
  assert.deepEqual([por.p3.snapshot, por.p3.pdf_sha256, por.p3.content_hash, por.p3.created_at], ['{"x":3}', "s3", "h3", "2026-10-08T16:32:43Z"], "conteúdo intacto");
  assert.equal(por.p9.accepted_at, "2026-10-08T10:00:00Z", "orçamento já aceito: a vigente vira a aceita");
  assert.deepEqual(saida.q, [{ id: "q-aceito", accepted_proposal_id: "p9" }, { id: "q-enviado", accepted_proposal_id: null }, { id: "q-real", accepted_proposal_id: null }]);
  assert.equal(saida.indice, true);
  assert.equal(saida.vigentes, 3, "reabrir o banco (migração de novo) não muda nada");
});

test("nenhum dado do cliente em log técnico ou na auditoria", () => {
  const auditoria = db.getDb().prepare("SELECT action, details FROM audit_log").all().map((a) => `${a.action} ${a.details ?? ""}`).join("\n");
  for (const sensivel of ["06.942.221", "06942221000165", "compras@cajuina", "99999-1234", "Juazeiro", "Maria Compras", "CAJUINA", "99777-6655", "98888-1111"]) {
    assert.equal(auditoria.includes(sensivel), false, `auditoria com ${sensivel}`);
    assert.equal(logs.join("\n").includes(sensivel), false, `log com ${sensivel}`);
  }
});
