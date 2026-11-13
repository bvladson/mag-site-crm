import { useState } from "react";
import { FileText, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import type { ProposalStatus } from "@/lib/crm";
import { cn } from "@/lib/utils";
import { useCrm } from "./CrmProvider";
import { EmptyState, PageHeader, ProposalBadge } from "./bits";
import { fullDate, money } from "./format";
const FILTERS: ("Todas" | ProposalStatus)[] = [
  "Todas",
  "Rascunho",
  "Enviada",
  "Aceita",
  "Recusada",
  "Cancelada",
];
export function CrmProposals() {
  const { proposals, contact, opportunity, open } = useCrm();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("Todas");
  const list = proposals
    .filter((item) => filter === "Todas" || item.status === filter)
    .sort((a, b) => b.date.localeCompare(a.date));
  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 md:px-7 md:py-8">
      <PageHeader
        title="Propostas"
        subtitle="Negociações reais do gerencial, com suas versões e condições comerciais."
        actions={
          <Button asChild variant="outline">
            <Link to="/interno/orcamentos-internos">
              <FileText />
              Abrir negociações
            </Link>
          </Button>
        }
      />
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((item) => (
          <button
            type="button"
            key={item}
            aria-pressed={filter === item}
            onClick={() => setFilter(item)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm font-medium",
              filter === item ? "crm-brand border-primary" : "bg-card hover:bg-accent",
            )}
          >
            {item}
          </button>
        ))}
      </div>
      {list.length ? (
        <ul className="crm-card divide-y overflow-hidden rounded-xl border bg-card">
          {list.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => open({ kind: "proposal", id: item.id })}
                className="flex w-full flex-wrap items-center gap-3 px-4 py-3.5 text-left hover:bg-accent"
              >
                <FileText className="size-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {item.number}
                    {item.version && (
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                        · v{item.version}
                      </span>
                    )}
                  </p>
                  <p className="truncate text-sm text-muted-foreground">
                    {contact(item.contactId)?.name || item.customerName || "Cliente não informado"}
                    {item.opportunityId &&
                      ` · ${opportunity(item.opportunityId)?.title ?? "Oportunidade"}`}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">{fullDate(item.date)}</span>
                <span className="min-w-24 text-right font-semibold tabular-nums">
                  {money(item.value)}
                </span>
                <ProposalBadge status={item.status} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={FileText}
          title="Nenhuma proposta neste filtro"
          text="Crie uma negociação a partir de uma oportunidade ou consulte as negociações existentes."
          action={
            <Button variant="outline" onClick={() => open({ kind: "newOpportunity" })}>
              <Plus />
              Nova oportunidade
            </Button>
          }
        />
      )}
    </div>
  );
}
