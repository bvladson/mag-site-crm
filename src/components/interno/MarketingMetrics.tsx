import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { getMarketingMetrics } from "@/lib/links-metrics.functions";
import { Card, Empty, ErrorState, Loading, tableCls } from "./ui";
import { Button } from "@/components/ui/button";

export function MarketingMetrics({ compact = false }: { compact?: boolean }) {
  const [days, setDays] = useState<30 | 90>(30);
  const load = useServerFn(getMarketingMetrics);
  const query = useQuery({
    queryKey: ["interno", "marketing-metrics", days],
    queryFn: () => load({ data: { days } }),
    staleTime: 30_000,
  });
  return (
    <section className="mb-6 space-y-4" aria-label="Métricas da árvore e campanhas">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">
          {compact ? "Desempenho dos links e banners" : "Árvore e campanhas"}
        </h2>
        <label className="text-sm">
          <span className="sr-only">Período das métricas de campanhas</span>
          <select
            value={days}
            onChange={(event) => setDays(Number(event.target.value) as 30 | 90)}
            className="h-10 rounded-md border bg-card px-3"
          >
            <option value={30}>Últimos 30 dias</option>
            <option value={90}>Últimos 90 dias</option>
          </select>
        </label>
      </div>
      {query.isLoading ? (
        <Loading />
      ) : query.isError || !query.data ? (
        <ErrorState error={query.error} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ["Visualizações da página", query.data.pageViews],
              ["Cliques nos links e banners", query.data.clicks],
              ["Exibições visíveis dos banners", query.data.bannerViews],
            ].map(([title, value]) => (
              <Card key={String(title)}>
                <p className="text-xs text-muted-foreground">{title}</p>
                <p className="mt-2 text-2xl font-semibold tabular-nums">
                  {Number(value).toLocaleString("pt-BR")}
                </p>
              </Card>
            ))}
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Contagem agregada desde a implantação da medição; não identifica visitantes únicos ou
            vendas. Bloqueadores, expiração da sessão de medição e limite de repetições podem
            reduzir os números. Exibições dos banners são registradas quando ao menos metade da arte
            fica visível.
          </p>
          {!compact && query.data.campaigns.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border bg-card">
              <table className={tableCls}>
                <thead>
                  <tr>
                    <th>Campanha / canal</th>
                    <th>Exibições</th>
                    <th>Cliques</th>
                    <th>Solicitações</th>
                    <th>Contatos</th>
                    <th>Compartilhar</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.campaigns.map((campaign) => {
                    const url = `https://magmoveiscorporativos.com.br/links/?utm_campaign=${encodeURIComponent(campaign.slug)}&utm_source=${encodeURIComponent(campaign.channel || "campanha")}`;
                    return (
                      <tr key={campaign.id}>
                        <td>
                          <span className="block font-semibold">{campaign.name}</span>
                          {campaign.archived && (
                            <span className="mr-2 text-xs text-muted-foreground">Arquivada ·</span>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {campaign.channel} · {campaign.slug}
                          </span>
                        </td>
                        <td>{campaign.views}</td>
                        <td>{campaign.clicks}</td>
                        <td>{campaign.quoteRequests}</td>
                        <td>{campaign.contacts}</td>
                        <td>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              size="icon"
                              variant="outline"
                              aria-label={`Copiar link de ${campaign.name}`}
                              onClick={() => {
                                void navigator.clipboard.writeText(url).then(
                                  () => toast.success("Link da campanha copiado"),
                                  () => toast.error("Não foi possível copiar"),
                                );
                              }}
                            >
                              <Copy />
                            </Button>
                            <Button size="icon" variant="outline" asChild>
                              <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={`Abrir link de ${campaign.name}`}
                              >
                                <ExternalLink />
                              </a>
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            !compact && <Empty>As campanhas cadastradas e suas métricas aparecerão aqui.</Empty>
          )}
          {!compact && (
            <>
              <p className="text-xs text-muted-foreground">
                Solicitações e contatos usam o identificador utm_campaign recebido e gravado pelo
                formulário. O clique em WhatsApp não confirma atendimento nem venda. Links externos
                dependem de o visitante voltar ao formulário com o identificador preservado.
              </p>
              <div className="overflow-x-auto rounded-lg border bg-card">
                <table className={tableCls}>
                  <thead>
                    <tr>
                      <th>Destino</th>
                      <th>Tipo</th>
                      <th>Evento</th>
                      <th>Quantidade</th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data.entries.length ? (
                      query.data.entries.map((entry) => (
                        <tr key={`${entry.type}-${entry.id}-${entry.action}`}>
                          <td>{entry.title}</td>
                          <td>
                            {entry.type === "campaign"
                              ? "Banner"
                              : entry.type === "item"
                                ? "Link"
                                : "Página"}
                          </td>
                          <td>{entry.action === "click" ? "Clique" : "Visualização"}</td>
                          <td className="tabular-nums">{entry.count}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4}>Nenhum evento recebido neste período.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
