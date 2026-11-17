import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  Eye,
  Inbox,
  KanbanSquare,
  List,
  Lock,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  SlidersHorizontal,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ORIGINS, type Opportunity } from "@/lib/crm";
import { getFunilAsSeller } from "@/lib/crm-funil.functions";
import {
  daysInStage,
  funnelMetrics,
  isStale,
  knownValueCents,
  overWip,
  type PipelineStage,
} from "@/lib/crm-pipelines";
import { cn } from "@/lib/utils";
import { useCrm } from "./CrmProvider";
import { AwaitingDot, EmptyState, NextActionLine, PageHeader, Pill } from "./bits";
import { DaysInStage, OppStageBadge, StageDot, useFunil, useIsNarrow, useStoredState } from "./funil-ui";
import { FunilAdminDialog, useFunilAdmin } from "./FunilAdmin";
import { FunilVisao360 } from "./FunilVisao360";
import { MoveMenu, OpportunityCard } from "./OpportunityCard";
import { money, normalize } from "./format";

type Tab = "andamento" | "perdidos" | "visao";
type View = "board" | "list";
const byPosition = (a: Opportunity, b: Opportunity) =>
  (a.position ?? 0) - (b.position ?? 0) || b.lastInteraction.localeCompare(a.lastInteraction);

export function CrmFunnel() {
  const { opportunities, contact, proposals, open, busy, units, canManage, requestMoveStage } = useCrm();
  const { pipelines, defaultPipelineId } = useFunil();
  const narrow = useIsNarrow();
  const [storedPipeline, setStoredPipeline] = useStoredState<string>("mag-crm-funil-ativo", "");
  const [viewChoice, setViewChoice] = useStoredState<"" | View>("mag-crm-funil-vista", "", ["", "board", "list"]);
  const [density, setDensity] = useStoredState<"compact" | "comfortable">("mag-crm-funil-densidade", "compact", [
    "compact",
    "comfortable",
  ]);
  const view: View = viewChoice || (narrow ? "list" : "board");
  const admin = useFunilAdmin(canManage);
  const sellers = admin.data?.sellers ?? [];
  const [viewAs, setViewAs] = useState("");
  const loadAs = useServerFn(getFunilAsSeller);
  const asSeller = useQuery({
    queryKey: ["interno", "crm", "funil-como", viewAs],
    queryFn: () => loadAs({ data: { userId: viewAs } }),
    enabled: canManage && Boolean(viewAs),
    staleTime: 10_000,
  });
  const readOnly = Boolean(viewAs);
  const scopePipelines = readOnly ? pipelines.filter((item) => asSeller.data?.pipelineIds.includes(item.id)) : pipelines;
  const preferred = readOnly ? asSeller.data?.defaultPipelineId : defaultPipelineId;
  const pipeline =
    scopePipelines.find((item) => item.id === storedPipeline) ??
    scopePipelines.find((item) => item.id === preferred) ??
    scopePipelines[0];
  const [tab, setTab] = useState<Tab>("andamento");
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("");
  const [unit, setUnit] = useState("");
  const [origin, setOrigin] = useState("");
  const [awaiting, setAwaiting] = useState(false);
  const [minValue, setMinValue] = useState("");
  const [maxValue, setMaxValue] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [over, setOver] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const now = Date.now();
  const valueOf = (item: Opportunity) => knownValueCents(item, proposals);
  const visibleIds = readOnly ? new Set(asSeller.data?.opportunityIds ?? []) : null;
  const inPipeline = pipeline
    ? opportunities.filter((item) => item.pipelineId === pipeline.id && (!visibleIds || visibleIds.has(item.id)))
    : [];
  const cents = (value: string) => (value.trim() ? Math.round(Number(value.replace(",", ".")) * 100) : null);
  const min = cents(minValue);
  const max = cents(maxValue);
  const showOwner = canManage && !readOnly;
  const match = (item: Opportunity) => {
    const customer = contact(item.contactId);
    const value = valueOf(item);
    return (
      (!query ||
        normalize(`${customer?.name ?? ""} ${customer?.company ?? ""} ${customer?.phone ?? ""} ${item.title} ${item.interest}`).includes(
          normalize(query),
        )) &&
      (!showOwner || !owner || item.ownerId === owner) &&
      (!unit || item.unitId === unit) &&
      (!origin || item.origin === origin) &&
      (!awaiting || item.awaitingReply) &&
      (min === null || !Number.isFinite(min) || (value ?? 0) >= min) &&
      (max === null || !Number.isFinite(max) || (value ?? 0) <= max)
    );
  };
  const filtered = inPipeline.filter(match);
  const lostIds = new Set(pipeline?.stages.filter((stage) => stage.kind === "lost").map((stage) => stage.id) ?? []);
  const lost = filtered.filter((item) => lostIds.has(item.stageId ?? "")).sort(byPosition);
  const active = filtered.filter((item) => !lostIds.has(item.stageId ?? ""));
  const columns = pipeline?.stages.filter((stage) => stage.kind !== "lost") ?? [];
  const metrics = pipeline
    ? funnelMetrics(
        pipeline,
        filtered.map((item) => ({
          stageId: item.stageId ?? null,
          valueCents: valueOf(item),
          stageEnteredAt: item.stageEnteredAt ?? null,
          createdAt: item.createdAt,
        })),
        now,
      )
    : null;
  const filterCount =
    Number(Boolean(showOwner && owner)) +
    Number(Boolean(unit)) +
    Number(Boolean(origin)) +
    Number(awaiting) +
    Number(min !== null) +
    Number(max !== null);
  const hasFilters = Boolean(query) || filterCount > 0;
  const lostStage = pipeline?.stages.find((stage) => stage.kind === "lost");
  const tabs: [Tab, string][] = [
    ["andamento", "Em andamento"],
    ["perdidos", `${lostStage?.label ?? "Não fechou"} (${inPipeline.filter((item) => lostIds.has(item.stageId ?? "")).length})`],
    ...(canManage && !readOnly ? ([["visao", "Visão 360°"]] as [Tab, string][]) : []),
  ];
  const listItems = (tab === "perdidos" ? lost : active.sort(byPosition)).filter(
    (item) => !stageFilter || item.stageId === stageFilter,
  );
  const chipStages = tab === "perdidos" ? (lostStage ? [lostStage] : []) : columns;
  const choosePipeline = (id: string) => {
    setStoredPipeline(id);
    setStageFilter("");
  };

  const filterFields = (
    <div className="grid gap-4">
      {showOwner && (
        <div className="space-y-1.5">
          <Label htmlFor="funil-owner">Responsável</Label>
          <select
            id="funil-owner"
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
            className="h-11 w-full rounded-md border bg-card px-2 text-sm sm:h-9"
          >
            <option value="">Todos</option>
            {sellers.map((item) => (
              <option key={item.userId} value={item.userId}>
                {item.name}
                {item.active ? "" : " (inativo)"}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="funil-unit">Unidade</Label>
        <select
          id="funil-unit"
          value={unit}
          onChange={(event) => setUnit(event.target.value)}
          className="h-11 w-full rounded-md border bg-card px-2 text-sm sm:h-9"
        >
          <option value="">Todas</option>
          {units.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="funil-origin">Origem</Label>
        <select
          id="funil-origin"
          value={origin}
          onChange={(event) => setOrigin(event.target.value)}
          className="h-11 w-full rounded-md border bg-card px-2 text-sm sm:h-9"
        >
          <option value="">Todas</option>
          {ORIGINS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="funil-min">Valor mínimo (R$)</Label>
          <Input id="funil-min" inputMode="decimal" type="number" min="0" value={minValue} onChange={(event) => setMinValue(event.target.value)} className="h-11 sm:h-9" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="funil-max">Valor máximo (R$)</Label>
          <Input id="funil-max" inputMode="decimal" type="number" min="0" value={maxValue} onChange={(event) => setMaxValue(event.target.value)} className="h-11 sm:h-9" />
        </div>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-0">
        <input type="checkbox" checked={awaiting} onChange={(event) => setAwaiting(event.target.checked)} />
        Só os que aguardam resposta
      </label>
      {filterCount > 0 && (
        <Button
          variant="ghost"
          className="h-11 justify-start sm:h-9"
          onClick={() => {
            setOwner("");
            setUnit("");
            setOrigin("");
            setAwaiting(false);
            setMinValue("");
            setMaxValue("");
          }}
        >
          Limpar filtros
        </Button>
      )}
    </div>
  );

  return (
    <div data-funil={pipeline?.id ?? ""} className="flex min-w-0 flex-col gap-2 px-3 py-3 sm:gap-4 sm:px-4 sm:py-6 md:px-7 md:py-8">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:hidden">
        <h1 className="min-w-0 truncate text-lg font-semibold">Meu funil</h1>
        <div className="flex shrink-0 items-center gap-1">
          {canManage && (
            <Button variant="outline" size="icon" className="size-11" aria-label="Administração do funil" onClick={() => setAdminOpen(true)}>
              <Settings2 />
            </Button>
          )}
          <Button className="h-11 px-3" disabled={readOnly || !pipeline} onClick={() => open({ kind: "newOpportunity" })}>
            <Plus />
            Nova
          </Button>
        </div>
      </header>
      <div className="hidden sm:block">
        <PageHeader
          title="Meu funil"
          subtitle="Arraste os cartões ou use o menu ⋯ para mover. Cada vendedor vê só os próprios negócios."
          actions={
            <>
              {canManage && (
                <Button variant="outline" onClick={() => setAdminOpen(true)}>
                  <Settings2 />
                  Administração do funil
                </Button>
              )}
              <Button disabled={readOnly || !pipeline} onClick={() => open({ kind: "newOpportunity" })}>
                <Plus />
                Nova oportunidade
              </Button>
            </>
          }
        />
      </div>

      {canManage && (
        <div className="crm-warning grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1 rounded-xl border px-3 py-2 text-sm sm:flex sm:flex-wrap">
          <Eye className="size-4 shrink-0" />
          <label className="contents sm:flex sm:items-center sm:gap-2">
            <span className="font-medium">Visualizar como</span>
            <select
              aria-label="Visualizar como"
              value={viewAs}
              onChange={(event) => {
                setViewAs(event.target.value);
                setOwner("");
                setStageFilter("");
                if (tab === "visao") setTab("andamento");
              }}
              className="col-span-2 h-11 min-w-0 rounded-md border bg-card px-2 text-sm text-foreground sm:col-span-1 sm:h-9"
            >
              <option value="">Administrador (todos os negócios)</option>
              {sellers.map((item) => (
                <option key={item.userId} value={item.userId}>
                  {item.name}
                  {item.active ? "" : " (inativo)"}
                </option>
              ))}
            </select>
          </label>
          {readOnly && (
            <span className="col-span-2 text-xs sm:ml-auto">
              Só leitura: o recorte que esta pessoa vê, calculado no servidor.
            </span>
          )}
        </div>
      )}

      {readOnly && asSeller.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando o recorte…</p>
      ) : !pipeline ? (
        <EmptyState
          icon={Lock}
          title={readOnly ? "Esta pessoa não tem funil liberado" : "Nenhum funil liberado"}
          text="Peça ao administrador para liberar um funil. Quando ele liberar, o funil aparece aqui."
        />
      ) : (
        <>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:flex sm:flex-wrap sm:gap-3 sm:rounded-xl sm:border sm:bg-card sm:p-3">
            <label className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 text-sm sm:flex">
              <span className="hidden text-muted-foreground sm:inline">Funil</span>
              <select
                aria-label="Funil"
                value={pipeline.id}
                onChange={(event) => choosePipeline(event.target.value)}
                className="col-span-2 h-11 w-full min-w-0 rounded-md border bg-card px-2 text-sm font-medium sm:col-span-1 sm:h-9 sm:w-auto"
              >
                {scopePipelines.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="ghost"
              className="h-11 px-2 text-xs sm:hidden"
              aria-expanded={summaryOpen}
              onClick={() => setSummaryOpen(!summaryOpen)}
            >
              Resumo
            </Button>
            {metrics && (
              <div
                className={cn(
                  "col-span-2 grid-cols-2 gap-y-1 rounded-md border bg-card py-1.5 text-sm sm:ml-auto sm:flex sm:gap-5 sm:border-0 sm:py-0",
                  summaryOpen ? "grid" : "hidden",
                )}
              >
                <span className="min-w-0 px-3 sm:px-0">
                  <span className="block text-xs text-muted-foreground sm:inline sm:text-sm">Em aberto </span>
                  <strong className="block tabular-nums sm:inline">{money(metrics.openCents / 100)}</strong>
                </span>
                <span className="min-w-0 px-3 sm:px-0" title="Valor conhecido × chance de fechar de cada etapa">
                  <span className="block text-xs text-muted-foreground sm:inline sm:text-sm">Previsão </span>
                  <strong className="block tabular-nums sm:inline">{money(metrics.weightedCents / 100)}</strong>
                </span>
                <span className="min-w-0 px-3 sm:px-0">
                  <span className="block text-xs text-muted-foreground sm:inline sm:text-sm">Parados </span>
                  <strong className={cn("block tabular-nums sm:inline", metrics.stale > 0 && "text-destructive")}>{metrics.stale}</strong>
                </span>
                <span className="min-w-0 px-3 sm:px-0">
                  <span className="block text-xs text-muted-foreground sm:inline sm:text-sm">Ganhos </span>
                  <strong className="block tabular-nums sm:inline">{money(metrics.wonCents / 100)}</strong>
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex min-w-0 rounded-lg border bg-card p-1 sm:inline-flex">
              {tabs.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className="crm-tab min-h-11 min-w-0 flex-1 truncate text-xs sm:min-h-0 sm:flex-none sm:text-sm"
                  aria-pressed={tab === value}
                  onClick={() => {
                    setTab(value);
                    setStageFilter("");
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {tab !== "visao" && (
              <div className="flex min-w-0 flex-1 items-center gap-2 sm:justify-end">
                <div className="relative min-w-0 flex-1 sm:max-w-80">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    aria-label="Buscar negócios"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Nome, telefone ou interesse"
                    className="h-11 pl-9 sm:h-9"
                  />
                </div>
                <Button variant="outline" className="h-11 shrink-0 gap-1 px-3 sm:h-9" onClick={() => setFiltersOpen(true)} aria-label="Filtros">
                  <SlidersHorizontal />
                  <span className="hidden sm:inline">Filtros</span>
                  {filterCount > 0 && <Pill className="crm-brand">{filterCount}</Pill>}
                </Button>
              </div>
            )}
          </div>

          {tab !== "visao" && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {(tab === "perdidos" ? lost : active).length} negócio(s)
                {!canManage || readOnly ? " · carteira individual" : ""}
                {view === "list" && (
                  <button
                    type="button"
                    className="ml-2 min-h-11 underline-offset-2 hover:underline sm:min-h-0"
                    onClick={() => setDensity(density === "compact" ? "comfortable" : "compact")}
                  >
                    {density === "compact" ? "Compacto" : "Confortável"}
                  </button>
                )}
              </span>
              <div className="flex shrink-0 rounded-md border bg-card p-0.5" role="group" aria-label="Visualização do funil">
                <button
                  type="button"
                  className="crm-tab inline-flex min-h-11 items-center gap-1 sm:min-h-0"
                  aria-pressed={view === "list"}
                  onClick={() => setViewChoice("list")}
                >
                  <List className="size-4" />
                  Lista
                </button>
                <button
                  type="button"
                  className="crm-tab inline-flex min-h-11 items-center gap-1 sm:min-h-0"
                  aria-pressed={view === "board"}
                  onClick={() => setViewChoice("board")}
                >
                  <KanbanSquare className="size-4" />
                  Quadro
                </button>
              </div>
            </div>
          )}

          {tab !== "visao" && view === "list" && (
            <div className="min-w-0 overflow-x-auto overscroll-x-contain" aria-label="Etapas do funil">
              <div className="flex w-max gap-2 pb-1">
                {[{ id: "", label: "Todas", color: "muted" as const }, ...chipStages].map((stage) => {
                  const pool = tab === "perdidos" ? lost : active;
                  const total = pool.filter((item) => !stage.id || item.stageId === stage.id).length;
                  return (
                    <button
                      type="button"
                      key={stage.id || "todas"}
                      aria-pressed={stageFilter === stage.id}
                      onClick={() => setStageFilter(stage.id)}
                      className={cn(
                        "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border bg-card px-3 text-xs sm:min-h-9 sm:text-sm",
                        stageFilter === stage.id && "crm-brand border-primary",
                      )}
                    >
                      {stage.id && <StageDot color={stage.color} />}
                      {stage.label}
                      <span className="tabular-nums opacity-70">{total}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {tab === "visao" && canManage && !readOnly ? (
            <FunilVisao360 onAdmin={() => setAdminOpen(true)} />
          ) : view === "list" ? (
            <FunnelList
              items={listItems}
              density={density}
              readOnly={readOnly}
              showOwner={showOwner}
              valueOf={valueOf}
              emptyText={hasFilters ? "Nenhum negócio com estes filtros." : "Nenhum negócio aqui."}
            />
          ) : tab === "andamento" ? (
            <div className="-mx-3 flex min-w-0 snap-x gap-3 overflow-x-auto px-3 pb-4 sm:-mx-4 sm:px-4 md:mx-0 md:px-0" aria-label="Quadro de negócios">
              {columns.map((stage) => (
                <BoardColumn
                  key={stage.id}
                  stage={stage}
                  items={active.filter((item) => item.stageId === stage.id).sort(byPosition)}
                  stageTotal={inPipeline.filter((item) => item.stageId === stage.id).length}
                  valueOf={valueOf}
                  now={now}
                  over={over === stage.id}
                  readOnly={readOnly || busy}
                  showOwner={showOwner}
                  emptyText={hasFilters ? "Nada com estes filtros." : readOnly ? "Nenhum negócio aqui." : "Arraste um cartão para cá."}
                  onDragOver={() => setOver(stage.id)}
                  onDragLeave={() => setOver((value) => (value === stage.id ? null : value))}
                  onDrop={(id) => {
                    setOver(null);
                    void requestMoveStage(id, stage.id, pipeline.id).catch(() => {});
                  }}
                />
              ))}
            </div>
          ) : lost.length ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {lost.map((item) => (
                <div key={item.id} className="space-y-2">
                  <Pill className="bg-muted text-muted-foreground">
                    <XCircle className="size-3" />
                    Motivo: {item.lossReason ?? "—"}
                  </Pill>
                  <OpportunityCard opp={item} readOnly={readOnly} showOwner={showOwner} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Inbox}
              title="Nenhuma perda registrada"
              text="Quando uma negociação não fechar, use o menu ⋯ do cartão e escolha a etapa de perda."
            />
          )}
        </>
      )}

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent className="mag-crm w-full overflow-y-auto sm:max-w-sm">
          <SheetHeader className="text-left">
            <SheetTitle>Filtros do funil</SheetTitle>
            <SheetDescription>Valem só para esta tela e para o seu recorte.</SheetDescription>
          </SheetHeader>
          <div className="mt-5">{filterFields}</div>
        </SheetContent>
      </Sheet>
      {canManage && (
        <FunilAdminDialog
          open={adminOpen}
          onOpenChange={setAdminOpen}
          {...(pipeline ? { initialPipelineId: pipeline.id } : {})}
        />
      )}
    </div>
  );
}

function BoardColumn({
  stage,
  items,
  stageTotal,
  valueOf,
  now,
  over,
  readOnly,
  showOwner,
  emptyText,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  stage: PipelineStage;
  items: Opportunity[];
  stageTotal: number;
  valueOf: (item: Opportunity) => number | null;
  now: number;
  over: boolean;
  readOnly: boolean;
  showOwner: boolean;
  emptyText: string;
  onDragOver: () => void;
  onDragLeave: () => void;
  onDrop: (id: string) => void;
}) {
  const total = items.reduce((sum, item) => sum + (valueOf(item) ?? 0), 0);
  const wip = overWip(stage, stageTotal);
  const stale = items.filter((item) => isStale(stage, daysInStage(item.stageEnteredAt, item.createdAt, now))).length;
  return (
    <section
      data-crm-stage={stage.id}
      aria-label={stage.label}
      onDragOver={(event) => {
        if (!readOnly) {
          event.preventDefault();
          onDragOver();
        }
      }}
      onDragLeave={onDragLeave}
      onDrop={(event) => {
        event.preventDefault();
        if (!readOnly) onDrop(event.dataTransfer.getData("text/plain"));
      }}
      className={cn(
        "flex w-[82vw] shrink-0 snap-start flex-col rounded-2xl border bg-surface p-3 transition-colors sm:w-72",
        over && "border-primary",
      )}
    >
      <header className="mb-3 px-1">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex min-w-0 items-center gap-2 font-semibold">
            <StageDot color={stage.color} />
            <span className="truncate">{stage.label}</span>
          </h2>
          <Pill className={wip ? "crm-warning" : "bg-card text-foreground"}>
            {items.length}
            {stage.wipLimit ? `/${stage.wipLimit}` : ""}
          </Pill>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {total > 0 ? money(total / 100) : "Sem valor informado"}
          {stage.kind === "open" ? ` · ${stage.probability}% de chance` : ""}
        </p>
        {wip && (
          <p className="mt-1 flex items-center gap-1 text-xs text-[var(--crm-warning)]">
            <AlertTriangle className="size-3" />
            Acima do limite de {stage.wipLimit}
          </p>
        )}
        {stale > 0 && <p className="mt-1 text-xs font-medium text-destructive">{stale} parado(s) além do prazo</p>}
      </header>
      <div className="flex min-h-28 flex-col gap-3">
        {items.length ? (
          items.map((item) => (
            <OpportunityCard key={item.id} opp={item} draggable={!readOnly} readOnly={readOnly} showOwner={showOwner} />
          ))
        ) : (
          <div className="grid flex-1 place-items-center rounded-xl border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
            {emptyText}
          </div>
        )}
      </div>
    </section>
  );
}

function FunnelList({
  items,
  density,
  readOnly,
  showOwner,
  valueOf,
  emptyText,
}: {
  items: Opportunity[];
  density: "compact" | "comfortable";
  readOnly: boolean;
  showOwner: boolean;
  valueOf: (item: Opportunity) => number | null;
  emptyText: string;
}) {
  const { contact, open, busy } = useCrm();
  if (!items.length)
    return <EmptyState icon={Inbox} title={emptyText} text="Ajuste a busca, os filtros ou a etapa." />;
  return (
    <ul className="divide-y overflow-hidden rounded-xl border bg-card" aria-label="Lista de negócios">
      {items.map((item) => {
        const customer = contact(item.contactId);
        const value = valueOf(item);
        return (
          <li key={item.id} data-crm-opportunity={item.id} className={cn("flex items-center gap-2", density === "compact" ? "px-3 py-2" : "px-4 py-3.5")}>
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => open({ kind: "opportunity", id: item.id })}>
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate font-medium">{customer?.name ?? "Cliente"}</span>
                {item.awaitingReply && <AwaitingDot />}
              </span>
              <span className="block truncate text-sm text-muted-foreground">{item.title}</span>
              {density === "comfortable" && item.nextAction.label && (
                <span className="mt-1 block">
                  <NextActionLine label={item.nextAction.label} due={item.nextAction.due} compact />
                </span>
              )}
              <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                <OppStageBadge opp={item} />
                <DaysInStage opp={item} />
                {showOwner && <span className="text-[11px] text-muted-foreground">{item.ownerName}</span>}
              </span>
            </button>
            <span className="shrink-0 text-right text-sm font-semibold tabular-nums">
              {value !== null ? money(value / 100) : "—"}
            </span>
            <MoveMenu
              opp={item}
              readOnly={readOnly}
              trigger={
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Mover ou agendar ${item.title}`}
                  className="grid size-11 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent sm:size-9"
                >
                  <MoreHorizontal className="size-4" />
                </button>
              }
            />
          </li>
        );
      })}
    </ul>
  );
}
