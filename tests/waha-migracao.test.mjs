// Migração da produção v1 (um número só) para as linhas multiusuário, como na troca de versão: a sessão conectada segue
// a mesma (sem QR novo, sem logout/stop/start/reconfiguração) e nenhuma mensagem se perde — o que chegou durante a troca
// (site fora do ar por instantes, WhatsApp conectado) é buscado na primeira conferência, sem repetir o que a v1 gravou e
// sem importar conversa antiga. node --test tests/waha-migracao.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "mag-waha-migracao-"));
process.env.SITE_DATA_DIR = directory;
process.env.CRM_DISABLE_WORKER = "1";
const db = await import("../src/lib/local-db.server.ts");
const auth = await import("../src/lib/local-auth-core.server.ts");
const crm = await import("../src/lib/crm.server.ts");
const actor = async (email, roles) => ({ id: (await auth.createUser(email, "QA-Strong-Password-123", roles)).id, email, roles, created_at: "" });
const admin = await actor("admin@migracao.example.test", ["admin"]);
const vendedora = await actor("vendedora@migracao.example.test", ["comercial"]);
const session = "Vladson";
const autorizado = "5585911117035";
const reportado = "558511117035"; // WhatsApp reporta o celular sem o 9º dígito
const cliente = "5585900001111";
const nowS = () => Math.floor(Date.now() / 1000);

// ---- WAHA de mentira: sessão conectada e o histórico do celular; registra cada chamada --------------------------------
const calls = [];
const historico = [];
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const parsed = new URL(String(url));
  const method = String(options.method || "GET").toUpperCase();
  const path = decodeURIComponent(parsed.pathname);
  calls.push(`${method} ${path}`);
  const info = { name: session, status: "WORKING", me: { id: `${reportado}@c.us` }, config: {} };
  if (path === "/api/sessions") return json([info]);
  if (path === `/api/sessions/${session}`) return json(info);
  if (path === `/api/${session}/chats`)
    return json(historico.length ? [{ id: `${cliente}@s.whatsapp.net`, conversationTimestamp: Math.max(...historico.map((m) => m.timestamp)) }] : []);
  const match = /^\/api\/([^/]+)\/chats\/([^/]+)\/messages$/.exec(path);
  if (match) {
    const gte = Number(parsed.searchParams.get("filter.timestamp.gte") || 0);
    const lte = Number(parsed.searchParams.get("filter.timestamp.lte") || Infinity);
    const offset = Number(parsed.searchParams.get("offset") || 0);
    const limit = Number(parsed.searchParams.get("limit") || 10);
    return json(historico.filter((m) => m.timestamp >= gte && m.timestamp <= lte).sort((a, b) => b.timestamp - a.timestamp).slice(offset, offset + limit));
  }
  if (path === "/api/contacts") return json({ name: "Cliente" });
  return json({ error: "not_expected" }, 404);
};
test.after(async () => {
  globalThis.fetch = originalFetch;
  db.closeDb();
  await rm(directory, { recursive: true, force: true, maxRetries: 5 });
});

// ---- O banco da produção antes da troca: configuração da v1 + uma conversa gravada pela v1 -----------------------------
const key = randomBytes(32);
mkdirSync(join(directory, "security"), { recursive: true, mode: 0o700 });
writeFileSync(join(directory, "security", "crm-waha.key"), key, { mode: 0o600 });
const encrypt = (value) => {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
};
crm.ensureCrmSchema();
db.getDb().exec("CREATE TABLE IF NOT EXISTS crm_waha_config(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,encrypted TEXT NOT NULL,updated_at TEXT NOT NULL)");
const v1 = { enabled: true, baseUrl: "http://waha.migracao.test:3000", session, ownerId: vendedora.id, expectedPhone: autorizado,
  apiKey: "QA-API-KEY", hmacKey: "QA-HMAC-KEY", allowFullHistoryImport: false, allowAdminReplies: false };
db.getDb().prepare("INSERT INTO crm_waha_config VALUES(1,5,?,?)").run(encrypt(v1), new Date().toISOString());
const contato = crm.createContact(vendedora, { name: "Cliente de antes", phone: cliente, email: "", city: "" });
const antes = nowS() - 5 * 60;
// A v1 guardava o id completo (forma antiga); a nova versão normaliza para a forma canônica.
db.getDb()
  .prepare("INSERT INTO crm_messages(id,contact_id,provider,account,external_id,sender,text,channel,status,sent_at,read_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
  .run(randomUUID(), contato.id, "waha", session, `false_${cliente}@c.us_V1JAGRAVADA`, "cliente", "Mensagem que a v1 já gravou", "whatsapp", "received", new Date(antes * 1000).toISOString(), null);
// No celular: a mesma mensagem, uma que chegou DURANTE a troca (nunca entregue ao site) e uma conversa antiga.
historico.push(
  { id: `false_${cliente}@c.us_V1JAGRAVADA`, from: `${cliente}@c.us`, fromMe: false, timestamp: antes, body: "Mensagem que a v1 já gravou", ack: 1 },
  { id: `false_${cliente}@c.us_DURANTEATROCA`, from: `${cliente}@c.us`, fromMe: false, timestamp: nowS() - 60, body: "Chegou durante a troca", ack: 1 },
  { id: `false_${cliente}@c.us_ANTIGA2H`, from: `${cliente}@c.us`, fromMe: false, timestamp: nowS() - 2 * 3600, body: "Conversa antiga", ack: 1 },
);
const waha = await import("../src/lib/crm-waha.server.ts");
const mensagens = () => db.getDb().prepare("SELECT external_id,text FROM crm_messages WHERE provider='waha' AND account=? ORDER BY sent_at").all(session);

test("a primeira leitura vira a linha da mesma sessão e já marca de onde a conferência deve partir", () => {
  const line = waha.readWahaSettings(admin).lines.find((l) => l.status === "active");
  assert.equal(line.session, session);
  assert.equal(line.userId, vendedora.id);
  const marca = db.getDb().prepare("SELECT baseline,covered_until,last_probe FROM crm_waha_watermarks WHERE session=?").get(session);
  assert.ok(marca, "ponto de partida criado na migração");
  assert.ok(Math.abs(marca.baseline - (nowS() - 15 * 60)) <= 5, "15 minutos para trás");
  assert.equal(marca.last_probe, 0, "a primeira conferência roda já");
});

test("a primeira conferência traz o que chegou durante a troca, uma vez só, sem repetir nem importar conversa antiga", async () => {
  for (let pass = 0; pass < 6; pass++) await waha.drainWahaEvents();
  const lista = mensagens();
  const ids = lista.map((m) => m.external_id);
  assert.ok(ids.includes("false_DURANTEATROCA"), "a mensagem da troca entrou");
  assert.equal(ids.filter((id) => id === "false_DURANTEATROCA").length, 1, "uma vez só");
  assert.equal(ids.filter((id) => /V1JAGRAVADA$/.test(id)).length, 1, "a gravada pela v1 não se repetiu");
  assert.ok(!ids.some((id) => /ANTIGA2H/.test(id)), "conversa antiga não é importada");
  for (let pass = 0; pass < 3; pass++) await waha.drainWahaEvents();
  assert.equal(mensagens().length, lista.length, "conferências seguintes não duplicam nada");
});

test("nenhuma chamada desconecta, para, reinicia ou reconfigura a sessão", () => {
  const perigosas = calls.filter((c) => /\/(logout|stop|start|restart)$/.test(c) || /^(PUT|DELETE) /.test(c) || c === "POST /api/sessions");
  assert.deepEqual(perigosas, []);
  assert.ok(calls.some((c) => c.startsWith("GET /api/sessions")), "só leu o estado da sessão");
  const cfg = db.getDb().prepare("SELECT revision FROM crm_waha_config WHERE id=1").get();
  assert.equal(cfg.revision, 5, "configuração da v1 intacta: a volta para a v1 continua possível");
});
