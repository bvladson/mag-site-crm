#!/bin/sh
# Projeto mag-site — confere os serviços internos do Omie (omie-consulta: Consulta rápida; omie-pedidos: Pedido de Venda)
# SEM chamar o Omie. Uso:
#   /opt/mag-site/bin/omie-consulta-verificar.sh             segredos, saúde, consulta local de teste e modo de escrita
#   /opt/mag-site/bin/omie-consulta-verificar.sh --preparar  só garante os tokens internos e as permissões (antes de subir)
# Chamado pelo restore.sh; pode rodar a qualquer momento (sem --preparar não altera nada). Saída ≠ 0 = algo falhou.
set -u
APP=/opt/mag-site
S=$APP/secrets
falhas=0
ok() { echo "ok      $*"; }
falha() { echo "FALHA   $*"; falhas=$((falhas + 1)); }
# Serviços presentes no compose desta release, com o arquivo e a variável do token interno de cada um.
SERVICOS=""
grep -q '^  omie-consulta:' "$APP/compose.yaml" 2>/dev/null && SERVICOS="$SERVICOS omie-consulta"
grep -q '^  omie-pedidos:' "$APP/compose.yaml" 2>/dev/null && SERVICOS="$SERVICOS omie-pedidos"
arquivo() { echo "$S/$1.env"; }
variavel() { [ "$1" = omie-consulta ] && echo OMIE_CONSULTA_TOKEN || echo OMIE_PEDIDOS_TOKEN; }
token_valido() { grep -Eq "^$(variavel "$1")=[0-9a-f]{64}$" "$(arquivo "$1")" 2>/dev/null; }

if [ "${1:-}" = "--preparar" ]; then
  for servico in $SERVICOS; do
    if ! token_valido "$servico"; then
      # Token só entre o site e o serviço (nada externo usa): gerar outro é seguro — os dois leem o mesmo arquivo.
      ( umask 077; printf '%s=%s\n' "$(variavel "$servico")" "$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')" > "$(arquivo "$servico")" ) || exit 1
      echo "token interno novo gerado em $(arquivo "$servico")"
    fi
  done
  chown root:root "$S" "$S"/* && chmod 700 "$S" && chmod 600 "$S"/* || exit 1
fi

# 1) Segredos: pasta 700 root, arquivos 600 root:root, tokens no formato e chaves do Omie presentes (valores nunca exibidos).
[ "$(stat -c '%a %U' "$S" 2>/dev/null)" = "700 root" ] && ok "pasta de segredos 700 root" || falha "$S deveria ser 700 root"
for f in "$S/omie.env" $(for servico in $SERVICOS; do arquivo "$servico"; done); do
  [ "$(stat -c '%a %U:%G' "$f" 2>/dev/null)" = "600 root:root" ] && ok "$(basename "$f") 600 root:root" || falha "$f ausente ou sem 600 root:root"
done
for servico in $SERVICOS; do token_valido "$servico" && ok "token interno de $servico no formato (64 hex)" || falha "token interno de $servico ausente ou inválido"; done
grep -q '^OMIE_APP_KEY=.' "$S/omie.env" 2>/dev/null && grep -q '^OMIE_APP_SECRET=.' "$S/omie.env" 2>/dev/null \
  && ok "chaves do Omie presentes em omie.env" || falha "OMIE_APP_KEY/OMIE_APP_SECRET ausentes em omie.env"
if [ "${1:-}" = "--preparar" ]; then [ "$falhas" -eq 0 ]; exit $?; fi

cd "$APP" || exit 1
# 2) Saúde dos containers (healthcheck do compose).
for servico in web $SERVICOS; do
  estado=$(docker compose ps --format '{{.Health}}' "$servico" 2>/dev/null)
  [ "$estado" = healthy ] && ok "$servico saudável" || falha "$servico não está saudável (${estado:-parado})"
done

# 3) Consulta local de teste pelo container do site (mesmo endereço e token de uma chamada real), SEM chamar o Omie:
#    /verificar com o token certo (200, chaves carregadas) e com um errado (401); uma rota real com dado inválido é
#    recusada antes de qualquer chamada ao Omie (omie-consulta: /estoque/0; omie-pedidos: /pedidos?integracao=X).
resultado=$(docker compose exec -T web node -e '
const testar = async (base, token, rota) => {
  const pedir = (caminho, t) => fetch(base + caminho, { headers: { authorization: "Bearer " + t }, signal: AbortSignal.timeout(10000) })
    .then(async (r) => [r.status, await r.json().catch(() => ({}))]).catch(() => [0, {}]);
  const [v, corpo] = await pedir("/verificar", token);
  const [errado] = await pedir("/verificar", "x".repeat(64));
  const [s, recusa] = await pedir(rota, token);
  return [v, corpo.chavesOmie === true ? "chaves" : "sem-chaves", errado, s, recusa.motivo || "-", corpo.escrita === true ? "escrita-ligada" : "escrita-desligada"].join(" ");
};
(async () => {
  const linhas = [];
  if (process.env.OMIE_CONSULTA_URL) linhas.push("omie-consulta " + await testar(process.env.OMIE_CONSULTA_URL, process.env.OMIE_CONSULTA_TOKEN || "", "/estoque/0"));
  if (process.env.OMIE_PEDIDOS_URL) linhas.push("omie-pedidos " + await testar(process.env.OMIE_PEDIDOS_URL, process.env.OMIE_PEDIDOS_TOKEN || "", "/pedidos?integracao=X"));
  linhas.push("site " + (process.env.OMIE_APP_KEY || process.env.OMIE_APP_SECRET ? "com-chaves" : "sem-chaves"));
  console.log(linhas.join("\n"));
})();' </dev/null 2>/dev/null)
for servico in $SERVICOS; do
  linha=$(printf '%s\n' "$resultado" | grep "^$servico ")
  set -- $linha
  [ "${2:-}" = 200 ] && ok "site → $servico: token aceito (/verificar 200)" || falha "site → $servico: /verificar respondeu ${2:-nada}"
  [ "${3:-}" = chaves ] && ok "$servico com as chaves do Omie carregadas" || falha "$servico sem as chaves do Omie"
  [ "${4:-}" = 401 ] && ok "$servico recusa token errado (401)" || falha "$servico não recusou token errado (${4:-nada})"
  if [ "$servico" = omie-consulta ]; then
    [ "${5:-}" = 400 ] && [ "${6:-}" = produto ] && ok "omie-consulta: consulta local de teste respondida sem chamar o Omie" || falha "omie-consulta: consulta local de teste ${5:-nada} ${6:-}"
  else
    [ "${5:-}" = 200 ] && [ "${6:-}" = integracao_invalida ] && ok "omie-pedidos: consulta local de teste respondida sem chamar o Omie" || falha "omie-pedidos: consulta local de teste ${5:-nada} ${6:-}"
    [ "${7:-}" = escrita-ligada ] && echo "AVISO   omie-pedidos com ESCRITA LIGADA: \"Gerar Pedido\" cria pedidos reais no Omie" || ok "omie-pedidos com escrita DESLIGADA (só simula)"
  fi
done
printf '%s\n' "$resultado" | grep -q "^site sem-chaves" && ok "container do site sem as chaves do Omie" || falha "o container do site recebeu as chaves do Omie"

# 4) API interna do painel: sem sessão continua 401.
codigo=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:3020/api/interno/produtos)
[ "$codigo" = 401 ] && ok "API interna sem sessão → 401" || falha "API interna sem sessão respondeu $codigo"

# 5) Cadastro completo ("Mostrar todos os produtos do Omie"): aviso, não falha — é refeito às 05:20.
if [ -f catalog/interno/omie-produtos.json ]; then
  ok "cadastro completo presente (gerado em $(date -r catalog/interno/omie-produtos.json '+%d/%m/%Y %H:%M'))"
else
  echo "aviso   cadastro completo ainda não gerado: /opt/mag-site/bin/omie-indice.sh (ou aguardar as 05:20)"
fi

if [ "$falhas" -eq 0 ]; then echo "Serviços do Omie: tudo certo (nenhuma chamada ao Omie)"; exit 0; fi
echo "Serviços do Omie: $falhas falha(s)"
exit 1
