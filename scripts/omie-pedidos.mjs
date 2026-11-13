#!/usr/bin/env node
/**
 * Projeto mag-site — serviço interno OMIE-PEDIDOS: conversão de orçamento interno aceito em Pedido de Venda no Omie.
 * É o ÚNICO componente que pode ESCREVER no Omie, e só com OMIE_ORDER_WRITE_ENABLED=true. Com false (padrão) valida
 * tudo e responde "simulado" sem chamar o Omie. Sem porta pública: só o site o chama (http://omie-pedidos:3200, token
 * OMIE_PEDIDOS_TOKEN). O omie-consulta (estoque da Consulta rápida) continua separado e somente leitura.
 * Lista fechada de métodos. Leitura: ListarVendedores, ListarEtapasFaturamento, ListarFormasPagVendas, ListarCategorias,
 * ListarContasCorrentes, ListarClientes, ConsultarCliente, ConsultarPedido, StatusPedido, ListarLocaisEstoque,
 * ListarPosEstoque. Escrita: IncluirCliente e IncluirPedido — nunca faturar, excluir, alterar, cancelar ou mexer em estoque.
 * Idempotência: antes de incluir, consulta pelo código de integração (o pedido/cliente existente é devolvido, nada é
 * incluído de novo — e um pedido com o nosso código mas de outro cliente/itens é CONFLITO, nunca vínculo); tempo
 * esgotado, erro de servidor ou "requisição redundante" numa escrita = resultado INCERTO.
 * Regra do Omie: a mesma consulta (método + parâmetros) só traz dados 1 vez a cada 60 s e repetir prorroga o bloqueio;
 * 10 requisições com erro no mesmo método bloqueiam 30 min (425). Por isso cada resposta de leitura vale 65 s aqui, a
 * mesma consulta não é refeita antes disso e, depois de incluir, a confirmação usa o código do Omie (outro parâmetro).
 * Logs: só rota, método, resultado e duração — nunca payload, documento, nome, e-mail ou chave.
 */
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { configFromEnv, describeLocations } from "./sync-omie.mjs";
import { montarLocais, resumoEstoque } from "./omie-consulta.mjs";
import { validarPedidoOmie, documentoValido, documentoFormatado, digitos, hojeFortaleza, ETAPAS_PERMITIDAS, resumoDoPedido, pedidoConfere, conferirPedidoLido } from "../src/lib/orcamento-regras.ts";

const MINUTO = 60000;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const normalize = (value) => String(value ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const limpo = (valor, max) => String(valor ?? "").replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const sim = (valor) => String(valor ?? "").trim().toUpperCase() === "S";
const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;

export class Falha extends Error {
  constructor(motivo, { pausaMs = 0, mensagem = "", segundos = 0, codigo = "" } = {}) {
    super(motivo); this.motivo = motivo; this.pausaMs = pausaMs; this.mensagem = mensagem; this.segundos = segundos; this.codigo = codigo;
  }
}

/** Mensagem do Omie para a TELA (nunca para log): sem documento, e-mail, telefone ou chave. */
export function mensagemSegura(texto, segredos = []) {
  let saida = String(texto ?? "");
  for (const segredo of segredos) if (segredo) saida = saida.split(segredo).join("[chave]");
  return saida
    .replace(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g, "[documento]").replace(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g, "[documento]")
    // Telefone só no formato com parênteses ou hífen: códigos de produto do Omie (10 dígitos seguidos) continuam legíveis.
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[e-mail]").replace(/\(\d{2}\)\s?9?\d{4}-?\d{4}/g, "[telefone]").replace(/\b9?\d{4}-\d{4}\b/g, "[telefone]")
    .replace(/\s+/g, " ").trim().slice(0, 300);
}

export function criarIntegracao(config, { fetchImpl = fetch, now = () => Date.now(), sleepImpl = sleep } = {}) {
  const base = config.apiUrl.replace(/\/?$/, "/");
  let fila = Promise.resolve();
  let ultimaChamada = 0;
  let pausadoAte = 0;
  const chamadas = [];
  let locais = null;
  // Janela de repetição do Omie: cada resposta de LEITURA (inclusive "não encontrado") vale 65 s; a mesma consulta sem
  // resposta guardada (ex.: depois de uma inclusão ou de uma falha) espera a janela em vez de ir ao Omie.
  const repetirMs = config.repetirMs ?? 65000;
  const guardadas = new Map(); // chave → { em, corpo } ou { em, naoEncontrado: true }
  const ultimaReal = new Map(); // chave → instante da última chamada real ao Omie com essa chave
  const instanteDe = new WeakMap(); // corpo devolvido → instante em que o Omie respondeu
  const pedidosCriados = new Map(); // código de integração → pedido criado por este serviço
  const clientesCriados = new Map(); // código de integração → código do cliente criado por este serviço
  const chaveDe = (endpoint, call, param) => `${endpoint}|${call}|${JSON.stringify(param)}`;
  const devolver = (corpo, em) => { const copia = structuredClone(corpo); instanteDe.set(copia, em); return copia; };
  const lembrar = (mapa, chave, valor) => { mapa.set(chave, valor); if (mapa.size > 1000) mapa.delete(mapa.keys().next().value); };

  /** Uma chamada por vez, na ordem de chegada, com intervalo mínimo, teto por hora e a janela de repetição do Omie. */
  function chamar(endpoint, call, param, { escrita = false, timeoutMs = config.timeoutMs } = {}) {
    const chave = escrita ? null : chaveDe(endpoint, call, param);
    const execucao = fila.then(async () => {
      for (const [k, v] of guardadas) if (now() - v.em >= repetirMs) guardadas.delete(k);
      for (const [k, t] of ultimaReal) if (now() - t >= repetirMs) ultimaReal.delete(k);
      if (chave) {
        const guardada = guardadas.get(chave);
        if (guardada?.naoEncontrado) throw new Falha("nao_encontrado");
        if (guardada) return devolver(guardada.corpo, guardada.em);
        if (ultimaReal.has(chave)) throw new Falha("repetir_em", { segundos: Math.max(1, Math.ceil((repetirMs - (now() - ultimaReal.get(chave))) / 1000)) });
      }
      if (now() < pausadoAte) throw new Falha("pausado");
      while (chamadas.length && now() - chamadas[0] > 60 * MINUTO) chamadas.shift();
      if (chamadas.length >= config.tetoHora) throw new Falha("teto_horario");
      const espera = config.intervaloMs - (now() - ultimaChamada);
      if (espera > 0) await sleepImpl(espera);
      ultimaChamada = now();
      chamadas.push(ultimaChamada);
      if (chave) ultimaReal.set(chave, ultimaChamada);
      let response;
      try {
        response = await fetchImpl(`${base}${endpoint}/`, {
          method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ call, app_key: config.appKey, app_secret: config.appSecret, param: [param] }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        // Numa escrita, não dá para saber se o Omie gravou antes de a conexão cair.
        throw new Falha(escrita ? "incerto" : "indisponivel");
      }
      if (response.status === 425) { pausadoAte = Math.max(pausadoAte, now() + 30 * MINUTO); throw new Falha("bloqueado"); }
      let body = null;
      try { body = await response.json(); } catch { body = null; }
      if (body?.faultstring || body?.faultcode) {
        const fault = normalize(body.faultstring);
        // Só o código do erro do Omie (ex.: SOAP-ENV:Client-5113) vai para o log, para saber qual regra disparou.
        const codigo = String(body.faultcode ?? "").replace(/[^A-Za-z0-9:_.-]/g, "").slice(0, 40);
        if (/nao existem registros|nenhum registro|nao cadastrad|nao encontrad|nao localizad|nao existe/.test(fault)) {
          if (chave) guardadas.set(chave, { em: ultimaChamada, naoEncontrado: true });
          throw new Falha("nao_encontrado", { codigo });
        }
        if (/redundant|ja foi realizad/.test(fault)) {
          // Escrita: a requisição igual anterior pode ter gravado (incerto). Leitura: só esta consulta espera a janela (sem
          // pausar as outras) e não é refeita antes de 65 s — repetir dentro da janela prorrogaria o bloqueio.
          if (escrita) { pausadoAte = Math.max(pausadoAte, now() + 2 * MINUTO); throw new Falha("incerto", { codigo }); }
          throw new Falha("repetir_em", { segundos: Math.ceil(repetirMs / 1000), codigo });
        }
        if (/too many|limite|consumo|aguard|60 segundo/.test(fault)) { pausadoAte = Math.max(pausadoAte, now() + 2 * MINUTO); throw new Falha("limite", { codigo }); }
        if (/app_key|app_secret|chave de acesso|nao autorizad|invalid.*key/.test(fault)) { pausadoAte = Math.max(pausadoAte, now() + 30 * MINUTO); throw new Falha("credenciais", { codigo }); }
        throw new Falha("omie_recusou", { mensagem: mensagemSegura(body.faultstring, [config.appKey, config.appSecret]), codigo });
      }
      if (!response.ok || !body || typeof body !== "object" || Array.isArray(body)) throw new Falha(escrita ? "incerto" : "indisponivel");
      if (!chave) return body;
      guardadas.set(chave, { em: ultimaChamada, corpo: body });
      return devolver(body, ultimaChamada);
    });
    fila = execucao.catch(() => {});
    return execucao;
  }

  async function todasAsPaginas(endpoint, call, params, chaveLista, { porPagina = 50, maxPaginas = 40 } = {}) {
    const linhas = [];
    for (let pagina = 1; pagina <= maxPaginas; pagina += 1) {
      let corpo;
      try { corpo = await chamar(endpoint, call, { ...params, pagina, registros_por_pagina: porPagina }); } catch (error) {
        if (pagina === 1 && error instanceof Falha && error.motivo === "nao_encontrado") return [];
        throw error;
      }
      linhas.push(...(Array.isArray(corpo[chaveLista]) ? corpo[chaveLista] : []));
      if (!(Number(corpo.total_de_paginas) > pagina)) return linhas;
    }
    throw new Falha("paginacao");
  }

  const cliente = (c) => ({
    codigo: String(c?.codigo_cliente_omie ?? ""), razaoSocial: limpo(c?.razao_social, 100), nomeFantasia: limpo(c?.nome_fantasia, 100),
    documento: digitos(c?.cnpj_cpf), inativo: sim(c?.inativo), cidade: limpo(c?.cidade, 60), estado: limpo(c?.estado, 2),
  });
  const pedido = (corpo) => {
    const p = corpo?.pedido_venda_produto ?? corpo ?? {};
    const cab = p.cabecalho ?? {};
    const info = p.infoCadastro ?? {};
    return {
      codigoPedido: String(cab.codigo_pedido ?? p.codigo_pedido ?? ""), numeroPedido: limpo(cab.numero_pedido ?? p.numero_pedido, 15),
      etapa: limpo(cab.etapa ?? p.etapa, 2), cancelado: sim(info.cancelado ?? p.cancelada), faturado: sim(info.faturado ?? p.faturada),
      // Para conferir se um pedido achado pelo código de integração é mesmo o deste orçamento (só códigos e quantidades).
      codigoCliente: String(cab.codigo_cliente ?? p.codigo_cliente ?? ""),
      itens: (Array.isArray(p.det) ? p.det : []).map((d) => ({ produto: String(d?.produto?.codigo_produto ?? ""), quantidade: Number(d?.produto?.quantidade ?? 0) })),
    };
  };

  const leitura = {
    async vendedores() {
      const lista = await todasAsPaginas("geral/vendedores", "ListarVendedores", {}, "cadastro");
      return lista.filter((v) => finite(v?.codigo)).map((v) => ({
        codigo: String(v.codigo), codInt: limpo(v.codInt, 30), nome: limpo(v.nome, 70), email: limpo(v.email, 100).toLowerCase(),
        inativo: sim(v.inativo), faturaPedido: sim(v.fatura_pedido), visualizaPedido: sim(v.visualiza_pedido),
      }));
    },
    async etapas() {
      const corpo = await chamar("produtos/etapafat", "ListarEtapasFaturamento", { pagina: 1, registros_por_pagina: 50 });
      return (Array.isArray(corpo.cadastros) ? corpo.cadastros : []).filter((op) => op?.cCodOperacao).flatMap((op) =>
        (Array.isArray(op.etapas) ? op.etapas : []).map((e) => ({
          operacao: limpo(op.cCodOperacao, 2), operacaoDescricao: limpo(op.cDescOperacao, 30), codigo: limpo(e.cCodigo, 2),
          descricao: limpo(e.cDescricao, 30), descricaoPadrao: limpo(e.cDescrPadrao, 30), inativo: sim(e.cInativo),
        })));
    },
    async formasPagamento() {
      const lista = await todasAsPaginas("produtos/formaspagvendas", "ListarFormasPagVendas", {}, "cadastros");
      return lista.map((f) => ({ codigo: limpo(f.cCodigo ?? f.nCodigo, 3), descricao: limpo(f.cDescricao, 40), parcelas: finite(f.nQtdeParc) ?? 0 }))
        .filter((f) => f.codigo);
    },
    async categorias() {
      const lista = await todasAsPaginas("geral/categorias", "ListarCategorias", { filtrar_por_tipo: "R", filtrar_apenas_ativo: "S" }, "categoria_cadastro");
      return lista.filter((c) => c?.codigo).map((c) => ({
        codigo: limpo(c.codigo, 20), descricao: limpo(c.descricao, 60), totalizadora: sim(c.totalizadora), inativa: sim(c.conta_inativa),
      }));
    },
    async contas() {
      const lista = await todasAsPaginas("geral/contacorrente", "ListarContasCorrentes", { filtrar_apenas_ativo: "S" }, "ListarContasCorrentes");
      // Só código, nome, tipo e situação: número de conta, agência e saldo nunca saem do Omie por aqui.
      return lista.filter((c) => finite(c?.nCodCC)).map((c) => ({ codigo: String(c.nCodCC), descricao: limpo(c.descricao, 60), tipo: limpo(c.tipo_conta_corrente, 2), inativo: sim(c.inativo) }));
    },
    async clientesPorDocumento(documento) {
      const lista = await todasAsPaginas("geral/clientes", "ListarClientes", { apenas_importado_api: "N", clientesFiltro: { cnpj_cpf: documentoFormatado(documento) } }, "clientes_cadastro", { maxPaginas: 2 });
      return lista.map(cliente).filter((c) => c.codigo && c.documento === digitos(documento));
    },
    async clientesPorNome(nome) {
      // Só a 1ª página (20): o filtro do Omie é "contém", então nomes comuns trazem muitos clientes — a tela mostra os 20
      // primeiros e pede para refinar (nunca baixa a base inteira).
      let corpo;
      try {
        corpo = await chamar("geral/clientes", "ListarClientes", { apenas_importado_api: "N", clientesFiltro: { razao_social: nome }, pagina: 1, registros_por_pagina: 20 });
      } catch (error) {
        if (error instanceof Falha && error.motivo === "nao_encontrado") return { clientes: [], mais: false };
        throw error;
      }
      // O Omie pode devolver mais que os 20 pedidos (visto em produção: 100 registros numa "página de 20"): o corte é aqui.
      const lista = (Array.isArray(corpo.clientes_cadastro) ? corpo.clientes_cadastro : []).map(cliente).filter((c) => c.codigo);
      return { clientes: lista.slice(0, 20), mais: lista.length > 20 || Number(corpo.total_de_paginas) > 1 };
    },
    async cliente(codigo) {
      // Só esta consulta (um cliente, para o servidor do site) traz o e-mail do cadastro: vira o e-mail da NF quando o
      // operador pede. Nunca vai para o log nem, sem máscara, para o navegador. Listas e buscas não trazem e-mail.
      const c = await chamar("geral/clientes", "ConsultarCliente", { codigo_cliente_omie: Number(codigo) });
      return { ...cliente(c), email: limpo(c?.email, 300).toLowerCase() };
    },
    async clientePorIntegracao(codigoIntegracao) {
      return cliente(await chamar("geral/clientes", "ConsultarCliente", { codigo_cliente_integracao: codigoIntegracao }));
    },
    async pedidoPorIntegracao(codigoIntegracao) {
      // Criado por este serviço (o IncluirPedido respondeu): já se sabe que existe, sem consultar o Omie de novo.
      const criado = pedidosCriados.get(codigoIntegracao);
      if (criado) return structuredClone(criado);
      return pedido(await chamar("produtos/pedido", "ConsultarPedido", { codigo_pedido_integracao: codigoIntegracao }));
    },
    async statusPedido(codigoPedido) {
      const corpo = await chamar("produtos/pedido", "StatusPedido", { codigo_pedido: Number(codigoPedido) });
      return { ...pedido(corpo), valorTotal: finite(corpo.valor_total_pedido) };
    },
  };

  /** Estoque de vários produtos (mesma regra do catálogo e da Consulta rápida), em lotes, para a revisão do pedido. */
  async function estoque(produtos) {
    // 49 por página (≠ dos 50 do omie-consulta e da sincronização): nunca a mesma requisição de outro serviço do site,
    // que o Omie recusaria como redundante (ex.: Consulta rápida de um produto e, logo depois, a revisão do pedido dele).
    if (!locais || now() - locais.em > 6 * 60 * MINUTO) {
      const corpo = await chamar("estoque/local", "ListarLocaisEstoque", { nPagina: 1, nRegPorPagina: 49 });
      const lista = describeLocations(corpo.locaisEncontrados ?? [], config);
      if (!lista.some((local) => local.isDefault)) throw new Falha("omie_recusou");
      locais = { em: now(), lista };
    }
    const data = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Fortaleza", day: "2-digit", month: "2-digit", year: "numeric" }).format(now());
    const resultado = {};
    let consultadoEm = now(); // a resposta mais antiga usada (pode ter vindo da janela de 65 s)
    for (let i = 0; i < produtos.length; i += 20) {
      const lote = produtos.slice(i, i + 20);
      const linhas = [];
      for (let pagina = 1; pagina <= 40; pagina += 1) {
        const corpo = await chamar("estoque/consulta", "ListarPosEstoque", {
          nPagina: pagina, nRegPorPagina: 49, dDataPosicao: data, cExibeTodos: "S", lista_local_estoque: "TODOS",
          lista_produtos: lote.map((id) => ({ nCodProd: Number(id) })),
        });
        consultadoEm = Math.min(consultadoEm, instanteDe.get(corpo) ?? now());
        linhas.push(...(Array.isArray(corpo.produtos) ? corpo.produtos : []));
        if (!(Number(corpo.nTotPaginas) > pagina)) break;
      }
      for (const id of lote) {
        const r = resumoEstoque(montarLocais(locais.lista, linhas, id));
        // SKU que o Omie informa para o código do produto: a revisão confere com o SKU da proposta aceita.
        const sku = limpo(linhas.find((row) => String(row?.nCodProd) === id)?.cCodigo, 60);
        resultado[id] = { conhecido: r.conhecido, disponivel: r.disponivel, totalFisico: r.totalFisico, sku: sku || null };
      }
    }
    return { consultadoEm: new Date(consultadoEm).toISOString(), produtos: resultado };
  }

  /** Cliente novo: só com CPF/CNPJ válido e e-mail (obrigatórios no Omie para a NF); antes, procura pelo código de integração. */
  async function incluirCliente(dados) {
    const integracao = String(dados?.codigo_cliente_integracao ?? "");
    const problemas = [];
    if (!/^MAG-C-[0-9a-f]{32}$/.test(integracao)) problemas.push("código de integração do cliente inválido");
    const razao = limpo(dados?.razao_social, 60); const fantasia = limpo(dados?.nome_fantasia, 100);
    if (razao.length < 2) problemas.push("razão social obrigatória");
    if (fantasia.length < 2) problemas.push("nome fantasia obrigatório");
    if (!documentoValido(String(dados?.cnpj_cpf ?? ""))) problemas.push("CPF/CNPJ inválido");
    const email = limpo(dados?.email, 100).toLowerCase();
    if (!/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(email)) problemas.push("e-mail obrigatório para a nota fiscal");
    const telefone = digitos(dados?.telefone);
    if (telefone && !/^\d{10,11}$/.test(telefone)) problemas.push("telefone inválido");
    if (problemas.length) return { ok: false, motivo: "cliente_invalido", erros: problemas };
    if (!config.escrita) return { ok: false, motivo: "escrita_desligada", simulado: true };
    if (clientesCriados.has(integracao)) return { ok: true, existente: true, codigoCliente: clientesCriados.get(integracao) };
    try {
      const existente = await leitura.clientePorIntegracao(integracao);
      if (existente.codigo) return { ok: true, existente: true, codigoCliente: existente.codigo };
    } catch (error) {
      if (!(error instanceof Falha && error.motivo === "nao_encontrado")) throw error;
    }
    // A inclusão invalida as respostas guardadas que ela muda: buscas de cliente e a consulta deste código.
    for (const chave of [...guardadas.keys()]) if (chave.startsWith("geral/clientes|ListarClientes|")) guardadas.delete(chave);
    guardadas.delete(chaveDe("geral/clientes", "ConsultarCliente", { codigo_cliente_integracao: integracao }));
    const documento = digitos(dados.cnpj_cpf);
    const corpo = await chamar("geral/clientes", "IncluirCliente", {
      codigo_cliente_integracao: integracao, razao_social: razao, nome_fantasia: fantasia, cnpj_cpf: documentoFormatado(documento),
      email, pessoa_fisica: documento.length === 11 ? "S" : "N",
      ...(telefone ? { telefone1_ddd: telefone.slice(0, 2), telefone1_numero: telefone.slice(2) } : {}),
    }, { escrita: true, timeoutMs: config.timeoutEscritaMs });
    if (!finite(corpo.codigo_cliente_omie)) throw new Falha("incerto");
    const codigo = String(corpo.codigo_cliente_omie);
    lembrar(clientesCriados, integracao, codigo);
    // Confirmação pelo código do Omie (outro parâmetro, não repete a consulta de antes): zera a sequência de consultas sem
    // resultado deste método e deixa guardada a que a revisão faz em seguida. Falhar aqui não muda o resultado.
    await leitura.cliente(codigo).catch(() => null);
    return { ok: true, codigoCliente: codigo };
  }

  /**
   * Copia SÓ os campos conhecidos (o que chegar a mais é descartado) e valida de novo antes de qualquer escrita. Desconto na
   * capa e frete são copiados SE vierem, para a validação RECUSAR enquanto estiverem desligados (EXTRAS_NO_PEDIDO) — nunca
   * descartados em silêncio (o pedido sairia com total diferente do aceito).
   */
  function copiarPedido(p) {
    const c = p?.cabecalho ?? {}; const info = p?.informacoes_adicionais ?? {};
    const descontoNaCapa = c.tipo_desconto_pedido !== undefined || c.valor_desconto_pedido !== undefined || c.perc_desconto_pedido !== undefined;
    return {
      cabecalho: {
        codigo_pedido_integracao: String(c.codigo_pedido_integracao ?? ""), codigo_cliente: Number(c.codigo_cliente), data_previsao: String(c.data_previsao ?? ""),
        etapa: String(c.etapa ?? ""), codigo_parcela: String(c.codigo_parcela ?? ""), quantidade_itens: Number(c.quantidade_itens),
        ...(descontoNaCapa ? { tipo_desconto_pedido: String(c.tipo_desconto_pedido ?? ""), valor_desconto_pedido: Number(c.valor_desconto_pedido),
          ...(c.perc_desconto_pedido !== undefined ? { perc_desconto_pedido: Number(c.perc_desconto_pedido) } : {}) } : {}),
      },
      det: (Array.isArray(p?.det) ? p.det : []).map((linha) => ({
        ide: { codigo_item_integracao: String(linha?.ide?.codigo_item_integracao ?? "") },
        produto: {
          codigo_produto: Number(linha?.produto?.codigo_produto), quantidade: Number(linha?.produto?.quantidade), valor_unitario: Number(linha?.produto?.valor_unitario),
          tipo_desconto: String(linha?.produto?.tipo_desconto ?? ""), valor_desconto: Number(linha?.produto?.valor_desconto),
          reservado: String(linha?.produto?.reservado ?? ""),
        },
      })),
      ...(p?.frete !== undefined ? { frete: { modalidade: String(p.frete?.modalidade ?? ""), valor_frete: Number(p.frete?.valor_frete) } } : {}),
      informacoes_adicionais: {
        codigo_categoria: String(info.codigo_categoria ?? ""), codigo_conta_corrente: Number(info.codigo_conta_corrente), consumidor_final: String(info.consumidor_final ?? ""),
        // enviar_pix nunca é repassado: só UMA das tags enviar_email/enviar_pix pode ir (padrão do Omie = "N").
        codVend: Number(info.codVend), enviar_email: String(info.enviar_email ?? ""), utilizar_emails: String(info.utilizar_emails ?? ""),
      },
      observacoes: { obs_venda: String(p?.observacoes?.obs_venda ?? "") },
    };
  }

  async function incluirPedido(bruto) {
    const p = copiarPedido(bruto);
    const erros = validarPedidoOmie(p, hojeFortaleza(now()));
    if (erros.length) return { ok: false, motivo: "pedido_invalido", erros };
    if (!(ETAPAS_PERMITIDAS).includes(p.cabecalho.etapa)) return { ok: false, motivo: "pedido_invalido", erros: ["etapa não permitida"] };
    if (!config.escrita) return { ok: false, motivo: "escrita_desligada", simulado: true };
    const integracao = p.cabecalho.codigo_pedido_integracao;
    // 2ª barreira de idempotência (a 1ª é a trava no banco do site): se o Omie já tem esse código, devolve, não inclui —
    // desde que seja MESMO este pedido (cliente e itens); senão é conflito: nada é enviado nem vinculado.
    try {
      const existente = await leitura.pedidoPorIntegracao(integracao);
      if (existente.codigoPedido) {
        if (!pedidoConfere(resumoDoPedido(p), existente)) return { ok: false, motivo: "conflito_integracao" };
        return { ok: true, existente: true, codigoPedido: existente.codigoPedido, numeroPedido: existente.numeroPedido, etapa: existente.etapa };
      }
    } catch (error) {
      if (!(error instanceof Falha && error.motivo === "nao_encontrado")) throw error;
    }
    // Daqui em diante o "não encontrado" guardado deixa de valer: depois de tentar incluir, só uma consulta real responde.
    guardadas.delete(chaveDe("produtos/pedido", "ConsultarPedido", { codigo_pedido_integracao: integracao }));
    const corpo = await chamar("produtos/pedido", "IncluirPedido", p, { escrita: true, timeoutMs: config.timeoutEscritaMs });
    if (!finite(corpo.codigo_pedido)) throw new Falha("incerto");
    const criado = { codigoPedido: String(corpo.codigo_pedido), numeroPedido: limpo(corpo.numero_pedido, 15), etapa: limpo(corpo.etapa ?? p.cabecalho.etapa, 2),
      cancelado: false, faturado: false, ...resumoDoPedido(p) };
    lembrar(pedidosCriados, integracao, criado);
    // Leitura de volta pelo código do Omie (outro parâmetro, não repete a consulta de antes): confere campo a campo o que
    // foi gravado e zera a sequência de consultas sem resultado deste método (10 seguidas bloqueiam 30 min). Falhar aqui
    // não muda o resultado (a inclusão já respondeu): a conferência fica "não feita".
    let conferencia = null;
    try {
      const lido = await chamar("produtos/pedido", "ConsultarPedido", { codigo_pedido: Number(criado.codigoPedido) });
      const confirmado = pedido(lido);
      if (confirmado.numeroPedido) criado.numeroPedido = confirmado.numeroPedido;
      conferencia = conferirPedidoLido(p, lido);
    } catch { /* fica o número devolvido pelo IncluirPedido */ }
    return { ok: true, codigoPedido: criado.codigoPedido, numeroPedido: criado.numeroPedido, etapa: criado.etapa, conferencia };
  }

  return {
    leitura, estoque, incluirCliente, incluirPedido,
    estado: () => ({ escrita: config.escrita, pausadoAte: pausadoAte > now() ? new Date(pausadoAte).toISOString() : null, chamadasUltimaHora: chamadas.length }),
  };
}

const responder = (res, status, body) => {
  const texto = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(texto) });
  res.end(texto);
};
function tokenConfere(cabecalho, esperado) {
  if (!esperado || esperado.length < 32) return false;
  const recebido = Buffer.from(String(cabecalho ?? "").replace(/^Bearer\s+/i, ""));
  const certo = Buffer.from(esperado);
  return recebido.length === certo.length && timingSafeEqual(recebido, certo);
}
async function lerCorpo(req) {
  const partes = []; let tamanho = 0;
  for await (const parte of req) { tamanho += parte.length; if (tamanho > 64 * 1024) throw new Falha("corpo_grande"); partes.push(parte); }
  try { return JSON.parse(Buffer.concat(partes).toString("utf8") || "{}"); } catch { throw new Falha("json_invalido"); }
}
const ID = /^\d{1,20}$/;

export function criarServidor(config, dependencias = {}) {
  const omie = criarIntegracao(config, dependencias);
  const servidor = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://interno");
    const rota = url.pathname;
    if (rota === "/saude" && req.method === "GET") return responder(res, 200, { ok: true, ...omie.estado() });
    if (!tokenConfere(req.headers.authorization, config.token)) return responder(res, 401, { ok: false, motivo: "token" });
    const inicio = Date.now();
    const registrar = (resultado, codigoOmie = "") => console.log(JSON.stringify({ evento: "omie_pedidos", rota: rota.replace(/\d{4,}/g, ":id"), resultado,
      ...(codigoOmie ? { omie: codigoOmie } : {}), ms: Date.now() - inicio }));
    try {
      let saida;
      if (req.method === "GET" && rota === "/verificar") saida = { ok: true, chavesOmie: Boolean(config.appKey && config.appSecret), ...omie.estado() };
      else if (!config.appKey || !config.appSecret) saida = { ok: false, motivo: "nao_configurado" };
      else if (req.method === "GET" && rota === "/vendedores") saida = { ok: true, vendedores: await omie.leitura.vendedores() };
      else if (req.method === "GET" && rota === "/etapas") saida = { ok: true, etapas: await omie.leitura.etapas() };
      else if (req.method === "GET" && rota === "/formas-pagamento") saida = { ok: true, formas: await omie.leitura.formasPagamento() };
      else if (req.method === "GET" && rota === "/categorias") saida = { ok: true, categorias: await omie.leitura.categorias() };
      else if (req.method === "GET" && rota === "/contas") saida = { ok: true, contas: await omie.leitura.contas() };
      else if (req.method === "GET" && rota === "/clientes") {
        const documento = digitos(url.searchParams.get("documento"));
        const nome = limpo(url.searchParams.get("nome"), 60);
        if (documento) saida = documentoValido(documento) ? { ok: true, clientes: await omie.leitura.clientesPorDocumento(documento) } : { ok: false, motivo: "documento_invalido" };
        else if (nome.length >= 3) saida = { ok: true, ...(await omie.leitura.clientesPorNome(nome)) };
        else saida = { ok: false, motivo: "busca_invalida" };
      } else if (req.method === "GET" && /^\/clientes\/\d{1,20}$/.test(rota)) {
        try { saida = { ok: true, cliente: await omie.leitura.cliente(rota.split("/")[2]) }; } catch (error) {
          if (error instanceof Falha && error.motivo === "nao_encontrado") saida = { ok: true, cliente: null }; else throw error;
        }
      } else if (req.method === "GET" && rota === "/pedidos") {
        const codigo = String(url.searchParams.get("integracao") ?? "");
        if (!/^MAG-Q-\d{4}-\d{5}$/.test(codigo)) saida = { ok: false, motivo: "integracao_invalida" };
        else {
          try { saida = { ok: true, encontrado: true, pedido: await omie.leitura.pedidoPorIntegracao(codigo) }; } catch (error) {
            if (error instanceof Falha && error.motivo === "nao_encontrado") saida = { ok: true, encontrado: false }; else throw error;
          }
        }
      } else if (req.method === "GET" && /^\/pedidos\/\d{1,20}\/status$/.test(rota)) saida = { ok: true, status: await omie.leitura.statusPedido(rota.split("/")[2]) };
      else if (req.method === "POST" && rota === "/estoque") {
        const corpo = await lerCorpo(req);
        const produtos = [...new Set((Array.isArray(corpo.produtos) ? corpo.produtos : []).map(String))];
        saida = produtos.length && produtos.length <= 199 && produtos.every((id) => ID.test(id)) ? { ok: true, ...await omie.estoque(produtos) } : { ok: false, motivo: "produtos_invalidos" };
      } else if (req.method === "POST" && rota === "/clientes") saida = await omie.incluirCliente(await lerCorpo(req));
      else if (req.method === "POST" && rota === "/pedidos") saida = await omie.incluirPedido(await lerCorpo(req));
      else return responder(res, req.method === "GET" || req.method === "POST" ? 404 : 405, { ok: false, motivo: "rota" });
      registrar(saida.ok ? (saida.existente ? "existente" : saida.conferencia && !saida.conferencia.confere ? "ok_divergente" : "ok") : saida.motivo);
      return responder(res, 200, saida);
    } catch (error) {
      const motivo = error instanceof Falha ? error.motivo : "omie_erro";
      registrar(motivo, error instanceof Falha ? error.codigo : "");
      return responder(res, 200, { ok: false, motivo, ...(error instanceof Falha && error.mensagem ? { mensagem: error.mensagem } : {}),
        ...(error instanceof Falha && error.segundos ? { segundos: error.segundos } : {}), ...omie.estado() });
    }
  });
  // Conexão ociosa dura mais aqui do que no fetch do site: com o padrão (5 s), um site ocupado por mais de 5 s reusa um
  // socket que o serviço acabou de fechar (ECONNRESET) — e numa escrita isso vira "incerto" sem motivo.
  servidor.keepAliveTimeout = 65_000;
  servidor.headersTimeout = 66_000;
  return servidor;
}

export function configDoAmbiente(env = process.env) {
  const omie = configFromEnv(env);
  return {
    appKey: omie.appKey, appSecret: omie.appSecret, nonCommercialLocations: omie.nonCommercialLocations,
    token: env.OMIE_PEDIDOS_TOKEN || "", escrita: env.OMIE_ORDER_WRITE_ENABLED === "true",
    apiUrl: env.OMIE_API_URL || "https://app.omie.com.br/api/v1/",
    porta: Number(env.OMIE_PEDIDOS_PORT) || 3200, host: env.OMIE_PEDIDOS_HOST || "0.0.0.0",
    intervaloMs: 1100, tetoHora: 300, timeoutMs: 30000, timeoutEscritaMs: 45000, repetirMs: 65000,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const config = configDoAmbiente();
  if (!config.token || config.token.length < 32) console.log(JSON.stringify({ evento: "omie_pedidos_inicio", aviso: "OMIE_PEDIDOS_TOKEN ausente: tudo recusado" }));
  criarServidor(config).listen(config.porta, config.host, () => console.log(JSON.stringify({ evento: "omie_pedidos_inicio", porta: config.porta, escrita: config.escrita })));
}
