"""Telegram FALSO para os testes: servidor HTTP local (127.0.0.1, porta livre) que imita getMe, getUpdates e
sendMessage, e guarda o que recebeu. Nada sai da máquina."""
import json
import socket
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = "123456789:AAFalsoSoParaTestes_abcdefghijklmnopq"
GRUPO = -1001234567890
NOME_BOT = "mag_alertas_teste_bot"

# Um privado (com texto e pessoa que NUNCA podem aparecer na saída), o bot entrando no grupo e uma menção no grupo.
ATUALIZACOES = [
    {"update_id": 1, "message": {"message_id": 5, "chat": {"id": 555000111, "type": "private", "first_name": "Fulana"},
                                 "from": {"id": 555000111, "first_name": "Fulana"}, "text": "oi CONVERSA-PRIVADA"}},
    {"update_id": 2, "my_chat_member": {"chat": {"id": GRUPO, "type": "supergroup", "title": "Grupo dos Alertas"},
                                        "from": {"id": 555000111, "first_name": "Fulana"},
                                        "new_chat_member": {"status": "member"}}},
    {"update_id": 3, "message": {"message_id": 6, "chat": {"id": GRUPO, "type": "supergroup", "title": "Grupo dos Alertas"},
                                 "from": {"id": 555000111, "first_name": "Fulana"}, "text": f"@{NOME_BOT} oi TEXTO-DO-GRUPO"}},
]


class TelegramFalso:
    def __init__(self, atualizacoes=None, chats_validos=(GRUPO,)):
        self.recebidas = []
        self.atualizacoes = ATUALIZACOES if atualizacoes is None else atualizacoes
        self.chats_validos = set(chats_validos)
        falso = self

        class Pedido(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def responder(self, codigo, corpo):
                dados = json.dumps(corpo).encode()
                self.send_response(codigo)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(dados)))
                self.end_headers()
                self.wfile.write(dados)

            def tratar(self):
                partes = self.path.split("?")[0].strip("/").split("/")
                tamanho = int(self.headers.get("Content-Length") or 0)
                params = dict(urllib.parse.parse_qsl(self.rfile.read(tamanho).decode())) if tamanho else {}
                if len(partes) != 2 or partes[0] != f"bot{TOKEN}":
                    return self.responder(401, {"ok": False, "error_code": 401, "description": "Unauthorized"})
                metodo = partes[1]
                falso.recebidas.append((metodo, params))
                if metodo == "getMe":
                    return self.responder(200, {"ok": True, "result": {"id": 1, "is_bot": True, "username": NOME_BOT}})
                if metodo == "getUpdates":
                    return self.responder(200, {"ok": True, "result": falso.atualizacoes})
                if metodo == "sendMessage":
                    try:
                        chat = int(params.get("chat_id", ""))
                    except ValueError:
                        chat = None
                    if chat not in falso.chats_validos:
                        return self.responder(400, {"ok": False, "error_code": 400, "description": "Bad Request: chat not found"})
                    return self.responder(200, {"ok": True, "result": {"message_id": len(falso.recebidas)}})
                return self.responder(404, {"ok": False, "error_code": 404, "description": "Not Found"})

            do_GET = tratar
            do_POST = tratar

        self.http = ThreadingHTTPServer(("127.0.0.1", 0), Pedido)
        self.url = f"http://127.0.0.1:{self.http.server_address[1]}"
        threading.Thread(target=self.http.serve_forever, daemon=True).start()

    def mensagens(self):
        return [params.get("text") for metodo, params in self.recebidas if metodo == "sendMessage"]

    def fechar(self):
        self.http.shutdown()
        self.http.server_close()


def porta_fechada():
    """Endereço local onde ninguém escuta: o Telegram "fora do ar"."""
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        porta = s.getsockname()[1]
    return f"http://127.0.0.1:{porta}"
