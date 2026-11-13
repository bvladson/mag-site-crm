import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { NETWORKS, SOCIAL_MODES, accountMatch, isNetworkUrl, networkInfo, youtubeId } from "@/config/social";

/**
 * Painel de redes sociais — só Admin. Guarda modo, perfil oficial e destaques manuais no banco do site.
 * Credenciais NÃO passam por aqui: ficam no secrets/social.env do worker; o painel só mostra o nome das variáveis
 * e o estado que o worker gravou (sem segredo).
 */
async function guard() {
  const { authorize } = await import("./local-auth.server");
  return authorize(["admin"]);
}

export const getSocialAdmin = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  const { readSocialSettings, readSocialStatus, readManualItems } = await import("./social.server");
  const settings = readSocialSettings();
  const status = readSocialStatus();
  return {
    checkedAt: status.checkedAt,
    networks: NETWORKS.map((network) => ({
      ...settings[network], label: networkInfo[network].label, example: networkInfo[network].example,
      credentials: networkInfo[network].credentials, access: networkInfo[network].access, sync: status.providers[network],
      // A conta de onde veio o conteúdo confere com o perfil oficial? "diverge" = o site não publica o conteúdo da API.
      match: accountMatch(network, settings[network].url, status.providers[network]?.account),
    })),
    items: readManualItems(true).map((row) => ({ ...row, active: Boolean(row.active) })),
  };
});

const settingInput = z.object({
  network: z.enum(NETWORKS), mode: z.enum(SOCIAL_MODES),
  url: z.string().trim().max(300).optional().default(""), handle: z.string().trim().max(80).optional().default(""),
});

export const saveSocialSetting = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => settingInput.parse(d))
  .handler(async ({ data }) => {
    const user = await guard();
    if (data.url && !isNetworkUrl(data.network, data.url)) throw new Error(`Endereço inválido: use o perfil oficial em https://…${networkInfo[data.network].hosts[0]}`);
    if (data.mode !== "disabled" && !data.url) throw new Error("Informe o endereço oficial do perfil para mostrar a rede no site");
    const { getDb, audit, transaction } = await import("./local-db.server");
    transaction(() => {
      getDb().prepare(`INSERT INTO social_settings(network,mode,profile_url,handle,updated_at,updated_by) VALUES (?,?,?,?,?,?)
        ON CONFLICT(network) DO UPDATE SET mode=excluded.mode, profile_url=excluded.profile_url, handle=excluded.handle,
        updated_at=excluded.updated_at, updated_by=excluded.updated_by`)
        .run(data.network, data.mode, data.url || null, data.handle || null, new Date().toISOString(), user.id);
      audit(user.id, `social:settings:${data.network}:${data.mode}`, data.network);
    });
    return { ok: true };
  });

const itemInput = z.object({
  network: z.enum(NETWORKS), url: z.string().trim().max(500), title: z.string().trim().max(200).optional().default(""),
  kind: z.enum(["video", "short", "reel", "post", "image", "carousel"]),
  published_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("").transform(() => undefined)),
  position: z.number().int().min(0).max(999).default(100),
  image: z.object({ base64: z.string().max(2_900_000) }).optional(),
});

/** Busca a miniatura oficial do vídeo no YouTube (sem chave de API) para destaque manual sem imagem enviada. */
async function youtubeThumbnail(id: string) {
  try {
    const response = await fetch(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.length <= 1024 * 1024 ? bytes : null;
  } catch { return null; }
}

export const createSocialItem = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => itemInput.parse(d))
  .handler(async ({ data }) => {
    const user = await guard();
    if (!isNetworkUrl(data.network, data.url)) throw new Error(`Use o link da publicação no ${networkInfo[data.network].label} (https://…${networkInfo[data.network].hosts[0]}/…)`);
    const video = data.network === "youtube" ? youtubeId(data.url) : null;
    if (data.network === "youtube" && !video) throw new Error("Link de vídeo do YouTube não reconhecido");
    const { storeSocialImage, deleteSocialImage } = await import("./social.server");
    let image: string | null = null;
    if (data.image) image = storeSocialImage(Buffer.from(data.image.base64, "base64"));
    else if (video) { const bytes = await youtubeThumbnail(video); if (bytes) { try { image = storeSocialImage(bytes); } catch { image = null; } } }
    const { getDb, audit, transaction } = await import("./local-db.server");
    const id = crypto.randomUUID();
    try {
      transaction(() => {
        const now = new Date().toISOString();
        getDb().prepare(`INSERT INTO social_manual_items(id,network,url,title,kind,image,published_at,position,active,created_at,updated_at,created_by)
          VALUES (?,?,?,?,?,?,?,?,1,?,?,?)`).run(id, data.network, data.url, data.title || null, data.kind, image,
          data.published_at ? new Date(`${data.published_at}T12:00:00-03:00`).toISOString() : now, data.position, now, now, user.id);
        audit(user.id, "social:item:create", id);
      });
    } catch (error) {
      deleteSocialImage(image); // sem registro, a imagem não fica órfã
      throw error;
    }
    return { id };
  });

export const updateSocialItem = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), active: z.boolean(), position: z.number().int().min(0).max(999) }).parse(d))
  .handler(async ({ data }) => {
    const user = await guard();
    const { getDb, audit, transaction } = await import("./local-db.server");
    transaction(() => {
      const result = getDb().prepare("UPDATE social_manual_items SET active=?, position=?, updated_at=? WHERE id=?")
        .run(data.active ? 1 : 0, data.position, new Date().toISOString(), data.id);
      if (!result.changes) throw new Error("Item não encontrado");
      audit(user.id, `social:item:${data.active ? "show" : "hide"}`, data.id);
    });
    return { ok: true };
  });

export const deleteSocialItem = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const user = await guard();
    const { getDb, audit, transaction } = await import("./local-db.server");
    const { deleteSocialImage } = await import("./social.server");
    const image = transaction(() => {
      const row = getDb().prepare("SELECT image FROM social_manual_items WHERE id=?").get(data.id) as { image: string | null } | undefined;
      if (!row) throw new Error("Item não encontrado");
      getDb().prepare("DELETE FROM social_manual_items WHERE id=?").run(data.id);
      audit(user.id, "social:item:delete", data.id);
      return row.image;
    });
    deleteSocialImage(image);
    return { ok: true };
  });
