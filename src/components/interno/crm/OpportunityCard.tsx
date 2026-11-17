import type { ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { STAGES, type Opportunity } from "@/lib/crm";
import { openStages } from "@/lib/crm-pipelines";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { latestValue, useCrm } from "./CrmProvider";
import { AwaitingDot, LastSeen, NextActionLine, OriginBadge } from "./bits";
import { DaysInStage, StageDot, useFunil } from "./funil-ui";
import { money } from "./format";

export function MoveMenu({
  opp,
  trigger,
  readOnly,
}: {
  opp: Opportunity;
  trigger: ReactNode;
  readOnly?: boolean | undefined;
}) {
  const { requestMove, requestMoveStage, open, busy } = useCrm();
  const { pipelines, pipelineOf } = useFunil();
  const pipeline = pipelineOf(opp);
  if (pipeline)
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="mag-crm w-64"
          onClick={(event) => event.stopPropagation()}
        >
          <DropdownMenuLabel className="truncate">Mover para · {pipeline.name}</DropdownMenuLabel>
          {pipeline.stages.map((stage) => (
            <DropdownMenuItem
              key={stage.id}
              disabled={readOnly || busy || opp.stageId === stage.id}
              onSelect={() => {
                void requestMoveStage(opp.id, stage.id, pipeline.id).catch(() => {});
              }}
            >
              <StageDot color={stage.color} />
              {stage.label}
              {stage.kind === "lost" && "…"}
            </DropdownMenuItem>
          ))}
          {pipelines.length > 1 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Levar para outro funil</DropdownMenuLabel>
              {pipelines
                .filter((item) => item.id !== pipeline.id)
                .map((item) => (
                  <DropdownMenuItem
                    key={item.id}
                    disabled={readOnly || busy}
                    onSelect={() => {
                      const first = openStages(item)[0];
                      if (first) void requestMoveStage(opp.id, first.id, item.id).catch(() => {});
                    }}
                  >
                    {item.name}
                  </DropdownMenuItem>
                ))}
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={readOnly || busy} onSelect={() => open({ kind: "schedule", id: opp.id })}>
            Agendar retorno
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="mag-crm w-56"
        onClick={(event) => event.stopPropagation()}
      >
        <DropdownMenuLabel>Mover para</DropdownMenuLabel>
        {STAGES.map((stage) => (
          <DropdownMenuItem
            key={stage.id}
            disabled={busy || opp.stage === stage.id}
            onSelect={() => {
              void requestMove(opp.id, stage.id).catch(() => {});
            }}
          >
            {stage.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem
          disabled={busy || opp.stage === "perdido"}
          onSelect={() => {
            void requestMove(opp.id, "perdido").catch(() => {});
          }}
        >
          Não fechou…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={busy} onSelect={() => open({ kind: "schedule", id: opp.id })}>
          Agendar retorno
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
export function OpportunityCard({
  opp,
  draggable,
  readOnly,
  showOwner,
}: {
  opp: Opportunity;
  draggable?: boolean | undefined;
  readOnly?: boolean | undefined;
  showOwner?: boolean | undefined;
}) {
  const { contact, open, proposals, busy, units } = useCrm();
  const customer = contact(opp.contactId);
  const value =
    latestValue(proposals, opp.id) ??
    (opp.estimatedValueCents ? opp.estimatedValueCents / 100 : undefined);
  return (
    <div
      role="button"
      tabIndex={0}
      draggable={draggable && !busy && !readOnly}
      data-crm-opportunity={opp.id}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", opp.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      onClick={() => open({ kind: "opportunity", id: opp.id })}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          open({ kind: "opportunity", id: opp.id });
        }
      }}
      className={cn(
        "crm-card crm-opportunity rounded-xl border bg-card p-3.5 focus-visible:outline-2 focus-visible:outline-ring",
        opp.awaitingReply && "border-l-4 border-l-primary",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold">{customer?.name ?? "Cliente"}</p>
          {customer?.company && (
            <p className="truncate text-xs text-muted-foreground">{customer.company}</p>
          )}
        </div>
        <MoveMenu
          opp={opp}
          readOnly={readOnly}
          trigger={
            <button
              type="button"
              disabled={busy}
              onClick={(event) => event.stopPropagation()}
              aria-label={`Mover ou agendar ${opp.title}`}
              className="-mr-1 rounded-md p-1 text-muted-foreground hover:bg-accent"
            >
              <MoreHorizontal className="size-4" />
            </button>
          }
        />
      </div>
      <p className="mt-2 text-sm font-medium">{opp.title}</p>
      {opp.interest !== opp.title && (
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{opp.interest}</p>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <OriginBadge origin={opp.origin} />
        {opp.awaitingReply && <AwaitingDot />}
      </div>
      {value !== undefined && (
        <p className="mt-2.5 text-base font-semibold tabular-nums">{money(value)}</p>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        {showOwner === false ? null : opp.ownerName}
        {opp.unitId && ` · ${units.find((unit) => unit.id === opp.unitId)?.name ?? "Unidade"}`}
      </p>
      <div className="mt-1">
        <DaysInStage opp={opp} />
      </div>
      <div className="mt-2.5 border-t pt-2.5">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Próxima ação
        </p>
        <NextActionLine label={opp.nextAction.label} due={opp.nextAction.due} compact />
        <div className="mt-1.5">
          <LastSeen at={opp.lastInteraction} />
        </div>
      </div>
    </div>
  );
}
