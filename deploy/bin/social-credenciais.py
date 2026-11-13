#!/usr/bin/env python3
"""Projeto mag-site — credenciais das redes sociais em /opt/mag-site/secrets/social.env (root, 600).

Segredos são digitados sem eco: não aparecem na tela, não ficam em argumento nem no histórico do shell, e este
script nunca imprime valores (só "definido"; IDs públicos — canal do YouTube e organização do LinkedIn — aparecem).

  social-credenciais.py status
  social-credenciais.py definir youtube|instagram|tiktok|linkedin
  social-credenciais.py remover youtube|instagram|tiktok|linkedin
  social-credenciais.py tiktok-autorizar <redirect_uri cadastrado no portal do TikTok>
  social-credenciais.py youtube-canal https://www.youtube.com/@magmoveiscorporativos7222
        (com a chave gravada: acha o ID do canal pela API oficial a partir do @handle OFICIAL; grava só com CONFIRMO)
  social-credenciais.py linkedin-verificar https://www.linkedin.com/company/magmoveiscorporativos
        (confere, pela consulta oficial do LinkedIn, se o LINKEDIN_ORGANIZATION_ID é exatamente essa página)
  social-credenciais.py linkedin-organizacoes      (lista as páginas em que o token tem papel; NÃO escolhe nenhuma)

Depois de definir: /opt/mag-site/bin/social-sync.sh --forcar e conferir em /interno/redes a conta sincronizada.
Passo a passo de cada rede: /srv/mag-site/REDES.md.
"""
import getpass
import json
import os
import re
import secrets
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

ARQUIVO = os.environ.get("SOCIAL_ENV_FILE", "/opt/mag-site/secrets/social.env")
TIKTOK_AUTH = "https://www.tiktok.com/v2/auth/authorize/"
TIKTOK_TOKEN = os.environ.get("TIKTOK_TOKEN_URL", "https://open.tiktokapis.com/v2/oauth/token/")
LINKEDIN_API = os.environ.get("LINKEDIN_API_BASE", "https://api.linkedin.com")
YOUTUBE_API = os.environ.get("YOUTUBE_API_BASE", "https://www.googleapis.com")
# Sem espaço, aspas, "$" ou "#": o arquivo é lido igual pelo docker compose e pelo docker run.
SEGREDO = re.compile(r"^[A-Za-z0-9._~+/=!:-]{8,2000}$")

# (variável, pergunta, secreta, formato, obrigatória)
CAMPOS = {
    "youtube": [
        ("YOUTUBE_API_KEY", "Chave da API (Google Cloud, começa com AIza)", True, re.compile(r"^AIza[0-9A-Za-z_-]{35}$"), True),
        ("YOUTUBE_CHANNEL_ID", "ID do canal oficial (começa com UC; Enter para achar depois com youtube-canal)", False, re.compile(r"^UC[0-9A-Za-z_-]{22}$"), False),
    ],
    "instagram": [
        ("INSTAGRAM_ACCESS_TOKEN", "Token de longa duração gerado no painel da Meta", True, SEGREDO, True),
    ],
    "tiktok": [
        ("TIKTOK_CLIENT_KEY", "Client key do app no TikTok", False, re.compile(r"^[A-Za-z0-9]{8,64}$"), True),
        ("TIKTOK_CLIENT_SECRET", "Client secret do app no TikTok", True, SEGREDO, True),
    ],
    "linkedin": [
        ("LINKEDIN_ORGANIZATION_ID", "ID numérico da organização (página OFICIAL da MAG)", False, re.compile(r"^\d{1,20}$"), True),
        ("LINKEDIN_ACCESS_TOKEN", "Token de acesso (60 dias)", True, SEGREDO, True),
        ("LINKEDIN_REFRESH_TOKEN", "Refresh token (Enter se o app não recebeu)", True, SEGREDO, False),
        ("LINKEDIN_CLIENT_ID", "Client ID (só com refresh token)", False, re.compile(r"^[A-Za-z0-9]{6,40}$"), False),
        ("LINKEDIN_CLIENT_SECRET", "Client secret (só com refresh token)", True, SEGREDO, False),
    ],
}
EXTRAS = {"tiktok": ["TIKTOK_REFRESH_TOKEN", "TIKTOK_ACCESS_TOKEN"]}  # gravados pelo tiktok-autorizar
PUBLICOS = {"YOUTUBE_CHANNEL_ID", "LINKEDIN_ORGANIZATION_ID"}  # identificadores públicos: podem aparecer


def ler(caminho=None):
    caminho = caminho or ARQUIVO
    valores, linhas = {}, []
    try:
        with open(caminho, encoding="utf-8") as arquivo:
            linhas = arquivo.read().splitlines()
    except FileNotFoundError:
        return valores, linhas
    for linha in linhas:
        m = re.match(r"^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$", linha)
        if m and not linha.lstrip().startswith("#"):
            valor = m.group(2)
            if len(valor) >= 2 and valor[0] == valor[-1] and valor[0] in "'\"":
                valor = valor[1:-1]
            valores[m.group(1)] = valor
    return valores, linhas


def gravar(novos, remover=(), caminho=None):
    """Troca/insere/remove variáveis mantendo o resto do arquivo; grava atômico com permissão 600."""
    caminho = caminho or ARQUIVO
    _, linhas = ler(caminho)
    feitos, saida = set(), []
    for linha in linhas:
        m = re.match(r"^\s*([A-Z0-9_]+)\s*=", linha)
        chave = m.group(1) if m and not linha.lstrip().startswith("#") else None
        if chave in remover:
            continue
        if chave in novos:
            saida.append(f"{chave}={novos[chave]}")
            feitos.add(chave)
        else:
            saida.append(linha)
    if not linhas:
        saida.append("# Projeto mag-site — credenciais das redes sociais (root, 600). Editar com bin/social-credenciais.py.")
    saida += [f"{chave}={valor}" for chave, valor in novos.items() if chave not in feitos]
    pasta = os.path.dirname(caminho) or "."
    fd, temporario = tempfile.mkstemp(prefix=".social.env.", dir=pasta)  # mkstemp já cria com 600
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as arquivo:
            arquivo.write("\n".join(saida) + "\n")
            arquivo.flush()
            os.fsync(arquivo.fileno())
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            os.chown(temporario, 0, 0)
        os.replace(temporario, caminho)
    finally:
        if os.path.exists(temporario):
            os.unlink(temporario)


def perguntar(texto, secreta):
    if secreta:
        return getpass.getpass(f"{texto}: ").strip()
    print(f"{texto}: ", end="", flush=True)
    return sys.stdin.readline().strip()


def rede_valida(rede):
    if rede not in CAMPOS:
        sys.exit(f"Rede desconhecida: {rede!r}. Use: {', '.join(CAMPOS)}")
    return rede


def status():
    valores, linhas = ler()
    if not linhas:
        print(f"{ARQUIVO}: não existe (nenhuma rede com credencial; tudo 'desconectado').")
        return
    info = os.stat(ARQUIVO)
    print(f"{ARQUIVO}: permissão {oct(info.st_mode & 0o777)[2:]}, dono uid {info.st_uid}")
    for rede, campos in CAMPOS.items():
        partes = []
        for chave, *_ in campos + [(extra,) for extra in EXTRAS.get(rede, [])]:
            if chave in valores and valores[chave]:
                partes.append(f"{chave}={valores[chave]}" if chave in PUBLICOS else f"{chave} definido")
        print(f"  {rede:9} " + (" · ".join(partes) if partes else "sem credencial"))


def definir(rede):
    rede_valida(rede)
    atuais, _ = ler()
    novos = {}
    print(f"Credenciais de {rede}. Segredos não aparecem enquanto você digita. Enter mantém o valor atual (se houver).")
    for chave, texto, secreta, formato, obrigatoria in CAMPOS[rede]:
        while True:
            valor = perguntar(f"{texto} [{chave}]", secreta)
            if not valor and atuais.get(chave):
                break
            if not valor and not obrigatoria:
                break
            if formato.match(valor):
                novos[chave] = valor
                break
            print("  formato inválido; confira e digite de novo (nada foi gravado).")
    if rede == "linkedin":
        tem_refresh = novos.get("LINKEDIN_REFRESH_TOKEN") or atuais.get("LINKEDIN_REFRESH_TOKEN")
        tem_cliente = (novos.get("LINKEDIN_CLIENT_ID") or atuais.get("LINKEDIN_CLIENT_ID")) and (novos.get("LINKEDIN_CLIENT_SECRET") or atuais.get("LINKEDIN_CLIENT_SECRET"))
        if tem_refresh and not tem_cliente:
            sys.exit("Refresh token do LinkedIn exige também Client ID e Client secret. Nada foi gravado.")
    if not novos:
        print("Nada mudou.")
        return
    gravar(novos)
    print(f"Gravado em {ARQUIVO} (600): {', '.join(sorted(novos))}.")
    print("Próximo passo: /opt/mag-site/bin/social-sync.sh --forcar  e conferir a conta sincronizada em /interno/redes.")


def remover(rede):
    rede_valida(rede)
    chaves = [campo[0] for campo in CAMPOS[rede]] + EXTRAS.get(rede, [])
    confirmacao = perguntar(f"Remover as credenciais de {rede}? Digite REMOVER para confirmar", False)
    if confirmacao != "REMOVER":
        sys.exit("Cancelado.")
    gravar({}, remover=set(chaves))
    print(f"Removidas: {', '.join(chaves)}. Na próxima sincronização a rede fica 'desconectado' e o conteúdo dela sai do site.")


def http_json(url, dados=None, cabecalhos=None):
    corpo = urllib.parse.urlencode(dados).encode() if dados is not None else None
    pedido = urllib.request.Request(url, data=corpo, headers=cabecalhos or {})
    if corpo is not None:
        pedido.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urllib.request.urlopen(pedido, timeout=20) as resposta:
            return resposta.status, json.loads(resposta.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as erro:
        try:
            return erro.code, json.loads(erro.read().decode("utf-8") or "{}")
        except ValueError:
            return erro.code, {}
    except (urllib.error.URLError, OSError, ValueError):
        return 0, {}  # falha de rede: nunca imprime a URL (pode conter a chave)


def codigo_seguro(texto):
    return re.sub(r"[^A-Za-z0-9_.-]", "", str(texto or ""))[:60]


def tiktok_autorizar(redirect_uri):
    partes = urllib.parse.urlsplit(redirect_uri or "")
    if partes.scheme != "https" or partes.query or partes.fragment or not partes.netloc:
        sys.exit("Informe o redirect URI exatamente como cadastrado no portal (https, sem ? nem #).")
    valores, _ = ler()
    if not valores.get("TIKTOK_CLIENT_KEY") or not valores.get("TIKTOK_CLIENT_SECRET"):
        sys.exit("Antes: social-credenciais.py definir tiktok (client key e client secret).")
    estado = secrets.token_urlsafe(16)
    link = TIKTOK_AUTH + "?" + urllib.parse.urlencode({
        "client_key": valores["TIKTOK_CLIENT_KEY"], "scope": "user.info.basic,video.list", "response_type": "code",
        "redirect_uri": redirect_uri, "state": estado,
    })
    print("1) Abra este endereço num navegador conectado à conta OFICIAL da MAG no TikTok e autorize:\n")
    print(link + "\n")
    print("2) O TikTok volta para o redirect URI com ?code=...&state=... na barra de endereços.")
    colado = getpass.getpass("3) Cole aqui o endereço COMPLETO da barra (não aparece na tela): ").strip()
    consulta = urllib.parse.parse_qs(urllib.parse.urlsplit(colado).query)
    if consulta.get("error"):
        sys.exit(f"O TikTok recusou a autorização: {codigo_seguro(consulta['error'][0])}")
    if consulta.get("state", [""])[0] != estado:
        sys.exit("O 'state' não confere com o link gerado agora. Gere o link de novo e use só ele.")
    codigo = consulta.get("code", [""])[0]
    if not codigo:
        sys.exit("Não encontrei o 'code' no endereço colado.")
    situacao, resposta = http_json(TIKTOK_TOKEN, {
        "client_key": valores["TIKTOK_CLIENT_KEY"], "client_secret": valores["TIKTOK_CLIENT_SECRET"], "code": codigo,
        "grant_type": "authorization_code", "redirect_uri": redirect_uri,
    })
    refresh = resposta.get("refresh_token")
    if situacao != 200 or not refresh:
        sys.exit(f"Troca do código recusada (HTTP {situacao}, {codigo_seguro(resposta.get('error'))}). Nada foi gravado.")
    escopos = set(str(resposta.get("scope", "")).replace(" ", "").split(","))
    faltando = {"user.info.basic", "video.list"} - escopos
    if not SEGREDO.match(refresh):
        sys.exit("O refresh token veio num formato inesperado. Nada foi gravado.")
    gravar({"TIKTOK_REFRESH_TOKEN": refresh}, remover={"TIKTOK_ACCESS_TOKEN"})
    validade = datetime.now(timezone.utc) + timedelta(seconds=int(resposta.get("refresh_expires_in") or 0))
    print(f"Refresh token gravado (vale até {validade:%d/%m/%Y}). Escopos: {', '.join(sorted(escopos)) or '-'}.")
    if faltando:
        print(f"ATENÇÃO: faltam os escopos {', '.join(sorted(faltando))} — confira os produtos/escopos aprovados no portal.")
    print("Próximo passo: /opt/mag-site/bin/social-sync.sh --forcar  e conferir a conta autorizada em /interno/redes.")


def youtube_canal(url_oficial):
    """ID do canal pela API oficial (channels.list forHandle, 1 unidade de cota) — nunca deduzido; grava só com CONFIRMO."""
    m = re.match(r"^https://(?:www\.)?youtube\.com/@([A-Za-z0-9._-]{3,100})/?$", url_oficial or "")
    if not m:
        sys.exit("Informe o endereço OFICIAL no formato https://www.youtube.com/@handle.")
    handle = m.group(1)
    valores, _ = ler()
    if not valores.get("YOUTUBE_API_KEY"):
        sys.exit("Antes: social-credenciais.py definir youtube (a chave; o ID do canal pode ficar em branco).")
    situacao, resposta = http_json(f"{YOUTUBE_API}/youtube/v3/channels?" + urllib.parse.urlencode(
        {"part": "id,snippet", "forHandle": f"@{handle}", "key": valores["YOUTUBE_API_KEY"]}))
    if situacao != 200:
        erro = resposta.get("error") if isinstance(resposta.get("error"), dict) else {}
        motivo = ((erro.get("errors") or [{}])[0] or {}).get("reason")
        sys.exit(f"YouTube respondeu HTTP {situacao} ({codigo_seguro(motivo)}). Nada foi gravado.")
    itens = resposta.get("items") or []
    if len(itens) != 1:
        sys.exit(f"A API não encontrou um canal com @{handle}. Nada foi gravado.")
    canal = itens[0]
    snippet = canal.get("snippet") or {}
    canal_id = str(canal.get("id") or "")
    titulo = str(snippet.get("title") or "")[:120]
    custom = str(snippet.get("customUrl") or "").lstrip("@").lower()
    if not re.match(r"^UC[0-9A-Za-z_-]{22}$", canal_id):
        sys.exit("A API devolveu um ID em formato inesperado. Nada foi gravado.")
    if custom != handle.lower():
        sys.exit(f"O canal devolvido tem @{custom or '?'}, não o @{handle} oficial. Nada foi gravado.")
    print(f"Canal encontrado pela API oficial: {titulo} · @{handle} · {canal_id}")
    if perguntar("Este é o canal OFICIAL da MAG? Digite CONFIRMO para gravar", False) != "CONFIRMO":
        sys.exit("Nada foi gravado.")
    gravar({"YOUTUBE_CHANNEL_ID": canal_id})
    print("YOUTUBE_CHANNEL_ID gravado. Próximo passo: /opt/mag-site/bin/social-sync.sh --forcar e conferir o painel.")


def linkedin_verificar(url_oficial):
    """O LINKEDIN_ORGANIZATION_ID gravado é exatamente a página oficial? Usa a consulta oficial por vanityName."""
    m = re.match(r"^https://(?:www\.)?linkedin\.com/company/([A-Za-z0-9-]{2,100})/?$", url_oficial or "")
    if not m:
        sys.exit("Informe a página OFICIAL no formato https://www.linkedin.com/company/<nome>.")
    pagina = m.group(1).lower()
    valores, _ = ler()
    token, organizacao = valores.get("LINKEDIN_ACCESS_TOKEN"), valores.get("LINKEDIN_ORGANIZATION_ID")
    if not token or not organizacao:
        sys.exit("Antes: social-credenciais.py definir linkedin (ID da organização e token).")
    cabecalhos = {"Authorization": f"Bearer {token}", "LinkedIn-Version": linkedin_versao(), "X-Restli-Protocol-Version": "2.0.0"}
    situacao, resposta = http_json(f"{LINKEDIN_API}/rest/organizations?" + urllib.parse.urlencode({"q": "vanityName", "vanityName": pagina}), cabecalhos=cabecalhos)
    achadas = [str(e.get("id")) for e in (resposta.get("elements") or []) if str(e.get("vanityName") or "").lower() == pagina] if situacao == 200 else []
    if achadas:
        if organizacao in achadas:
            print(f"CONFERE: a organização {organizacao} é a página oficial /company/{pagina}.")
            return
        sys.exit(f"NÃO CONFERE: a página oficial /company/{pagina} é a organização {achadas[0]}, mas está gravado {organizacao}. "
                 "Corrija com social-credenciais.py definir linkedin antes de ativar a API.")
    situacao2, resposta2 = http_json(f"{LINKEDIN_API}/rest/organizationsLookup?ids=List({organizacao})", cabecalhos=cabecalhos)
    dados = (resposta2.get("results") or {}).get(organizacao) if situacao2 == 200 else None
    if dados:
        nome = str(dados.get("vanityName") or "").lower()
        if nome == pagina:
            print(f"CONFERE: a organização {organizacao} é a página oficial /company/{pagina}.")
            return
        sys.exit(f"NÃO CONFERE: a organização {organizacao} é a página /company/{nome or '?'}, não a oficial /company/{pagina}.")
    print(f"Não foi possível consultar o LinkedIn (HTTP {situacao}/{situacao2}). Confira manualmente: abra a página oficial como")
    print(f"administrador; a URL deve ficar https://www.linkedin.com/company/{organizacao}/admin/ (o número = o ID gravado).")
    sys.exit(2)


def linkedin_versao(agora=None):
    data = (agora or datetime.now(timezone.utc)).replace(day=1)
    mes = data.month - 2
    ano = data.year + (mes - 1) // 12
    mes = (mes - 1) % 12 + 1
    return f"{ano}{mes:02d}"


def linkedin_organizacoes():
    valores, _ = ler()
    token = valores.get("LINKEDIN_ACCESS_TOKEN")
    if not token:
        sys.exit("Antes: social-credenciais.py definir linkedin (o token).")
    situacao, resposta = http_json(
        f"{LINKEDIN_API}/rest/organizationAcls?q=roleAssignee&state=APPROVED&count=50",
        cabecalhos={"Authorization": f"Bearer {token}", "LinkedIn-Version": linkedin_versao(), "X-Restli-Protocol-Version": "2.0.0"},
    )
    if situacao != 200:
        print(f"LinkedIn respondeu HTTP {situacao} ({codigo_seguro(resposta.get('code') or resposta.get('serviceErrorCode'))}).")
        print("Sem a permissão de listar páginas (r_organization_admin), pegue o ID na URL da página aberta como administrador:")
        print("  https://www.linkedin.com/company/<NÚMERO>/admin/  — o número é o LINKEDIN_ORGANIZATION_ID.")
        return
    elementos = resposta.get("elements") or []
    if not elementos:
        print("O token não tem papel aprovado em nenhuma página.")
        return
    print("Páginas em que a pessoa autenticada tem papel (escolha você qual é a OFICIAL; nada é gravado aqui):")
    leitura = {"ADMINISTRATOR", "DIRECT_SPONSORED_CONTENT_POSTER", "CONTENT_ADMINISTRATOR", "CONTENT_ADMIN"}
    for elemento in elementos:
        organizacao = str(elemento.get("organization") or elemento.get("organizationTarget") or "?")
        papel = str(elemento.get("role") or "?")
        nota = "" if papel in leitura else "  (este papel NÃO lê as publicações)"
        print(f"  {organizacao}  papel {papel}{nota}")
    print("Depois: social-credenciais.py definir linkedin  e informe só o número da organização oficial.")


def main(argumentos):
    if not argumentos or argumentos[0] in {"-h", "--help", "ajuda"}:
        print(__doc__)
        return
    comando, resto = argumentos[0], argumentos[1:]
    if comando == "status":
        status()
    elif comando == "definir" and len(resto) == 1:
        definir(resto[0])
    elif comando == "remover" and len(resto) == 1:
        remover(resto[0])
    elif comando == "tiktok-autorizar" and len(resto) == 1:
        tiktok_autorizar(resto[0])
    elif comando == "linkedin-organizacoes":
        linkedin_organizacoes()
    elif comando == "youtube-canal" and len(resto) == 1:
        youtube_canal(resto[0])
    elif comando == "linkedin-verificar" and len(resto) == 1:
        linkedin_verificar(resto[0])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
