#!/usr/bin/env python3
# Projeto mag-site — alerta técnico de falha da sincronização do catálogo Omie (Telegram).
# Instalado em /opt/mag-site/bin/omie-alert.py. Silencioso quando está tudo bem; nunca avisa sucesso.
#
#   omie-alert.py reserva <código>   chamado por omie-sync.sh depois da execução de reserva (06:40).
#                                    Código ≠ 0 → a das 04:00 também não deu certo (a reserva só consulta
#                                    o Omie quando o último sync bom tem mais de 20 h) → alerta.
#   omie-alert.py atraso             cron de hora em hora, fora da janela 04–06 h (que é da reserva):
#                                    último sync válido há mais de 26 h, ou nenhum → alerta.
#   omie-alert.py teste              envia uma mensagem de teste (confere token e chat).
#   omie-alert.py backup <etapa> <código> [log]
#                                    falha do backup diário: chamado por /srv/mag-site/backup-alerta.sh, o gancho que o
#                                    vps-backup-alerta executa quando a geração, o pacote, a cópia externa ou o hash
#                                    falham (sucesso não chama nada). Lê o log da execução para montar a mensagem.
#   --dry-run                        só imprime a mensagem; não envia nem registra.
#
# Configuração fora do repositório: /opt/mag-site/secrets/alert.env (root, 600) com
#   TELEGRAM_BOT_TOKEN=...
#   TELEGRAM_CHAT_ID=...
# (variáveis de ambiente de mesmo nome têm precedência). Sem configuração o alerta fica só no log
# (/var/log/mag-site-omie.log) e no aviso do login SSH. No máximo um alerta a cada 20 h.
import json
import os
import socket
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

APP = os.environ.get("MAG_SITE_DIR", "/opt/mag-site")
STATE = os.environ.get("MAG_SITE_STATE_DIR", "/var/lib/mag-site")
STATUS = os.path.join(APP, "catalog", "catalog.status.json")
ENV_FILE = os.path.join(APP, "secrets", "alert.env")
TENTATIVAS = os.path.join(STATE, "omie-sync.tentativas")  # omie-sync.sh: "<data ISO> <principal|reserva> <código>"
ULTIMO = os.path.join(STATE, "omie-alert.ultimo")
FALHA = os.path.join(STATE, "omie-sync.falha")  # aviso do login SSH (/etc/update-motd.d/97-mag-site-omie)
API = os.environ.get("MAG_ALERT_TELEGRAM_API", "https://api.telegram.org")  # trocado só nos testes
FORTALEZA = timezone(timedelta(hours=-3))  # sem horário de verão desde 2001
LIMITE_HORAS = 26
REPETIR_HORAS = 20
LOG_BACKUP = "/var/log/vps-backup-mag-site.log"
ETAPAS_BACKUP = {
    "geracao": "geração do pacote (backup.sh)",
    "pacote": "localização do pacote gerado",
    "envio-externo": "cópia externa (offsite)",
    "script-ausente": "backup.sh ausente",
}
SINAIS_DE_ERRO = ("ERRO", "FALHOU", "falhou", "rror", "não localizei", "sem backup.sh", "cannot", "No such", "denied", "timed out", "refused")
SEGREDOS = ("senha", "password", "secret", "token", "key=", "apikey")


def agora():
    valor = os.environ.get("MAG_ALERT_NOW")  # só nos testes
    return datetime.fromisoformat(valor) if valor else datetime.now(timezone.utc)


def log(texto):
    print(f"[{agora().astimezone(FORTALEZA):%Y-%m-%d %H:%M:%S}] alerta: {texto}", flush=True)


def data_iso(valor):
    try:
        return datetime.fromisoformat(str(valor).replace("Z", "+00:00")) if valor else None
    except ValueError:
        return None


def quando(momento):
    return momento.astimezone(FORTALEZA).strftime("%d/%m/%Y %H:%M") if momento else "nenhum registrado"


def ler_status():
    try:
        with open(STATUS, encoding="utf-8") as arquivo:
            status = json.load(arquivo)
        return status if isinstance(status, dict) else {}
    except (OSError, ValueError):
        return {}


def ultimo_sync(status):
    return data_iso(status.get("last_successful_sync") or status.get("lastSuccessAt"))


def tentativas():
    lista = []
    try:
        with open(TENTATIVAS, encoding="utf-8") as arquivo:
            for linha in arquivo:
                partes = linha.split()
                if len(partes) == 3 and data_iso(partes[0]) and partes[2].isdigit():
                    lista.append((data_iso(partes[0]), partes[1], int(partes[2])))
    except OSError:
        pass
    return lista


def descrever(tentativa):
    if not tentativa:
        return "não registrada"
    momento, _, codigo = tentativa
    return f"{quando(momento)} — " + ("ok" if codigo == 0 else f"falhou (código {codigo})")


def duracao(delta):
    minutos = max(0, int(delta.total_seconds() // 60))
    return f"{minutos // 60} h {minutos % 60:02d} min"


def mensagem(motivo):
    status = ler_status()
    ultimo = ultimo_sync(status)
    lista = tentativas()
    principal = next((t for t in reversed(lista) if t[1] == "principal"), None)
    reserva = next((t for t in reversed(lista) if t[1] == "reserva"), None)
    if status.get("status", status.get("state")) == "error":
        erro = str(status.get("error") or status.get("errorCode") or "não informado")[:200]
    else:
        erro = "o worker não registrou falha (não rodou ou foi interrompido) — ver /var/log/mag-site-omie.log"
    return "\n".join([
        "🚨 MAG — Falha na sincronização Omie",
        "",
        f"Último sync válido: {quando(ultimo)}",
        f"Tentativa principal: {descrever(principal)}",
        f"Tentativa de fallback: {descrever(reserva)}",
        f"Tempo desde último sync: {duracao(agora() - ultimo) if ultimo else 'sem sync válido registrado'}",
        f"Erro: {erro}",
        f"Servidor: {socket.gethostname()} (magmoveiscorporativos.com.br)",
        f"Motivo: {motivo}",
    ])


def configuracao():
    valores = {}
    try:
        with open(ENV_FILE, encoding="utf-8") as arquivo:
            for linha in arquivo:
                linha = linha.strip()
                if linha and not linha.startswith("#") and "=" in linha:
                    chave, valor = linha.split("=", 1)
                    valores[chave.strip()] = valor.strip().strip("'\"")
    except OSError:
        pass
    for chave in ("TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"):
        if os.environ.get(chave):
            valores[chave] = os.environ[chave]
    return valores.get("TELEGRAM_BOT_TOKEN", ""), valores.get("TELEGRAM_CHAT_ID", "")


def enviar(texto):
    """True = entregue; False = Telegram não configurado; None = falhou (a próxima verificação tenta de novo)."""
    token, chat = configuracao()
    if not token or not chat:
        return False
    corpo = urllib.parse.urlencode({"chat_id": chat, "text": texto, "disable_web_page_preview": "true"}).encode()
    try:
        with urllib.request.urlopen(f"{API}/bot{token}/sendMessage", data=corpo, timeout=20) as resposta:
            if json.load(resposta).get("ok") is True:
                return True
            log("Telegram respondeu sem ok")
    except urllib.error.HTTPError as erro:
        log(f"Telegram recusou (HTTP {erro.code}); conferir token e chat em {ENV_FILE}")
    except (OSError, ValueError) as erro:  # rede, DNS, tempo esgotado, resposta inválida; nunca imprime a URL (tem o token)
        log(f"Telegram indisponível ({type(erro).__name__})")
    return None


def pode_alertar():
    try:
        with open(ULTIMO, encoding="utf-8") as arquivo:
            ultimo = float(arquivo.read().strip())
    except (OSError, ValueError):
        return True
    return agora().timestamp() - ultimo >= REPETIR_HORAS * 3600


def gravar(caminho, texto):
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    temporario = f"{caminho}.tmp"
    with open(temporario, "w", encoding="utf-8") as arquivo:
        arquivo.write(texto)
    os.replace(temporario, caminho)


def alertar(motivo, simular):
    texto = mensagem(motivo)
    if simular:
        print(texto)
        return 0
    if not pode_alertar():
        return 0  # já avisado há menos de 20 h
    resultado = enviar(texto)
    if resultado is None:
        return 1  # não registra: a próxima verificação de hora em hora tenta de novo
    gravar(ULTIMO, f"{agora().timestamp():.0f}\n")
    if not os.path.exists(FALHA):  # aviso no login SSH também quando a sincronização nem chegou a rodar
        gravar(FALHA, f"{quando(agora())} {motivo}. Detalhes: /var/log/mag-site-omie.log\n")
    situacao = "enviado ao Telegram" if resultado else "Telegram não configurado (secrets/alert.env), só registrado aqui"
    log(f"{situacao}: " + texto.replace("\n\n", "\n").replace("\n", " | "))
    return 0


def execucao_do_backup(caminho):
    """Linhas da execução mais recente do vps-backup-run no log (do último '=====' até o fim)."""
    try:
        with open(caminho, encoding="utf-8", errors="replace") as arquivo:
            linhas = arquivo.read().split("\n")[-400:]
    except OSError:
        return []
    inicio = max((i for i, linha in enumerate(linhas) if linha.startswith("=====")), default=-1)
    return [linha.strip() for linha in linhas[inicio + 1:] if linha.strip()]


def sem_segredo(texto):
    palavras = ("[omitido]" if any(s in palavra.lower() for s in SEGREDOS) else palavra for palavra in texto.split())
    return " ".join(palavras)[:200]


def mensagem_backup(etapa, codigo, caminho_log):
    linhas = execucao_do_backup(caminho_log)
    texto = "\n".join(linhas)
    pacote = next((p for linha in linhas for p in linha.split() if p.startswith("/srv/") and ".tar" in p), "")
    externo = next((linha for linha in linhas if linha.startswith("externo:")), "")
    if etapa == "script-ausente":
        local = "não executado (backup.sh ausente)"
    elif etapa == "geracao":
        local = f"falhou (backup.sh saiu com código {codigo})"
    elif pacote and os.path.exists(pacote):
        local = f"ok — {pacote} ({os.path.getsize(pacote) // 1024} KB)"
    elif etapa == "pacote":
        local = "pacote gerado não localizado"
    else:
        local = f"não confirmado ({pacote or 'caminho ausente no log'})"
    if etapa in ("geracao", "pacote", "script-ausente"):
        offsite = "não executado (o pacote local não ficou pronto)"
    elif externo:
        offsite = "ok — " + externo.split("externo:", 1)[1].split("(")[0].strip()
    else:
        offsite = "FALHOU (a cópia local foi mantida)"
    if "hash conferido" in texto:
        conferencia = "conferido"
    elif "hash não confere" in texto:
        conferencia = "NÃO confere — envio descartado"
    else:
        conferencia = "não verificado"
    erros = [linha for linha in linhas if any(sinal in linha for sinal in SINAIS_DE_ERRO)]
    erro = sem_segredo(erros[0]) if erros else f"código {codigo} na etapa {etapa}"
    return "\n".join([
        "🚨 MAG — Falha no backup",
        "",
        f"Data/hora: {quando(agora())}",
        f"Etapa: {ETAPAS_BACKUP.get(etapa, etapa)} (código {codigo})",
        f"Backup local: {local}",
        f"Backup offsite: {offsite}",
        f"Hash: {conferencia}",
        f"Erro: {erro}",
        f"Servidor: {socket.gethostname()} (magmoveiscorporativos.com.br)",
        f"Log: {caminho_log}",
    ])


def alertar_backup(etapa, codigo, caminho_log, simular):
    """Sem repetição programada: o backup roda uma vez por dia e cada falha é um evento."""
    texto = mensagem_backup(etapa, codigo, caminho_log)
    if simular:
        print(texto)
        return 0
    resultado = enviar(texto)
    situacao = {True: "enviado ao Telegram", False: "Telegram não configurado (secrets/alert.env), só registrado aqui",
                None: "Telegram falhou, só registrado aqui"}[resultado]
    log(f"backup: {situacao}: " + texto.replace("\n\n", "\n").replace("\n", " | "))
    return 1 if resultado is None else 0


def main(argumentos):
    simular = "--dry-run" in argumentos
    args = [a for a in argumentos if a != "--dry-run"]
    modo = args[0] if args else ""
    if modo == "reserva" and len(args) == 2 and args[1].isdigit():
        if int(args[1]) == 0:
            return 0  # reserva deu certo, ou foi dispensada porque a das 04:00 deu certo: silêncio
        return alertar("a sincronização principal (04:00) e a de reserva (06:40) não deram certo", simular)
    if modo == "atraso" and len(args) == 1:
        ultimo = ultimo_sync(ler_status())
        if ultimo and agora() - ultimo <= timedelta(hours=LIMITE_HORAS):
            return 0
        return alertar(f"mais de {LIMITE_HORAS} h sem sincronização válida", simular)
    if modo == "teste" and len(args) == 1:
        texto = f"✅ MAG — teste do alerta da sincronização Omie (nenhuma falha). Servidor: {socket.gethostname()}"
        if simular:
            print(texto)
            return 0
        resultado = enviar(texto)
        print("enviado" if resultado else "Telegram não configurado (secrets/alert.env)" if resultado is False else "falhou (ver acima)")
        return 0 if resultado else 1
    if modo == "backup" and len(args) in (3, 4) and args[2].isdigit():
        return alertar_backup(args[1], int(args[2]), args[3] if len(args) == 4 else LOG_BACKUP, simular)
    print("uso: omie-alert.py reserva <código> | atraso | teste | backup <etapa> <código> [log]  [--dry-run]", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
