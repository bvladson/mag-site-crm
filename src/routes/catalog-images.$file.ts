import { createFileRoute } from "@tanstack/react-router";

const TYPES = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" } as const;

/** Fotos do Omie copiadas pelo worker; o nome é um hash, então nada fora da pasta é alcançável. */
export const Route = createFileRoute("/catalog-images/$file")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const match = /^[a-f0-9]{64}(?:-p)?\.(jpg|png|webp|gif)$/.exec(params.file);
        if (!match) return new Response("Not found", { status: 404 });
        const { readFile } = await import("node:fs/promises");
        const { join, resolve } = await import("node:path");
        const directory = resolve(process.env["OMIE_IMAGE_DIR"] || "./data/catalog-images");
        try {
          const bytes = await readFile(join(directory, params.file));
          const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
          return new Response(body, {
            headers: {
              "Content-Type": TYPES[match[1] as keyof typeof TYPES],
              "Cache-Control": "public, max-age=604800",
              "X-Content-Type-Options": "nosniff",
            },
          });
        } catch {
          return new Response("Not found", { status: 404, headers: { "Cache-Control": "public, max-age=300" } });
        }
      },
    },
  },
});
