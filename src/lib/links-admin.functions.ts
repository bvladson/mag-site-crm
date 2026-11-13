import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { linkTreeContentSchema } from "./links";

async function guard() {
  const { authorize } = await import("./local-auth.server");
  return authorize(["admin"]);
}

export const getLinkTreeAdmin = createServerFn({ method: "GET" }).handler(async () => {
  const actor = await guard();
  const { readLinkTreeAdmin } = await import("./links.server");
  return readLinkTreeAdmin(actor);
});

const revisionSchema = z.number().int().min(0).safe();
export const saveLinkTreeDraft = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ revision: revisionSchema, content: linkTreeContentSchema }).strict().parse(data))
  .handler(async ({ data }) => {
    const actor = await guard();
    const { saveLinkTreeDraftCore } = await import("./links.server");
    return saveLinkTreeDraftCore(actor, data.revision, data.content);
  });

export const publishLinkTree = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ revision: revisionSchema }).strict().parse(data))
  .handler(async ({ data }) => {
    const actor = await guard();
    const { publishLinkTreeCore } = await import("./links.server");
    return publishLinkTreeCore(actor, data.revision);
  });

export const restoreLinkTree = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ revision: revisionSchema, publicationId: z.string().uuid() }).strict().parse(data))
  .handler(async ({ data }) => {
    const actor = await guard();
    const { restoreLinkTreeCore } = await import("./links.server");
    return restoreLinkTreeCore(actor, data.revision, data.publicationId);
  });

export const uploadLinkImage = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ base64: z.string().max(2_900_000) }).strict().parse(data))
  .handler(async ({ data }) => {
    const actor = await guard();
    const { uploadLinkImageCore } = await import("./links.server");
    return uploadLinkImageCore(actor, data.base64);
  });
