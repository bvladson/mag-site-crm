#!/usr/bin/env python3
"""Saúde do servidor para o painel "Saúde do sistema" do site MAG (módulo 1 — estabilidade).

Roda a cada 5 min pelo cron (deploy/cron/mag-site-saude) e grava, de forma atômica, um JSON pequeno na pasta de
dados do site (/opt/mag-site/data/saude-host.json, montada no contêiner como SITE_DATA_DIR). O site só LÊ o arquivo.

Conteúdo: disco, memória, carga, contêineres do site e do WhatsApp, último backup de cada projeto (pacote, linha
RESULTADO do log e marcador de falha) e o estado do vigia do WhatsApp. Nunca grava segredo, telefone completo,
conteúdo de mensagem nem nome de arquivo de backup. Somente leitura do servidor: não reinicia nem altera nada.

Variáveis (opcionais): MAG_SAUDE_SAIDA, MAG_SAUDE_PROJETOS ("mag-site mag-whatsapp"), MAG_SAUDE_CONTEINERES
(prefixos, "mag-site mag-waha"), MAG_SAUDE_IGNORAR (trechos de nome de homologação, "-stage- -hml-"),
MAG_SAUDE_SRV (/srv), MAG_SAUDE_LOGS (/var/log), MAG_SAUDE_FALHAS (/var/lib/vps-backup/falhas),
MAG_SAUDE_VIGIA (/var/lib/mag-whatsapp), MAG_SAUDE_DOCKER (docker).
Uso: saude-host.py [--imprimir]
"""
import datetime as dt
import glob
import json
import os
import re
import subprocess
import sys
import tempfile

SAIDA = os.environ.get("MAG_SAUDE_SAIDA", "/opt/mag-site/data/saude-host.json")
PROJETOS = os.environ.get("MAG_SAUDE_PROJETOS", "mag-site mag-whatsapp").split()
PREFIXOS = os.environ.get("MAG_SAUDE_CONTEINERES", "mag-site mag-waha").split()
# Homologação (ex.: mag-waha-stage-20261106-waha-1, parado de propósito) não é produção: fica fora do retrato,
# do painel e dos alertas. Sem isso o painel ficaria "crítico" e o Telegram avisaria a cada 6 h por nada.
IGNORAR = os.environ.get("MAG_SAUDE_IGNORAR", "-stage- -hml-").split()
SRV = os.environ.get("MAG_SAUDE_SRV", "/srv")
LOGS = os.environ.get("MAG_SAUDE_LOGS", "/var/log")
FALHAS = os.environ.get("MAG_SAUDE_FALHAS", "/var/lib/vps-backup/falhas")
VIGIA = os.environ.get("MAG_SAUDE_VIGIA", "/var/lib/mag-whatsapp")
DOCKER = os.environ.get("MAG_SAUDE_DOCKER", "docker")
MANUTENCAO = os.environ.get("MAG_SAUDE_MANUTENCAO", "/run/mag-whatsapp-manutencao")


def iso(segundos):
    return dt.datetime.fromtimestamp(segundos, dt.timezone.utc).isoformat().replace("+00:00", "Z")


def disco(caminho="/"):
    s = os.statvfs(caminho)
    total, livre = s.f_blocks * s.f_frsize, s.f_bavail * s.f_frsize
    usado = total - s.f_bfree * s.f_frsize
    return {"usoPct": round(100 * usado / total) if total else 0, "livreGb": round(livre / 1024**3, 1)}


def memoria(arquivo="/proc/meminfo"):
    valores = {}
    with open(arquivo, encoding="utf-8") as f:
        for linha in f:
            nome, _, resto = linha.partition(":")
            valores[nome] = int(resto.split()[0])  # kB
    total, disponivel = valores.get("MemTotal", 0), valores.get("MemAvailable", 0)
    return {"usoPct": round(100 * (total - disponivel) / total) if total else 0, "disponivelMb": disponivel // 1024}


def conteineres():
    try:
        saida = subprocess.run([DOCKER, "ps", "-a", "--format", "{{.Names}}|{{.State}}|{{.Status}}"],
                               capture_output=True, text=True, timeout=20, check=True).stdout
    except Exception as erro:  # sem docker ou sem permissão: o painel mostra a ausência
        return [{"nome": "docker", "estado": f"indisponivel ({type(erro).__name__})", "saude": None}]
    lista = []
    for linha in saida.splitlines():
        nome, _, resto = linha.partition("|")
        estado, _, status = resto.partition("|")
        if not any(nome.startswith(p) for p in PREFIXOS) or any(trecho in nome for trecho in IGNORAR):
            continue
        saude = re.search(r"\((healthy|unhealthy|health: starting)\)", status)
        lista.append({"nome": nome, "estado": estado, "saude": saude.group(1) if saude else None})
    return sorted(lista, key=lambda c: c["nome"])


def ultima_linha_resultado(log):
    try:
        with open(log, encoding="utf-8", errors="replace") as f:
            linhas = [l for l in f if "RESULTADO:" in l]
    except OSError:
        return None
    return linhas[-1].split("RESULTADO:", 1)[1].strip()[:160] if linhas else None


def backups():
    lista = []
    for projeto in PROJETOS:
        pacotes = glob.glob(os.path.join(SRV, projeto, "backups", f"{projeto}-*.tar*"))
        recente = max(pacotes, key=os.path.getmtime) if pacotes else None
        resultado = ultima_linha_resultado(os.path.join(LOGS, f"vps-backup-{projeto}.log"))
        lista.append({
            "projeto": projeto,
            "ultimo": iso(os.path.getmtime(recente)) if recente else None,
            "tamanhoMb": round(os.path.getsize(recente) / 1024**2, 1) if recente else None,
            "resultado": resultado,
            "ok": bool(resultado and resultado.startswith("OK")),
            "falhaPendente": os.path.exists(os.path.join(FALHAS, f"{projeto}.falha")),
        })
    return lista


def vigia():
    caminho = os.path.join(VIGIA, "estado.json")
    if not os.path.exists(caminho):
        return None
    try:
        with open(caminho, encoding="utf-8") as f:
            estado = json.load(f)
    except (OSError, ValueError):
        return {"ok": None, "conferido": None, "desde": None, "motivo": "estado ilegível", "silenciado": False, "manutencao": False}
    numero = lambda chave: estado.get(chave) if isinstance(estado.get(chave), (int, float)) else None
    motivo = estado.get("motivo")
    # Telefones nunca saem completos: qualquer sequência longa de dígitos vira só o final.
    motivo = re.sub(r"\d{5,}", lambda m: "…" + m.group(0)[-4:], str(motivo))[:200] if motivo else None
    return {
        "ok": estado.get("ok") if isinstance(estado.get("ok"), bool) else None,
        "conferido": iso(numero("conferido")) if numero("conferido") else None,
        "desde": iso(numero("desde")) if numero("desde") else None,
        "motivo": motivo,
        "silenciado": os.path.exists(os.path.join(VIGIA, "silenciar")),
        "manutencao": os.path.exists(MANUTENCAO),
    }


def coletar():
    dados = {"versao": 1, "geradoEm": iso(dt.datetime.now(dt.timezone.utc).timestamp())}
    for chave, funcao in (("disco", disco), ("memoria", memoria), ("containers", conteineres), ("backups", backups), ("vigiaWhatsapp", vigia)):
        try:
            dados[chave] = funcao()
        except Exception as erro:  # um item com problema não derruba o resto
            dados.setdefault("erros", []).append(f"{chave}: {type(erro).__name__}")
    try:
        dados["carga"] = [round(x, 2) for x in os.getloadavg()]
    except (OSError, AttributeError):  # AttributeError: sistema sem getloadavg (só nos testes fora do Linux)
        pass
    dados["cpus"] = os.cpu_count()
    return dados


# ---------- Alertas por Telegram (decisão D3) ----------
# Recursos da VPS, contêineres essenciais e backup que não rodou. Os outros alertas já existem: queda do WhatsApp
# (vigia saude.py), falha do backup (backup-alerta.sh) e sincronização do Omie (omie-alert.py) — mesmo alert.env.
ALERT_ENV = os.environ.get("MAG_SAUDE_ALERT_ENV", "/opt/mag-site/secrets/alert.env")
TELEGRAM_API = os.environ.get("MAG_SAUDE_TELEGRAM_API", "https://api.telegram.org")  # trocado só nos testes
ESTADO_ALERTAS = os.environ.get("MAG_SAUDE_ESTADO", "/var/lib/mag-site-saude/alertas.json")
CONFIRMAR = 2            # conferências seguidas antes de avisar (evita alarme falso)
LEMBRETE_S = 6 * 3600    # lembrete enquanto continuar
ESSENCIAIS = ("mag-site-web", "mag-waha")


def problemas_criticos(dados, agora):
    """{chave: texto} do que é crítico agora. Sem telefone, segredo ou caminho de arquivo."""
    out = {}
    d = dados.get("disco") or {}
    if d.get("usoPct", 0) >= 90:
        out["disco"] = f"Disco da VPS com {d['usoPct']}% de uso ({d.get('livreGb', '?')} GB livres)."
    m = dados.get("memoria") or {}
    if m.get("usoPct", 0) >= 95:
        out["memoria"] = f"Memória da VPS com {m['usoPct']}% de uso."
    for c in dados.get("containers") or []:
        if c.get("nome", "").startswith(ESSENCIAIS) and (c.get("estado") != "running" or c.get("saude") == "unhealthy"):
            out[f"conteiner:{c['nome']}"] = f"{c['nome']}: {'sem saúde' if c.get('estado') == 'running' else 'parado (' + str(c.get('estado')) + ')'}."
    for b in dados.get("backups") or []:
        ultimo = b.get("ultimo")
        idade_h = None
        if ultimo:
            try:
                idade_h = (agora - dt.datetime.fromisoformat(ultimo.replace("Z", "+00:00")).timestamp()) / 3600
            except ValueError:
                idade_h = None
        if idade_h is None or idade_h > 26:
            out[f"backup:{b['projeto']}"] = f"Backup de {b['projeto']} não rodou nas últimas 26 h."
    return out


def ler_chaves(caminho, chaves):
    valores = {}
    try:
        with open(caminho, encoding="utf-8") as f:
            for linha in f:
                nome, sep, valor = linha.strip().partition("=")
                if sep and nome in chaves:
                    valores[nome] = valor.strip().strip('"').strip("'")
    except OSError:
        pass
    return valores


def configurado():
    chaves = ler_chaves(ALERT_ENV, ("TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"))
    return bool(chaves.get("TELEGRAM_BOT_TOKEN") and chaves.get("TELEGRAM_CHAT_ID"))


def enviar_telegram(texto):
    """True se o Telegram confirmou. Sem alert.env (token ainda não cadastrado) não faz nada. Indisponível ou recusado:
    False em no máximo 10 s, com só o tipo do erro no log (a URL leva o token e nunca é impressa)."""
    import urllib.error
    import urllib.parse
    import urllib.request
    chaves = ler_chaves(ALERT_ENV, ("TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"))
    token, chat = chaves.get("TELEGRAM_BOT_TOKEN", ""), chaves.get("TELEGRAM_CHAT_ID", "")
    if not token or not chat:
        return False
    corpo = urllib.parse.urlencode({"chat_id": chat, "text": texto[:3500], "disable_web_page_preview": "true"}).encode()
    try:
        with urllib.request.urlopen(f"{TELEGRAM_API}/bot{token}/sendMessage", corpo, timeout=10) as resposta:
            return resposta.status == 200
    except urllib.error.HTTPError as erro:  # 401 = token errado; 400 = chat errado ou bot fora do grupo
        print(f"[saude-host] Telegram recusou (HTTP {erro.code})", file=sys.stderr)
        erro.close()
        return False
    except Exception as erro:  # rede, DNS, tempo esgotado
        print(f"[saude-host] Telegram falhou: {type(erro).__name__}", file=sys.stderr)
        return False


def alertar(dados, agora=None, enviar=None, problemas=None, estado_arquivo=None):
    """Compara com o estado salvo e avisa: novo problema (depois de CONFIRMAR conferências), lembrete e resolvido.
    Aviso não entregue fica sem "avisado" e é tentado de novo na conferência seguinte."""
    agora = agora if agora is not None else dt.datetime.now(dt.timezone.utc).timestamp()
    enviar = enviar or enviar_telegram
    problemas = problemas or problemas_criticos
    estado_arquivo = estado_arquivo or ESTADO_ALERTAS
    try:
        with open(estado_arquivo, encoding="utf-8") as f:
            estado = json.load(f)
    except (OSError, ValueError):
        estado = {}
    atuais = problemas(dados, agora)
    mensagens = []
    for chave, texto in atuais.items():
        item = estado.get(chave) or {"desde": agora, "contagem": 0, "avisado": None}
        item["contagem"] = item.get("contagem", 0) + 1
        item["texto"] = texto
        if item["contagem"] >= CONFIRMAR and (not item.get("avisado") or agora - item["avisado"] >= LEMBRETE_S):
            prefixo = "Continua: " if item.get("avisado") else "ALERTA MAG: "
            if enviar(prefixo + texto):
                item["avisado"] = agora
            mensagens.append(prefixo + texto)
        estado[chave] = item
    for chave in [k for k in estado if k not in atuais]:
        item = estado.pop(chave)
        if item.get("avisado"):
            texto = f"Resolvido: {item.get('texto', chave)}"
            enviar(texto)
            mensagens.append(texto)
    os.makedirs(os.path.dirname(estado_arquivo), exist_ok=True)
    with open(estado_arquivo, "w", encoding="utf-8") as f:
        json.dump(estado, f)
    return mensagens


TESTE_TEXTO = "[TESTE] simulação do alerta do servidor; nada está errado."
TIPOS = {"ALERTA MAG: ": "alerta", "Continua: ": "lembrete", "Resolvido: ": "recuperação"}


def testar_alertas(enviar=None, agora=None):
    """Ciclo completo com um problema FICTÍCIO e relógio simulado, num estado TEMPORÁRIO: o estado real dos alertas e
    o arquivo do painel não mudam. Envia de verdade pelo alert.env: alerta, lembrete (6 h) e recuperação, e confere
    que não repete. Devolve (ok, linhas)."""
    if enviar is None and not configurado():
        return False, ["Telegram não configurado (alert.env sem token ou sem chat): nada foi enviado."]
    enviar = enviar or enviar_telegram
    t0 = agora if agora is not None else dt.datetime.now(dt.timezone.utc).timestamp()
    problemas = lambda dados, _agora: {"teste": TESTE_TEXTO} if dados.get("ficticio") else {}
    passos = (  # (rótulo, segundos desde o início, problema presente?, nota quando não envia)
        ("1ª conferência (0 min)", 0, True, "confirma antes de avisar"),
        ("2ª conferência (+5 min)", 300, True, ""),
        ("3ª conferência (+10 min)", 600, True, "não repete"),
        (f"+{LEMBRETE_S // 3600} h 05 min, problema continua", 300 + LEMBRETE_S, True, ""),
        (f"+{LEMBRETE_S // 3600} h 10 min, problema resolvido", 600 + LEMBRETE_S, False, ""),
    )
    tentativas, linhas = [], ["Teste do alerta do servidor: problema FICTÍCIO, relógio simulado, estado temporário."]

    def registrar(mensagem):
        entregue = bool(enviar(mensagem))
        tentativas.append((passo, next(t for p, t in TIPOS.items() if mensagem.startswith(p)), entregue))
        return entregue

    with tempfile.TemporaryDirectory(prefix="mag-saude-teste-") as pasta:
        estado = os.path.join(pasta, "alertas.json")
        for passo, (rotulo, segundos, presente, nota) in enumerate(passos):
            antes = len(tentativas)
            alertar({"ficticio": presente}, t0 + segundos, registrar, problemas, estado)
            novas = tentativas[antes:]
            if not novas:
                linhas.append(f"{rotulo}: nenhum envio" + (f" ({nota})" if nota else ""))
            for _, tipo, entregue in novas:
                linhas.append(f"{rotulo}: {tipo} " + ("entregue" if entregue else "NÃO entregue (Telegram indisponível ou recusou; a próxima conferência tenta de novo)"))
    esperado = [(1, "alerta", True), (3, "lembrete", True), (4, "recuperação", True)]
    ok = tentativas == esperado
    entregues = [t for _, t, e in tentativas if e]
    linhas.append(f"Resultado: {'OK' if ok else 'FALHOU'}: {len(entregues)} de 3 mensagens entregues"
                  + (f" ({', '.join(entregues)})" if entregues else "")
                  + ("" if ok else "; o painel e o resto do servidor não dependem do Telegram"))
    return ok, linhas


def gravar(dados):
    pasta = os.path.dirname(SAIDA)
    fd, temporario = tempfile.mkstemp(prefix=".saude-host-", dir=pasta)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(dados, f, ensure_ascii=False)
        os.chmod(temporario, 0o644)
        os.replace(temporario, SAIDA)
    except BaseException:
        if os.path.exists(temporario):
            os.unlink(temporario)
        raise


if __name__ == "__main__":
    if "--testar-alertas" in sys.argv:  # não coleta nem grava nada do servidor
        resultado, saida = testar_alertas()
        print("\n".join(saida))
        sys.exit(0 if resultado else 1)
    dados = coletar()
    if "--imprimir" in sys.argv:
        print(json.dumps(dados, ensure_ascii=False, indent=2))
    else:
        gravar(dados)
        if "--alertar" in sys.argv:
            alertar(dados)
