import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  CheckSquare,
  FileText,
  MessageCircle,
  Plus,
  Sparkles,
  Users,
  Pencil,
  Clock,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getOpportunityDetail,
  getCrmContactsPage,
  getCrmConversationPage,
} from "@/lib/crm.functions";
import { Loading } from "@/components/interno/ui";
import { cn } from "@/lib/utils";
import { useCrm } from "./CrmProvider";
import { Avatar, EmptyState, NextActionLine, OriginBadge } from "./bits";
import { OppStageBadge } from "./funil-ui";
import { fullDate, money } from "./format";
import { ContactMatchHint, ContactSearch, ContactSearchPreparing } from "./ContactSearch";
import { WahaContactsButton } from "./WahaContactsDialog";

export function CrmClients({ selected }: { selected: string | undefined }) {
  const navigate = useNavigate();
  const { open, viewerId } = useCrm();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [searchMode, setSearchMode] = useState<"contacts" | "all">("contacts");
  const pollingStartedAt = useRef(Date.now());
  useEffect(() => {
    pollingStartedAt.current = Date.now();
  }, [search, searchMode]);
  const loadPage = useServerFn(getCrmContactsPage);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const pages = useInfiniteQuery({
    queryKey: ["interno", "crm", "clients-page", viewerId, search, searchMode],
    queryFn: ({ pageParam }) =>
      loadPage({
        data: { search, searchMode, limit: 50, ...(pageParam ? { before: pageParam } : {}) },
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => (page.hasMore ? page.nextCursor : undefined),
    refetchInterval: (query) =>
      searchMode === "all" &&
      Boolean(search) &&
      query.state.data?.pages.some((page) => page.searchIndex?.ready === false)
        ? Date.now() - pollingStartedAt.current < 60_000 && query.state.data.pages.length === 1
          ? 2_000
          : false
        : false,
    staleTime: 10_000,
    retry: 1,
  });
  const list = [
    ...new Map(
      (pages.data?.pages.flatMap((page) => page.contacts) ?? []).map((item) => [item.id, item]),
    ).values(),
  ];
  const matches = new Map(
    pages.data?.pages.flatMap((page) => Object.entries(page.matches ?? {})) ?? [],
  );
  const preparingSearch =
    pages.data?.pages.some((page) => page.searchIndex?.ready === false) ?? false;
  const select = (id?: string) =>
    navigate({ to: "/interno/crm/clientes", search: id ? { id } : {} });
  return (
    <div className="flex min-h-[35rem]">
      <aside
        className={cn(
          "flex w-full flex-col border-r bg-card md:w-72 md:shrink-0",
          selected && "hidden md:flex",
        )}
      >
        <div className="space-y-3 border-b p-4">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-lg font-semibold">Clientes</h1>
            <Button size="sm" variant="outline" onClick={() => open({ kind: "contact" })}>
              <Plus />
              Novo cliente
            </Button>
          </div>
          <ContactSearch
            label="Buscar clientes"
            value={query}
            onChange={setQuery}
            mode={searchMode}
            onModeChange={setSearchMode}
          />
          <WahaContactsButton destination="clients" className="w-full" />
          {search && pages.data && (
            <p role="status" className="text-xs text-muted-foreground">
              {pages.data.pages[0]?.total ?? 0} cliente(s) encontrado(s)
            </p>
          )}
          {preparingSearch && (
            <ContactSearchPreparing
              refreshing={pages.isFetching}
              onRefresh={() => {
                pollingStartedAt.current = Date.now();
                void pages.refetch();
              }}
            />
          )}
        </div>
        <ul className="max-h-[65vh] flex-1 overflow-y-auto">
          {pages.isLoading ? (
            <li className="p-4 text-sm text-muted-foreground">Carregando clientes…</li>
          ) : pages.isError ? (
            <li role="alert" className="space-y-2 p-4 text-sm text-destructive">
              <p>Não foi possível buscar os clientes.</p>
              <Button variant="outline" size="sm" onClick={() => void pages.refetch()}>
                Tentar novamente
              </Button>
            </li>
          ) : list.length ? (
            list.map((customer) => (
              <li key={customer.id}>
                <button
                  type="button"
                  onClick={() => select(customer.id)}
                  className={cn(
                    "flex w-full items-center gap-3 border-b px-4 py-3 text-left hover:bg-accent",
                    selected === customer.id && "crm-brand",
                  )}
                >
                  <Avatar name={customer.name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{customer.name}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {customer.company ||
                        customer.phone ||
                        customer.email ||
                        "Sem contato informado"}
                    </p>
                    {search && <ContactMatchHint match={matches.get(customer.id)} />}
                  </div>
                  <span className="text-xs text-muted-foreground">Ver ficha</span>
                </button>
              </li>
            ))
          ) : (
            <li className="p-6 text-center text-sm text-muted-foreground">
              {query
                ? "Nenhum cliente neste filtro."
                : "Cadastre um cliente ou traga uma entrada do site para começar."}
            </li>
          )}
          {pages.hasNextPage && (
            <li className="p-3 text-center">
              <Button
                size="sm"
                variant="outline"
                disabled={pages.isFetchingNextPage || preparingSearch}
                onClick={() => void pages.fetchNextPage()}
              >
                {pages.isFetchingNextPage && <Loader2 className="size-3 animate-spin" />}Carregar
                mais clientes
              </Button>
            </li>
          )}
        </ul>
      </aside>
      <section className={cn("min-w-0 flex-1", !selected && "hidden md:block")}>
        {selected ? (
          <ClientDetail key={selected} id={selected} onBack={() => select()} />
        ) : (
          <div className="grid h-full place-items-center p-8">
            <EmptyState
              icon={Users}
              title="Escolha um cliente"
              text="Consulte dados, oportunidades, mensagens, retornos e propostas na mesma ficha."
            />
          </div>
        )}
      </section>
    </div>
  );
}

function ClientDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const {
    contact,
    opportunities,
    proposals,
    tasksDone,
    open,
    units,
    entityLoading,
    contactOpportunitiesTruncated,
    viewerId,
  } = useCrm();
  const navigate = useNavigate();
  const detail = useServerFn(getOpportunityDetail);
  const readMessages = useServerFn(getCrmConversationPage);
  const customer = contact(id);
  const related = opportunities.filter((item) => item.contactId === id);
  const ids = related.map((item) => item.id);
  const activities = useQuery({
    queryKey: ["interno", "crm", "client-history", id, ids.join(",")],
    queryFn: () => Promise.all(ids.map((opportunityId) => detail({ data: { id: opportunityId } }))),
    enabled: Boolean(customer) && ids.length > 0,
    staleTime: 10_000,
  });
  const history = useInfiniteQuery({
    queryKey: ["interno", "crm", "client-messages", viewerId, id],
    queryFn: ({ pageParam }) =>
      readMessages({
        data: { contactId: id, limit: 50, ...(pageParam ? { before: pageParam } : {}) },
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => (page.hasMore ? page.nextCursor : undefined),
    enabled: Boolean(customer),
    staleTime: 10_000,
    retry: 1,
  });
  if (!customer && entityLoading) return <Loading />;
  if (!customer)
    return (
      <div className="p-6">
        <EmptyState
          icon={Users}
          title="Cliente indisponível"
          text="O cadastro não existe ou está fora do seu acesso."
          action={
            <Button variant="outline" onClick={onBack}>
              Voltar para clientes
            </Button>
          }
        />
      </div>
    );
  const opportunityIds = new Set(ids);
  const events = [
    ...related.map((item) => ({
      id: `entry-${item.id}`,
      at: item.createdAt,
      icon: Sparkles,
      title: `Entrada: ${item.title}`,
      text: `Origem: ${item.origin}`,
    })),
    ...[
      ...new Map(
        (history.data?.pages.flatMap((page) => page.messages) ?? []).map((message) => [
          message.id,
          message,
        ]),
      ).values(),
    ].map((message) => ({
      id: `message-${message.id}`,
      at: message.at,
      icon: MessageCircle,
      title: message.from === "cliente" ? "Mensagem recebida" : "Mensagem enviada",
      text: message.text,
    })),
    ...tasksDone
      .filter((item) => opportunityIds.has(item.opportunityId))
      .map((item) => ({
        id: `task-${item.id}`,
        at: item.at,
        icon: CheckSquare,
        title: "Tarefa concluída",
        text: item.label,
      })),
    ...proposals
      .filter((item) => item.contactId === id)
      .map((item) => ({
        id: `proposal-${item.id}`,
        at: item.date,
        icon: FileText,
        title: `Negociação ${item.number} · ${item.status}`,
        text: money(item.value),
      })),
    ...(activities.data ?? []).flatMap((item) =>
      item.activities
        .filter(
          (activity) =>
            activity.kind !== "opportunity:created" && activity.kind !== "task:completed",
        )
        .map((activity) => ({
          id: `activity-${activity.id}`,
          at: activity.at,
          icon: Clock,
          title: activity.label,
          text: activity.actorName,
        })),
    ),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 md:px-6">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 text-sm text-muted-foreground md:hidden"
      >
        <ArrowLeft className="size-4" />
        Clientes
      </button>
      <div className="flex flex-wrap items-start gap-3">
        <Avatar name={customer.name} className="size-14 text-base" />
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-semibold tracking-tight">{customer.name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {[customer.company, customer.phone, customer.email, customer.city]
              .filter(Boolean)
              .join(" · ") || "Complete os dados do cliente."}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {customer.ownerName}
            {customer.unitId &&
              ` · ${units.find((unit) => unit.id === customer.unitId)?.name ?? "Unidade"}`}
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => open({ kind: "contact", id: customer.id })}
        >
          <Pencil />
          Editar cliente
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => navigate({ to: "/interno/crm/atendimento", search: { c: id } })}
        >
          <MessageCircle />
          Abrir conversa
        </Button>
        <Button onClick={() => open({ kind: "newOpportunity", contactId: id })}>
          <Plus />
          Nova oportunidade
        </Button>
      </div>
      <section>
        <h3 className="mb-3 font-semibold">Oportunidades ({related.length})</h3>
        {contactOpportunitiesTruncated && (
          <p className="mb-3 text-xs text-muted-foreground">
            Exibindo as oportunidades mais recentes deste cliente. Consulte as negociações para os
            registros anteriores.
          </p>
        )}
        {related.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {related.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => open({ kind: "opportunity", id: item.id })}
                className="crm-card space-y-2 rounded-xl border bg-card p-4 text-left"
              >
                <div className="flex flex-wrap gap-1.5">
                  <OppStageBadge opp={item} />
                  <OriginBadge origin={item.origin} />
                </div>
                <p className="font-semibold">{item.title}</p>
                <NextActionLine label={item.nextAction.label} due={item.nextAction.due} compact />
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nenhuma oportunidade cadastrada para este cliente.
          </p>
        )}
      </section>
      <section>
        <h3 className="mb-4 font-semibold">Linha do tempo</h3>
        {history.isLoading && (
          <p className="mb-3 text-sm text-muted-foreground">Carregando mensagens…</p>
        )}
        {history.isError && (
          <p role="alert" className="mb-3 text-sm text-destructive">
            Não foi possível atualizar as mensagens.{" "}
            <button type="button" className="underline" onClick={() => void history.refetch()}>
              Tentar novamente
            </button>
          </p>
        )}
        {activities.isError && (
          <p role="alert" className="mb-3 text-sm text-destructive">
            Não foi possível atualizar os eventos das oportunidades.
          </p>
        )}
        {events.length ? (
          <ol className="crm-timeline space-y-5">
            {events.map((event) => (
              <li key={event.id} className="relative">
                <span className="crm-timeline-icon">
                  <event.icon className="size-3.5 text-muted-foreground" />
                </span>
                <p className="text-sm font-medium">{event.title}</p>
                {event.text && (
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">{event.text}</p>
                )}
                <p className="mt-0.5 text-xs text-muted-foreground">{fullDate(event.at)}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">
            Os próximos atendimentos e atividades aparecerão aqui.
          </p>
        )}
        {history.hasNextPage && (
          <Button
            className="mt-4"
            size="sm"
            variant="outline"
            disabled={history.isFetchingNextPage}
            onClick={() => void history.fetchNextPage()}
          >
            {history.isFetchingNextPage && <Loader2 className="size-3 animate-spin" />}Carregar
            mensagens anteriores
          </Button>
        )}
      </section>
    </div>
  );
}
