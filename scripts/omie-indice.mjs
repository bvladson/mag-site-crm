#!/usr/bin/env node
/**
 * Projeto mag-site — CADASTRO COMPLETO do Omie para a Consulta rápida ("Mostrar todos os produtos do Omie", painel interno).
 * Lê TODOS os produtos do Omie (publicados ou não, ativos ou inativos) e guarda só metadados: código Omie, SKU, nome,
 * EAN/código de barras, marca, família, unidade, inativo/bloqueado e a categoria do site quando o nome a indica (mesma
 * regra do catálogo). SEM estoque (sob demanda, pelo omie-consulta), sem preço e sem fotos — nenhum download: no painel
 * os produtos fora do site usam a imagem neutra.
 * Uma leitura por noite (05:20, bin/omie-indice.sh): geral/produtos ListarProdutos, 100 por página (~16 chamadas),
 * com parâmetros diferentes dos da sincronização pública (nunca "requisição redundante" com ela). SOMENTE LEITURA no Omie.
 * Não toca no catálogo público nem no sync-omie.mjs (só reaproveita dele o cliente, a paginação e a categoria):
 * grava apenas catalog/interno/omie-produtos.json e omie-produtos.status.json.
 */
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { atomicJson, categoryOf, configFromEnv, createOmieClient, meaningful, readAllPages } from "./sync-omie.mjs";

const OMIE = "https://app.omie.com.br/api/v1/";
// Mesma limpeza do catálogo (sync-omie.mjs): sem tags, sem caracteres de controle, espaços normalizados.
const limpo = (valor, max) => String(valor ?? "")
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]*>/g, " ").replace(/&quot;/g, "\"").replace(/&amp;/g, "&")
  .replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const sim = (valor) => ["s", "sim", "true", "1"].includes(String(valor ?? "").trim().toLowerCase());
const erro = (codigo) => Object.assign(new Error(codigo), { code: codigo });

/** EAN/GTIN: só dígitos, com 8, 12, 13 ou 14; "SEM GTIN", vazio ou só zeros = sem código. */
export function ean(valor) {
  const digitos = String(valor ?? "").replace(/\D/g, "");
  return [8, 12, 13, 14].includes(digitos.length) && !/^0+$/.test(digitos) ? digitos : "";
}

/** Produto do Omie → só o que a consulta interna usa (lista branca: nada de preço, custo, NCM, observações ou URL de foto). */
export function metadados(raw) {
  const codigo = String(raw?.codigo_produto ?? "");
  if (!/^\d{1,20}$/.test(codigo) || Number(codigo) <= 0) return null;
  const nome = limpo(raw.descricao, 240);
  const sku = limpo(raw.codigo, 100);
  if (!nome && !sku) return null;
  return {
    id: codigo, sku, nome, ean: ean(raw.ean), marca: meaningful(raw.marca, 120), familia: meaningful(raw.descricao_familia, 120),
    unidade: limpo(raw.unidade, 8).toUpperCase() || "UN", categoria: categoryOf(raw) ?? "",
    inativo: sim(raw.inativo), bloqueado: sim(raw.bloqueado),
  };
}

export function configIndice(env = process.env) {
  const base = configFromEnv(env);
  const pasta = resolve(env.OMIE_INDICE_DIR || join(dirname(base.catalogPath), "interno"));
  return { ...base, indicePath: join(pasta, "omie-produtos.json"), indiceStatusPath: join(pasta, "omie-produtos.status.json") };
}

async function lerJson(caminho) {
  try { return JSON.parse(await readFile(caminho, "utf8")); } catch { return null; }
}

/** Falha registrada no status (o índice bom anterior continua valendo). Só o código, nunca resposta do Omie. */
export async function registrarFalha(config, codigo, now = () => new Date()) {
  const anterior = await lerJson(config.indiceStatusPath) ?? {};
  await atomicJson(config.indiceStatusPath, {
    schemaVersion: 1, estado: "erro", erro: codigo, ultimaTentativa: now().toISOString(), ultimoSucesso: anterior.ultimoSucesso ?? null,
    total: anterior.total ?? null,
  });
}

export async function gerarIndice(config, { call = createOmieClient(config), now = () => new Date() } = {}) {
  if (!config.appKey || !config.appSecret) throw erro("missing_omie_credentials");
  const inicio = Date.now();
  let chamadas = 0;
  const contar = (...args) => { chamadas += 1; return call(...args); };
  const brutos = await readAllPages(contar, {
    endpoint: "geral/produtos", method: "ListarProdutos", pageKey: "pagina", pagesKey: "total_de_paginas",
    totalKey: "total_de_registros", rowsKey: "produto_servico_cadastro",
    // exibir_caracteristicas "N": menos dados e parâmetros diferentes dos da sincronização pública das 04:00.
    params: { registros_por_pagina: config.pageSize, apenas_importado_api: "N", filtrar_apenas_omiepdv: "N", exibir_caracteristicas: "N" },
  });
  const vistos = new Set();
  const produtos = [];
  for (const raw of brutos) {
    const item = metadados(raw);
    if (!item || vistos.has(item.id)) continue;
    vistos.add(item.id);
    produtos.push(item);
  }
  produtos.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR") || a.id.localeCompare(b.id));
  // Proteção: resposta encolhida demais não substitui o índice bom (a paginação já confere o total do Omie).
  const anterior = (await lerJson(config.indicePath))?.produtos?.length ?? 0;
  if (anterior >= 100 && produtos.length < anterior * 0.5) throw erro("queda_suspeita");
  const geradoEm = now().toISOString();
  await atomicJson(config.indicePath, { schemaVersion: 1, geradoEm, total: produtos.length, produtos });
  const resultado = {
    estado: "ok", total: produtos.length, recebidos: brutos.length, inativos: produtos.filter((item) => item.inativo).length,
    bloqueados: produtos.filter((item) => item.bloqueado).length, comEan: produtos.filter((item) => item.ean).length,
    chamadas, duracaoSegundos: Math.round((Date.now() - inicio) / 1000),
  };
  await atomicJson(config.indiceStatusPath, { schemaVersion: 1, ...resultado, erro: null, ultimaTentativa: geradoEm, ultimoSucesso: geradoEm });
  return resultado;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let config;
  try {
    config = configIndice();
    // OMIE_API_URL só existe no teste local com Omie simulado; o container de produção não define.
    const apiUrl = process.env.OMIE_API_URL;
    const fetchImpl = apiUrl ? (url, init) => fetch(String(url).replace(OMIE, apiUrl), init) : fetch;
    console.log(JSON.stringify({ evento: "omie_indice", ...await gerarIndice(config, { call: createOmieClient(config, { fetchImpl }) }) }));
  } catch (falha) {
    const codigo = String(falha?.code ?? "erro_interno").replace(/[^a-z0-9_]/gi, "").slice(0, 60) || "erro_interno";
    if (config) await registrarFalha(config, codigo).catch(() => {});
    console.log(JSON.stringify({ evento: "omie_indice", estado: "erro", erro: codigo }));
    process.exitCode = 1;
  }
}
