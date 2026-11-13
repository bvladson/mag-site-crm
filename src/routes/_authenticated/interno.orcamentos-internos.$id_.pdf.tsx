import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Eye, FileDown, Printer } from "lucide-react";
import { lerOrcamentoInterno } from "@/lib/orcamentos.functions";
import { Button } from "@/components/ui/button";
import { Loading, ErrorState, PageTitle } from "@/components/interno/ui";
import { reais } from "@/lib/orcamento-regras";

export const Route = createFileRoute("/_authenticated/interno/orcamentos-internos/$id_/pdf")({
  validateSearch: (search: Record<string, unknown>) => ({
    v:
      Number.isInteger(Number(search["v"])) && Number(search["v"]) > 0
        ? Number(search["v"])
        : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Prévia da proposta — Painel MAG" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Preview,
});
function Preview() {
  const { id } = Route.useParams();
  const { v } = Route.useSearch();
  const read = useServerFn(lerOrcamentoInterno);
  const query = useQuery({
    queryKey: ["interno", "orcamento-interno", id],
    queryFn: () => read({ data: { id } }),
  });
  if (query.isLoading) return <Loading />;
  if (query.isError || !query.data) return <ErrorState error={query.error} />;
  const data = query.data;
  const version = v ?? data.propostas.vigente;
  const proposal = data.propostas.versoes.find((p) => p.versao === version);
  if (!proposal)
    return (
      <ErrorState
        error={
          new Error(
            "Versão da proposta não encontrada. Gere uma proposta na negociação antes de abrir a prévia.",
          )
        }
      />
    );
  const url = `/api/interno/orcamentos-internos/${id}/proposta/${proposal.versao}`;
  return (
    <>
      <Link
        to="/interno/orcamentos-internos/$id"
        params={{ id }}
        className="mb-3 inline-block text-sm text-muted-foreground hover:text-primary"
      >
        ← Voltar à negociação
      </Link>
      <PageTitle title="Prévia da proposta">
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <a href={`${url}?modo=baixar`} download={proposal.arquivo}>
              <FileDown />
              Baixar PDF
            </a>
          </Button>
          <Button asChild variant="outline">
            <a href={`${url}?modo=visualizar`} target="_blank" rel="noopener">
              <Eye />
              Abrir PDF
            </a>
          </Button>
          {proposal.vigente && (
            <Button
              onClick={() => {
                window.open(`${url}?modo=imprimir`, "_blank", "noopener");
              }}
            >
              <Printer />
              Abrir para imprimir
            </Button>
          )}
        </div>
      </PageTitle>
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm">
        <b className="font-mono">
          {data.orcamento.numero} · v{proposal.versao}
        </b>
        <span>{reais(proposal.totalCentavos)}</span>
        <span className="text-muted-foreground">
          {proposal.vigente ? "Versão vigente" : "Versão do histórico"} · documento da versão
          gravada
        </span>
      </div>
      {(data.propostas.alterado || data.propostas.pedidoAlterado) && proposal.vigente && (
        <p className="mb-4 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900">
          A negociação foi alterada após esta versão. A prévia e o arquivo mostram a versão gravada;
          gere uma nova proposta para incorporar as alterações.
        </p>
      )}
      <div className="rounded-lg border bg-muted p-2 sm:p-4">
        <iframe
          title={`Proposta ${data.orcamento.numero} versão ${proposal.versao}`}
          src={`${url}?modo=visualizar`}
          className="h-[75vh] min-h-[480px] w-full rounded-md border-0 bg-white"
        />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        A prévia usa o mesmo PDF disponível para download. No celular, utilize “Abrir PDF” se o
        navegador não exibir o documento.
      </p>
    </>
  );
}
