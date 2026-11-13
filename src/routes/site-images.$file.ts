import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/site-images/$file")({
  server: { handlers: {
    GET: async ({ params }) => {
      const { readPublicSiteImage } = await import("@/lib/site-content.server");
      const bytes = readPublicSiteImage(params.file);
      const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" };
      if (!bytes) return new Response("Not found", { status: 404, headers });
      return new Response(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { headers: { ...headers, "Content-Type": "image/webp" } });
    },
  } },
});
