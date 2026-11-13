/**
 * Redes sociais da MAG — configuração EXPLÍCITA dos perfis oficiais (nada vem de busca na internet).
 * O painel (/interno/redes) pode trocar modo, endereço e nome do perfil; estes são só os valores iniciais.
 * Modos: api (o worker sincroniza), manual (o painel cadastra os destaques), disabled (a rede não aparece).
 * Credenciais nunca ficam aqui: só no secrets/social.env do worker (servidor).
 */
export const NETWORKS = ["youtube", "instagram", "tiktok", "linkedin"] as const;
export type Network = (typeof NETWORKS)[number];
export const SOCIAL_MODES = ["api", "manual", "disabled"] as const;
export type SocialMode = (typeof SOCIAL_MODES)[number];

export const networkInfo: Record<Network, { label: string; hosts: string[]; example: string; credentials: string[]; access: string }> = {
  youtube: {
    label: "YouTube", hosts: ["youtube.com", "youtu.be"], example: "https://www.youtube.com/@canal",
    credentials: ["YOUTUBE_API_KEY", "YOUTUBE_CHANNEL_ID"],
    access: "YouTube Data API v3: chave do Google Cloud + ID do canal (UC…), gravados no servidor. Não depende de aprovação. Confira o canal sincronizado antes de mudar para API.",
  },
  instagram: {
    label: "Instagram", hosts: ["instagram.com"], example: "https://www.instagram.com/perfil",
    credentials: ["INSTAGRAM_ACCESS_TOKEN"],
    access: "Instagram API com login do Instagram (conta profissional) em um app da Meta; token de longa duração, renovado pelo worker.",
  },
  tiktok: {
    label: "TikTok", hosts: ["tiktok.com"], example: "https://www.tiktok.com/@perfil",
    credentials: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "TIKTOK_REFRESH_TOKEN"],
    access: "TikTok Display API (Login Kit, escopos user.info.basic e video.list): depende de app aprovado pelo TikTok.",
  },
  linkedin: {
    label: "LinkedIn", hosts: ["linkedin.com"], example: "https://www.linkedin.com/company/empresa",
    credentials: ["LINKEDIN_ORGANIZATION_ID", "LINKEDIN_ACCESS_TOKEN"],
    access: "Community Management API (r_organization_social): depende de aprovação do LinkedIn e de token de quem administra a página. A organização é a do LINKEDIN_ORGANIZATION_ID gravado no servidor — nunca deduzida pelo nome.",
  },
};

/**
 * Perfis OFICIAIS confirmados manualmente pela MAG em 06/10/2026 (não vieram de busca pública). Todos em modo manual:
 * o link aparece no rodapé, em /redes e no sameAs sem precisar de credencial. "api" só depois da credencial gravada no
 * servidor e da conta sincronizada conferida no painel. O painel pode sobrescrever estes valores iniciais.
 */
export const defaultProfiles: Record<Network, { url: string; handle: string; mode: SocialMode }> = {
  youtube: { url: "https://www.youtube.com/@magmoveiscorporativos7222", handle: "@magmoveiscorporativos7222", mode: "manual" },
  instagram: { url: "https://instagram.com/magmoveiscorporativos", handle: "@magmoveiscorporativos", mode: "manual" },
  tiktok: { url: "https://www.tiktok.com/@mag.moveis", handle: "@mag.moveis", mode: "manual" },
  linkedin: { url: "https://www.linkedin.com/company/magmoveiscorporativos", handle: "", mode: "manual" },
};

/** Endereço https de um dos domínios da rede (inclui subdomínios como www. e br.). */
export function isNetworkUrl(network: Network, value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && networkInfo[network].hosts.some((base) => host === base || host.endsWith(`.${base}`));
  } catch { return false; }
}

const INSTAGRAM_RESERVED = new Set(["p", "reel", "reels", "tv", "stories", "explore", "accounts"]);

/**
 * Conta esperada a partir do endereço OFICIAL configurado: @handle (YouTube e TikTok), usuário (Instagram), página
 * (LinkedIn, /company/<nome>) ou ID do canal (youtube.com/channel/UC…). Serve para conferir a conta de onde veio o
 * conteúdo da API — nunca para descobrir um perfil.
 */
export function profileIdentity(network: Network, value: string): { handle: string | null; id: string | null } {
  if (!isNetworkUrl(network, value)) return { handle: null, id: null };
  const parts = new URL(value).pathname.split("/").filter(Boolean).map((part) => {
    try { return decodeURIComponent(part); } catch { return part; }
  });
  const first = (parts[0] ?? "").toLowerCase();
  if (network === "youtube") {
    if (first.startsWith("@") && first.length > 1) return { handle: first.slice(1), id: null };
    if (first === "channel" && /^UC[\w-]{22}$/.test(parts[1] ?? "")) return { handle: null, id: parts[1]! };
    return { handle: null, id: null };
  }
  if (network === "tiktok") return { handle: first.startsWith("@") && first.length > 1 ? first.slice(1) : null, id: null };
  if (network === "instagram") return { handle: first && !INSTAGRAM_RESERVED.has(first) ? first : null, id: null };
  return { handle: first === "company" && parts[1] ? parts[1].toLowerCase() : null, id: null };
}

export type AccountMatch = "confere" | "diverge" | "indefinido";
/** Compara a conta sincronizada (worker) com o perfil oficial. "diverge" = o site não publica o conteúdo da API. */
export function accountMatch(network: Network, officialUrl: string, account: { id?: string | null | undefined; handle?: string | null | undefined } | null | undefined): AccountMatch {
  const expected = profileIdentity(network, officialUrl);
  const handle = account?.handle ? account.handle.replace(/^@/, "").toLowerCase() : null;
  if (expected.handle && handle) return expected.handle === handle ? "confere" : "diverge";
  if (expected.id && account?.id) return expected.id === account.id ? "confere" : "diverge";
  return "indefinido";
}

/** ID de vídeo do YouTube a partir de watch?v=, youtu.be/, /shorts/, /live/ ou /embed/. */
export function youtubeId(value: string) {
  try {
    const url = new URL(value);
    const id = url.hostname.endsWith("youtu.be") ? url.pathname.slice(1) : url.searchParams.get("v") ?? url.pathname.split("/").filter(Boolean)[1] ?? "";
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch { return null; }
}

export type SocialAspect = "16:9" | "9:16" | "1:1";
export type SocialType = "video" | "short" | "reel" | "post" | "image" | "carousel";
/** Item normalizado, igual para todas as redes (o site nunca vê o JSON de cada fornecedor). */
export type SocialItem = {
  network: Network; id: string; url: string; type: SocialType; title: string; image: string | null;
  publishedAt: string | null; author: string | null; duration: number | null; aspect: SocialAspect; youtubeId: string | null;
};
export type SocialProfile = { network: Network; label: string; url: string; handle: string };
export type SocialNetworkPublic = SocialProfile & { items: SocialItem[] };
