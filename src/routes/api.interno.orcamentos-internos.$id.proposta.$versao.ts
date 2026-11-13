import { createFileRoute } from "@tanstack/react-router";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NUNCA_GUARDAR = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
const negar = (status: 401 | 403 | 404 | 409 | 429 | 500) =>
  new Response(
    status === 401 ? "Entre no painel para ver a proposta." : status === 403 ? "Sem permissão." : status === 404 ? "Não encontrado."
      : status === 409 ? "A proposta precisa de revisão ou aprovação antes de ser enviada ou baixada. Imprimir e compartilhar usam a versão vigente."
      : status === 429 ? "Muitos pedidos em pouco tempo. Aguarde alguns minutos." : "Não foi possível gerar o PDF.",
    { status, headers: { "Content-Type": "text/plain; charset=utf-8", ...NUNCA_GUARDAR } },
  );
// visualizar/imprimir: abre no navegador (sem o painel); baixar/compartilhar: arquivo. Imprimir e compartilhar: só a vigente.
const MODOS = { visualizar: "inline", imprimir: "inline", baixar: "attachment", compartilhar: "attachment" } as const;

/**
 * PDF de uma versão gravada da proposta comercial. Sessão + Admin (todos) ou Comercial (só os próprios orçamentos);
 * DHO 403; sem sessão 401. Nunca em cache nem indexado; a URL só tem o id do orçamento e o número da versão.
 */
export const Route = createFileRoute("/api/interno/orcamentos-internos/$id/proposta/$versao")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!UUID.test(params.id) || !/^[1-9]\d{0,3}$/.test(params.versao)) return negar(404);
        const modo = new URL(request.url).searchParams.get("modo") ?? "visualizar";
        if (!Object.hasOwn(MODOS, modo)) return negar(404);
        const { sessionUser } = await import("@/lib/local-auth-core.server");
        const { SESSION_COOKIE } = await import("@/lib/local-auth.server");
        const cookie = (request.headers.get("cookie") ?? "").split(";").map((parte) => parte.trim())
          .find((parte) => parte.startsWith(`${SESSION_COOKIE}=`));
        const user = sessionUser(cookie?.slice(SESSION_COOKIE.length + 1));
        if (!user) return negar(401);
        if (!user.roles.some((perfil) => perfil === "admin" || perfil === "comercial")) return negar(403);
        const { audit, consumeRateLimit } = await import("@/lib/local-db.server");
        const { createHash } = await import("node:crypto");
        if (!consumeRateLimit(`proposta-pdf:${createHash("sha256").update(user.id).digest("hex")}`, 120, 600)) return negar(429);
        const { pdfDaProposta, iniciarCompartilhamento } = await import("@/lib/propostas.server");
        let pdf: Awaited<ReturnType<typeof pdfDaProposta>>;
        try {
          pdf = await pdfDaProposta(user, params.id, Number(params.versao), {}, { somenteVigente: modo === "imprimir" || modo === "compartilhar", distribuir: modo !== "visualizar" });
        } catch (erro) {
          const mensagem = erro instanceof Error ? erro.message : "";
          if (mensagem.startsWith("Forbidden")) return negar(403);
          if (/não encontrad/i.test(mensagem)) return negar(404);
          if (/versão vigente|desconto|aprovação|orçamento mudou/i.test(mensagem)) return negar(409);
          console.error(`[proposta] falha ao gerar o PDF: ${erro instanceof Error ? erro.name : "erro"}`);
          return negar(500);
        }
        // Compartilhar pelo aparelho = compartilhamento iniciado (o painel não sabe se o cliente recebeu; "enviada" é marcada à parte).
        if (modo === "compartilhar") iniciarCompartilhamento(params.id, Number(params.versao), "compartilhar", user.id);
        audit(user.id, `quote:proposta:${modo}`, params.id, { versao: Number(params.versao) });
        const body = pdf.bytes.buffer.slice(pdf.bytes.byteOffset, pdf.bytes.byteOffset + pdf.bytes.byteLength) as ArrayBuffer;
        return new Response(body, {
          headers: {
            "Content-Type": "application/pdf", "Content-Length": String(pdf.bytes.byteLength),
            "Content-Disposition": `${MODOS[modo as keyof typeof MODOS]}; filename="${pdf.arquivo}"`,
            ...NUNCA_GUARDAR,
          },
        });
      },
    },
  },
});
