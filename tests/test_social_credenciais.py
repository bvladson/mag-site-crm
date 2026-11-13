# python -m unittest tests/test_social_credenciais.py — sem rede: TikTok e LinkedIn simulados num servidor local.
import contextlib
import importlib.util
import io
import json
import os
import stat
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from unittest import mock
from urllib.parse import parse_qs, urlsplit

RAIZ = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("social_credenciais", RAIZ / "deploy" / "bin" / "social-credenciais.py")
sc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sc)

CHAVE_YT = "AIza" + "B" * 35
CANAL = "UC" + "c" * 22
RECEBIDO = {}


class Simulado(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def responder(self, codigo, corpo):
        dados = json.dumps(corpo).encode()
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(dados)))
        self.end_headers()
        self.wfile.write(dados)

    def do_POST(self):
        RECEBIDO["token"] = parse_qs(self.rfile.read(int(self.headers["Content-Length"])).decode())
        self.responder(200, {"access_token": "act.ACESSO-SECRETO-123", "refresh_token": "rft.REFRESH-SECRETO-456", "refresh_expires_in": 31536000,
                             "expires_in": 86400, "open_id": "open-1", "scope": "user.info.basic,video.list"})

    def do_GET(self):
        caminho = urlsplit(self.path)
        consulta = parse_qs(caminho.query)
        if caminho.path == "/youtube/v3/channels":
            RECEBIDO["youtube"] = consulta
            canais = {
                "@magmoveiscorporativos7222": {"id": "UC" + "m" * 22, "snippet": {"title": "MAG Móveis Corporativos", "customUrl": "@magmoveiscorporativos7222"}},
                "@impostor": {"id": "UC" + "x" * 22, "snippet": {"title": "Outro canal", "customUrl": "@outro"}},
            }
            canal = canais.get(consulta.get("forHandle", [""])[0])
            return self.responder(200, {"items": [canal] if canal else []})
        if caminho.path == "/rest/organizations":
            return self.responder(200, {"elements": [{"id": 111, "vanityName": "magmoveiscorporativos", "localizedName": "MAG"}]})
        RECEBIDO["acl"] = dict(self.headers)
        self.responder(200, {"elements": [
            {"role": "ADMINISTRATOR", "organizationTarget": "urn:li:organization:111", "state": "APPROVED"},
            {"role": "ANALYST", "organizationTarget": "urn:li:organization:222", "state": "APPROVED"},
        ]})


class Credenciais(unittest.TestCase):
    def setUp(self):
        self.pasta = tempfile.TemporaryDirectory()
        self.arquivo = os.path.join(self.pasta.name, "social.env")
        Path(self.arquivo).write_text("# comentário que fica\nOUTRA=1\n", encoding="utf-8")
        self.patch = mock.patch.object(sc, "ARQUIVO", self.arquivo)
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        self.pasta.cleanup()

    def rodar(self, funcao, *args, entradas=(), segredos=()):
        saida = io.StringIO()
        with mock.patch.object(sys, "stdin", io.StringIO("".join(f"{linha}\n" for linha in entradas))), \
                mock.patch.object(sc.getpass, "getpass", side_effect=list(segredos)), contextlib.redirect_stdout(saida):
            funcao(*args)
        return saida.getvalue()

    def test_definir_youtube_valida_formato_e_nao_mostra_segredo(self):
        texto = self.rodar(sc.definir, "youtube", entradas=["canal-errado", CANAL], segredos=["chave-errada", CHAVE_YT])
        conteudo = Path(self.arquivo).read_text(encoding="utf-8")
        self.assertIn("# comentário que fica", conteudo)
        self.assertIn("OUTRA=1", conteudo)
        self.assertIn(f"YOUTUBE_API_KEY={CHAVE_YT}", conteudo)
        self.assertIn(f"YOUTUBE_CHANNEL_ID={CANAL}", conteudo)
        self.assertNotIn(CHAVE_YT, texto)
        self.assertIn("formato inválido", texto)
        if os.name != "nt":
            self.assertEqual(stat.S_IMODE(os.stat(self.arquivo).st_mode), 0o600)
        resumo = self.rodar(sc.status)
        self.assertIn("YOUTUBE_API_KEY definido", resumo)
        self.assertIn(f"YOUTUBE_CHANNEL_ID={CANAL}", resumo, "ID público aparece para conferência")
        self.assertNotIn(CHAVE_YT, resumo)

    def test_segredo_com_caractere_perigoso_e_recusado(self):
        texto = self.rodar(sc.definir, "instagram", segredos=["IGQV$(rm -rf /)", "IGQV token com espaco", "IGQVJ" + "a" * 60])
        self.assertEqual(texto.count("formato inválido"), 2)
        self.assertIn("INSTAGRAM_ACCESS_TOKEN=IGQVJ", Path(self.arquivo).read_text(encoding="utf-8"))

    def test_linkedin_refresh_exige_cliente(self):
        with self.assertRaises(SystemExit):
            self.rodar(sc.definir, "linkedin", entradas=["111", ""], segredos=["AQV" + "x" * 40, "AQR" + "y" * 40, ""])
        self.assertNotIn("LINKEDIN", Path(self.arquivo).read_text(encoding="utf-8"), "nada gravado")

    def test_remover_pede_confirmacao(self):
        sc.gravar({"INSTAGRAM_ACCESS_TOKEN": "IGQVJ" + "a" * 60})
        with self.assertRaises(SystemExit):
            self.rodar(sc.remover, "instagram", entradas=["nao"])
        self.assertIn("INSTAGRAM_ACCESS_TOKEN", Path(self.arquivo).read_text(encoding="utf-8"))
        self.rodar(sc.remover, "instagram", entradas=["REMOVER"])
        self.assertNotIn("INSTAGRAM_ACCESS_TOKEN", Path(self.arquivo).read_text(encoding="utf-8"))

    def com_servidor(self):
        servidor = HTTPServer(("127.0.0.1", 0), Simulado)
        threading.Thread(target=servidor.serve_forever, daemon=True).start()
        self.addCleanup(servidor.server_close)
        self.addCleanup(servidor.shutdown)
        return f"http://127.0.0.1:{servidor.server_port}"

    def test_tiktok_autorizar_confere_state_e_grava_so_o_refresh(self):
        base = self.com_servidor()
        sc.gravar({"TIKTOK_CLIENT_KEY": "awclientkey123", "TIKTOK_CLIENT_SECRET": "segredo-do-app-123", "TIKTOK_ACCESS_TOKEN": "act.antigo123456"})
        with mock.patch.object(sc, "TIKTOK_TOKEN", f"{base}/token"), mock.patch.object(sc.secrets, "token_urlsafe", return_value="estado123"):
            with self.assertRaises(SystemExit):  # state diferente: recusa
                self.rodar(sc.tiktok_autorizar, "https://magmoveiscorporativos.com.br/redes",
                           segredos=["https://magmoveiscorporativos.com.br/redes?code=abc&state=OUTRO"])
            texto = self.rodar(sc.tiktok_autorizar, "https://magmoveiscorporativos.com.br/redes",
                               segredos=["https://magmoveiscorporativos.com.br/redes?code=c%2Ad1&scopes=user.info.basic%2Cvideo.list&state=estado123"])
        conteudo = Path(self.arquivo).read_text(encoding="utf-8")
        self.assertIn("TIKTOK_REFRESH_TOKEN=rft.REFRESH-SECRETO-456", conteudo)
        self.assertNotIn("TIKTOK_ACCESS_TOKEN", conteudo, "o worker renova o acesso sozinho")
        self.assertNotIn("SECRETO", texto, "nenhum token na tela")
        self.assertEqual(RECEBIDO["token"]["code"], ["c*d1"], "código decodificado da URL")
        self.assertEqual(RECEBIDO["token"]["redirect_uri"], ["https://magmoveiscorporativos.com.br/redes"])
        self.assertIn("client_key=awclientkey123", texto, "link de autorização exibido")
        with self.assertRaises(SystemExit):  # redirect com parâmetros não é aceito
            self.rodar(sc.tiktok_autorizar, "https://magmoveiscorporativos.com.br/redes?x=1")

    def test_linkedin_organizacoes_lista_sem_escolher(self):
        base = self.com_servidor()
        sc.gravar({"LINKEDIN_ACCESS_TOKEN": "AQV" + "x" * 40})
        antes = Path(self.arquivo).read_text(encoding="utf-8")
        with mock.patch.object(sc, "LINKEDIN_API", base):
            texto = self.rodar(sc.linkedin_organizacoes)
        self.assertIn("urn:li:organization:111  papel ADMINISTRATOR", texto)
        self.assertIn("urn:li:organization:222  papel ANALYST  (este papel NÃO lê as publicações)", texto)
        self.assertEqual(Path(self.arquivo).read_text(encoding="utf-8"), antes, "nada gravado")
        self.assertEqual(RECEBIDO["acl"]["X-Restli-Protocol-Version"], "2.0.0")
        self.assertRegex(RECEBIDO["acl"]["Linkedin-Version"], r"^\d{6}$")

    def test_definir_youtube_sem_id_para_achar_depois(self):
        self.rodar(sc.definir, "youtube", entradas=[""], segredos=[CHAVE_YT])
        conteudo = Path(self.arquivo).read_text(encoding="utf-8")
        self.assertIn(f"YOUTUBE_API_KEY={CHAVE_YT}", conteudo)
        self.assertNotIn("YOUTUBE_CHANNEL_ID", conteudo)

    def test_youtube_canal_pela_api_oficial_so_com_confirmacao(self):
        base = self.com_servidor()
        sc.gravar({"YOUTUBE_API_KEY": CHAVE_YT})
        oficial = "https://www.youtube.com/@magmoveiscorporativos7222"
        with mock.patch.object(sc, "YOUTUBE_API", base):
            with self.assertRaises(SystemExit):
                self.rodar(sc.youtube_canal, oficial, entradas=["nao"])
            self.assertNotIn("YOUTUBE_CHANNEL_ID", Path(self.arquivo).read_text(encoding="utf-8"), "sem CONFIRMO nada é gravado")
            texto = self.rodar(sc.youtube_canal, oficial, entradas=["CONFIRMO"])
            with self.assertRaises(SystemExit):  # canal devolvido com outro @handle: recusa
                self.rodar(sc.youtube_canal, "https://www.youtube.com/@impostor", entradas=["CONFIRMO"])
            with self.assertRaises(SystemExit):  # endereço que não é @handle
                self.rodar(sc.youtube_canal, "https://www.youtube.com/channel/UC123")
        self.assertIn("YOUTUBE_CHANNEL_ID=UC" + "m" * 22, Path(self.arquivo).read_text(encoding="utf-8"))
        self.assertIn("MAG Móveis Corporativos", texto)
        self.assertNotIn(CHAVE_YT, texto, "a chave nunca aparece")
        self.assertEqual(RECEBIDO["youtube"]["forHandle"], ["@impostor"])
        self.assertEqual(RECEBIDO["youtube"]["part"], ["id,snippet"])

    def test_linkedin_verificar_exige_a_pagina_oficial(self):
        base = self.com_servidor()
        oficial = "https://www.linkedin.com/company/magmoveiscorporativos"
        with mock.patch.object(sc, "LINKEDIN_API", base):
            sc.gravar({"LINKEDIN_ACCESS_TOKEN": "AQV" + "x" * 40, "LINKEDIN_ORGANIZATION_ID": "111"})
            self.assertIn("CONFERE: a organização 111", self.rodar(sc.linkedin_verificar, oficial))
            sc.gravar({"LINKEDIN_ORGANIZATION_ID": "222"})
            with self.assertRaises(SystemExit) as falha:
                self.rodar(sc.linkedin_verificar, oficial)
            self.assertIn("NÃO CONFERE", str(falha.exception.code))
            with self.assertRaises(SystemExit):
                self.rodar(sc.linkedin_verificar, "https://www.linkedin.com/in/pessoa")

    def test_versao_linkedin(self):
        from datetime import datetime, timezone
        self.assertEqual(sc.linkedin_versao(datetime(2026, 10, 6, tzinfo=timezone.utc)), "202608")
        self.assertEqual(sc.linkedin_versao(datetime(2026, 1, 31, tzinfo=timezone.utc)), "202511")
        self.assertEqual(sc.linkedin_versao(datetime(2026, 2, 1, tzinfo=timezone.utc)), "202512")


if __name__ == "__main__":
    unittest.main()
