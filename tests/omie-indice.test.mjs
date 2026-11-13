// node --test tests/omie-indice.test.mjs — cadastro completo do Omie (Consulta rápida interna), sem rede.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ean, metadados, gerarIndice, registrarFalha } from "../scripts/omie-indice.mjs";

const bruto = (codigo, descricao, extra = {}) => ({
  codigo_produto: codigo, codigo: `SKU-${codigo}`, descricao, unidade: "un", ean: "", marca: "", descricao_familia: "", inativo: "N", bloqueado: "N",
  tipoItem: "04", valor_unitario: 1234.56, cmc: 999.99, obs_internas: "NAO PODE SAIR", ncm: "9401.30.10",
  imagens: [{ url_imagem: "https://s3.exemplo/foto.jpg?Signature=SEGREDO" }], caracteristicas: [], ...extra,
});

/** Omie simulado: páginas de 2 produtos; registra os parâmetros de cada chamada. */
function omie(produtos, { porPagina = 2 } = {}) {
  const chamadas = [];
  const call = async (endpoint, method, params) => {
    chamadas.push({ endpoint, method, params });
    const paginas = Math.max(1, Math.ceil(produtos.length / porPagina));
    return { pagina: params.pagina, total_de_paginas: paginas, total_de_registros: produtos.length,
      produto_servico_cadastro: produtos.slice((params.pagina - 1) * porPagina, params.pagina * porPagina) };
  };
  return { call, chamadas };
}

async function pasta(t) {
  const dir = await mkdtemp(join(tmpdir(), "mag-indice-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { appKey: "CHAVE-SECRETA", appSecret: "SEGREDO-SECRETO", pageSize: 100, indicePath: join(dir, "interno", "omie-produtos.json"),
    indiceStatusPath: join(dir, "interno", "omie-produtos.status.json"), dir };
}

test("EAN: só dígitos com 8, 12, 13 ou 14; 'SEM GTIN', zeros e lixo viram vazio", () => {
  assert.equal(ean("7891234567895"), "7891234567895");
  assert.equal(ean(" 789-1234-567895 "), "7891234567895");
  assert.equal(ean("12345678"), "12345678");
  assert.equal(ean("SEM GTIN"), "");
  assert.equal(ean("0000000000000"), "");
  assert.equal(ean("123"), "");
  assert.equal(ean(null), "");
});

test("metadados: lista branca (sem preço, custo, NCM, observação ou URL de foto) e mesma categoria do catálogo", () => {
  const item = metadados(bruto(101, "CADEIRA PRESIDENTE <b>PRETA</b>", { ean: "7891234567895", marca: "Ergo", descricao_familia: "CADEIRAS", inativo: "S" }));
  assert.deepEqual(item, { id: "101", sku: "SKU-101", nome: "CADEIRA PRESIDENTE PRETA", ean: "7891234567895", marca: "Ergo", familia: "CADEIRAS",
    unidade: "UN", categoria: "cadeiras", inativo: true, bloqueado: false });
  assert.equal(metadados(bruto(102, "UNIFORME CAMISA POLO G")).categoria, "", "fora das categorias do site: sem categoria");
  assert.equal(metadados(bruto(103, "x", { marca: "sdf", descricao_familia: "0" })).marca, "", "lixo de cadastro some");
  assert.equal(metadados({ codigo_produto: "abc", descricao: "X" }), null);
  assert.equal(metadados({ codigo_produto: 0, descricao: "X" }), null);
});

test("gera o índice de TODOS os produtos com parâmetros próprios (nunca iguais aos da sincronização pública)", async (t) => {
  const config = await pasta(t);
  const produtos = [bruto(1, "CADEIRA ATENAS"), bruto(2, "UNIFORME CAMISA", { inativo: "S" }), bruto(3, "MESA RETA", { bloqueado: "S", ean: "7891234567895" }),
    bruto(2, "UNIFORME CAMISA DUPLICADO"), bruto(4, "ARMARIO ALTO")];
  const simulado = omie(produtos);
  const resultado = await gerarIndice(config, { call: simulado.call, now: () => new Date("2026-10-08T08:20:00Z") });
  assert.deepEqual(simulado.chamadas.map((c) => [c.endpoint, c.method, c.params.pagina]), [["geral/produtos", "ListarProdutos", 1], ["geral/produtos", "ListarProdutos", 2], ["geral/produtos", "ListarProdutos", 3]]);
  assert.equal(simulado.chamadas[0].params.exibir_caracteristicas, "N", "a pública usa 'S': nunca é requisição redundante");
  assert.equal(simulado.chamadas[0].params.registros_por_pagina, 100);
  assert.deepEqual({ total: resultado.total, recebidos: resultado.recebidos, inativos: resultado.inativos, bloqueados: resultado.bloqueados, comEan: resultado.comEan, chamadas: resultado.chamadas },
    { total: 4, recebidos: 5, inativos: 1, bloqueados: 1, comEan: 1, chamadas: 3 });
  const indice = JSON.parse(await readFile(config.indicePath, "utf8"));
  assert.equal(indice.schemaVersion, 1);
  assert.equal(indice.geradoEm, "2026-10-08T08:20:00.000Z");
  assert.deepEqual(indice.produtos.map((p) => p.id), ["4", "1", "3", "2"], "ordem por nome, sem duplicado");
  const texto = JSON.stringify(indice);
  for (const proibido of ["1234.56", "999.99", "NAO PODE SAIR", "9401", "s3.exemplo", "Signature", "CHAVE-SECRETA", "valor_unitario"]) {
    assert.ok(!texto.includes(proibido), `${proibido} no índice`);
  }
  const status = JSON.parse(await readFile(config.indiceStatusPath, "utf8"));
  assert.equal(status.estado, "ok");
  assert.equal(status.ultimoSucesso, "2026-10-08T08:20:00.000Z");
});

test("queda suspeita (menos da metade do índice anterior) não substitui o índice bom", async (t) => {
  const config = await pasta(t);
  await mkdir(join(config.dir, "interno"), { recursive: true });
  const anterior = { schemaVersion: 1, geradoEm: "2026-10-07T08:20:00.000Z", total: 200, produtos: Array.from({ length: 200 }, (_, i) => ({ id: String(i + 1) })) };
  await writeFile(config.indicePath, JSON.stringify(anterior));
  await assert.rejects(gerarIndice(config, { call: omie([bruto(1, "CADEIRA"), bruto(2, "MESA")]).call }), (error) => error.code === "queda_suspeita");
  assert.equal(JSON.parse(await readFile(config.indicePath, "utf8")).total, 200, "o índice anterior continua");
  await registrarFalha(config, "queda_suspeita", () => new Date("2026-10-08T08:21:00Z"));
  const status = JSON.parse(await readFile(config.indiceStatusPath, "utf8"));
  assert.deepEqual({ estado: status.estado, erro: status.erro }, { estado: "erro", erro: "queda_suspeita" });
});

test("sem chaves do Omie: recusa sem chamar nada", async (t) => {
  const config = await pasta(t);
  const simulado = omie([bruto(1, "CADEIRA")]);
  await assert.rejects(gerarIndice({ ...config, appKey: "" }, { call: simulado.call }), (error) => error.code === "missing_omie_credentials");
  assert.equal(simulado.chamadas.length, 0);
});
