import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getCommercialMetrics } from "@/lib/links-metrics.functions";
import { Card, ErrorState, Loading, PageTitle, useMe } from "@/components/interno/ui";
import { MarketingMetrics } from "@/components/interno/MarketingMetrics";

export const Route = createFileRoute("/_authenticated/interno/metricas")({
  head: () => ({ meta: [{ title: "Métricas — Painel MAG" }] }),
  component: Metrics,
});
function Metrics() {
  const me = useMe();
  const load = useServerFn(getCommercialMetrics);
  const [days, setDays] = useState<30 | 90>(30);
  const allowed = me.data?.roles.some((role) => role === "admin" || role === "comercial") ?? false;
  const query = useQuery({
    queryKey: ["interno", "commercial-metrics", days],
    queryFn: () => load({ data: { days } }),
    enabled: allowed,
    staleTime: 30_000,
  });
  if (me.isLoading) return <Loading />;
  if (!allowed) return <ErrorState error={new Error("Forbidden")} />;
  const data = query.data;
  const funnel = data
    ? ([
        ["Solicitações", data.leads],
        ["Negociações", data.negotiations],
        ["Com proposta gerada", data.proposals],
        ["Enviadas ou aceitas", data.sent],
        ["Aceitas", data.accepted],
      ] as const)
    : [];
  const max = Math.max(1, ...funnel.map(([, value]) => value));
  return (
    <>
      <PageTitle title="Métricas">
        <select
          aria-label="Período das métricas comerciais"
          value={days}
          onChange={(event) => setDays(Number(event.target.value) as 30 | 90)}
          className="h-10 rounded-md border bg-card px-3 text-sm"
        >
          <option value={30}>Últimos 30 dias</option>
          <option value={90}>Últimos 90 dias</option>
        </select>
      </PageTitle>
      <p className="mb-5 text-sm text-muted-foreground">
        {me.data?.roles.includes("admin")
          ? "Registros da equipe comercial."
          : "Seus registros comerciais e solicitações atribuídas a você."}{" "}
        Estados atuais das negociações criadas no período.
      </p>
      {query.isLoading ? (
        <Loading />
      ) : query.isError || !data ? (
        <ErrorState error={query.error} />
      ) : (
        <>
          <div className="mb-5 grid gap-4 sm:grid-cols-3">
            <Card>
              <p className="text-xs text-muted-foreground">Valor de propostas aceitas</p>
              <p className="mt-2 text-2xl font-semibold">
                {(data.acceptedValueCents / 100).toLocaleString("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                })}
              </p>
            </Card>
            <Card>
              <p className="text-xs text-muted-foreground">Negociações aceitas</p>
              <p className="mt-2 text-2xl font-semibold">{data.accepted}</p>
            </Card>
            <Card>
              <p className="text-xs text-muted-foreground">Aceitas / negociações do período</p>
              <p className="mt-2 text-2xl font-semibold">
                {data.negotiations ? ((data.accepted / data.negotiations) * 100).toFixed(1) : "0"}%
              </p>
            </Card>
          </div>
          <Card title="Funil comercial">
            <div className="space-y-4">
              {funnel.map(([title, value]) => (
                <div key={title}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span>{title}</span>
                    <span className="font-semibold tabular-nums">{value}</span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-brand"
                      style={{ width: `${(value / max) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
              Propostas são contadas por negociação, sem multiplicar versões. Valor aceito não
              equivale a faturamento ou recebimento. As etapas não representam necessariamente uma
              sequência exclusiva: uma solicitação pode gerar várias negociações. Tempo de primeira
              resposta e distribuição histórica por unidade ainda não são calculados.
            </p>
          </Card>
        </>
      )}
      {me.data?.roles.includes("admin") && (
        <div className="mt-8">
          <MarketingMetrics />
        </div>
      )}
    </>
  );
}
