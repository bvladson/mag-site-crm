import { createServerFn } from "@tanstack/react-start";
import type { PublicLinkTree } from "./links";

export const getPublicLinkTree = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicLinkTree | null> => {
    const { readPublicLinkTree } = await import("./links.server");
    const publication = readPublicLinkTree();
    if (!publication) return null;
    const { metricsToken } = await import("./links-metrics.server");
    return { ...publication, metricsToken: metricsToken(publication.version) };
  },
);
