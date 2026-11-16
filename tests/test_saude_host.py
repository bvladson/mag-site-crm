"""Testes do deploy/bin/saude-host.py com um servidor de mentira em pasta temporária.

python -m unittest tests/test_saude_host.py  (roda também no Windows: disco/carga ausentes viram "erros").
"""
import contextlib
import importlib.util
import io
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

RAIZ = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import telegram_falso as tf  # noqa: E402


def carregar(env):
    with mock.patch.dict(os.environ, env):
        spec = importlib.util.spec_from_file_location("saude_host", RAIZ / "deploy" / "bin" / "saude-host.py")
        modulo = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(modulo)
        return modulo


class SaudeHostTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = pathlib.Path(self.tmp.name)
        self.base = base
        for pasta in ("srv/mag-site/backups", "srv/mag-whatsapp/backups", "log", "falhas", "vigia", "dados"):
            (base / pasta).mkdir(parents=True)
        antigo = base / "srv/mag-site/backups/mag-site-20261112-033502.tar.gz"
        novo = base / "srv/mag-site/backups/mag-site-20261113-033501.tar.gz"
        antigo.write_bytes(b"x" * 10)
        novo.write_bytes(b"x" * 2 * 1024 * 1024)
        os.utime(antigo, (time.time() - 86400, time.time() - 86400))
        (base / "log/vps-backup-mag-site.log").write_text(
            "2026-11-12 03:35:07  RESULTADO: FALHA PARCIAL — sem cópia externa\n2026-11-13 03:35:07  RESULTADO: OK (local + externo)\n", encoding="utf-8")
        (base / "falhas/mag-whatsapp.falha").write_text("geracao 1", encoding="utf-8")
        (base / "vigia/estado.json").write_text(json.dumps(
            {"ok": False, "desde": 1763000000, "conferido": 1763000300, "motivo": "sessao FAILED no numero 5585998610074", "avisado": 1763000300}), encoding="utf-8")
        (base / "meminfo").write_text("MemTotal:  8000000 kB\nMemFree:  100000 kB\nMemAvailable:  2000000 kB\n", encoding="utf-8")
        self.saida = base / "dados/saude-host.json"
        self.env = {
            "MAG_SAUDE_SAIDA": str(self.saida), "MAG_SAUDE_SRV": str(base / "srv"), "MAG_SAUDE_LOGS": str(base / "log"),
            "MAG_SAUDE_FALHAS": str(base / "falhas"), "MAG_SAUDE_VIGIA": str(base / "vigia"),
            "MAG_SAUDE_MANUTENCAO": str(base / "manutencao-inexistente"),
            "MAG_SAUDE_ESTADO": str(base / "estado" / "alertas.json"),
            "MAG_SAUDE_ALERT_ENV": str(base / "alert-inexistente.env"),
        }
        self.m = carregar(self.env)

    def tearDown(self):
        self.tmp.cleanup()

    def docker(self, *args, **kwargs):
        saida = "\n".join([
            "mag-site-web-1|running|Up 3 hours (healthy)",
            "mag-waha-waha-1|running|Up 2 days (unhealthy)",
            "mag-site-omie-sync-1|exited|Exited (0) 5 hours ago",
            "biomie-v2-web-1|running|Up 9 days (healthy)",
            "mag-waha-stage-20261106-waha-1|exited|Exited (0) 4 days ago",
            "mag-waha-stage-20261106-etapa2-waha-1|running|Up 4 days (unhealthy)",
            "mag-site-hml-web-1|exited|Exited (137) 2 days ago",
        ])
        return subprocess.CompletedProcess(args, 0, stdout=saida, stderr="")

    def test_coleta_backups_conteineres_vigia_e_memoria_sem_dados_sensiveis(self):
        with mock.patch.object(self.m.subprocess, "run", self.docker):
            self.m.memoria = lambda arquivo=str(self.base / "meminfo"), f=self.m.memoria: f(arquivo)
            dados = self.m.coletar()
        site, whatsapp = dados["backups"]
        self.assertEqual(site["projeto"], "mag-site")
        self.assertTrue(site["ok"])
        self.assertEqual(site["resultado"], "OK (local + externo)")
        self.assertEqual(site["tamanhoMb"], 2.0, "o pacote mais recente, não o mais antigo")
        self.assertFalse(site["falhaPendente"])
        self.assertEqual((whatsapp["ultimo"], whatsapp["ok"], whatsapp["falhaPendente"]), (None, False, True))
        self.assertEqual([c["nome"] for c in dados["containers"]], ["mag-site-omie-sync-1", "mag-site-web-1", "mag-waha-waha-1"],
                         "só os contêineres de produção do site e do WhatsApp (homologação fica fora)")
        self.assertEqual(dados["containers"][2]["saude"], "unhealthy")
        self.assertEqual(dados["memoria"], {"usoPct": 75, "disponivelMb": 1953})
        vigia = dados["vigiaWhatsapp"]
        self.assertIs(vigia["ok"], False)
        self.assertEqual(vigia["motivo"], "sessao FAILED no numero …0074", "telefone nunca sai completo")
        texto = json.dumps(dados)
        self.assertNotIn("5585998610074", texto)
        self.assertNotIn("20261113-033501", texto, "nome do pacote de backup não sai")

    def test_grava_de_forma_atomica_e_legivel(self):
        with mock.patch.object(self.m.subprocess, "run", self.docker):
            self.m.gravar(self.m.coletar())
        dados = json.loads(self.saida.read_text(encoding="utf-8"))
        self.assertEqual(dados["versao"], 1)
        self.assertTrue(dados["geradoEm"].endswith("Z"))
        self.assertEqual([p.name for p in self.saida.parent.iterdir()], ["saude-host.json"], "sem temporários largados")

    def test_alerta_confirma_antes_lembra_e_avisa_resolvido(self):
        enviados = []
        enviar = lambda texto: enviados.append(texto) or True
        t0 = 1_800_000_000
        iso = lambda s: self.m.iso(s)
        ruim = {
            "disco": {"usoPct": 96, "livreGb": 3.2}, "memoria": {"usoPct": 40},
            "containers": [{"nome": "mag-site-web-1", "estado": "running", "saude": "healthy"},
                           {"nome": "mag-waha-waha-1", "estado": "exited", "saude": None},
                           {"nome": "mag-site-omie-sync-1", "estado": "exited", "saude": None}],
            "backups": [{"projeto": "mag-site", "ultimo": iso(t0 - 3600)}, {"projeto": "mag-whatsapp", "ultimo": iso(t0 - 30 * 3600)}],
        }
        self.assertEqual(self.m.alertar(ruim, t0, enviar), [], "primeira conferência só anota")
        primeira = self.m.alertar(ruim, t0 + 300, enviar)
        self.assertEqual(sorted(primeira), sorted([
            "ALERTA MAG: Disco da VPS com 96% de uso (3.2 GB livres).",
            "ALERTA MAG: mag-waha-waha-1: parado (exited).",
            "ALERTA MAG: Backup de mag-whatsapp não rodou nas últimas 26 h.",
        ]), "sincronização (omie-sync) parada não é essencial")
        self.assertEqual(self.m.alertar(ruim, t0 + 600, enviar), [], "não repete")
        lembrete = self.m.alertar(ruim, t0 + 300 + 6 * 3600, enviar)
        self.assertTrue(lembrete and all(m.startswith("Continua: ") for m in lembrete))
        bom = {"disco": {"usoPct": 50, "livreGb": 40}, "memoria": {"usoPct": 40},
               "containers": [{"nome": "mag-waha-waha-1", "estado": "running", "saude": "healthy"}],
               "backups": [{"projeto": "mag-site", "ultimo": iso(t0 + 7 * 3600)}, {"projeto": "mag-whatsapp", "ultimo": iso(t0 + 7 * 3600)}]}
        resolvido = self.m.alertar(bom, t0 + 7 * 3600, enviar)
        self.assertEqual(len(resolvido), 3)
        self.assertTrue(all(m.startswith("Resolvido: ") for m in resolvido))
        self.assertEqual(self.m.alertar(bom, t0 + 8 * 3600, enviar), [])

    def test_sem_token_nao_envia_e_nao_quebra(self):
        self.assertFalse(self.m.enviar_telegram("teste"))
        ruim = {"disco": {"usoPct": 99, "livreGb": 1}, "backups": []}
        self.m.alertar(ruim, 1_800_000_000)
        self.assertEqual(self.m.alertar(ruim, 1_800_000_300), ["ALERTA MAG: Disco da VPS com 99% de uso (1 GB livres)."],
                         "sem token a mensagem não sai, mas o estado segue e tenta de novo")

    def test_homologacao_parada_nao_vira_alerta(self):
        """Retrato da produção em 16/11/2026: tudo saudável e um WhatsApp de homologação parado de propósito."""
        def docker(*args, **kwargs):
            saida = "\n".join([
                "mag-site-omie-consulta-1|running|Up 2 hours (healthy)",
                "mag-site-omie-pedidos-1|running|Up 2 hours (healthy)",
                "mag-site-web-1|running|Up 2 hours (healthy)",
                "mag-waha-stage-20261106-etapa2-waha-1|running|Up 4 days (healthy)",
                "mag-waha-stage-20261106-waha-1|exited|Exited (0) 4 days ago",
                "mag-waha-waha-1|running|Up 4 days (healthy)",
            ])
            return subprocess.CompletedProcess(args, 0, stdout=saida, stderr="")
        with mock.patch.object(self.m.subprocess, "run", docker):
            containers = self.m.conteineres()
        self.assertNotIn("stage", json.dumps(containers))
        agora = time.time()
        dados = {"disco": {"usoPct": 75, "livreGb": 23.6}, "memoria": {"usoPct": 46}, "containers": containers,
                 "backups": [{"projeto": "mag-site", "ultimo": self.m.iso(agora - 3600)},
                             {"projeto": "mag-whatsapp", "ultimo": self.m.iso(agora - 7 * 3600)}]}
        self.assertEqual(self.m.problemas_criticos(dados, agora), {}, "nada crítico: nenhum alerta")
        enviados = []
        for passo in range(3):
            self.m.alertar(dados, agora + passo * 300, lambda texto: enviados.append(texto) or True)
        self.assertEqual(enviados, [])

    def test_servicos_de_producao_continuam_monitorados(self):
        """Todos os serviços de produção do compose continuam na coleta; os essenciais parados viram alerta."""
        producao = ["mag-site-omie-consulta-1", "mag-site-omie-indice-1", "mag-site-omie-pedidos-1", "mag-site-omie-sync-1",
                    "mag-site-social-sync-1", "mag-site-web-1", "mag-waha-waha-1"]
        def docker(*args, **kwargs):
            linhas = [f"{nome}|exited|Exited (1) 1 minute ago" for nome in producao]
            linhas += ["mag-waha-stage-20261106-waha-1|exited|Exited (0) 4 days ago", "mag-site-hml-web-1|exited|Exited (0) 1 day ago"]
            return subprocess.CompletedProcess(args, 0, stdout="\n".join(linhas), stderr="")
        with mock.patch.object(self.m.subprocess, "run", docker):
            containers = self.m.conteineres()
        self.assertEqual([c["nome"] for c in containers], producao, "nenhum serviço de produção fica de fora")
        criticos = self.m.problemas_criticos({"containers": containers, "backups": []}, time.time())
        self.assertEqual(sorted(criticos), ["conteiner:mag-site-web-1", "conteiner:mag-waha-waha-1"],
                         "site e WhatsApp parados são críticos; os de manutenção (omie-sync etc.) não")

    def carregar_com_telegram(self, api, chat=tf.GRUPO):
        env = self.base / "alert.env"
        env.write_text(f"TELEGRAM_BOT_TOKEN={tf.TOKEN}\nTELEGRAM_CHAT_ID={chat}\n", encoding="utf-8")
        return carregar({**self.env, "MAG_SAUDE_ALERT_ENV": str(env), "MAG_SAUDE_TELEGRAM_API": api})

    def test_teste_do_ciclo_entrega_alerta_lembrete_e_recuperacao(self):
        falso = tf.TelegramFalso()
        try:
            m = self.carregar_com_telegram(falso.url)
            ok, linhas = m.testar_alertas()
        finally:
            falso.fechar()
        self.assertTrue(ok, "\n".join(linhas))
        self.assertEqual(falso.mensagens(), ["ALERTA MAG: " + m.TESTE_TEXTO, "Continua: " + m.TESTE_TEXTO, "Resolvido: " + m.TESTE_TEXTO],
                         "um alerta, um lembrete depois de 6 h e a recuperação; nada repetido")
        self.assertIn("3ª conferência (+10 min): nenhum envio (não repete)", linhas)
        self.assertFalse((self.base / "estado" / "alertas.json").exists(), "o estado real dos alertas não muda")
        self.assertFalse(self.saida.exists(), "o arquivo do painel não muda")

    def test_telegram_indisponivel_nao_quebra_e_tenta_de_novo(self):
        m = self.carregar_com_telegram(tf.porta_fechada())
        erros = io.StringIO()
        inicio = time.monotonic()
        with contextlib.redirect_stderr(erros):
            ok, linhas = m.testar_alertas()
        self.assertLess(time.monotonic() - inicio, 60)
        self.assertFalse(ok)
        self.assertEqual(sum("alerta NÃO entregue" in linha for linha in linhas), 3, "tenta de novo a cada conferência")
        self.assertFalse(any("recuperação" in linha for linha in linhas[:-1]), "sem 'Resolvido' de alerta que não chegou")
        self.assertIn("Telegram falhou: URLError", erros.getvalue())
        self.assertNotIn(tf.TOKEN, erros.getvalue() + "\n".join(linhas))
        # Rotina normal do cron com o Telegram fora: o painel é gravado e o estado guarda o problema para avisar depois.
        with mock.patch.object(m.subprocess, "run", self.docker), contextlib.redirect_stderr(io.StringIO()):
            dados = m.coletar()
            m.gravar(dados)
            dados["disco"] = {"usoPct": 97, "livreGb": 1.0}
            m.alertar(dados)
            m.alertar(dados)
        self.assertTrue(self.saida.exists(), "o arquivo do painel é gravado mesmo sem Telegram")
        estado = json.loads((self.base / "estado" / "alertas.json").read_text(encoding="utf-8"))
        self.assertIsNone(estado["disco"]["avisado"], "alerta não entregue fica pendente para a próxima conferência")

    def test_telegram_recusado_mostra_so_o_codigo(self):
        falso = tf.TelegramFalso()
        try:
            m = self.carregar_com_telegram(falso.url, chat=-1)
            erros = io.StringIO()
            with contextlib.redirect_stderr(erros):
                self.assertFalse(m.enviar_telegram("ALERTA MAG: teste"))
        finally:
            falso.fechar()
        self.assertIn("Telegram recusou (HTTP 400)", erros.getvalue())
        self.assertNotIn(tf.TOKEN, erros.getvalue())

    def test_sem_token_o_teste_do_ciclo_nao_envia(self):
        ok, linhas = self.m.testar_alertas()
        self.assertFalse(ok)
        self.assertIn("não configurado", linhas[0])

    def test_docker_indisponivel_nao_derruba_a_coleta(self):
        def falha(*args, **kwargs):
            raise FileNotFoundError("docker")
        with mock.patch.object(self.m.subprocess, "run", falha):
            dados = self.m.coletar()
        self.assertEqual(dados["containers"][0]["nome"], "docker")
        self.assertIn("backups", dados)


if __name__ == "__main__":
    unittest.main()
