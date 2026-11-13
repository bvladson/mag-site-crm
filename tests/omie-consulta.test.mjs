// node --test tests/omie-consulta.test.mjs — serviço da Consulta rápida com o Omie SIMULADO (nenhuma chamada real).
import test from "node:test";
import assert from "node:assert/strict";
import { buildCatalog, describeLocations } from "../scripts/sync-omie.mjs";
import { resumoEstoque, montarLocais, criarServidor } from "../scripts/omie-consulta.mjs";

const NAO_COMERCIAIS = ["avaria", "licitacao", "importacao", "assistencia", "demonstracao", "uso interno", "mostruario"];
const LOCAIS_OMIE = [
  { codigo_local_estoque: 101, descricao: "ESTOQUE BR 116", dispVenda: "S", padrao: "S", inativo: "N" },
  { codigo_local_estoque: 102, descricao: "LOJA DOM MANUEL 1180", dispVenda: "S", padrao: "N", inativo: "N" },
  { codigo_local_estoque: 103, descricao: "AVARIA", dispVenda: "S", padrao: "N", inativo: "N" },
  { codigo_local_estoque: 104, descricao: "LICITAÇÃO", dispVenda: "S", padrao: "N", inativo: "N" },
  { codigo_local_estoque: 105, descricao: "RECEBIMENTO DE IMPORTAÇÃO", dispVenda: "S", padrao: "N", inativo: "N" },
  { codigo_local_estoque: 106, descricao: "LOJA EXPERT - UNI", dispVenda: "S", padrao: "N", inativo: "N" },
  { codigo_local_estoque: 107, descricao: "OUTLET", dispVenda: "S", padrao: "N", inativo: "N" },
];
const locais = () => describeLocations(LOCAIS_OMIE, { nonCommercialLocations: NAO_COMERCIAIS });
const linha = (local, saldo, extra = {}) => ({ nCodProd: 555, cCodigo: "00555", cDescricao: "CADEIRA TESTE", codigo_local_estoque: local, nSaldo: saldo, fisico: saldo, nPendente: 0, reservado: 0, ...extra });
const produtoOmie = { codigo_produto: 555, codigo: "00555", descricao: "CADEIRA PRESIDENTE TESTE", tipoItem: "00", unidade: "UN", inativo: "N", bloqueado: "N", imagens: [], caracteristicas: [] };

/** Disponível calculado pelo worker noturno (buildCatalog) para as mesmas linhas. */
function disponivelDoCatalogo(linhas) {
  const comLinhas = locais().map((local) => ({ ...local, rows: linhas.filter((row) => String(row.codigo_local_estoque) === local.id) }));
  return buildCatalog([produtoOmie], comLinhas, { readyThreshold: 1 }).products[0].available;
}

test("disponível da consulta = disponível do catálogo noturno (mesma regra), em vários cenários", () => {
  const cenarios = {
    simples: [linha(101, 4), linha(103, 1)],
    "licitação, avaria e importação ficam fora": [linha(101, 7), linha(102, 1), linha(103, 1), linha(104, 490), linha(105, 20), linha(106, 0), linha(107, 2)],
    "pendente maior que reservado": [linha(101, 12, { nPendente: 3, reservado: 1 }), linha(104, 50, { nPendente: 40 })],
    "reservado maior que pendente": [linha(101, 12, { nPendente: 1, reservado: 5 }), linha(102, 3, { reservado: 1 })],
    "físico menor que saldo": [linha(101, 10, { fisico: 6 }), linha(107, 4, { fisico: 9 })],
    "comprometido maior que o estoque": [linha(101, 2, { nPendente: 9 })],
    "valores negativos e vazios": [linha(101, -3, { fisico: -3 }), linha(102, 5, { nPendente: "", reservado: null })],
    "fracionado": [linha(101, 2.5), linha(106, 0.255, { reservado: 0.005 })],
    "sem linha no local padrão = posição desconhecida": [linha(102, 8)],
  };
  for (const [nome, linhas] of Object.entries(cenarios)) {
    const resumo = resumoEstoque(montarLocais(locais(), linhas, "555"));
    assert.equal(resumo.disponivel, disponivelDoCatalogo(linhas), nome);
  }
  const detalhado = resumoEstoque(montarLocais(locais(), cenarios["licitação, avaria e importação ficam fora"], "555"));
  assert.deepEqual({ ...detalhado }, { conhecido: true, brutoComercial: 10, pendentes: 0, reservas: 0, comprometido: 0, disponivel: 10, totalFisico: 521 });
  const comprometido = resumoEstoque(montarLocais(locais(), cenarios["pendente maior que reservado"], "555"));
  assert.deepEqual([comprometido.brutoComercial, comprometido.pendentes, comprometido.reservas, comprometido.comprometido, comprometido.disponivel], [12, 3, 1, 3, 9],
    "pendências da Licitação não entram; em cada local conta o maior entre pendente e reservado");
});

test("locais: padrão primeiro, depois comerciais; Avaria, Licitação e Importação marcados como fora da venda", () => {
  const lista = montarLocais(locais(), [linha(101, 1)], "555");
  assert.equal(lista[0].nome, "Estoque BR 116");
  assert.ok(lista[0].padrao && lista[0].comercial);
  const fora = lista.filter((local) => !local.comercial).map((local) => local.nome).sort();
  assert.deepEqual(fora, ["Avaria", "Licitação", "Recebimento de Importação"]);
  assert.deepEqual(lista.filter((local) => local.comercial).map((local) => local.nome).sort(), ["Estoque BR 116", "Loja Dom Manuel 1180", "Loja Expert - Uni", "Outlet"]);
});

const TOKEN = "t".repeat(48);
const CHAVES = { appKey: "CHAVE-OMIE-SECRETA-123", appSecret: "SEGREDO-OMIE-456" };
function omieSimulado({ posicao = () => ({ produtos: [linha(101, 4), linha(103, 1), linha(104, 490)] }), status = 200 } = {}) {
  const chamadas = [];
  const fetchImpl = async (url, init) => {
    const corpo = JSON.parse(init.body);
    chamadas.push({ url, call: corpo.call, param: corpo.param[0], chaves: [corpo.app_key, corpo.app_secret] });
    if (typeof status === "function" ? status(corpo.call) !== 200 : status !== 200) {
      return new Response(JSON.stringify({}), { status: typeof status === "function" ? status(corpo.call) : status });
    }
    const resposta = corpo.call === "ListarLocaisEstoque" ? { locaisEncontrados: LOCAIS_OMIE } : posicao(corpo);
    if (resposta instanceof Error) throw resposta;
    return new Response(JSON.stringify(resposta), { status: resposta.faultstring ? 500 : 200, headers: { "Content-Type": "application/json" } });
  };
  return { chamadas, fetchImpl };
}

async function iniciar(t, omie, extra = {}) {
  let agora = Date.parse("2026-10-07T10:00:00Z");
  const relogio = { avancar: (ms) => { agora += ms; } };
  const config = { ...CHAVES, nonCommercialLocations: NAO_COMERCIAIS, token: TOKEN, apiUrl: "https://omie.teste/api/v1/", porta: 0, intervaloMs: 1100, repetirMs: 65000, tetoHora: 120, timeoutMs: 15000, ...extra };
  const logs = [];
  const original = console.log;
  console.log = (...args) => logs.push(args.join(" "));
  const servidor = criarServidor(config, { fetchImpl: omie.fetchImpl, now: () => agora, sleepImpl: async () => {} });
  await new Promise((pronto) => servidor.listen(0, "127.0.0.1", pronto));
  t.after(() => { console.log = original; servidor.close(); });
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const pedir = (caminho, init = {}) => fetch(base + caminho, { ...init, headers: { authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) } });
  return { base, pedir, relogio, logs };
}

test("serviço: token obrigatório, só GET /estoque/<código>, uma chamada ao Omie por consulta e nada de chave na resposta", async (t) => {
  const omie = omieSimulado();
  const { base, pedir, logs } = await iniciar(t, omie);
  assert.equal((await fetch(`${base}/estoque/555`)).status, 401, "sem token");
  assert.equal((await fetch(`${base}/estoque/555`, { headers: { authorization: "Bearer errado" } })).status, 401);
  assert.equal((await pedir("/estoque/555", { method: "POST" })).status, 405);
  assert.equal((await pedir("/estoque/abc")).status, 404);
  assert.equal((await pedir("/estoque/0")).status, 400);
  assert.equal((await pedir("/qualquer")).status, 404);
  assert.equal(omie.chamadas.length, 0, "nada disso chega ao Omie");
  const resposta = await pedir("/estoque/555");
  assert.equal(resposta.status, 200);
  const corpo = await resposta.json();
  assert.equal(corpo.ok, true);
  assert.equal(corpo.fonte, "omie");
  assert.deepEqual(omie.chamadas.map((chamada) => chamada.call), ["ListarLocaisEstoque", "ListarPosEstoque"]);
  const posicao = omie.chamadas[1];
  assert.equal(posicao.url, "https://omie.teste/api/v1/estoque/consulta/");
  assert.deepEqual(posicao.param.lista_produtos, [{ nCodProd: 555 }]);
  assert.equal(posicao.param.lista_local_estoque, "TODOS");
  assert.equal(corpo.locais.length, 7);
  assert.equal(corpo.resumo.disponivel, 4);
  assert.equal(corpo.resumo.totalFisico, 495);
  assert.deepEqual(corpo.omie, { sku: "00555", descricao: "CADEIRA TESTE" });
  const tudo = JSON.stringify(corpo) + logs.join("\n");
  for (const segredo of Object.values(CHAVES)) assert.ok(!tudo.includes(segredo), "chave do Omie na resposta ou no log");
  assert.ok(!tudo.includes(TOKEN), "token interno no log");
});

test("o mesmo produto não vai ao Omie de novo antes de 65 s; consultas simultâneas viram uma só; locais ficam 6 h em memória", async (t) => {
  const omie = omieSimulado();
  const { pedir, relogio } = await iniciar(t, omie);
  const [a, b] = await Promise.all([pedir("/estoque/555").then((r) => r.json()), pedir("/estoque/555").then((r) => r.json())]);
  assert.deepEqual([a.fonte, b.fonte].sort(), ["cache", "omie"]);
  assert.equal(omie.chamadas.filter((chamada) => chamada.call === "ListarPosEstoque").length, 1);
  relogio.avancar(30000);
  assert.equal((await (await pedir("/estoque/555")).json()).fonte, "cache");
  relogio.avancar(40000);
  assert.equal((await (await pedir("/estoque/555")).json()).fonte, "omie", "passados 65 s, consulta de novo");
  assert.equal(omie.chamadas.filter((chamada) => chamada.call === "ListarLocaisEstoque").length, 1, "locais reaproveitados");
});

test("Omie bloqueado (425) pausa 30 min; limite, chaves recusadas e rede caída viram motivos claros, nunca erro 500", async (t) => {
  const bloqueio = omieSimulado({ status: (call) => (call === "ListarPosEstoque" ? 425 : 200) });
  const ctx = await iniciar(t, bloqueio);
  const primeira = await ctx.pedir("/estoque/555");
  assert.equal(primeira.status, 200);
  assert.equal((await primeira.json()).motivo, "bloqueado");
  const antes = bloqueio.chamadas.length;
  assert.equal((await (await ctx.pedir("/estoque/777")).json()).motivo, "pausado");
  assert.equal(bloqueio.chamadas.length, antes, "durante a pausa nada vai ao Omie");
  ctx.relogio.avancar(31 * 60000);
  assert.equal((await (await ctx.pedir("/saude")).json()).pausadoAte, null);

  const casos = [
    [{ faultstring: "ERROR: Consumo redundante detectado. Aguarde 60 segundos." }, "limite"],
    [{ faultstring: "ERROR: A chave de acesso não é válida (app_key)" }, "credenciais"],
    [new TypeError("fetch failed"), "indisponivel"],
    [{ faultstring: "ERROR: erro inesperado no servidor" }, "omie_erro"],
  ];
  for (const [resposta, motivo] of casos) {
    const omie = omieSimulado({ posicao: () => resposta });
    const outro = await iniciar(t, omie);
    const corpo = await (await outro.pedir("/estoque/555")).json();
    assert.equal(corpo.ok, false, motivo);
    assert.equal(corpo.motivo, motivo);
  }
});

test("teto de chamadas por hora", async (t) => {
  const omie = omieSimulado();
  const { pedir } = await iniciar(t, omie, { tetoHora: 3 });
  assert.equal((await (await pedir("/estoque/1")).json()).ok, true); // locais + posição = 2 chamadas
  assert.equal((await (await pedir("/estoque/2")).json()).ok, true); // 3ª chamada
  assert.equal((await (await pedir("/estoque/3")).json()).motivo, "teto_horario");
  assert.equal(omie.chamadas.length, 3);
});

test("verificação (restore/operador): mesmo token de uma consulta, nunca chama o Omie e não revela chave", async (t) => {
  const omie = omieSimulado();
  const { base, pedir } = await iniciar(t, omie);
  assert.equal((await fetch(`${base}/verificar`)).status, 401, "sem token");
  assert.equal((await fetch(`${base}/verificar`, { headers: { authorization: `Bearer ${"x".repeat(48)}` } })).status, 401, "token errado");
  assert.equal((await pedir("/verificar", { method: "POST" })).status, 405);
  const resposta = await pedir("/verificar");
  assert.equal(resposta.status, 200);
  const corpo = await resposta.json();
  assert.deepEqual({ ok: corpo.ok, chavesOmie: corpo.chavesOmie, chamadas: corpo.chamadasUltimaHora }, { ok: true, chavesOmie: true, chamadas: 0 });
  for (const segredo of [...Object.values(CHAVES), TOKEN]) assert.ok(!JSON.stringify(corpo).includes(segredo));
  const semChaves = await iniciar(t, omie, { appKey: "", appSecret: "" });
  assert.equal((await (await semChaves.pedir("/verificar")).json()).chavesOmie, false);
  assert.equal(omie.chamadas.length, 0, "a verificação nunca chega ao Omie");
});

test("sem chaves do Omie ou sem token interno: recusa sem chamar nada", async (t) => {
  const omie = omieSimulado();
  const semChaves = await iniciar(t, omie, { appKey: "", appSecret: "" });
  assert.equal((await (await semChaves.pedir("/estoque/555")).json()).motivo, "nao_configurado");
  const semToken = await iniciar(t, omie, { token: "" });
  assert.equal((await semToken.pedir("/estoque/555")).status, 401);
  assert.equal(omie.chamadas.length, 0);
});
