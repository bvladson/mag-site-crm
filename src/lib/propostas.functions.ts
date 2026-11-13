import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Proposta comercial (PDF timbrado, versões, WhatsApp, e-mail e compartilhar). Admin: todos os orçamentos; Comercial: só
 * os próprios (conferido no servidor); DHO: 403; sem sessão: 401. O PDF sai pela rota /api/interno/orcamentos-internos/…
 * com a mesma sessão e permissão. Nada aqui chama o Omie.
 */
type Papel = "admin" | "comercial" | "dho";
const COM: Papel[] = ["admin", "comercial"];
async function guard(roles: Papel[]) {
  const { authorize } = await import("./local-auth.server");
  return authorize(roles);
}
const id = z.string().uuid();
const versao = z.number().int().min(1).max(9999);

/** Selo "pronta entrega", disponível (só para conferir a quantidade; nunca vai ao PDF) e foto, do catálogo publicado. */
async function catalogoDaProposta() {
  const { readInternalCatalog } = await import("./omie.server");
  const catalogo = await readInternalCatalog();
  const porId = new Map<string, { prontaEntrega: boolean; disponivel: number | null; foto: string | null }>();
  for (const p of catalogo?.products ?? []) {
    if (!p.id) continue;
    const foto = [p.image, ...p.images].find((caminho) => caminho.startsWith("/catalog-images/")) ?? null;
    porId.set(p.id, { prontaEntrega: Boolean(catalogo?.fresh) && p.stock === "PRONTA_ENTREGA", disponivel: p.available ?? null, foto });
  }
  return (produtoId: string) => porId.get(produtoId) ?? null;
}

export const gerarPropostaComercial = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id, versaoOrcamento: z.number().int().min(1), mostrarSku: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const user = await guard(COM);
    const { gerarProposta } = await import("./propostas.server");
    return gerarProposta(user, data.id, { versaoOrcamento: data.versaoOrcamento, mostrarSku: data.mostrarSku }, await catalogoDaProposta());
  });

/** POST: a resposta tem contato do cliente (nunca em URL ou cache). */
export const dadosDeEnvioDaProposta = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id, versao }).parse(d))
  .handler(async ({ data }) => {
    const user = await guard(COM);
    const { dadosParaEnvio } = await import("./propostas.server");
    return { ...dadosParaEnvio(user, data.id, data.versao), envioPeloServidor: envioConfigurado() };
  });

/** "✓ Marcar como enviada ao cliente" (só a vigente): abrir WhatsApp/e-mail/compartilhar NÃO conta como envio. */
export const marcarPropostaEnviada = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id, versao }).parse(d))
  .handler(async ({ data }) => {
    const user = await guard(COM);
    const { marcarVersaoEnviada } = await import("./propostas.server");
    return marcarVersaoEnviada(user, data.id, data.versao);
  });
/** "Cliente recusou esta versão" (só a vigente, antes do aceite). */
export const marcarPropostaRecusada = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id, versao }).parse(d))
  .handler(async ({ data }) => {
    const user = await guard(COM);
    const { marcarVersaoRecusada } = await import("./propostas.server");
    return marcarVersaoRecusada(user, data.id, data.versao);
  });

export const registrarAcaoDaProposta = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id, versao, acao: z.enum(["whatsapp", "email"]) }).parse(d))
  .handler(async ({ data }) => {
    const user = await guard(COM);
    const { registrarAcao } = await import("./propostas.server");
    return registrarAcao(user, data.id, data.versao, data.acao);
  });

/** Envio direto só com PROPOSTA_EMAIL_ENVIO=ligado + provedor configurado (desligado: a tela usa o programa de e-mail). */
function envioConfigurado() {
  return process.env["PROPOSTA_EMAIL_ENVIO"] === "ligado" && Boolean(process.env["RESEND_API_KEY"]) && Boolean(process.env["EMAIL_FROM"]);
}
export const enviarPropostaPorEmail = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id, versao, para: z.string().max(400), assunto: z.string().max(200), mensagem: z.string().max(6000), confirmado: z.literal(true) }).parse(d))
  .handler(async ({ data }) => {
    const user = await guard(COM);
    const { enviarPorEmail } = await import("./propostas.server");
    let enviar = null;
    if (envioConfigurado()) {
      const { createResendProvider } = await import("./email/resend-provider.server");
      const provedor = createResendProvider(process.env["EMAIL_FROM"] ?? "");
      const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
      enviar = async (m: { para: string[]; assunto: string; texto: string; responderPara: string; anexo: { arquivo: string; bytes: Uint8Array } }) => {
        const r = await provedor.sendEmail({
          to: m.para, subject: m.assunto, text: m.texto, replyTo: m.responderPara,
          html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;white-space:pre-wrap">${esc(m.texto)}</div>`,
          attachments: [{ filename: m.anexo.arquivo, content: Buffer.from(m.anexo.bytes).toString("base64") }],
        });
        return { enviado: r.sent };
      };
    }
    const r = await enviarPorEmail(user, data.id, data.versao, { para: data.para, assunto: data.assunto, mensagem: data.mensagem }, enviar);
    if (r.ok) return { ok: true as const };
    return { ok: false as const, mensagem: r.motivo === "nao_configurado"
      ? "O envio pelo painel ainda não está configurado: use \"Abrir no programa de e-mail\" e anexe o PDF baixado."
      : "O provedor de e-mail não aceitou o envio. Use \"Abrir no programa de e-mail\" e anexe o PDF baixado." };
  });

// ---------- Dados da proposta (Admin) e nome do(a) consultor(a) (cada pessoa) ----------
const emitenteSchema = z.object({
  nomeComercial: z.string().max(200), razaoSocial: z.string().max(200), cnpj: z.string().max(40), endereco: z.string().max(300), telefone: z.string().max(60),
  whatsapp: z.string().max(60), email: z.string().max(200), site: z.string().max(200), rodape: z.string().max(600), validadeDias: z.number().int().min(1).max(90),
  inscricaoEstadual: z.string().max(30).default(""), dadosBancarios: z.string().max(300).default(""), pix: z.string().max(140).default(""),
});
export const lerDadosDaProposta = createServerFn({ method: "GET" }).handler(async () => {
  await guard(["admin"]);
  const { lerEmitente } = await import("./propostas.server");
  return lerEmitente();
});
export const salvarDadosDaProposta = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => emitenteSchema.parse(d))
  .handler(async ({ data }) => {
    const user = await guard(["admin"]);
    const { salvarEmitente } = await import("./propostas.server");
    return salvarEmitente(user, data);
  });

/** Perfil comercial da PRÓPRIA pessoa (Minha conta): completo só para ela; para os outros, só o que é exibido. */
export const lerPerfilComercial = createServerFn({ method: "GET" }).handler(async () => {
  const user = await guard(COM);
  const { lerMeuPerfil } = await import("./propostas.server");
  return lerMeuPerfil(user);
});
export const salvarPerfilComercial = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({
    nome: z.string().max(200), cargo: z.string().max(200), telefone: z.string().max(40), whatsapp: z.string().max(40), email: z.string().max(200),
    assinatura: z.string().max(600), exibirTelefone: z.boolean(), exibirWhatsapp: z.boolean(), exibirEmail: z.boolean(),
  }).parse(d))
  .handler(async ({ data }) => {
    const user = await guard(COM);
    const { salvarMeuPerfil } = await import("./propostas.server");
    return salvarMeuPerfil(user, data);
  });

// ---------- Gestão e comparação das versões ----------
export const gerenciarVersoesDaProposta = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id, acao: z.enum(["arquivar", "desarquivar", "excluir"]), versoes: z.array(versao).min(1).max(100) }).parse(d))
  .handler(async ({ data }) => {
    const user = await guard(COM);
    const { gerenciarVersoes } = await import("./propostas.server");
    return gerenciarVersoes(user, data.id, data.acao, data.versoes);
  });
export const compararVersoesDaProposta = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id, a: versao, b: versao }).parse(d))
  .handler(async ({ data }) => {
    const user = await guard(COM);
    const { compararVersoes } = await import("./propostas.server");
    return compararVersoes(user, data.id, data.a, data.b);
  });
