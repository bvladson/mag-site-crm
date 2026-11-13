import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

async function read(request: Request, id: string) {
  const { crmHttpUser, crmHttpError, crmPrivateHeaders } = await import("@/lib/crm-http.server");
  try {
    const actor = crmHttpUser(request);
    z.string().uuid().parse(id);
    const { readCrmMedia } = await import("@/lib/crm-media.server");
    const result = readCrmMedia(actor, id, {
      ...(request.headers.get("range") ? { range: request.headers.get("range")! } : {}),
    });
    return new Response(request.method === "HEAD" ? null : new Uint8Array(result.body), {
      status: result.status,
      headers: { ...result.headers, ...crmPrivateHeaders },
    });
  } catch (error) {
    return crmHttpError(error);
  }
}
export const Route = createFileRoute("/api/interno/crm/anexos/$id")({
  server: {
    handlers: {
      GET: ({ request, params }) => read(request, params.id),
      HEAD: ({ request, params }) => read(request, params.id),
    },
  },
});
