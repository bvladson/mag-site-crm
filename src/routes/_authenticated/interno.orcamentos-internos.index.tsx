import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { listarOrcamentosInternos, criarOrcamentoInterno } from "@/lib/orcamentos.functions";
import { ESTADOS, ROTULO_ESTADO, reais, type Estado } from "@/lib/orcamento-regras";
import { Loading, ErrorState, Empty, PageTitle, fmtDate, tableCls } from "@/components/interno/ui";
import { SeloEstado, mensagemErro } from "@/components/interno/orcamento";
import { Button } from "@/components/ui/button";

/** Orçamentos internos (Admin vê todos; Comercial, os próprios). */
export const Route = createFileRoute("/_authenticated/interno/orcamentos-internos/")({
  component: ListaOrcamentos,
});

function ListaOrcamentos() {
  const listar = useServerFn(listarOrcamentosInternos);
  const criar = useServerFn(criarOrcamentoInterno);
  const navigate = useNavigate();
  const [estado, setEstado] = useState<Estado | "">("");
  const [texto, setTexto] = useState("");
  const [busca, setBusca] = useState("");
  const [criando, setCriando] = useState(false);
  const q = useQuery({
    queryKey: ["interno", "orcamentos-internos", estado, busca],
    queryFn: () => listar({ data: { status: estado || undefined, busca: busca || undefined } }),
  });
  const novo = async () => {
    setCriando(true);
    try {
      const r = await criar({ data: {} });
      navigate({ to: "/interno/orcamentos-internos/$id", params: { id: r.id } });
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setCriando(false);
    }
  };
  return (
    <>
      <PageTitle title="Negociações e propostas">
        <div className="flex flex-wrap gap-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setBusca(texto.trim());
            }}
          >
            <input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Número ou cliente"
              className="h-10 w-56 rounded-md border bg-card px-3 text-sm"
            />
          </form>
          <Button onClick={novo} disabled={criando}>
            <Plus /> Nova negociação
          </Button>
        </div>
      </PageTitle>
      <p className="mb-3 max-w-3xl text-sm text-muted-foreground">
        Monte o orçamento com os produtos do Omie e os preços combinados, gere a{" "}
        <b>proposta comercial</b> (PDF timbrado) e envie ao cliente. Depois de{" "}
        <b>aceito pelo cliente</b>, ele pode virar Pedido de Venda no Omie — sempre com revisão e
        confirmação. Pedidos do site viram orçamento pelo botão "Criar orçamento interno" na tela do
        pedido.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {(["", ...ESTADOS] as const).map((e) => (
          <button
            key={e || "todos"}
            type="button"
            onClick={() => setEstado(e)}
            aria-pressed={estado === e}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${estado === e ? "border-graphite bg-graphite text-graphite-foreground" : "bg-card hover:border-foreground/40"}`}
          >
            {e ? ROTULO_ESTADO[e] : "Todos"}
          </button>
        ))}
      </div>
      <div className="mt-4">
        {q.isLoading ? (
          <Loading />
        ) : q.isError ? (
          <ErrorState error={q.error} />
        ) : !q.data?.length ? (
          <Empty>
            {estado || busca
              ? "Nenhum orçamento para este filtro."
              : "Nenhum orçamento interno ainda."}
          </Empty>
        ) : (
          <div className="overflow-x-auto rounded-md border bg-card">
            <table className={tableCls}>
              <thead>
                <tr>
                  <th>Número</th>
                  <th>Cliente</th>
                  <th>Consultor</th>
                  <th>Proposta</th>
                  <th className="text-right">Total</th>
                  <th>Situação</th>
                  <th>Pedido Omie</th>
                  <th>Atualizado</th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link
                        to="/interno/orcamentos-internos/$id"
                        params={{ id: o.id }}
                        className="font-mono font-semibold text-brand"
                      >
                        {o.numero}
                      </Link>
                    </td>
                    <td>
                      {o.cliente || <span className="text-muted-foreground">(sem cliente)</span>}
                    </td>
                    <td className="text-muted-foreground">{o.dono ?? "-"}</td>
                    <td>
                      {o.proposta ? (
                        <span className="whitespace-nowrap rounded-md bg-surface px-2 py-1 text-xs">
                          v{o.proposta}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="text-right font-medium">{reais(o.totalCentavos)}</td>
                    <td>
                      <SeloEstado estado={o.estado} />
                      {o.proposta ? (
                        <span className="ml-1.5 whitespace-nowrap text-xs text-muted-foreground">
                          proposta v{o.proposta}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      {o.pedidoOmie ? (
                        <span className="font-mono">#{o.pedidoOmie}</span>
                      ) : o.envio === "incerto" ? (
                        <span className="text-destructive">verificar</span>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="whitespace-nowrap">{fmtDate(o.atualizadoEm)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
