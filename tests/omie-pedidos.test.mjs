// node --test tests/omie-pedidos.test.mjs — serviço omie-pedidos com um Omie SIMULADO (sem rede).
import test from "node:test";
import assert from "node:assert/strict";
import { criarServidor, mensagemSegura } from "../scripts/omie-pedidos.mjs";
import { montarPedidoOmie } from "../src/lib/orcamento-regras.ts";

const TOKEN = "p".repeat(48);
const CHAVES = { appKey: "CHAVE-OMIE-SECRETA-777", appSecret: "SEGREDO-OMIE-888" };
const AGORA = Date.parse("2026-10-07T13:00:00Z");
const LOCAIS = [
  { codigo_local_estoque: 101, codigo: "GALPAO", descricao: "ESTOQUE BR 116", inativo: "N", padrao: "S", dispVenda: "S" },
  { codigo_local_estoque: 106, codigo: "LICIT", descricao: "LICITAÇÃO", inativo: "N", padrao: "N", dispVenda: "S" },
];
const NAO_COMERCIAIS = ["avaria", "licitacao", "importacao"];

/**
 * Omie simulado com estado: pedidos e clientes incluídos ficam "gravados" mesmo quando a resposta se perde. Como o Omie
 * de verdade, a MESMA consulta (método + parâmetros) repetida em menos de 60 s (relógio do teste) é recusada como
 * redundante e a recusa prorroga a janela; `redundantes()` conta as recusas.
 */
function omieSimulado({ perderRespostaDaInclusao = false, falhaInclusao = null } = {}) {
  const relogio = { t: AGORA };
  const chamadas = []; const pedidos = new Map(); const clientes = new Map(); const recentes = new Map();
  let perder = perderRespostaDaInclusao; let redundantes = 0;
  const json = (corpo, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
  const fault = (texto) => json({ faultstring: texto, faultcode: "SOAP-ENV:Client-1" }, 500);
  const fetchImpl = async (url, init) => {
    const corpo = JSON.parse(init.body); const p = corpo.param[0];
    chamadas.push({ url, call: corpo.call, param: p, chaves: [corpo.app_key, corpo.app_secret] });
    if (!corpo.call.startsWith("Incluir")) {
      const chave = `${corpo.call}|${JSON.stringify(p)}`;
      const antes = recentes.get(chave);
      recentes.set(chave, relogio.t);
      if (antes !== undefined && relogio.t - antes < 60_000) { redundantes += 1; return fault("ERROR: A requisição já foi realizada. Aguarde 60 segundos para repetir a consulta."); }
    }
    switch (corpo.call) {
      case "ListarVendedores": return json({ pagina: p.pagina, total_de_paginas: 2, registros: 1, total_de_registros: 2, cadastro: [
        p.pagina === 1 ? { codigo: 8766947629, codInt: "", nome: "VLADSON", email: "", inativo: "N", fatura_pedido: "N", visualiza_pedido: "N", comissao: 3 }
          : { codigo: 8766948065, codInt: "X", nome: "SAMANTHA GABRIEL - VAREJO", email: "Sam@Mag.com.br", inativo: "S", fatura_pedido: "N", visualiza_pedido: "N", comissao: 5 }] });
      case "ListarEtapasFaturamento": return json({ pagina: 1, total_de_paginas: 1, cadastros: [{}, { cCodOperacao: "11", cDescOperacao: "Venda de Produto", etapas: [
        { cCodigo: "10", cDescricao: "Orçamento - PD", cDescrPadrao: "Pedido de Venda", cInativo: "N" }, { cCodigo: "50", cDescricao: "Para Faturar", cDescrPadrao: "Faturar", cInativo: "N" }] }] });
      case "ListarFormasPagVendas": return json({ pagina: 1, total_de_paginas: 1, cadastros: [{ cCodigo: "000", cDescricao: "A Vista", nQtdeParc: 1 }, { cCodigo: "999", cDescricao: "Informar", nQtdeParc: 999 }] });
      case "ListarContasCorrentes": return json({ pagina: 1, total_de_paginas: 1, ListarContasCorrentes: [{ nCodCC: 8765103276, descricao: "Bradesco Mag Filial", tipo_conta_corrente: "CC", inativo: "N", numero_conta_corrente: "12345-6", saldo_inicial: 999999, codigo_agencia: "0001" }] });
      case "ListarClientes": if (p.clientesFiltro?.razao_social === "LTDA") {
        // Como o Omie em produção: filtro "contém", 120 clientes, páginas contadas de 20 em 20 mas 100 registros devolvidos.
        const todos = Array.from({ length: 120 }, (_, i) => ({ codigo_cliente_omie: 8000 + i, razao_social: `EMPRESA ${i} LTDA`, nome_fantasia: "", cnpj_cpf: "", inativo: "N", cidade: "", estado: "CE" }));
        return json({ pagina: p.pagina, total_de_paginas: Math.ceil(120 / p.registros_por_pagina), registros: 100, total_de_registros: 120, clientes_cadastro: todos.slice(0, 100) });
      }
        return p.clientesFiltro?.cnpj_cpf === "11.222.333/0001-81"
        ? json({ pagina: 1, total_de_paginas: 1, clientes_cadastro: [{ codigo_cliente_omie: 5551, razao_social: "CLIENTE TESTE LTDA", nome_fantasia: "TESTE", cnpj_cpf: "11.222.333/0001-81", inativo: "N", cidade: "FORTALEZA (CE)", estado: "CE", email: "segredo@cliente.com", telefone1_numero: "99999-0000", endereco: "RUA X" }] })
        : fault("ERROR: Não existem registros para a página [1]!");
      case "ConsultarCliente": {
        const c = p.codigo_cliente_integracao ? clientes.get(p.codigo_cliente_integracao) : [...clientes.values()].find((x) => x.codigo_cliente_omie === p.codigo_cliente_omie);
        return c ? json(c) : fault("ERROR: Cliente não cadastrado para o Código de Integração [x] !");
      }
      case "IncluirCliente": {
        const registro = { codigo_cliente_omie: 7000 + clientes.size, codigo_cliente_integracao: p.codigo_cliente_integracao, razao_social: p.razao_social, cnpj_cpf: p.cnpj_cpf, inativo: "N" };
        clientes.set(p.codigo_cliente_integracao, registro);
        return json({ codigo_cliente_omie: registro.codigo_cliente_omie, codigo_cliente_integracao: p.codigo_cliente_integracao, codigo_status: "0", descricao_status: "Cliente cadastrado com sucesso!" });
      }
      case "ConsultarPedido": {
        const r = p.codigo_pedido ? [...pedidos.values()].find((x) => x.codigo === p.codigo_pedido) : pedidos.get(p.codigo_pedido_integracao);
        const merc = (r?.payload.det ?? []).reduce((s, d) => s + Math.round(d.produto.quantidade * d.produto.valor_unitario * 100), 0);
        const desc = (r?.payload.det ?? []).reduce((s, d) => s + Math.round(d.produto.valor_desconto * 100), 0);
        return r ? json({ pedido_venda_produto: { cabecalho: { codigo_pedido: r.codigo, numero_pedido: r.numero, etapa: "10", codigo_cliente: r.payload.cabecalho.codigo_cliente,
          codigo_parcela: r.payload.cabecalho.codigo_parcela }, det: r.payload.det, informacoes_adicionais: r.payload.informacoes_adicionais,
          total_pedido: { valor_mercadorias: merc / 100, valor_total_pedido: (merc - desc) / 100 }, infoCadastro: { cancelado: "N", faturado: "N" } } })
          : fault("ERROR: Pedido não cadastrado para o Código de Integração [MAG-Q-2026-00001] !");
      }
      case "StatusPedido": return json({ codigo_pedido: p.codigo_pedido, numero_pedido: "1234", etapa: "20", cancelada: "N", faturada: "N", valor_total_pedido: 3255 });
      case "IncluirPedido": {
        if (falhaInclusao) return fault(falhaInclusao);
        const registro = { codigo: 9100 + pedidos.size, numero: String(1234 + pedidos.size), payload: p };
        pedidos.set(p.cabecalho.codigo_pedido_integracao, registro); // gravou...
        if (perder) { perder = false; throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); } // ...mas a resposta se perdeu
        return json({ codigo_pedido: registro.codigo, codigo_pedido_integracao: p.cabecalho.codigo_pedido_integracao, numero_pedido: registro.numero, codigo_status: "0", descricao_status: "Pedido cadastrado com sucesso!" });
      }
      case "ListarLocaisEstoque": return json({ locaisEncontrados: LOCAIS });
      case "ListarPosEstoque": {
        const linhas = p.lista_produtos.flatMap(({ nCodProd }) => [
          { nCodProd, cCodigo: `SKU-${nCodProd}`, codigo_local_estoque: 101, nSaldo: 3, fisico: 3, nPendente: 1, reservado: 0 },
          { nCodProd, cCodigo: `SKU-${nCodProd}`, codigo_local_estoque: 106, nSaldo: 490, fisico: 490, nPendente: 0, reservado: 0 }]);
        const pagina = p.nPagina; const porPagina = 4;
        return json({ nPagina: pagina, nTotPaginas: Math.ceil(linhas.length / porPagina), produtos: linhas.slice((pagina - 1) * porPagina, pagina * porPagina) });
      }
      default: return fault("ERROR: método não simulado");
    }
  };
  return { chamadas, pedidos, clientes, fetchImpl, relogio, avancar: (ms) => { relogio.t += ms; }, redundantes: () => redundantes, metodos: () => chamadas.map((c) => c.call) };
}

async function iniciar(t, omie, extra = {}) {
  const config = { ...CHAVES, nonCommercialLocations: NAO_COMERCIAIS, token: TOKEN, escrita: false, apiUrl: "https://omie.teste/api/v1/",
    porta: 0, intervaloMs: 1100, tetoHora: 300, timeoutMs: 30000, timeoutEscritaMs: 45000, repetirMs: 65000, ...extra };
  const logs = []; const original = console.log;
  console.log = (...args) => logs.push(args.join(" "));
  const servidor = criarServidor(config, { fetchImpl: omie.fetchImpl, now: () => omie.relogio.t, sleepImpl: async () => {} });
  await new Promise((pronto) => servidor.listen(0, "127.0.0.1", pronto));
  t.after(() => { console.log = original; servidor.close(); });
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const pedir = async (caminho, corpo) => {
    const r = await fetch(base + caminho, { method: corpo === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    return { status: r.status, corpo: await r.json() };
  };
  return { base, pedir, logs, servidor };
}
const pedido = (extra = {}) => montarPedidoOmie({
  numero: "MAG-Q-2026-00001", codigoClienteOmie: "5551", dataPrevisao: "2026-10-20", etapa: "10", codigoParcela: "000", categoria: "1.01.01",
  contaCorrente: "8765103276", codVend: "8766947629", consumidorFinal: true, emailsNf: "compras@cliente.com.br", observacoes: "",
  itens: [{ codigoProdutoOmie: "8764749209", quantidade: 2, precoCentavos: 150000, descontoCentavos: 15000 }], ...extra,
});

test("token obrigatório (exceto /saude); /verificar não chama o Omie; rotas fora da lista recusadas", async (t) => {
  const omie = omieSimulado();
  const { base, pedir, servidor } = await iniciar(t, omie);
  assert.ok(servidor.keepAliveTimeout >= 60_000 && servidor.headersTimeout > servidor.keepAliveTimeout, "conexão ociosa dura mais que no fetch do site (sem ECONNRESET)");
  assert.equal((await fetch(`${base}/vendedores`)).status, 401);
  assert.equal((await fetch(`${base}/verificar`, { headers: { authorization: `Bearer ${"x".repeat(48)}` } })).status, 401);
  const saude = await (await fetch(`${base}/saude`)).json();
  assert.equal(saude.escrita, false);
  assert.deepEqual((await pedir("/verificar")).corpo.chavesOmie, true);
  assert.equal((await pedir("/qualquer")).status, 404);
  assert.equal((await fetch(`${base}/pedidos`, { method: "DELETE", headers: { authorization: `Bearer ${TOKEN}` } })).status, 405);
  assert.equal(omie.chamadas.length, 0);
});

test("escrita DESLIGADA: pedido válido só é simulado; inválido é barrado; nada chega ao Omie", async (t) => {
  const omie = omieSimulado();
  const { pedir } = await iniciar(t, omie);
  assert.deepEqual((await pedir("/pedidos", pedido())).corpo, { ok: false, motivo: "escrita_desligada", simulado: true });
  const invalido = await pedir("/pedidos", pedido({ etapa: "50" }));
  assert.equal(invalido.corpo.motivo, "pedido_invalido");
  assert.match(invalido.corpo.erros.join(" "), /etapa não permitida/);
  assert.equal((await pedir("/clientes", { codigo_cliente_integracao: `MAG-C-${"a".repeat(32)}`, razao_social: "Cliente", nome_fantasia: "Cliente", cnpj_cpf: "11222333000181", email: "a@b.com" })).corpo.simulado, true);
  assert.equal(omie.chamadas.length, 0, "com a escrita desligada nenhuma chamada sai");
});

test("escrita LIGADA: consulta pelo código de integração ANTES de incluir; só a lista branca de campos vai ao Omie", async (t) => {
  const omie = omieSimulado();
  const { pedir, logs } = await iniciar(t, omie, { escrita: true });
  const forjado = pedido();
  forjado.cabecalho.etapa_extra = "50"; forjado.informacoes_adicionais.faturar = "S"; forjado.informacoes_adicionais.enviar_pix = "S"; forjado.lista_parcelas = [{ x: 1 }];
  const r = await pedir("/pedidos", forjado);
  const { conferencia, ...resposta } = r.corpo;
  assert.deepEqual(resposta, { ok: true, codigoPedido: "9100", numeroPedido: "1234", etapa: "10" });
  assert.deepEqual({ confere: conferencia.confere, divergencias: conferencia.divergencias }, { confere: true, divergencias: [] }, "lido de volta no Omie: igual ao enviado");
  assert.deepEqual(omie.metodos(), ["ConsultarPedido", "IncluirPedido", "ConsultarPedido"], "consulta antes, inclui e confirma");
  assert.deepEqual(omie.chamadas[2].param, { codigo_pedido: 9100 }, "a confirmação usa o código do Omie (não repete a consulta de antes)");
  const enviado = omie.chamadas[1].param;
  assert.deepEqual(Object.keys(enviado).sort(), ["cabecalho", "det", "informacoes_adicionais", "observacoes"]);
  assert.ok(!("etapa_extra" in enviado.cabecalho) && !("faturar" in enviado.informacoes_adicionais), "campo a mais descartado");
  assert.equal(enviado.informacoes_adicionais.enviar_email, "N");
  assert.ok(!("enviar_pix" in enviado.informacoes_adicionais), "só uma das tags enviar_email/enviar_pix vai ao Omie");
  assert.equal(enviado.det[0].produto.reservado, "N", "o painel nunca reserva estoque");
  // pedido já existente: devolve o mesmo, não inclui de novo (nem consulta o Omie: foi este serviço que o criou)
  const de_novo = await pedir("/pedidos", pedido());
  assert.equal(de_novo.corpo.existente, true);
  assert.equal(omie.metodos().length, 3);
  assert.deepEqual((await pedir("/pedidos?integracao=MAG-Q-2026-00001")).corpo.pedido.codigoPedido, "9100");
  assert.equal(omie.redundantes(), 0);
  const tudo = logs.join("\n");
  for (const segredo of [...Object.values(CHAVES), "compras@cliente.com.br", "MAG-Q-2026-00001", "5551"]) assert.ok(!tudo.includes(segredo), `log com ${segredo}`);
});

test("desconto geral e frete DESLIGADOS: o serviço RECUSA o pedido que os trouxer (nunca descarta em silêncio); nada vai ao Omie", async (t) => {
  const omie = omieSimulado();
  const { pedir } = await iniciar(t, omie, { escrita: true });
  const comFrete = pedido({ frete: { modalidade: "0", valorCentavos: 18000 } });
  assert.deepEqual(comFrete.frete, { modalidade: "0", valor_frete: 180 });
  const r1 = (await pedir("/pedidos", comFrete)).corpo;
  assert.equal(r1.motivo, "pedido_invalido");
  assert.match(r1.erros.join(" "), /frete no pedido ainda não habilitado/);
  assert.match((await pedir("/pedidos", pedido({ descontoPedidoCentavos: 5000 }))).corpo.erros.join(" "), /desconto geral no pedido ainda não habilitado/);
  const forjado = pedido();
  forjado.cabecalho.perc_desconto_pedido = 10;
  assert.match((await pedir("/pedidos", forjado)).corpo.erros.join(" "), /desconto geral no pedido ainda não habilitado/);
  assert.equal(omie.chamadas.length, 0, "nada chegou ao Omie (nem a consulta)");
});

test("tempo esgotado DEPOIS de o Omie gravar: resposta 'incerto' e a nova tentativa acha o pedido — nunca duplica", async (t) => {
  const omie = omieSimulado({ perderRespostaDaInclusao: true });
  const { pedir } = await iniciar(t, omie, { escrita: true });
  const primeira = await pedir("/pedidos", pedido());
  assert.deepEqual({ ok: primeira.corpo.ok, motivo: primeira.corpo.motivo }, { ok: false, motivo: "incerto" });
  assert.equal(omie.pedidos.size, 1, "o Omie gravou");
  const chamadasAntes = omie.chamadas.length;
  const cedo = await pedir("/pedidos", pedido());
  assert.equal(cedo.corpo.motivo, "repetir_em", "a mesma consulta antes de 65 s seria recusada pelo Omie (e prorrogaria o bloqueio)");
  assert.ok(cedo.corpo.segundos > 0 && cedo.corpo.segundos <= 65, String(cedo.corpo.segundos));
  assert.equal(omie.chamadas.length, chamadasAntes, "nada foi ao Omie");
  omie.avancar(66_000);
  const segunda = await pedir("/pedidos", pedido());
  assert.deepEqual({ ok: segunda.corpo.ok, existente: segunda.corpo.existente, codigo: segunda.corpo.codigoPedido }, { ok: true, existente: true, codigo: "9100" });
  assert.equal(omie.metodos().filter((m) => m === "IncluirPedido").length, 1, "uma única inclusão");
  assert.equal(omie.pedidos.size, 1, "um único pedido no Omie");
  assert.equal(omie.redundantes(), 0);
});

test("pedido com o nosso código mas de outro cliente/itens (número repetido): conflito, nada incluído nem vinculado", async (t) => {
  const omie = omieSimulado();
  const { pedir } = await iniciar(t, omie, { escrita: true });
  omie.pedidos.set("MAG-Q-2026-00001", { codigo: 9555, numero: "4321", payload: pedido({ codigoClienteOmie: "6000" }) });
  const conflito = await pedir("/pedidos", pedido());
  assert.deepEqual({ ok: conflito.corpo.ok, motivo: conflito.corpo.motivo }, { ok: false, motivo: "conflito_integracao" });
  omie.pedidos.set("MAG-Q-2026-00001", { codigo: 9556, numero: "4322", payload: pedido({ itens: [{ codigoProdutoOmie: "8764749209", quantidade: 3, precoCentavos: 150000, descontoCentavos: 0 }] }) });
  omie.avancar(66_000);
  assert.equal((await pedir("/pedidos", pedido())).corpo.motivo, "conflito_integracao", "mesmo cliente, outra quantidade: também não é este");
  omie.pedidos.set("MAG-Q-2026-00001", { codigo: 9557, numero: "4323", payload: pedido() });
  omie.avancar(66_000);
  const nosso = await pedir("/pedidos", pedido());
  assert.deepEqual({ ok: nosso.corpo.ok, existente: nosso.corpo.existente, codigo: nosso.corpo.codigoPedido }, { ok: true, existente: true, codigo: "9557" }, "mesmo cliente e itens: é o envio anterior");
  assert.equal(omie.metodos().filter((m) => m === "IncluirPedido").length, 0);
  assert.equal(omie.redundantes(), 0);
});

test("janela do Omie: leitura igual em menos de 65 s é reaproveitada; recusa 'redundante' numa leitura não pausa as outras", async (t) => {
  const omie = omieSimulado();
  const um = await iniciar(t, omie);
  const v1 = (await um.pedir("/vendedores")).corpo;
  assert.deepEqual((await um.pedir("/vendedores")).corpo, v1);
  assert.equal(omie.metodos().filter((m) => m === "ListarVendedores").length, 2, "as 2 páginas, uma vez só");
  assert.deepEqual((await um.pedir("/pedidos?integracao=MAG-Q-2026-00009")).corpo, { ok: true, encontrado: false });
  assert.deepEqual((await um.pedir("/pedidos?integracao=MAG-Q-2026-00009")).corpo, { ok: true, encontrado: false }, "o 'não encontrado' também vale 65 s");
  assert.equal(omie.metodos().filter((m) => m === "ConsultarPedido").length, 1);
  // Serviço reiniciado logo depois (memória vazia): o Omie recusa a repetição; só essa consulta espera, as outras seguem.
  const dois = await iniciar(t, omie);
  const recusada = (await dois.pedir("/vendedores")).corpo;
  assert.deepEqual({ motivo: recusada.motivo, pausa: recusada.pausadoAte }, { motivo: "repetir_em", pausa: null }, "sem pausa geral");
  assert.equal((await dois.pedir("/etapas")).corpo.ok, true, "outra consulta segue normalmente");
  const antes = omie.chamadas.length;
  assert.equal((await dois.pedir("/vendedores")).corpo.motivo, "repetir_em");
  assert.equal(omie.chamadas.length, antes, "não refaz antes de 65 s (refazer prorrogaria o bloqueio)");
  omie.avancar(66_000);
  assert.equal((await dois.pedir("/vendedores")).corpo.ok, true);
  assert.equal(omie.redundantes(), 1, "só a recusa do serviço reiniciado");
});

test("recusa do Omie: motivo claro, mensagem sem documento/e-mail/telefone/chave; 'redundante' numa escrita = incerto", async (t) => {
  const recusado = omieSimulado({ falhaInclusao: "ERROR: Cliente 11.222.333/0001-81 (contato a@b.com, (85) 99999-0000) sem endereço. token CHAVE-OMIE-SECRETA-777. Produto 8764749209." });
  const um = await iniciar(t, recusado, { escrita: true });
  const r = await um.pedir("/pedidos", pedido());
  assert.equal(r.corpo.motivo, "omie_recusou");
  assert.ok(!/11\.222|a@b\.com|99999|CHAVE-OMIE/.test(r.corpo.mensagem), r.corpo.mensagem);
  assert.match(r.corpo.mensagem, /8764749209/, "código do produto continua legível");
  assert.ok(!um.logs.join("\n").includes("sem endereço"), "mensagem do Omie nunca vai para o log");
  const redundante = omieSimulado({ falhaInclusao: "ERROR: Consumo redundante detectado. Já foi realizada uma requisição igual." });
  const dois = await iniciar(t, redundante, { escrita: true });
  assert.equal((await dois.pedir("/pedidos", pedido())).corpo.motivo, "incerto");
  assert.equal(mensagemSegura("CPF 529.982.247-25 e 52998224725"), "CPF [documento] e [documento]");
});

test("leituras: vendedores (todas as páginas), etapas, formas, contas sem dado bancário, clientes sem dado pessoal", async (t) => {
  const omie = omieSimulado();
  const { pedir } = await iniciar(t, omie);
  const v = (await pedir("/vendedores")).corpo.vendedores;
  assert.deepEqual(v.map((x) => [x.codigo, x.nome, x.inativo, x.email]), [["8766947629", "VLADSON", false, ""], ["8766948065", "SAMANTHA GABRIEL - VAREJO", true, "sam@mag.com.br"]]);
  assert.ok(!("comissao" in v[0]), "comissão não é usada");
  const etapas = (await pedir("/etapas")).corpo.etapas;
  assert.deepEqual(etapas.map((e) => `${e.operacao}/${e.codigo}`), ["11/10", "11/50"]);
  assert.deepEqual((await pedir("/formas-pagamento")).corpo.formas.map((f) => f.codigo), ["000", "999"]);
  const contas = JSON.stringify((await pedir("/contas")).corpo);
  assert.ok(contas.includes("Bradesco Mag Filial") && !contas.includes("12345-6") && !contas.includes("999999") && !contas.includes("0001"));
  const clientes = (await pedir("/clientes?documento=11222333000181")).corpo.clientes;
  assert.deepEqual(clientes, [{ codigo: "5551", razaoSocial: "CLIENTE TESTE LTDA", nomeFantasia: "TESTE", documento: "11222333000181", inativo: false, cidade: "FORTALEZA (CE)", estado: "CE" }]);
  assert.equal(omie.chamadas.find((c) => c.call === "ListarClientes").param.clientesFiltro.cnpj_cpf, "11.222.333/0001-81", "filtro no formato do Omie");
  assert.deepEqual((await pedir("/clientes?documento=99888777000199")).corpo, { ok: false, motivo: "documento_invalido" });
  assert.deepEqual((await pedir("/clientes?documento=52998224725")).corpo.clientes, [], "nenhum cliente com esse CPF");
  const porNome = (await pedir("/clientes?nome=LTDA")).corpo;
  assert.deepEqual({ ok: porNome.ok, n: porNome.clientes.length, mais: porNome.mais }, { ok: true, n: 20, mais: true }, "nome comum: os 20 primeiros e o aviso para refinar");
  assert.equal(omie.chamadas.filter((c) => c.call === "ListarClientes" && c.param.clientesFiltro?.razao_social === "LTDA").length, 1, "uma página só");
  assert.deepEqual((await pedir("/clientes?nome=XYZW")).corpo, { ok: true, clientes: [], mais: false });
  assert.deepEqual((await pedir("/pedidos?integracao=MAG-Q-2026-00009")).corpo, { ok: true, encontrado: false });
  assert.equal((await pedir("/pedidos/9100/status")).corpo.status.etapa, "20");
});

test("cliente novo: validação, consulta pelo código de integração antes e nunca duplica", async (t) => {
  const omie = omieSimulado();
  const { pedir } = await iniciar(t, omie, { escrita: true });
  const dados = { codigo_cliente_integracao: `MAG-C-${"b".repeat(32)}`, razao_social: "Cliente Novo Ltda", nome_fantasia: "Novo", cnpj_cpf: "11.222.333/0001-81", email: "nf@novo.com.br", telefone: "(85) 3333-4444" };
  assert.equal((await pedir("/clientes", { ...dados, cnpj_cpf: "123" })).corpo.motivo, "cliente_invalido");
  assert.equal((await pedir("/clientes", { ...dados, email: "" })).corpo.motivo, "cliente_invalido");
  const criado = await pedir("/clientes", dados);
  assert.deepEqual(criado.corpo, { ok: true, codigoCliente: "7000" });
  assert.deepEqual(omie.metodos(), ["ConsultarCliente", "IncluirCliente", "ConsultarCliente"], "consulta antes, inclui e confirma");
  assert.deepEqual(omie.chamadas[2].param, { codigo_cliente_omie: 7000 });
  const incluido = omie.chamadas.find((c) => c.call === "IncluirCliente").param;
  assert.deepEqual({ doc: incluido.cnpj_cpf, pf: incluido.pessoa_fisica, ddd: incluido.telefone1_ddd }, { doc: "11.222.333/0001-81", pf: "N", ddd: "85" });
  assert.equal((await pedir("/clientes", dados)).corpo.existente, true);
  assert.equal(omie.metodos().filter((m) => m === "IncluirCliente").length, 1);
  assert.equal(omie.metodos().length, 3, "a repetição nem consulta o Omie");
  assert.equal(omie.redundantes(), 0);
});

test("estoque em lote: lotes de 20, todas as páginas, mesma regra comercial (Licitação fora)", async (t) => {
  const omie = omieSimulado();
  const { pedir } = await iniciar(t, omie);
  const ids = Array.from({ length: 25 }, (_, i) => String(1000 + i));
  const r = (await pedir("/estoque", { produtos: ids })).corpo;
  assert.equal(r.ok, true);
  assert.deepEqual(r.produtos["1000"], { conhecido: true, disponivel: 2, totalFisico: 493, sku: "SKU-1000" }, "SKU do Omie: a revisão confere com o da proposta aceita");
  assert.equal(Object.keys(r.produtos).length, 25);
  const posicoes = omie.chamadas.filter((c) => c.call === "ListarPosEstoque");
  assert.deepEqual([...new Set(posicoes.map((c) => c.param.lista_produtos.length))].sort(), [20, 5]);
  assert.ok(omie.chamadas.filter((c) => /ListarLocaisEstoque|ListarPosEstoque/.test(c.call)).every((c) => c.param.nRegPorPagina === 49),
    "49 por página: nunca a mesma requisição do omie-consulta (50)");
  const antes = omie.chamadas.length;
  omie.avancar(30_000);
  const de_novo = (await pedir("/estoque", { produtos: ids })).corpo;
  assert.equal(omie.chamadas.length, antes, "a mesma revisão em menos de 65 s não vai ao Omie");
  assert.equal(de_novo.consultadoEm, r.consultadoEm, "e informa quando o Omie foi consultado de fato");
  assert.equal((await pedir("/estoque", { produtos: ["abc"] })).corpo.motivo, "produtos_invalidos");
});
