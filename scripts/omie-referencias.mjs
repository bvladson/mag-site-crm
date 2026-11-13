#!/usr/bin/env node
/**
 * Projeto mag-site — atualização diária (05:40, bin/omie-referencias.sh) dos dados do Omie usados no Pedido de Venda:
 * vendedores, etapas, formas de pagamento, categorias e contas. Roda DENTRO do container do site (banco e token do
 * serviço omie-pedidos); só leitura no Omie. Falha mantém o último cadastro válido. Saída ≠ 0 se algo falhou.
 */
import { sincronizarReferencias } from "../src/lib/omie-referencias.server.ts";

try {
  const r = await sincronizarReferencias(null);
  console.log(JSON.stringify({ evento: "omie_referencias", ...r }));
  process.exitCode = r.ok ? 0 : 1;
} catch (error) {
  console.log(JSON.stringify({ evento: "omie_referencias", ok: false, erro: String(error?.code ?? error?.message ?? "erro").slice(0, 80) }));
  process.exitCode = 1;
}
