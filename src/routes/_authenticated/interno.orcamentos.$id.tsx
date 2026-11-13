import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getQuote, updateQuote, QUOTE_STATUS } from "@/lib/admin.functions";
import { criarOrcamentoInterno } from "@/lib/orcamentos.functions";
import { getLeadAssignment } from "@/lib/assignments.functions";
import { mensagemErro } from "@/components/interno/orcamento";
import { Button } from "@/components/ui/button";
import {
  Loading,
  ErrorState,
  Card,
  Rows,
  StatusEditor,
  StatusBadge,
  fmtDate,
} from "@/components/interno/ui";

export const Route = createFileRoute("/_authenticated/interno/orcamentos/$id")({
  component: QuoteDetail,
});

function QuoteDetail() {
  const { id } = Route.useParams();
  const fn = useServerFn(getQuote);
  const save = useServerFn(updateQuote);
  const criarInterno = useServerFn(criarOrcamentoInterno);
  const assignmentFn = useServerFn(getLeadAssignment);
  const assignment = useQuery({
    queryKey: ["interno", "lead-assignment", id],
    queryFn: () => assignmentFn({ data: { leadId: id } }),
  });
  const navigate = useNavigate();
  const [criando, setCriando] = useState(false);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["interno", "quote", id], queryFn: () => fn({ data: { id } }) });
  if (q.isLoading) return <Loading />;
  if (q.isError || !q.data) return <ErrorState error={q.error} />;
  const r = q.data;
  const utm = (r["utm"] ?? {}) as Record<string, string>;
  const items = (r["quote_request_items"] ?? []) as {
    id: string;
    name: string;
    sku: string;
    qty: number;
    slug: string;
  }[];
  return (
    <>
      <Link to="/interno/orcamentos" className="text-sm text-muted-foreground">
        ← Solicitações do site
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-semibold">
          Solicitação <span className="font-mono">{r["protocolo"]}</span>
        </h1>
        <StatusBadge s={r["status"]} />
      </div>
      <p className="text-sm text-muted-foreground">
        Recebido em {fmtDate(r["created_at"])}
        {r["updated_at"] !== r["created_at"] ? ` · atualizado ${fmtDate(r["updated_at"])}` : ""}
      </p>
      <div className="mt-6 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5">
          <Card title="Cliente">
            <Rows
              rows={[
                ["Nome", r["nome"]],
                ["Empresa", r["empresa"]],
                ["CNPJ", r["cnpj"]],
                [
                  "WhatsApp",
                  r["whatsapp"] && (
                    <a
                      className="underline"
                      href={`https://wa.me/55${String(r["whatsapp"]).replace(/\D/g, "")}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {r["whatsapp"]}
                    </a>
                  ),
                ],
                [
                  "E-mail",
                  r["email"] && (
                    <a className="underline" href={`mailto:${r["email"]}`}>
                      {r["email"]}
                    </a>
                  ),
                ],
                ["Cidade/UF", `${r["cidade"]}/${r["estado"]}`],
              ]}
            />
          </Card>
          <Card title="Itens">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-2">Produto</th>
                  <th>SKU</th>
                  <th className="text-right">Qtd</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} className="border-t">
                    <td className="py-2.5">{i.name}</td>
                    <td className="font-mono text-xs">{i.sku}</td>
                    <td className="text-right font-semibold">{i.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card title="Mensagem">
            <p className="whitespace-pre-wrap text-sm">{r["mensagem"] || "-"}</p>
          </Card>
          <Card title="Origem">
            <Rows
              rows={[
                ["URL", r["origem"]],
                ["UTM Source", utm["utm_source"]],
                ["UTM Medium", utm["utm_medium"]],
                ["UTM Campaign", utm["utm_campaign"]],
                ["UTM Term", utm["utm_term"]],
                ["UTM Content", utm["utm_content"]],
              ]}
            />
          </Card>
        </div>
        <div className="space-y-5">
          <Card title="Atendimento">
            <Rows
              rows={[
                ["Unidade", assignment.data?.unitName || "Não informada"],
                ["Consultor", assignment.data?.ownerName || "Sem atribuição"],
              ]}
            />
            <Link
              to="/interno/atribuicao"
              className="mt-3 inline-block text-sm text-brand hover:underline"
            >
              Ver atribuições
            </Link>
          </Card>
          <Card title="Orçamento interno">
            <p className="mb-3 text-sm text-muted-foreground">
              Monta o orçamento com preços a partir deste pedido (cliente e itens copiados). O
              pedido do site continua como está.
            </p>
            {assignment.data?.negotiations.map((n) =>
              n.canOpen ? (
                <Link
                  key={n.id}
                  to="/interno/orcamentos-internos/$id"
                  params={{ id: n.id }}
                  className="mb-3 block font-mono text-sm text-brand hover:underline"
                >
                  Abrir {n.number}
                </Link>
              ) : (
                <p key={n.id} className="mb-3 text-xs text-muted-foreground">
                  Negociação {n.number} vinculada a outro consultor.
                </p>
              ),
            )}
            <Button
              className="w-full"
              disabled={criando || !assignment.data?.canConvert}
              onClick={async () => {
                setCriando(true);
                try {
                  const novo = await criarInterno({ data: { pedidoSiteId: id } });
                  toast.success(`Orçamento ${novo.numero} criado`);
                  navigate({ to: "/interno/orcamentos-internos/$id", params: { id: novo.id } });
                } catch (e) {
                  toast.error(mensagemErro(e));
                } finally {
                  setCriando(false);
                }
              }}
            >
              {assignment.data?.negotiations.length
                ? "Abrir negociação existente"
                : "Criar negociação"}
            </Button>
            {assignment.data && !assignment.data.canConvert && (
              <p className="mt-2 text-xs text-muted-foreground">
                A conversão é feita pelo consultor atribuído ou pelo administrador.
              </p>
            )}
          </Card>
          <StatusEditor
            status={r["status"]}
            notes={r["internal_notes"]}
            options={QUOTE_STATUS}
            onSave={async (status, internal_notes) => {
              await save({ data: { id, status, internal_notes } });
              await qc.invalidateQueries({ queryKey: ["interno"] });
            }}
          />
        </div>
      </div>
    </>
  );
}
