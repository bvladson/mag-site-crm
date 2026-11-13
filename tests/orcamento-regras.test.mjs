// node --test tests/orcamento-regras.test.mjs — regras puras do orçamento interno e do Pedido de Venda do Omie.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  centavos, quantidade, percentual, calcularItem, calcularTotais, proximoEstado, editavel, podeGerarPedido, numeroOrcamento,
  NUMERO_ORCAMENTO, documentoValido, documentoFormatado, documentoMascarado, montarPedidoOmie, validarPedidoOmie, hojeFortaleza, dataOmie,
  conferirPedidoLido, mascararEmails, EXTRAS_NO_PEDIDO, extrasDoPedido, bloqueiosDeExtras, conferirAceitaComPedido, reais,
  sugestaoDeConta, contasDaVenda, REGRA_CONTA,
} from "../src/lib/orcamento-regras.ts";

test("dinheiro, quantidade e percentual no formato brasileiro", () => {
  assert.equal(centavos("1.234,56"), 123456);
  assert.equal(centavos("1234,56"), 123456);
  assert.equal(centavos("1234.56"), 123456);
  assert.equal(centavos("1.500"), 150000, "ponto como milhar");
  assert.equal(centavos("R$ 10"), 1000);
  assert.equal(centavos(99.9), 9990);
  for (const ruim of ["-5", "abc", "1,234", "", "1e5"]) assert.equal(centavos(ruim), null, ruim);
  assert.equal(quantidade("2"), 2);
  assert.equal(quantidade("1,5"), 1.5);
  assert.equal(quantidade("1.500"), 1500);
  for (const ruim of ["0", "100001", "-1", "1,2345", "x"]) assert.equal(quantidade(ruim), null, ruim);
  assert.equal(percentual("10,5"), 10.5);
  assert.equal(percentual("100"), 100);
  assert.equal(percentual("100,01"), null);
});

test("item: bruto, desconto sempre em valor (centavos), total e preço aplicado", () => {
  assert.deepEqual(calcularItem({quantidade:1,precoCentavos:101,descontoTipo:'percentual',descontoValor:50}),
    {brutoCentavos:101,descontoCentavos:51,totalCentavos:50,precoAplicadoCentavos:50},'arredonda o desconto antes de subtrair; prévia e servidor usam o mesmo motor');
  assert.deepEqual(calcularItem({ quantidade: 3, precoCentavos: 10000, descontoTipo: "percentual", descontoValor: 10 }),
    { brutoCentavos: 30000, descontoCentavos: 3000, totalCentavos: 27000, precoAplicadoCentavos: 9000 });
  assert.equal(calcularItem({ quantidade: 3, precoCentavos: 10000, descontoTipo: "valor", descontoValor: 2500 }).totalCentavos, 27500);
  assert.equal(calcularItem({ quantidade: 1, precoCentavos: 1000, descontoTipo: "valor", descontoValor: 5000 }).totalCentavos, 0, "desconto limitado ao bruto");
  assert.equal(calcularItem({ quantidade: 1.5, precoCentavos: 1033, descontoTipo: null, descontoValor: 0 }).brutoCentavos, 1550);
  const totais = calcularTotais([calcularItem({ quantidade: 2, precoCentavos: 5000, descontoTipo: "percentual", descontoValor: 5 }),
    calcularItem({ quantidade: 1, precoCentavos: 1999, descontoTipo: null, descontoValor: 0 })]);
  assert.deepEqual(totais, { brutoCentavos: 11999, descontoCentavos: 500, totalCentavos: 11499 });
});

test("estados: só aceito/erro gera pedido; itens travam depois do aceite", () => {
  assert.equal(proximoEstado("rascunho", "salvar"), "salvo");
  assert.equal(proximoEstado("salvo", "enviar"), "enviado");
  assert.equal(proximoEstado("enviado", "aceitar"), "aceito");
  assert.equal(proximoEstado("salvo", "aceitar"), "aceito");
  assert.equal(proximoEstado("rascunho", "aceitar"), null, "rascunho não é aceito direto");
  assert.equal(proximoEstado("enviado_omie", "cancelar"), null, "pedido já no Omie não se cancela pelo painel");
  assert.equal(proximoEstado("enviado_omie", "reabrir"), null);
  assert.equal(proximoEstado("erro_omie", "reabrir"), "salvo");
  assert.ok(editavel("enviado") && !editavel("aceito") && !editavel("enviado_omie"));
  assert.ok(podeGerarPedido("aceito") && podeGerarPedido("erro_omie") && !podeGerarPedido("enviado") && !podeGerarPedido("enviado_omie"));
  assert.equal(numeroOrcamento(2026, 128), "MAG-Q-2026-00128");
  assert.ok(NUMERO_ORCAMENTO.test("MAG-Q-2026-00128") && !NUMERO_ORCAMENTO.test("MAG-Q-26-1"));
});

test("CPF/CNPJ: dígitos verificadores, formato do Omie e máscara", () => {
  assert.ok(documentoValido("11.222.333/0001-81"));
  assert.ok(documentoValido("529.982.247-25"));
  for (const ruim of ["11.222.333/0001-82", "529.982.247-26", "111.111.111-11", "123", ""]) assert.ok(!documentoValido(ruim), ruim);
  assert.equal(documentoFormatado("11222333000181"), "11.222.333/0001-81");
  assert.equal(documentoFormatado("52998224725"), "529.982.247-25");
  assert.equal(documentoMascarado("11222333000181"), "11…81");
});

const pedidoValido = (extra = {}) => montarPedidoOmie({
  numero: "MAG-Q-2026-00001", codigoClienteOmie: "8800000001", dataPrevisao: "2026-10-20", etapa: "10", codigoParcela: "000",
  categoria: "1.01.01", contaCorrente: "8765103276", codVend: "8766947629", consumidorFinal: true, emailsNf: "compras@cliente.com.br",
  observacoes: "Entrega no térreo.",
  itens: [{ codigoProdutoOmie: "8764749209", quantidade: 2, precoCentavos: 150000, descontoCentavos: 15000 },
    { codigoProdutoOmie: "8764751407", quantidade: 10, precoCentavos: 2550, descontoCentavos: 0 }],
  ...extra,
});

test("pedido do Omie: campos da documentação, formatos e desconto em valor", () => {
  const p = pedidoValido();
  assert.deepEqual(p.cabecalho, { codigo_pedido_integracao: "MAG-Q-2026-00001", codigo_cliente: 8800000001, data_previsao: "20/10/2026", etapa: "10", codigo_parcela: "000", quantidade_itens: 2 });
  assert.deepEqual(p.det[0], { ide: { codigo_item_integracao: "1" }, produto: { codigo_produto: 8764749209, quantidade: 2, valor_unitario: 1500, tipo_desconto: "V", valor_desconto: 150, reservado: "N" } });
  assert.equal(p.det[1].produto.valor_unitario, 25.5);
  assert.deepEqual(p.informacoes_adicionais, { codigo_categoria: "1.01.01", codigo_conta_corrente: 8765103276, consumidor_final: "S", codVend: 8766947629, enviar_email: "N", utilizar_emails: "compras@cliente.com.br" });
  assert.deepEqual(validarPedidoOmie(p, "2026-10-07"), []);
  assert.equal(dataOmie("2026-01-05"), "05/01/2026");
  assert.match(hojeFortaleza(Date.parse("2026-10-08T02:00:00Z")), /^2026-10-07$/, "02:00 UTC ainda é dia 7 em Fortaleza");
});

test("pedido do Omie: tudo que é perigoso ou incompleto é barrado antes de escrever", () => {
  const erros = (p) => validarPedidoOmie(p, "2026-10-07").join(" | ");
  assert.match(erros(pedidoValido({ etapa: "50" })), /etapa não permitida/, "50 = Faturar");
  assert.match(erros(pedidoValido({ etapa: "60" })), /etapa não permitida/);
  assert.match(erros(pedidoValido({ dataPrevisao: "2026-10-06" })), /anterior a hoje/);
  assert.match(erros(pedidoValido({ codigoParcela: "999" })), /condição de pagamento/, "999 exige lista de parcelas");
  assert.match(erros(pedidoValido({ codVend: "" })), /vendedor/);
  assert.match(erros(pedidoValido({ codigoClienteOmie: "abc" })), /cliente/);
  assert.match(erros(pedidoValido({ numero: "QUALQUER" })), /código de integração/);
  assert.match(erros(pedidoValido({ categoria: "" })), /categoria/);
  assert.match(erros(pedidoValido({ contaCorrente: "0" })), /conta corrente/);
  assert.match(erros(pedidoValido({ emailsNf: "não é e-mail" })), /e-mail/);
  assert.match(erros(pedidoValido({ emailsNf: "" })), /e-mail para a nota fiscal obrigatório/, "o Omie exige utilizar_emails");
  assert.equal(mascararEmails("Compras@Cajuina.com.br; fin@x.com"), "c•••@c•••.com.br, f•••@x•••.com");
  assert.equal(mascararEmails(""), "");
  const muitos = Array.from({ length: 200 }, () => ({ codigoProdutoOmie: "1", quantidade: 1, precoCentavos: 100, descontoCentavos: 0 }));
  assert.match(erros(pedidoValido({ itens: muitos })), /1 a 199 itens/);
  assert.match(erros(pedidoValido({ itens: [] })), /1 a 199 itens/);
  assert.match(erros(pedidoValido({ itens: [{ codigoProdutoOmie: "1", quantidade: 1, precoCentavos: 100, descontoCentavos: 500 }] })), /desconto inválido/);
  const forjado = pedidoValido();
  forjado.informacoes_adicionais.enviar_email = "S";
  assert.match(erros(forjado), /e-mail pelo Omie/);
  const reservando = pedidoValido();
  reservando.det[1].produto.reservado = "S";
  assert.match(erros(reservando), /item 2: o painel nunca reserva estoque/);
  assert.ok(!("enviar_pix" in pedidoValido().informacoes_adicionais), "só uma das tags enviar_email/enviar_pix pode ir ao Omie");
  assert.deepEqual(validarPedidoOmie(null), ["estrutura do pedido inválida"]);
});

test("leitura de volta: o que o Omie gravou confere campo a campo com o revisado", () => {
  const p = pedidoValido();
  const gravado = (mudar = (x) => x) => ({ pedido_venda_produto: mudar({
    cabecalho: { ...p.cabecalho, codigo_pedido: 9100, numero_pedido: "1234" },
    det: p.det.map((d) => ({ ...d, produto: { ...d.produto, descricao: "X" } })).reverse(), // ordem diferente: casa pelo item
    informacoes_adicionais: { ...p.informacoes_adicionais },
    total_pedido: { valor_mercadorias: 3255, valor_total_pedido: 3105 },
  }) });
  const ok = conferirPedidoLido(p, gravado());
  assert.deepEqual({ confere: ok.confere, divergencias: ok.divergencias, esperado: ok.esperado }, { confere: true, divergencias: [], esperado: { valorMercadorias: 3255, valorTotal: 3105 } });
  assert.deepEqual(conferirPedidoLido(p, gravado((x) => ({ ...x, informacoes_adicionais: { ...x.informacoes_adicionais, enviar_pix: "N" } }))).divergencias, [],
    "o Omie devolve enviar_pix = N (padrão): confere");
  assert.deepEqual(conferirPedidoLido(p, gravado((x) => ({ ...x, informacoes_adicionais: { ...x.informacoes_adicionais, enviar_pix: "S" } }))).divergencias, ["envio de PIX"]);
  const ruim = conferirPedidoLido(p, gravado((x) => ({ ...x, cabecalho: { ...x.cabecalho, etapa: "20", codigo_parcela: "S01" },
    det: x.det.map((d) => ({ ...d, produto: { ...d.produto, reservado: "S", valor_unitario: d.produto.valor_unitario + 1 } })),
    total_pedido: { valor_mercadorias: 3267, valor_total_pedido: 3162.9 } })));
  assert.deepEqual(ruim.divergencias, ["etapa", "condição de pagamento", "item 1: preço", "item 1: estoque reservado", "item 2: preço", "item 2: estoque reservado",
    "valor das mercadorias", "total do pedido"]);
  assert.deepEqual(conferirPedidoLido(p, {}).confere, false, "resposta vazia nunca 'confere'");
});

test("pedido sem desconto geral/frete: idêntico byte a byte ao de antes (nenhum campo novo vai ao Omie)", () => {
  const sha = (p) => createHash("sha256").update(JSON.stringify(p)).digest("hex");
  // Impressão digital do payload da release 20261008-1624 (antes da conferência e do suporte preparado).
  const ANTES = "4d5872db555a9fb0e470ca2f038e3173f119f7bfb4912e13d0a450f4de4fa297";
  assert.equal(sha(pedidoValido()), ANTES);
  const extras = extrasDoPedido({ descontoGeralCentavos: 5000, freteCentavos: 18000, montagemCentavos: 9000 });
  assert.deepEqual(extras, {}, "política desligada: nada a mais no pedido");
  assert.equal(sha(pedidoValido(extras)), ANTES);
  assert.deepEqual(EXTRAS_NO_PEDIDO, { descontoPedido: false, frete: false, modalidadeFrete: null });
  assert.ok(Object.isFrozen(EXTRAS_NO_PEDIDO));
});

test("desconto geral e frete: preparados e DESLIGADOS (bloqueiam e são recusados); ligados, vão nos campos do Omie; montagem sempre bloqueia", () => {
  const extras = { descontoGeralCentavos: 5000, freteCentavos: 18000, montagemCentavos: 9000 };
  const bloqueios = bloqueiosDeExtras(extras);
  assert.equal(bloqueios.length, 3);
  assert.match(bloqueios[0], /^Desconto geral \(R\$\s50,00\): o suporte está preparado \(vira o desconto na capa do Pedido.*NÃO foi habilitado/);
  assert.match(bloqueios[1], /^Frete \(R\$\s180,00\): o suporte está preparado \(bloco de frete do Omie\).*falta a MAG definir a modalidade/);
  assert.match(bloqueios[2], /^Montagem \(R\$\s90,00\): não vai ao Pedido no Omie até a MAG definir a regra fiscal\/contábil/);
  assert.deepEqual(bloqueiosDeExtras({ descontoGeralCentavos: 0, freteCentavos: 0, montagemCentavos: 0 }), []);
  const ligada = { descontoPedido: true, frete: true, modalidadeFrete: "0" };
  assert.deepEqual(bloqueiosDeExtras(extras, ligada).map((b) => b.split(" (")[0]), ["Montagem"], "montagem continua bloqueando");
  assert.equal(bloqueiosDeExtras({ ...extras, montagemCentavos: 0 }, { ...ligada, modalidadeFrete: null }).length, 1, "frete ligado sem modalidade ainda bloqueia");
  const p = pedidoValido(extrasDoPedido(extras, ligada));
  assert.deepEqual({ tipo: p.cabecalho.tipo_desconto_pedido, valor: p.cabecalho.valor_desconto_pedido, frete: p.frete }, { tipo: "V", valor: 50, frete: { modalidade: "0", valor_frete: 180 } });
  // Desligados: painel e serviço RECUSAM (nunca descartam) o pedido que trouxer desconto na capa ou frete.
  assert.deepEqual(validarPedidoOmie(p, "2026-10-07"), ["desconto geral no pedido ainda não habilitado (regra da MAG pendente)", "frete no pedido ainda não habilitado (falta a MAG definir a modalidade)"]);
  assert.deepEqual(validarPedidoOmie(p, "2026-10-07", ligada), []);
  const forjado = pedidoValido();
  forjado.cabecalho.perc_desconto_pedido = 10;
  assert.match(validarPedidoOmie(forjado, "2026-10-07").join(" | "), /desconto geral no pedido ainda não habilitado/);
  assert.match(validarPedidoOmie(forjado, "2026-10-07", ligada).join(" | "), /desconto do pedido inválido/, "só em valor (V)");
  assert.match(validarPedidoOmie(pedidoValido({ descontoPedidoCentavos: 400_000 }), "2026-10-07", ligada).join(" | "), /desconto do pedido inválido/, "maior que os itens");
  assert.match(validarPedidoOmie(pedidoValido({ frete: { modalidade: "7", valorCentavos: 100 } }), "2026-10-07", ligada).join(" | "), /frete inválido/);
});

const aceitaDe = (extra = {}) => ({
  itens: [{ produtoId: "8764749209", sku: "00003", nome: "ARMARIO ALTO FEC 2 P 30MM ALMERIA", quantidade: 2, precoCentavos: 150000, descontoCentavos: 15000, totalCentavos: 285000 },
    { produtoId: "8764751407", sku: "00471", nome: "A/E PRISMA MR 800 AMARELO", quantidade: 10, precoCentavos: 2550, descontoCentavos: 0, totalCentavos: 25500 }],
  totais: { descontoGeralCentavos: 0, freteCentavos: 0, montagemCentavos: 0, totalCentavos: 310500 },
  condicoes: { pagamentoCodigo: "000", previsao: "2026-10-20" }, ...extra,
});

test("conferência versão aceita × payload do Omie: item a item (SKU, quantidade, preço, desconto, total), gerais e total; qualquer diferença = não confere", () => {
  const skus = { "8764749209": "00003", "8764751407": "00471" };
  const ok = conferirAceitaComPedido(aceitaDe(), pedidoValido(), skus);
  assert.equal(ok.confere, true, ok.divergencias.join(" | "));
  assert.deepEqual([ok.totalAceitoCentavos, ok.totalOmieCentavos, ok.diferencaCentavos], [310500, 310500, 0]);
  assert.deepEqual(ok.itens.map((l) => [l.item, l.sku, l.skuOmie, l.omie.produtoId, l.omie.totalCentavos, l.diferencas.length]),
    [[1, "00003", "00003", "8764749209", 285000, 0], [2, "00471", "00471", "8764751407", 25500, 0]]);
  // Desconto geral, frete e montagem sempre à vista, inclusive zerados (R$ 0,00 ✓).
  assert.deepEqual(ok.gerais.map((g) => [g.campo, g.aceito, g.omie, g.confere]), [["Condição de pagamento", "000", "000", true], ["Previsão de faturamento", "20/10/2026", "20/10/2026", true],
    ["Desconto geral", reais(0), reais(0), true], ["Frete", reais(0), reais(0), true], ["Montagem", reais(0), reais(0), true]]);
  assert.deepEqual(ok.itens.map((l) => l.nome), ["ARMARIO ALTO FEC 2 P 30MM ALMERIA", "A/E PRISMA MR 800 AMARELO"]);
  assert.equal(conferirAceitaComPedido(aceitaDe(), pedidoValido()).itens[0].skuOmie, null, "sem a consulta de estoque o SKU fica 'não conferido no Omie' (o código do produto, sim)");
  // Cada diferença no payload é apontada e impede o envio.
  const mexer = (f) => { const p = pedidoValido(); f(p); return conferirAceitaComPedido(aceitaDe(), p, skus); };
  const preco = mexer((p) => { p.det[0].produto.valor_unitario = 1500.01; });
  assert.deepEqual([preco.confere, preco.itens[0].diferencas, preco.diferencaCentavos], [false, ["preço", "total"], 2]);
  assert.match(preco.divergencias.join(" | "), /item 1 \(SKU 00003\): preço — aceito R\$\s1\.500,00, Omie R\$\s1\.500,01/);
  assert.match(preco.divergencias.join(" | "), /total: aceito R\$\s3\.105,00, Omie R\$\s3\.105,02 \(diferença R\$\s0,02\)/);
  assert.deepEqual(mexer((p) => { p.det[1].produto.quantidade = 11; }).itens[1].diferencas, ["quantidade", "total"]);
  assert.deepEqual(mexer((p) => { p.det[0].produto.valor_desconto = 149; }).itens[0].diferencas, ["desconto", "total"]);
  assert.deepEqual(mexer((p) => { p.det[0].produto.tipo_desconto = "P"; }).itens[0].diferencas, ["desconto"]);
  assert.deepEqual(mexer((p) => { p.det[1].produto.codigo_produto = 8764751408; }).itens[1].diferencas, ["produto"]);
  assert.match(mexer((p) => { p.det.pop(); }).divergencias.join(" | "), /item 2 \(SKU 00471\): está na proposta aceita e não no Pedido/);
  assert.match(mexer((p) => { p.det.push(structuredClone(p.det[0])); }).divergencias.join(" | "), /item 3: está no Pedido e não na proposta aceita/);
  assert.match(mexer((p) => { p.cabecalho.codigo_parcela = "S01"; }).divergencias.join(" | "), /Condição de pagamento: aceito 000, Omie S01/);
  assert.match(mexer((p) => { p.cabecalho.data_previsao = "21/10/2026"; }).divergencias.join(" | "), /Previsão de faturamento: aceito 20\/10\/2026, Omie 21\/10\/2026/);
  const skuTrocado = conferirAceitaComPedido(aceitaDe(), pedidoValido(), { ...skus, "8764751407": "00999" });
  assert.deepEqual([skuTrocado.confere, skuTrocado.itens[1].diferencas], [false, ["SKU"]]);
  assert.match(skuTrocado.divergencias[0], /item 2 \(SKU 00471\): SKU — aceito 00471, Omie 00999/);
  // Frete na versão aceita com a política desligada: o pedido sairia sem ele → total diferente → não confere.
  const comFrete = conferirAceitaComPedido(aceitaDe({ totais: { descontoGeralCentavos: 0, freteCentavos: 18000, montagemCentavos: 0, totalCentavos: 328500 } }), pedidoValido(), skus);
  assert.deepEqual([comFrete.confere, comFrete.diferencaCentavos], [false, -18000]);
  assert.deepEqual(comFrete.gerais.find((g) => g.campo === "Frete"), { campo: "Frete", aceito: reais(18000), omie: reais(0), confere: false });
  const montagem = conferirAceitaComPedido(aceitaDe({ totais: { descontoGeralCentavos: 0, freteCentavos: 0, montagemCentavos: 9000, totalCentavos: 319500 } }), pedidoValido(), skus);
  assert.deepEqual(montagem.gerais.find((g) => g.campo === "Montagem"), { campo: "Montagem", aceito: reais(9000), omie: "não vai ao Omie", confere: false });
  // Futuro (política ligada): desconto na capa e frete entram no total do Omie e a conferência fecha.
  const ligada = { descontoPedido: true, frete: true, modalidadeFrete: "0" };
  const extras = { descontoGeralCentavos: 5000, freteCentavos: 18000, montagemCentavos: 0 };
  const futura = conferirAceitaComPedido(aceitaDe({ totais: { ...extras, totalCentavos: 310500 - 5000 + 18000 } }), pedidoValido(extrasDoPedido(extras, ligada)), skus);
  assert.equal(futura.confere, true, futura.divergencias.join(" | "));
  assert.deepEqual(futura.gerais.slice(2).map((g) => [g.campo, g.confere]), [["Desconto geral", true], ["Frete", true], ["Montagem", true]]);
  assert.equal(futura.totalOmieCentavos, 323500);
});

test("leitura de volta com desconto na capa e frete (preparado): o Omie distribui o desconto nos itens — confere a soma; frete no total", () => {
  const ligada = { descontoPedido: true, frete: true, modalidadeFrete: "0" };
  const p = pedidoValido(extrasDoPedido({ descontoGeralCentavos: 5000, freteCentavos: 18000, montagemCentavos: 0 }, ligada));
  // Os R$ 50,00 distribuídos proporcionalmente: 2.850,00 → +45,90 e 255,00 → +4,10 (soma exata).
  const lido = (frete = { modalidade: "0", valor_frete: 180 }, total = 3235) => ({ pedido_venda_produto: {
    cabecalho: { ...p.cabecalho }, informacoes_adicionais: { ...p.informacoes_adicionais }, frete,
    det: [{ ...p.det[0], produto: { ...p.det[0].produto, valor_desconto: 195.9 } }, { ...p.det[1], produto: { ...p.det[1].produto, valor_desconto: 4.1 } }],
    total_pedido: { valor_mercadorias: 3255, valor_total_pedido: total },
  } });
  const ok = conferirPedidoLido(p, lido());
  assert.deepEqual({ confere: ok.confere, divergencias: ok.divergencias, esperado: ok.esperado }, { confere: true, divergencias: [], esperado: { valorMercadorias: 3255, valorTotal: 3235 } });
  assert.deepEqual(conferirPedidoLido(p, lido({ modalidade: "9", valor_frete: 0 }, 3055)).divergencias, ["modalidade do frete", "frete", "total do pedido"]);
});

test("conta corrente da venda: sugestão MAG só como dica (CNPJ/depósito → Bradesco); nunca escolhe sozinha; Bradesco e Stone primeiro", () => {
  const contas = [{ codigo: "8783218929", descricao: "American - Cielo" }, { codigo: "8765103276", descricao: "Bradesco Mag Filial" },
    { codigo: "8765116216", descricao: "Stone Mag Filial" }, { codigo: "8765096606", descricao: "Caixinha Loja BR" }];
  assert.deepEqual(sugestaoDeConta({ documento: "06.942.221/0001-65", condicao: "A Vista" }, contas), { codigo: "8765103276", descricao: "Bradesco Mag Filial", motivo: "cliente com CNPJ" });
  assert.deepEqual(sugestaoDeConta({ documento: "", condicao: "Depósito bancário" }, contas)?.motivo, "pagamento por depósito");
  assert.equal(sugestaoDeConta({ documento: "529.982.247-25", condicao: "A Vista" }, contas), null, "CPF sem depósito: sem dica automática (sem limite de valor definido pela MAG)");
  assert.equal(sugestaoDeConta({ documento: "06.942.221/0001-65", condicao: "" }, contas.filter((c) => !/Bradesco/.test(c.descricao))), null, "sem conta Bradesco única: sem dica");
  const grupos = contasDaVenda(contas);
  assert.deepEqual([grupos.principais.map((c) => c.descricao), grupos.outras.length], [["Bradesco Mag Filial", "Stone Mag Filial"], 2]);
  assert.match(REGRA_CONTA, /vendas maiores, cliente com CNPJ ou pagamento por depósito → Bradesco; vendas menores → Stone/);
});
