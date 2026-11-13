import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/links/events")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const headers = { "Cache-Control": "no-store" };
        const origin = request.headers.get("origin");
        const allowed = new Set([
          "https://magmoveiscorporativos.com.br",
          "https://www.magmoveiscorporativos.com.br",
          ...(process.env["SITE_PUBLIC_ORIGINS"] ?? "").split(",").filter(Boolean),
        ]);
        if (process.env["NODE_ENV"] !== "production") allowed.add(new URL(request.url).origin);
        if (
          !origin ||
          !allowed.has(origin) ||
          request.headers.get("content-type")?.split(";")[0] !== "application/json"
        )
          return new Response(null, { status: 403, headers });
        if (Number(request.headers.get("content-length") ?? 0) > 1200)
          return new Response(null, { status: 413, headers });
        try {
          const body = await request.text();
          if (body.length > 1200) return new Response(null, { status: 413, headers });
          const { recordLinkEvent } = await import("@/lib/links-metrics.server");
          recordLinkEvent(
            JSON.parse(body),
            request.headers.get("x-real-ip") ??
              request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
              "unknown",
          );
          return new Response(null, { status: 204, headers });
        } catch {
          return new Response(null, { status: 400, headers });
        }
      },
    },
  },
});
