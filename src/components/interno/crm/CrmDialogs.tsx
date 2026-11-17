import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  ExternalLink,
  FileText,
  KanbanSquare,
  MessageCircle,
  Plus,
  Save,
  Pencil,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  LOSS_REASONS,
  ORIGINS,
  type CrmContactInput,
  type LossReason,
  type Origin,
} from "@/lib/crm";
import { getOpportunityDetail, previewCrmQuoteLink } from "@/lib/crm.functions";
import { REQUIRED_FIELD_LABEL, stageOf } from "@/lib/crm-pipelines";
import { cn } from "@/lib/utils";
import { proposalsFor, useCrm, type StageMoveFields } from "./CrmProvider";
import { NextActionLine, OriginBadge, ProposalBadge } from "./bits";
import { DaysInStage, OppStageBadge, useFunil } from "./funil-ui";
import { MoveMenu } from "./OpportunityCard";
import { dayKey, fullDate, localDateTime, money, toIsoDateTime } from "./format";

function Choice<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: readonly T[];
  value: T | undefined;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          type="button"
          disabled={disabled}
          key={option}
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={cn(
            "rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-50",
            value === option ? "crm-brand border-primary" : "hover:bg-accent",
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="leading-relaxed">{children}</div>
    </div>
  );
}
export function CrmDialogs() {
  const { dialog, close, opportunity, contact, entityLoading, entityError, refresh } = useCrm();
  const opportunityId =
    dialog &&
    ["opportunity", "schedule", "loss", "close", "createProposal", "requirements"].includes(dialog.kind) &&
    "id" in dialog
      ? dialog.id
      : undefined;
  const current = opportunityId ? opportunity(opportunityId) : undefined;
  const contactId =
    dialog?.kind === "contact"
      ? dialog.id
      : dialog?.kind === "newOpportunity"
        ? dialog.contactId
        : current?.contactId;
  const missingEntity = Boolean((opportunityId && !current) || (contactId && !contact(contactId)));
  if (missingEntity)
    return (
      <Dialog
        open
        onOpenChange={(value) => {
          if (!value) close();
        }}
      >
        <DialogContent className="mag-crm mag-crm-dialog">
          <DialogHeader>
            <DialogTitle>
              {entityLoading ? "Carregando cadastro" : "Cadastro indisponível"}
            </DialogTitle>
            <DialogDescription>
              {entityLoading
                ? "Buscando os dados deste registro."
                : entityError
                  ? "Não foi possível buscar este registro. Tente novamente."
                  : "O cadastro não existe ou está fora do seu acesso."}
            </DialogDescription>
          </DialogHeader>
          {entityLoading ? (
            <Loader2 aria-label="Carregando" className="size-5 animate-spin" />
          ) : (
            <Button variant="outline" onClick={() => void refresh()}>
              Tentar novamente
            </Button>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={close}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  return (
    <>
      <OpportunityDrawer />
      <ScheduleDialog />
      <LossDialog />
      <CloseDialog />
      <RequirementsDialog />
      <NewOpportunityDialog />
      <ContactDialog />
      <CreateProposalDialog />
      <ProposalDrawer />
    </>
  );
}

function OpportunityDrawer() {
  const {
    dialog,
    close,
    open,
    opportunity,
    contact,
    proposals,
    saveOpportunity,
    busy,
    tasks,
    finishTask,
    units,
  } = useCrm();
  const navigate = useNavigate();
  const { pipelineOf } = useFunil();
  const current = dialog?.kind === "opportunity" ? opportunity(dialog.id) : undefined;
  const customer = current ? contact(current.contactId) : undefined;
  const currentPipeline = current ? pipelineOf(current) : undefined;
  const [notes, setNotes] = useState("");
  const [title, setTitle] = useState("");
  const [interest, setInterest] = useState("");
  const [estimate, setEstimate] = useState("");
  useEffect(() => {
    setNotes(current?.notes ?? "");
    setTitle(current?.title ?? "");
    setInterest(current?.interest ?? "");
    setEstimate(current?.estimatedValueCents ? (current.estimatedValueCents / 100).toFixed(2) : "");
  }, [current?.id]);
  const load = useServerFn(getOpportunityDetail);
  const detail = useQuery({
    queryKey: ["interno", "crm", "opportunity", current?.id],
    queryFn: () => load({ data: { id: current!.id } }),
    enabled: Boolean(current),
    staleTime: 10_000,
  });
  const related = current ? proposalsFor(proposals, current.id) : [];
  const pending = current
    ? tasks.filter((item) => item.opportunityId === current.id && item.status === "pending")
    : [];
  return (
    <Sheet
      open={Boolean(current)}
      onOpenChange={(value) => {
        if (!value) close();
      }}
    >
      <SheetContent
        className="mag-crm w-full overflow-y-auto sm:max-w-xl"
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        {current && customer && (
          <>
            <SheetHeader className="pr-7 text-left">
              <div className="flex flex-wrap items-center gap-1.5">
                <OppStageBadge opp={current} />
                <OriginBadge origin={current.origin} />
                {currentPipeline && (
                  <span className="text-xs text-muted-foreground">Funil {currentPipeline.name}</span>
                )}
              </div>
              <SheetTitle className="text-xl">{current.title}</SheetTitle>
              <SheetDescription>
                {customer.name}
                {customer.company && ` · ${customer.company}`}
              </SheetDescription>
              <DaysInStage opp={current} />
            </SheetHeader>
            <div className="mt-6 space-y-6 text-sm">
              <div className="rounded-xl border bg-surface p-4">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Próxima ação
                </p>
                <NextActionLine label={current.nextAction.label} due={current.nextAction.due} />
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  onClick={() => open({ kind: "schedule", id: current.id })}
                >
                  <CalendarClock />
                  Agendar retorno
                </Button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  {current.ownerName}
                  {current.unitId &&
                    ` · ${units.find((unit) => unit.id === current.unitId)?.name ?? "Unidade"}`}
                  {current.lossReason && ` · Motivo: ${current.lossReason}`}
                </span>
                <MoveMenu
                  opp={current}
                  trigger={
                    <Button size="sm" variant="outline" disabled={busy}>
                      <KanbanSquare />
                      Mover no funil
                    </Button>
                  }
                />
              </div>
              <form
                className="space-y-3"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const amount = estimate ? Number(estimate.replace(",", ".")) : 0;
                  if (!title.trim() || !Number.isFinite(amount) || amount < 0) return;
                  try {
                    await saveOpportunity(current.id, {
                      title: title.trim(),
                      interest: interest.trim(),
                      estimatedValueCents: Math.round(amount * 100),
                    });
                  } catch {
                    // O CRM apresenta a falha da ação e mantém o formulário aberto.
                  }
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="crm-op-title">Título</Label>
                  <Input
                    id="crm-op-title"
                    required
                    maxLength={240}
                    value={title}
                    disabled={busy}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="crm-op-interest">Interesse</Label>
                  <Textarea
                    id="crm-op-interest"
                    maxLength={3000}
                    rows={2}
                    value={interest}
                    disabled={busy}
                    onChange={(event) => setInterest(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="crm-op-estimate">Valor estimado (R$)</Label>
                  <Input
                    id="crm-op-estimate"
                    inputMode="decimal"
                    type="number"
                    min="0"
                    step="0.01"
                    value={estimate}
                    disabled={busy}
                    onChange={(event) => setEstimate(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Estimativa da oportunidade. O valor da proposta vem dos itens e condições do
                    orçamento.
                  </p>
                </div>
                <Button type="submit" size="sm" variant="outline" disabled={busy || !title.trim()}>
                  <Save />
                  Salvar oportunidade
                </Button>
              </form>
              <form
                className="space-y-2"
                onSubmit={async (event) => {
                  event.preventDefault();
                  try {
                    await saveOpportunity(current.id, { notes });
                    setNotes(notes.trim());
                  } catch {
                    // O CRM apresenta a falha da ação e mantém o formulário aberto.
                  }
                }}
              >
                <Label htmlFor="crm-op-notes">Notas internas</Label>
                <Textarea
                  id="crm-op-notes"
                  maxLength={5000}
                  rows={3}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  disabled={busy}
                  placeholder="Preferências, medidas e observações para a equipe"
                />
                <Button
                  size="sm"
                  type="submit"
                  variant="outline"
                  disabled={busy || notes === current.notes}
                >
                  <Save />
                  Salvar notas
                </Button>
              </form>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={current.awaitingReply}
                  disabled={busy}
                  onChange={(event) => {
                    void saveOpportunity(current.id, { awaitingReply: event.target.checked }).catch(
                      () => {},
                    );
                  }}
                />
                Precisa de resposta
              </label>
              {pending.length > 0 && (
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Tarefas pendentes
                  </h3>
                  <ul className="divide-y rounded-lg border">
                    {pending.map((item) => (
                      <li key={item.id} className="flex items-center gap-2 p-3">
                        <div className="min-w-0 flex-1">
                          <NextActionLine label={item.label} due={item.due} />
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={busy}
                          aria-label={`Concluir tarefa ${item.label}`}
                          onClick={() => {
                            void finishTask(item.id).catch(() => {});
                          }}
                        >
                          <Check />
                        </Button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <section>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Negociações e propostas
                  </h3>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => open({ kind: "createProposal", id: current.id })}
                  >
                    <Plus />
                    {related.length ? "Vincular negociação" : "Criar proposta"}
                  </Button>
                </div>
                {related.length ? (
                  <div className="space-y-2">
                    {related.map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        onClick={() => open({ kind: "proposal", id: item.id })}
                        className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-3 text-left hover:bg-accent"
                      >
                        <span className="inline-flex items-center gap-2">
                          <FileText className="size-4 text-muted-foreground" />
                          {item.number}
                          {item.version && ` · v${item.version}`}
                        </span>
                        <span className="inline-flex items-center gap-2 tabular-nums">
                          {money(item.value)}
                          <ProposalBadge status={item.status} />
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground">Nenhuma negociação vinculada.</p>
                )}
              </section>
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Histórico da oportunidade
                </h3>
                {detail.isError ? (
                  <p role="alert" className="text-destructive">
                    Não foi possível carregar o histórico.
                  </p>
                ) : detail.isLoading ? (
                  <p className="text-muted-foreground">Carregando histórico…</p>
                ) : (
                  <ul className="space-y-2">
                    {detail.data?.activities
                      .slice()
                      .reverse()
                      .map((item) => (
                        <li key={item.id} className="border-l-2 pl-3">
                          <p>{item.label}</p>
                          <p className="text-xs text-muted-foreground">
                            {fullDate(item.at)}
                            {item.actorName && ` · ${item.actorName}`}
                          </p>
                        </li>
                      ))}
                  </ul>
                )}
              </section>
            </div>
            <div className="mt-6 grid gap-2 border-t pt-4">
              <Button
                onClick={() => {
                  close();
                  void navigate({
                    to: "/interno/crm/atendimento",
                    search: { c: customer.id, o: current.id },
                  });
                }}
              >
                <MessageCircle />
                Abrir atendimento
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  close();
                  void navigate({ to: "/interno/crm/clientes", search: { id: customer.id } });
                }}
              >
                Ver ficha do cliente
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ScheduleDialog() {
  const { dialog, close, opportunity, contact, schedule, busy } = useCrm();
  const current = dialog?.kind === "schedule" ? opportunity(dialog.id) : undefined;
  const [label, setLabel] = useState("");
  const [due, setDue] = useState("");
  useEffect(() => {
    if (current) {
      setLabel(current.nextAction.label);
      setDue(localDateTime(new Date(Date.now() + 60 * 60_000).toISOString()));
    }
  }, [current?.id]);
  const nextMorning = () => {
    const tomorrow = new Date(Date.now() + 86_400_000);
    return `${dayKey(tomorrow)}T10:00`;
  };
  return (
    <Dialog
      open={Boolean(current)}
      onOpenChange={(value) => {
        if (!value) close();
      }}
    >
      <DialogContent className="mag-crm mag-crm-dialog">
        <DialogHeader>
          <DialogTitle>Agendar retorno</DialogTitle>
          <DialogDescription>
            {current
              ? `${contact(current.contactId)?.name ?? "Cliente"} · ${current.title}`
              : "Defina a próxima ação da oportunidade."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!current || !label.trim() || !due) return;
            try {
              await schedule(current.id, label.trim(), toIsoDateTime(due));
              close();
            } catch {
              // O CRM apresenta a falha da ação e mantém o formulário aberto.
            }
          }}
        >
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                setDue(localDateTime(new Date(Date.now() + 60 * 60_000).toISOString()))
              }
            >
              Em 1 hora
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => setDue(nextMorning())}
            >
              Amanhã, 10h
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                setDue(localDateTime(new Date(Date.now() + 7 * 86_400_000).toISOString()))
              }
            >
              Em 1 semana
            </Button>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="crm-schedule-when">Data e horário</Label>
            <Input
              id="crm-schedule-when"
              type="datetime-local"
              required
              value={due}
              disabled={busy}
              onChange={(event) => setDue(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">Horário de Fortaleza.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="crm-schedule-label">O que fazer?</Label>
            <Input
              id="crm-schedule-label"
              required
              maxLength={240}
              value={label}
              disabled={busy}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Ex.: Ligar para confirmar as medidas"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={close}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy || !label.trim() || !due}>
              Agendar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
function LossDialog() {
  const { dialog, close, opportunity, applyStage, applyStageMove, busy } = useCrm();
  const { byId } = useFunil();
  const target = dialog?.kind === "loss" ? dialog : undefined;
  const current = target ? opportunity(target.id) : undefined;
  const lostLabel = target?.stageId ? stageOf(byId.get(target.pipelineId ?? ""), target.stageId)?.label : undefined;
  const [reason, setReason] = useState<LossReason>();
  useEffect(() => setReason(undefined), [current?.id]);
  return (
    <Dialog
      open={Boolean(current)}
      onOpenChange={(value) => {
        if (!value) close();
      }}
    >
      <DialogContent className="mag-crm mag-crm-dialog">
        <DialogHeader>
          <DialogTitle>Por que não fechou?</DialogTitle>
          <DialogDescription>Registre o motivo principal de “{current?.title}”.</DialogDescription>
        </DialogHeader>
        <Choice options={LOSS_REASONS} value={reason} onChange={setReason} disabled={busy} />
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={close}>
            Cancelar
          </Button>
          <Button
            disabled={busy || !reason}
            onClick={async () => {
              if (!current || !reason) return;
              try {
                if (target?.stageId)
                  await applyStageMove(current.id, target.stageId, {
                    ...(target.pipelineId ? { pipelineId: target.pipelineId } : {}),
                    lossReason: reason,
                  });
                else await applyStage(current.id, "perdido", reason);
                close();
              } catch {
                // O CRM apresenta a falha da ação e mantém o formulário aberto.
              }
            }}
          >
            Registrar “{lostLabel ?? "Não fechou"}”
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
function CloseDialog() {
  const { dialog, close, opportunity, applyStage, applyStageMove, busy } = useCrm();
  const { byId } = useFunil();
  const target = dialog?.kind === "close" ? dialog : undefined;
  const current = target ? opportunity(target.id) : undefined;
  const wonLabel = target?.stageId ? stageOf(byId.get(target.pipelineId ?? ""), target.stageId)?.label : undefined;
  return (
    <Dialog
      open={Boolean(current)}
      onOpenChange={(value) => {
        if (!value) close();
      }}
    >
      <DialogContent className="mag-crm mag-crm-dialog">
        <DialogHeader>
          <DialogTitle>Marcar como {wonLabel ?? "Fechado"}?</DialogTitle>
          <DialogDescription>{current?.title}</DialogDescription>
        </DialogHeader>
        <div className="crm-warning flex gap-3 rounded-xl border p-4 text-sm">
          <AlertTriangle className="size-5 shrink-0" />
          <p>
            Registre o ganho da negociação. O aceite da proposta e a confirmação do pedido seguem
            disponíveis no orçamento do gerencial.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={close}>
            Cancelar
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              if (!current) return;
              try {
                if (target?.stageId)
                  await applyStageMove(current.id, target.stageId, {
                    ...(target.pipelineId ? { pipelineId: target.pipelineId } : {}),
                  });
                else await applyStage(current.id, "fechado");
                close();
              } catch {
                // O CRM apresenta a falha da ação e mantém o formulário aberto.
              }
            }}
          >
            Sim, negociação fechada
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
/** Etapa 4: o que falta para entrar na etapa. Grava os campos e move no mesmo passo (o servidor confere de novo). */
function RequirementsDialog() {
  const { dialog, close, opportunity, applyStageMove, busy } = useCrm();
  const { byId } = useFunil();
  const target = dialog?.kind === "requirements" ? dialog : undefined;
  const current = target ? opportunity(target.id) : undefined;
  const stage = target ? stageOf(byId.get(target.pipelineId), target.stageId) : undefined;
  const missing = target?.missing ?? [];
  const [value, setValue] = useState("");
  const [action, setAction] = useState("");
  const [due, setDue] = useState("");
  const [notes, setNotes] = useState("");
  useEffect(() => {
    setValue(current?.estimatedValueCents ? (current.estimatedValueCents / 100).toFixed(2) : "");
    setAction(current?.nextAction.label ?? "");
    setDue(localDateTime(new Date(Date.now() + 24 * 60 * 60_000).toISOString()));
    setNotes(current?.notes ?? "");
  }, [current?.id, target?.stageId]);
  const amount = value ? Number(value.replace(",", ".")) : NaN;
  const ready =
    (!missing.includes("value") || (Number.isFinite(amount) && amount > 0)) &&
    (!missing.includes("nextAction") || (action.trim() && due)) &&
    (!missing.includes("notes") || notes.trim());
  return (
    <Dialog
      open={Boolean(current && stage)}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="mag-crm mag-crm-dialog">
        <DialogHeader>
          <DialogTitle>Para entrar em “{stage?.label}”</DialogTitle>
          <DialogDescription>
            Esta etapa pede {missing.map((field) => REQUIRED_FIELD_LABEL[field].toLowerCase()).join(", ")}. Preencha para
            mover “{current?.title}”.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!current || !target || !ready) return;
            const fields: StageMoveFields = {};
            if (missing.includes("value")) fields.estimatedValueCents = Math.round(amount * 100);
            if (missing.includes("nextAction")) fields.nextAction = { label: action.trim(), due: toIsoDateTime(due) };
            if (missing.includes("notes")) fields.notes = notes.trim();
            try {
              await applyStageMove(current.id, target.stageId, { pipelineId: target.pipelineId, fields });
              close();
            } catch {
              // O CRM apresenta a falha da ação e mantém o formulário aberto.
            }
          }}
        >
          {missing.includes("value") && (
            <div className="space-y-1.5">
              <Label htmlFor="crm-req-value">Valor estimado (R$)</Label>
              <Input
                id="crm-req-value"
                inputMode="decimal"
                type="number"
                min="0.01"
                step="0.01"
                required
                value={value}
                disabled={busy}
                onChange={(event) => setValue(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">Uma proposta vinculada válida também conta como valor.</p>
            </div>
          )}
          {missing.includes("nextAction") && (
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div className="space-y-1.5">
                <Label htmlFor="crm-req-action">Próxima ação</Label>
                <Input
                  id="crm-req-action"
                  required
                  maxLength={240}
                  value={action}
                  disabled={busy}
                  placeholder="Ex.: Enviar proposta revisada"
                  onChange={(event) => setAction(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="crm-req-due">Quando</Label>
                <Input
                  id="crm-req-due"
                  type="datetime-local"
                  required
                  value={due}
                  disabled={busy}
                  onChange={(event) => setDue(event.target.value)}
                />
              </div>
            </div>
          )}
          {missing.includes("notes") && (
            <div className="space-y-1.5">
              <Label htmlFor="crm-req-notes">Observações</Label>
              <Textarea
                id="crm-req-notes"
                required
                rows={3}
                maxLength={5000}
                value={notes}
                disabled={busy}
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={close}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy || !ready}>
              Salvar e mover
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NewOpportunityDialog() {
  const { dialog, close, open, contacts, contact, addOpportunity, busy, units, owners, canManage } =
    useCrm();
  const isOpen = dialog?.kind === "newOpportunity";
  const preset = isOpen ? dialog.contactId : undefined;
  const [contactId, setContactId] = useState("");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
  const [interest, setInterest] = useState("");
  const [origin, setOrigin] = useState<Origin>("Desconhecida");
  const [owner, setOwner] = useState("");
  const [unit, setUnit] = useState("");
  useEffect(() => {
    if (isOpen) {
      setContactId(preset ?? "");
      setName("");
      setCompany("");
      setPhone("");
      setEmail("");
      setTitle("");
      setInterest("");
      setOrigin("Desconhecida");
      setOwner("");
      setUnit(preset ? (contact(preset)?.unitId ?? "") : "");
    }
  }, [isOpen, preset]);
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(value) => {
        if (!value) close();
      }}
    >
      <DialogContent className="mag-crm mag-crm-dialog">
        <DialogHeader>
          <DialogTitle>Nova oportunidade</DialogTitle>
          <DialogDescription>
            {preset
              ? `Para ${contact(preset)?.name ?? "o cliente"}. Um cliente pode ter várias oportunidades.`
              : "Selecione um cliente ou cadastre um novo contato."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!title.trim() || (!contactId && !name.trim())) return;
            try {
              const id = await addOpportunity({
                ...(contactId
                  ? { contactId }
                  : {
                      newContact: {
                        name: name.trim(),
                        company: company.trim(),
                        phone: phone.trim(),
                        email: email.trim(),
                      },
                      ...(owner ? { ownerId: owner } : {}),
                    }),
                title: title.trim(),
                interest: interest.trim(),
                origin,
                unitId: unit || null,
              });
              close();
              open({ kind: "opportunity", id });
            } catch {
              // O CRM apresenta a falha da ação e mantém o formulário aberto.
            }
          }}
        >
          {!preset && (
            <div className="space-y-2">
              <Label htmlFor="crm-new-op-contact">Cliente</Label>
              <select
                id="crm-new-op-contact"
                value={contactId}
                disabled={busy}
                onChange={(event) => {
                  setContactId(event.target.value);
                  setUnit(contact(event.target.value)?.unitId ?? "");
                }}
                className="h-10 w-full rounded-md border bg-card px-3 text-sm"
              >
                <option value="">+ Novo cliente</option>
                {contacts.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {item.company && ` · ${item.company}`}
                  </option>
                ))}
              </select>
            </div>
          )}
          {!contactId && (
            <div className="grid gap-3 rounded-lg border bg-surface p-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="crm-new-op-name">Nome do cliente</Label>
                <Input
                  id="crm-new-op-name"
                  required
                  maxLength={200}
                  value={name}
                  disabled={busy}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="crm-new-op-company">Empresa</Label>
                <Input
                  id="crm-new-op-company"
                  maxLength={200}
                  value={company}
                  disabled={busy}
                  onChange={(event) => setCompany(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="crm-new-op-phone">Telefone</Label>
                <Input
                  id="crm-new-op-phone"
                  type="tel"
                  maxLength={30}
                  value={phone}
                  disabled={busy}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="DDD + número"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="crm-new-op-email">E-mail</Label>
                <Input
                  id="crm-new-op-email"
                  type="email"
                  maxLength={255}
                  value={email}
                  disabled={busy}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="crm-new-op-title">Título da oportunidade</Label>
            <Input
              id="crm-new-op-title"
              required
              maxLength={240}
              value={title}
              disabled={busy}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Ex.: Mesas para sala de treinamento"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="crm-new-op-interest">Interesse</Label>
            <Textarea
              id="crm-new-op-interest"
              maxLength={3000}
              value={interest}
              disabled={busy}
              onChange={(event) => setInterest(event.target.value)}
              rows={2}
              placeholder="O que o cliente precisa?"
            />
          </div>
          <div className="space-y-2">
            <Label>Origem</Label>
            <Choice options={ORIGINS} value={origin} onChange={setOrigin} disabled={busy} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {canManage && !contactId && (
              <div className="space-y-1.5">
                <Label htmlFor="crm-new-op-owner">Responsável</Label>
                <select
                  id="crm-new-op-owner"
                  value={owner}
                  disabled={busy}
                  onChange={(event) => setOwner(event.target.value)}
                  className="h-10 w-full rounded-md border bg-card px-2 text-sm"
                >
                  <option value="">Minha carteira</option>
                  {owners.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="crm-new-op-unit">Unidade</Label>
              <select
                id="crm-new-op-unit"
                value={unit}
                disabled={busy}
                onChange={(event) => setUnit(event.target.value)}
                className="h-10 w-full rounded-md border bg-card px-2 text-sm"
              >
                <option value="">Sem unidade</option>
                {units.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={close}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy || !title.trim() || (!contactId && !name.trim())}>
              <Plus />
              Criar oportunidade
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ContactDialog() {
  const { dialog, close, contact, saveContact, busy, owners, units, canManage, opportunities } =
    useCrm();
  const isOpen = dialog?.kind === "contact";
  const current = isOpen && dialog.id ? contact(dialog.id) : undefined;
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [city, setCity] = useState("");
  const [owner, setOwner] = useState("");
  const [unit, setUnit] = useState("");
  useEffect(() => {
    if (isOpen) {
      setName(current?.name ?? "");
      setCompany(current?.company ?? "");
      setPhone(current?.phone ?? "");
      setEmail(current?.email ?? "");
      setCity(current?.city ?? "");
      setOwner(current?.ownerId ?? "");
      setUnit(current?.unitId ?? "");
    }
  }, [isOpen, current?.id]);
  const hasOpportunities = current && opportunities.some((item) => item.contactId === current.id);
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(value) => {
        if (!value) close();
      }}
    >
      <DialogContent className="mag-crm mag-crm-dialog">
        <DialogHeader>
          <DialogTitle>{current ? "Editar cliente" : "Novo cliente"}</DialogTitle>
          <DialogDescription>
            Dados compartilhados pelos atendimentos e oportunidades deste contato.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!name.trim()) return;
            const input: CrmContactInput = {
              name: name.trim(),
              company: company.trim(),
              phone: phone.trim(),
              email: email.trim(),
              city: city.trim(),
              unitId: unit || null,
              ...(owner ? { ownerId: owner } : {}),
            };
            try {
              await saveContact(input, current);
              close();
            } catch {
              // O CRM apresenta a falha da ação e mantém o formulário aberto.
            }
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="crm-contact-name">Nome</Label>
            <Input
              id="crm-contact-name"
              required
              maxLength={200}
              value={name}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="crm-contact-company">Empresa</Label>
            <Input
              id="crm-contact-company"
              maxLength={200}
              value={company}
              disabled={busy}
              onChange={(event) => setCompany(event.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="crm-contact-phone">Telefone</Label>
              <Input
                id="crm-contact-phone"
                type="tel"
                maxLength={30}
                value={phone}
                disabled={busy}
                onChange={(event) => setPhone(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="crm-contact-email">E-mail</Label>
              <Input
                id="crm-contact-email"
                type="email"
                maxLength={255}
                value={email}
                disabled={busy}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="crm-contact-city">Cidade / UF</Label>
            <Input
              id="crm-contact-city"
              maxLength={120}
              value={city}
              disabled={busy}
              onChange={(event) => setCity(event.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {canManage && (
              <div className="space-y-1.5">
                <Label htmlFor="crm-contact-owner">Responsável</Label>
                <select
                  id="crm-contact-owner"
                  value={owner}
                  disabled={busy || Boolean(hasOpportunities)}
                  onChange={(event) => setOwner(event.target.value)}
                  className="h-10 w-full rounded-md border bg-card px-2 text-sm"
                >
                  <option value="">Minha carteira</option>
                  {owners.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                {hasOpportunities && (
                  <p className="text-xs text-muted-foreground">
                    Carteira preservada pelas oportunidades vinculadas.
                  </p>
                )}
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="crm-contact-unit">Unidade</Label>
              <select
                id="crm-contact-unit"
                value={unit}
                disabled={busy}
                onChange={(event) => setUnit(event.target.value)}
                className="h-10 w-full rounded-md border bg-card px-2 text-sm"
              >
                <option value="">Sem unidade</option>
                {units.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={close}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              <Save />
              {current ? "Salvar cliente" : "Cadastrar cliente"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateProposalDialog() {
  const { dialog, close, opportunity, proposals, attachQuote, createQuote, busy, viewerId } =
    useCrm();
  const current = dialog?.kind === "createProposal" ? opportunity(dialog.id) : undefined;
  const navigate = useNavigate();
  const [quoteId, setQuoteId] = useState("");
  const [confirmMismatch, setConfirmMismatch] = useState(false);
  const [justification, setJustification] = useState("");
  const previewLink = useServerFn(previewCrmQuoteLink);
  const preview = useQuery({
    queryKey: ["interno", "crm", "quote-link-preview", viewerId, current?.id, quoteId],
    queryFn: () => previewLink({ data: { opportunityId: current!.id, quoteId } }),
    enabled: Boolean(current && quoteId),
    retry: 1,
    staleTime: 0,
  });
  useEffect(() => setQuoteId(""), [current?.id]);
  useEffect(() => {
    setConfirmMismatch(false);
    setJustification("");
  }, [current?.id, quoteId]);
  const available = proposals.filter((item) => !item.opportunityId);
  return (
    <Dialog
      open={Boolean(current)}
      onOpenChange={(value) => {
        if (!value) close();
      }}
    >
      <DialogContent className="mag-crm mag-crm-dialog">
        <DialogHeader>
          <DialogTitle>Proposta comercial</DialogTitle>
          <DialogDescription>{current?.title}</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <p className="text-sm text-muted-foreground">
            Abra a negociação para escolher os produtos, definir condições e gerar a proposta. As
            versões, os descontos e o aceite seguem o fluxo comercial da MAG.
          </p>
          <Button
            className="w-full"
            disabled={busy}
            onClick={async () => {
              if (!current) return;
              try {
                const saved = await createQuote(current.id);
                close();
                void navigate({ to: "/interno/orcamentos-internos/$id", params: { id: saved.id } });
              } catch {
                // O CRM apresenta a falha da ação e mantém o formulário aberto.
              }
            }}
          >
            <Plus />
            {current?.quoteIds.length
              ? "Abrir negociação vinculada"
              : "Criar negociação no gerencial"}
          </Button>
          <div className="space-y-2 border-t pt-4">
            <Label htmlFor="crm-link-quote">Vincular negociação existente</Label>
            <select
              id="crm-link-quote"
              value={quoteId}
              disabled={busy}
              onChange={(event) => setQuoteId(event.target.value)}
              className="h-10 w-full rounded-md border bg-card px-2 text-sm"
            >
              <option value="">Selecione uma negociação</option>
              {available.map((item) => (
                <option key={item.quoteId} value={item.quoteId}>
                  {item.number} · {item.customerName} · {money(item.value)}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              O responsável da negociação deve ser o mesmo da oportunidade.
            </p>
            {quoteId && preview.isLoading && (
              <p className="text-xs text-muted-foreground">Conferindo o cliente da negociação…</p>
            )}
            {quoteId && preview.isError && (
              <p role="alert" className="text-xs text-destructive">
                Não foi possível conferir o vínculo.{" "}
                <button type="button" className="underline" onClick={() => void preview.refetch()}>
                  Tentar novamente
                </button>
              </p>
            )}
            {preview.data?.requiresConfirmation && (
              <div
                role="alert"
                className="space-y-3 rounded-md border border-amber-500/40 bg-amber-50 p-3 text-sm text-amber-950"
              >
                <p className="font-semibold">Os dados dos clientes são diferentes</p>
                <p>
                  Oportunidade: {preview.data.contact.name}
                  {preview.data.contact.company ? ` · ${preview.data.contact.company}` : ""}.
                  Negociação {preview.data.quote.number}:{" "}
                  {preview.data.quote.customerName || "cliente não informado"}.
                </p>
                <ul className="list-disc space-y-1 pl-4 text-xs">
                  {preview.data.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                <p className="text-xs">
                  Vincular mantém a proposta e seu cliente como estão. Confirme somente se esta
                  negociação pertence a este atendimento.
                </p>
                <label className="flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={confirmMismatch}
                    disabled={busy}
                    onChange={(event) => setConfirmMismatch(event.target.checked)}
                  />
                  Conferi os clientes e confirmo este vínculo
                </label>
                <div className="space-y-1">
                  <Label htmlFor="crm-link-justification">Motivo do vínculo</Label>
                  <Textarea
                    id="crm-link-justification"
                    value={justification}
                    disabled={busy}
                    minLength={10}
                    maxLength={1000}
                    rows={2}
                    placeholder="Explique o motivo (mínimo de 10 caracteres)"
                    onChange={(event) => setJustification(event.target.value)}
                  />
                </div>
              </div>
            )}
            <Button
              variant="outline"
              disabled={
                busy ||
                !quoteId ||
                preview.isFetching ||
                preview.isError ||
                !preview.data ||
                (preview.data.requiresConfirmation &&
                  (!confirmMismatch || justification.trim().length < 10))
              }
              onClick={async () => {
                if (!current || !quoteId) return;
                try {
                  await attachQuote(
                    current.id,
                    quoteId,
                    preview.data?.requiresConfirmation
                      ? {
                          confirmMismatch: true,
                          justification: justification.trim(),
                          confirmationToken: preview.data.confirmationToken,
                        }
                      : undefined,
                  );
                  close();
                } catch {
                  // O CRM apresenta a falha da ação e mantém o formulário aberto.
                }
              }}
            >
              Vincular negociação
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={close}>
            Voltar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
function ProposalDrawer() {
  const { dialog, close, proposals, contact, opportunity, open } = useCrm();
  const proposal =
    dialog?.kind === "proposal" ? proposals.find((item) => item.id === dialog.id) : undefined;
  const current = proposal?.opportunityId ? opportunity(proposal.opportunityId) : undefined;
  return (
    <Sheet
      open={Boolean(proposal)}
      onOpenChange={(value) => {
        if (!value) close();
      }}
    >
      <SheetContent className="mag-crm w-full overflow-y-auto sm:max-w-md">
        {proposal && (
          <>
            <SheetHeader className="pr-6 text-left">
              <div>
                <ProposalBadge status={proposal.status} />
              </div>
              <SheetTitle className="text-xl">
                {proposal.number}
                {proposal.version && ` · v${proposal.version}`}
              </SheetTitle>
              <SheetDescription>
                {contact(proposal.contactId)?.name || proposal.customerName}
              </SheetDescription>
            </SheetHeader>
            <div className="mt-6 space-y-5 text-sm">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Valor">
                  <span className="text-lg font-semibold tabular-nums">
                    {money(proposal.value)}
                  </span>
                </Field>
                <Field label="Atualização">{fullDate(proposal.date)}</Field>
              </div>
              {current && (
                <Field label="Oportunidade">
                  <button
                    type="button"
                    className="text-primary underline-offset-2 hover:underline"
                    onClick={() => open({ kind: "opportunity", id: current.id })}
                  >
                    {current.title}
                  </button>
                </Field>
              )}
              <div className="grid gap-2">
                <Button asChild>
                  <a href={proposal.detailUrl}>
                    <Pencil />
                    Abrir no gerencial
                  </a>
                </Button>
                {proposal.pdfUrl ? (
                  <Button asChild variant="outline">
                    <a href={proposal.pdfUrl} target="_blank" rel="noopener noreferrer">
                      <FileText />
                      Visualizar PDF
                    </a>
                  </Button>
                ) : (
                  <p className="rounded-lg border bg-surface p-3 text-muted-foreground">
                    Gere a primeira versão da proposta na negociação para visualizar o PDF.
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
