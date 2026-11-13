// Painel "Saúde do sistema" (módulo 1 — estabilidade): só administrador, somente leitura, classifica cada sinal
// (servidor, backup, WhatsApp, Omie, segurança) e nunca mostra telefone completo. node --test tests/saude.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = await mkdtemp(join(tmpdir(), "mag-saude-"));
process.env.SITE_DATA_DIR = dir;
process.env.CRM_DISABLE_WORKER = "1";
process.env.OMIE_CATALOG_PATH = join(dir, "catalogo-inexistente.json");
const db = await import("../src/lib/local-db.server.ts");
const auth = await import("../src/lib/local-auth-core.server.ts");
const crm = await import("../src/lib/crm.server.ts");
const waha = await import("../src/lib/crm-waha.server.ts");
const saude = await import("../src/lib/saude.server.ts");
test.after(async () => {
  db.closeDb();
  await rm(dir, { recursive: true, force: true, maxRetries: 5 });
});
const actor = async (email, roles) => ({ id: (await auth.createUser(email, "Senha-Forte-123", roles)).id, email, roles, created_at: "" });
const admin = await actor("admin@saude.example", ["admin"]);
const vendedora = await actor("vendedora@saude.example", ["comercial"]);
const dho = await actor("dho@saude.example", ["dho"]);
const NOW = Date.parse("2026-11-13T15:00:00Z");
const ago = (min) => new Date(NOW - min * 60_000).toISOString();
const hostFile = join(dir, "saude-host.json");
const healthyHost = () => ({
  versao: 1,
  geradoEm: ago(3),
  disco: { usoPct: 41, livreGb: 55 },
  memoria: { usoPct: 60, disponivelMb: 3000 },
  carga: [0.3, 0.2, 0.2],
  cpus: 2,
  containers: [
    { nome: "mag-site-web-1", estado: "running", saude: "healthy" },
    { nome: "mag-waha-waha-1", estado: "running", saude: "healthy" },
    { nome: "mag-site-omie-sync-1", estado: "running", saude: null },
  ],
  backups: [
    { projeto: "mag-site", ultimo: ago(11 * 60), tamanhoMb: 7.5, resultado: "OK (local + externo)", ok: true, falhaPendente: false },
    { projeto: "mag-whatsapp", ultimo: ago(11 * 60), tamanhoMb: 9, resultado: "OK (local; WhatsApp conferido depois da parada)", ok: true, falhaPendente: false },
  ],
  vigiaWhatsapp: { ok: true, conferido: ago(2), desde: ago(600), motivo: null, silenciado: false, manutencao: false },
});
const read = () => saude.readSystemHealth(admin, { now: NOW, hostFile });
const texts = (health) => health.problemas.map((p) => `${p.nivel}|${p.area}|${p.texto}`);

test("só o administrador abre a saúde do sistema", () => {
  assert.throws(() => saude.readSystemHealth(vendedora, { now: NOW, hostFile }), /Forbidden/);
  assert.throws(() => saude.readSystemHealth(dho, { now: NOW, hostFile }), /Forbidden/);
  assert.throws(() => saude.readSystemHealth(null, { now: NOW, hostFile }), /Unauthorized/);
});

test("sem o arquivo do servidor o painel avisa e mostra o resto", () => {
  const health = read();
  assert.equal(health.servidor, null);
  assert.equal(health.estado, "atencao");
  assert.match(texts(health).join("\n"), /atencao\|Servidor\|Sem dados do servidor/);
  assert.ok(health.banco.tamanhoMb >= 0);
});

test("servidor saudável e em dia não gera problema", async () => {
  await writeFile(hostFile, JSON.stringify(healthyHost()));
  const health = read();
  assert.deepEqual(texts(health), []);
  assert.equal(health.estado, "ok");
});

test("disco, contêiner essencial, backup e vigia do WhatsApp viram crítico; atraso e sincronização parada, atenção", async () => {
  const host = healthyHost();
  host.geradoEm = ago(40);
  host.disco.usoPct = 96;
  host.containers[1].saude = "unhealthy";
  host.containers[2].estado = "exited";
  host.backups[0].ultimo = ago(30 * 60);
  host.backups[1] = { ...host.backups[1], ok: false, falhaPendente: true, resultado: "FALHA PARCIAL — sem cópia externa" };
  host.vigiaWhatsapp = { ...host.vigiaWhatsapp, ok: false, motivo: "sessão FAILED", conferido: ago(30) };
  await writeFile(hostFile, JSON.stringify(host));
  const all = texts(read()).join("\n");
  assert.equal(read().estado, "critico");
  for (const expected of [
    /critico\|Servidor\|Disco com 96%/,
    /critico\|Servidor\|mag-waha-waha-1: sem saúde/,
    /atencao\|Servidor\|mag-site-omie-sync-1: parado/,
    /critico\|Backup\|Último backup de mag-site há 30 h/,
    /critico\|Backup\|Backup de mag-whatsapp com falha: FALHA PARCIAL/,
    /critico\|WhatsApp\|Vigia do WhatsApp em falha: sessão FAILED/,
    /atencao\|WhatsApp\|Vigia do WhatsApp sem conferir há 30 min/,
    /atencao\|Servidor\|Dados do servidor atrasados \(40 min\)/,
  ])
    assert.match(all, expected);
  assert.ok(all.indexOf("critico") < all.indexOf("atencao"), "críticos primeiro");
});

test("linhas, fila e eventos do WhatsApp: estado por vendedora com só o final do número", async () => {
  await writeFile(hostFile, JSON.stringify(healthyHost()));
  crm.ensureCrmSchema();
  waha.ensureWahaSchema();
  const session = "mag-qa-saude";
  db.getDb()
    .prepare("INSERT INTO crm_waha_lines(id,user_id,session,expected_phone,status,revision,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(randomUUID(), vendedora.id, session, "5585991237035", "active", 1, admin.id, ago(100), ago(100));
  db.getDb().prepare("INSERT INTO crm_waha_runtime(session,state,updated_at,error_code) VALUES(?,?,?,?)").run(session, "FAILED", ago(20), null);
  const contact = crm.createContact(vendedora, { name: "Cliente QA", phone: "5585988880001", email: "", city: "" });
  db.getDb()
    .prepare("INSERT INTO crm_waha_outbox(id,actor_id,contact_id,session,request_key,body_hash,encrypted,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run(randomUUID(), vendedora.id, contact.id, session, "k1", "h", "x", "uncertain", ago(30), ago(30));
  db.getDb()
    .prepare("INSERT INTO crm_waha_events(id,external_id,session,event_type,encrypted,state,attempts,available_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run(randomUUID(), "e1", session, "message", "x", "pending", 0, NOW, ago(25), ago(25));
  const health = read();
  const all = texts(health).join("\n");
  assert.match(all, /critico\|WhatsApp\|Linha de vendedora@saude\.example \(final 7035\) desconectada \(FAILED\)/);
  assert.match(all, /atencao\|WhatsApp\|1 envio\(s\) com resultado incerto/);
  assert.match(all, /atencao\|WhatsApp\|Fila de recebimento parada há 25 min/);
  assert.deepEqual(health.whatsapp.fila, { enviando: 0, incertos: 1, comErro24h: 0 });
  const payload = JSON.stringify(health);
  assert.ok(!payload.includes("5585991237035") && !payload.includes("5585988880001"), "telefone completo nunca sai");
  db.getDb().prepare("UPDATE crm_waha_runtime SET state='WORKING' WHERE session=?").run(session);
  db.getDb().prepare("DELETE FROM crm_waha_outbox").run();
  db.getDb().prepare("DELETE FROM crm_waha_events").run();
});

test("Omie e tentativas de login entram como atenção", async () => {
  await writeFile(hostFile, JSON.stringify(healthyHost()));
  for (let i = 0; i < 20; i++) auth.recordFailedLogin(i % 2 ? "vendedora@saude.example" : "ninguem@saude.example");
  db.getDb().prepare("UPDATE audit_log SET created_at=? WHERE action='auth:login:failed'").run(ago(60));
  const all = texts(read()).join("\n");
  assert.match(all, /atencao\|Segurança\|20 logins recusados em 24 h \(1 conta\(s\) existente\(s\) visada\(s\)\)/);
  assert.equal(read().estado, "atencao");
});
