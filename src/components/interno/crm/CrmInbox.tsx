import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileText,
  History,
  IdCard,
  Loader2,
  MessageCircle,
  PackageSearch,
  Search,
  SquareKanban,
  Wifi,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { proposalsFor, useCrm } from "./CrmProvider";
import { Avatar, EmptyState, NextActionLine, OriginBadge, ProposalBadge, StageBadge } from "./bits";
import { money, normalize } from "./format";
import { getCrmConversationPage } from "@/lib/crm.functions";
import { STAGE_LABEL, type Message } from "@/lib/crm";
import {
  bindWahaContactOpportunity,
  getWahaContactContext,
  syncWahaContactHistory,
} from "@/lib/crm-waha.functions";
import { MoveMenu } from "./OpportunityCard";
import { DayDivider, MessageBubble, MessageTicks, opensGroup } from "./ChatParts";
import { ComposerBar, ComposerFilePreview } from "./ChatComposer";
import { InboxFilters } from "./InboxFilters";
import {
  INBOX_VIEWS,
  chatDayKey,
  dayLabel,
  formatPhone,
  inboxViews,
  isLate,
  listTime,
  previewText,
  type InboxView,
} from "./chatFormat";

const MAX_ATTACHMENT_BYTES = 7 * 1024 * 1024;

export function CrmInbox({
  selected,
  selectedOpportunity,
}: {
  selected: string | undefined;
  selectedOpportunity: string | undefined;
}) {
  const navigate = useNavigate();
  const {
    contacts,
    conversations,
    opportunities,
    proposals,
    connection,
    connectionLoading,
    markRead,
  } = useCrm();
  const [query, setQuery] = useState("");
  const [view, setView] = useState<InboxView>("todas");
  const [cardOpen, setCardOpen] = useState(false);
  const unread = conversations
    .filter((item) => item.contactId === selected)
    .reduce((sum, item) => sum + item.unread, 0);
  useEffect(() => {
    if (selected && unread) {
      void markRead(selected).catch(() => {});
    }
  }, [selected, unread]);
  const select = (id?: string) =>
    navigate({ to: "/interno/crm/atendimento", search: id ? { c: id } : {} });
  const now = new Date();
  const searched = contacts
    .map((customer) => {
      const threads = conversations.filter((item) => item.contactId === customer.id);
      const messages = threads
        .flatMap((item) => item.messages)
        .sort((a, b) => a.at.localeCompare(b.at));
      const last = messages.at(-1);
      const unread = threads.reduce((sum, item) => sum + item.unread, 0);
      // Filtros rápidos com os dados reais da carteira (o bootstrap da v1 traz todas as conversas).
      const open = opportunities.filter(
        (item) =>
          item.contactId === customer.id && item.stage !== "fechado" && item.stage !== "perdido",
      );
      const nextDue = open.map((item) => item.nextAction?.due ?? "").filter(Boolean);
      const views = inboxViews(
        {
          unread,
          lastFrom: last?.from,
          awaitingReply: open.some((item) => item.awaitingReply),
          nextDue,
          hasProposal: open.some((item) =>
            proposalsFor(proposals, item.id).some((proposal) => proposal.status !== "Cancelada"),
          ),
        },
        now,
      );
      return { customer, unread, last, messages, views, late: isLate(nextDue, now) };
    })
    .filter(
      ({ customer, messages }) =>
        !query ||
        normalize(
          `${customer.name} ${customer.company ?? ""} ${customer.phone} ${opportunities
            .filter((item) => item.contactId === customer.id)
            .map((item) => item.interest)
            .join(" ")} ${messages.map((item) => item.text).join(" ")}`,
        ).includes(normalize(query)),
    );
  const counts = Object.fromEntries(
    INBOX_VIEWS.map((item) => [item.id, searched.filter((row) => row.views.has(item.id)).length]),
  ) as Record<InboxView, number>;
  const rows = searched
    .filter((row) => row.views.has(view))
    .sort((a, b) => (b.last?.at ?? "").localeCompare(a.last?.at ?? ""));
  return (
    <div className="crm-inbox flex">
      <aside
        className={cn(
          "flex w-full flex-col border-r bg-card md:w-80 md:shrink-0 2xl:w-[22rem]",
          selected && "hidden md:flex",
        )}
      >
        <div className="space-y-3 border-b px-4 pb-3 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-lg font-semibold">Atendimento</h1>
            <span
              className={cn(
                "inline-flex items-center gap-1 text-xs",
                connection?.connected ? "text-success" : "text-muted-foreground",
              )}
            >
              {connection?.connected ? (
                <Wifi className="size-3.5" />
              ) : (
                <WifiOff className="size-3.5" />
              )}
              {connectionLoading
                ? "Consultando…"
                : connection?.connected
                  ? "Conectado"
                  : "Não conectado"}
            </span>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Buscar atendimentos"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Nome, telefone ou interesse"
              className="rounded-full bg-[var(--wa-header)] pl-9"
            />
          </div>
          <InboxFilters value={view} counts={counts} onChange={setView} />
        </div>
        <ul className="flex-1 overflow-y-auto">
          {rows.length ? (
            rows.map(({ customer, unread: count, last, late }) => (
              <li key={customer.id}>
                <button
                  type="button"
                  onClick={() => select(customer.id)}
                  aria-current={selected === customer.id ? "true" : undefined}
                  className="wa-list-item"
                >
                  <Avatar name={customer.name} className="wa-list-avatar" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span
                        className={cn("truncate text-[15px]", count ? "font-semibold" : "font-medium")}
                      >
                        {customer.name}
                      </span>
                      {last && (
                        <span className={cn("wa-time", count > 0 && "wa-time-unread")}>
                          {listTime(last.at, now)}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <span className={cn("wa-preview", count > 0 && "wa-preview-unread")}>
                        {last?.from === "vendedora" && (
                          <MessageTicks status={last.status} className="size-4" />
                        )}
                        <span className="truncate">
                          {last?.from === "vendedora" && "Você: "}
                          {previewText(last?.text) || "Sem mensagens registradas"}
                        </span>
                      </span>
                      {count > 0 ? (
                        <span className="wa-unread" aria-label={`${count} não lida(s)`}>
                          {count}
                        </span>
                      ) : late ? (
                        <span title="Retorno atrasado" className="inline-flex shrink-0">
                          <CalendarClock
                            className="size-4 text-[var(--crm-warning)]"
                            aria-label="Retorno atrasado"
                          />
                        </span>
                      ) : null}
                    </div>
                  </div>
                </button>
              </li>
            ))
          ) : (
            <li className="p-6 text-center text-sm text-muted-foreground">
              {query || view !== "todas"
                ? "Nenhum atendimento neste filtro."
                : "Os clientes e as conversas recebidas aparecerão aqui."}
            </li>
          )}
        </ul>
        <div className="border-t p-3">
          <p className="text-xs text-muted-foreground">
            {connection?.message || "A conexão WhatsApp ainda não foi consultada."}
          </p>
          {connection?.canManage && (
            <Button asChild size="sm" variant="outline" className="mt-2 w-full">
              <Link to="/interno/crm/integracoes">Configurar WhatsApp</Link>
            </Button>
          )}
        </div>
      </aside>
      <section
        className={cn(
          "min-w-0 flex-1 flex-col bg-background",
          selected ? "flex" : "hidden md:flex",
        )}
      >
        {selected ? (
          <Chat
            key={selected}
            contactId={selected}
            selectedOpportunity={selectedOpportunity}
            onBack={() => select()}
            onCard={() => setCardOpen(true)}
          />
        ) : (
          <div className="grid flex-1 place-items-center p-8">
            <EmptyState
              icon={MessageCircle}
              title="Escolha um atendimento"
              text="Abra um cliente para consultar as mensagens e acompanhar as oportunidades."
            />
          </div>
        )}
      </section>
      {selected && (
        <aside className="hidden w-72 shrink-0 overflow-y-auto border-l bg-card xl:block">
          <ClientCard contactId={selected} />
        </aside>
      )}
      <Sheet open={cardOpen} onOpenChange={setCardOpen}>
        <SheetContent className="mag-crm w-full overflow-y-auto p-0 sm:max-w-sm">
          <SheetHeader className="sr-only">
            <SheetTitle>Ficha do cliente</SheetTitle>
            <SheetDescription>Oportunidades e propostas do atendimento.</SheetDescription>
          </SheetHeader>
          {selected && <ClientCard contactId={selected} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Chat({
  contactId,
  selectedOpportunity,
  onBack,
  onCard,
}: {
  contactId: string;
  selectedOpportunity: string | undefined;
  onBack: () => void;
  onCard: () => void;
}) {
  const { contact, opportunities, connection, sendMessage, busy, open, markRead } = useCrm();
  const customer = contact(contactId);
  const getHistory = useServerFn(getCrmConversationPage);
  const readContext = useServerFn(getWahaContactContext);
  const bindContext = useServerFn(bindWahaContactOpportunity);
  const syncContactHistory = useServerFn(syncWahaContactHistory);
  const [syncingHistory, setSyncingHistory] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const history = useInfiniteQuery({
    queryKey: ["interno", "crm", "conversation", contactId],
    queryFn: ({ pageParam }) =>
      getHistory({ data: { contactId, limit: 50, ...(pageParam ? { before: pageParam } : {}) } }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => (page.hasMore ? page.nextCursor : undefined),
    enabled: Boolean(customer),
    refetchInterval: 5_000,
    staleTime: 3_000,
    retry: 1,
  });
  const messages = [
    ...new Map(
      (history.data?.pages.flatMap((page) => page.messages) ?? []).map((message) => [
        message.id,
        message,
      ]),
    ).values(),
  ].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const wahaContext = useQuery({
    queryKey: ["interno", "crm", "waha-context", contactId],
    queryFn: () => readContext({ data: { contactId } }),
    enabled:
      Boolean(customer) &&
      connection?.provider === "waha" &&
      messages.some((message) => message.provider === "waha"),
    refetchInterval: 5_000,
  });
  const openOpportunities = opportunities.filter(
    (item) => item.contactId === contactId && !["fechado", "perdido"].includes(item.stage),
  );
  const opportunity =
    opportunities.find(
      (item) =>
        item.contactId === contactId &&
        item.id === (wahaContext.data?.opportunityId || selectedOpportunity),
    ) ??
    opportunities
      .filter((item) => item.contactId === contactId && item.stage !== "perdido")
      .sort((a, b) => b.lastInteraction.localeCompare(a.lastInteraction))[0];
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [bindingContext, setBindingContext] = useState(false);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const uploadedAttachment = useRef<{
    file: File;
    attachment: NonNullable<Message["attachments"]>[number];
  } | null>(null);
  const messageAttempt = useRef<{ id: string; fingerprint: string } | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const historyElement = useRef<HTMLDivElement>(null);
  const newestMessageId = messages.at(-1)?.id;
  // Fica no fim da conversa quando a área muda de tamanho (barra da oportunidade, fotos carregando),
  // a não ser que a pessoa tenha rolado para cima para ler mensagens antigas.
  const pinnedToEnd = useRef(true);
  const contentElement = useRef<HTMLDivElement>(null);
  useEffect(() => {
    pinnedToEnd.current = true;
    end.current?.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, [newestMessageId]);
  useEffect(() => {
    const element = historyElement.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (pinnedToEnd.current) element.scrollTop = element.scrollHeight;
    });
    observer.observe(element);
    if (contentElement.current) observer.observe(contentElement.current);
    return () => observer.disconnect();
  }, [Boolean(customer), messages.length > 0]);
  useEffect(() => {
    if (newestMessageId) void markRead(contactId).catch(() => {});
  }, [newestMessageId, contactId]);
  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) {
      setFilePreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setFilePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  if (!customer)
    return (
      <div className="p-6">
        <EmptyState
          icon={MessageCircle}
          title="Atendimento indisponível"
          text="O cliente não existe ou está fora do seu acesso."
          action={
            <Button variant="outline" onClick={onBack}>
              Voltar
            </Button>
          }
        />
      </div>
    );
  const identityNeedsReview = Boolean(
    wahaContext.data?.triageReason &&
    wahaContext.data.triageReason !== "multiple_open_opportunities",
  );
  // WAHA: only the responsible seller replies by default; administrators follow the conversation.
  const supervisionOnly = connection?.provider === "waha" && connection.canReply === false;
  const canSend = Boolean(
    connection?.connected && customer.phone && !identityNeedsReview && !supervisionOnly,
  );
  const canSyncHistory =
    connection?.provider === "waha" &&
    connection.canSyncConversation === true &&
    Boolean(connection.responsibleId) &&
    customer.ownerId === connection.responsibleId;
  const canSendMedia = canSend && connection?.capabilities?.media === true;
  const sending = busy || uploading;
  const selectFile = (selectedFile: File | undefined) => {
    if (!selectedFile) return;
    if (selectedFile.size > MAX_ATTACHMENT_BYTES) {
      setSendError("O arquivo deve ter até 7 MB.");
      return;
    }
    if (selectedFile.size === 0) {
      setSendError("O arquivo está vazio.");
      return;
    }
    setFile(selectedFile);
    uploadedAttachment.current = null;
    messageAttempt.current = null;
    setSendError(null);
  };
  // Mensagens agrupadas por dia: cada grupo tem sua etiqueta ("Hoje", "Ontem"...) presa no topo ao rolar.
  const dayGroups: { key: string; at: string; label: string; messages: Message[] }[] = [];
  for (const message of messages) {
    const key = chatDayKey(message.at);
    const group = dayGroups.at(-1);
    if (group?.key === key) group.messages.push(message);
    else dayGroups.push({ key, at: message.at, label: dayLabel(message.at), messages: [message] });
  }
  return (
    <>
      <header className="wa-header flex flex-wrap items-center gap-1 border-b px-2 py-2 sm:gap-2 sm:px-3 md:px-4">
        <button
          type="button"
          onClick={onBack}
          aria-label="Voltar para atendimentos"
          className="rounded-full p-2 hover:bg-accent md:hidden"
        >
          <ArrowLeft className="size-5" />
        </button>
        <Avatar name={customer.name} className="size-10" />
        <div className="min-w-0 flex-1 sm:min-w-[7rem]">
          <p className="truncate font-semibold">{customer.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {formatPhone(customer.phone) || "Telefone não informado"}
            {opportunity && ` · ${STAGE_LABEL[opportunity.stage]}`}
          </p>
        </div>
        {/* No xl a ficha já aparece ao lado; o botão fica para telas menores. */}
        <Button size="sm" variant="ghost" onClick={onCard} className="xl:hidden" title="Ficha do cliente">
          <IdCard />
          <span className="hidden sm:inline">Ficha</span>
        </Button>
        {opportunity && (
          <MoveMenu
            opp={opportunity}
            trigger={
              <Button
                size="sm"
                variant="ghost"
                title={`Mover no funil (etapa atual: ${STAGE_LABEL[opportunity.stage]})`}
                aria-label={`Mover no funil. Etapa atual: ${STAGE_LABEL[opportunity.stage]}`}
              >
                <SquareKanban />
                <span className="hidden 2xl:inline">{STAGE_LABEL[opportunity.stage]}</span>
                <ChevronDown className="size-3.5 opacity-70" />
              </Button>
            }
          />
        )}
        {canSyncHistory && (
          <Button
            size="sm"
            variant="ghost"
            disabled={!connection?.connected || syncingHistory}
            title="Busca no WhatsApp o histórico disponível somente desta conversa"
            onClick={async () => {
              setSyncingHistory(true);
              try {
                const result = await syncContactHistory({ data: { contactId } });
                toast.success(result.message);
                await queryClient.invalidateQueries({
                  queryKey: ["interno", "crm", "conversation", contactId],
                });
              } catch (error) {
                toast.error(
                  error instanceof Error ? error.message : "Não foi possível buscar o histórico.",
                );
              } finally {
                setSyncingHistory(false);
              }
            }}
          >
            {syncingHistory ? <Loader2 className="animate-spin" /> : <History />}
            <span className="hidden 2xl:inline">Buscar histórico</span>
          </Button>
        )}
      </header>
      {wahaContext.data && (
        <div className="space-y-1 border-b bg-card px-3 py-2 text-xs md:px-4">
          {identityNeedsReview ? (
            <p role="alert" className="text-destructive">
              A identificação deste contato precisa de revisão administrativa antes de enviar
              mensagens.
            </p>
          ) : (
            openOpportunities.length > 0 && (
              <label className="flex flex-wrap items-center gap-2">
                Oportunidade deste atendimento
                <select
                  aria-label="Oportunidade deste atendimento"
                  className="min-w-0 max-w-full flex-1 rounded-md border bg-card px-2 py-1 text-xs"
                  value={wahaContext.data.opportunityId || ""}
                  disabled={bindingContext || busy}
                  onChange={async (event) => {
                    const opportunityId = event.target.value;
                    if (!opportunityId) return;
                    setBindingContext(true);
                    setContextError(null);
                    try {
                      await bindContext({ data: { contactId, opportunityId } });
                      await queryClient.invalidateQueries({ queryKey: ["interno", "crm"] });
                      await navigate({
                        to: "/interno/crm/atendimento",
                        search: { c: contactId, o: opportunityId },
                      });
                    } catch (error) {
                      setContextError(
                        error instanceof Error
                          ? error.message
                          : "Não foi possível vincular a oportunidade.",
                      );
                    } finally {
                      setBindingContext(false);
                    }
                  }}
                >
                  <option value="">Selecione uma oportunidade</option>
                  {openOpportunities.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>
            )
          )}
          {wahaContext.data.triageReason === "multiple_open_opportunities" && (
            <p className="text-muted-foreground">
              Escolha a oportunidade que deve receber as próximas interações desta conversa.
            </p>
          )}
          {contextError && (
            <p role="alert" className="text-destructive">
              {contextError}
            </p>
          )}
        </div>
      )}
      <div
        className="wa-wallpaper flex-1 overflow-y-auto px-3 pb-4 pt-2 md:px-[5%]"
        aria-label="Histórico de mensagens"
        ref={historyElement}
        onScroll={(event) => {
          const element = event.currentTarget;
          pinnedToEnd.current = element.scrollHeight - element.scrollTop - element.clientHeight < 96;
        }}
      >
        {history.hasNextPage && (
          <div className="pt-2 text-center">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="rounded-full bg-white shadow-sm"
              disabled={history.isFetchingNextPage}
              onClick={async () => {
                const element = historyElement.current;
                const oldHeight = element?.scrollHeight ?? 0;
                const oldTop = element?.scrollTop ?? 0;
                await history.fetchNextPage();
                requestAnimationFrame(() => {
                  if (element) element.scrollTop = oldTop + element.scrollHeight - oldHeight;
                });
              }}
            >
              {history.isFetchingNextPage ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ChevronUp className="size-4" />
              )}
              Carregar mensagens anteriores
            </Button>
          </div>
        )}
        {history.isLoading && (
          <p role="status" className="wa-notice">
            Carregando mensagens…
          </p>
        )}
        {history.isError && (
          <p
            role="alert"
            className="mx-auto mt-2 max-w-md rounded-md border border-destructive/30 bg-white p-3 text-sm text-destructive"
          >
            Não foi possível atualizar as mensagens.{" "}
            <button type="button" className="underline" onClick={() => void history.refetch()}>
              Tentar novamente
            </button>
          </p>
        )}
        {messages.length ? (
          <div ref={contentElement}>
            {dayGroups.map((group) => (
              <section key={group.key} aria-label={`Mensagens de ${group.label}`}>
                <DayDivider at={group.at} />
                {group.messages.map((message, index) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    first={opensGroup(group.messages[index - 1], message, true)}
                    contactName={customer.name}
                  />
                ))}
              </section>
            ))}
          </div>
        ) : !history.isLoading && !history.isError ? (
          <div className="mx-auto mt-6 max-w-md rounded-xl bg-white/90 py-8 shadow-sm">
            <EmptyState
              icon={MessageCircle}
              title="Nenhuma mensagem registrada"
              text={
                connection?.connected
                  ? "Envie a primeira mensagem ou aguarde o contato do cliente."
                  : "O histórico aparecerá quando houver mensagens recebidas pela integração."
              }
            />
          </div>
        ) : null}
        <div ref={end} />
      </div>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!canSend || (!text.trim() && !file) || sending || (file && !canSendMedia)) return;
          const value = text.trim();
          if (file?.type.startsWith("audio/") && value) {
            setSendError(
              "Envie o áudio e o texto em mensagens separadas. Áudios não aceitam legenda.",
            );
            return;
          }
          const fingerprint = `${value}\n${file ? `${file.name}:${file.size}:${file.lastModified}` : ""}`;
          if (messageAttempt.current?.fingerprint !== fingerprint)
            messageAttempt.current = { id: crypto.randomUUID(), fingerprint };
          setSendError(null);
          try {
            let attachmentId: string | undefined;
            if (file) {
              if (uploadedAttachment.current?.file !== file) {
                setUploading(true);
                const body = new FormData();
                body.append("file", file);
                const response = await fetch(
                  `/api/interno/crm/anexos?contactId=${encodeURIComponent(contactId)}`,
                  { method: "POST", body, credentials: "same-origin" },
                );
                if (!response.ok) {
                  let detail = "Não foi possível preparar o anexo.";
                  const payload = (await response.json().catch(() => null)) as {
                    error?: string;
                    message?: string;
                  } | null;
                  if (payload?.message) detail = payload.message;
                  else if (payload?.error) detail = payload.error;
                  throw new Error(detail);
                }
                const payload = (await response.json()) as {
                  attachment: NonNullable<Message["attachments"]>[number];
                };
                uploadedAttachment.current = { file, attachment: payload.attachment };
                setUploading(false);
              }
              attachmentId = uploadedAttachment.current!.attachment.id;
            }
            await sendMessage(
              contactId,
              value,
              messageAttempt.current!.id,
              attachmentId ? [attachmentId] : undefined,
            );
            messageAttempt.current = null;
            uploadedAttachment.current = null;
            setText("");
            setFile(null);
            await queryClient.invalidateQueries({
              queryKey: ["interno", "crm", "conversation", contactId],
            });
          } catch (error) {
            setSendError(
              error instanceof Error ? error.message : "Não foi possível concluir o envio.",
            );
          } finally {
            setUploading(false);
          }
        }}
        className="wa-composer px-3 pb-2.5 pt-2 md:px-4"
      >
        <div className="mb-2 flex gap-1.5 overflow-x-auto" role="group" aria-label="Atalhos do atendimento">
          <a
            href="/interno/produtos"
            target="_blank"
            rel="noopener noreferrer"
            className="wa-chip"
            title="Consulta de produtos (abre em outra aba)"
          >
            <PackageSearch aria-hidden="true" />
            Produtos
          </a>
          {opportunity && (
            <>
              <button
                type="button"
                className="wa-chip"
                onClick={() => open({ kind: "createProposal", id: opportunity.id })}
              >
                <FileText aria-hidden="true" />
                Orçamento
              </button>
              <button
                type="button"
                className="wa-chip"
                onClick={() => open({ kind: "schedule", id: opportunity.id })}
              >
                <CalendarClock aria-hidden="true" />
                Agendar retorno
              </button>
            </>
          )}
        </div>
        {file && (
          <ComposerFilePreview
            file={file}
            imagePreview={filePreview}
            prepared={Boolean(uploadedAttachment.current)}
            disabled={sending}
            onRemove={() => {
              setFile(null);
              uploadedAttachment.current = null;
              setSendError(null);
            }}
          />
        )}
        {connection?.capabilities?.media && (
          <input
            ref={uploadInput}
            className="sr-only"
            type="file"
            aria-label="Selecionar anexo"
            accept="image/jpeg,image/png,image/gif,image/webp,audio/ogg,audio/mpeg,audio/mp4,audio/wav,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain"
            onChange={(event) => {
              selectFile(event.target.files?.[0]);
              event.target.value = "";
            }}
            disabled={!canSendMedia || sending}
          />
        )}
        <ComposerBar
          text={text}
          onTextChange={setText}
          disabled={!canSend || sending}
          sending={sending}
          canSubmit={
            canSend && (Boolean(text.trim()) || Boolean(file)) && !sending && !(file && !canSendMedia)
          }
          mediaEnabled={connection?.capabilities?.media === true}
          canSendMedia={canSendMedia}
          hasFile={Boolean(file)}
          placeholder={canSend ? "Mensagem" : "WhatsApp indisponível para envio"}
          onPickFile={() => uploadInput.current?.click()}
          onRecorded={(recorded) => selectFile(recorded)}
          onError={setSendError}
        />
        {sendError && (
          <p
            role="alert"
            className="mt-2 rounded-md border border-destructive/30 bg-white p-2 text-xs text-destructive"
          >
            {sendError}
          </p>
        )}
        {/* Conectado: só a dica do teclado (como no WhatsApp). Sem envio: o motivo, em destaque discreto. */}
        <p className="mt-1.5 text-xs text-muted-foreground">
          {canSend ? (
            <span className="hidden md:inline">Enter envia · Shift+Enter quebra a linha</span>
          ) : supervisionOnly ? (
            "Supervisão: somente a vendedora responsável responde por este número."
          ) : !customer.phone ? (
            "Complete o telefone na ficha do cliente para enviar mensagens."
          ) : identityNeedsReview ? (
            "A identificação deste contato precisa de revisão administrativa antes de enviar."
          ) : (
            connection?.message || "Configure e conecte o WhatsApp para habilitar o envio."
          )}
        </p>
      </form>
    </>
  );
}
function ClientCard({ contactId }: { contactId: string }) {
  const { contact, opportunities, proposals, open } = useCrm();
  const navigate = useNavigate();
  const customer = contact(contactId);
  if (!customer) return <p className="p-5 text-sm text-muted-foreground">Cliente indisponível.</p>;
  const related = opportunities.filter((item) => item.contactId === contactId);
  return (
    <div className="space-y-5 p-5 text-sm">
      <div className="flex items-center gap-3">
        <Avatar name={customer.name} className="size-12" />
        <div className="min-w-0">
          <p className="font-semibold">{customer.name}</p>
          {customer.company && <p className="truncate text-muted-foreground">{customer.company}</p>}
          <p className="text-muted-foreground">{formatPhone(customer.phone) || "Sem telefone"}</p>
        </div>
      </div>
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Oportunidades ({related.length})
        </p>
        {related.map((item) => (
          <button
            type="button"
            key={item.id}
            onClick={() => open({ kind: "opportunity", id: item.id })}
            className="w-full space-y-2 rounded-xl border p-3 text-left hover:bg-accent"
          >
            <div className="flex flex-wrap gap-1.5">
              <StageBadge stage={item.stage} />
              <OriginBadge origin={item.origin} />
            </div>
            <p className="font-medium">{item.title}</p>
            <NextActionLine label={item.nextAction.label} due={item.nextAction.due} />
            {proposalsFor(proposals, item.id).map((proposal) => (
              <div
                key={proposal.id}
                className="flex flex-wrap items-center justify-between gap-1 rounded-md bg-surface px-2 py-1.5 text-xs"
              >
                <span className="inline-flex items-center gap-1">
                  <FileText className="size-3" />
                  {proposal.number}
                </span>
                <span className="inline-flex items-center gap-1.5 tabular-nums">
                  {money(proposal.value)}
                  <ProposalBadge status={proposal.status} />
                </span>
              </div>
            ))}
          </button>
        ))}
      </div>
      <div className="grid gap-2">
        <Button variant="outline" onClick={() => open({ kind: "newOpportunity", contactId })}>
          Nova oportunidade
        </Button>
        <Button
          variant="ghost"
          onClick={() => navigate({ to: "/interno/crm/clientes", search: { id: contactId } })}
        >
          <ExternalLink />
          Ver histórico completo
        </Button>
      </div>
    </div>
  );
}
