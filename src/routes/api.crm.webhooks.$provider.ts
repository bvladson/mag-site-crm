import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/crm/webhooks/$provider")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (params.provider !== "meta") return new Response("Not found", { status: 404 });
        const { handleCrmWebhook } = await import("@/lib/crm-integrations.server");
        return handleCrmWebhook("meta", request);
      },
      POST: async ({ request, params }) => {
        if (params.provider === "waha") {
          const { handleWahaWebhook } = await import("@/lib/crm-waha.server");
          return handleWahaWebhook(request);
        }
        if (!["evolution", "google", "meta"].includes(params.provider))
          return new Response("Not found", { status: 404 });
        const { handleCrmWebhook } = await import("@/lib/crm-integrations.server");
        return handleCrmWebhook(params.provider as "evolution" | "google" | "meta", request);
      },
    },
  },
});
