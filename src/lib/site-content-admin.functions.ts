import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { siteContentSchema } from "./site-content";

async function guard() {
  const { setResponseHeader } = await import("@tanstack/react-start/server");
  setResponseHeader("Cache-Control", "private, no-store");
  setResponseHeader("X-Robots-Tag", "noindex, nofollow");
  const { authorize } = await import("./local-auth.server");
  return authorize(["admin"]);
}

export const getSiteContentAdmin = createServerFn({ method: "GET" }).handler(async () => {
  const actor = await guard();
  const { readSiteContentAdmin } = await import("./site-content.server");
  return readSiteContentAdmin(actor);
});
const revisionSchema = z.number().int().min(0).safe();
export const saveSiteContentDraft = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ revision: revisionSchema, content: siteContentSchema }).strict().parse(input))
  .handler(async ({ data }) => {
    const actor = await guard();
    const { saveSiteContentDraftCore } = await import("./site-content.server");
    return saveSiteContentDraftCore(actor, data.revision, data.content);
  });
export const publishSiteContent = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ revision: revisionSchema }).strict().parse(input))
  .handler(async ({ data }) => {
    const actor = await guard();
    const { publishSiteContentCore } = await import("./site-content.server");
    return publishSiteContentCore(actor, data.revision);
  });
export const restoreSiteContent = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ revision: revisionSchema, publicationId: z.string().uuid() }).strict().parse(input))
  .handler(async ({ data }) => {
    const actor = await guard();
    const { restoreSiteContentCore } = await import("./site-content.server");
    return restoreSiteContentCore(actor, data.revision, data.publicationId);
  });
export const uploadSiteImage = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ base64: z.string().max(2_900_000) }).strict().parse(input))
  .handler(async ({ data }) => {
    const actor = await guard();
    const { uploadSiteImageCore } = await import("./site-content.server");
    return uploadSiteImageCore(actor, data.base64);
  });
