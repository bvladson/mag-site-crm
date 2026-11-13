/**
 * First publication of /links/, using the site's existing official business contacts.
 * node scripts/seed-links.mjs --actor <admin-id-or-email>
 * Requires an existing active admin. Repeated execution never changes a publication or an edited draft.
 */
import { randomUUID } from "node:crypto";
import { site } from "../src/config/site.ts";
import { defaultProfiles, NETWORKS, networkInfo } from "../src/config/social.ts";
import { emptyLinkTreeContent, newLinkTreeItem, isSafeLink } from "../src/lib/links.ts";
import { getDb, closeDb } from "../src/lib/local-db.server.ts";
import { seedLinkTreeCore } from "../src/lib/links.server.ts";

try {
  const args = process.argv.slice(2);
  const actorFlag = args.findIndex((arg) => arg === "--actor" || arg === "--actor-id");
  const actorArgument = args.find((arg) => arg.startsWith("--actor=") || arg.startsWith("--actor-id="))?.split("=").slice(1).join("=")
    || (actorFlag >= 0 ? args[actorFlag + 1] : undefined);
  if (!actorArgument || actorArgument.startsWith("--")) throw new Error("Informe --actor com o ID ou e-mail de um administrador existente.");
  const row = getDb().prepare("SELECT id,email,roles,created_at FROM users WHERE disabled=0 AND (id=? OR email=? COLLATE NOCASE)").get(actorArgument, actorArgument);
  if (!row) throw new Error("Administrador não encontrado.");
  const actor = { id: String(row.id), email: String(row.email), roles: JSON.parse(String(row.roles)), created_at: String(row.created_at) };
  const content = emptyLinkTreeContent();
  const add = (type, title, fields = {}) => {
    content.items.push({ ...newLinkTreeItem(type), id: randomUUID(), title, active: true, position: content.items.length, ...fields });
  };
  content.title = site.name;
  content.subtitle = site.tagline;
  if (/^55\d{10,11}$/.test(site.whatsapp)) add("whatsapp", "Fale com a MAG", { phone: site.whatsapp, message: "Olá! Vim pela página de links da MAG e gostaria de atendimento.", description: "Nossa equipe ajuda você a encontrar a solução ideal.", highlight: true });
  add("link", "Conheça nosso catálogo", { url: "/produtos", description: "Móveis e soluções para o seu ambiente de trabalho." });
  add("link", "Solicite seu orçamento", { url: "/orcamento", description: "Conte com a MAG para transformar seu espaço." });
  if (site.address) add("location", "Visite nossa loja", { address: site.address, description: site.hours || "" });
  add("heading", "Acompanhe a MAG");
  const settings = getDb().prepare("SELECT network,mode,profile_url FROM social_settings").all();
  for (const network of NETWORKS) {
    const saved = settings.find((entry) => entry.network === network);
    const mode = saved?.mode ?? defaultProfiles[network].mode;
    const url = saved?.profile_url ?? defaultProfiles[network].url;
    if (mode !== "disabled" && url && isSafeLink(String(url))) add("link", networkInfo[network].label, { url: String(url) });
  }
  add("link", "Trabalhe conosco", { url: "/carreiras", description: "Conheça nossas oportunidades e faça parte da equipe." });
  add("link", "Site institucional", { url: "/" });
  const result = seedLinkTreeCore(actor, content);
  console.log(result.seeded ? "Árvore de links inicial publicada: versão 1." : "Nenhuma alteração: a árvore já possui publicação ou rascunho editado.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Não foi possível inicializar a árvore de links.");
  process.exitCode = 1;
} finally { closeDb(); }
