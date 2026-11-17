import { Link, useNavigate } from "@tanstack/react-router";
import {
  CalendarClock,
  CheckCircle2,
  FileText,
  Inbox,
  MessageCircle,
  Plus,
  Reply,
  ArrowRight,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCrm } from "./CrmProvider";
import { Avatar, EmptyState, LastSeen, NextActionLine } from "./bits";
import { OppStageBadge } from "./funil-ui";
import { fullDate, isDueTodayOrLate } from "./format";

export function CrmDay() {
  const {
    opportunities,
    conversations,
    proposals,
    contact,
    open,
    siteLeads,
    importLead,
    busy,
    tasks,
    finishTask,
    canManage,
    counts,
  } = useCrm();
  const navigate = useNavigate();
  const waiting = proposals.filter((item) => item.status === "Enviada").length;
  const returns = tasks.filter((item) => item.status === "pending" && isDueTodayOrLate(item.due));
  const queue = opportunities
    .filter(
      (item) =>
        !["fechado", "perdido"].includes(item.stage) &&
        (item.awaitingReply || isDueTodayOrLate(item.nextAction.due)),
    )
    .sort(
      (a, b) =>
        Number(b.awaitingReply) - Number(a.awaitingReply) ||
        a.nextAction.due.localeCompare(b.nextAction.due),
    );
  const entries = siteLeads.filter((item) => !item.importedOpportunityId);
  const unreadContacts = new Set(
    conversations.filter((item) => item.unread > 0).map((item) => item.contactId),
  );
  const awaitingContacts = new Set([
    ...unreadContacts,
    ...opportunities
      .filter((item) => item.awaitingReply && !["fechado", "perdido"].includes(item.stage))
      .map((item) => item.contactId),
  ]);
  const awaitingCount = counts.awaitingContacts ?? awaitingContacts.size;
  // A conversation needs attention even before the seller chooses its opportunity.
  const triage = conversations.filter(
    (item) =>
      item.unread > 0 && !queue.some((opportunity) => opportunity.contactId === item.contactId),
  );
  const stats = [
    {
      label: "A responder",
      value: awaitingCount,
      icon: MessageCircle,
      to: "/interno/crm/atendimento" as const,
      tone: "crm-brand",
    },
    {
      label: "Retornos de hoje",
      value: returns.length,
      icon: CalendarClock,
      to: "/interno/crm/funil" as const,
      tone: "crm-warning",
    },
    {
      label: "Propostas aguardando",
      value: waiting,
      icon: FileText,
      to: "/interno/crm/propostas" as const,
      tone: "crm-info",
    },
  ];
  return (
    <div className="mx-auto max-w-6xl space-y-7 px-4 py-6 md:px-7 md:py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            {new Intl.DateTimeFormat("pt-BR", {
              dateStyle: "full",
              timeZone: "America/Fortaleza",
            }).format(new Date())}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl">
            Veja o que precisa da sua atenção.
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {canManage
              ? "Atendimentos e oportunidades da equipe."
              : "Sua carteira e seus próximos retornos."}
          </p>
        </div>
        <Button variant="outline" onClick={() => open({ kind: "newOpportunity" })}>
          <Plus />
          Nova oportunidade
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {stats.map(({ label, value, icon: Icon, to, tone }) => (
          <Link
            key={label}
            to={to}
            className="crm-card flex items-center gap-4 rounded-xl border bg-card p-5"
          >
            <span className={`grid size-11 place-items-center rounded-lg ${tone}`}>
              <Icon className="size-5" />
            </span>
            <div>
              <p className="text-3xl font-semibold leading-none tabular-nums">{value}</p>
              <p className="mt-1 text-sm text-muted-foreground">{label}</p>
            </div>
          </Link>
        ))}
      </div>
      <section>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Fila de hoje</h2>
          <span className="text-sm text-muted-foreground">
            {queue.length + triage.length} {queue.length + triage.length === 1 ? "item" : "itens"}
          </span>
        </div>
        {queue.length === 0 && triage.length === 0 && awaitingCount === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="Tudo em dia"
            text="Nenhuma resposta pendente ou retorno para hoje. Acompanhe as oportunidades no seu funil."
            action={
              <Button asChild variant="outline" className="mt-2">
                <Link to="/interno/crm/funil">Abrir meu funil</Link>
              </Button>
            }
          />
        ) : (
          <ul className="crm-card divide-y overflow-hidden rounded-xl border bg-card">
            {triage.map((thread) => {
              const customer = contact(thread.contactId);
              if (!customer) return null;
              return (
                <li
                  key={`triage-${thread.contactId}`}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center"
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <Avatar name={customer.name} />
                    <div className="min-w-0 space-y-1">
                      <p className="font-semibold">{customer.name}</p>
                      <p className="text-sm font-medium text-primary">
                        Mensagem recebida aguardando atendimento
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Abra a conversa para responder ou escolher a oportunidade deste atendimento.
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() =>
                      navigate({ to: "/interno/crm/atendimento", search: { c: customer.id } })
                    }
                  >
                    <Reply />
                    Atender
                  </Button>
                </li>
              );
            })}
            {queue.map((item) => {
              const customer = contact(item.contactId);
              if (!customer) return null;
              return (
                <li key={item.id} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-start gap-3 text-left"
                    onClick={() => open({ kind: "opportunity", id: item.id })}
                  >
                    <Avatar name={customer.name} />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{customer.name}</span>
                        <OppStageBadge opp={item} />
                        {(item.awaitingReply || unreadContacts.has(item.contactId)) && (
                          <span className="text-xs font-semibold text-primary">
                            Aguardando resposta
                          </span>
                        )}
                      </div>
                      <p className="truncate text-sm text-muted-foreground">{item.title}</p>
                      <NextActionLine
                        label={item.nextAction.label}
                        due={item.nextAction.due}
                        compact
                      />
                    </div>
                    <span className="hidden xl:block">
                      <LastSeen at={item.lastInteraction} />
                    </span>
                  </button>
                  <div className="flex flex-wrap gap-2 lg:shrink-0">
                    <Button
                      size="sm"
                      onClick={() =>
                        navigate({ to: "/interno/crm/atendimento", search: { c: customer.id } })
                      }
                    >
                      <Reply />
                      Atender
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => open({ kind: "schedule", id: item.id })}
                    >
                      <CalendarClock />
                      Agendar retorno
                    </Button>
                    {item.nextAction.taskId && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        aria-label={`Concluir tarefa ${item.nextAction.label}`}
                        onClick={() => {
                          void finishTask(item.nextAction.taskId!).catch(() => {});
                        }}
                      >
                        <Check />
                        Concluir
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
            {awaitingCount > awaitingContacts.size && (
              <li className="p-4 text-sm text-muted-foreground">
                Há outros atendimentos pendentes além deste resumo.{" "}
                <Link to="/interno/crm/atendimento" className="font-medium text-primary underline">
                  Consultar Atendimento
                </Link>
              </li>
            )}
          </ul>
        )}
      </section>
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">Entradas do site</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Solicitações e contatos já recebidos, prontos para entrar no CRM.
            </p>
          </div>
          <Link
            to="/interno/orcamentos"
            className="inline-flex items-center gap-1 text-sm font-semibold text-primary"
          >
            Solicitações recebidas
            <ArrowRight className="size-4" />
          </Link>
        </div>
        {!entries.length ? (
          <EmptyState
            icon={Inbox}
            title="Nenhuma entrada pendente"
            text="Novas solicitações do site aparecerão aqui. Você também pode cadastrar uma oportunidade manualmente."
          />
        ) : (
          <ul className="divide-y rounded-xl border bg-card">
            {entries.map((entry) => (
              <li key={entry.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {entry.name}
                    {entry.company && (
                      <span className="font-normal text-muted-foreground"> · {entry.company}</span>
                    )}
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                    {entry.interest}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {entry.protocol} · {entry.origin || "Site"} · {fullDate(entry.createdAt)}
                    {entry.ownerName && ` · ${entry.ownerName}`}
                  </p>
                </div>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={async () => {
                    try {
                      const id = await importLead(entry.sourceKind, entry.sourceId);
                      open({ kind: "opportunity", id });
                    } catch {
                      // O CRM apresenta a falha da ação e mantém o formulário aberto.
                    }
                  }}
                >
                  Trazer para o CRM
                  <ArrowRight />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
