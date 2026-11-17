/** Administração do funil (Etapa 4, só administrador): funis, etapas, vendedores e acessos. Regras no servidor. */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Plus, Save, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  archivePipeline,
  createPipeline,
  getFunilAdmin,
  saveStages,
  setDefaultPipeline,
  setPipelineAccess,
  updatePipeline,
} from "@/lib/crm-funil.functions";
import type { Stage } from "@/lib/crm";
import {
  CATEGORY_LABEL,
  KIND_LABEL,
  MAX_STAGES,
  OPEN_CATEGORIES,
  REQUIRED_FIELDS,
  REQUIRED_FIELD_LABEL,
  SCOPES,
  SCOPE_HELP,
  SCOPE_LABEL,
  STAGE_COLORS,
  STAGE_COLOR_LABEL,
  type Pipeline,
  type PipelineScope,
  type PipelineSeller,
  type RequiredField,
  type StageColor,
  type StageKind,
} from "@/lib/crm-pipelines";
import { cn } from "@/lib/utils";
import { useCrm } from "./CrmProvider";
import { Pill } from "./bits";
import { StageDot } from "./funil-ui";

const ADMIN_KEY = ["interno", "crm", "funil-admin"] as const;
export function useFunilAdmin(enabled: boolean) {
  const load = useServerFn(getFunilAdmin);
  return useQuery({ queryKey: ADMIN_KEY, queryFn: () => load(), enabled, staleTime: 10_000 });
}
type AdminPipeline = Pipeline & { counts: Record<string, number>; sellers: string[] };
interface Draft {
  key: string;
  id?: string;
  label: string;
  color: StageColor;
  kind: StageKind;
  category: Stage;
  probability: number;
  wipLimit: string;
  staleDays: string;
  requiredFields: RequiredField[];
}
let draftSeq = 0;
const toDrafts = (pipeline: Pipeline): Draft[] =>
  pipeline.stages.map((stage) => ({
    key: stage.id,
    id: stage.id,
    label: stage.label,
    color: stage.color,
    kind: stage.kind,
    category: stage.category,
    probability: stage.probability,
    wipLimit: stage.wipLimit === null ? "" : String(stage.wipLimit),
    staleDays: stage.staleDays === null ? "" : String(stage.staleDays),
    requiredFields: [...stage.requiredFields],
  }));
const intOrNull = (value: string) => (value.trim() ? Math.max(1, Math.floor(Number(value))) : null);
const selectClass = "h-11 rounded-md border bg-card px-2 text-sm sm:h-9";

export function FunilAdminDialog({
  open,
  onOpenChange,
  initialPipelineId,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  initialPipelineId?: string;
}) {
  const admin = useFunilAdmin(open);
  const { refresh } = useCrm();
  const client = useQueryClient();
  const [tab, setTab] = useState<"funis" | "acessos">("funis");
  const [selected, setSelected] = useState(initialPipelineId ?? "");
  const [busy, setBusy] = useState(false);
  const create = useServerFn(createPipeline);
  const update = useServerFn(updatePipeline);
  const save = useServerFn(saveStages);
  const archive = useServerFn(archivePipeline);
  const access = useServerFn(setPipelineAccess);
  const chooseDefault = useServerFn(setDefaultPipeline);
  useEffect(() => {
    if (open && initialPipelineId) setSelected(initialPipelineId);
  }, [open, initialPipelineId]);
  const run = async <T,>(work: () => Promise<T>, message: string): Promise<T> => {
    setBusy(true);
    try {
      const result = await work();
      await client.invalidateQueries({ queryKey: ADMIN_KEY });
      await refresh();
      toast.success(message);
      return result;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar.");
      throw error;
    } finally {
      setBusy(false);
    }
  };
  const pipelines: AdminPipeline[] = admin.data?.pipelines ?? [];
  const sellers = admin.data?.sellers ?? [];
  const current = pipelines.find((item) => item.id === selected) ?? pipelines[0];
  return (
    <Dialog open={open} onOpenChange={(value) => !busy && onOpenChange(value)}>
      <DialogContent className="mag-crm mag-crm-dialog max-w-5xl">
        <DialogHeader>
          <DialogTitle>Administração do funil</DialogTitle>
          <DialogDescription>
            Só o administrador vê esta área. Compartilhar um funil nunca abre negócios, propostas ou conversas de outra
            pessoa.
          </DialogDescription>
        </DialogHeader>
        <div className="inline-flex w-full rounded-lg border bg-card p-1 sm:w-auto">
          {(
            [
              ["funis", "Funis e etapas"],
              ["acessos", "Vendedores e acessos"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className="crm-tab min-h-11 flex-1 sm:min-h-0 sm:flex-none"
              aria-pressed={tab === value}
              onClick={() => setTab(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {admin.isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : admin.isError ? (
          <p role="alert" className="text-sm text-destructive">
            Não foi possível carregar a administração do funil.
          </p>
        ) : tab === "funis" ? (
          <div className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
            <aside className="space-y-3">
              <ul className="space-y-1.5">
                {pipelines.map((item) => {
                  const total = Object.values(item.counts).reduce((sum, value) => sum + value, 0);
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => setSelected(item.id)}
                        aria-pressed={current?.id === item.id}
                        className={cn(
                          "w-full rounded-lg border bg-card px-3 py-2 text-left",
                          current?.id === item.id && "crm-brand border-primary",
                        )}
                      >
                        <span className="flex items-center gap-1.5 font-medium">
                          {item.isDefault && <Star className="size-3.5 fill-current" aria-label="Funil padrão" />}
                          <span className="truncate">{item.name}</span>
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {SCOPE_LABEL[item.scope]} · {total} negócio(s) · {item.sellers.length} vendedor(es)
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <NewPipelineForm
                pipelines={pipelines}
                busy={busy}
                onCreate={async (input) => {
                  const created = await run(() => create({ data: input }), "Funil criado");
                  setSelected(created.id);
                }}
              />
            </aside>
            {current && (
              <PipelineEditor
                key={`${current.id}:${current.revision}`}
                pipeline={current}
                pipelines={pipelines}
                busy={busy}
                onUpdate={(input) => run(() => update({ data: input }), "Funil atualizado").then(() => undefined)}
                onSaveStages={(input) => run(() => save({ data: input }), "Etapas salvas").then(() => undefined)}
                onArchive={async (input) => {
                  await run(() => archive({ data: input }), "Funil excluído e negócios movidos");
                  setSelected(input.targetPipelineId);
                }}
              />
            )}
          </div>
        ) : (
          <AccessMatrix
            pipelines={pipelines}
            sellers={sellers}
            busy={busy}
            onAccess={(input) => run(() => access({ data: input }), input.allowed ? "Acesso liberado" : "Acesso retirado").then(() => undefined)}
            onDefault={(input) => run(() => chooseDefault({ data: input }), "Funil padrão definido").then(() => undefined)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function NewPipelineForm({
  pipelines,
  busy,
  onCreate,
}: {
  pipelines: AdminPipeline[];
  busy: boolean;
  onCreate: (input: { name: string; scope: PipelineScope; duplicateOf?: string }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [scope, setScope] = useState<PipelineScope>("specialized");
  const [copy, setCopy] = useState("");
  return (
    <form
      className="space-y-2 rounded-lg border border-dashed p-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!name.trim()) return;
        try {
          await onCreate({ name: name.trim(), scope, ...(copy ? { duplicateOf: copy } : {}) });
          setName("");
          setCopy("");
        } catch {
          // A mensagem de erro já foi mostrada.
        }
      }}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Novo funil</p>
      <Input aria-label="Nome do novo funil" placeholder="Ex.: Licitações" maxLength={60} value={name} onChange={(event) => setName(event.target.value)} className="h-11 sm:h-9" />
      <select aria-label="Tipo do novo funil" value={scope} onChange={(event) => setScope(event.target.value as PipelineScope)} className={cn(selectClass, "w-full")}>
        {SCOPES.map((item) => (
          <option key={item} value={item}>
            {SCOPE_LABEL[item]}
          </option>
        ))}
      </select>
      <select aria-label="Copiar etapas de" value={copy} onChange={(event) => setCopy(event.target.value)} className={cn(selectClass, "w-full")}>
        <option value="">Etapas básicas</option>
        {pipelines.map((item) => (
          <option key={item.id} value={item.id}>
            Copiar etapas de {item.name}
          </option>
        ))}
      </select>
      <Button type="submit" className="h-11 w-full sm:h-9" disabled={busy || !name.trim()}>
        <Plus />
        Criar funil
      </Button>
    </form>
  );
}

function PipelineEditor({
  pipeline,
  pipelines,
  busy,
  onUpdate,
  onSaveStages,
  onArchive,
}: {
  pipeline: AdminPipeline;
  pipelines: AdminPipeline[];
  busy: boolean;
  onUpdate: (input: { id: string; revision: number; name?: string; scope?: PipelineScope; isDefault?: boolean }) => Promise<void>;
  onSaveStages: (input: {
    pipelineId: string;
    revision: number;
    stages: {
      id?: string;
      label: string;
      color: StageColor;
      kind?: StageKind;
      category?: Stage;
      probability?: number;
      wipLimit?: number | null;
      staleDays?: number | null;
      requiredFields?: RequiredField[];
    }[];
    moves?: Record<string, string>;
  }) => Promise<void>;
  onArchive: (input: { id: string; revision: number; targetPipelineId: string }) => Promise<void>;
}) {
  const [name, setName] = useState(pipeline.name);
  const [scope, setScope] = useState<PipelineScope>(pipeline.scope);
  const [drafts, setDrafts] = useState<Draft[]>(() => toDrafts(pipeline));
  const [moves, setMoves] = useState<Record<string, string>>({});
  const [target, setTarget] = useState("");
  const [confirmArchive, setConfirmArchive] = useState(false);
  const open = drafts.filter((item) => item.kind === "open");
  const closed = drafts.filter((item) => item.kind !== "open");
  const keptIds = new Set(drafts.map((item) => item.id).filter(Boolean) as string[]);
  const removed = pipeline.stages.filter((stage) => !keptIds.has(stage.id));
  const removedWithDeals = removed.filter((stage) => (pipeline.counts[stage.id] ?? 0) > 0);
  const missingTarget = removedWithDeals.some((stage) => !moves[stage.id] || !keptIds.has(moves[stage.id]!));
  const patch = (key: string, change: Partial<Draft>) =>
    setDrafts((list) => list.map((item) => (item.key === key ? { ...item, ...change } : item)));
  const moveOpen = (key: string, direction: -1 | 1) => {
    const index = open.findIndex((item) => item.key === key);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= open.length) return;
    const reordered = [...open];
    [reordered[index], reordered[next]] = [reordered[next]!, reordered[index]!];
    setDrafts([...reordered, ...closed]);
  };
  const others = pipelines.filter((item) => item.id !== pipeline.id);
  return (
    <div className="min-w-0 space-y-6">
      <section className="space-y-3 rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold">Dados do funil</h3>
        <div className="space-y-1.5">
          <Label htmlFor="funil-nome">Nome</Label>
          <Input id="funil-nome" maxLength={60} value={name} onChange={(event) => setName(event.target.value)} className="h-11 sm:h-9" />
        </div>
        <fieldset className="grid gap-2 sm:grid-cols-3">
          <legend className="mb-1.5 text-sm font-medium">Tipo</legend>
          {SCOPES.map((item) => (
            <label key={item} className={cn("cursor-pointer rounded-lg border p-3 text-sm", scope === item && "crm-brand border-primary")}>
              <span className="flex items-center gap-2 font-medium">
                <input type="radio" name="funil-tipo" checked={scope === item} onChange={() => setScope(item)} />
                {SCOPE_LABEL[item]}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">{SCOPE_HELP[item]}</span>
            </label>
          ))}
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="h-11 sm:h-9"
            disabled={busy || !name.trim() || (name.trim() === pipeline.name && scope === pipeline.scope)}
            onClick={() => void onUpdate({ id: pipeline.id, revision: pipeline.revision, name: name.trim(), scope }).catch(() => {})}
          >
            <Save />
            Salvar dados
          </Button>
          {!pipeline.isDefault && (
            <Button
              variant="ghost"
              className="h-11 sm:h-9"
              disabled={busy}
              onClick={() => void onUpdate({ id: pipeline.id, revision: pipeline.revision, isDefault: true }).catch(() => {})}
            >
              <Star />
              Tornar padrão do sistema
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          O funil padrão do sistema é o que todo vendedor novo recebe e onde caem os negócios de quem ainda não escolheu
          outro.
        </p>
      </section>

      <section className="space-y-3 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Etapas</h3>
          <span className="text-xs text-muted-foreground">Ganho e perda ficam sempre no fim e não podem ser excluídas.</span>
        </div>
        <p className="text-xs text-muted-foreground">
          A <strong>categoria</strong> de cada etapa é fixa: é o que automações, relatórios e a versão anterior do sistema
          enxergam. Mudar a ordem, incluir ou excluir etapas não muda a categoria de nenhum negócio.
        </p>
        <ol className="space-y-2">
          {[...open, ...closed].map((item, index) => {
            const deals = item.id ? (pipeline.counts[item.id] ?? 0) : 0;
            const isOpen = item.kind === "open";
            const openIndex = open.findIndex((draft) => draft.key === item.key);
            const savedCategory = item.id ? pipeline.stages.find((stage) => stage.id === item.id)?.category : undefined;
            const categoryChanged = Boolean(savedCategory && savedCategory !== item.category);
            return (
              <li key={item.key} className="grid gap-2 rounded-lg border bg-surface p-3 md:grid-cols-[auto_minmax(0,1fr)] md:items-start">
                <div className="flex items-center gap-1 md:flex-col">
                  <Button variant="ghost" size="icon" className="size-11 md:size-8" disabled={busy || !isOpen || openIndex <= 0} aria-label={`Subir ${item.label}`} onClick={() => moveOpen(item.key, -1)}>
                    <ArrowUp />
                  </Button>
                  <Button variant="ghost" size="icon" className="size-11 md:size-8" disabled={busy || !isOpen || openIndex === open.length - 1} aria-label={`Descer ${item.label}`} onClick={() => moveOpen(item.key, 1)}>
                    <ArrowDown />
                  </Button>
                  <span className="text-xs text-muted-foreground md:hidden">{index + 1}</span>
                </div>
                <div className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_9.5rem_5.5rem_5.5rem_6rem]">
                  <p className="text-xs font-medium text-muted-foreground sm:col-span-2 xl:col-span-5">
                    {KIND_LABEL[item.kind]}
                    {deals > 0 ? ` · ${deals} negócio(s)` : " · sem negócios"}
                    {!isOpen && ` · categoria ${CATEGORY_LABEL[item.category]}`}
                  </p>
                  <div className="space-y-1 sm:col-span-2 xl:col-span-1">
                    <Label className="text-xs">Nome</Label>
                    <Input aria-label="Nome da etapa" maxLength={40} value={item.label} disabled={busy} onChange={(event) => patch(item.key, { label: event.target.value })} className="h-11 sm:h-9" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Cor</Label>
                    <div className="flex items-center gap-2">
                      <StageDot color={item.color} />
                      <select aria-label="Cor da etapa" value={item.color} disabled={busy} onChange={(event) => patch(item.key, { color: event.target.value as StageColor })} className={cn(selectClass, "min-w-0 flex-1")}>
                        {STAGE_COLORS.map((color) => (
                          <option key={color} value={color}>
                            {STAGE_COLOR_LABEL[color]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Chance %</Label>
                    <Input aria-label="Chance de fechar" type="number" min={0} max={100} value={item.probability} disabled={busy || !isOpen} onChange={(event) => patch(item.key, { probability: Number(event.target.value) })} className="h-11 sm:h-9" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Limite</Label>
                    <Input aria-label="Limite de negócios" type="number" min={1} placeholder="—" value={item.wipLimit} disabled={busy || !isOpen} onChange={(event) => patch(item.key, { wipLimit: event.target.value })} className="h-11 sm:h-9" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Parado (dias)</Label>
                    <Input aria-label="Dias até ficar parado" type="number" min={1} placeholder="—" value={item.staleDays} disabled={busy || !isOpen} onChange={(event) => patch(item.key, { staleDays: event.target.value })} className="h-11 sm:h-9" />
                  </div>
                  {isOpen && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:col-span-2 xl:col-span-5">
                      <Label className="text-xs" htmlFor={`categoria-${item.key}`}>
                        Categoria
                      </Label>
                      <select
                        id={`categoria-${item.key}`}
                        aria-label="Categoria da etapa"
                        value={item.category}
                        disabled={busy}
                        onChange={(event) => patch(item.key, { category: event.target.value as Stage })}
                        className={selectClass}
                      >
                        {OPEN_CATEGORIES.map((category) => (
                          <option key={category} value={category}>
                            {CATEGORY_LABEL[category]}
                          </option>
                        ))}
                      </select>
                      {categoryChanged && deals > 0 ? (
                        <span className="text-xs font-medium text-[var(--crm-warning)]">
                          Ao salvar, os {deals} negócio(s) desta etapa passam para a categoria “{CATEGORY_LABEL[item.category]}”.
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">não muda ao reordenar</span>
                      )}
                    </div>
                  )}
                  {item.kind !== "lost" && (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 sm:col-span-2 xl:col-span-5">
                      <span className="text-xs text-muted-foreground">Exigir para entrar:</span>
                      {REQUIRED_FIELDS.map((field) => (
                        <label key={field} className="flex min-h-11 items-center gap-1.5 text-xs sm:min-h-0">
                          <input
                            type="checkbox"
                            checked={item.requiredFields.includes(field)}
                            disabled={busy}
                            onChange={(event) =>
                              patch(item.key, {
                                requiredFields: event.target.checked
                                  ? [...item.requiredFields, field]
                                  : item.requiredFields.filter((value) => value !== field),
                              })
                            }
                          />
                          {REQUIRED_FIELD_LABEL[field]}
                        </label>
                      ))}
                      {isOpen && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ml-auto h-11 text-destructive sm:h-8"
                          disabled={busy || open.length <= 1}
                          onClick={() => setDrafts((list) => list.filter((draft) => draft.key !== item.key))}
                        >
                          <Trash2 />
                          Excluir etapa
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        {removedWithDeals.map((stage) => (
          <div key={stage.id} className="crm-warning rounded-lg border p-3 text-sm">
            <p className="font-medium">
              “{stage.label}” tem {pipeline.counts[stage.id]} negócio(s). Para onde eles vão?
            </p>
            <select
              aria-label={`Destino dos negócios de ${stage.label}`}
              value={moves[stage.id] ?? ""}
              onChange={(event) => setMoves((value) => ({ ...value, [stage.id]: event.target.value }))}
              className={cn(selectClass, "mt-2 w-full text-foreground sm:w-auto")}
            >
              <option value="">Escolha a etapa de destino</option>
              {drafts
                .filter((draft) => draft.id)
                .map((draft) => (
                  <option key={draft.key} value={draft.id}>
                    {draft.label}
                  </option>
                ))}
            </select>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="h-11 sm:h-9"
            disabled={busy || drafts.length >= MAX_STAGES}
            onClick={() =>
              setDrafts([
                ...open,
                {
                  key: `nova-${++draftSeq}`,
                  label: "Nova etapa",
                  color: "info",
                  kind: "open",
                  category: open.at(-1)?.category ?? "conversando",
                  probability: 50,
                  wipLimit: "",
                  staleDays: "",
                  requiredFields: [],
                },
                ...closed,
              ])
            }
          >
            <Plus />
            Adicionar etapa
          </Button>
          <Button
            className="h-11 sm:h-9"
            disabled={busy || missingTarget || drafts.some((item) => !item.label.trim())}
            onClick={() =>
              void onSaveStages({
                pipelineId: pipeline.id,
                revision: pipeline.revision,
                stages: drafts.map((item) => ({
                  ...(item.id ? { id: item.id } : {}),
                  label: item.label.trim(),
                  color: item.color,
                  kind: item.kind,
                  category: item.category,
                  probability: Math.min(100, Math.max(0, Math.round(item.probability || 0))),
                  wipLimit: intOrNull(item.wipLimit),
                  staleDays: intOrNull(item.staleDays),
                  requiredFields: item.requiredFields,
                })),
                ...(Object.keys(moves).length ? { moves } : {}),
              }).catch(() => {})
            }
          >
            <Save />
            Salvar etapas
          </Button>
          <Button variant="ghost" className="h-11 sm:h-9" disabled={busy} onClick={() => { setDrafts(toDrafts(pipeline)); setMoves({}); }}>
            Desfazer alterações
          </Button>
        </div>
      </section>

      {others.length > 0 && (
        <section className="space-y-2 rounded-xl border border-destructive/40 bg-card p-4">
          <h3 className="text-sm font-semibold">Excluir funil</h3>
          <p className="text-xs text-muted-foreground">
            Os negócios vão para o funil escolhido, na mesma situação (andamento, ganho ou perda), e quem usava este funil
            passa a usar o destino. Nada é apagado: o funil fica arquivado.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Funil de destino" value={target} onChange={(event) => setTarget(event.target.value)} className={selectClass}>
              <option value="">Escolha o funil de destino</option>
              {others.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <label className="flex min-h-11 items-center gap-1.5 text-xs sm:min-h-0">
              <input type="checkbox" checked={confirmArchive} onChange={(event) => setConfirmArchive(event.target.checked)} />
              Entendi
            </label>
            <Button
              variant="outline"
              className="h-11 text-destructive sm:h-9"
              disabled={busy || !target || !confirmArchive}
              onClick={() => void onArchive({ id: pipeline.id, revision: pipeline.revision, targetPipelineId: target }).catch(() => {})}
            >
              <Trash2 />
              Excluir e mover negócios
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

function AccessMatrix({
  pipelines,
  sellers,
  busy,
  onAccess,
  onDefault,
}: {
  pipelines: AdminPipeline[];
  sellers: PipelineSeller[];
  busy: boolean;
  onAccess: (input: { pipelineId: string; userId: string; allowed: boolean; targetPipelineId?: string }) => Promise<void>;
  onDefault: (input: { userId: string; pipelineId: string }) => Promise<void>;
}) {
  const [pending, setPending] = useState<{ userId: string; pipelineId: string; target: string } | null>(null);
  if (!sellers.length) return <p className="text-sm text-muted-foreground">Nenhum vendedor com perfil comercial.</p>;
  const name = (id: string) => pipelines.find((item) => item.id === id)?.name ?? "Funil";
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[36rem] text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="p-3 font-semibold">Vendedor</th>
              {pipelines.map((item) => (
                <th key={item.id} className="p-3 font-semibold">
                  <span className="block truncate">{item.name}</span>
                  <span className="text-xs font-normal text-muted-foreground">{SCOPE_LABEL[item.scope]}</span>
                </th>
              ))}
              <th className="p-3 font-semibold">Funil padrão</th>
            </tr>
          </thead>
          <tbody>
            {sellers.map((seller) => (
              <tr key={seller.userId} className="border-b last:border-0">
                <td className="p-3">
                  <span className="font-medium">{seller.name}</span>
                  {!seller.active && <Pill className="ml-2 bg-muted text-muted-foreground">inativo</Pill>}
                </td>
                {pipelines.map((item) => {
                  const allowed = seller.pipelineIds.includes(item.id);
                  const deals = seller.deals[item.id] ?? 0;
                  return (
                    <td key={item.id} className="p-3">
                      <label className="flex min-h-11 items-center gap-2 sm:min-h-0">
                        <input
                          type="checkbox"
                          aria-label={`${seller.name} usa ${item.name}`}
                          checked={allowed}
                          disabled={busy || (!seller.active && !allowed)}
                          onChange={(event) => {
                            if (event.target.checked) void onAccess({ pipelineId: item.id, userId: seller.userId, allowed: true }).catch(() => {});
                            else if (deals > 0) setPending({ userId: seller.userId, pipelineId: item.id, target: "" });
                            else void onAccess({ pipelineId: item.id, userId: seller.userId, allowed: false }).catch(() => {});
                          }}
                        />
                        {deals > 0 && <span className="text-xs text-muted-foreground">{deals} negócio(s)</span>}
                      </label>
                    </td>
                  );
                })}
                <td className="p-3">
                  <select
                    aria-label={`Funil padrão de ${seller.name}`}
                    value={seller.defaultPipelineId ?? ""}
                    disabled={busy || !seller.pipelineIds.length}
                    onChange={(event) => void onDefault({ userId: seller.userId, pipelineId: event.target.value }).catch(() => {})}
                    className={selectClass}
                  >
                    {seller.pipelineIds.map((id) => (
                      <option key={id} value={id}>
                        {name(id)}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pending &&
        (() => {
          const seller = sellers.find((item) => item.userId === pending.userId)!;
          const options = seller.pipelineIds.filter((id) => id !== pending.pipelineId);
          return (
            <div className="crm-warning space-y-2 rounded-lg border p-3 text-sm">
              <p className="font-medium">
                {seller.name} tem {seller.deals[pending.pipelineId]} negócio(s) em “{name(pending.pipelineId)}”. Para tirar
                o acesso, escolha para qual funil liberado eles vão (a carteira continua dela).
              </p>
              {options.length ? (
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label="Funil de destino"
                    value={pending.target}
                    onChange={(event) => setPending({ ...pending, target: event.target.value })}
                    className={cn(selectClass, "text-foreground")}
                  >
                    <option value="">Escolha o destino</option>
                    {options.map((id) => (
                      <option key={id} value={id}>
                        {name(id)}
                      </option>
                    ))}
                  </select>
                  <Button
                    className="h-11 sm:h-9"
                    disabled={busy || !pending.target}
                    onClick={() =>
                      void onAccess({ pipelineId: pending.pipelineId, userId: pending.userId, allowed: false, targetPipelineId: pending.target })
                        .then(() => setPending(null))
                        .catch(() => {})
                    }
                  >
                    Mover negócios e tirar acesso
                  </Button>
                  <Button variant="ghost" className="h-11 sm:h-9" onClick={() => setPending(null)}>
                    Cancelar
                  </Button>
                </div>
              ) : (
                <p>Libere outro funil para esta pessoa antes de tirar este.</p>
              )}
            </div>
          );
        })()}
    </div>
  );
}
