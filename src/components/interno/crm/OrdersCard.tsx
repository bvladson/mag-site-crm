import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getContactOrders } from "@/lib/crm-catalogo.functions";
import { atualizarStatusOmie } from "@/lib/orcamentos.functions";
import { quando } from "@/components/interno/produtos-compartilhado";

const ESTADO_PEDIDO = { enviando: "enviando ao Omie", incerto: "envio incerto (conferir no Omie)", criado: "criado no Omie", erro: "erro no envio" } as const;

/**
 * Pedidos do Omie do cliente na Ficha do Atendimento. Lista o que já está registrado; "Atualizar status" usa a mesma
 * consulta somente leitura da tela da negociação. Some quando o cliente ainda não tem negociação.
 */
export function OrdersCard({ contactId }: { contactId: string }) {
  const read = useServerFn(getContactOrders);
  const refresh = useServerFn(atualizarStatusOmie);
  const orders = useQuery({ queryKey: ["interno", "crm", "pedidos", contactId], queryFn: () => read({ data: { contactId } }) });
  const update = useMutation({
    mutationFn: (quoteId: string) => refresh({ data: { id: quoteId } }),
    onSuccess: () => orders.refetch(),
    onError: (error) => toast.error(error instanceof Error ? error.message : "Não foi possível consultar o Omie agora."),
  });
  const items = orders.data?.pedidos ?? [];
  if (orders.isLoading || !items.length) return null;
  const withOrder = items.filter((item) => item.pedido);
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pedidos no Omie ({withOrder.length})</p>
      {!withOrder.length && <p className="text-xs text-muted-foreground">Nenhuma negociação deste cliente virou pedido ainda.</p>}
      {withOrder.map((item) => {
        const p = item.pedido!;
        return (
          <div key={item.quoteId} className="space-y-1 rounded-xl border p-3 text-xs">
            <p className="flex flex-wrap items-baseline justify-between gap-1">
              <span className="font-medium">Pedido {p.numero ?? "sem número"}</span>
              <span className={p.estado === "criado" ? "text-success" : "font-semibold text-destructive"}>{ESTADO_PEDIDO[p.estado]}</span>
            </p>
            <p className="text-muted-foreground">
              Negociação {item.numeroNegociacao}
              {p.etapa ? ` · etapa: ${p.etapa}` : ""}
              {p.faturado ? " · faturado" : ""}
              {p.cancelado ? " · cancelado" : ""}
            </p>
            <p className="text-muted-foreground">Status consultado: {p.consultadoEm ? quando(p.consultadoEm, true) : "ainda não"}</p>
            {p.erro && <p className="text-destructive">{p.erro}</p>}
            <div className="flex flex-wrap gap-2 pt-1">
              {p.estado === "criado" && (
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={update.isPending} onClick={() => update.mutate(item.quoteId)}>
                  {update.isPending && update.variables === item.quoteId ? <Loader2 className="animate-spin" /> : <RefreshCw />} Atualizar status
                </Button>
              )}
              <a href={item.detailUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand underline">
                Abrir negociação <ExternalLink className="size-3" />
              </a>
            </div>
          </div>
        );
      })}
    </div>
  );
}
