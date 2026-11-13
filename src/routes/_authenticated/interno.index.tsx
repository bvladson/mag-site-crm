import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight } from "lucide-react";
import { getDashboard } from "@/lib/admin.functions";
import { getPanelCounts } from "@/lib/panel.functions";
import {
  Loading,
  ErrorState,
  PageTitle,
  StatusBadge,
  fmtDate,
  Empty,
  useMe,
} from "@/components/interno/ui";

export const Route = createFileRoute("/_authenticated/interno/")({ component: Dashboard });

function Dashboard() {
  const fn = useServerFn(getDashboard);
  const countsFn = useServerFn(getPanelCounts);
  const me = useMe();
  const q = useQuery({ queryKey: ["interno", "dash"], queryFn: () => fn() });
  const counts = useQuery({ queryKey: ["interno", "panel-counts"], queryFn: () => countsFn() });
  if (q.isLoading) return <Loading />;
  if (q.isError || !q.data) return <ErrorState error={q.error} />;
  const d = q.data;
  const cards = [
    d.quotesNew !== undefined && {
      label: "Novos orçamentos",
      n: d.quotesNew,
      to: "/interno/orcamentos",
    },
    d.contactsNew !== undefined && {
      label: "Contatos aguardando atendimento",
      n: d.contactsNew,
      to: "/interno/contatos",
    },
    d.appsNew !== undefined && {
      label: "Novas candidaturas",
      n: d.appsNew,
      to: "/interno/candidaturas",
    },
    d.talentNew !== undefined && {
      label: "Banco de talentos (novos)",
      n: d.talentNew,
      to: "/interno/candidaturas",
    },
    counts.data && {
      label: "Propostas enviadas",
      n: counts.data.sent,
      to: "/interno/orcamentos-internos",
    },
    counts.data && {
      label: "Aceites para revisão",
      n: counts.data.accepted,
      to: "/interno/orcamentos-internos",
    },
  ].filter(Boolean) as { label: string; n: number; to: string }[];
  return (
    <>
      <PageTitle title={`Olá, ${me.data?.displayName?.split(" ")[0] ?? "equipe MAG"}`}>
        <span className="text-sm text-muted-foreground">
          {new Date().toLocaleDateString("pt-BR", {
            dateStyle: "long",
            timeZone: "America/Fortaleza",
          })}
        </span>
      </PageTitle>
      <p className="-mt-2 mb-6 text-sm text-muted-foreground">O que precisa da sua atenção hoje.</p>
      {me.data?.roles.some((role) => role === "admin" || role === "comercial") && (
        <Link
          to="/interno/crm"
          className="mb-5 flex items-center justify-between gap-3 rounded-lg border bg-card p-5 text-sm font-semibold text-brand"
        >
          Abrir CRM comercial — atendimentos, oportunidades e retornos{" "}
          <ArrowRight className="size-4 shrink-0" />
        </Link>
      )}
      {me.data?.roles.includes("gerente") && (
        <Link
          to="/interno/admin"
          search={{ tab: "descontos" }}
          className="mb-5 block rounded-lg border bg-card p-5 text-sm font-semibold text-brand"
        >
          Analisar solicitações de desconto →
        </Link>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <Link
            key={c.label}
            to={c.to}
            className="rounded-md border bg-card p-5 hover:border-foreground/30"
          >
            <p className="font-display text-4xl font-semibold">{c.n}</p>
            <p className="mt-1 text-sm text-muted-foreground">{c.label}</p>
          </Link>
        ))}
      </div>
      {counts.isError && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          Não foi possível carregar os indicadores das negociações.
        </p>
      )}
      {counts.data && (
        <section className="mt-6 rounded-lg border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-4">
            <h2 className="font-semibold">Próximas ações comerciais</h2>
            <Link to="/interno/orcamentos-internos" className="text-sm font-semibold text-brand">
              Ver negociações
            </Link>
          </div>
          {!counts.data.next.length ? (
            <p className="p-5 text-sm text-muted-foreground">Nenhuma negociação pendente.</p>
          ) : (
            <ul className="divide-y">
              {counts.data.next.map((r) => (
                <li key={r.id}>
                  <Link
                    to="/interno/orcamentos-internos/$id"
                    params={{ id: r.id }}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-muted/50"
                  >
                    <span className="min-w-0">
                      <span className="block font-medium">{r.customer}</span>
                      <span className="text-xs text-muted-foreground">
                        {r.number} ·{" "}
                        {(r.totalCents / 100).toLocaleString("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        })}
                      </span>
                    </span>
                    <StatusBadge s={r.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {d.lastQuotes && (
          <Recent
            title="Últimos orçamentos"
            to="/interno/orcamentos"
            empty="Você ainda não recebeu orçamentos."
            items={d.lastQuotes.map((x) => ({
              id: x.id,
              href: `/interno/orcamentos/${x.id}`,
              a: x.nome,
              b: x.empresa ?? "",
              at: x.created_at,
              s: x.status,
            }))}
          />
        )}
        {d.lastContacts && (
          <Recent
            title="Últimos contatos"
            to="/interno/contatos"
            empty="Nenhum contato recebido ainda."
            items={d.lastContacts.map((x) => ({
              id: x.id,
              href: `/interno/contatos/${x.id}`,
              a: x.nome,
              b: x.assunto,
              at: x.created_at,
              s: x.status,
            }))}
          />
        )}
        {d.lastApps && (
          <Recent
            title="Últimas candidaturas"
            to="/interno/candidaturas"
            empty="Nenhuma candidatura recebida ainda."
            items={d.lastApps.map((x) => ({
              id: x.id,
              href: `/interno/candidaturas/${x.id}`,
              a: x.nome,
              b:
                x.job_title ??
                `Banco de talentos${x.area_interesse ? ` · ${x.area_interesse}` : ""}`,
              at: x.created_at,
              s: x.status,
            }))}
          />
        )}
      </div>
    </>
  );
}

function Recent({
  title,
  to,
  items,
  empty,
}: {
  title: string;
  to: string;
  empty: string;
  items: { id: string; href: string; a: string; b: string; at: string; s: string }[];
}) {
  return (
    <section className="min-w-0 rounded-md border bg-card">
      <div className="flex items-center justify-between border-b px-5 py-3">
        <h2 className="font-semibold">{title}</h2>
        <Link to={to} className="flex items-center gap-1 text-sm font-semibold text-brand">
          Ver todos <ArrowRight className="size-4" />
        </Link>
      </div>
      {items.length === 0 ? (
        <div className="p-4">
          <Empty>{empty}</Empty>
        </div>
      ) : (
        <ul className="divide-y">
          {items.map((i) => (
            <li key={i.id}>
              <a
                href={i.href}
                className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-surface"
              >
                <span className="min-w-0">
                  <b className="block truncate text-sm">{i.a}</b>
                  <span className="block truncate text-xs text-muted-foreground">
                    {i.b} · {fmtDate(i.at)}
                  </span>
                </span>
                <StatusBadge s={i.s} />
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
