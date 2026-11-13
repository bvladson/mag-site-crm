import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = await mkdtemp(join(tmpdir(), "mag-discounts-"));
process.env.SITE_DATA_DIR = dir;
const db = await import("../src/lib/local-db.server.ts"),
  auth = await import("../src/lib/local-auth-core.server.ts"),
  discounts = await import("../src/lib/discounts.server.ts"),
  pure = await import("../src/lib/discounts.ts"),
  orc = await import("../src/lib/orcamentos.server.ts"),
  proposals = await import("../src/lib/propostas.server.ts");
const make = async (email, roles) => ({
  id: (await auth.createUser(email, "Senha-Forte-123!", roles)).id,
  email,
  roles,
  created_at: "",
});
const admin = await make("admin@discounts.test", ["admin"]),
  com = await make("com@discounts.test", ["comercial"]),
  manager = await make("manager@discounts.test", ["gerente"]),
  dho = await make("rh@discounts.test", ["dho"]);
const product = {
  id: "123",
  sku: "QA-123",
  nome: "Produto de teste",
  unidade: "UN",
  slug: "produto-teste",
};
const products = new Map([[product.id, product]]);
const currentVersion = (id) =>
  Number(db.getDb().prepare("SELECT version FROM internal_quotes WHERE id=?").get(id).version);
const data = (id, pct = 8, extra = {}) => ({
  versao: currentVersion(id),
  cliente: {
    nome: "Cliente de teste",
    fantasia: "",
    documento: "",
    email: "cliente@example.test",
    telefone: "85999990000",
    cidade: "Fortaleza",
    uf: "CE",
  },
  itens: [
    {
      produtoId: "123",
      quantidade: "1",
      preco: "100,00",
      descontoTipo: "percentual",
      desconto: String(pct),
    },
  ],
  condicoes: {
    formaPagamento: "",
    previsao: "2030-01-02",
    consumidorFinal: true,
    emailNf: "",
    observacoes: "",
    notasInternas: "",
  },
  proposta: {
    contato: "",
    validade: "",
    descontoGeral: "",
    frete: "",
    montagem: "",
    observacoes: "",
  },
  ...extra,
});
const create = () => orc.criarOrcamento(com, [product]).id;
test.after(async () => {
  db.closeDb();
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test("limites começam inativos e exigem configuração crescente válida por Admin", () => {
  assert.equal(discounts.readDiscountPolicy().enabled, false);
  assert.throws(
    () => discounts.saveDiscountPolicy(manager, { ...pure.DEFAULT_DISCOUNT_POLICY, enabled: true }),
    /Forbidden/,
  );
  assert.throws(
    () =>
      discounts.saveDiscountPolicy(admin, {
        ...pure.DEFAULT_DISCOUNT_POLICY,
        consultor: 20,
        gerente: 10,
      }),
    /crescentes/,
  );
  assert.throws(
    () =>
      discounts.saveDiscountPolicy(admin, { ...pure.DEFAULT_DISCOUNT_POLICY, consultor: 5.001 }),
    /duas casas/,
  );
  discounts.saveDiscountPolicy(admin, { ...pure.DEFAULT_DISCOUNT_POLICY, enabled: true });
  assert.equal(discounts.readDiscountPolicy().enabled, true);
  assert.throws(
    () => discounts.saveDiscountPolicy(admin, { ...pure.DEFAULT_DISCOUNT_POLICY, enabled: true }),
    /mudaram/,
  );
});
let id, request, version;
test("desconto pendente bloqueia envio, aceite e distribuição real do PDF", async () => {
  id = create();
  orc.salvarOrcamento(com, id, data(id), products);
  orc.mudarEstado(com, id, "salvar", currentVersion(id));
  const generated = await proposals.gerarProposta(
    com,
    id,
    { versaoOrcamento: currentVersion(id), mostrarSku: true },
    () => null,
  );
  version = generated.versao;
  assert.equal(discounts.discountStatus(com, id).state, "nao_solicitado");
  assert.throws(() => proposals.marcarVersaoEnviada(com, id, version), /pendente de aprovação/);
  assert.throws(
    () => orc.mudarEstado(com, id, "enviar", currentVersion(id)),
    /pendente de aprovação/,
  );
  assert.throws(() => proposals.dadosParaEnvio(com, id, version), /pendente de aprovação/);
  await assert.rejects(
    () => proposals.pdfDaProposta(com, id, version, {}, { distribuir: true }),
    /pendente de aprovação/,
  );
  const preview = await proposals.pdfDaProposta(com, id, version);
  assert.ok(preview.bytes.length > 1000);
  request = discounts.requestDiscountApproval(com, id);
  assert.equal(discounts.requestDiscountApproval(com, id).id, request.id);
  assert.throws(() => discounts.discountQueue(com), /Forbidden/);
  assert.throws(() => discounts.discountStatus(dho, id), /Forbidden/);
});
test("Gerente analisa até a alçada, decisão libera a mesma proposta e guarda histórico", () => {
  assert.equal(discounts.discountQueue(manager)[0].canDecide, true);
  assert.throws(
    () =>
      discounts.decideDiscount({ ...com, roles: ["admin"] }, request.id, "aprovado", "Tentativa"),
    /Forbidden/,
  );
  discounts.decideDiscount(manager, request.id, "aprovado", "Condição comercial aprovada");
  assert.equal(discounts.discountStatus(com, id).state, "aprovado");
  proposals.marcarVersaoEnviada(com, id, version);
  assert.equal(
    db.getDb().prepare("SELECT status FROM internal_quotes WHERE id=?").get(id).status,
    "enviado",
  );
  assert.throws(
    () => discounts.decideDiscount(manager, request.id, "recusado", "Repetida"),
    /já analisada/,
  );
});
test("alterar desconto invalida aprovação; acima da alçada do Gerente exige Admin", () => {
  orc.salvarOrcamento(com, id, data(id, 12), products);
  assert.throws(() => discounts.assertDiscountApproval(id), /pendente/);
  assert.equal(
    discounts.discountQueue(admin).find((r) => r.id === request.id).state,
    "substituido",
  );
  const r = discounts.requestDiscountApproval(com, id);
  assert.throws(
    () => discounts.decideDiscount(manager, r.id, "aprovado", "Fora da minha alçada"),
    /Diretoria/,
  );
  discounts.decideDiscount(admin, r.id, "aprovado", "Aprovado pela diretoria");
  assert.equal(discounts.discountStatus(com, id).state, "aprovado");
  assert.throws(() => discounts.assertDiscountApproval(id, version), /Gere uma nova versão/);
  const before = currentVersion(id);
  assert.throws(() => orc.salvarOrcamento(com, id, data(id, 16), products), /limite máximo/);
  assert.equal(currentVersion(id), before, "salvamento rejeitado é atômico");
  assert.equal(
    discounts.discountStatus(com, id).state,
    "aprovado",
    "rollback não invalida a aprovação anterior",
  );
});
test("efeito acumulado evita contornar alçada somando desconto por item e geral", () => {
  const q = create(),
    d = data(q, 5);
  d.proposta.descontoGeral = "4,75";
  orc.salvarOrcamento(com, q, d, products);
  const s = discounts.discountStatus(com, q);
  assert.equal(s.basisPoints, 975);
  assert.equal(s.required, "gerente");
  assert.equal(pure.discountBasisPoints(5, 101), 496);
  const r = discounts.requestDiscountApproval(com, q);
  discounts.decideDiscount(manager, r.id, "recusado", "Reavaliar condição");
  assert.throws(() => discounts.assertDiscountApproval(q), /recusado/);
  const next = discounts.requestDiscountApproval(com, q);
  assert.notEqual(next.id, r.id);
  assert.ok(
    !JSON.stringify(
      db.getDb().prepare("SELECT details FROM audit_log WHERE action LIKE 'discount:%'").all(),
    ).includes("Reavaliar condição"),
  );
});
test("arredondamento em centavos preserva a alçada do percentual digitado", () => {
  for (const price of ["99,99", "0,11"]) {
    const q = create(),
      d = data(q, 5);
    d.itens[0].preco = price;
    orc.salvarOrcamento(com, q, d, products);
    assert.equal(discounts.discountStatus(com, q).state, "livre");
    assert.equal(discounts.discountStatus(com, q).basisPoints, 500);
  }
});

test("mudança de política e perda do perfil Gerente invalidam permissões atuais", async () => {
  const p = discounts.readDiscountPolicy();
  discounts.saveDiscountPolicy(admin, { ...p, gerente: 11 });
  assert.throws(() => discounts.assertDiscountApproval(id), /pendente/);
  auth.changeRole(admin, manager.id, "gerente", false);
  assert.throws(() => discounts.discountQueue(manager), /Forbidden/);
  const admin2 = await make("second-admin@discounts.test", ["admin"]);
  auth.changeRole(admin, admin2.id, "admin", false);
  assert.throws(() => auth.disableUser(admin2, admin.id), /Forbidden/);
  assert.throws(
    () => auth.changeRole(admin, admin.id, "admin", false),
    /próprio acesso|administrador ativo/,
  );
});
test("dados bancários e PIX entram somente nas propostas novas", async () => {
  const old = JSON.parse(
    db
      .getDb()
      .prepare("SELECT snapshot FROM quote_proposals WHERE quote_id=? AND version=?")
      .get(id, version).snapshot,
  );
  proposals.salvarEmitente(admin, {
    ...proposals.lerEmitente(),
    inscricaoEstadual: "ISENTO",
    dadosBancarios: "Banco de teste - Agência 0001 - Conta 1234",
    pix: "financeiro@example.test",
  });
  const generated = await proposals.gerarProposta(
    com,
    id,
    { versaoOrcamento: currentVersion(id), mostrarSku: true },
    () => null,
  );
  const snapshot = JSON.parse(
    db
      .getDb()
      .prepare("SELECT snapshot FROM quote_proposals WHERE quote_id=? AND version=?")
      .get(id, generated.versao).snapshot,
  );
  assert.equal(snapshot.emitente.pix, "financeiro@example.test");
  const pdfModule = await import("../src/lib/proposta-pdf.server.ts");
  const pdf = await pdfModule.renderizarProposta(snapshot);
  const text = pdf.paginas.flatMap((p) => p.textos).join("\n");
  assert.ok(
    text.includes("Banco de teste") &&
      text.includes("PIX: financeiro@example.test") &&
      text.includes("IE ISENTO"),
  );
  assert.ok(!old.emitente.pix);
  assert.equal(
    JSON.parse(
      db
        .getDb()
        .prepare("SELECT snapshot FROM quote_proposals WHERE quote_id=? AND version=?")
        .get(id, version).snapshot,
    ).emitente.pix,
    old.emitente.pix,
  );
});
