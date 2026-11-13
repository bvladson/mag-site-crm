import { createHash, randomUUID } from "node:crypto";
import { getDb, transaction, audit } from "./local-db.server.ts";
import { requireActiveUser, type SiteUser } from "./local-auth-core.server.ts";
import {
  DEFAULT_DISCOUNT_POLICY,
  discountPolicyInput,
  discountAuthority,
  discountBasisPoints,
  DISCOUNT_LABELS,
  type DiscountPolicy,
} from "./discounts.ts";
import { hashDoOrcamento, itensDo } from "./proposta-conteudo.server.ts";
type Row = Record<string, any>;
function schema() {
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS discount_policy (id INTEGER PRIMARY KEY CHECK(id=1), content TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS discount_requests (id TEXT PRIMARY KEY, quote_id TEXT NOT NULL REFERENCES internal_quotes(id), financial_hash TEXT NOT NULL,
      policy_revision INTEGER NOT NULL, basis_points INTEGER NOT NULL, required_role TEXT NOT NULL, quote_version INTEGER NOT NULL,
      requested_by TEXT NOT NULL, requested_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pendente','aprovado','recusado')),
      decided_by TEXT, decided_at TEXT, reason TEXT NOT NULL DEFAULT '');
    CREATE INDEX IF NOT EXISTS discount_request_quote ON discount_requests(quote_id,requested_at);`);
  return db;
}
export function readDiscountPolicy(): DiscountPolicy {
  const row = schema().prepare("SELECT content,revision FROM discount_policy WHERE id=1").get();
  return row
    ? discountPolicyInput.parse({
        ...JSON.parse(String(row["content"])),
        revision: Number(row["revision"]),
      })
    : { ...DEFAULT_DISCOUNT_POLICY };
}
export function saveDiscountPolicy(actor: SiteUser | null, input: unknown) {
  const user = requireActiveUser(actor, ["admin"]),
    value = discountPolicyInput.parse(input);
  schema();
  return transaction(() => {
    requireActiveUser(user, ["admin"]);
    const old = readDiscountPolicy();
    if (old.revision !== value.revision)
      throw new Error("As alçadas mudaram em outra sessão. Recarregue.");
    if (
      old.enabled === value.enabled &&
      old.consultor === value.consultor &&
      old.gerente === value.gerente &&
      old.diretoria === value.diretoria
    )
      return old;
    const data = { ...value, revision: old.revision + 1 };
    getDb()
      .prepare(
        `INSERT INTO discount_policy(id,content,revision,updated_at,updated_by) VALUES(1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET content=excluded.content,revision=excluded.revision,updated_at=excluded.updated_at,updated_by=excluded.updated_by`,
      )
      .run(JSON.stringify(data), data.revision, new Date().toISOString(), user.id);
    audit(user.id, "discount:policy", null, { revision: data.revision, enabled: data.enabled });
    return data;
  });
}
function quoteData(id: string) {
  const q = getDb().prepare("SELECT * FROM internal_quotes WHERE id=?").get(id) as Row | undefined;
  if (!q) throw new Error("Orçamento não encontrado");
  const owner = getDb().prepare("SELECT roles FROM users WHERE id=?").get(q["owner_id"]);
  const roles: string[] = owner ? JSON.parse(String(owner["roles"])) : [];
  const items = getDb()
    .prepare(
      "SELECT position,omie_product_id,quantity,unit_price_cents,discount_type,discount_value,gross_cents,discount_cents,total_cents FROM internal_quote_items WHERE quote_id=? ORDER BY position",
    )
    .all(id) as Row[];
  const gross = items.reduce((s, r) => s + Number(r["gross_cents"]), 0),
    discount = items.reduce((s, r) => s + Number(r["discount_cents"]), 0);
  const general = Number(q["general_discount_cents"] || 0);
  // Percentuais digitados mantêm sua alçada mesmo quando meio centavo é arredondado no item.
  const itemBp = (i: Row) =>
    i["discount_type"] === "percentual"
      ? Math.round(Number(i["discount_value"]) * 100)
      : discountBasisPoints(Number(i["discount_cents"]), Number(i["gross_cents"]));
  const weighted = items.reduce(
    (sum, item) =>
      sum +
      (item["discount_type"] === "percentual"
        ? BigInt(Number(item["gross_cents"])) * BigInt(itemBp(item))
        : BigInt(Number(item["discount_cents"])) * 10_000n),
    BigInt(general) * 10_000n,
  );
  const combined = gross > 0 ? Number((weighted + BigInt(gross) - 1n) / BigInt(gross)) : 0;
  const bp = Math.max(
    0,
    ...items.map(itemBp),
    discountBasisPoints(general, gross - discount),
    combined,
  );
  const policy = readDiscountPolicy();
  const required = discountAuthority(bp, policy, roles);
  const financialHash = createHash("sha256")
    .update(
      JSON.stringify({
        owner: q["owner_id"],
        roles: [...roles].sort(),
        policy: policy.revision,
        items,
        general,
      }),
    )
    .digest("hex");
  return { q, items, policy, bp, required, financialHash };
}
const mayRead = (user: SiteUser, q: Row) => {
  if (!user.roles.includes("admin") && q["owner_id"] !== user.id)
    throw new Error("Forbidden: este orçamento é de outro usuário");
};
function status(id: string) {
  const data = quoteData(id);
  const request = schema()
    .prepare(
      "SELECT id,status,reason,requested_at,decided_at FROM discount_requests WHERE quote_id=? AND financial_hash=? ORDER BY rowid DESC LIMIT 1",
    )
    .get(id, data.financialHash) as Row | undefined;
  const state = !data.policy.enabled
    ? "desativado"
    : data.required === "livre"
      ? "livre"
      : data.required === "bloqueado"
        ? "bloqueado"
        : request?.["status"] || "nao_solicitado";
  return { ...data, request, state: String(state) };
}
export function discountStatus(actor: SiteUser | null, id: string) {
  const user = requireActiveUser(actor, ["admin", "comercial", "gerente"]);
  const data = status(id);
  mayRead(user, data.q);
  return {
    enabled: data.policy.enabled,
    basisPoints: data.bp,
    required: data.required,
    label: DISCOUNT_LABELS[data.required],
    state: data.state,
    ownerLimit: (() => {
      const r = getDb().prepare("SELECT roles FROM users WHERE id=?").get(data.q["owner_id"]);
      const roles: string[] = r ? JSON.parse(String(r["roles"])) : [];
      return roles.includes("admin")
        ? data.policy.diretoria
        : roles.includes("gerente")
          ? data.policy.gerente
          : data.policy.consultor;
    })(),
    requestId: data.request?.["id"] ? String(data.request["id"]) : null,
    reason: String(data.request?.["reason"] || ""),
    policy: data.policy,
  };
}
export function requestDiscountApproval(actor: SiteUser | null, id: string) {
  const user = requireActiveUser(actor, ["admin", "comercial", "gerente"]);
  schema();
  return transaction(() => {
    const data = status(id);
    mayRead(user, data.q);
    if (!data.policy.enabled) throw new Error("A política de descontos ainda não está ativa");
    if (["cancelado", "enviado_omie", "aceito"].includes(data.q["status"]))
      throw new Error("Solicite aprovação antes do aceite ou envio ao Omie");
    if (data.required === "bloqueado")
      throw new Error("Desconto acima do limite máximo da Diretoria");
    if (data.required === "livre") return { id: null, state: "livre" };
    if (data.request && ["pendente", "aprovado"].includes(data.state))
      return { id: String(data.request["id"]), state: data.state };
    const requestId = randomUUID();
    getDb()
      .prepare(
        "INSERT INTO discount_requests(id,quote_id,financial_hash,policy_revision,basis_points,required_role,quote_version,requested_by,requested_at,status) VALUES(?,?,?,?,?,?,?,?,?,'pendente')",
      )
      .run(
        requestId,
        id,
        data.financialHash,
        data.policy.revision,
        data.bp,
        data.required,
        Number(data.q["version"]),
        user.id,
        new Date().toISOString(),
      );
    audit(user.id, "discount:requested", id, {
      request_id: requestId,
      quote_version: Number(data.q["version"]),
      basis_points: data.bp,
    });
    return { id: requestId, state: "pendente" };
  });
}
export function discountQueue(actor: SiteUser | null) {
  const user = requireActiveUser(actor, ["admin", "gerente"]);
  const rows = schema()
    .prepare(
      `SELECT r.*,q.number,q.owner_id,u.email AS owner_name FROM discount_requests r JOIN internal_quotes q ON q.id=r.quote_id JOIN users u ON u.id=q.owner_id ORDER BY r.rowid DESC LIMIT 300`,
    )
    .all() as Row[];
  return rows.map((r) => {
    const current = status(String(r["quote_id"]));
    const stale = !current.policy.enabled || current.financialHash !== r["financial_hash"];
    const allowed =
      user.roles.includes("admin") ||
      (r["required_role"] === "gerente" &&
        Number(r["basis_points"]) <= Math.round(current.policy.gerente * 100));
    return {
      id: String(r["id"]),
      quoteId: String(r["quote_id"]),
      number: String(r["number"]),
      owner: String(r["owner_name"]),
      basisPoints: Number(r["basis_points"]),
      quoteVersion: Number(r["quote_version"]),
      state: stale ? "substituido" : String(r["status"]),
      requestedAt: String(r["requested_at"]),
      decidedAt: r["decided_at"] ? String(r["decided_at"]) : null,
      reason: String(r["reason"] || ""),
      required: String(r["required_role"]),
      canDecide: !stale && r["status"] === "pendente" && allowed && r["owner_id"] !== user.id,
    };
  });
}
export function decideDiscount(
  actor: SiteUser | null,
  id: string,
  decision: "aprovado" | "recusado",
  reason: string,
) {
  const user = requireActiveUser(actor, ["admin", "gerente"]);
  schema();
  const message = reason.trim();
  if (!message || message.length > 1000 || /[<>\u0000-\u001f]/.test(message))
    throw new Error("Informe uma justificativa de até 1000 caracteres");
  return transaction(() => {
    requireActiveUser(user, ["admin", "gerente"]);
    const r = getDb().prepare("SELECT * FROM discount_requests WHERE id=?").get(id) as
      Row | undefined;
    if (!r || r["status"] !== "pendente")
      throw new Error("Solicitação não encontrada ou já analisada");
    const current = status(String(r["quote_id"]));
    if (!current.policy.enabled || current.financialHash !== r["financial_hash"])
      throw new Error("O desconto ou a política mudou. Solicite nova aprovação");
    if (current.q["owner_id"] === user.id)
      throw new Error("A aprovação deve ser feita por outra pessoa autorizada");
    if (
      !user.roles.includes("admin") &&
      (current.required !== "gerente" || current.bp > Math.round(current.policy.gerente * 100))
    )
      throw new Error("Forbidden: este desconto precisa da Diretoria (Admin)");
    getDb()
      .prepare(
        "UPDATE discount_requests SET status=?,reason=?,decided_at=?,decided_by=? WHERE id=?",
      )
      .run(decision, message, new Date().toISOString(), user.id, id);
    audit(user.id, `discount:${decision}`, String(r["quote_id"]), {
      request_id: id,
      quote_version: Number(r["quote_version"]),
    });
    return { ok: true };
  });
}
export function assertDiscountCeiling(id: string) {
  const data = quoteData(id);
  if (data.policy.enabled && data.required === "bloqueado")
    throw new Error(
      "Desconto acima do limite máximo da Diretoria. Ajuste os valores antes de salvar.",
    );
}
export function assertDiscountApproval(id: string, proposalVersion?: number) {
  const data = status(id);
  if (!data.policy.enabled) return;
  if (data.required === "bloqueado")
    throw new Error("Desconto acima do limite máximo da Diretoria");
  if (data.required !== "livre" && data.state !== "aprovado")
    throw new Error(
      `Desconto ${data.state === "recusado" ? "recusado" : "pendente de aprovação"}: solicite análise antes de enviar ou aceitar a proposta`,
    );
  if (proposalVersion) {
    const version = getDb()
      .prepare(
        "SELECT content_hash FROM quote_proposals WHERE quote_id=? AND version=? AND deleted_at IS NULL",
      )
      .get(id, proposalVersion);
    if (
      !version ||
      version["content_hash"] !==
        hashDoOrcamento(data.q, itensDo(id), String(data.q["valid_until"] || ""))
    )
      throw new Error(
        "O orçamento mudou depois da proposta. Gere uma nova versão antes de enviar.",
      );
  }
}
