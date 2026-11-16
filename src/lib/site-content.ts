import { z } from "zod";
import { site } from "../config/site.ts";
import { scheduleInstant, isInLinkSchedule } from "./links.ts";

export const SITE_IMAGE_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/;
export const SITE_STATIC_LOGO = "/images/mag-logo.png";
const plain = (max: number, min = 0) => z.string().trim().min(min).max(max).refine((v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v), "Texto inválido.");
const image = z.string().refine((v) => v === SITE_STATIC_LOGO || (v.startsWith("/site-images/") && SITE_IMAGE_FILE.test(v.slice(13))), "Envie a imagem pelo editor do site.");
export const siteHrefSchema = plain(1000).refine((value) => {
  if (!value) return true;
  if (/[\\\s\u0000-\u001f]/.test(value) || /%(?:0[0-9a-f]|1[0-9a-f]|5c)/i.test(value)) return false;
  if (value.startsWith("/") && !value.startsWith("//")) return !/^\/(?:interno|api|site-preview)(?:\/|\?|$)/i.test(value);
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
}, "Use um caminho do site (como /produtos) ou um endereço HTTPS.");
const schedule = z.string().max(16).refine((value) => !value || Number.isFinite(scheduleInstant(value)), "Data inválida. Use data e hora de Fortaleza.");

export const SITE_NAVIGATION = [
  { id: "products", href: "/produtos", label: "Produtos" },
  { id: "environments", href: "/ambientes", label: "Ambientes" },
  { id: "projects", href: "/projetos", label: "Projetos" },
  { id: "business", href: "/empresas", label: "Empresas" },
  { id: "about", href: "/sobre", label: "Sobre a MAG" },
  { id: "blog", href: "/blog", label: "Conteúdo" },
  { id: "careers", href: "/carreiras", label: "Carreiras" },
  { id: "contact", href: "/contato", label: "Contato" },
] as const;
const navIds = SITE_NAVIGATION.map((item) => item.id) as [string, ...string[]];
const navigationItem = z.object({ id: z.enum(navIds), label: plain(40, 1), enabled: z.boolean() }).strict();

export const SITE_SECTIONS = [
  { id: "manifesto", label: "Manifesto MAG", title: "O trabalho muda.\nO espaço precisa\nacompanhar.", eyebrow: "Espaço, trabalho e pessoas", text: "Móveis corporativos para espaços que precisam funcionar." },
  { id: "process", label: "Processo de atendimento", title: "Do espaço vazio\nao ambiente pronto.", eyebrow: "O jeito MAG de fazer", text: "Um ambiente não termina na escolha dos móveis. Atendimento, estoque, entrega e montagem fazem parte do mesmo projeto." },
  { id: "categories", label: "Categorias", title: "O que você procura?", eyebrow: "", text: "" },
  { id: "ready", label: "Pronta entrega", title: "Pronta entrega", eyebrow: "Disponível agora", text: "Produtos disponíveis para você receber mais rápido." },
  { id: "featured", label: "Produtos em destaque", title: "Produtos que fazem a diferença no dia a dia.", eyebrow: "Catálogo MAG", text: "" },
  { id: "environments", label: "Ambientes", title: "Cada ambiente pede uma solução.", eyebrow: "Compre por ambiente", text: "Comece pelo espaço e encontre tudo que ele precisa." },
  { id: "project", label: "Projeto corporativo", title: "Vai montar ou renovar um espaço inteiro?", eyebrow: "Projeto corporativo", text: "Mobiliário, organização de ambientes e montagem — com um consultor acompanhando cada etapa." },
  { id: "solutions", label: "Soluções para empresas", title: "Soluções para empresas", eyebrow: "Para empresas", text: "" },
  { id: "banners", label: "Banners e campanhas do site", title: "", eyebrow: "", text: "" },
  { id: "cases", label: "Projetos realizados", title: "Ambientes que já transformamos.", eyebrow: "Cases", text: "" },
  { id: "clients", label: "Clientes", title: "Empresas que já escolheram a MAG", eyebrow: "", text: "" },
  { id: "stats", label: "Números institucionais", title: "", eyebrow: "", text: "" },
  { id: "social", label: "Redes sociais", title: "Acompanhe a MAG.", eyebrow: "MAG nas redes", text: "Projetos entregues, bastidores e novidades da MAG nas redes sociais." },
  { id: "people", label: "Cultura e equipe", title: "Pessoas fazem a MAG acontecer.", eyebrow: "Cultura MAG", text: "Atendimento, entrega, montagem e pós-venda: em cada etapa existe alguém do nosso time cuidando da sua experiência." },
  { id: "blog", label: "Conteúdos", title: "Conteúdo para espaços que precisam funcionar melhor.", eyebrow: "Conteúdo", text: "" },
  { id: "testimonials", label: "Depoimentos", title: "Quem compra, conta.", eyebrow: "Depoimentos", text: "" },
  { id: "cta", label: "Chamada final", title: "De uma cadeira a um escritório completo.", eyebrow: "", text: "Conte o que sua empresa precisa. A equipe MAG ajuda você a encontrar a melhor solução." },
] as const;
export type SiteSectionId = (typeof SITE_SECTIONS)[number]["id"];
const sectionIds = SITE_SECTIONS.map((item) => item.id) as [SiteSectionId, ...SiteSectionId[]];
export const siteSectionSchema = z.object({
  id: z.enum(sectionIds), enabled: z.boolean(), eyebrow: plain(100), title: plain(180), text: plain(1200),
  image: image.nullable(), imageAlt: plain(240), buttonLabel: plain(70), buttonHref: siteHrefSchema,
  layout: z.enum(["default", "grid", "carousel"]), tone: z.enum(["default", "surface", "dark"]),
}).strict();
export type SiteSection = z.infer<typeof siteSectionSchema>;

export function defaultSiteSection(id: SiteSectionId): SiteSection {
  const definition = SITE_SECTIONS.find((item) => item.id === id)!;
  const { title, eyebrow, text } = definition;
  const buttons: Partial<Record<SiteSectionId, [string, string]>> = {
    manifesto: ["Uma empresa por trás de cada ambiente", "/sobre"],
    process: ["Conheça nosso processo", "/projetos"],
    project: ["Quero falar sobre meu projeto", "/contato"],
    cta: ["Solicitar orçamento", "/orcamento"],
  };
  return { id, title, eyebrow, text, enabled: true, image: null, imageAlt: "", buttonLabel: buttons[id]?.[0] ?? "", buttonHref: buttons[id]?.[1] ?? "", layout: "default", tone: id === "project" || id === "process" ? "dark" : ["featured", "stats", "people", "testimonials"].includes(id) ? "surface" : "default" };
}

export function defaultSiteEditorial() {
  return {
    manifestoSupport: "Da escolha de uma cadeira à organização de um escritório, a MAG reúne mobiliário, projetos e atendimento para aproximar o espaço da rotina de quem trabalha nele.",
    processSteps: [
      { title: "Entender", text: "Ouvir a equipe e conhecer a rotina do espaço." },
      { title: "Planejar", text: "Relacionar mobiliário, circulação e necessidades." },
      { title: "Separar", text: "Organizar os produtos para cada ambiente." },
      { title: "Entregar", text: "Levar o mobiliário até a sua empresa." },
      { title: "Montar", text: "Cuidar da montagem e dos detalhes." },
      { title: "Ambiente pronto", text: "O espaço preparado para a rotina de trabalho." },
    ],
  };
}

// Expand only the complete previous schema. Existing immutable publications and
// the relative order/content of their original sections remain untouched.
const legacySectionIds = new Set(sectionIds.filter((id) => id !== "manifesto" && id !== "process"));
const sectionsSchema = z.preprocess((value) => {
  if (!Array.isArray(value) || value.length !== legacySectionIds.size) return value;
  const ids = value.map((item) => item && typeof item === "object" ? item.id : null);
  if (new Set(ids).size !== legacySectionIds.size || !ids.every((id) => legacySectionIds.has(id))) return value;
  return [defaultSiteSection("manifesto"), defaultSiteSection("process"), ...value];
}, z.array(siteSectionSchema).length(SITE_SECTIONS.length).refine((items) => new Set(items.map((item) => item.id)).size === SITE_SECTIONS.length, "As seções não podem se repetir."));
const editorialSchema = z.object({
  manifestoSupport: plain(1200),
  processSteps: z.array(z.object({ title: plain(80, 1), text: plain(400) }).strict()).min(1).max(8),
}).strict().default(defaultSiteEditorial);

export const siteBannerSchema = z.object({
  id: z.string().uuid(), title: plain(160), text: plain(600), eyebrow: plain(100),
  image: image.nullable(), mobileImage: image.nullable(), alt: plain(240),
  href: siteHrefSchema, buttonLabel: plain(70), enabled: z.boolean(),
  startsAt: schedule, endsAt: schedule,
  fit: z.enum(["natural", "cover"]), width: z.enum(["full", "contained"]),
  align: z.enum(["left", "center"]), tone: z.enum(["light", "dark"]),
}).strict().superRefine((banner, ctx) => {
  if (banner.startsAt && banner.endsAt && scheduleInstant(banner.startsAt) > scheduleInstant(banner.endsAt, true))
    ctx.addIssue({ code: "custom", path: ["endsAt"], message: "O fim deve ocorrer depois do início." });
  if (banner.enabled && !banner.image)
    ctx.addIssue({ code: "custom", path: ["image"], message: "Envie uma imagem para ativar o banner." });
});
export type SiteBanner = z.infer<typeof siteBannerSchema>;

export const siteContentSchema = z.object({
  general: z.object({
    name: plain(100, 1), tagline: plain(180), logo: image, favicon: image,
    whatsapp: z.string().refine((v) => !v || (/^55\d{10,11}$/.test(v) && !/^550+$/.test(v)), "Use WhatsApp com DDI e DDD, somente números."),
    phone: plain(40), email: z.union([z.literal(""), z.string().email().max(200)]), footerText: plain(500),
  }).strict(),
  seo: z.object({ title: plain(160, 1), description: plain(320, 1), image: image.nullable() }).strict(),
  appearance: z.object({ brandColor: z.string().regex(/^#[0-9a-f]{6}$/i), radius: z.enum(["sharp", "soft", "rounded"]), width: z.enum(["standard", "wide"]), spacing: z.enum(["compact", "comfortable"]) }).strict(),
  navigation: z.array(navigationItem).length(SITE_NAVIGATION.length).refine((items) => new Set(items.map((item) => item.id)).size === SITE_NAVIGATION.length, "Os itens do menu não podem se repetir."),
  announcement: z.object({ enabled: z.boolean(), text: plain(240), href: siteHrefSchema, label: plain(60) }).strict(),
  home: z.object({
    hero: z.object({
      layout: z.enum(["split", "overlay", "banner"]), eyebrow: plain(180), title: plain(220, 1), text: plain(1000),
      desktopImage: image.nullable(), mobileImage: image.nullable(), imageAlt: plain(240),
      primaryLabel: plain(70), primaryHref: siteHrefSchema, secondaryLabel: plain(70), secondaryHref: siteHrefSchema,
      align: z.enum(["left", "center"]), imageFit: z.enum(["cover", "contain"]),
    }).strict(),
    sections: sectionsSchema,
    editorial: editorialSchema,
    banners: z.array(siteBannerSchema).max(12).refine((items) => new Set(items.map((item) => item.id)).size === items.length, "Os banners não podem se repetir."),
    stats: z.array(z.object({ label: plain(100, 1), value: plain(60) }).strict()).max(8),
  }).strict(),
}).strict();
export type SiteContent = z.infer<typeof siteContentSchema>;
export type SiteContentAdmin = {
  draft: { revision: number; content: SiteContent };
  publications: { id: string; version: number; publishedAt: string; publishedBy: string }[];
  publishedVersion: number | null;
};
export type PublicSiteContent = { version: number | null; publishedAt: string | null; content: SiteContent };

export function defaultSiteContent(): SiteContent {
  return {
    general: { name: site.name, tagline: site.tagline, logo: SITE_STATIC_LOGO, favicon: SITE_STATIC_LOGO, whatsapp: site.whatsapp, phone: site.phone, email: site.email, footerText: `Móveis corporativos para espaços que precisam funcionar. ${site.tagline}` },
    seo: { title: "MAG Móveis Corporativos — Cadeiras, mesas e projetos para escritórios", description: "Cadeiras, mesas, estações e projetos corporativos para empresas que valorizam conforto, funcionalidade e produtividade.", image: null },
    appearance: { brandColor: "#981b28", radius: "soft", width: "standard", spacing: "comfortable" },
    navigation: SITE_NAVIGATION.map(({ id, label }) => ({ id, label, enabled: true })),
    announcement: { enabled: false, text: "", href: "", label: "" },
    home: {
      hero: { layout: "split", eyebrow: site.tagline, title: "Seu espaço trabalha melhor quando cada escolha faz sentido.", text: "Cadeiras, mesas, estações e projetos corporativos para empresas que valorizam conforto e produtividade.", desktopImage: null, mobileImage: null, imageAlt: "Sala de diretoria com mesa executiva e cadeira telada", primaryLabel: "Explorar produtos", primaryHref: "/produtos", secondaryLabel: "Falar com um especialista", secondaryHref: "/contato", align: "left", imageFit: "cover" },
      sections: (["manifesto", "process", "cases", "environments", "ready", "featured", "solutions", "people", "social", "blog", "clients", "testimonials", "categories", "project", "banners", "stats", "cta"] as SiteSectionId[]).map(defaultSiteSection),
      editorial: defaultSiteEditorial(),
      banners: [], stats: site.stats.map(({ label, value }) => ({ label, value: value ?? "" })),
    },
  };
}

export function newSiteBanner(): SiteBanner {
  return { id: crypto.randomUUID(), title: "", text: "", eyebrow: "", image: null, mobileImage: null, alt: "", href: "", buttonLabel: "", enabled: false, startsAt: "", endsAt: "", fit: "natural", width: "contained", align: "left", tone: "light" };
}
export function siteImageUrl(value: string | null | undefined, preview = false): string {
  if (!value) return "";
  return preview && value.startsWith("/site-images/") ? value.replace("/site-images/", "/api/internal/site-images/") : value;
}
export function siteWhatsappUrl(content: SiteContent, text = "Olá! Vim pelo site da MAG e gostaria de atendimento.") {
  return content.general.whatsapp ? `https://wa.me/${content.general.whatsapp}?text=${encodeURIComponent(text)}` : "/contato";
}
export function visibleSiteContent(input: SiteContent, at: Date = new Date()): SiteContent {
  const content = structuredClone(input);
  content.home.banners = content.home.banners.filter((banner) => isInLinkSchedule({ active: banner.enabled, startsAt: banner.startsAt, endsAt: banner.endsAt }, at));
  return content;
}
