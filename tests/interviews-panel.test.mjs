import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const dir = await mkdtemp(join(tmpdir(), "mag-interviews-"));
process.env.SITE_DATA_DIR = dir;
const db = await import("../src/lib/local-db.server.ts");
const auth = await import("../src/lib/local-auth-core.server.ts");
const core = await import("../src/lib/interviews.server.ts");
const shared = await import("../src/lib/interviews.ts");
const panel = await import("../src/lib/panel.server.ts");
const units = await import("../src/lib/units.server.ts");
const make = async (email, roles) => ({
  id: (await auth.createUser(email, "Senha-Forte-Teste-123!", roles)).id,
  email,
  roles,
  created_at: "",
});
const admin = await make("admin@agenda.test", ["admin"]);
const dho = await make("rh@agenda.test", ["dho"]);
const other = await make("rh2@agenda.test", ["dho"]);
const commercial = await make("comercial@agenda.test", ["comercial"]);
const anotherCommercial = await make("comercial2@agenda.test", ["comercial"]);
const app = (name) =>
  db.insertLead("job_applications", {
    nome: name,
    email: "candidato@example.test",
    lgpd_consent: true,
    talent_bank: false,
    job_title: "Vaga real de teste",
    job_slug: "vaga-teste",
  }).id;
const alice = app("Alice Privada");
const bob = app("Bob Privado");
const charlie = app("Charlie Privado");
const unit = units.listUnitsPublic()[0];
const now = Date.parse("2030-01-01T12:00:00Z");
const form = (changes = {}) => ({
  revision: 0,
  applicationId: alice,
  interviewerId: dho.id,
  unitId: unit.id,
  online: false,
  location: "Sala 1",
  meetingUrl: "",
  startsAt: "2030-01-02T10:00",
  duration: 60,
  status: "agendada",
  rating: null,
  notes: "Avaliação privada",
  ...changes,
});
test.after(async () => {
  db.closeDb();
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test("agenda privada exige papéis atuais; dados e opções não saem para Comercial", () => {
  for (const user of [null, commercial, { ...commercial, roles: ["admin"] }]) {
    assert.throws(() => core.interviewOptionsCore(user), /Unauthorized|Forbidden/);
    assert.throws(() => core.listInterviewsCore(user), /Unauthorized|Forbidden/);
    assert.throws(() => core.saveInterviewCore(user, form(), now), /Unauthorized|Forbidden/);
  }
  const options = core.interviewOptionsCore(dho);
  assert.ok(options.candidates.some((c) => c.id === alice));
  assert.ok(!options.interviewers.some((u) => u.id === commercial.id));
});

let first;
test("agenda persiste horário de Fortaleza e detecta sobreposição; horários adjacentes são possíveis", () => {
  first = core.saveInterviewCore(dho, form(), now);
  const row = core.listInterviewsCore(admin)[0];
  assert.equal(row.startsAt, "2030-01-02T13:00:00.000Z");
  assert.equal(row.candidate, "Alice Privada");
  assert.equal(row.revision, 1);
  assert.equal(db.readLead("job_applications", alice).status, "entrevista");
  assert.throws(
    () =>
      core.saveInterviewCore(dho, form({ applicationId: bob, startsAt: "2030-01-02T10:30" }), now),
    /Conflito/,
  );
  assert.throws(
    () =>
      core.saveInterviewCore(
        dho,
        form({ applicationId: bob, interviewerId: other.id, startsAt: "2030-01-02T09:45" }),
        now,
      ),
    /Conflito/,
  );
  assert.throws(
    () =>
      core.saveInterviewCore(
        dho,
        form({ interviewerId: other.id, location: "Sala 2", startsAt: "2030-01-02T10:15" }),
        now,
      ),
    /Conflito/,
  );
  assert.ok(
    core.saveInterviewCore(dho, form({ applicationId: bob, startsAt: "2030-01-02T11:00" }), now).id,
  );
  assert.ok(
    core.saveInterviewCore(
      dho,
      form({ applicationId: charlie, interviewerId: other.id, location: "Sala 2" }),
      now,
    ).id,
  );
});

test("revisões concorrentes, avaliações prematuras e entrevistador inválido são rejeitados", () => {
  assert.throws(
    () => core.saveInterviewCore(dho, form({ id: first.id, revision: 0 }), now),
    /alterada/,
  );
  assert.throws(
    () =>
      core.saveInterviewCore(dho, form({ applicationId: bob, interviewerId: commercial.id }), now),
    /entrevistador ativo/,
  );
  assert.throws(
    () =>
      core.saveInterviewCore(
        dho,
        form({ id: first.id, revision: 1, status: "realizada", rating: 4 }),
        now,
      ),
    /futura/,
  );
  assert.throws(() => core.saveInterviewCore(dho, form({ rating: 4 }), now), /realizadas/);
  const saved = core.saveInterviewCore(
    dho,
    form({ id: first.id, revision: 1, status: "realizada", rating: 4 }),
    Date.parse("2030-01-03T12:00:00Z"),
  );
  assert.equal(saved.revision, 2);
  const row = core.listInterviewsCore(dho, alice)[0];
  assert.equal(row.rating, 4);
  assert.equal(row.notes, "Avaliação privada");
  assert.throws(
    () => core.saveInterviewCore(dho, form({ id: first.id, revision: 1 }), now),
    /alterada/,
  );
});

test("datas reais, reunião HTTPS e períodos futuros são validados", () => {
  for (const time of ["2030-02-30T10:00", "2030-13-01T10:00", "2030-01-02T24:01", "inválido"])
    assert.throws(() => shared.interviewInstant(time), /válidas/);
  assert.equal(shared.interviewInstant("2032-02-29T10:00"), "2032-02-29T13:00:00.000Z");
  assert.throws(
    () => core.saveInterviewCore(dho, form({ startsAt: "2020-01-01T10:00" }), now),
    /futuro/,
  );
  for (const url of [
    "javascript:alert(1)",
    "http://exemplo.test",
    "https://user:senha@exemplo.test",
  ])
    assert.equal(shared.interviewInput.safeParse(form({ meetingUrl: url })).success, false);
});

test("funil altera etapa sem criar consentimento ou perder notas; mudanças concorrentes são rejeitadas", () => {
  const dataBefore = db
    .getDb()
    .prepare("SELECT data FROM job_applications WHERE id=?")
    .get(alice).data;
  db.getDb()
    .prepare("UPDATE job_applications SET internal_notes=? WHERE id=?")
    .run("Anotação preservada", alice);
  core.moveApplicationCore(dho, alice, "entrevista", "banco de talentos");
  const row = db.readLead("job_applications", alice);
  assert.equal(row.status, "banco de talentos");
  assert.equal(row.talent_bank, false);
  assert.equal(row.internal_notes, "Anotação preservada");
  assert.equal(
    db.getDb().prepare("SELECT data FROM job_applications WHERE id=?").get(alice).data,
    dataBefore,
  );
  assert.throws(() => core.moveApplicationCore(dho, alice, "entrevista", "encerrado"), /mudou/);
  assert.throws(
    () => core.moveApplicationCore(commercial, alice, "banco de talentos", "encerrado"),
    /Forbidden/,
  );
});

test("busca e indicadores separam negociação por dono e candidaturas por papel", () => {
  const quote = (owner, number) => {
    const id = randomUUID();
    db.getDb()
      .prepare(
        `INSERT INTO internal_quotes(id,number,status,owner_id,customer_name,total_cents,freight_cents,assembly_cents,general_discount_cents,created_at,updated_at) VALUES(?,?,'salvo',?,'Conta Reservada',10000,1000,500,200,?,?)`,
      )
      .run(id, number, owner.id, new Date(now).toISOString(), new Date(now).toISOString());
    return id;
  };
  const mine = quote(commercial, "MAG-TEST-1");
  const theirs = quote(anotherCommercial, "MAG-TEST-2");
  assert.equal(panel.searchPanelCore(commercial, "Alice").length, 0);
  assert.ok(panel.searchPanelCore(dho, "Alice").some((r) => r.href.endsWith(alice)));
  const results = panel.searchPanelCore(commercial, "Reservada");
  assert.equal(results.length, 1);
  assert.ok(results[0].href.endsWith(mine));
  assert.ok(!JSON.stringify(results).includes(theirs));
  assert.equal(panel.searchPanelCore(admin, "Reservada").length, 2);
  assert.equal(panel.searchPanelCore(commercial, "%%").length, 0);
  assert.equal(panel.panelCountsCore(commercial).next[0].totalCents, 11300);
  assert.equal(panel.panelCountsCore(dho), null);
  const audit = JSON.stringify(
    db.getDb().prepare("SELECT details FROM audit_log WHERE action LIKE 'interview:%'").all(),
  );
  assert.ok(!audit.includes("Avaliação privada") && !audit.includes("candidato@example.test"));
});
