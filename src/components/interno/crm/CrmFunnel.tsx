import { useState } from "react";
import { Inbox, Plus, Search, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { STAGES, ORIGINS, type Opportunity, type Stage } from "@/lib/crm";
import { cn } from "@/lib/utils";
import { latestValue, useCrm } from "./CrmProvider";
import { EmptyState, PageHeader, Pill } from "./bits";
import { OpportunityCard } from "./OpportunityCard";
import { money, normalize } from "./format";

export function CrmFunnel() {
  const { opportunities, contact, proposals, requestMove, open, busy, owners, units, canManage } =
    useCrm();
  const [tab, setTab] = useState<"andamento" | "perdidos">("andamento");
  const [query, setQuery] = useState("");
  const [over, setOver] = useState<Stage | null>(null);
  const [owner, setOwner] = useState("");
  const [unit, setUnit] = useState("");
  const [origin, setOrigin] = useState("");
  const match = (item: Opportunity) => {
    const customer = contact(item.contactId);
    return (
      (!query ||
        normalize(
          `${customer?.name ?? ""} ${customer?.company ?? ""} ${customer?.phone ?? ""} ${item.title} ${item.interest}`,
        ).includes(normalize(query))) &&
      (!owner || item.ownerId === owner) &&
      (!unit || item.unitId === unit) &&
      (!origin || item.origin === origin)
    );
  };
  const filtered = opportunities.filter(match);
  const lost = filtered.filter((item) => item.stage === "perdido");
  return (
    <div className="flex flex-col gap-5 px-4 py-6 md:px-7 md:py-8">
      <PageHeader
        title="Meu funil"
        subtitle="Arraste os cartões ou use o menu ⋯ para acompanhar as negociações."
        actions={
          <Button onClick={() => open({ kind: "newOpportunity" })}>
            <Plus />
            Nova oportunidade
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border bg-card p-1">
          {(
            [
              ["andamento", "Em andamento"],
              [
                "perdidos",
                `Não fechou (${opportunities.filter((item) => item.stage === "perdido").length})`,
              ],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className="crm-tab"
              aria-pressed={tab === value}
              onClick={() => setTab(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative min-w-56 flex-1 sm:ml-auto sm:max-w-80">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Buscar oportunidades"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Nome, telefone ou interesse"
            className="pl-9"
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {canManage && (
          <select
            aria-label="Responsável no funil"
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
            className="h-9 max-w-full rounded-md border bg-card px-2 text-sm"
          >
            <option value="">Todos os responsáveis</option>
            {owners.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        )}
        <select
          aria-label="Unidade no funil"
          value={unit}
          onChange={(event) => setUnit(event.target.value)}
          className="h-9 max-w-full rounded-md border bg-card px-2 text-sm"
        >
          <option value="">Todas as unidades</option>
          {units.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Origem no funil"
          value={origin}
          onChange={(event) => setOrigin(event.target.value)}
          className="h-9 max-w-full rounded-md border bg-card px-2 text-sm"
        >
          <option value="">Todas as origens</option>
          {ORIGINS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>
      {tab === "andamento" ? (
        <div className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-4 md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 2xl:grid-cols-4">
          {STAGES.map((stage) => {
            const items = filtered.filter((item) => item.stage === stage.id);
            const total = items.reduce(
              (sum, item) =>
                sum + (latestValue(proposals, item.id) ?? item.estimatedValueCents / 100),
              0,
            );
            return (
              <section
                key={stage.id}
                data-crm-stage={stage.id}
                aria-label={stage.label}
                onDragOver={(event) => {
                  if (!busy) {
                    event.preventDefault();
                    setOver(stage.id);
                  }
                }}
                onDragLeave={() => setOver((value) => (value === stage.id ? null : value))}
                onDrop={(event) => {
                  event.preventDefault();
                  setOver(null);
                  void requestMove(event.dataTransfer.getData("text/plain"), stage.id).catch(
                    () => {},
                  );
                }}
                className={cn(
                  "flex w-[78vw] shrink-0 snap-start flex-col rounded-2xl border bg-surface p-3 transition-colors sm:w-80 md:w-auto",
                  over === stage.id && "border-primary",
                )}
              >
                <header className="mb-3 px-1">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="font-semibold">{stage.label}</h2>
                    <Pill className="bg-card text-foreground">{items.length}</Pill>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {total > 0 ? `${money(total)} em propostas e estimativas` : stage.hint}
                  </p>
                </header>
                <div className="flex min-h-28 flex-col gap-3">
                  {items.length ? (
                    items.map((item) => <OpportunityCard key={item.id} opp={item} draggable />)
                  ) : (
                    <div className="grid flex-1 place-items-center rounded-xl border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
                      {query || owner || unit || origin
                        ? "Nenhuma oportunidade para estes filtros."
                        : "Nenhuma oportunidade nesta etapa."}
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      ) : lost.length ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {lost.map((item) => (
            <div key={item.id} className="space-y-2">
              <Pill className="bg-muted text-muted-foreground">
                <XCircle className="size-3" />
                Motivo: {item.lossReason ?? "—"}
              </Pill>
              <OpportunityCard opp={item} />
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Inbox}
          title="Nenhuma perda neste filtro"
          text="Registre o motivo quando uma negociação não fechar. Você poderá reabrir a oportunidade pelo menu."
        />
      )}
    </div>
  );
}
