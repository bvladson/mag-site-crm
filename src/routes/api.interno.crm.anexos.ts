import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

export const Route = createFileRoute("/api/interno/crm/anexos")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const {
          crmHttpUser,
          assertCrmUploadOrigin,
          readCrmUploadForm,
          crmPrivateHeaders,
          crmHttpError,
        } = await import("@/lib/crm-http.server");
        try {
          const actor = crmHttpUser(request);
          assertCrmUploadOrigin(request);
          const contactId = z
            .string()
            .uuid()
            .parse(new URL(request.url).searchParams.get("contactId"));
          const file = await readCrmUploadForm(request);
          if (file.size > 7 * 1024 * 1024) throw new Error("media_too_large");
          const { stageCrmMedia } = await import("@/lib/crm-media.server");
          const attachment = stageCrmMedia(actor, {
            contactId,
            name: file.name,
            mimeType: file.type,
            bytes: Buffer.from(await file.arrayBuffer()),
          });
          return Response.json({ attachment }, { status: 201, headers: crmPrivateHeaders });
        } catch (error) {
          return crmHttpError(error, true);
        }
      },
    },
  },
});
