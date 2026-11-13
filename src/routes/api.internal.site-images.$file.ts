import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/internal/site-images/$file")({
  server: { handlers: {
    GET: async ({ params }) => {
      const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" };
      const { authorize } = await import("@/lib/local-auth.server");
      const { readAdminSiteImage } = await import("@/lib/site-content.server");
      try {
        const bytes = readAdminSiteImage(authorize(["admin"]), params.file);
        if (!bytes) return new Response("Not found", { status: 404, headers });
        return new Response(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { headers: { ...headers, "Content-Type": "image/webp" } });
      } catch (error) {
        if (!/Unauthorized|Forbidden/.test(String(error))) throw error;
        return new Response("Sem permissão", { status: String(error).includes("Unauthorized") ? 401 : 403, headers });
      }
    },
  } },
});
