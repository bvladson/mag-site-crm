import { createContext, useContext, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { ErrorState, Loading, useMe } from "@/components/interno/ui";
import type { WahaRecovery } from "./WahaLinePanel";

export type CrmDialog =
  | {
      kind: "opportunity" | "schedule" | "loss" | "close" | "createProposal" | "proposal";
      id: string;
    }
  | { kind: "newOpportunity"; contactId?: string }
  | { kind: "contact"; id?: string }
  | null;
const QUERY_KEY = ["interno", "crm"] as const;
interface CrmStore extends CrmBootstrap {
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
  open: (dialog: CrmDialog) => void;
  close: () => void;
  contact: (id: string) => CrmBootstrap["contacts"][number] | undefined;
  opportunity: (id: string) => Opportunity | undefined;
  requestMove: (id: string, stage: Stage) => Promise<void>;
  applyStage: (id: string, stage: Stage, lossReason?: LossReason) => Promise<void>;
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
  attachQuote: (id: string, quoteId: string) => Promise<void>;
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
  const getConnection = useServerFn(getCrmConnection);
  const addContact = useServerFn(createContact);
  const editContact = useServerFn(updateContact);
  const addOpp = useServerFn(createOpportunity);
  const editOpp = useServerFn(updateOpportunity);
  const move = useServerFn(moveOpportunity);
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
  const opportunity = (id: string) => data.opportunities.find((item) => item.id === id);
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
  const store: CrmStore = {
    ...data,
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
    open: setDialog,
    close: () => {
      if (!busy) setDialog(null);
    },
    contact: (id) => data.contacts.find((item) => item.id === id),
    opportunity,
    requestMove: async (id, stage) => {
      const current = opportunity(id);
      if (!current || current.stage === stage || busy) return;
      if (stage === "perdido") setDialog({ kind: "loss", id });
      else if (stage === "fechado") setDialog({ kind: "close", id });
      else await applyStage(id, stage);
    },
    applyStage,
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
    attachQuote: async (id, quoteId) => {
      await run(
        () => attachQuote({ data: { opportunityId: id, quoteId } }),
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
