import { createServerFn } from "@tanstack/react-start";
import type { PublicSiteContent } from "./site-content";

export const getPublicSiteContent = createServerFn({ method: "GET" }).handler(async (): Promise<PublicSiteContent> => {
  const { readPublicSiteContent } = await import("./site-content.server");
  return readPublicSiteContent();
});
