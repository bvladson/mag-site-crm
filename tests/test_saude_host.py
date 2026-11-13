"""Testes do deploy/bin/saude-host.py com um servidor de mentira em pasta temporária.

python -m unittest tests/test_saude_host.py  (roda também no Windows: disco/carga ausentes viram "erros").
"""
import importlib.util
import json
import os
import pathlib
import subprocess
import tempfile
import time
import unittest
from unittest import mock

RAIZ = pathlib.Path(__file__).resolve().parents[1]


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
        self.m = carregar({
            "MAG_SAUDE_SAIDA": str(self.saida), "MAG_SAUDE_SRV": str(base / "srv"), "MAG_SAUDE_LOGS": str(base / "log"),
            "MAG_SAUDE_FALHAS": str(base / "falhas"), "MAG_SAUDE_VIGIA": str(base / "vigia"),
            "MAG_SAUDE_MANUTENCAO": str(base / "manutencao-inexistente"),
        })

    def tearDown(self):
        self.tmp.cleanup()

    def docker(self, *args, **kwargs):
        saida = "\n".join([
            "mag-site-web-1|running|Up 3 hours (healthy)",
            "mag-waha-waha-1|running|Up 2 days (unhealthy)",
            "mag-site-omie-sync-1|exited|Exited (0) 5 hours ago",
            "biomie-v2-web-1|running|Up 9 days (healthy)",
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
                         "só os contêineres do site e do WhatsApp")
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

    def test_docker_indisponivel_nao_derruba_a_coleta(self):
        def falha(*args, **kwargs):
            raise FileNotFoundError("docker")
        with mock.patch.object(self.m.subprocess, "run", falha):
            dados = self.m.coletar()
        self.assertEqual(dados["containers"][0]["nome"], "docker")
        self.assertIn("backups", dados)


if __name__ == "__main__":
    unittest.main()
