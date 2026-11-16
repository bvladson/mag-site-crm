#!/usr/bin/env python3
"""Configura os alertas do servidor MAG no Telegram, direto na VPS, como root e num terminal interativo.

- O token é digitado aqui, SEM ECO: não aparece na tela, no histórico do shell, na lista de processos nem em log,
  e não vai para nenhum endereço aberto no navegador.
- O número do grupo é descoberto aqui mesmo, pela API do bot, e só o identificador aparece (o nome do grupo só quando
  houver mais de um, para escolher). Nenhum texto de mensagem, nome ou número de pessoa é mostrado.
- Grava /opt/mag-site/secrets/alert.env de forma atômica, root:root e 600, preservando as outras linhas, e manda
  uma mensagem de teste ao grupo.

Uso (como root):
  telegram-configurar.py              configuração guiada: token -> grupo -> gravação -> mensagem de teste
  telegram-configurar.py --chat-id    só mostra o número do grupo, com o token que já está no alert.env

O mesmo alert.env é lido pelo vigia do WhatsApp, pelo alerta de falha do backup, pelo alerta da sincronização do
Omie e pela saúde do servidor (D3). Teste do ciclo completo depois: saude-host.py --testar-alertas.
Variáveis só para os testes automáticos: MAG_ALERT_ENV, MAG_TELEGRAM_API.
"""
import getpass
import json
import os
import re
import stat
import sys
import urllib.error
import urllib.parse
import urllib.request

PADRAO_ENV = "/opt/mag-site/secrets/alert.env"
PADRAO_API = "https://api.telegram.org"
ALERT_ENV = os.environ.get("MAG_ALERT_ENV", PADRAO_ENV)  # só nos testes automáticos; o main() recusa outro valor
API = os.environ.get("MAG_TELEGRAM_API", PADRAO_API)  # idem: fora dos testes, só a API oficial do Telegram
CHAVES = ("TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID")
FORMATO_TOKEN = re.compile(r"^[0-9]{5,}:[A-Za-z0-9_-]{30,}$")
TIPOS_GRUPO = ("group", "supergroup")
TESTE = ("✅ MAG CRM | Alertas — teste de comunicação concluído. O monitoramento da MAG está configurado para avisar "
         "este grupo. Nada está errado.")


class ErroTelegram(Exception):
    """Erro da API já sem token e sem endereço."""


def chamar(token, metodo, parametros=None, api=None, tempo=15):
    """Chama a API do bot e devolve o "result". Erros viram ErroTelegram com só o código HTTP ou o tipo do erro."""
    corpo = urllib.parse.urlencode(parametros).encode() if parametros else None
    try:
        with urllib.request.urlopen(f"{api or API}/bot{token}/{metodo}", data=corpo, timeout=tempo) as resposta:
            dados = json.load(resposta)
    except urllib.error.HTTPError as erro:
        descricao = ""
        try:
            descricao = str(json.load(erro).get("description", ""))[:120].replace(token, "[token]")
        except Exception:
            pass
        finally:
            erro.close()
        raise ErroTelegram(f"HTTP {erro.code}" + (f" ({descricao})" if descricao else "")) from None
    except Exception as erro:  # rede, DNS, tempo esgotado, resposta inválida: só o tipo (a URL leva o token)
        raise ErroTelegram(f"Telegram indisponível ({type(erro).__name__})") from None
    if not isinstance(dados, dict) or dados.get("ok") is not True:
        raise ErroTelegram("o Telegram respondeu sem ok")
    return dados.get("result")


def grupos(atualizacoes):
    """{id: nome} dos grupos que aparecem no getUpdates, na ordem em que apareceram. Grupo que virou supergrupo fica
    só com o número novo (o antigo deixa de valer). Conversas privadas, textos e pessoas são ignorados."""
    achados, migrados = {}, {}
    for atualizacao in atualizacoes or []:
        if not isinstance(atualizacao, dict):
            continue
        for valor in atualizacao.values():
            if not isinstance(valor, dict) or not isinstance(valor.get("chat"), dict):
                continue
            chat = valor["chat"]
            if chat.get("type") in TIPOS_GRUPO and isinstance(chat.get("id"), int):
                achados[chat["id"]] = str(chat.get("title") or "")[:60]
            if isinstance(valor.get("migrate_to_chat_id"), int):
                migrados[chat.get("id")] = valor["migrate_to_chat_id"]
    for antigo, novo in migrados.items():
        nome = achados.pop(antigo, "")
        achados.setdefault(novo, nome)
    return achados


def ler_linhas(caminho):
    try:
        with open(caminho, encoding="utf-8") as arquivo:
            return arquivo.read().splitlines()
    except FileNotFoundError:
        return []


def chave_da_linha(linha):
    return linha.strip().partition("=")[0].strip().removeprefix("export ").strip()


def ler_valores(caminho):
    valores = {}
    for linha in ler_linhas(caminho):
        nome, sep, valor = linha.strip().partition("=")
        if sep and chave_da_linha(linha) in CHAVES:
            valores[chave_da_linha(linha)] = valor.strip().strip('"').strip("'")
    return valores


def gravar(caminho, token, chat, dono=(0, 0)):
    """Grava de forma atômica (temporário 600 na mesma pasta, fsync e rename), preservando as outras linhas e
    trocando os valores antigos do Telegram. Devolve o os.stat do arquivo final."""
    pasta = os.path.dirname(caminho) or "."
    linhas = [linha for linha in ler_linhas(caminho) if chave_da_linha(linha) not in CHAVES]
    if not any(linha.lstrip().startswith("#") for linha in linhas):
        linhas.insert(0, "# Alertas MAG por Telegram (root, 600). Gravado por telegram-configurar.py; não copiar para outro lugar.")
    linhas += [f"TELEGRAM_BOT_TOKEN={token}", f"TELEGRAM_CHAT_ID={chat}"]
    temporario = os.path.join(pasta, f".alert.env.{os.getpid()}.tmp")
    fd = os.open(temporario, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as arquivo:
            if hasattr(os, "fchmod"):
                os.fchmod(arquivo.fileno(), 0o600)
            if dono is not None and hasattr(os, "fchown"):
                os.fchown(arquivo.fileno(), *dono)
            arquivo.write("\n".join(linhas) + "\n")
            arquivo.flush()
            os.fsync(arquivo.fileno())
        os.replace(temporario, caminho)
    except BaseException:
        if os.path.exists(temporario):
            os.unlink(temporario)
        raise
    return os.stat(caminho)


def permissoes(info):
    dono = "root:root" if (info.st_uid, info.st_gid) == (0, 0) else f"{info.st_uid}:{info.st_gid}"
    return f"{stat.S_IMODE(info.st_mode):o} {dono}"


def conferir_pasta(caminho):
    """Texto do problema, ou "" se a pasta do alert.env existe, é do root e é fechada (700)."""
    pasta = os.path.dirname(caminho) or "."
    try:
        info = os.stat(pasta)
    except OSError:
        return f"a pasta {pasta} não existe"
    if info.st_uid != 0 or stat.S_IMODE(info.st_mode) & 0o077:
        return f"a pasta {pasta} deveria ser do root e 700 (está {permissoes(info)})"
    return ""


def escolher_grupo(token, perguntar, escrever, api=None, tentativas=5):
    for _ in range(tentativas):
        achados = grupos(chamar(token, "getUpdates", {"timeout": 0}, api))
        if len(achados) == 1:
            (chat,) = achados
            escrever(f"Grupo encontrado: {chat}")
            return chat
        if len(achados) > 1:
            opcoes = list(achados.items())
            escrever("Mais de um grupo encontrado:")
            for numero, (chat, nome) in enumerate(opcoes, 1):
                escrever(f"  {numero}) {chat}  {nome}")
            resposta = perguntar("Número da opção: ").strip()
            if resposta.isdigit() and 1 <= int(resposta) <= len(opcoes):
                return opcoes[int(resposta) - 1][0]
            escrever("Opção inválida.")
            continue
        perguntar("Nenhum grupo apareceu ainda. Confira se o bot está no grupo, mande no grupo uma mensagem "
                  "mencionando o bot e tecle Enter para procurar de novo (Ctrl+C cancela): ")
    return None


def configurar(ler_token, perguntar, escrever, caminho=None, api=None, dono=(0, 0)):
    caminho = caminho or ALERT_ENV
    token = ler_token("Token do bot, dado pelo @BotFather (não aparece na tela; cole e tecle Enter): ").strip()
    if not FORMATO_TOKEN.match(token):
        escrever("Formato de token inválido (esperado: número, dois-pontos e letras). Nada foi gravado.")
        return 1
    try:
        nome = (chamar(token, "getMe", api=api) or {}).get("username") or "?"
        escrever(f"Bot confirmado: @{nome}")
        perguntar(f"Adicione @{nome} ao grupo dos alertas e mande no grupo uma mensagem mencionando @{nome}. "
                  "Depois tecle Enter: ")
        chat = escolher_grupo(token, perguntar, escrever, api)
    except ErroTelegram as erro:
        escrever(f"Telegram: {erro}. Nada foi gravado.")
        return 1
    if chat is None:
        escrever("Nenhum grupo escolhido. Nada foi gravado.")
        return 1
    info = gravar(caminho, token, chat, dono)
    escrever(f"alert.env gravado: {permissoes(info)}")
    try:
        chamar(token, "sendMessage", {"chat_id": chat, "text": TESTE, "disable_web_page_preview": "true"}, api)
    except ErroTelegram as erro:
        escrever(f"Mensagem de teste NÃO entregue: {erro}. O arquivo foi gravado; confira o bot no grupo e rode de novo.")
        return 1
    escrever("Mensagem de teste: entregue no grupo.")
    return 0


def mostrar_chat_id(escrever, caminho=None, api=None):
    token = ler_valores(caminho or ALERT_ENV).get("TELEGRAM_BOT_TOKEN", "")
    if not token:
        escrever("O alert.env não tem TELEGRAM_BOT_TOKEN: nada a consultar.")
        return 1
    try:
        achados = grupos(chamar(token, "getUpdates", {"timeout": 0}, api))
    except ErroTelegram as erro:
        escrever(f"Telegram: {erro}.")
        return 1
    if not achados:
        escrever("Nenhum grupo apareceu: confira se o bot está no grupo e mande no grupo uma mensagem mencionando o bot.")
        return 1
    for chat, nome in achados.items():
        escrever(f"{chat}" + (f"  {nome}" if len(achados) > 1 else ""))
    return 0


def main(argumentos):
    if argumentos not in ([], ["--chat-id"]):
        print(__doc__)
        return 2
    if (ALERT_ENV, API) != (PADRAO_ENV, PADRAO_API):
        print("Variável de teste definida (MAG_ALERT_ENV ou MAG_TELEGRAM_API): recusado. Rode o comando sem ela.", file=sys.stderr)
        return 2
    if hasattr(os, "geteuid") and os.geteuid() != 0:
        print("Rode como root: o alert.env é do root.", file=sys.stderr)
        return 2
    if not argumentos and not sys.stdin.isatty():
        print("Rode num terminal interativo: o token é digitado sem eco, nunca por pipe ou argumento.", file=sys.stderr)
        return 2
    problema = conferir_pasta(ALERT_ENV)
    if problema:
        print(f"{problema}. Nada foi feito.", file=sys.stderr)
        return 2
    escrever = lambda texto: print(texto, flush=True)
    escrever(f"Conecta somente em {PADRAO_API} e grava somente {PADRAO_ENV} (root, 600). "
             "O token não aparece na tela, não vai para log e não fica no histórico.")
    try:
        if argumentos == ["--chat-id"]:
            return mostrar_chat_id(escrever)
        return configurar(getpass.getpass, input, escrever)
    except (KeyboardInterrupt, EOFError):
        print("\nCancelado.")
        return 130
    except Exception as erro:  # sem traceback: nunca arriscar mostrar o token
        print(f"Erro inesperado ({type(erro).__name__}).", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
