// node --test tests/produtos-busca.test.mjs — busca local da Consulta rápida (sem Omie).
import test from "node:test";
import assert from "node:assert/strict";
import { buscarProdutos, termos, filtroValido, quantidade, MAX_CONSULTA } from "../src/lib/produtos-busca.ts";

const produto = (id, nome, sku, categoria, disponivel, extra = {}) => ({
  id, slug: `p-${id}`, sku, nome, nomeOmie: nome.toUpperCase(), categoria, marca: "", familia: "", ean: "", unidade: "UN", imagem: "/i.webp", foto: "/f.webp",
  estoque: disponivel > 0 ? "PRONTA_ENTREGA" : "SOB_CONSULTA", disponivel, publicado: true, inativo: false, bloqueado: false, ...extra,
});
/** Produto do cadastro completo do Omie que não está no site: sem estoque calculado, imagem neutra. */
const foraDoSite = (id, nome, sku, categoria, extra = {}) => ({
  id, slug: null, sku, nome, nomeOmie: nome, categoria, marca: "", familia: "", ean: "", unidade: "UN", imagem: "/images/product-placeholder.svg",
  foto: "/images/product-placeholder.svg", estoque: null, disponivel: null, publicado: false, inativo: false, bloqueado: false, ...extra,
});
const LISTA = [
  produto("8764749209", "Armário Alto Fec 2 P 30mm Almeria", "00003", "armazenamento", 4),
  produto("8764749300", "Cadeira Orlando Presidente Preta", "00123", "cadeiras", 8, { marca: "Ergo Office" }),
  produto("8764749301", "Cadeira Orlando Diretor Cinza", "00124", "cadeiras", 0),
  produto("8764749302", "Mesa Reta 1200 Orlando", "ME-77", "mesas", 2),
  produto("8764749303", "Braço Regulável para Cadeira", "P-0010", "pecas", null),
  produto("8764749304", "Estação de Trabalho Plataforma", "00500", "estacoes", 1),
];
const nomes = (resultado) => resultado.itens.map((item) => item.sku);

test("nome completo, parte do nome, sem acento/caixa e palavras fora de ordem", () => {
  assert.deepEqual(nomes(buscarProdutos(LISTA, "Cadeira Orlando Presidente Preta")), ["00123"]);
  assert.deepEqual(nomes(buscarProdutos(LISTA, "presidente orlando")), ["00123"], "fora de ordem");
  assert.deepEqual(nomes(buscarProdutos(LISTA, "ARMARIO almeria")), ["00003"], "sem acento e sem caixa");
  assert.deepEqual(nomes(buscarProdutos(LISTA, "orlando")).sort(), ["00123", "00124", "ME-77"]);
  assert.deepEqual(nomes(buscarProdutos(LISTA, "ergo office")), ["00123"], "marca");
  assert.deepEqual(nomes(buscarProdutos(LISTA, "estacao")), ["00500"]);
});

test("SKU exato (com ou sem zeros), código do Omie, e SKU exato vem primeiro", () => {
  assert.deepEqual(nomes(buscarProdutos(LISTA, "00003")), ["00003"]);
  assert.equal(nomes(buscarProdutos(LISTA, "3"))[0], "00003", "sem os zeros à esquerda");
  assert.deepEqual(nomes(buscarProdutos(LISTA, "8764749209")), ["00003"], "código do Omie");
  assert.equal(nomes(buscarProdutos(LISTA, "ME-77"))[0], "ME-77");
  assert.equal(nomes(buscarProdutos(LISTA, "me 77"))[0], "ME-77");
  assert.equal(nomes(buscarProdutos(LISTA, "00124"))[0], "00124");
});

test("filtros rápidos usam as categorias e o disponível existentes", () => {
  assert.deepEqual(nomes(buscarProdutos(LISTA, "", "com-estoque")).sort(), ["00003", "00123", "00500", "ME-77"]);
  assert.deepEqual(nomes(buscarProdutos(LISTA, "", "sem-estoque")).sort(), ["00124", "P-0010"], "zero e sem posição");
  assert.deepEqual(nomes(buscarProdutos(LISTA, "", "cadeiras")).sort(), ["00123", "00124"]);
  assert.deepEqual(nomes(buscarProdutos(LISTA, "", "armazenamento")), ["00003"]);
  assert.deepEqual(nomes(buscarProdutos(LISTA, "", "pecas")), ["P-0010"]);
  assert.deepEqual(nomes(buscarProdutos(LISTA, "orlando", "com-estoque")).sort(), ["00123", "ME-77"]);
  assert.equal(filtroValido("<script>"), "todos");
  assert.equal(filtroValido("mesas"), "mesas");
});

test("caracteres especiais, busca enorme e inexistente não quebram nada", () => {
  for (const consulta of ["<script>alert(1)</script>", "%_\\'\"()[]{}*+?.^$|", "%%%", "\u0000\u001f", "🙂 cadeira 🙂"]) {
    assert.doesNotThrow(() => buscarProdutos(LISTA, consulta), consulta);
  }
  assert.deepEqual(nomes(buscarProdutos(LISTA, "🙂 cadeira 🙂")).sort(), ["00123", "00124", "P-0010"]);
  const enorme = "cadeira ".repeat(500);
  assert.ok(termos(enorme).length <= 8);
  assert.ok(termos("x".repeat(5000))[0].length <= MAX_CONSULTA);
  assert.equal(buscarProdutos(LISTA, "produto-que-nao-existe-xyz").total, 0);
  assert.equal(buscarProdutos(LISTA, "99999").total, 0, "SKU inexistente");
  const muitos = Array.from({ length: 300 }, (_, i) => produto(String(9000 + i), `Cadeira ${i}`, String(9000 + i), "cadeiras", i));
  const limitado = buscarProdutos(muitos, "cadeira", "todos", 60);
  assert.equal(limitado.total, 300);
  assert.equal(limitado.itens.length, 60);
});

test("cadastro completo: EAN e família pesquisáveis; fora do site não entra em Com/Sem estoque; publicado e ativo primeiro", () => {
  const lista = [...LISTA,
    foraDoSite("9001", "Uniforme Camisa Polo G", "UNI-01", "", { ean: "7891234567895", familia: "Uniformes" }),
    foraDoSite("9002", "Cadeira Orlando Antiga", "00999", "cadeiras", { inativo: true }),
    foraDoSite("9003", "Cadeira Orlando Zeta", "00998", "cadeiras")];
  assert.deepEqual(nomes(buscarProdutos(lista, "7891234567895")), ["UNI-01"], "EAN exato");
  assert.equal(nomes(buscarProdutos(lista, "78912345"))[0], "UNI-01", "parte do EAN");
  assert.deepEqual(nomes(buscarProdutos(lista, "uniformes")), ["UNI-01"], "família");
  assert.deepEqual(nomes(buscarProdutos(lista, "", "com-estoque")).sort(), ["00003", "00123", "00500", "ME-77"]);
  assert.deepEqual(nomes(buscarProdutos(lista, "", "sem-estoque")).sort(), ["00124", "P-0010"], "estoque não calculado não é 'sem estoque'");
  assert.deepEqual(nomes(buscarProdutos(lista, "", "cadeiras")).sort(), ["00123", "00124", "00998", "00999"], "categoria vale fora do site");
  assert.deepEqual(nomes(buscarProdutos(lista, "cadeira orlando")), ["00124", "00123", "00998", "00999"], "publicados, depois ativo, depois inativo");
});

test("quantidade interna: pt-BR, até 3 casas, sem posição vira travessão", () => {
  assert.equal(quantidade(8), "8 UN");
  assert.equal(quantidade(2.5, "M"), "2,5 M");
  assert.equal(quantidade(1521), "1.521 UN");
  assert.equal(quantidade(null), "—");
});
