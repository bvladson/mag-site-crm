/**
 * Catálogo no Atendimento (etapa 2) — SOMENTE LEITURA do Omie.
 *
 * - Busca, ficha e estoque por local vêm da Consulta rápida (rotas /api/interno/produtos: arquivos locais e o serviço
 *   omie-consulta, com cache, limite e fonte/horário de cada número). Nada novo chama o Omie aqui.
 * - Rascunho por oportunidade: produto + quantidade, SEM preço, preso ao dono da oportunidade. "Gerar orçamento" cria (ou
 *   completa) a negociação pelo motor da MAG; preço, desconto, condições e proposta seguem no editor da negociação.
 * - Pedidos do cliente: o que já existe em omie_orders para as negociações do cliente (status consultado no Omie pelo
 *   "Atualizar status" da negociação, que é só leitura).
 */
import { audit, getDb } from "./local-db.server.ts";
import { requireActiveUser, type SiteUser } from "./local-auth-core.server.ts";
import { createQuoteForOpportunity, requireCrmContact, requireCrmOpportunity } from "./crm.server.ts";
import { adicionarItens } from "./orcamentos.server.ts";

export type ProdutoDoCatalogo = { id: string; sku: string; nome: string; unidade: string; slug: string | null };
export interface ItemDoRascunho { produtoId: string; sku: string; nome: string; unidade: string; quantidade: number }
export interface Rascunho { opportunityId: string; itens: ItemDoRascunho[]; revision: number; atualizadoEm: string | null }
type Row = Record<string, unknown>;

export const MAX_ITENS_RASCUNHO = 199;
const MAX_QTD = 100_000;
const commercial = (actor: SiteUser | null) => requireActiveUser(actor, ["admin", "comercial"]);
const isAdmin = (user: SiteUser) => user.roles.includes("admin");

function schema() {
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS crm_opportunity_drafts(
    opportunity_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, items TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
    updated_by TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  return db;
}

function rowOf(opportunityId: string) {
  return schema().prepare("SELECT * FROM crm_opportunity_drafts WHERE opportunity_id=?").get(opportunityId) as Row | undefined;
}
/** Rascunho válido só para o dono atual da oportunidade: se ela mudou de mão, o antigo some (não vaza para o novo dono). */
function draftOf(opportunityId: string, ownerId: string): Rascunho {
  const row = rowOf(opportunityId);
  if (!row || row["owner_id"] !== ownerId) return { opportunityId, itens: [], revision: 0, atualizadoEm: null };
  return { opportunityId, itens: JSON.parse(String(row["items"])) as ItemDoRascunho[], revision: Number(row["revision"]), atualizadoEm: String(row["updated_at"]) };
}

export function lerRascunho(actor: SiteUser | null, opportunityId: string): Rascunho {
  const user = commercial(actor);
  const op = requireCrmOpportunity(user, opportunityId);
  return draftOf(op.id, op.ownerId);
}

function quantidadeValida(valor: number) {
  return Number.isFinite(valor) && valor > 0 && valor <= MAX_QTD && Math.round(valor * 1000) === valor * 1000;
}

export function salvarRascunho(
  actor: SiteUser | null,
  input: { opportunityId: string; revision: number; itens: { produtoId: string; quantidade: number }[] },
  produtos: ProdutoDoCatalogo[],
): Rascunho {
  const user = commercial(actor);
  const op = requireCrmOpportunity(user, input.opportunityId);
  if (op.stage === "fechado" || op.stage === "perdido") throw new Error("Negociação encerrada: reabra antes de montar um rascunho.");
  if (input.itens.length > MAX_ITENS_RASCUNHO) throw new Error(`No máximo ${MAX_ITENS_RASCUNHO} itens no rascunho.`);
  const porId = new Map(produtos.map((p) => [p.id, p]));
  const vistos = new Set<string>();
  const itens: ItemDoRascunho[] = input.itens.map((item) => {
    if (!/^\d{1,20}$/.test(item.produtoId)) throw new Error("Produto inválido.");
    if (vistos.has(item.produtoId)) throw new Error("O mesmo produto apareceu duas vezes: ajuste a quantidade dele.");
    vistos.add(item.produtoId);
    if (!quantidadeValida(item.quantidade)) throw new Error("Quantidade inválida (maior que zero, até 3 casas decimais).");
    const produto = porId.get(item.produtoId);
    if (!produto) throw new Error("Produto não encontrado no cadastro do Omie (atualize a lista).");
    return { produtoId: produto.id, sku: produto.sku, nome: produto.nome, unidade: produto.unidade || "UN", quantidade: item.quantidade };
  });
  const db = schema();
  const current = draftOf(op.id, op.ownerId);
  if (current.revision !== input.revision) throw new Error("Conflito: o rascunho mudou em outra tela. Atualize antes de salvar.");
  const now = new Date().toISOString();
  if (!itens.length) db.prepare("DELETE FROM crm_opportunity_drafts WHERE opportunity_id=?").run(op.id);
  else
    db.prepare(
      `INSERT INTO crm_opportunity_drafts(opportunity_id,owner_id,items,revision,updated_by,updated_at) VALUES(?,?,?,?,?,?)
       ON CONFLICT(opportunity_id) DO UPDATE SET owner_id=excluded.owner_id,items=excluded.items,revision=excluded.revision,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
    ).run(op.id, op.ownerId, JSON.stringify(itens), current.revision + 1, user.id, now);
  audit(user.id, "crm:draft:saved", op.id, { itens: itens.length });
  return draftOf(op.id, op.ownerId);
}

/**
 * Leva o rascunho para a negociação da oportunidade (cria pelo motor da MAG, se ainda não houver) com preço zero; o
 * vendedor completa preço e condições no editor. Conferência da revisão, itens e limpeza do rascunho: uma transação só.
 */
export function gerarOrcamentoDoRascunho(
  actor: SiteUser | null,
  input: { opportunityId: string; revision: number },
  produtos: ProdutoDoCatalogo[],
) {
  const user = commercial(actor);
  const op = requireCrmOpportunity(user, input.opportunityId);
  const draft = draftOf(op.id, op.ownerId);
  if (!draft.itens.length) throw new Error("O rascunho está vazio.");
  if (draft.revision !== input.revision) throw new Error("Conflito: o rascunho mudou em outra tela. Atualize antes de gerar.");
  const porId = new Map(produtos.map((p) => [p.id, p]));
  const itens = draft.itens.map((item) => {
    const produto = porId.get(item.produtoId);
    if (!produto) throw new Error(`O produto ${item.sku} saiu do cadastro do Omie: tire-o do rascunho.`);
    return { produto, qtd: item.quantidade };
  });
  const quote = createQuoteForOpportunity(user, { opportunityId: op.id }, produtos);
  const result = adicionarItens(user, quote.id, itens, () => {
    const now = draftOf(op.id, op.ownerId);
    if (now.revision !== input.revision) throw new Error("Conflito: o rascunho mudou em outra tela. Atualize antes de gerar.");
    getDb().prepare("DELETE FROM crm_opportunity_drafts WHERE opportunity_id=?").run(op.id);
  });
  audit(user.id, "crm:draft:converted", op.id, { quote_id: quote.id, itens: itens.length });
  return { quoteId: quote.id, numero: result.numero, versao: result.versao, adicionados: result.adicionados, detailUrl: `/interno/orcamentos-internos/${quote.id}` };
}

/** Pedidos do Omie das negociações deste cliente (só o que já está registrado; nada é consultado aqui). */
export function pedidosDoContato(actor: SiteUser | null, contactId: string) {
  const user = commercial(actor);
  const contact = requireCrmContact(user, contactId);
  const db = getDb();
  const hasLinks = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='crm_quote_links'").get();
  if (!hasLinks) return { pedidos: [] };
  const etapas = new Map(
    (db.prepare("SELECT code,label FROM omie_refs WHERE kind='etapa'").all() as Row[]).map((r) => [String(r["code"]), String(r["label"])]),
  );
  const rows = db
    .prepare(
      `SELECT DISTINCT q.id quote_id,q.number,q.status,q.owner_id,o.state,o.omie_order_number,o.status_stage,o.status_cancelled,o.status_invoiced,
              o.status_checked_at,o.sent_at,o.last_error
       FROM crm_quote_links l JOIN crm_opportunities op ON op.id=l.opportunity_id JOIN internal_quotes q ON q.id=l.quote_id
       LEFT JOIN omie_orders o ON o.quote_id=q.id
       WHERE op.contact_id=? ${isAdmin(user) ? "" : "AND q.owner_id=?"} ORDER BY q.created_at DESC LIMIT 50`,
    )
    .all(...(isAdmin(user) ? [contact.id] : [contact.id, user.id])) as Row[];
  return {
    pedidos: rows.map((r) => ({
      quoteId: String(r["quote_id"]),
      numeroNegociacao: String(r["number"]),
      situacaoNegociacao: String(r["status"]),
      pedido: r["state"]
        ? {
            estado: String(r["state"]) as "enviando" | "incerto" | "criado" | "erro",
            numero: r["omie_order_number"] ? String(r["omie_order_number"]) : null,
            etapa: r["status_stage"] ? (etapas.get(String(r["status_stage"])) ?? String(r["status_stage"])) : null,
            cancelado: r["status_cancelled"] === 1,
            faturado: r["status_invoiced"] === 1,
            consultadoEm: r["status_checked_at"] ? String(r["status_checked_at"]) : null,
            enviadoEm: r["sent_at"] ? String(r["sent_at"]) : null,
            erro: r["state"] === "erro" && r["last_error"] ? String(r["last_error"]).slice(0, 160) : null,
          }
        : null,
      detailUrl: `/interno/orcamentos-internos/${String(r["quote_id"])}`,
    })),
  };
}
