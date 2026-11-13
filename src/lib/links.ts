import { z } from "zod";

export const LINK_TYPES = ["link", "whatsapp", "seller", "location", "heading"] as const;
export type LinkTreeItemType = (typeof LINK_TYPES)[number];
export const LINK_THEMES = ["mag", "light", "dark"] as const;
export const LINK_ACCENTS = ["burgundy", "ocean", "forest", "amber"] as const;
export type LinkAccent = (typeof LINK_ACCENTS)[number];
export const LINK_ICONS = [
  "auto",
  "drive",
  "catalog",
  "youtube",
  "instagram",
  "tiktok",
  "whatsapp",
  "link",
] as const;
export const BACKGROUND_PRESETS = [
  "brand",
  "summer",
  "carnival",
  "women",
  "autumn",
  "work",
  "june",
  "winter",
  "fathers",
  "spring",
  "pink",
  "blue",
  "christmas",
] as const;
export type LinkBackgroundPreset = (typeof BACKGROUND_PRESETS)[number];
export const BACKGROUND_MONTHS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
] as const;
const DEFAULT_MONTHLY_PRESETS: LinkBackgroundPreset[] = [
  "summer",
  "carnival",
  "women",
  "autumn",
  "work",
  "june",
  "winter",
  "fathers",
  "spring",
  "pink",
  "blue",
  "christmas",
];
export type LinkBackground = {
  mode: "fixed" | "monthly" | "image";
  preset: LinkBackgroundPreset;
  image: string | null;
  overlay: "light" | "dark";
  monthlyPresets: LinkBackgroundPreset[];
};

export function defaultLinkBackground(): LinkBackground {
  return {
    mode: "fixed",
    preset: "brand",
    image: null,
    overlay: "light",
    monthlyPresets: [...DEFAULT_MONTHLY_PRESETS],
  };
}

/** Calendar changes follow the MAG storefront's timezone, independently of browser or server settings. */
export function currentLinkMonth(date: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Fortaleza", month: "numeric" }).format(
      date,
    ),
  );
}

/** month is one-based (January=1), making previews and SSR agree around month boundaries. */
export function resolveLinkBackground(
  content: Pick<LinkTreeContent, "background">,
  month = currentLinkMonth(),
): LinkBackgroundPreset {
  if (!Number.isInteger(month) || month < 1 || month > 12)
    throw new RangeError("O mês deve estar entre 1 e 12");
  return content.background.mode === "monthly"
    ? content.background.monthlyPresets[month - 1]!
    : content.background.preset;
}
export const LINK_IMAGE_FILE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;
export const LINK_STATIC_LOGO = "/images/mag-logo.png";

/** Links never accept executable schemes, credentials, protocol-relative URLs or backslashes. */
export function isSafeLink(value: string): boolean {
  if (!value || /[\u0000-\u0020\u007f\\]/.test(value) || /%0[ad]/i.test(value)) return false;
  if (value.startsWith("/")) {
    if (value.startsWith("//") || /%(?:2f|5c)/i.test(value)) return false;
    try {
      return (
        new URL(value, "https://magmoveiscorporativos.com.br").origin ===
        "https://magmoveiscorporativos.com.br"
      );
    } catch {
      return false;
    }
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isMapLink(value: string, kind: "google" | "waze") {
  if (!isSafeLink(value) || value.startsWith("/")) return false;
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  return kind === "waze"
    ? host === "waze.com" || host === "www.waze.com"
    : host === "maps.app.goo.gl" ||
        host === "maps.google.com" ||
        host === "maps.google.com.br" ||
        ((host === "google.com" ||
          host === "www.google.com" ||
          host === "google.com.br" ||
          host === "www.google.com.br") &&
          url.pathname.startsWith("/maps")) ||
        (host === "goo.gl" && url.pathname.startsWith("/maps/"));
}

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(
      (v) => !/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v),
      "Use somente texto, sem HTML",
    );
const optionalUrl = text(1500).refine(
  (v) => !v || isSafeLink(v),
  "Use um endereço HTTPS ou caminho do próprio site",
);
const imageReference = z
  .string()
  .refine(
    (value) =>
      value === LINK_STATIC_LOGO ||
      (value.startsWith("/link-images/") && LINK_IMAGE_FILE.test(value.slice(13))),
    "Envie a imagem pelo painel",
  );

const presentationLabels = {
  unitsEyebrow: "Perto de você",
  unitsTitle: "Escolha a sua unidade",
  unitsText: "Veja como chegar e encontre a equipe de cada endereço.",
  teamEyebrow: "Atendimento com pessoas",
  teamTitle: "Vamos conversar?",
  teamText: "Escolha seu vendedor e fale diretamente pelo WhatsApp.",
  linksEyebrow: "Materiais e canais",
  linksTitle: "Acesse rápido",
  linksText: "",
  shareLabel: "Compartilhar a MAG",
  siteLabel: "Site oficial",
  privacyLabel: "Privacidade",
  allUnitsLabel: "Todas",
  visitLabel: "Venha nos visitar",
  teamButtonLabel: "Conheça a equipe",
  copyAddressLabel: "Copiar endereço",
  unitWhatsappLabel: "WhatsApp da unidade",
  sellerWhatsappLabel: "Falar no WhatsApp",
  searchPlaceholder: "Buscar vendedor",
  noSellersText: "O contato dos vendedores desta unidade será disponibilizado aqui.",
  noResultsText: "Nenhum vendedor encontrado.",
  generalTeamLabel: "Equipe MAG",
  mapsLabel: "Maps",
  wazeLabel: "Waze",
  campaignsLabel: "Campanhas em destaque",
};
export const linkPresentationSchema = z
  .object({
    slogan: text(120).default("Confortavelmente produtivo"),
    siteUrl: optionalUrl.default("/"),
    privacyUrl: optionalUrl.default("/privacidade"),
    headerLayout: z.enum(["aligned", "centered"]).default("aligned"),
    contentLayout: z.enum(["columns", "stacked"]).default("columns"),
    contentWidth: z.enum(["wide", "compact"]).default("wide"),
    cardStyle: z.enum(["glass", "solid"]).default("glass"),
    corners: z.enum(["rounded", "soft", "square"]).default("rounded"),
    backgroundAttachment: z.enum(["fixed", "scroll"]).default("fixed"),
    overlayStrength: z.enum(["soft", "balanced", "strong"]).default("balanced"),
    accentColor: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i, "Use uma cor hexadecimal, como #981b28")
      .nullable()
      .default(null),
    showShare: z.boolean().default(true),
    labels: z
      .object({
        unitsEyebrow: text(120).default(presentationLabels.unitsEyebrow),
        unitsTitle: text(120).default(presentationLabels.unitsTitle),
        unitsText: text(320).default(presentationLabels.unitsText),
        teamEyebrow: text(120).default(presentationLabels.teamEyebrow),
        teamTitle: text(120).default(presentationLabels.teamTitle),
        teamText: text(320).default(presentationLabels.teamText),
        linksEyebrow: text(120).default(presentationLabels.linksEyebrow),
        linksTitle: text(120).default(presentationLabels.linksTitle),
        linksText: text(320).default(presentationLabels.linksText),
        shareLabel: text(120).default(presentationLabels.shareLabel),
        siteLabel: text(120).default(presentationLabels.siteLabel),
        privacyLabel: text(120).default(presentationLabels.privacyLabel),
        allUnitsLabel: text(120).default(presentationLabels.allUnitsLabel),
        visitLabel: text(120).default(presentationLabels.visitLabel),
        teamButtonLabel: text(120).default(presentationLabels.teamButtonLabel),
        copyAddressLabel: text(120).default(presentationLabels.copyAddressLabel),
        unitWhatsappLabel: text(120).default(presentationLabels.unitWhatsappLabel),
        sellerWhatsappLabel: text(120).default(presentationLabels.sellerWhatsappLabel),
        searchPlaceholder: text(120).default(presentationLabels.searchPlaceholder),
        noSellersText: text(320).default(presentationLabels.noSellersText),
        noResultsText: text(320).default(presentationLabels.noResultsText),
        generalTeamLabel: text(120).default(presentationLabels.generalTeamLabel),
        mapsLabel: text(120).default(presentationLabels.mapsLabel),
        wazeLabel: text(120).default(presentationLabels.wazeLabel),
        campaignsLabel: text(120).default(presentationLabels.campaignsLabel),
      })
      .strict()
      .default(() => ({ ...presentationLabels })),
  })
  .strict();
export type LinkPresentation = z.infer<typeof linkPresentationSchema>;

/** Defaults extend legacy documents on read without rewriting immutable publications. */
export function defaultLinkPresentation(): LinkPresentation {
  return {
    slogan: "Confortavelmente produtivo",
    siteUrl: "/",
    privacyUrl: "/privacidade",
    headerLayout: "aligned",
    contentLayout: "columns",
    contentWidth: "wide",
    cardStyle: "glass",
    corners: "rounded",
    backgroundAttachment: "fixed",
    overlayStrength: "balanced",
    accentColor: null,
    showShare: true,
    labels: { ...presentationLabels },
  };
}

/** Published schedules use storefront local time (UTC-03), never the visitor's timezone. */
export function scheduleInstant(value: string, end = false): number {
  if (!value) return end ? Infinity : -Infinity;
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/.test(value)) return NaN;
  const day = value.slice(0, 10);
  const instant = Date.parse(`${value.length === 10 ? `${day}T00:00` : value}:00-03:00`);
  if (!Number.isFinite(instant)) return NaN;
  const local = new Date(instant - 3 * 60 * 60 * 1000).toISOString().slice(0, value.length);
  if (local !== value) return NaN;
  return instant + (end && value.length === 10 ? 86_400_000 : 0);
}
const schedule = z
  .string()
  .default("")
  .refine(
    (value) => !value || Number.isFinite(scheduleInstant(value)),
    "Use uma data e horário válidos em Fortaleza",
  );
export function isInLinkSchedule(
  item: { active: boolean; startsAt?: string; endsAt?: string },
  at: Date = new Date(),
): boolean {
  const now = at.getTime();
  return (
    item.active &&
    now >= scheduleInstant(item.startsAt ?? "") &&
    now < scheduleInstant(item.endsAt ?? "", true)
  );
}
export function linkScheduleState(
  item: { active: boolean; startsAt?: string; endsAt?: string },
  at: Date = new Date(),
): string {
  if (!item.active) return "oculto";
  if (at.getTime() < scheduleInstant(item.startsAt ?? "")) return "agendado";
  return isInLinkSchedule(item, at) ? "no ar" : "encerrado";
}

export const linkTreeItemSchema = z
  .object({
    id: z.string().uuid(),
    type: z.enum(LINK_TYPES),
    title: text(120),
    description: text(320),
    url: optionalUrl,
    phone: text(30).transform((v) => v.replace(/[\s()+.-]/g, "")),
    message: text(600),
    address: text(320),
    mapUrl: text(1500).refine((v) => !v || isMapLink(v, "google"), "Use um link do Google Maps"),
    wazeUrl: text(1500).refine((v) => !v || isMapLink(v, "waze"), "Use um link do Waze"),
    image: imageReference.nullable(),
    icon: z.enum(LINK_ICONS).default("auto"),
    highlight: z.boolean(),
    active: z.boolean(),
    position: z.number().int().min(0).max(10000),
    locationId: z.string().uuid().nullable().default(null),
    accent: z.enum(LINK_ACCENTS).default("burgundy"),
    hours: text(120).default(""),
    landline: text(30)
      .transform((v) => v.replace(/[\s()+.-]/g, ""))
      .default(""),
    startsAt: schedule,
    endsAt: schedule,
  })
  .strict()
  .superRefine((item, ctx) => {
    const problem = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    if (item.phone && !/^[1-9]\d{9,14}$/.test(item.phone))
      problem("phone", "Informe DDI, DDD e telefone, somente números");
    if (item.landline && !/^[1-9]\d{9,14}$/.test(item.landline))
      problem("landline", "Informe o telefone fixo com DDD, somente números");
    if (scheduleInstant(item.endsAt, true) <= scheduleInstant(item.startsAt))
      problem("endsAt", "O fim precisa ser posterior ao início");
    if (!item.active) return;
    if (!item.title) problem("title", "Informe o título do bloco ativo");
    if (item.type === "link" && !item.url) problem("url", "Informe o endereço do link");
    if ((item.type === "seller" || item.type === "whatsapp") && !item.phone)
      problem("phone", "Informe o WhatsApp com DDI e DDD");
    if (item.type === "location" && !item.address && !item.mapUrl)
      problem("address", "Informe o endereço ou o link do mapa");
  });

export const linkCampaignSchema = z
  .object({
    id: z.string().uuid(),
    slug: z
      .string()
      .trim()
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use letras minúsculas, números e hífens"),
    name: text(120),
    channel: text(80),
    title: text(120),
    description: text(320),
    buttonLabel: text(60),
    desktopImage: imageReference.nullable(),
    mobileImage: imageReference.nullable(),
    destinationType: z.enum(["link", "catalog", "whatsapp"]),
    url: optionalUrl,
    phone: text(30).transform((v) => v.replace(/[\s()+.-]/g, "")),
    message: text(600),
    locationId: z.string().uuid().nullable(),
    position: z.number().int().min(0).max(10000),
    active: z.boolean(),
    startsAt: schedule,
    endsAt: schedule,
  })
  .strict()
  .superRefine((item, ctx) => {
    const problem = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    if (scheduleInstant(item.endsAt, true) <= scheduleInstant(item.startsAt))
      problem("endsAt", "O fim precisa ser posterior ao início");
    if (item.phone && !/^[1-9]\d{9,14}$/.test(item.phone))
      problem("phone", "Informe DDI, DDD e telefone, somente números");
    if (!item.name) problem("name", "Informe o nome da campanha");
    if (!item.active) return;
    if (!item.title) problem("title", "Informe o título do banner ativo");
    if (!item.desktopImage) problem("desktopImage", "Envie uma arte para o banner ativo");
    if (item.destinationType === "whatsapp" && !item.phone) problem("phone", "Informe o WhatsApp");
    if (item.destinationType === "link" && !item.url) problem("url", "Informe o destino do banner");
  });

export const linkTreeContentSchema = z
  .object({
    title: text(120).refine((v) => Boolean(v), "Informe o título da página"),
    subtitle: text(320),
    logo: imageReference,
    cover: imageReference.nullable(),
    theme: z.enum(LINK_THEMES),
    presentation: linkPresentationSchema.default(defaultLinkPresentation),
    background: z
      .object({
        mode: z.enum(["fixed", "monthly", "image"]).default("fixed"),
        preset: z.enum(BACKGROUND_PRESETS).default("brand"),
        image: imageReference.nullable().default(null),
        overlay: z.enum(["light", "dark"]).default("light"),
        monthlyPresets: z
          .array(z.enum(BACKGROUND_PRESETS))
          .length(12, "Escolha um tema para cada um dos 12 meses")
          .default(() => [...DEFAULT_MONTHLY_PRESETS]),
      })
      .strict()
      .default(defaultLinkBackground),
    items: z.array(linkTreeItemSchema).max(100, "O limite é de 100 blocos"),
    campaigns: z
      .array(linkCampaignSchema)
      .max(3, "O limite é de três banners por publicação")
      .default([]),
  })
  .strict()
  .superRefine((content, ctx) => {
    if (new Set(content.items.map((item) => item.id)).size !== content.items.length)
      ctx.addIssue({
        code: "custom",
        path: ["items"],
        message: "Os blocos precisam ter identificadores diferentes",
      });
    for (let index = 0; index < content.items.length; index++) {
      const item = content.items[index]!;
      if (item.type === "location" || !item.locationId) continue;
      const location = content.items.find(
        (candidate) => candidate.id === item.locationId && candidate.type === "location",
      );
      if (!location)
        ctx.addIssue({
          code: "custom",
          path: ["items", index, "locationId"],
          message: "Vincule o bloco a uma unidade cadastrada nesta página",
        });
      else if (item.active && !location.active)
        ctx.addIssue({
          code: "custom",
          path: ["items", index, "locationId"],
          message: "Um vendedor ou link ativo deve estar em uma unidade ativa",
        });
    }
    if (new Set(content.campaigns.map((item) => item.id)).size !== content.campaigns.length)
      ctx.addIssue({
        code: "custom",
        path: ["campaigns"],
        message: "As campanhas precisam ter identificadores diferentes",
      });
    if (new Set(content.campaigns.map((item) => item.slug)).size !== content.campaigns.length)
      ctx.addIssue({
        code: "custom",
        path: ["campaigns"],
        message: "Use um identificador diferente para cada campanha",
      });
    for (const [index, item] of content.campaigns.entries()) {
      if (!item.locationId) continue;
      const location = content.items.find(
        (candidate) => candidate.id === item.locationId && candidate.type === "location",
      );
      if (!location || (item.active && !location.active))
        ctx.addIssue({
          code: "custom",
          path: ["campaigns", index, "locationId"],
          message: "Vincule a campanha a uma unidade ativa desta árvore",
        });
    }
  });

export type LinkTreeItem = z.infer<typeof linkTreeItemSchema>;
export type LinkTreeContent = z.infer<typeof linkTreeContentSchema>;
export type LinkCampaign = z.infer<typeof linkCampaignSchema>;
export type LinkTreePublication = {
  id: string;
  version: number;
  publishedAt: string;
  publishedBy: string;
};
export type LinkTreeAdmin = {
  draft: { revision: number; content: LinkTreeContent };
  publications: LinkTreePublication[];
  publishedVersion: number | null;
};
export type PublicLinkTree = {
  version: number;
  publishedAt: string;
  content: LinkTreeContent;
  metricsToken?: string;
};

export function emptyLinkTreeContent(): LinkTreeContent {
  return {
    title: "MAG Móveis Corporativos",
    subtitle: "Confortavelmente Produtivo!",
    logo: LINK_STATIC_LOGO,
    cover: null,
    theme: "mag",
    presentation: defaultLinkPresentation(),
    background: defaultLinkBackground(),
    items: [],
    campaigns: [],
  };
}

export function newLinkTreeItem(type: LinkTreeItemType = "link"): LinkTreeItem {
  return {
    id: crypto.randomUUID(),
    type,
    title: "",
    description: "",
    url: "",
    phone: "",
    message: "",
    address: "",
    mapUrl: "",
    wazeUrl: "",
    image: null,
    icon: "auto",
    highlight: false,
    active: false,
    position: 100,
    locationId: null,
    accent: "burgundy",
    hours: "",
    landline: "",
    startsAt: "",
    endsAt: "",
  };
}

export function newLinkCampaign(): LinkCampaign {
  const id = crypto.randomUUID();
  return {
    id,
    slug: `campanha-${id.slice(0, 8)}`,
    name: "Nova campanha",
    channel: "Site",
    title: "",
    description: "",
    buttonLabel: "Saiba mais",
    desktopImage: null,
    mobileImage: null,
    destinationType: "catalog",
    url: "",
    phone: "",
    message: "",
    locationId: null,
    position: 100,
    active: false,
    startsAt: "",
    endsAt: "",
  };
}
export function campaignDestination(item: LinkCampaign): string {
  const destination =
    item.destinationType === "whatsapp"
      ? whatsappLink(item.phone, item.message)
      : item.destinationType === "catalog"
        ? item.url || "/produtos"
        : item.url;
  if (!isSafeLink(destination)) return "";
  const url = new URL(destination, "https://magmoveiscorporativos.com.br");
  url.searchParams.set("utm_campaign", item.slug);
  url.searchParams.set("utm_source", "arvore-mag");
  return destination.startsWith("/") ? `${url.pathname}${url.search}${url.hash}` : url.href;
}

export function imageUrl(image: string | null | undefined, preview = false): string {
  if (!image) return "";
  if (image === LINK_STATIC_LOGO) return image;
  return preview && image.startsWith("/link-images/")
    ? image.replace("/link-images/", "/api/internal/link-images/")
    : image;
}

export function whatsappLink(phone: string, message = "") {
  const digits = phone.replace(/[\s()+.-]/g, "");
  return /^[1-9]\d{9,14}$/.test(digits)
    ? `https://wa.me/${digits}${message ? `?text=${encodeURIComponent(message)}` : ""}`
    : "";
}

/** Local Brazilian landlines are dialed internationally; this never changes the WhatsApp field. */
export function telephoneLink(phone: string): string {
  const digits = phone.replace(/[\s()+.-]/g, "");
  if (!/^[1-9]\d{9,14}$/.test(digits)) return "";
  return `tel:+${digits.length === 10 || digits.length === 11 ? `55${digits}` : digits}`;
}

export function locationMapLink(item: Pick<LinkTreeItem, "mapUrl" | "address">) {
  if (item.mapUrl && isMapLink(item.mapUrl, "google")) return item.mapUrl;
  return item.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.address)}`
    : "";
}

export function itemDestination(item: LinkTreeItem): string {
  if (item.type === "whatsapp" || item.type === "seller")
    return whatsappLink(item.phone, item.message);
  if (item.type === "location") return locationMapLink(item);
  return item.type === "link" && isSafeLink(item.url) ? item.url : "";
}
