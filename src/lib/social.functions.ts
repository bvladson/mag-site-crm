import { createServerFn } from "@tanstack/react-start";
import type { SocialItem, SocialNetworkPublic, SocialProfile } from "@/config/social";

/** Perfis oficiais configurados (rodapé e dados estruturados). Sem tokens, sem estado interno. */
export const getSocialProfiles = createServerFn({ method: "GET" }).handler(async (): Promise<SocialProfile[]> => {
  const { publicProfiles } = await import("./social.server");
  try { return publicProfiles(); } catch (error) { console.error("[social] perfis indisponíveis", error); return []; }
});

/** Seleção curta para a home. Falha de leitura nunca derruba a página: volta vazio. */
export const getSocialHome = createServerFn({ method: "GET" }).handler(async (): Promise<{ profiles: SocialProfile[]; videos: SocialItem[]; others: SocialItem[] }> => {
  const { homeSocial } = await import("./social.server");
  try { return homeSocial(); } catch (error) { console.error("[social] home indisponível", error); return { profiles: [], videos: [], others: [] }; }
});

/** Página /redes: todas as redes visíveis com até 12 itens cada. */
export const getSocialPage = createServerFn({ method: "GET" }).handler(async (): Promise<SocialNetworkPublic[]> => {
  const { publicNetworks } = await import("./social.server");
  try { return publicNetworks(12); } catch (error) { console.error("[social] página indisponível", error); return []; }
});
