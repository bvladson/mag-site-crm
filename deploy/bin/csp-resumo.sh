#!/bin/sh
# Projeto mag-site — resumo das violações de CSP (modo só relatório), a partir das linhas "[csp]" do log do container.
# Uso: csp-resumo.sh [horas]   (padrão 24). O cron das 23:58 grava o resumo do dia em /var/log/mag-site-csp.log.
# Só contagens por diretiva, endereço bloqueado e página: nada de IP nem conteúdo bruto. Somente leitura.
# O log do container recomeça a cada release nova; durante a observação, antes de publicar, rode:
#   /opt/mag-site/bin/csp-resumo.sh 24 >> /var/log/mag-site-csp.log
set -u
H=${1:-24}
case "$H" in ''|*[!0-9]*) echo "uso: csp-resumo.sh [horas]" >&2; exit 2 ;; esac
docker logs --since "${H}h" mag-site-web-1 2>&1 | grep -F '[csp] ' | python3 -c '
import collections, json, sys, unicodedata
from datetime import datetime
def limpo(texto, tamanho):  # o JSON decodificado pode trazer quebra de linha, ESC, bidi etc.: nunca imprimir cru
    return "".join("?" if unicodedata.category(c) in ("Cc", "Cf", "Zl", "Zp") else c for c in str(texto))[:tamanho]
relatos = []
for linha in sys.stdin:
    try:
        relatos.append(json.loads(linha.split("[csp] ", 1)[1]))
    except (IndexError, ValueError):
        pass
grupos = collections.Counter((limpo(r.get("diretiva") or "-", 30), limpo(r.get("bloqueado") or "-", 90), limpo(r.get("pagina") or "-", 90)) for r in relatos if isinstance(r, dict))
print(f"=== {datetime.now():%Y-%m-%d %H:%M} — violações de CSP nas últimas {sys.argv[1]} h: {len(relatos)} ({len(grupos)} tipos)")
for (diretiva, bloqueado, pagina), n in grupos.most_common(30):
    print(f"  {n:5}  {diretiva:20} {bloqueado}  <-  {pagina}")
' "$H"
