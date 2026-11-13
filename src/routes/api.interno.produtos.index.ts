import { createFileRoute } from "@tanstack/react-router";

/**
 * Consulta rápida — índice interno dos produtos publicados, COM a quantidade disponível; com ?todos=1, também os demais
 * produtos do cadastro completo do Omie (sem estoque calculado). Só Admin e Comercial (sem sessão 401, DHO 403).
 * Opcional ?q=&filtro= (mesma busca do painel). Nunca chama o Omie.
 */
export const Route = createFileRoute("/api/interno/produtos/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { exigirPerfil, json } = await import("@/lib/interno-api.server");
        const acesso = exigirPerfil(request, ["admin", "comercial"]);
        if ("resposta" in acesso) return acesso.resposta;
        try {
          const { indiceInterno } = await import("@/lib/produtos-internos.server");
          const { buscarProdutos, filtroValido, MAX_CONSULTA } = await import("@/lib/produtos-busca");
          const url = new URL(request.url);
          const indice = await indiceInterno({ todos: url.searchParams.get("todos") === "1" });
          const consulta = (url.searchParams.get("q") ?? "").slice(0, MAX_CONSULTA);
          const filtro = filtroValido(url.searchParams.get("filtro"));
          if (!consulta && filtro === "todos" && !url.searchParams.has("q")) return json(200, { ok: true, ...indice, total: indice.itens.length });
          const resultado = buscarProdutos(indice.itens, consulta, filtro, 100);
          return json(200, { ok: true, sincronizadoEm: indice.sincronizadoEm, fresco: indice.fresco, cadastro: indice.cadastro, total: resultado.total, itens: resultado.itens });
        } catch {
          return json(503, { ok: false, motivo: "catalogo" });
        }
      },
    },
  },
});
