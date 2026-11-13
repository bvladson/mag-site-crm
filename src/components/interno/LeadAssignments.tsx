import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getLeadDistribution,
  getAssignedLeads,
  setLeadDistribution,
  setLeadAssignment,
} from "@/lib/assignments.functions";
import { QUOTE_STATUS } from "@/lib/admin.functions";
import { Loading, ErrorState, Empty, Card, PageTitle, StatusBadge, fmtDate, tableCls } from "./ui";
import { Button } from "@/components/ui/button";

type Config = Awaited<ReturnType<typeof getLeadDistribution>>;
type Lead = Awaited<ReturnType<typeof getAssignedLeads>>[number];
const field = "h-9 max-w-full rounded-md border bg-card px-2 text-sm disabled:opacity-60";

export function LeadAssignments({ showRules = false }: { showRules?: boolean }) {
  const read = useServerFn(getAssignedLeads);
  const rule = useServerFn(getLeadDistribution);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const config = useQuery({ queryKey: ["interno", "lead-distribution"], queryFn: () => rule() });
  const list = useQuery({
    queryKey: ["interno", "assigned-leads", status, term],
    queryFn: () => read({ data: { status: status || undefined, search: term || undefined } }),
  });
  return (
    <>
      <PageTitle title={showRules ? "Atribuição de leads" : "Solicitações do site"}>
        <Link
          to={showRules ? "/interno/orcamentos" : "/interno/atribuicao"}
          className="inline-flex h-9 items-center rounded-md border bg-card px-3 text-sm"
        >
          {showRules ? "Ver solicitações" : "Atribuição e regras"}
        </Link>
      </PageTitle>
      <p className="mb-6 max-w-3xl text-sm text-muted-foreground">
        {showRules
          ? "Atendimento por unidade e consultor, com histórico de cada atribuição. Negociações já criadas mantêm seu responsável."
          : "Pedidos recebidos pelo site. Consulte os contatos e produtos antes de criar a negociação comercial."}
      </p>
      {config.isError ? (
        <ErrorState error={config.error} />
      ) : config.isLoading ? (
        <Loading />
      ) : (
        config.data &&
        showRules && <DistributionRule key={config.data.revision} config={config.data} />
      )}
      <form
        className="mb-4 mt-5 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setTerm(search.trim());
        }}
      >
        <input
          aria-label="Buscar solicitação"
          className={`${field} min-w-56 flex-1`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Protocolo, empresa, contato ou consultor"
        />
        <select
          aria-label="Situação da solicitação"
          className={field}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">Todas as situações</option>
          {QUOTE_STATUS.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <Button variant="outline" type="submit">
          Buscar
        </Button>
      </form>
      {list.isLoading ? (
        <Loading />
      ) : list.isError ? (
        <ErrorState error={list.error} />
      ) : !list.data?.length ? (
        <Empty>Nenhuma solicitação encontrada.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className={tableCls}>
            <thead>
              <tr>
                <th>Lead / recebido</th>
                <th>Empresa / contato</th>
                <th>Origem / itens</th>
                <th>Unidade e consultor</th>
                <th>Situação</th>
                <th>Negociação</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((lead) => (
                <tr key={lead.id}>
                  <td>
                    <Link
                      to="/interno/orcamentos/$id"
                      params={{ id: lead.id }}
                      className="font-mono font-medium text-brand"
                    >
                      {lead.protocol}
                    </Link>
                    <div className="mt-1 whitespace-nowrap text-xs text-muted-foreground">
                      {fmtDate(lead.createdAt)}
                    </div>
                  </td>
                  <td>
                    <div className="font-medium">{lead.company || lead.name}</div>
                    {lead.company && (
                      <div className="text-xs text-muted-foreground">{lead.name}</div>
                    )}
                  </td>
                  <td>
                    <div className="max-w-40 truncate text-xs" title={lead.origin}>
                      {lead.origin || "Site"}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {lead.itemCount} item(ns)
                    </div>
                  </td>
                  <td>
                    {showRules && config.data?.canEdit && !lead.negotiations ? (
                      <AssignmentRow
                        key={`${lead.id}:${lead.revision}`}
                        lead={lead}
                        config={config.data}
                      />
                    ) : (
                      <>
                        <div className="font-medium">
                          {lead.unitName || "Unidade não informada"}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {lead.ownerName || "Sem consultor atribuído"}
                        </div>
                      </>
                    )}
                  </td>
                  <td>
                    <StatusBadge s={lead.status} />
                  </td>
                  <td>
                    <Link
                      to="/interno/orcamentos/$id"
                      params={{ id: lead.id }}
                      className="text-sm font-medium text-brand hover:underline"
                    >
                      {lead.negotiations
                        ? `${lead.negotiations} vinculada(s) · abrir`
                        : "Abrir solicitação"}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function AssignmentRow({ lead, config }: { lead: Lead; config: Config }) {
  const [ownerId, setOwner] = useState(lead.ownerId || "");
  const [unitId, setUnit] = useState(lead.unitId || "");
  const [busy, setBusy] = useState(false);
  const save = useServerFn(setLeadAssignment);
  const qc = useQueryClient();
  const changed = ownerId !== (lead.ownerId || "") || unitId !== (lead.unitId || "");
  return (
    <div className="flex min-w-60 flex-col gap-2">
      <select
        aria-label={`Unidade de ${lead.protocol}`}
        className={field}
        value={unitId}
        onChange={(e) => setUnit(e.target.value)}
        disabled={busy}
      >
        <option value="">Unidade não informada</option>
        {config.units.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
      <select
        aria-label={`Consultor de ${lead.protocol}`}
        className={field}
        value={ownerId}
        onChange={(e) => setOwner(e.target.value)}
        disabled={busy}
      >
        <option value="">Sem consultor</option>
        {config.consultants.map((c) => (
          <option key={c.userId} value={c.userId}>
            {c.name}
          </option>
        ))}
      </select>
      <Button
        size="sm"
        variant="outline"
        disabled={!changed || busy}
        onClick={async () => {
          setBusy(true);
          try {
            await save({
              data: {
                leadId: lead.id,
                ownerId: ownerId || null,
                unitId: unitId || null,
                revision: lead.revision,
              },
            });
            toast.success("Atribuição salva");
            await qc.invalidateQueries({ queryKey: ["interno", "assigned-leads"] });
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Falha ao atribuir");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Salvando…" : "Salvar atribuição"}
      </Button>
    </div>
  );
}

function DistributionRule({ config }: { config: Config }) {
  const [mode, setMode] = useState(config.mode);
  const [consultants, setConsultants] = useState(config.consultants);
  const [busy, setBusy] = useState(false);
  const save = useServerFn(setLeadDistribution);
  const qc = useQueryClient();
  return (
    <Card title="Distribuição de novas solicitações">
      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <div className="space-y-3">
          {(
            [
              ["manual", "Manual", "Aguardam atribuição do administrador."],
              [
                "unidade",
                "Por unidade",
                "Sequência entre os consultores habilitados da unidade escolhida.",
              ],
              ["rodizio", "Rodízio geral", "Sequência entre todos os consultores habilitados."],
            ] as const
          ).map(([value, label, text]) => (
            <label className="flex gap-2 text-sm" key={value}>
              <input
                type="radio"
                name="distribution-mode"
                checked={mode === value}
                disabled={!config.canEdit || busy}
                onChange={() => setMode(value)}
              />
              <span>
                <b>{label}</b>
                <span className="mt-1 block text-xs text-muted-foreground">{text}</span>
              </span>
            </label>
          ))}
          <p className="text-xs text-muted-foreground">
            Vale para novos pedidos do formulário de orçamento. Sem unidade ou consultor elegível,
            fica pendente para atribuição manual. Pedidos anteriores não são redistribuídos.
          </p>
        </div>
        <div className="space-y-3">
          {consultants.map((c, i) => (
            <div key={c.userId} className="flex flex-wrap items-center gap-3 rounded-md border p-3">
              <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={c.enabled}
                  disabled={!config.canEdit || busy}
                  onChange={(e) =>
                    setConsultants(
                      consultants.map((v, k) =>
                        k === i ? { ...v, enabled: e.target.checked } : v,
                      ),
                    )
                  }
                />
                <span className="break-all">{c.name}</span>
              </label>
              <select
                className={field}
                value={c.unitId || ""}
                aria-label={`Unidade do consultor ${c.name}`}
                disabled={!config.canEdit || busy}
                onChange={(e) =>
                  setConsultants(
                    consultants.map((v, k) =>
                      k === i ? { ...v, unitId: e.target.value || null } : v,
                    ),
                  )
                }
              >
                <option value="">Sem unidade</option>
                {config.units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
          {config.canEdit && (
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await save({
                    data: {
                      mode,
                      revision: config.revision,
                      consultants: consultants.map(({ userId, unitId, enabled }) => ({
                        userId,
                        unitId,
                        enabled,
                      })),
                    },
                  });
                  toast.success("Regra de distribuição salva");
                  await qc.invalidateQueries({ queryKey: ["interno", "lead-distribution"] });
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Falha ao salvar regra");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Salvando…" : "Salvar regra"}
            </Button>
          )}
          {!config.canEdit && (
            <p className="text-xs text-muted-foreground">
              Somente administradores alteram regras e responsáveis.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
