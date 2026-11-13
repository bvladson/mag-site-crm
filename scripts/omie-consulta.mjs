#!/usr/bin/env node
/**
 * Projeto mag-site — CONSULTA RÁPIDA do painel interno: estoque de UM produto em todos os locais, SOMENTE LEITURA no Omie.
 * Serviço interno, sem porta pública: só o site fala com ele (http://omie-consulta:3100, token OMIE_CONSULTA_TOKEN).
 * É o único serviço sempre ligado com as chaves do Omie — o container do site nunca as recebe.
 * Aceita apenas GET /estoque/<código do produto no Omie>, GET /verificar (token; confere o caminho de uma consulta SEM
 * chamar o Omie — usado pelo restore e por bin/omie-consulta-verificar.sh) e GET /saude. Uma chamada ao Omie por consulta:
 * estoque/consulta ListarPosEstoque com lista_produtos=[produto] e lista_local_estoque=TODOS (+ ListarLocaisEstoque a cada 6 h).
 * Proteções: 1 chamada por vez (≥ 1,1 s entre elas); o mesmo produto no máximo 1 vez a cada 65 s (regra de requisição
 * redundante do Omie); teto de 120 chamadas por hora; pausa de 30 min se o Omie bloquear (425) ou recusar as chaves.
 * Não altera o worker noturno (sync-omie.mjs): só reaproveita dele a mesma regra de locais comerciais.
 */
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { configFromEnv, describeLocations } from "./sync-omie.mjs";

const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
const quantity = (value) => Math.round(value * 1000) / 1000;
const normalize = (value) => String(value ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const MINUTO = 60000;

export class Falha extends Error {
  constructor(motivo, pausaMs = 0) { super(motivo); this.motivo = motivo; this.pausaMs = pausaMs; }
}

/**
 * MESMA regra do catálogo (buildCatalog no sync-omie.mjs): só locais comerciais; por local, saldo limitado ao físico;
 * comprometido = o MAIOR entre pendente e reservado do local; disponível = bruto − comprometido (nunca negativo).
 * Sem linha no local padrão = posição desconhecida (null), como no site. "Total físico" soma TODOS os locais e é só informativo.
 */
export function resumoEstoque(locais) {
  let bruto = 0; let comprometido = 0; let pendentes = 0; let reservas = 0; let totalFisico = 0;
  const conhecido = locais.some((local) => local.padrao && local.presente);
  for (const local of locais) {
    if (local.fisico !== null) totalFisico += local.fisico;
    if (!local.comercial || !local.presente) continue;
    pendentes += Math.max(0, local.pendente ?? 0);
    reservas += Math.max(0, local.reservado ?? 0);
    comprometido += Math.max(0, local.pendente ?? 0, local.reservado ?? 0);
    if (local.saldo !== null) bruto += Math.max(0, Math.min(local.saldo, local.fisico ?? local.saldo));
  }
  return {
    conhecido, brutoComercial: quantity(bruto), pendentes: quantity(pendentes), reservas: quantity(reservas),
    comprometido: quantity(comprometido), disponivel: conhecido ? quantity(Math.max(0, bruto - comprometido)) : null,
    totalFisico: quantity(totalFisico),
  };
}

/** Linhas do Omie → um item por local (padrão primeiro, depois os comerciais, depois os demais). */
export function montarLocais(locations, rows, produto) {
  const porLocal = new Map(rows.filter((row) => String(row?.nCodProd) === produto).map((row) => [String(row.codigo_local_estoque), row]));
  return locations.map((location) => {
    const row = porLocal.get(location.id);
    return {
      id: location.id, nome: location.name, comercial: location.commercial, padrao: location.isDefault, presente: Boolean(row),
      saldo: finite(row?.nSaldo), fisico: finite(row?.fisico), pendente: finite(row?.nPendente), reservado: finite(row?.reservado),
    };
  }).sort((a, b) => Number(b.padrao) - Number(a.padrao) || Number(b.comercial) - Number(a.comercial) || a.nome.localeCompare(b.nome, "pt-BR"));
}

export function criarConsulta(config, { fetchImpl = fetch, now = () => Date.now(), sleepImpl = sleep } = {}) {
  const base = config.apiUrl.replace(/\/?$/, "/");
  let fila = Promise.resolve();
  let ultimaChamada = 0;
  let pausadoAte = 0;
  const chamadas = [];
  const recentes = new Map();
  let locais = null;

  async function chamar(endpoint, call, param) {
    if (now() < pausadoAte) throw new Falha("pausado");
    while (chamadas.length && now() - chamadas[0] > 60 * MINUTO) chamadas.shift();
    if (chamadas.length >= config.tetoHora) throw new Falha("teto_horario");
    const espera = config.intervaloMs - (now() - ultimaChamada);
    if (espera > 0) await sleepImpl(espera);
    ultimaChamada = now();
    chamadas.push(ultimaChamada);
    let response;
    try {
      response = await fetchImpl(`${base}${endpoint}/`, {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ call, app_key: config.appKey, app_secret: config.appSecret, param: [param] }),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch {
      throw new Falha("indisponivel");
    }
    if (response.status === 425) throw new Falha("bloqueado", 30 * MINUTO);
    let body = null;
    try { body = await response.json(); } catch { body = null; }
    if (body?.faultstring || body?.faultcode) {
      const fault = normalize(body.faultstring);
      if (/nao existem registros|nenhum registro/.test(fault)) return {};
      if (/too many|limite|consumo|redundant|ja foi realizad|aguard|60 segundo/.test(fault)) throw new Falha("limite", 2 * MINUTO);
      if (/app_key|app_secret|chave de acesso|nao autorizad|invalid.*key/.test(fault)) throw new Falha("credenciais", 30 * MINUTO);
      throw new Falha("omie_erro");
    }
    if (!response.ok || !body || typeof body !== "object" || Array.isArray(body)) throw new Falha("indisponivel");
    return body;
  }

  /** Uma chamada por vez, na ordem de chegada. */
  function enfileirar(tarefa) {
    const execucao = fila.then(tarefa);
    fila = execucao.catch(() => {});
    return execucao;
  }

  async function lerLocais() {
    if (locais && now() - locais.em < 6 * 60 * MINUTO) return locais.lista;
    const resposta = await chamar("estoque/local", "ListarLocaisEstoque", { nPagina: 1, nRegPorPagina: 50 });
    const lista = describeLocations(resposta.locaisEncontrados ?? [], config);
    if (!lista.some((location) => location.isDefault)) throw new Falha("omie_erro");
    locais = { em: now(), lista };
    return lista;
  }

  async function consultar(produto) {
    if (!config.appKey || !config.appSecret) throw new Falha("nao_configurado");
    const recente = recentes.get(produto);
    if (recente && now() - recente.em < config.repetirMs) return { ...recente.valor, fonte: "cache" };
    return enfileirar(async () => {
      const depoisDaFila = recentes.get(produto);
      if (depoisDaFila && now() - depoisDaFila.em < config.repetirMs) return { ...depoisDaFila.valor, fonte: "cache" };
      try {
        const lista = await lerLocais();
        const data = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Fortaleza", day: "2-digit", month: "2-digit", year: "numeric" }).format(now());
        const resposta = await chamar("estoque/consulta", "ListarPosEstoque", {
          nPagina: 1, nRegPorPagina: 50, dDataPosicao: data, cExibeTodos: "S", lista_local_estoque: "TODOS", lista_produtos: [{ nCodProd: Number(produto) }],
        });
        const linhas = Array.isArray(resposta.produtos) ? resposta.produtos : [];
        const primeira = linhas.find((row) => String(row?.nCodProd) === produto);
        const locaisDoProduto = montarLocais(lista, linhas, produto);
        const valor = {
          ok: true, fonte: "omie", consultadoEm: new Date(now()).toISOString(), produto,
          omie: primeira ? { sku: String(primeira.cCodigo ?? "").slice(0, 100), descricao: String(primeira.cDescricao ?? "").slice(0, 240) } : null,
          locais: locaisDoProduto.map(({ presente: _presente, ...local }) => local), resumo: resumoEstoque(locaisDoProduto),
        };
        recentes.set(produto, { em: now(), valor });
        if (recentes.size > 500) recentes.delete(recentes.keys().next().value);
        return valor;
      } catch (error) {
        if (error instanceof Falha && error.pausaMs) pausadoAte = Math.max(pausadoAte, now() + error.pausaMs);
        throw error instanceof Falha ? error : new Falha("omie_erro");
      }
    });
  }

  return { consultar, estado: () => ({ pausadoAte: pausadoAte > now() ? new Date(pausadoAte).toISOString() : null, chamadasUltimaHora: chamadas.length }) };
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

export function criarServidor(config, dependencias = {}) {
  const consulta = criarConsulta(config, dependencias);
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://interno");
    if (req.method !== "GET") return responder(res, 405, { ok: false, motivo: "metodo" });
    if (url.pathname === "/saude") return responder(res, 200, { ok: true, ...consulta.estado() });
    if (url.pathname === "/verificar") {
      if (!tokenConfere(req.headers.authorization, config.token)) return responder(res, 401, { ok: false, motivo: "token" });
      return responder(res, 200, { ok: true, chavesOmie: Boolean(config.appKey && config.appSecret), ...consulta.estado() });
    }
    const alvo = /^\/estoque\/(\d{1,20})$/.exec(url.pathname);
    if (!alvo) return responder(res, 404, { ok: false, motivo: "rota" });
    if (!tokenConfere(req.headers.authorization, config.token)) return responder(res, 401, { ok: false, motivo: "token" });
    const produto = alvo[1];
    if (!Number.isSafeInteger(Number(produto)) || Number(produto) <= 0) return responder(res, 400, { ok: false, motivo: "produto" });
    const inicio = Date.now();
    try {
      const valor = await consulta.consultar(produto);
      console.log(JSON.stringify({ evento: "omie_consulta", produto, resultado: valor.fonte, ms: Date.now() - inicio }));
      return responder(res, 200, valor);
    } catch (error) {
      const motivo = error instanceof Falha ? error.motivo : "omie_erro";
      console.log(JSON.stringify({ evento: "omie_consulta", produto, resultado: "falha", motivo, ms: Date.now() - inicio }));
      return responder(res, 200, { ok: false, motivo, ...consulta.estado() });
    }
  });
}

export function configDoAmbiente(env = process.env) {
  const omie = configFromEnv(env);
  return {
    appKey: omie.appKey, appSecret: omie.appSecret, nonCommercialLocations: omie.nonCommercialLocations,
    token: env.OMIE_CONSULTA_TOKEN || "", apiUrl: env.OMIE_API_URL || "https://app.omie.com.br/api/v1/",
    porta: Number(env.OMIE_CONSULTA_PORT) || 3100, host: env.OMIE_CONSULTA_HOST || "0.0.0.0", intervaloMs: 1100, repetirMs: 65000, tetoHora: 120, timeoutMs: 15000,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const config = configDoAmbiente();
  if (!config.token || config.token.length < 32) console.log(JSON.stringify({ evento: "omie_consulta_inicio", aviso: "OMIE_CONSULTA_TOKEN ausente: todas as consultas recusadas" }));
  criarServidor(config).listen(config.porta, config.host, () => console.log(JSON.stringify({ evento: "omie_consulta_inicio", porta: config.porta })));
}
