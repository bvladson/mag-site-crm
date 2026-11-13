// Omie SIMULADO para os testes (sem rede): guarda pedidos e clientes incluídos, como o Omie de verdade faria.
// Usado por tests/omie-pedidos.test.mjs e tests/omie-conversao.test.mjs. Não é um teste (sem ".test" no nome).
export const LOCAIS = [
  { codigo_local_estoque: 101, codigo: "GALPAO", descricao: "ESTOQUE BR 116", inativo: "N", padrao: "S", dispVenda: "S" },
  { codigo_local_estoque: 106, codigo: "LICIT", descricao: "LICITAÇÃO", inativo: "N", padrao: "N", dispVenda: "S" },
];
export const NAO_COMERCIAIS = ["avaria", "licitacao", "importacao"];
export const VENDEDORES = [
  { codigo: 8766947629, codInt: "", nome: "VLADSON", email: "", inativo: "N", fatura_pedido: "N", visualiza_pedido: "N", comissao: 3 },
  { codigo: 8766948065, codInt: "X", nome: "SAMANTHA GABRIEL - VAREJO", email: "Sam@Mag.com.br", inativo: "S", fatura_pedido: "N", visualiza_pedido: "N", comissao: 5 },
  { codigo: 8788268737, codInt: "", nome: "SAMANTHA ROCHA", email: "", inativo: "N", fatura_pedido: "N", visualiza_pedido: "N", comissao: 5 },
];
export const CLIENTE_EXISTENTE = { codigo_cliente_omie: 5551, codigo_cliente_integracao: "", razao_social: "CLIENTE TESTE LTDA", nome_fantasia: "TESTE", cnpj_cpf: "11.222.333/0001-81", inativo: "N", cidade: "FORTALEZA (CE)", estado: "CE", email: "segredo@cliente.com", telefone1_numero: "99999-0000", endereco: "RUA X" };

/**
 * Opções (mutáveis durante o teste): perderRespostaDaInclusao (o Omie grava e a resposta se perde), falhaInclusao (texto
 * do erro do Omie), fora (Omie inteiro fora do ar), vendedores (lista devolvida), estoque (saldo por produto no local padrão),
 * skus (SKU — cCodigo — que a posição de estoque devolve por código de produto).
 * Como o Omie de verdade, a MESMA consulta (método + parâmetros) repetida em menos de 60 s pelo `relogio` é recusada como
 * redundante — e a recusa prorroga a janela. `redundantes()` conta as recusas (0 = o serviço respeitou a regra).
 */
export function omieSimulado({ relogio = () => Date.now(), ...opcoes } = {}) {
  const estado = { perderRespostaDaInclusao: false, falhaInclusao: null, fora: false, vendedores: VENDEDORES, estoque: {}, skus: {}, ipiNoTotal: 0, ...opcoes };
  // Totais como o Omie devolve no ConsultarPedido (ipiNoTotal simula imposto somado pelo Omie ao total).
  const totais = (payload) => {
    const det = Array.isArray(payload?.det) ? payload.det : [];
    const merc = det.reduce((s, d) => s + Math.round((Number(d?.produto?.quantidade) || 0) * (Number(d?.produto?.valor_unitario) || 0) * 100), 0);
    const desc = det.reduce((s, d) => s + Math.round((Number(d?.produto?.valor_desconto) || 0) * 100), 0);
    return { valor_mercadorias: merc / 100, valor_descontos: desc / 100, valor_total_pedido: Math.round(merc - desc + (estado.ipiNoTotal || 0) * 100) / 100 };
  };
  const chamadas = []; const pedidos = new Map(); const clientes = new Map([[String(CLIENTE_EXISTENTE.codigo_cliente_omie), CLIENTE_EXISTENTE]]);
  const recentes = new Map(); let redundantes = 0;
  const json = (corpo, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
  const fault = (texto) => json({ faultstring: texto, faultcode: "SOAP-ENV:Client-1" }, 500);
  const clientePorIntegracao = (codigo) => [...clientes.values()].find((c) => c.codigo_cliente_integracao === codigo);
  const fetchImpl = async (url, init) => {
    const corpo = JSON.parse(init.body); const p = corpo.param[0];
    chamadas.push({ url, call: corpo.call, param: p, chaves: [corpo.app_key, corpo.app_secret] });
    if (estado.fora) throw new TypeError("fetch failed");
    if (!corpo.call.startsWith("Incluir")) {
      const chave = `${corpo.call}|${JSON.stringify(p)}`;
      const antes = recentes.get(chave);
      recentes.set(chave, relogio());
      if (antes !== undefined && relogio() - antes < 60_000) { redundantes += 1; return fault("ERROR: A requisição já foi realizada. Aguarde 60 segundos para repetir a consulta."); }
    }
    switch (corpo.call) {
      case "ListarVendedores": return json({ pagina: p.pagina, total_de_paginas: 1, registros: estado.vendedores.length, total_de_registros: estado.vendedores.length, cadastro: estado.vendedores });
      case "ListarEtapasFaturamento": return json({ pagina: 1, total_de_paginas: 1, cadastros: [{}, { cCodOperacao: "11", cDescOperacao: "Venda de Produto", etapas: [
        { cCodigo: "00", cDescricao: "", cDescrPadrao: "Proposta", cInativo: "S" }, { cCodigo: "10", cDescricao: "Orçamento - PD", cDescrPadrao: "Pedido de Venda", cInativo: "N" },
        { cCodigo: "20", cDescricao: "Pedidos Varejo", cDescrPadrao: "Separar Estoque", cInativo: "N" }, { cCodigo: "50", cDescricao: "Para Faturar", cDescrPadrao: "Faturar", cInativo: "N" }] },
        { cCodOperacao: "01", cDescOperacao: "Venda de Serviço", etapas: [{ cCodigo: "10", cDescricao: "Ordem de Serviço", cDescrPadrao: "Ordem de Serviço", cInativo: "N" }] }] });
      case "ListarFormasPagVendas": return json({ pagina: 1, total_de_paginas: 1, cadastros: [{ cCodigo: "000", cDescricao: "A Vista", nQtdeParc: 1 }, { cCodigo: "S01", cDescricao: "30/60", nQtdeParc: 2 }, { cCodigo: "999", cDescricao: "Informar o número de parcelas", nQtdeParc: 999 }] });
      case "ListarCategorias": return json({ pagina: 1, total_de_paginas: 1, categoria_cadastro: [{ codigo: "1.01", descricao: "Receitas", totalizadora: "S", conta_inativa: "N" }, { codigo: "1.01.01", descricao: "Clientes - Venda varejo e corporativo", totalizadora: "N", conta_inativa: "N" }] });
      case "ListarContasCorrentes": return json({ pagina: 1, total_de_paginas: 1, ListarContasCorrentes: [{ nCodCC: 8765103276, descricao: "Bradesco Mag Filial", tipo_conta_corrente: "CC", inativo: "N", numero_conta_corrente: "12345-6", saldo_inicial: 999999, codigo_agencia: "0001" }] });
      case "ListarClientes": {
        const lista = [...clientes.values()].filter((c) => p.clientesFiltro?.cnpj_cpf ? c.cnpj_cpf === p.clientesFiltro.cnpj_cpf : String(c.razao_social).includes(String(p.clientesFiltro?.razao_social ?? "").toUpperCase()));
        return lista.length ? json({ pagina: 1, total_de_paginas: 1, clientes_cadastro: lista }) : fault("ERROR: Não existem registros para a página [1]!");
      }
      case "ConsultarCliente": {
        const c = p.codigo_cliente_integracao ? clientePorIntegracao(p.codigo_cliente_integracao) : clientes.get(String(p.codigo_cliente_omie));
        return c ? json(c) : fault("ERROR: Cliente não cadastrado!");
      }
      case "IncluirCliente": {
        const registro = { codigo_cliente_omie: 7000 + clientes.size, codigo_cliente_integracao: p.codigo_cliente_integracao, razao_social: p.razao_social, nome_fantasia: p.nome_fantasia, cnpj_cpf: p.cnpj_cpf, inativo: "N", cidade: "", estado: "" };
        clientes.set(String(registro.codigo_cliente_omie), registro);
        return json({ codigo_cliente_omie: registro.codigo_cliente_omie, codigo_cliente_integracao: p.codigo_cliente_integracao, codigo_status: "0", descricao_status: "Cliente cadastrado com sucesso!" });
      }
      case "ConsultarPedido": {
        const r = p.codigo_pedido ? [...pedidos.values()].find((x) => x.codigo === p.codigo_pedido) : pedidos.get(p.codigo_pedido_integracao);
        return r ? json({ pedido_venda_produto: { cabecalho: { codigo_pedido: r.codigo, numero_pedido: r.numero, etapa: r.payload.cabecalho.etapa, codigo_cliente: r.payload.cabecalho.codigo_cliente,
          codigo_parcela: r.payload.cabecalho.codigo_parcela }, det: r.payload.det ?? [], informacoes_adicionais: r.payload.informacoes_adicionais ?? {},
          total_pedido: totais(r.payload), infoCadastro: { cancelado: "N", faturado: "N" } } })
          : fault(`ERROR: Pedido não cadastrado para o Código de Integração [${p.codigo_pedido_integracao}] !`);
      }
      case "StatusPedido": {
        const r = [...pedidos.values()].find((x) => x.codigo === p.codigo_pedido);
        return r ? json({ codigo_pedido: r.codigo, numero_pedido: r.numero, etapa: "20", cancelada: "N", faturada: "N", valor_total_pedido: r.total }) : fault("ERROR: Pedido não encontrado");
      }
      case "IncluirPedido": {
        if (estado.falhaInclusao) return fault(estado.falhaInclusao);
        const total = p.det.reduce((soma, d) => soma + d.produto.quantidade * d.produto.valor_unitario - d.produto.valor_desconto, 0);
        const registro = { codigo: 9100 + pedidos.size, numero: String(1234 + pedidos.size), payload: p, total: Math.round(total * 100) / 100 };
        pedidos.set(p.cabecalho.codigo_pedido_integracao, registro); // gravou...
        if (estado.perderRespostaDaInclusao) { estado.perderRespostaDaInclusao = false; throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); } // ...mas a resposta se perdeu
        return json({ codigo_pedido: registro.codigo, codigo_pedido_integracao: p.cabecalho.codigo_pedido_integracao, numero_pedido: registro.numero, codigo_status: "0", descricao_status: "Pedido cadastrado com sucesso!" });
      }
      case "ListarLocaisEstoque": return json({ locaisEncontrados: LOCAIS });
      case "ListarPosEstoque": {
        // cCodigo = SKU do produto (como o Omie devolve); `skus` define por código de produto.
        const sku = (id) => (estado.skus[String(id)] ? { cCodigo: estado.skus[String(id)] } : {});
        const linhas = p.lista_produtos.flatMap(({ nCodProd }) => [
          { nCodProd, ...sku(nCodProd), codigo_local_estoque: 101, nSaldo: estado.estoque[String(nCodProd)] ?? 3, fisico: estado.estoque[String(nCodProd)] ?? 3, nPendente: 1, reservado: 0 },
          { nCodProd, ...sku(nCodProd), codigo_local_estoque: 106, nSaldo: 490, fisico: 490, nPendente: 0, reservado: 0 }]);
        const pagina = p.nPagina; const porPagina = 4;
        return json({ nPagina: pagina, nTotPaginas: Math.ceil(linhas.length / porPagina), produtos: linhas.slice((pagina - 1) * porPagina, pagina * porPagina) });
      }
      default: return fault("ERROR: método não simulado");
    }
  };
  return { estado, chamadas, pedidos, clientes, fetchImpl, metodos: () => chamadas.map((c) => c.call), inclusoes: () => chamadas.filter((c) => c.call === "IncluirPedido").length,
    redundantes: () => redundantes };
}
