// node --test tests/retention.test.mjs — retenção de candidaturas: só cálculo e relatório, nunca exclusão.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { retentionPolicy, expiresAt, purposeOf, purposeLabel } from "../src/lib/retention.ts";
import { retentionReport } from "../scripts/recruitment-retention.mjs";

const root = resolve(import.meta.dirname, "..");
const app = (created_at, job_slug = null, talent_bank = null) => ({ created_at, job_slug, talent_bank });

test("sem prazo definido não há expiração; valores inválidos também não", () => {
  for (const env of [{}, { RECRUITMENT_RETENTION_MONTHS: "" }, { RECRUITMENT_RETENTION_MONTHS: "0" }, { RECRUITMENT_RETENTION_MONTHS: "abc" },
    { RECRUITMENT_RETENTION_MONTHS: "-3" }, { RECRUITMENT_RETENTION_MONTHS: "121" }, { RECRUITMENT_RETENTION_MONTHS: "6.5" }]) {
    const policy = retentionPolicy(env);
    assert.deepEqual(policy, { jobMonths: null, bankMonths: null }, JSON.stringify(env));
    assert.equal(expiresAt(app("2026-01-10T12:00:00.000Z", "vaga-x"), policy), null);
  }
});

test("prazo da vaga e do banco de talentos; banco sem prazo próprio usa o da vaga", () => {
  const same = retentionPolicy({ RECRUITMENT_RETENTION_MONTHS: "12" });
  assert.deepEqual(same, { jobMonths: 12, bankMonths: 12 });
  const split = retentionPolicy({ RECRUITMENT_RETENTION_MONTHS: "6", TALENT_BANK_RETENTION_MONTHS: "24" });
  assert.equal(expiresAt(app("2026-01-10T12:00:00.000Z", "vaga-x"), split), "2026-07-10T12:00:00.000Z", "só a vaga: 6 meses");
  assert.equal(expiresAt(app("2026-01-10T12:00:00.000Z", "vaga-x", true), split), "2028-01-10T12:00:00.000Z", "vaga + banco: prazo do banco");
  assert.equal(expiresAt(app("2026-01-10T12:00:00.000Z"), split), "2028-01-10T12:00:00.000Z", "cadastro direto no banco");
  assert.equal(expiresAt(app("2026-01-31T15:00:00.000Z", "v"), retentionPolicy({ RECRUITMENT_RETENTION_MONTHS: "1" })), "2026-02-28T15:00:00.000Z", "fim de mês não transborda");
  assert.equal(expiresAt(app("2027-11-30T15:00:00.000Z", "v"), retentionPolicy({ RECRUITMENT_RETENTION_MONTHS: "3" })), "2028-02-29T15:00:00.000Z", "ano bissexto");
  assert.equal(expiresAt(app("data inválida", "v"), same), null);
});

test("finalidade registrada", () => {
  assert.equal(purposeOf(app("x", "vaga-x")), "vaga");
  assert.equal(purposeOf(app("x", "vaga-x", 1)), "vaga+banco");
  assert.equal(purposeOf(app("x")), "banco");
  assert.equal(purposeLabel.banco, "Banco de talentos");
});

test("relatório: conta vencidas e nunca apaga", () => {
  const rows = [
    { protocolo: "A1", status: "encerrado", has_resume: 1, ...app("2025-01-01T12:00:00.000Z", "vaga-x") },
    { protocolo: "B2", status: "novo", has_resume: 1, ...app("2026-09-01T12:00:00.000Z", "vaga-x") },
    { protocolo: "C3", status: "banco de talentos", has_resume: 1, ...app("2025-01-01T12:00:00.000Z", null) },
  ];
  const now = Date.parse("2026-10-06T12:00:00Z");
  const undefinedPolicy = retentionReport(rows, retentionPolicy({}), now);
  assert.equal(undefinedPolicy.politica.definida, false);
  assert.equal(undefinedPolicy.vencidas.length, 0, "sem política, nada vence");
  const report = retentionReport(rows, retentionPolicy({ RECRUITMENT_RETENTION_MONTHS: "12", TALENT_BANK_RETENTION_MONTHS: "24" }), now);
  assert.deepEqual(report.vencidas.map((item) => item.protocolo), ["A1"], "banco (24 meses) ainda vale; vaga de 2025 venceu");
  assert.equal(report.apagadas, 0);
  assert.ok(!JSON.stringify(report).match(/nome|email|whatsapp/i), "sem dados pessoais no relatório");
});

test("script de relatório abre o banco só para leitura e não altera nada", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "mag-retencao-"));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const db = new DatabaseSync(join(dir, "site.sqlite"));
  db.exec(`CREATE TABLE job_applications (id TEXT PRIMARY KEY, protocolo TEXT, created_at TEXT, updated_at TEXT, status TEXT, internal_notes TEXT, data TEXT)`);
  const insert = db.prepare("INSERT INTO job_applications VALUES (?,?,?,?,?,NULL,?)");
  insert.run("1", "VELHA1", "2024-01-01T12:00:00.000Z", "2024-01-01T12:00:00.000Z", "encerrado", JSON.stringify({ nome: "Fulana", email: "f@example.com", job_slug: "vaga-x", resume_path: "a.pdf" }));
  insert.run("2", "NOVA2", new Date().toISOString(), new Date().toISOString(), "novo", JSON.stringify({ nome: "Beltrano", email: "b@example.com", resume_path: "b.pdf" }));
  db.close();
  const run = (env) => execFileSync(process.execPath, ["scripts/recruitment-retention.mjs", ...(env.json ? ["--json"] : [])], {
    cwd: root, encoding: "utf8", env: { ...process.env, SITE_DATA_DIR: dir, RECRUITMENT_RETENTION_MONTHS: env.months ?? "", TALENT_BANK_RETENTION_MONTHS: "" },
  });
  const text = run({});
  assert.match(text, /NÃO definido/);
  assert.match(text, /Nada foi apagado/);
  const report = JSON.parse(run({ json: true, months: "12" }));
  assert.deepEqual(report.vencidas.map((item) => item.protocolo), ["VELHA1"]);
  assert.equal(report.total, 2);
  assert.ok(!JSON.stringify(report).includes("Fulana") && !JSON.stringify(report).includes("@example.com"));
  const check = new DatabaseSync(join(dir, "site.sqlite"), { readOnly: true });
  assert.equal(check.prepare("SELECT count(*) n FROM job_applications").get().n, 2, "nenhuma linha apagada");
  check.close();
});
