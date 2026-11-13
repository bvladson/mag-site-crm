/**
 * Atendimento com visual de WhatsApp: regras puras (sem React e sem navegador), testadas em
 * tests/crm-atendimento-whatsapp.test.mjs. Horários sempre no fuso comercial da MAG.
 */
const TZ = "America/Fortaleza";
const DAY_MS = 86_400_000;
const dayKeyFormat = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: TZ,
});
const clockFormat = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TZ,
});
const weekdayFormat = new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: TZ });
const longDateFormat = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: TZ,
});
const shortDateFormat = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  timeZone: TZ,
});

export const chatDayKey = (value: string | Date) => dayKeyFormat.format(new Date(value));
const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
/** Days between two YYYY-MM-DD keys (the keys are calendar days in the commercial timezone). */
const daysBetween = (older: string, newer: string) =>
  Math.round((Date.parse(newer) - Date.parse(older)) / DAY_MS);

/** Etiqueta central entre mensagens: "Hoje", "Ontem", dia da semana (até 6 dias) ou data por extenso. */
export function dayLabel(value: string, now = new Date()): string {
  if (!value) return "";
  const key = chatDayKey(value);
  const days = daysBetween(key, chatDayKey(now));
  if (days === 0) return "Hoje";
  if (days === 1) return "Ontem";
  if (days > 1 && days < 7) return capitalize(weekdayFormat.format(new Date(value)));
  return longDateFormat.format(new Date(value));
}

/** Horário da lista de conversas, como no WhatsApp: hora de hoje, "Ontem", dia da semana ou dd/mm/aa. */
export function listTime(value: string | undefined, now = new Date()): string {
  if (!value) return "";
  const days = daysBetween(chatDayKey(value), chatDayKey(now));
  if (days <= 0) return clockFormat.format(new Date(value));
  if (days === 1) return "Ontem";
  if (days < 7) return capitalize(weekdayFormat.format(new Date(value)));
  return shortDateFormat.format(new Date(value));
}

export const clockTime = (value: string) => (value ? clockFormat.format(new Date(value)) : "");

/**
 * Telefone para leitura: +55 (85) 98710-2000. Só formata o que tem forma de número brasileiro (DDD + celular com 9
 * na frente, ou fixo começando de 2 a 5); números de outros países ficam exatamente como vieram.
 */
export function formatPhone(value: string | undefined): string {
  const raw = (value ?? "").trim();
  if (raw.startsWith("+") && !raw.replace(/[\s().-]/g, "").startsWith("+55")) return raw;
  const digits = raw.replace(/\D/g, "");
  const national =
    digits.startsWith("55") && (digits.length === 12 || digits.length === 13) ? digits.slice(2) : digits;
  if (national[0] === "0") return raw;
  if (national.length === 11 && national[2] === "9")
    return `+55 (${national.slice(0, 2)}) ${national.slice(2, 7)}-${national.slice(7)}`;
  if (national.length === 10 && /[2-5]/.test(national[2] ?? ""))
    return `+55 (${national.slice(0, 2)}) ${national.slice(2, 6)}-${national.slice(6)}`;
  return raw;
}

/** Textos que o servidor grava no lugar de mídia sem legenda ("[Áudio]", "[Imagem recebida no WhatsApp]"...). */
const MEDIA_PLACEHOLDER = /^\[(Imagem|Áudio|Documento|Vídeo|Mensagem WhatsApp|Mensagem)(?: recebid[ao] no WhatsApp)?\]$/;
export const isMediaPlaceholder = (text: string | undefined) => MEDIA_PLACEHOLDER.test((text ?? "").trim());
const PREVIEW: Record<string, string> = {
  Imagem: "📷 Foto",
  Áudio: "🎤 Áudio",
  Documento: "📄 Documento",
  Vídeo: "🎬 Vídeo",
};
/** Prévia da lista de conversas: mídia sem legenda aparece como no WhatsApp ("📷 Foto", "🎤 Áudio"). */
export function previewText(text: string | undefined): string {
  const value = (text ?? "").trim();
  const kind = value.match(MEDIA_PLACEHOLDER)?.[1];
  return (kind && PREVIEW[kind]) || value;
}

/** Tiques do WhatsApp para as mensagens da vendedora. */
export type TickKind = "clock" | "single" | "double" | "read" | "failed" | "uncertain";
export function tickFor(status: string | undefined): TickKind | null {
  switch (status) {
    case "pending":
    case "queued":
      return "clock";
    case "sent":
      return "single";
    case "delivered":
      return "double";
    case "read":
    case "played":
      return "read";
    case "failed":
      return "failed";
    case "uncertain":
      return "uncertain";
    default:
      return null;
  }
}
export const STATUS_LABEL: Record<string, string> = {
  pending: "Na fila",
  queued: "Na fila",
  sent: "Enviada",
  delivered: "Entregue",
  read: "Lida",
  played: "Reproduzida",
  received: "Recebida",
  failed: "Falha no envio",
  uncertain: "Envio não confirmado",
};

/**
 * Formatação do WhatsApp em pedaços seguros (nunca HTML): *negrito*, _itálico_, ~tachado~, ```monoespaçado```
 * e links http(s)/www clicáveis. Marcadores só valem colados ao texto, como no aplicativo.
 */
export type RichPiece =
  | { kind: "text" | "bold" | "italic" | "strike" | "mono"; text: string }
  | { kind: "link"; text: string; href: string };
const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
const TRAILING = /[.,;:!?)\]}'"]+$/;
const STYLE: Record<string, RichPiece["kind"]> = { "*": "bold", _: "italic", "~": "strike" };
function styled(text: string): RichPiece[] {
  const pieces: RichPiece[] = [];
  const pattern = /```([\s\S]+?)```|(^|[\s([{"'])([*_~])(?!\s)([^\n]*?[^\s])\3(?=$|[\s.,;:!?)\]}"'])/g;
  let index = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (match[1] !== undefined) {
      if (start > index) pieces.push({ kind: "text", text: text.slice(index, start) });
      pieces.push({ kind: "mono", text: match[1] });
    } else {
      const lead = match[2] ?? "";
      if (start + lead.length > index) pieces.push({ kind: "text", text: text.slice(index, start + lead.length) });
      pieces.push({ kind: STYLE[match[3]!]!, text: match[4]! } as RichPiece);
    }
    index = start + match[0].length;
  }
  if (index < text.length) pieces.push({ kind: "text", text: text.slice(index) });
  return pieces;
}
export function parseRichText(text: string): RichPiece[] {
  const pieces: RichPiece[] = [];
  let index = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    const url = match[0].replace(TRAILING, "");
    if (!url.replace(/^(?:https?:\/\/|www\.)/i, "").includes(".")) continue;
    if (start > index) pieces.push(...styled(text.slice(index, start)));
    pieces.push({ kind: "link", text: url, href: /^www\./i.test(url) ? `https://${url}` : url });
    index = start + url.length;
  }
  if (index < text.length) pieces.push(...styled(text.slice(index)));
  return pieces.filter((piece) => piece.text);
}

/** Filtros rápidos da lista de conversas (os mesmos do protótipo, com dados reais). */
export type InboxView = "todas" | "responder" | "aguardando" | "retornos" | "proposta";
export const INBOX_VIEWS: { id: InboxView; label: string; hint: string }[] = [
  { id: "todas", label: "Todas", hint: "Todas as conversas da carteira" },
  { id: "responder", label: "Não respondidas", hint: "O cliente escreveu por último ou há mensagem não lida" },
  { id: "aguardando", label: "Aguardando cliente", hint: "A última mensagem foi sua" },
  { id: "retornos", label: "Retornos", hint: "Retorno marcado para hoje ou atrasado" },
  { id: "proposta", label: "Com proposta", hint: "Há proposta ligada a uma oportunidade aberta" },
];
export interface InboxFacts {
  unread: number;
  lastFrom?: "cliente" | "vendedora" | undefined;
  awaitingReply: boolean;
  /** Prazos das próximas ações das oportunidades abertas (ISO). */
  nextDue: string[];
  hasProposal: boolean;
}
export function inboxViews(facts: InboxFacts, now = new Date()): Set<InboxView> {
  const views = new Set<InboxView>(["todas"]);
  const needsReply = facts.unread > 0 || facts.lastFrom === "cliente" || facts.awaitingReply;
  if (needsReply) views.add("responder");
  else if (facts.lastFrom === "vendedora") views.add("aguardando");
  const today = chatDayKey(now);
  if (facts.nextDue.some((due) => due && chatDayKey(due) <= today)) views.add("retornos");
  if (facts.hasProposal) views.add("proposta");
  return views;
}
/** Retorno atrasado (prazo já passou), para o ícone de alerta na lista. */
export const isLate = (nextDue: string[], now = new Date()) =>
  nextDue.some((due) => due && new Date(due).getTime() < now.getTime());
