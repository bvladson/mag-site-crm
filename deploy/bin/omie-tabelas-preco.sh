#!/bin/sh
# Projeto mag-site — SOMENTE LEITURA: lista as tabelas de preço do Omie (ListarTabelasPreco) para a decisão D2
# ("consultar primeiro as tabelas ativas no Omie e escolher a adequada para cada operação").
# Roda dentro do contêiner da Consulta rápida, que já tem as chaves no ambiente: nenhuma chave é lida, copiada ou
# impressa por este script. Uma chamada por página (até 5 páginas de 50), respeitando o limite do Omie.
# Imprime só campos de negócio: código, nome, ativa, origem do preço, restrições, validade e descontos.
# Uso (na VPS, como root): /opt/mag-site/bin/omie-tabelas-preco.sh [--json]
set -eu
CONTAINER=${MAG_OMIE_CONTAINER:-mag-site-omie-consulta-1}
FORMATO=${1:-}
docker exec -i -e FORMATO="$FORMATO" "$CONTAINER" node --input-type=module - <<'EOF'
const url = "https://app.omie.com.br/api/v1/produtos/tabelaprecos/";
const tabelas = [];
for (let pagina = 1; pagina <= 5; pagina++) {
  const resposta = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ call: "ListarTabelasPreco", app_key: process.env.OMIE_APP_KEY, app_secret: process.env.OMIE_APP_SECRET, param: [{ nPagina: pagina, nRegPorPagina: 50 }] }),
    signal: AbortSignal.timeout(20000),
  });
  const dados = await resposta.json().catch(() => ({}));
  if (dados.faultstring) { console.error(`Omie recusou a consulta: ${String(dados.faultstring).slice(0, 160)}`); process.exit(2); }
  const lista = dados.listaTabelasPreco ?? dados.tabelasPrecos ?? dados.listaTabelas ?? [];
  for (const t of lista) {
    const c = t.caracteristicas ?? {}, cli = t.clientes ?? {}, prod = t.produtos ?? {}, outras = t.outrasInfo ?? {}, info = t.info ?? {};
    tabelas.push({
      codigoOmie: t.nCodTabPreco ?? null, codigo: t.cCodigo ?? "", nome: t.cNome ?? "", ativa: t.cAtiva === "S", origem: t.cOrigem ?? "",
      clientes: { todos: cli.cTodosClientes === "S", tag: cli.cTag || null, uf: cli.cUF || null },
      produtos: { todos: prod.cTodosProdutos === "S", familia: prod.nCodFamilia || null },
      validade: c.cTemValidade === "S" ? { de: c.dDtInicial || null, ate: c.dDtFinal || null } : null,
      desconto: { sugerido: c.nDescSugerido ?? null, maximo: c.nPercDescMax ?? null, temDesconto: c.cTemDesconto === "S" },
      ajuste: { acrescimo: outras.nPercAcrescimo ?? null, desconto: outras.nPercDesconto ?? null },
      alteradaEm: info.dAlt || null,
    });
  }
  if (!dados.nTotPaginas || pagina >= dados.nTotPaginas) break;
}
if (process.env.FORMATO === "--json") console.log(JSON.stringify(tabelas, null, 1));
else {
  const origem = { PRD: "preço do cadastro do produto", CMC: "custo médio (CMC)", TBL: "outra tabela" };
  console.log(`${tabelas.length} tabela(s) de preço no Omie (${tabelas.filter((t) => t.ativa).length} ativa(s))`);
  for (const t of tabelas)
    console.log(`- [${t.ativa ? "ATIVA" : "suspensa"}] ${t.codigo || t.codigoOmie} · ${t.nome} · ${origem[t.origem] ?? t.origem}`
      + `${t.clientes.todos ? "" : ` · só clientes${t.clientes.tag ? ` da tag ${t.clientes.tag}` : ""}${t.clientes.uf ? ` de ${t.clientes.uf}` : ""}`}`
      + `${t.validade ? ` · vale de ${t.validade.de ?? "?"} até ${t.validade.ate ?? "?"}` : ""}`
      + `${t.desconto.maximo !== null ? ` · desconto máximo ${t.desconto.maximo}%` : ""}`);
}
EOF
