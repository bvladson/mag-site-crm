import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Regra: valida → salva no banco próprio do site → retorna protocolo → TENTA notificar por e-mail.
 * Falha de e-mail nunca invalida o lead. Server-only imports ficam dentro dos handlers.
 */
const opt = (max: number) => z.string().trim().max(max).optional();
const honeypot = { website: z.string().max(200).optional(), turnstile: z.string().max(4000).optional() };
const utmSchema = z.record(z.string().max(40), z.string().max(200)).default({}).refine((o) => Object.keys(o).length <= 10);

const quoteSchema = z.object({
  nome: z.string().trim().min(2).max(100),
  empresa: opt(120),
  cnpj: opt(20),
  whatsapp: z.string().trim().min(10).max(20),
  email: z.string().trim().toLowerCase().email().max(255),
  cidade: z.string().trim().min(2).max(80),
  estado: z.string().trim().min(2).max(2),
  mensagem: opt(1000),
  unitId: z.string().uuid().optional(),
  origem: z.string().max(500).optional(),
  utm: utmSchema,
  items: z.array(z.object({ slug: z.string().max(200), qty: z.number().int().min(1).max(10000) })).min(1).max(100),
  ...honeypot,
});

export const submitQuoteRequest = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => quoteSchema.parse(d))
  .handler(async ({ data }) => {
    const { enforceRateLimit, verifyTurnstile, clean } = await import("@/lib/security.server");
    const { items, website, turnstile, unitId, ...raw } = data;
    if (website) return { id: "", protocolo: "RECEBIDO" }; // honeypot: bot
    await enforceRateLimit("quote", 8, 600);
    if (!(await verifyTurnstile(turnstile))) throw new Error("Verificação de segurança falhou");
    const { assignNewLead } = await import("@/lib/assignments.server");
    if (unitId) { const { validateUnitId } = await import("@/lib/units.server"); validateUnitId(unitId); }
    const lead = { ...raw, nome: clean(raw.nome)!, empresa: clean(raw.empresa), mensagem: clean(raw.mensagem), estado: raw.estado.toUpperCase() };
    // Nome e SKU vêm do catálogo do servidor, nunca do navegador.
    const { readCatalogIndex, canonicalProductSlug } = await import("@/lib/omie.server");
    const catalog = new Map((await readCatalogIndex()).map((p) => [p.slug, p]));
    const merged = new Map<string, number>();
    for (const i of items) {
      // Aceita a URL antiga (produto-<id> ou slug anterior) de listas salvas antes da troca de URL.
      const slug = await canonicalProductSlug(i.slug);
      if (slug && catalog.has(slug)) merged.set(slug, Math.min(10000, (merged.get(slug) ?? 0) + i.qty));
    }
    const rows = [...merged].map(([slug, qty]) => ({ slug, qty, sku: catalog.get(slug)!.sku, name: catalog.get(slug)!.name }));
    if (!rows.length) throw new Error("Lista de orçamento vazia");
    const { saveQuote } = await import("@/lib/local-db.server");
    let saved: { id: string; protocolo: string };
    try {
      saved = saveQuote(lead, rows);
    } catch (error) {
      console.error("[quote] gravação falhou", error);
      throw new Error("Não foi possível registrar o orçamento");
    }
    try { assignNewLead(saved.id, unitId); } catch {
      const { audit } = await import("@/lib/local-db.server");
      audit(null, "lead:assignment:failed", saved.id);
    }
    const { notify, panelLink } = await import("@/lib/email/notify.server");
    const { quoteEmail } = await import("@/lib/email/templates.server");
    await notify("commercial", { ...quoteEmail({ ...lead, protocolo: saved.protocolo, items: rows, panelLink: panelLink(`/interno/orcamentos/${saved.id}`) }), replyTo: lead.email });
    return saved;
  });

const contactSchema = z.object({
  nome: z.string().trim().min(2).max(100),
  empresa: opt(120),
  email: z.string().trim().toLowerCase().email().max(255),
  whatsapp: z.string().trim().min(10).max(20),
  assunto: z.string().trim().min(2).max(60),
  mensagem: z.string().trim().min(5).max(2000),
  origem: z.string().max(500).optional(),
  utm: utmSchema,
  ...honeypot,
});

export const submitContactRequest = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => contactSchema.parse(d))
  .handler(async ({ data }) => {
    const { enforceRateLimit, verifyTurnstile, clean } = await import("@/lib/security.server");
    const { website, turnstile, ...raw } = data;
    if (website) return { protocolo: "RECEBIDO" };
    await enforceRateLimit("contact", 6, 600);
    if (!(await verifyTurnstile(turnstile))) throw new Error("Verificação de segurança falhou");
    const lead = { ...raw, nome: clean(raw.nome)!, empresa: clean(raw.empresa), mensagem: clean(raw.mensagem)! };
    const { insertLead } = await import("@/lib/local-db.server");
    let saved: { id: string; protocolo: string };
    try {
      saved = insertLead("contact_requests", lead);
    } catch (error) {
      console.error("[contact] gravação falhou", error);
      throw new Error("Não foi possível registrar o contato");
    }
    const { notify, panelLink } = await import("@/lib/email/notify.server");
    const { contactEmail } = await import("@/lib/email/templates.server");
    await notify("commercial", { ...contactEmail({ ...lead, protocolo: saved.protocolo, panelLink: panelLink(`/interno/contatos/${saved.id}`) }), replyTo: lead.email });
    return { protocolo: saved.protocolo };
  });

const appSchema = z.object({
  nome: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email().max(255),
  whatsapp: z.string().trim().min(10).max(20),
  cidade: z.string().trim().min(2).max(80),
  linkedin: opt(300),
  area_interesse: opt(80),
  mensagem: opt(2000),
  /** Vaga escolhida. O servidor confere se está aberta e pega título e área do banco — nunca do navegador. */
  job_slug: z.string().max(80).regex(/^[a-z0-9-]+$/).optional(),
  lgpd_consent: z.literal(true),
  /** Só em candidatura a vaga: aceita também ficar no banco de talentos (opcional, nunca obrigatório). */
  talent_bank: z.boolean().optional(),
  resume: z.object({ name: z.string().max(200), base64: z.string().max(7_000_000) }),
  ...honeypot,
});

/** Conteúdo ativo que não cabe num currículo e é vetor clássico contra quem abre o PDF (scripts, execução, anexos). */
const ACTIVE_PDF = ["/JavaScript", "/Launch", "/EmbeddedFile", "/RichMedia", "/XFA"];
const LINKEDIN = /^https:\/\/([a-z]{2,3}\.)?(www\.)?linkedin\.com\/\S{1,280}$/i;

/** Candidatura a uma vaga aberta (job_slug) ou ao banco de talentos (sem job_slug). */
export const submitJobApplication = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => appSchema.parse(d))
  .handler(async ({ data }) => {
    const { enforceRateLimit, verifyTurnstile, clean } = await import("@/lib/security.server");
    const { resume, website, turnstile, job_slug, talent_bank, ...raw } = data;
    if (website) return { protocolo: "RECEBIDO" };
    await enforceRateLimit("application", 5, 900);
    await enforceRateLimit("application-email", 5, 86400, raw.email);
    if (!(await verifyTurnstile(turnstile))) throw new Error("Verificação de segurança falhou");
    if (raw.linkedin && !LINKEDIN.test(raw.linkedin)) throw new Error("Informe o link do seu perfil no LinkedIn (https://linkedin.com/in/...)");
    let job: { id: string; slug: string; title: string; area: string | null } | null = null;
    if (job_slug) {
      const { findOpenJob } = await import("@/lib/careers.server");
      const row = findOpenJob(job_slug);
      if (!row) throw new Error("Esta vaga não está mais recebendo candidaturas. Você pode se cadastrar no banco de talentos.");
      job = { id: row.id, slug: row.slug, title: row.title, area: row.area };
    }
    const rest = {
      ...raw, nome: clean(raw.nome)!, mensagem: clean(raw.mensagem), cidade: clean(raw.cidade)!, linkedin: clean(raw.linkedin),
      area_interesse: clean(raw.area_interesse) ?? job?.area ?? undefined,
      job_id: job?.id, job_slug: job?.slug, job_title: job?.title,
      talent_bank: job ? Boolean(talent_bank) : true,
      lgpd_consent_at: new Date().toISOString(),
    };
    // Currículo: só PDF (conferido pelo conteúdo, não pela extensão), até 5 MB, sem conteúdo ativo.
    const bytes = Buffer.from(resume.base64, "base64");
    if (bytes.length > 5 * 1024 * 1024) throw new Error("Arquivo maior que 5 MB");
    if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error("Envie o currículo em PDF");
    const asText = bytes.toString("latin1");
    if (ACTIVE_PDF.some((marker) => asText.includes(marker))) {
      throw new Error("Este PDF tem conteúdo ativo (scripts ou anexos). Exporte o currículo de novo como PDF simples.");
    }
    const { storeResume, discardResume, insertLead } = await import("@/lib/local-db.server");
    // Nome interno aleatório, fora da pasta pública; só o painel (DHO/admin) baixa, como anexo PDF.
    let resume_path: string;
    try {
      resume_path = storeResume(bytes);
    } catch (error) {
      console.error("[application] currículo não gravado", error);
      throw new Error("Falha no envio do currículo");
    }
    let saved: { id: string; protocolo: string };
    try {
      saved = insertLead("job_applications", { ...rest, resume_path });
    } catch (error) {
      discardResume(resume_path); // sem candidatura, o arquivo não pode ficar órfão
      console.error("[application] gravação falhou", error);
      throw new Error("Não foi possível registrar a candidatura");
    }
    const { notify, panelLink } = await import("@/lib/email/notify.server");
    const { applicationEmail } = await import("@/lib/email/templates.server");
    await notify("dho", {
      ...applicationEmail({ ...rest, protocolo: saved.protocolo, area: rest.area_interesse, vaga: rest.job_title, panelLink: panelLink(`/interno/candidaturas/${saved.id}`) }),
      replyTo: rest.email,
    });
    return { protocolo: saved.protocolo };
  });
