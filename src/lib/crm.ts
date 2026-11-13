/** Contratos do CRM MAG. Dados operacionais vêm exclusivamente do servidor. */
export type Stage = "novo" | "conversando" | "orcamento" | "fechado" | "perdido";
export type Origin =
  "Anúncio Meta" | "Anúncio Google" | "Site" | "Indicação" | "WhatsApp" | "Desconhecida";
export type LossReason = "Preço" | "Prazo" | "Sem estoque" | "Desistiu" | "Outro";
export type ProposalStatus = "Rascunho" | "Enviada" | "Aceita" | "Recusada" | "Cancelada";
export const STAGES: { id: Exclude<Stage, "perdido">; label: string; hint: string }[] = [
  { id: "novo", label: "Novo", hint: "Chegou agora, ainda sem conversa" },
  { id: "conversando", label: "Conversando", hint: "Entendendo a necessidade" },
  { id: "orcamento", label: "Orçamento enviado", hint: "Proposta com o cliente" },
  { id: "fechado", label: "Fechado", hint: "Negociação ganha" },
];
export const STAGE_LABEL: Record<Stage, string> = {
  novo: "Novo",
  conversando: "Conversando",
  orcamento: "Orçamento enviado",
  fechado: "Fechado",
  perdido: "Não fechou",
};
export const ORIGINS: Origin[] = [
  "Anúncio Meta",
  "Anúncio Google",
  "Site",
  "Indicação",
  "WhatsApp",
  "Desconhecida",
];
export const LOSS_REASONS: LossReason[] = ["Preço", "Prazo", "Sem estoque", "Desistiu", "Outro"];
export interface NextAction {
  label: string;
  due: string;
  taskId?: string | undefined;
}
export interface Contact {
  id: string;
  name: string;
  company?: string | undefined;
  phone: string;
  email: string;
  city: string;
  ownerId: string;
  ownerName: string;
  unitId: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export interface Opportunity {
  id: string;
  contactId: string;
  title: string;
  interest: string;
  stage: Stage;
  origin: Origin;
  createdAt: string;
  lastInteraction: string;
  awaitingReply: boolean;
  nextAction: NextAction;
  notes: string;
  lossReason?: LossReason | undefined;
  revision: number;
  ownerId: string;
  ownerName: string;
  unitId: string | null;
  quoteIds: string[];
  estimatedValueCents: number;
  sourceKind?: string | undefined;
  sourceId?: string | undefined;
}
export interface Message {
  id: string;
  from: "cliente" | "vendedora";
  text: string;
  at: string;
  status: string;
  channel: string;
  provider: string;
  externalId: string | null;
  attachments?: CrmAttachment[] | undefined;
}
/** Only authorized MAG URLs are exposed; provider URLs and filesystem paths stay on the server. */
export interface CrmAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: "image" | "audio" | "document";
  status: "ready";
  downloadUrl: string;
}
export interface Conversation {
  id: string;
  contactId: string;
  unread: number;
  messages: Message[];
  channel: string;
}
export interface CrmContactsPage {
  contacts: Contact[];
  conversations: Conversation[];
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
  matches?: Record<string, CrmContactSearchMatch>;
  /** Older databases are indexed in bounded batches; never imply complete results before ready. */
  searchIndex?: { ready: boolean };
}
export interface CrmContactSearchMatch {
  kind: "name" | "phone" | "email" | "company" | "conversation" | "opportunity" | "other";
  snippet?: string;
}
export interface CrmContactDetail {
  contact: Contact;
  opportunities: Opportunity[];
  opportunitiesTruncated: boolean;
  conversation: Conversation;
}
export interface CrmQuoteLinkPreview {
  opportunityId: string;
  quoteId: string;
  alreadyLinked: boolean;
  requiresConfirmation: boolean;
  reasons: string[];
  contact: { name: string; company: string; phone: string; email: string };
  quote: { number: string; customerName: string; customerEmail: string; customerPhone: string };
  confirmationToken: string;
}
export interface Proposal {
  id: string;
  number: string;
  opportunityId: string;
  contactId: string;
  status: ProposalStatus;
  value: number;
  date: string;
  quoteId: string;
  version: number | null;
  detailUrl: string;
  pdfUrl: string | null;
  customerName: string;
}
export interface TaskDone {
  id: string;
  opportunityId: string;
  label: string;
  at: string;
}
export interface CrmTask {
  id: string;
  opportunityId: string;
  label: string;
  due: string;
  status: "pending" | "done";
  createdAt: string;
  completedAt: string | null;
}
export interface CrmTasksPage {
  tasks: CrmTask[];
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
}
export interface CrmActivity {
  id: string;
  opportunityId: string;
  kind: string;
  label: string;
  at: string;
  actorName: string;
}
export interface SiteLead {
  id: string;
  sourceId: string;
  sourceKind: "quote" | "contact";
  protocol: string;
  name: string;
  company: string;
  origin: string;
  createdAt: string;
  ownerId: string | null;
  ownerName: string | null;
  unitId: string | null;
  importedOpportunityId: string | null;
  interest: string;
}
export interface CrmBootstrap {
  contacts: Contact[];
  opportunities: Opportunity[];
  conversations: Conversation[];
  proposals: Proposal[];
  tasksDone: TaskDone[];
  tasks: CrmTask[];
  owners: { id: string; name: string }[];
  units: { id: string; name: string }[];
  canManage: boolean;
  now: string;
  siteLeads: SiteLead[];
  limits: { records: number; truncated: boolean };
  counts: { contacts: number; opportunities: number; unread: number; tasksPending: number; awaitingContacts?: number };
}
export interface CrmContactInput {
  name: string;
  company?: string | undefined;
  phone?: string | undefined;
  email?: string | undefined;
  city?: string | undefined;
  ownerId?: string | undefined;
  unitId?: string | null | undefined;
}
/** Entrada confiável de um conector; somente chamar após autenticar o webhook no servidor. */
export interface IngestCrmLeadInput {
  provider: string;
  externalId: string;
  name: string;
  phone?: string | undefined;
  email?: string | undefined;
  company?: string | undefined;
  city?: string | undefined;
  title: string;
  interest?: string | undefined;
  origin: Origin;
  ownerId?: string | undefined;
  unitId?: string | null | undefined;
}
export interface RecordCrmMessageInput {
  contactId: string;
  provider: string;
  account: string;
  externalId: string;
  from: "cliente" | "vendedora";
  text: string;
  at?: string | undefined;
  status?: string | undefined;
  channel?: string | undefined;
  historical?: boolean | undefined;
  suppressOpportunityUpdate?: boolean | undefined;
}
