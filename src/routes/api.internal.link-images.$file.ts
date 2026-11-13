import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/internal/link-images/$file")({
  server: { handlers: {
    GET: async ({ params }) => {
      const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" };
      const { authorize } = await import("@/lib/local-auth.server");
      let actor;
      try { actor = authorize(["admin"]); }
      catch (error) { return new Response("Sem permissão", { status: String(error).includes("Unauthorized") ? 401 : 403, headers }); }
      const { readAdminLinkImage } = await import("@/lib/links.server");
      const bytes = readAdminLinkImage(actor, params.file);
      if (!bytes) return new Response("Not found", { status: 404, headers });
      return new Response(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { headers: { ...headers, "Content-Type": "image/webp" } });
    },
  } },
});
