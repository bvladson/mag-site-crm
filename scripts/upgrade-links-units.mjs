/** One-time, conservative upgrade of the original MAG link-tree publication. */
import { getDb, closeDb } from "../src/lib/local-db.server.ts";
import { linkTreeContentSchema, newLinkTreeItem } from "../src/lib/links.ts";
import { readLinkTreeAdmin, saveLinkTreeDraftCore, publishLinkTreeCore } from "../src/lib/links.server.ts";

try {
  const actorId = process.argv[process.argv.indexOf("--actor") + 1];
  if (!process.argv.includes("--actor") || !actorId) throw new Error("Informe --actor com o ID do administrador.");
  const db = getDb();
  const row = db.prepare("SELECT id,email,roles,created_at FROM users WHERE id=? AND disabled=0").get(actorId);
  if (!row) throw new Error("Administrador não encontrado.");
  const actor = { id: String(row.id), email: String(row.email), roles: JSON.parse(String(row.roles)), created_at: String(row.created_at) };
  const state = readLinkTreeAdmin(actor);
  const latest = db.prepare("SELECT version,content FROM link_tree_publications ORDER BY version DESC LIMIT 1").get();
  if (!latest) throw new Error("A publicação inicial precisa existir.");
  const published = linkTreeContentSchema.parse(JSON.parse(String(latest.content)));
  if (Number(latest.version) !== 1 || state.draft.revision !== 1) {
    if (published.items.some(item => item.type === "location" && /Dom Manuel.*1180/i.test(item.address))) {
      console.log("Nenhuma alteração: a atualização das unidades já foi aplicada ou o conteúdo já foi administrado.");
    } else throw new Error("O conteúdo mudou desde a versão inicial. Atualize as unidades pelo painel para preservar as edições.");
  } else {
    if (JSON.stringify(state.draft.content) !== JSON.stringify(published)) throw new Error("Há um rascunho diferente da publicação. Revise-o pelo painel.");
    const content = structuredClone(state.draft.content);
    const br = content.items.find(item => item.type === "location" && /Sargento Portugal|BR.?116/i.test(item.address));
    if (!br) throw new Error("A unidade BR-116 inicial não foi identificada.");
    br.title = "Unidade BR-116";
    br.accent = "burgundy";
    for (const item of content.items) if (item.position > br.position) item.position++;
    content.items.push({
      ...newLinkTreeItem("location"), title: "Unidade Centro", active: true, accent: "ocean",
      address: "Av. Dom Manuel, 1180 - Centro, Fortaleza - CE, CEP 60060-091",
      landline: "558531220506", position: br.position + 1,
    });
    content.background.mode = "monthly";
    const saved = saveLinkTreeDraftCore(actor, state.draft.revision, content);
    const result = publishLinkTreeCore(actor, saved.revision);
    console.log(`Unidades e temas mensais publicados: versão ${result.version}. Nenhum vendedor de demonstração foi criado.`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Não foi possível atualizar as unidades.");
  process.exitCode = 1;
} finally { closeDb(); }
