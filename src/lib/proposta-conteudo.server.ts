/**
 * Conteúdo do orçamento que o cliente vê na proposta (usado por propostas e pelo aceite do orçamento, sem dependência
 * circular): itens, extras (frete, montagem, desconto geral) e a identidade do conteúdo (hash) que diz se o orçamento
 * mudou depois de uma versão. Notas internas, observações do pedido no Omie e e-mail da NF não entram.
 */
import { createHash } from "node:crypto";
import { getDb } from "./local-db.server.ts";
import { conteudoComparavel } from "./proposta-regras.ts";

type Linha = Record<string, unknown>;
const s = (valor: unknown) => (valor === null || valor === undefined ? "" : String(valor));

export const itensDo = (quoteId: string) => getDb().prepare("SELECT * FROM internal_quote_items WHERE quote_id=? ORDER BY position").all(quoteId) as Linha[];
export const extrasDo = (q: Linha) => ({
  descontoGeralCentavos: Number(q["general_discount_cents"] ?? 0), freteCentavos: Number(q["freight_cents"] ?? 0), montagemCentavos: Number(q["assembly_cents"] ?? 0),
});

/** Identidade do CONTEÚDO do orçamento (mesma definição desde a 1ª versão: os hashes já gravados continuam comparáveis). */
export function hashDoOrcamento(q: Linha, itens: Linha[], validade: string) {
  return createHash("sha256").update(conteudoComparavel({
    cliente: { empresa: s(q["customer_name"]), fantasia: s(q["customer_trade_name"]), contato: s(q["customer_contact"]), documento: s(q["customer_document"]),
      cidade: s(q["customer_city"]), uf: s(q["customer_state"]), email: s(q["customer_email"]), telefone: s(q["customer_phone"]) },
    itens: itens.map((i) => ({ produtoId: s(i["omie_product_id"]), sku: s(i["sku"]), nome: s(i["name"]), unidade: s(i["unit"]), quantidade: Number(i["quantity"]),
      precoCentavos: Number(i["unit_price_cents"]), descontoTipo: (i["discount_type"] as string | null) ?? null, descontoValor: Number(i["discount_value"]),
      totalCentavos: Number(i["total_cents"]) })),
    extras: extrasDo(q),
    condicoes: { pagamento: `${s(q["payment_code"])}|${s(q["payment_label"])}`, previsao: s(q["forecast_date"]) || null, validade },
    observacoes: s(q["proposal_notes"]) || null,
  })).digest("hex");
}

/**
 * Dados do PEDIDO que vão ao Omie sem aparecer na proposta (09/10/2026, tarde): conta corrente da venda, consumidor final e
 * observações do pedido. Ficam no retrato e no `order_hash` de cada versão; se mudarem depois, a versão não pode ser aceita
 * (nova versão → marcar enviada → novo aceite). O resto do que vai ao Pedido já está no hash do conteúdo (cliente, itens,
 * quantidades, preços, descontos, condição, previsão, frete, montagem e desconto geral).
 */
export type DadosDoPedido = { conta: string; consumidorFinal: boolean; observacoes: string };
export const dadosDoPedido = (q: Linha): DadosDoPedido => ({
  conta: s(q["selected_account_id"]), consumidorFinal: Boolean(Number(q["final_consumer"] ?? 0)), observacoes: s(q["order_notes"]),
});
export const hashDosDadosDoPedido = (d: DadosDoPedido) =>
  createHash("sha256").update(JSON.stringify({ conta: d.conta, consumidorFinal: d.consumidorFinal, observacoes: d.observacoes })).digest("hex");
export const hashDoPedido = (q: Linha) => hashDosDadosDoPedido(dadosDoPedido(q));

/** A versão vigente do orçamento (uma por orçamento; nunca excluída nem arquivada). */
export function versaoVigente(quoteId: string) {
  return (getDb().prepare(`SELECT id, version, content_hash, order_hash, sent_at, accepted_at, refused_at FROM quote_proposals
    WHERE quote_id=? AND current=1 AND deleted_at IS NULL`).get(quoteId) as Linha | undefined) ?? null;
}
