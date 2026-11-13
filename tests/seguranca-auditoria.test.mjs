// Auditoria de operações sensíveis (módulo 1 — segurança): login recusado e edição de valores/descontos de uma
// negociação ficam registrados, sem senha, e-mail digitado ou dados do cliente nos detalhes.
// node --test tests/seguranca-auditoria.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = await mkdtemp(join(tmpdir(), "mag-auditoria-"));
process.env.SITE_DATA_DIR = dir;
const db = await import("../src/lib/local-db.server.ts");
const auth = await import("../src/lib/local-auth-core.server.ts");
const quotes = await import("../src/lib/orcamentos.server.ts");
const { hojeFortaleza } = await import("../src/lib/orcamento-regras.ts");
test.after(async () => {
  db.closeDb();
  await rm(dir, { recursive: true, force: true, maxRetries: 5 });
});
const seller = { id: (await auth.createUser("vendedora@auditoria.example", "Senha-Forte-123", ["comercial"])).id, email: "vendedora@auditoria.example", roles: ["comercial"], created_at: "" };
const rows = (action) => db.getDb().prepare("SELECT actor_id,target_id,details FROM audit_log WHERE action=? ORDER BY id").all(action);

test("login recusado é auditado sem guardar o e-mail digitado nem a senha", () => {
  auth.recordFailedLogin("  VENDEDORA@auditoria.example ");
  auth.recordFailedLogin("ninguem@auditoria.example");
  const [existente, inexistente] = rows("auth:login:failed");
  assert.deepEqual([existente.actor_id, existente.target_id, JSON.parse(existente.details)], [null, seller.id, { conta: "existente" }]);
  assert.deepEqual([inexistente.target_id, JSON.parse(inexistente.details)], [null, { conta: "inexistente" }]);
  const all = JSON.stringify(rows("auth:login:failed"));
  assert.ok(!all.includes("ninguem@") && !all.includes("vendedora@"), "nenhum e-mail digitado na auditoria");
});

test("salvar a negociação registra quem salvou, versão e totais, sem dados do cliente", () => {
  const products = [{ id: "8764749588", sku: "00125", nome: "CADEIRA DIRETOR", unidade: "UN", slug: "cadeira-diretor" }];
  const { id } = quotes.criarOrcamento(seller, products);
  const amanha = new Date(Date.parse(`${hojeFortaleza()}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  quotes.salvarOrcamento(
    seller,
    id,
    {
      versao: 1,
      cliente: { nome: "CLIENTE SIGILOSO LTDA", fantasia: "Sigiloso", documento: "", email: "compras@sigiloso.example", telefone: "(85) 99999-0000", cidade: "Fortaleza", uf: "CE" },
      itens: [{ produtoId: "8764749588", quantidade: "2", preco: "1.000,00", descontoTipo: "percentual", desconto: "10" }],
      condicoes: { formaPagamento: "", previsao: amanha, consumidorFinal: false, emailNf: "", observacoes: "", notasInternas: "margem apertada", conta: "" },
      proposta: { contato: "Maria", validade: "", descontoGeral: "50,00", frete: "", montagem: "", observacoes: "" },
    },
    new Map(products.map((p) => [p.id, p])),
  );
  const [saved] = rows("quote:saved");
  assert.equal(saved.actor_id, seller.id);
  assert.equal(saved.target_id, id);
  assert.deepEqual(JSON.parse(saved.details), { versao: 2, itens: 1, total_cents: 180_000, desconto_itens_cents: 20_000, desconto_geral_cents: 5_000 });
  assert.ok(!/SIGILOSO|compras@|margem|Maria/i.test(saved.details), "sem dados do cliente nem notas internas");
});
