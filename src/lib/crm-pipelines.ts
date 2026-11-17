/**
 * Funis configuráveis do CRM (Etapa 4) — regras puras, sem banco e sem React, usadas igual no servidor e na tela.
 *
 * Compatibilidade: `crm_opportunities.stage` continua sendo a CATEGORIA (novo | conversando | orcamento | fechado |
 * perdido) que as outras telas, as automações, as métricas e a versão anterior entendem. A etapa personalizada mora em
 * `stage_id`, e cada etapa guarda a SUA categoria de forma explícita (ganho = fechado, perda = perdido, em andamento =
 * escolhida pelo administrador). Incluir, reordenar ou excluir etapas nunca recalcula a categoria de ninguém; ela só
 * muda quando o negócio muda de etapa ou quando o administrador troca, de propósito, a categoria de uma etapa.
 */
import type { Stage } from "./crm.ts";

export type StageKind = "open" | "won" | "lost";
export type RequiredField = "value" | "nextAction" | "notes";
export type StageColor = "info" | "warning" | "primary" | "success" | "muted" | "foreground";
export type PipelineScope = "shared" | "specialized" | "personal";

export type OpenCategory = Extract<Stage, "novo" | "conversando" | "orcamento">;

export interface PipelineStage {
  id: string;
  label: string;
  color: StageColor;
  kind: StageKind;
  /** Categoria fixa da etapa (a coluna antiga `stage` dos negócios nela). Não depende da posição. */
  category: Stage;
  position: number;
  probability: number;
  wipLimit: number | null;
  staleDays: number | null;
  requiredFields: RequiredField[];
}
export interface Pipeline {
  id: string;
  name: string;
  scope: PipelineScope;
  isDefault: boolean;
  revision: number;
  stages: PipelineStage[];
}
/** Acesso de um vendedor (só o administrador recebe a lista completa). */
export interface PipelineSeller {
  userId: string;
  name: string;
  active: boolean;
  pipelineIds: string[];
  defaultPipelineId: string | null;
  /** Negócios do vendedor por funil (para avisar antes de tirar acesso). */
  deals: Record<string, number>;
}

export const STAGE_COLORS: StageColor[] = ["info", "warning", "primary", "success", "muted", "foreground"];
export const STAGE_COLOR_LABEL: Record<StageColor, string> = {
  info: "Azul",
  warning: "Âmbar",
  primary: "Vermelho MAG",
  success: "Verde",
  muted: "Cinza",
  foreground: "Grafite",
};
export const REQUIRED_FIELDS: RequiredField[] = ["value", "nextAction", "notes"];
export const REQUIRED_FIELD_LABEL: Record<RequiredField, string> = {
  value: "Valor (proposta ou estimado)",
  nextAction: "Próxima ação agendada",
  notes: "Observações preenchidas",
};
export const SCOPES: PipelineScope[] = ["shared", "specialized", "personal"];
export const SCOPE_LABEL: Record<PipelineScope, string> = {
  shared: "Compartilhado",
  specialized: "Especializado",
  personal: "Individual",
};
export const SCOPE_HELP: Record<PipelineScope, string> = {
  shared: "Vários vendedores usam o mesmo funil; cada um vê só os próprios negócios.",
  specialized: "Só os vendedores escolhidos (ex.: equipe de licitações); cada um vê só os próprios negócios.",
  personal: "Funil de um único vendedor.",
};
export const KIND_LABEL: Record<StageKind, string> = { open: "Em andamento", won: "Ganho", lost: "Perdido" };
export const OPEN_CATEGORIES: OpenCategory[] = ["novo", "conversando", "orcamento"];
export const CATEGORY_LABEL: Record<Stage, string> = {
  novo: "Novo",
  conversando: "Conversando",
  orcamento: "Orçamento enviado",
  fechado: "Fechado",
  perdido: "Não fechou",
};
export const isOpenCategory = (value: unknown): value is OpenCategory => OPEN_CATEGORIES.includes(value as OpenCategory);
const categoryRank = (category: Stage) => OPEN_CATEGORIES.indexOf(category as OpenCategory);
export const MAX_STAGES = 12;
export const MAX_PIPELINES = 30;

export type StageTemplate = Omit<PipelineStage, "id" | "position">;
/** Funil "Vendas" criado na migração: as mesmas etapas que a produção usa hoje. */
export const VENDAS_STAGES: StageTemplate[] = [
  { label: "Novo", color: "info", kind: "open", category: "novo", probability: 10, wipLimit: null, staleDays: 2, requiredFields: [] },
  { label: "Conversando", color: "warning", kind: "open", category: "conversando", probability: 30, wipLimit: null, staleDays: 5, requiredFields: [] },
  { label: "Orçamento enviado", color: "primary", kind: "open", category: "orcamento", probability: 60, wipLimit: null, staleDays: 7, requiredFields: [] },
  { label: "Fechado", color: "success", kind: "won", category: "fechado", probability: 100, wipLimit: null, staleDays: null, requiredFields: [] },
  { label: "Não fechou", color: "muted", kind: "lost", category: "perdido", probability: 0, wipLimit: null, staleDays: null, requiredFields: [] },
];
/** Funil novo criado pelo administrador. */
export const NEW_PIPELINE_STAGES: StageTemplate[] = [
  { label: "Novo", color: "info", kind: "open", category: "novo", probability: 10, wipLimit: null, staleDays: null, requiredFields: [] },
  { label: "Em negociação", color: "warning", kind: "open", category: "conversando", probability: 40, wipLimit: null, staleDays: null, requiredFields: [] },
  { label: "Ganho", color: "success", kind: "won", category: "fechado", probability: 100, wipLimit: null, staleDays: null, requiredFields: [] },
  { label: "Perdido", color: "muted", kind: "lost", category: "perdido", probability: 0, wipLimit: null, staleDays: null, requiredFields: [] },
];

export const sortStages = (stages: PipelineStage[]) => {
  const rank = (s: PipelineStage) => (s.kind === "open" ? 0 : s.kind === "won" ? 1 : 2);
  return [...stages].sort((a, b) => rank(a) - rank(b) || a.position - b.position || a.id.localeCompare(b.id));
};
export const stageOf = (pipeline: Pipeline | undefined, stageId: string | null | undefined) =>
  pipeline?.stages.find((stage) => stage.id === stageId);
export const openStages = (pipeline: Pipeline) => sortStages(pipeline.stages).filter((stage) => stage.kind === "open");
export const wonStage = (pipeline: Pipeline) => pipeline.stages.find((stage) => stage.kind === "won");
export const lostStage = (pipeline: Pipeline) => pipeline.stages.find((stage) => stage.kind === "lost");

/**
 * Categoria pela POSIÇÃO (primeira = novo, última = orçamento, do meio = conversando). Só serve para dar categoria,
 * uma única vez, a etapas gravadas antes de a categoria existir; depois disso a posição nunca mais decide nada.
 */
export function positionalCategory(pipeline: Pipeline, stageId: string): Stage {
  const stage = stageOf(pipeline, stageId);
  if (!stage) return "novo";
  if (stage.kind === "won") return "fechado";
  if (stage.kind === "lost") return "perdido";
  const open = openStages(pipeline);
  const index = open.findIndex((item) => item.id === stage.id);
  if (index <= 0) return "novo";
  return index === open.length - 1 ? "orcamento" : "conversando";
}
/** Categoria de uma etapa: ganho → fechado, perda → perdido, em andamento → a categoria gravada na etapa. */
export function legacyStageFor(pipeline: Pipeline, stageId: string | null | undefined): Stage {
  const stage = stageOf(pipeline, stageId);
  if (!stage) return "novo";
  if (stage.kind === "won") return "fechado";
  if (stage.kind === "lost") return "perdido";
  return isOpenCategory(stage.category) ? stage.category : positionalCategory(pipeline, stage.id);
}
/**
 * Etapa do funil para uma categoria (migração, movimentos da versão anterior e transferência entre funis): a primeira
 * etapa com essa categoria; se o funil não tiver nenhuma, a mais avançada que não passa dela; senão, a primeira.
 */
export function stageIdForLegacy(pipeline: Pipeline, legacy: Stage): string {
  if (legacy === "fechado") return wonStage(pipeline)!.id;
  if (legacy === "perdido") return lostStage(pipeline)!.id;
  const open = openStages(pipeline);
  if (!open.length) throw new Error("Funil sem etapa em andamento");
  const exact = open.find((stage) => legacyStageFor(pipeline, stage.id) === legacy);
  if (exact) return exact.id;
  const target = categoryRank(legacy);
  const before = open.filter((stage) => categoryRank(legacyStageFor(pipeline, stage.id)) <= target);
  return (before.at(-1) ?? open[0])!.id;
}
/** Completa a categoria de etapas que vieram sem ela (gravadas antes de a categoria existir), pela posição de então. */
export function withCategories(pipeline: Pipeline): Pipeline {
  const fixed = (stage: PipelineStage): Stage =>
    stage.kind === "won" ? "fechado" : stage.kind === "lost" ? "perdido" : isOpenCategory(stage.category) ? stage.category : positionalCategory(pipeline, stage.id);
  if (pipeline.stages.every((stage) => stage.category === fixed(stage))) return pipeline;
  return { ...pipeline, stages: pipeline.stages.map((stage) => ({ ...stage, category: fixed(stage) })) };
}

export const clampProbability = (value: unknown) => {
  const n = Number(value);
  return Math.min(100, Math.max(0, Math.round(Number.isFinite(n) ? n : 0)));
};
export const positiveIntOrNull = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), 9999) : null;
};
export const cleanLabel = (value: unknown, max = 40) =>
  String(value ?? "")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

export type StageDraft = { [K in keyof StageTemplate]?: StageTemplate[K] | null | undefined };
/**
 * Normaliza uma etapa vinda da tela. O tipo (andamento/ganho/perdido) é preservado por quem chama. Categoria: ganho e
 * perda são fixas; em andamento usa a escolhida, senão `fallback` (a que a etapa já tinha, ou "conversando" se nova).
 */
export function normalizeStage(input: StageDraft, kind: StageKind, fallback: Stage = "conversando"): StageTemplate {
  const label = cleanLabel(input.label);
  if (!label) throw new Error("Dê um nome à etapa");
  const color = STAGE_COLORS.includes(input.color as StageColor) ? (input.color as StageColor) : "muted";
  const required = [...new Set((input.requiredFields ?? []).filter((field) => REQUIRED_FIELDS.includes(field)))];
  return {
    label,
    color,
    kind,
    category:
      kind === "won" ? "fechado" : kind === "lost" ? "perdido" : isOpenCategory(input.category) ? input.category : isOpenCategory(fallback) ? fallback : "conversando",
    probability: kind === "won" ? 100 : kind === "lost" ? 0 : clampProbability(input.probability),
    wipLimit: kind === "open" ? positiveIntOrNull(input.wipLimit) : null,
    staleDays: kind === "open" ? positiveIntOrNull(input.staleDays) : null,
    requiredFields: kind === "lost" ? [] : required,
  };
}

/** Regras de forma de um funil: exatamente um ganho, um perdido e ao menos uma etapa em andamento. */
export function pipelineShapeErrors(stages: Pick<PipelineStage, "kind" | "label">[]): string[] {
  const errors: string[] = [];
  if (stages.filter((stage) => stage.kind === "won").length !== 1) errors.push("O funil precisa de exatamente uma etapa de ganho");
  if (stages.filter((stage) => stage.kind === "lost").length !== 1) errors.push("O funil precisa de exatamente uma etapa de perda");
  if (!stages.some((stage) => stage.kind === "open")) errors.push("O funil precisa de ao menos uma etapa em andamento");
  if (stages.length > MAX_STAGES) errors.push(`No máximo ${MAX_STAGES} etapas por funil`);
  const labels = stages.map((stage) => cleanLabel(stage.label).toLocaleLowerCase("pt-BR"));
  if (new Set(labels).size !== labels.length) errors.push("Há duas etapas com o mesmo nome");
  return errors;
}

/** O que falta para entrar na etapa. `valueCents` = proposta válida mais recente ou valor estimado. */
export function missingRequired(
  data: { valueCents: number | null | undefined; nextActionLabel: string | null | undefined; notes: string | null | undefined },
  stage: Pick<PipelineStage, "requiredFields">,
): RequiredField[] {
  return (stage.requiredFields ?? []).filter((field) =>
    field === "value"
      ? !(Number(data.valueCents) > 0)
      : field === "nextAction"
        ? !String(data.nextActionLabel ?? "").trim()
        : !String(data.notes ?? "").trim(),
  );
}

/** Valor conhecido no cliente: última proposta não cancelada nem recusada; senão, o valor estimado. Nunca inventa. */
export function knownValueCents(
  opportunity: { id: string; estimatedValueCents?: number | null },
  proposals: { opportunityId: string; status: string; value: number; date: string }[],
): number | null {
  const valid = proposals
    .filter((p) => p.opportunityId === opportunity.id && p.status !== "Cancelada" && p.status !== "Recusada")
    .sort((a, b) => a.date.localeCompare(b.date));
  const last = valid.at(-1);
  if (last && Number.isFinite(last.value)) return Math.round(last.value * 100);
  return Number(opportunity.estimatedValueCents) > 0 ? Number(opportunity.estimatedValueCents) : null;
}

const DAY = 864e5;
export function daysInStage(enteredAt: string | null | undefined, createdAt: string, now: Date | number) {
  const since = Date.parse(enteredAt || createdAt);
  const at = typeof now === "number" ? now : now.getTime();
  return Number.isFinite(since) ? Math.max(0, Math.floor((at - since) / DAY)) : 0;
}
export const isStale = (stage: Pick<PipelineStage, "kind" | "staleDays"> | undefined, days: number) =>
  !!stage && stage.kind === "open" && stage.staleDays !== null && days > stage.staleDays;
export const overWip = (stage: Pick<PipelineStage, "wipLimit">, count: number) =>
  stage.wipLimit !== null && count > stage.wipLimit;

export interface FunnelItem {
  stageId: string | null;
  valueCents: number | null;
  stageEnteredAt?: string | null;
  createdAt: string;
}
/** Indicadores do funil (só sobre os itens recebidos, que já vêm recortados pelo servidor). */
export function funnelMetrics(pipeline: Pipeline, items: FunnelItem[], now: Date | number) {
  let openCents = 0;
  let weightedCents = 0;
  let open = 0;
  let stale = 0;
  let wonCents = 0;
  let won = 0;
  let lost = 0;
  const perStage: Record<string, { count: number; cents: number }> = {};
  for (const stage of pipeline.stages) perStage[stage.id] = { count: 0, cents: 0 };
  for (const item of items) {
    const stage = stageOf(pipeline, item.stageId);
    if (!stage) continue;
    const cents = Number(item.valueCents) > 0 ? Number(item.valueCents) : 0;
    perStage[stage.id]!.count++;
    perStage[stage.id]!.cents += cents;
    if (stage.kind === "won") {
      won++;
      wonCents += cents;
    } else if (stage.kind === "lost") lost++;
    else {
      open++;
      openCents += cents;
      weightedCents += Math.round((cents * stage.probability) / 100);
      if (isStale(stage, daysInStage(item.stageEnteredAt, item.createdAt, now))) stale++;
    }
  }
  const overLimit = pipeline.stages.filter((stage) => overWip(stage, perStage[stage.id]!.count)).map((stage) => stage.id);
  return { open, openCents, weightedCents, stale, won, wonCents, lost, perStage, overLimit };
}
