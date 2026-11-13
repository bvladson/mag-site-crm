import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = await mkdtemp(join(tmpdir(), "mag-assignment-"));
process.env.SITE_DATA_DIR = dir;
const db = await import("../src/lib/local-db.server.ts");
const auth = await import("../src/lib/local-auth-core.server.ts");
const assignments = await import("../src/lib/assignments.server.ts");
const units = await import("../src/lib/units.server.ts");
const orc = await import("../src/lib/orcamentos.server.ts");
const actor = async (email, roles) => ({
  id: (await auth.createUser(email, "Senha-Forte-123", roles)).id,
  email,
  roles,
  created_at: "",
});
const admin = await actor("admin@assignment.example", ["admin"]);
const a = await actor("a@assignment.example", ["comercial"]);
const b = await actor("b@assignment.example", ["comercial"]);
const c = await actor("c@assignment.example", ["comercial"]);
const dho = await actor("dho@assignment.example", ["dho"]);
const [unit1, unit2] = units.listUnitsPublic();
const products = [{ id: "123", sku: "SKU-123", nome: "Produto", unidade: "UN", slug: "produto" }];
const lead = () =>
  db.saveQuote(
    {
      nome: "Contato",
      empresa: "Empresa",
      whatsapp: "85999999999",
      email: "lead@example.invalid",
      cidade: "Fortaleza",
      estado: "CE",
    },
    [{ slug: "produto", sku: "SKU-123", name: "Produto", qty: 1 }],
  ).id;
const configure = (mode, consultants) =>
  assignments.saveDistribution(admin, {
    mode,
    consultants,
    revision: assignments.readDistribution(admin).revision,
  });
test.after(async () => {
  db.closeDb();
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("manual guarda unidade sem dono; somente admin pode atribuir e alterar regra; auditoria sem contato", () => {
  const id = lead();
  assignments.assignNewLead(id, unit1.id);
  assert.equal(assignments.leadAssignment(id).ownerId, null);
  assert.equal(assignments.leadAssignment(id).unitId, unit1.id);
  assert.throws(
    () => assignments.assignLead(a, { leadId: id, ownerId: a.id, unitId: unit1.id, revision: 1 }),
    /Forbidden/,
  );
  assert.throws(() => assignments.readAssignedLeads(dho), /Forbidden/);
  assert.throws(
    () => assignments.saveDistribution(a, { mode: "rodizio", revision: 1, consultants: [] }),
    /Forbidden/,
  );
  assignments.assignLead(admin, { leadId: id, ownerId: a.id, unitId: unit1.id, revision: 1 });
  assert.equal(assignments.leadAssignment(id).ownerId, a.id);
  assert.throws(
    () =>
      assignments.assignLead(admin, { leadId: id, ownerId: b.id, unitId: unit1.id, revision: 1 }),
    /Conflito/,
  );
  assert.equal(
    db.getDb().prepare("SELECT count(*) n FROM lead_assignment_history WHERE lead_id=?").get(id).n,
    2,
  );
  const audit = db
    .getDb()
    .prepare("SELECT details FROM audit_log WHERE action='lead:assigned' AND target_id=?")
    .all(id)
    .map((r) => r.details)
    .join(" ");
  assert.ok(!audit.includes("lead@example.invalid") && !audit.includes("Contato"));
});
test("rodízio real avança uma vez por lead, exclui desativado e respeita revisão da regra", () => {
  configure(
    "rodizio",
    [a, b, c].map((u) => ({ userId: u.id, unitId: unit1.id, enabled: true })),
  );
  db.getDb().prepare("UPDATE users SET disabled=1 WHERE id=?").run(c.id);
  const expected = [a.id, b.id, a.id, b.id];
  for (const owner of expected) {
    const id = lead();
    assert.equal(assignments.assignNewLead(id).ownerId, owner);
    assert.equal(assignments.assignNewLead(id).ownerId, owner);
  }
  const revision = assignments.readDistribution(admin).revision;
  configure("manual", []);
  assert.throws(
    () => assignments.saveDistribution(admin, { mode: "manual", revision, consultants: [] }),
    /Conflito/,
  );
  db.getDb().prepare("UPDATE users SET disabled=0 WHERE id=?").run(c.id);
});
test("por unidade tem cursor independente; sem preferência fica manual; mudança não redistribui antigo", () => {
  configure("unidade", [
    { userId: a.id, unitId: unit1.id, enabled: true },
    { userId: b.id, unitId: unit1.id, enabled: true },
    { userId: c.id, unitId: unit2.id, enabled: true },
  ]);
  const first = lead();
  assert.equal(assignments.assignNewLead(first, unit1.id).ownerId, a.id);
  assert.equal(assignments.assignNewLead(lead(), unit2.id).ownerId, c.id);
  assert.equal(assignments.assignNewLead(lead(), unit1.id).ownerId, b.id);
  assert.equal(assignments.assignNewLead(lead()).ownerId, null);
  configure("manual", []);
  assert.equal(assignments.assignNewLead(first, unit1.id).ownerId, a.id);
});
test("conversão usa dono atribuído, impede acesso cruzado e é idempotente inclusive pelo admin", () => {
  const id = lead();
  assignments.assignLead(admin, { leadId: id, ownerId: a.id, unitId: unit1.id, revision: 0 });
  assert.throws(() => orc.criarOrcamento(b, products, id), /Forbidden/);
  const converted = orc.criarOrcamento(admin, products, id);
  assert.equal(orc.lerOrcamento(a, converted.id).orcamento.donoId, a.id);
  assert.deepEqual(orc.criarOrcamento(admin, products, id), converted);
  assert.deepEqual(orc.criarOrcamento(a, products, id), converted);
  assert.equal(
    db.getDb().prepare("SELECT count(*) n FROM internal_quotes WHERE source_request_id=?").get(id)
      .n,
    1,
  );
  assert.throws(() => orc.lerOrcamento(b, converted.id), /Forbidden/);
  assert.throws(
    () =>
      assignments.assignLead(admin, { leadId: id, ownerId: b.id, unitId: unit1.id, revision: 1 }),
    /já foi convertido/,
  );
});
test("revogação do administrador é verificada no banco a cada gravação", () => {
  db.getDb().prepare("UPDATE users SET roles='[\"comercial\"]' WHERE id=?").run(admin.id);
  assert.throws(
    () =>
      assignments.assignLead(admin, {
        leadId: lead(),
        ownerId: a.id,
        unitId: unit1.id,
        revision: 0,
      }),
    /Forbidden/,
  );
  db.getDb().prepare("UPDATE users SET roles='[\"admin\"]' WHERE id=?").run(admin.id);
});
