#!/usr/bin/env python3
"""Saúde do servidor para o painel "Saúde do sistema" do site MAG (módulo 1 — estabilidade).

Roda a cada 5 min pelo cron (deploy/cron/mag-site-saude) e grava, de forma atômica, um JSON pequeno na pasta de
dados do site (/opt/mag-site/data/saude-host.json, montada no contêiner como SITE_DATA_DIR). O site só LÊ o arquivo.

Conteúdo: disco, memória, carga, contêineres do site e do WhatsApp, último backup de cada projeto (pacote, linha
RESULTADO do log e marcador de falha) e o estado do vigia do WhatsApp. Nunca grava segredo, telefone completo,
conteúdo de mensagem nem nome de arquivo de backup. Somente leitura do servidor: não reinicia nem altera nada.

Variáveis (opcionais): MAG_SAUDE_SAIDA, MAG_SAUDE_PROJETOS ("mag-site mag-whatsapp"), MAG_SAUDE_CONTEINERES
(prefixos, "mag-site mag-waha"), MAG_SAUDE_SRV (/srv), MAG_SAUDE_LOGS (/var/log), MAG_SAUDE_FALHAS
(/var/lib/vps-backup/falhas), MAG_SAUDE_VIGIA (/var/lib/mag-whatsapp), MAG_SAUDE_DOCKER (docker).
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
        if not any(nome.startswith(p) for p in PREFIXOS):
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
    dados = coletar()
    if "--imprimir" in sys.argv:
        print(json.dumps(dados, ensure_ascii=False, indent=2))
    else:
        gravar(dados)
