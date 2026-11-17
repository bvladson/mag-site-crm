import { createContext, useContext, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import type {
  CrmBootstrap,
  CrmContactInput,
  LossReason,
  Opportunity,
  Origin,
  Stage,
} from "@/lib/crm";
import {
  createContact,
  createOpportunity,
  createQuoteForOpportunity,
  getCrmBootstrap,
  getCrmContact,
  getCrmOpportunity,
  importSiteLead,
  moveOpportunity,
  scheduleTask,
  completeTask,
  updateContact,
  updateOpportunity,
  linkQuote,
  markConversationRead,
} from "@/lib/crm.functions";
import { getCrmConnection, sendCrmMessage } from "@/lib/crm-integrations.functions";
import { moveOpportunityStage } from "@/lib/crm-funil.functions";
import {
  knownValueCents,
  missingRequired,
  stageIdForLegacy,
  stageOf,
  type RequiredField,
} from "@/lib/crm-pipelines";
import { ErrorState, Loading, useMe } from "@/components/interno/ui";
import type { WahaRecovery } from "./WahaLinePanel";

export type CrmDialog =
  | {
      kind: "opportunity" | "schedule" | "createProposal" | "proposal";
      id: string;
    }
  /** Perda e ganho: com `stageId`, a etapa de perda/ganho do funil do negócio (Etapa 4). */
  | { kind: "loss" | "close"; id: string; stageId?: string; pipelineId?: string }
  /** Campos obrigatórios para entrar na etapa (conferidos de novo no servidor). */
  | { kind: "requirements"; id: string; stageId: string; pipelineId: string; missing: RequiredField[] }
  | { kind: "newOpportunity"; contactId?: string }
  | { kind: "contact"; id?: string }
  | null;
export interface StageMoveFields {
  estimatedValueCents?: number;
  notes?: string;
  nextAction?: { label: string; due: string };
}
const QUERY_KEY = ["interno", "crm"] as const;
interface CrmStore extends CrmBootstrap {
  viewerId: string;
  dialog: CrmDialog;
  busy: boolean;
  connection:
    | {
        configured: boolean;
        connected: boolean;
        message: string;
        state: string;
        canManage: boolean;
        provider?: string;
        capabilities?: { media: boolean; history: boolean };
        /** WAHA: false for administrators in supervision (only the responsible seller replies). */
        canReply?: boolean;
        /** WAHA: may fetch the history of the selected conversation (seller or administrator). */
        canSyncConversation?: boolean;
        /** WAHA: portfolio served by the connected number (only for the seller and administrators). */
        responsibleId?: string | null;
        /** WAHA: line shown (the seller's own line, or the single line for administrators). */
        lineId?: string | null;
        /** WAHA: the signed-in user owns this line and connects/disconnects it herself. */
        ownLine?: boolean;
        canControl?: boolean;
        /** WAHA: last digits of the authorized number. */
        phoneHint?: string | null;
        /** WAHA: catch-up of what arrived while the line was offline (counts only). */
        recovery?: WahaRecovery;
        /** WAHA (administrators): every seller's line, for supervision. */
        lines?: Array<{
          lineId: string;
          ownerId: string;
          ownerName: string;
          connected: boolean;
          state: string;
          message: string;
          canReply: boolean;
          canSyncConversation: boolean;
          phoneHint: string | null;
          recovery?: WahaRecovery;
        }>;
      }
    | undefined;
  connectionLoading: boolean;
  entityLoading: boolean;
  entityError: unknown;
  contactOpportunitiesTruncated: boolean;
  open: (dialog: CrmDialog) => void;
  close: () => void;
  contact: (id: string) => CrmBootstrap["contacts"][number] | undefined;
  opportunity: (id: string) => Opportunity | undefined;
  requestMove: (id: string, stage: Stage) => Promise<void>;
  applyStage: (id: string, stage: Stage, lossReason?: LossReason) => Promise<void>;
  /** Etapa 4: pede o movimento para uma etapa do funil (abre perda, ganho ou obrigatórios quando preciso). */
  requestMoveStage: (id: string, stageId: string, pipelineId?: string) => Promise<void>;
  applyStageMove: (
    id: string,
    stageId: string,
    options?: { pipelineId?: string; lossReason?: LossReason; fields?: StageMoveFields },
  ) => Promise<void>;
  schedule: (id: string, label: string, due: string) => Promise<void>;
  finishTask: (id: string) => Promise<void>;
  addOpportunity: (input: {
    contactId?: string;
    newContact?: CrmContactInput;
    title: string;
    interest: string;
    origin: Origin;
    ownerId?: string;
    unitId?: string | null;
  }) => Promise<string>;
  saveContact: (
    input: CrmContactInput,
    current?: CrmBootstrap["contacts"][number],
  ) => Promise<void>;
  saveOpportunity: (
    id: string,
    patch: {
      notes?: string;
      title?: string;
      interest?: string;
      awaitingReply?: boolean;
      ownerId?: string;
      unitId?: string | null;
      estimatedValueCents?: number;
    },
  ) => Promise<void>;
  importLead: (sourceKind: "quote" | "contact", sourceId: string) => Promise<string>;
  createQuote: (id: string) => Promise<{ id: string; detailUrl: string }>;
  attachQuote: (
    id: string,
    quoteId: string,
    confirmation?: {
      confirmMismatch?: boolean;
      justification?: string;
      confirmationToken?: string;
    },
  ) => Promise<void>;
  sendMessage: (
    contactId: string,
    text: string,
    clientMessageId?: string,
    attachmentIds?: string[],
  ) => Promise<void>;
  markRead: (contactId: string) => Promise<void>;
  refresh: () => Promise<void>;
}
const CrmContext = createContext<CrmStore | null>(null);
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Não foi possível concluir a ação.";

export function CrmProvider({ children }: { children: ReactNode }) {
  const me = useMe();
  const allowed = me.data?.roles.some((role) => role === "admin" || role === "comercial") ?? false;
  const load = useServerFn(getCrmBootstrap);
  const loadContact = useServerFn(getCrmContact);
  const loadOpportunity = useServerFn(getCrmOpportunity);
  const location = useRouterState({ select: (state) => state.location });
  const getConnection = useServerFn(getCrmConnection);
  const addContact = useServerFn(createContact);
  const editContact = useServerFn(updateContact);
  const addOpp = useServerFn(createOpportunity);
  const editOpp = useServerFn(updateOpportunity);
  const move = useServerFn(moveOpportunity);
  const moveStage = useServerFn(moveOpportunityStage);
  const schedule = useServerFn(scheduleTask);
  const complete = useServerFn(completeTask);
  const importLead = useServerFn(importSiteLead);
  const newQuote = useServerFn(createQuoteForOpportunity);
  const attachQuote = useServerFn(linkQuote);
  const send = useServerFn(sendCrmMessage);
  const read = useServerFn(markConversationRead);
  const client = useQueryClient();
  const [dialog, setDialog] = useState<CrmDialog>(null);
  const [busy, setBusy] = useState(false);
  const query = useQuery({
    queryKey: [...QUERY_KEY, "workspace"],
    queryFn: () => load(),
    enabled: allowed,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
  const search = location.search as Record<string, unknown>;
  const routeContactId = location.pathname.includes("/crm/atendimento")
    ? search["c"]
    : location.pathname.includes("/crm/clientes")
      ? search["id"]
      : undefined;
  const routeOpportunityId = location.pathname.includes("/crm/atendimento")
    ? search["o"]
    : undefined;
  const dialogOpportunityId =
    dialog &&
    ["opportunity", "schedule", "loss", "close", "createProposal", "requirements"].includes(dialog.kind) &&
    "id" in dialog
      ? dialog.id
      : undefined;
  const focusedOpportunityId =
    dialogOpportunityId ||
    (typeof routeOpportunityId === "string" ? routeOpportunityId : undefined);
  const focusedOpportunity = useQuery({
    queryKey: [...QUERY_KEY, "focused-opportunity", me.data?.id, focusedOpportunityId],
    queryFn: () => loadOpportunity({ data: { id: focusedOpportunityId! } }),
    enabled:
      allowed &&
      Boolean(
        query.data &&
        focusedOpportunityId &&
        !query.data.opportunities.some((item) => item.id === focusedOpportunityId),
      ),
    retry: 1,
    staleTime: 5_000,
  });
  const opportunityContactId =
    focusedOpportunity.data?.contactId ||
    query.data?.opportunities.find((item) => item.id === focusedOpportunityId)?.contactId;
  const dialogContactId =
    dialog?.kind === "contact"
      ? dialog.id
      : dialog?.kind === "newOpportunity"
        ? dialog.contactId
        : dialogOpportunityId
          ? opportunityContactId
          : undefined;
  const focusedContactId =
    dialogContactId ||
    (typeof routeContactId === "string" ? routeContactId : undefined) ||
    opportunityContactId;
  const focusedContact = useQuery({
    queryKey: [...QUERY_KEY, "focused-contact", me.data?.id, focusedContactId],
    queryFn: () => loadContact({ data: { id: focusedContactId! } }),
    enabled: allowed && Boolean(query.data && focusedContactId),
    retry: 1,
    staleTime: 5_000,
  });
  const connection = useQuery({
    queryKey: [...QUERY_KEY, "connection"],
    queryFn: () => getConnection(),
    enabled: allowed,
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: 1,
  });
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: QUERY_KEY });
  };
  const run = async <T,>(work: () => Promise<T>, message?: string): Promise<T> => {
    setBusy(true);
    try {
      const result = await work();
      await refresh();
      await client.invalidateQueries({ queryKey: ["interno", "orcamentos-internos"] });
      if (message) toast.success(message);
      return result;
    } catch (error) {
      toast.error(errorMessage(error));
      await refresh();
      throw error;
    } finally {
      setBusy(false);
    }
  };
  if (me.isLoading || (allowed && query.isLoading)) return <Loading />;
  if (!allowed)
    return <ErrorState error={new Error("Seu perfil não permite acessar o Comercial.")} />;
  if (query.isError || !query.data)
    return <ErrorState error={query.error ?? new Error("Não foi possível carregar o CRM.")} />;
  const data = query.data;
  const contactMap = new Map(data.contacts.map((item) => [item.id, item]));
  if (focusedContact.data) {
    const item = focusedContact.data.contact;
    const previous = contactMap.get(item.id);
    if (!previous || item.revision >= previous.revision) contactMap.set(item.id, item);
  }
  const contacts = [...contactMap.values()];
  const opportunityMap = new Map(data.opportunities.map((item) => [item.id, item]));
  for (const item of [
    ...(focusedContact.data?.opportunities ?? []),
    ...(focusedOpportunity.data ? [focusedOpportunity.data] : []),
  ]) {
    const previous = opportunityMap.get(item.id);
    if (!previous || item.revision >= previous.revision) opportunityMap.set(item.id, item);
  }
  const opportunities = [...opportunityMap.values()];
  const focusedConversations = focusedContact.data ? [focusedContact.data.conversation] : [];
  const conversations = [
    ...new Map(
      (focusedContact.dataUpdatedAt >= query.dataUpdatedAt
        ? [...data.conversations, ...focusedConversations]
        : [...focusedConversations, ...data.conversations]
      ).map((item) => [item.contactId, item]),
    ).values(),
  ];
  const opportunity = (id: string) => opportunityMap.get(id);
  const requireOpportunity = (id: string) => {
    const found = opportunity(id);
    if (!found) throw new Error("Oportunidade não encontrada. Atualize a página.");
    return found;
  };
  const applyStage = async (id: string, stage: Stage, lossReason?: LossReason) => {
    const current = requireOpportunity(id);
    await run(
      () =>
        move({
          data: { id, revision: current.revision, stage, ...(lossReason ? { lossReason } : {}) },
        }),
      "Etapa atualizada",
    );
  };
  const pipelineMap = new Map((data.pipelines ?? []).map((item) => [item.id, item]));
  const applyStageMove: CrmStore["applyStageMove"] = async (id, stageId, options = {}) => {
    const current = requireOpportunity(id);
    await run(
      () =>
        moveStage({
          data: {
            id,
            revision: current.revision,
            stageId,
            ...(options.pipelineId ? { pipelineId: options.pipelineId } : {}),
            ...(options.lossReason ? { lossReason: options.lossReason } : {}),
            ...(options.fields ? { fields: options.fields } : {}),
          },
        }),
      "Etapa atualizada",
    );
  };
  const requestMoveStage: CrmStore["requestMoveStage"] = async (id, stageId, pipelineId) => {
    const current = opportunity(id);
    if (!current || busy) return;
    const pipeline = pipelineMap.get(pipelineId || current.pipelineId || "");
    const stage = stageOf(pipeline, stageId);
    if (!pipeline || !stage) {
      toast.error("Etapa indisponível. Atualize a página.");
      return;
    }
    if (pipeline.id === current.pipelineId && stage.id === current.stageId) return;
    if (stage.kind === "lost") {
      setDialog({ kind: "loss", id, stageId: stage.id, pipelineId: pipeline.id });
      return;
    }
    // Conferência antecipada só para abrir o diálogo certo; o servidor confere de novo ao gravar.
    const missing = missingRequired(
      { valueCents: knownValueCents(current, data.proposals), nextActionLabel: current.nextAction.label, notes: current.notes },
      stage,
    );
    if (missing.length) {
      setDialog({ kind: "requirements", id, stageId: stage.id, pipelineId: pipeline.id, missing });
      return;
    }
    if (stage.kind === "won") {
      setDialog({ kind: "close", id, stageId: stage.id, pipelineId: pipeline.id });
      return;
    }
    await applyStageMove(id, stage.id, { pipelineId: pipeline.id });
  };
  const store: CrmStore = {
    ...data,
    viewerId: me.data?.id ?? "",
    contacts,
    opportunities,
    conversations,
    dialog,
    busy,
    connection: connection.isError
      ? {
          configured: false,
          connected: false,
          state: "error",
          canManage: data.canManage,
          message: "Não foi possível consultar a conexão. Tente novamente.",
        }
      : connection.data,
    connectionLoading: connection.isLoading,
    entityLoading: focusedContact.isLoading || focusedOpportunity.isLoading,
    entityError: focusedContact.error || focusedOpportunity.error,
    contactOpportunitiesTruncated: focusedContact.data?.opportunitiesTruncated ?? false,
    open: setDialog,
    close: () => {
      if (!busy) setDialog(null);
    },
    contact: (id) => contacts.find((item) => item.id === id),
    opportunity,
    requestMove: async (id, stage) => {
      const current = opportunity(id);
      if (!current || busy) return;
      const pipeline = pipelineMap.get(current.pipelineId ?? "");
      if (pipeline) {
        // Etapa 4: a categoria vira a etapa correspondente do funil do negócio (com obrigatórios, perda e ganho).
        await requestMoveStage(id, stageIdForLegacy(pipeline, stage), pipeline.id);
        return;
      }
      if (current.stage === stage) return;
      if (stage === "perdido") setDialog({ kind: "loss", id });
      else if (stage === "fechado") setDialog({ kind: "close", id });
      else await applyStage(id, stage);
    },
    applyStage,
    requestMoveStage,
    applyStageMove,
    schedule: async (id, label, due) => {
      await run(() => schedule({ data: { opportunityId: id, label, due } }), "Retorno agendado");
    },
    finishTask: async (id) => {
      await run(() => complete({ data: { id } }), "Tarefa concluída");
    },
    addOpportunity: async (input) => {
      const saved = await run(() => addOpp({ data: input }), "Oportunidade criada");
      return saved.id;
    },
    saveContact: async (input, current) => {
      await run(
        () =>
          current
            ? editContact({ data: { ...input, id: current.id, revision: current.revision } })
            : addContact({ data: input }),
        current ? "Cliente atualizado" : "Cliente cadastrado",
      );
    },
    saveOpportunity: async (id, patch) => {
      await run(
        () => editOpp({ data: { ...patch, id, revision: requireOpportunity(id).revision } }),
        "Oportunidade atualizada",
      );
    },
    importLead: async (sourceKind, sourceId) => {
      const saved = await run(
        () => importLead({ data: { sourceKind, sourceId } }),
        "Entrada vinculada ao CRM",
      );
      return saved.id;
    },
    createQuote: async (id) =>
      run(() => newQuote({ data: { opportunityId: id } }), "Negociação pronta no gerencial"),
    attachQuote: async (id, quoteId, confirmation) => {
      await run(
        () => attachQuote({ data: { opportunityId: id, quoteId, ...confirmation } }),
        "Negociação vinculada",
      );
    },
    sendMessage: async (contactId, text, clientMessageId, attachmentIds) => {
      await run(
        () =>
          send({
            data: {
              contactId,
              text,
              ...(clientMessageId ? { clientMessageId } : {}),
              ...(attachmentIds?.length ? { attachmentIds } : {}),
            },
          }),
        "Mensagem encaminhada ao WhatsApp",
      );
    },
    markRead: async (contactId) => {
      await read({ data: { contactId } });
      await refresh();
    },
    refresh,
  };
  return <CrmContext.Provider value={store}>{children}</CrmContext.Provider>;
}
export function useCrm() {
  const store = useContext(CrmContext);
  if (!store) throw new Error("CRM indisponível fora do seu contexto.");
  return store;
}
export const proposalsFor = (proposals: CrmBootstrap["proposals"], id: string) =>
  proposals.filter((item) => item.opportunityId === id);
export const latestValue = (proposals: CrmBootstrap["proposals"], id: string) =>
  proposalsFor(proposals, id)
    .filter((item) => item.status !== "Recusada" && item.status !== "Cancelada")
    .sort((a, b) => b.date.localeCompare(a.date))[0]?.value;
