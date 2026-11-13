import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Integração com o Omie (só Admin): dados sincronizados, vínculo usuário → vendedor (confirmação explícita),
 * padrões do Pedido de Venda e "Atualizar dados do Omie agora". Nada aqui escreve no Omie.
 */
async function admin() {
  const { authorize } = await import("./local-auth.server");
  return authorize(["admin"]);
}

export const painelOmie = createServerFn({ method: "GET" }).handler(async () => {
  await admin();
  const ref = await import("./omie-referencias.server");
  const { servicoOmie } = await import("./omie-pedidos-cliente.server");
  const servico = await servicoOmie("/verificar");
  return {
    servico: { ok: servico.ok, escrita: servico["escrita"] === true, chavesOmie: servico["chavesOmie"] === true, motivo: servico.motivo ?? null },
    situacao: ref.situacaoReferencias(), configuracao: ref.lerConfiguracao(), opcoes: ref.opcoesValidas(),
    vendedores: ref.vendedores(), vinculos: ref.vinculosDoPainel(),
  };
});

export const sincronizarOmieAgora = createServerFn({ method: "POST" }).handler(async () => {
  const user = await admin();
  const { consumeRateLimit } = await import("./local-db.server");
  if (!consumeRateLimit(`omie-sync:${user.id}`, 6, 600)) throw new Error("Aguarde alguns minutos antes de atualizar de novo.");
  const { sincronizarReferencias } = await import("./omie-referencias.server");
  return sincronizarReferencias(user.id);
});

export const confirmarVinculoVendedor = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ usuarioId: z.string().uuid(), codigoVendedor: z.string().regex(/^\d{1,20}$/) }).parse(d))
  .handler(async ({ data }) => {
    const user = await admin();
    const { confirmarVinculo } = await import("./omie-referencias.server");
    return confirmarVinculo(user.id, data.usuarioId, data.codigoVendedor);
  });

export const removerVinculoVendedor = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ usuarioId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const user = await admin();
    const { removerVinculo } = await import("./omie-referencias.server");
    return removerVinculo(user.id, data.usuarioId);
  });

export const salvarConfiguracaoOmie = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({
    // Sem conta corrente: ela é escolhida em cada venda (orçamento), não há padrão.
    etapa: z.string().max(2), formaPagamento: z.string().max(3), categoria: z.string().max(20),
    consumidorFinal: z.enum(["S", "N"]), semEstoque: z.enum(["confirmar", "permitir", "bloquear"]),
  }).parse(d))
  .handler(async ({ data }) => {
    const user = await admin();
    const { salvarConfiguracao } = await import("./omie-referencias.server");
    return salvarConfiguracao(user.id, data);
  });
