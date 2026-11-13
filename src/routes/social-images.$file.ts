import { createFileRoute } from "@tanstack/react-router";

/**
 * Imagens das redes: miniaturas baixadas pelo worker (hash.webp) e as enviadas no painel para destaques manuais
 * (m-<uuid>.jpg|png|webp). Só esses dois formatos de nome são aceitos; nada fora das duas pastas é alcançável.
 */
export const Route = createFileRoute("/social-images/$file")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { socialImagePath } = await import("@/lib/social.server");
        const found = socialImagePath(params.file);
        if (!found) return new Response("Not found", { status: 404 });
        const { readFile } = await import("node:fs/promises");
        try {
          const bytes = await readFile(found.path);
          const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
          return new Response(body, {
            headers: {
              "Content-Type": found.type, "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff",
              "Content-Security-Policy": "default-src 'none'; sandbox",
            },
          });
        } catch {
          return new Response("Not found", { status: 404, headers: { "Cache-Control": "public, max-age=300" } });
        }
      },
    },
  },
});
