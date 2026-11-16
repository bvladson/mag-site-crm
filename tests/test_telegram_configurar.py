"""Testes do deploy/bin/telegram-configurar.py contra um Telegram FALSO local (tests/telegram_falso.py).

python -m unittest tests/test_telegram_configurar.py  (as permissões 600/root são conferidas só no Linux; como root
também o dono root:root).
"""
import contextlib
import importlib.util
import io
import os
import pathlib
import stat
import sys
import tempfile
import time
import unittest
from unittest import mock

RAIZ = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import telegram_falso as tf  # noqa: E402

spec = importlib.util.spec_from_file_location("telegram_configurar", RAIZ / "deploy" / "bin" / "telegram-configurar.py")
tc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tc)
POSIX = os.name == "posix"
ROOT = POSIX and os.geteuid() == 0
PROIBIDOS = (tf.TOKEN, "Fulana", "555000111", "CONVERSA-PRIVADA", "TEXTO-DO-GRUPO")


class ConfigurarTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.pasta = pathlib.Path(self.tmp.name) / "secrets"
        self.pasta.mkdir(mode=0o700)
        self.arquivo = self.pasta / "alert.env"
        self.falso = tf.TelegramFalso()
        self.saida, self.perguntas = [], []

    def tearDown(self):
        self.falso.fechar()
        self.tmp.cleanup()

    def perguntar(self, resposta=""):
        def responder(pergunta):
            self.perguntas.append(pergunta)
            return resposta
        return responder

    def rodar(self, token=tf.TOKEN, resposta="", api=None):
        return tc.configurar(lambda _: token, self.perguntar(resposta), self.saida.append, str(self.arquivo),
                             api or self.falso.url, (0, 0) if ROOT else None)

    def texto(self):
        return "\n".join(self.saida + self.perguntas)

    def test_guiado_grava_600_mostra_so_o_numero_e_manda_teste(self):
        self.assertEqual(self.rodar(), 0, self.texto())
        linhas = self.arquivo.read_text(encoding="utf-8").splitlines()
        self.assertEqual(linhas[1:], [f"TELEGRAM_BOT_TOKEN={tf.TOKEN}", f"TELEGRAM_CHAT_ID={tf.GRUPO}"])
        self.assertTrue(linhas[0].startswith("#"))
        if POSIX:
            self.assertEqual(stat.S_IMODE(self.arquivo.stat().st_mode), 0o600)
        if ROOT:
            self.assertEqual((self.arquivo.stat().st_uid, self.arquivo.stat().st_gid), (0, 0))
            self.assertIn("alert.env gravado: 600 root:root", self.saida)
        self.assertIn(f"Grupo encontrado: {tf.GRUPO}", self.saida)
        self.assertEqual(self.falso.mensagens(), [tc.TESTE])
        self.assertIn("Mensagem de teste: entregue no grupo.", self.saida)
        for proibido in PROIBIDOS + ("Grupo dos Alertas",):
            self.assertNotIn(proibido, self.texto(), "só o identificador do grupo aparece")
        self.assertEqual([p.name for p in self.pasta.iterdir()], ["alert.env"], "sem temporário largado")

    def test_preserva_outras_linhas_e_troca_os_valores_antigos(self):
        self.arquivo.write_text("# já existia\nOUTRA_CHAVE=1\nTELEGRAM_BOT_TOKEN=velho\nexport TELEGRAM_CHAT_ID=-1\n", encoding="utf-8")
        self.assertEqual(self.rodar(), 0, self.texto())
        self.assertEqual(self.arquivo.read_text(encoding="utf-8").splitlines(),
                         ["# já existia", "OUTRA_CHAVE=1", f"TELEGRAM_BOT_TOKEN={tf.TOKEN}", f"TELEGRAM_CHAT_ID={tf.GRUPO}"])
        if POSIX:
            self.assertEqual(stat.S_IMODE(self.arquivo.stat().st_mode), 0o600, "fica 600 mesmo se o antigo era mais aberto")

    def test_token_em_formato_invalido_nao_grava_nem_ecoa(self):
        self.assertEqual(self.rodar(token="abc 123 senha-colada-errado"), 1)
        self.assertFalse(self.arquivo.exists())
        self.assertNotIn("senha-colada-errado", self.texto())
        self.assertEqual(self.falso.recebidas, [], "nem chega a chamar o Telegram")

    def test_token_recusado_nao_grava(self):
        outro = "987654321:BBOutroTokenQueOTelegramRecusa_abcdefgh"
        self.assertEqual(self.rodar(token=outro), 1)
        self.assertFalse(self.arquivo.exists())
        self.assertIn("HTTP 401", self.texto())
        self.assertNotIn(outro, self.texto())

    def test_telegram_indisponivel_nao_grava_e_nao_mostra_token(self):
        inicio = time.monotonic()
        self.assertEqual(self.rodar(api=tf.porta_fechada()), 1)
        self.assertLess(time.monotonic() - inicio, 20)
        self.assertFalse(self.arquivo.exists())
        self.assertIn("Telegram indisponível (URLError)", self.texto())
        self.assertNotIn(tf.TOKEN, self.texto())

    def test_mais_de_um_grupo_pede_escolha(self):
        outro = {"update_id": 9, "message": {"chat": {"id": -1009999999999, "type": "supergroup", "title": "Outro grupo"},
                                             "text": "oi"}}
        self.falso.atualizacoes = tf.ATUALIZACOES + [outro]
        self.falso.chats_validos.add(-1009999999999)
        self.assertEqual(self.rodar(resposta="2"), 0, self.texto())
        self.assertIn("TELEGRAM_CHAT_ID=-1009999999999", self.arquivo.read_text(encoding="utf-8"))

    def test_sem_grupo_nao_grava(self):
        self.falso.atualizacoes = tf.ATUALIZACOES[:1]  # só a conversa privada
        self.assertEqual(self.rodar(), 1)
        self.assertFalse(self.arquivo.exists())
        self.assertIn("Nenhum grupo escolhido. Nada foi gravado.", self.saida)

    def test_chat_id_usa_o_token_gravado_e_mostra_so_o_numero(self):
        self.arquivo.write_text(f"TELEGRAM_BOT_TOKEN={tf.TOKEN}\n", encoding="utf-8")
        self.assertEqual(tc.mostrar_chat_id(self.saida.append, str(self.arquivo), self.falso.url), 0)
        self.assertEqual(self.saida, [str(tf.GRUPO)])

    def test_grupo_que_virou_supergrupo_fica_com_o_numero_novo(self):
        atualizacoes = [{"update_id": 1, "message": {"chat": {"id": -4001, "type": "group", "title": "G"}, "migrate_to_chat_id": -1004001}},
                        {"update_id": 2, "message": {"chat": {"id": -1004001, "type": "supergroup", "title": "G"}, "migrate_from_chat_id": -4001}}]
        self.assertEqual(list(tc.grupos(atualizacoes)), [-1004001])
        self.assertEqual(tc.grupos(tf.ATUALIZACOES), {tf.GRUPO: "Grupo dos Alertas"}, "privado fica fora")

    def test_fora_dos_testes_so_aceita_a_api_oficial_e_o_arquivo_padrao(self):
        for variavel, valor in (("MAG_TELEGRAM_API", self.falso.url), ("MAG_ALERT_ENV", str(self.arquivo))):
            with mock.patch.dict(os.environ, {variavel: valor}):
                outro = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(outro)
            erros = io.StringIO()
            with contextlib.redirect_stderr(erros), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(outro.main([]), 2, variavel)
            self.assertIn("recusado", erros.getvalue())
        self.assertEqual((tc.API, tc.ALERT_ENV), ("https://api.telegram.org", "/opt/mag-site/secrets/alert.env"))
        self.assertEqual(self.falso.recebidas, [], "nada foi enviado a lugar nenhum")
        self.assertFalse(self.arquivo.exists())

    @unittest.skipUnless(POSIX, "permissões POSIX")
    def test_recusa_pasta_aberta(self):
        os.chmod(self.pasta, 0o755)
        self.assertIn("deveria ser do root e 700", tc.conferir_pasta(str(self.arquivo)))


if __name__ == "__main__":
    unittest.main()
