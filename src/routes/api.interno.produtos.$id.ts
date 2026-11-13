import { createFileRoute } from "@tanstack/react-router";

/**
 * Consulta rápida — um produto (publicado no site ou só do cadastro completo do Omie). GET: dados locais + disponível da
 * última sincronização (+ última consulta ao Omie, se ainda no cache). POST: "Consultar Omie agora" (somente leitura,
 * pelo serviço interno omie-consulta; vale também para produto fora do site).
 * Só Admin e Comercial (sem sessão 401, DHO 403); POST só da própria origem. Falha do Omie responde 200 com o motivo.
 */
export const Route = createFileRoute("/api/interno/produtos/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { exigirPerfil, json } = await import("@/lib/interno-api.server");
        const acesso = exigirPerfil(request, ["admin", "comercial"]);
        if ("resposta" in acesso) return acesso.resposta;
        if (!/^\d{1,20}$/.test(params.id)) return json(400, { ok: false, motivo: "produto" });
        const { produtoInterno } = await import("@/lib/produtos-internos.server");
        const dados = await produtoInterno(params.id);
        return dados.produto ? json(200, { ok: true, ...dados }) : json(404, { ok: false, motivo: "nao_encontrado" });
      },
      POST: async ({ request, params }) => {
        const { exigirPerfil, json, mesmaOrigem } = await import("@/lib/interno-api.server");
        const acesso = exigirPerfil(request, ["admin", "comercial"]);
        if ("resposta" in acesso) return acesso.resposta;
        if (!mesmaOrigem(request)) return json(403, { ok: false, motivo: "origem" });
        if (!/^\d{1,20}$/.test(params.id)) return json(400, { ok: false, motivo: "produto" });
        const { produtoInterno, consultarOmie } = await import("@/lib/produtos-internos.server");
        if (!(await produtoInterno(params.id)).produto) return json(404, { ok: false, motivo: "nao_encontrado" });
        try {
          return json(200, await consultarOmie(params.id, acesso.usuario.id));
        } catch {
          return json(200, { ok: false, motivo: "omie_erro", mensagem: "Não foi possível consultar o Omie agora.", ultimaSincronizacao: null });
        }
      },
    },
  },
});
