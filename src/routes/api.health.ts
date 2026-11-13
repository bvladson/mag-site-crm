import { createFileRoute } from "@tanstack/react-router";

/** Usado pelo healthcheck do container; o Nginx só libera este caminho para a própria VPS. */
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const { getDb } = await import("@/lib/local-db.server");
        const { catalogHealth } = await import("@/lib/omie.server");
        let database = false;
        try {
          getDb().prepare("SELECT 1").get();
          database = true;
        } catch (error) {
          console.error("[health] banco indisponível", error);
        }
        const catalog = await catalogHealth();
        return Response.json(
          { status: database ? "ok" : "degraded", database, catalog },
          { status: database ? 200 : 503, headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
