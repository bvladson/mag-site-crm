import { createFileRoute } from "@tanstack/react-router";

const deny = (status: 401 | 403 | 404) =>
  new Response(status === 401 ? "Entre no painel para baixar o currículo." : status === 403 ? "Sem permissão." : "Não encontrado.", {
    status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" },
  });

/** Currículo só para Admin/DHO com sessão válida; sempre como anexo PDF, nunca exibido inline. */
export const Route = createFileRoute("/api/interno/curriculo/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(params.id)) return deny(404);
        const { sessionUser } = await import("@/lib/local-auth-core.server");
        const { SESSION_COOKIE } = await import("@/lib/local-auth.server");
        const cookie = (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim())
          .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
        const user = sessionUser(cookie?.slice(SESSION_COOKIE.length + 1));
        if (!user) return deny(401);
        if (!user.roles.some((role) => role === "admin" || role === "dho")) return deny(403);
        const { readLead, readResume, audit } = await import("@/lib/local-db.server");
        let bytes: Buffer;
        try {
          const row = readLead("job_applications", params.id);
          if (!row["resume_path"]) return deny(404);
          bytes = readResume(String(row["resume_path"]));
        } catch {
          return deny(404);
        }
        audit(user.id, "resume:download", params.id);
        const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        return new Response(body, {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="curriculo-${params.id.slice(0, 8)}.pdf"`,
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
          },
        });
      },
    },
  },
});
