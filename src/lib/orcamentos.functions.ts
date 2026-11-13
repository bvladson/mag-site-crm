import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ESTADOS } from "./orcamento-regras";

/**
 * Orçamento interno e conversão em Pedido de Venda no Omie. Só Admin e Comercial (DHO: 403; sem sessão: 401);
 * Comercial só nos próprios orçamentos (conferido no servidor). Escritas no Omie só pelo serviço omie-pedidos.
 */
type Papel = "admin" | "comercial" | "dho";
const COM: Papel[] = ["admin", "comercial"];
async function guard(roles: Papel[]) {
  const { authorize } = await import("./local-auth.server");
  return authorize(roles);
}
async function produtosDoIndice() {
  const { indiceInterno } = await import("./produtos-internos.server");
  return (await indiceInterno({ todos: true })).itens.map((p) => ({ id: p.id, sku: p.sku, nome: p.nome, unidade: p.unidade, slug: p.slug }));
}
const id = z.string().uuid();
const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const listarOrcamentosInternos = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ status: z.enum(ESTADOS).optional(), busca: z.string().max(80).optional() }).parse(d ?? {}))
  .handler(async ({ data }) => {
    const user = await guard(COM);
    const { listarOrcamentos } = await import("./orcamentos.server");
    return listarOrcamentos(user, data);
  });

export const lerOrcamentoInterno = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ id }).parse(d))
  .handler(async ({ data }) => {
    const user = await guard(COM);
    const { lerOrcamento } = await import("./orcamentos.server");
    const { resumoEnvio } = await import("./omie-conversao.server");
    const { vendedorDoUsuario } = await import("./omie-referencias.server");
    const { resumoPropostas, lerEmitente } = await import("./propostas.server");
    const { orcamento, itens, pedidoOmie } = lerOrcamento(user, data.id);
    return {
      orcamento, itens, envio: resumoEnvio(pedidoOmie), vendedorDono: vendedorDoUsuario(orcamento.donoId), eAdmin: user.roles.includes("admin"), eDono: orcamento.donoId === user.id,
      propostas: resumoPropostas(data.id, user), validadePadraoDias: lerEmitente().validadeDias,
    };
  });

/** Formas de pagamento e contas correntes sincronizadas do Omie e padrões configurados pelo Admin (para o editor do orçamento). */
export const opcoesDoOrcamento = createServerFn({ method: "GET" }).handler(async () => {
  await guard(COM);
  const { opcoesValidas, lerConfiguracao } = await import("./omie-referencias.server");
  const config = lerConfiguracao();
  const opcoes = opcoesValidas();
  return { formasPagamento: opcoes.formasPagamento.map((f) => ({ codigo: f.codigo, descricao: f.descricao })), formaPadrao: config.formaPagamento, consumidorFinalPadrao: config.consumidorFinal === "S",
    // Conta corrente: escolhida em cada venda (não há conta padrão).
    contas: opcoes.contas.map((c) => ({ codigo: c.codigo, descricao: c.descricao })) };
});

export const criarOrcamentoInterno = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ pedidoSiteId: id.optional() }).parse(d ?? {}))
  .handler(async ({ data }) => {
    const user = await guard(COM);
    const { criarOrcamento } = await import("./orcamentos.server");
    return criarOrcamento(user, await produtosDoIndice(), data.pedidoSiteId);
  });

const dadosSchema = z.object({
  versao: z.number().int().min(1),
  cliente: z.object({ nome: z.string().max(200), fantasia: z.string().max(200), documento: z.string().max(30), email: z.string().max(200), telefone: z.string().max(30), cidade: z.string().max(100), uf: z.string().max(5) }),
  itens: z.array(z.object({ produtoId: z.string().regex(/^\d{1,20}$/), quantidade: z.string().max(20), preco: z.string().max(30), descontoTipo: z.enum(["", "percentual", "valor"]), desconto: z.string().max(30) })).max(199),
  condicoes: z.object({ formaPagamento: z.string().max(3), previsao: z.string().max(10), consumidorFinal: z.boolean(), emailNf: z.string().max(400), observacoes: z.string().max(2000), notasInternas: z.string().max(5000),
    conta: z.string().max(20).optional() }),
  proposta: z.object({ contato: z.string().max(200), validade: z.string().max(10), descontoGeral: z.string().max(30), frete: z.string().max(30), montagem: z.string().max(30), observacoes: z.string().max(2000) }).optional(),
});
/** Nova negociação/opção: número novo, mesmo cliente, itens e condições; histórico separado; o dono continua o mesmo. */
export const duplicarOrcamentoInterno = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id }).parse(d))
  .handler(async ({ data }) => {
    const user = await guard(COM);
    const { duplicarOrcamento } = await import("./orcamentos.server");
    return duplicarOrcamento(user, data.id);
  });

export const salvarOrcamentoInterno = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id, dados: dadosSchema }).parse(d))
  .handler(async ({ data }) => {
    const user = await guard(COM);
    const { salvarOrcamento } = await import("./orcamentos.server");
    const produtos = new Map((await produtosDoIndice()).map((p) => [p.id, p]));
    return salvarOrcamento(user, data.id, data.dados, produtos);
  });

export const mudarEstadoOrcamento = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id, acao: z.enum(["salvar", "enviar", "aceitar", "reabrir", "cancelar"]), versao: z.number().int().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const user = await guard(COM);
    const { mudarEstado } = await import("./orcamentos.server");
    return mudarEstado(user, data.id, data.acao, data.versao);
  });

export const atualizarPrevisaoOrcamento = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id, previsao: dia }).parse(d))
  .handler(async ({ data }) => {
    const user = await guard(COM);
    const { atualizarPrevisao } = await import("./orcamentos.server");
    return atualizarPrevisao(user, data.id, data.previsao);
  });

// ---------- Conversão em Pedido de Venda no Omie ----------
export const revisarPedidoOmie = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id }).parse(d))
  .handler(async ({ data }) => {
    const user = await guard(COM);
    const { prepararRevisao } = await import("./omie-conversao.server");
    return prepararRevisao(user, data.id);
  });

export const buscarClientesNoOmie = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id, documento: z.string().regex(/^\d{11}$|^\d{14}$/).optional(), nome: z.string().min(3).max(60).optional() })
    .refine((v) => Boolean(v.documento) !== Boolean(v.nome), "Informe CPF/CNPJ ou nome").parse(d))
  .handler(async ({ data }) => {
    const user = await guard(COM);
    const { buscarClientesOmie } = await import("./omie-conversao.server");
    return buscarClientesOmie(user, data.id, data.documento ? { documento: data.documento } : { nome: data.nome ?? "" });
  });

export const vincularClienteOmie = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id, codigoCliente: z.string().regex(/^\d{1,20}$/) }).parse(d))
  .handler(async ({ data }) => {
    const user = await guard(COM);
    const { vincularCliente } = await import("./omie-conversao.server");
    return vincularCliente(user, data.id, data.codigoCliente);
  });

export const criarClienteNoOmie = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id, confirmado: z.literal(true) }).parse(d))
  .handler(async ({ data }) => {
    const user = await guard(COM);
    const { criarClienteOmie } = await import("./omie-conversao.server");
    return criarClienteOmie(user, data.id);
  });

export const gerarPedidoOmie = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id, token: z.string().regex(/^[0-9a-f]{48}$/), revisado: z.literal(true), semEstoque: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const user = await guard(COM);
    const { gerarPedido } = await import("./omie-conversao.server");
    return gerarPedido(user, data.id, data.token, { revisado: data.revisado, semEstoque: data.semEstoque });
  });

export const verificarPedidoOmie = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id }).parse(d))
  .handler(async ({ data }) => {
    const user = await guard(COM);
    const { verificarNoOmie } = await import("./omie-conversao.server");
    return verificarNoOmie(user, data.id);
  });

export const usarEmailDoCadastroOmie = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id }).parse(d))
  .handler(async ({ data }) => {
    const user = await guard(COM);
    const { usarEmailDoCadastro } = await import("./omie-conversao.server");
    return usarEmailDoCadastro(user, data.id);
  });

export const atualizarStatusOmie = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id }).parse(d))
  .handler(async ({ data }) => {
    const user = await guard(COM);
    const { atualizarStatus } = await import("./omie-conversao.server");
    return atualizarStatus(user, data.id);
  });
