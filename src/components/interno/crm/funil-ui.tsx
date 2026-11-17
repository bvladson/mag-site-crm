/** Peças compartilhadas do funil (Etapa 4): etapa personalizada de um negócio, dias na etapa e preferências locais. */
import { useEffect, useMemo, useState } from "react";
import type { Opportunity } from "@/lib/crm";
import {
  daysInStage,
  isStale,
  stageOf,
  type Pipeline,
  type PipelineStage,
  type StageColor,
} from "@/lib/crm-pipelines";
import { cn } from "@/lib/utils";
import { useCrm } from "./CrmProvider";
import { Pill, StageBadge } from "./bits";

export const stagePill: Record<StageColor, string> = {
  info: "crm-info",
  warning: "crm-warning",
  primary: "crm-brand",
  success: "crm-success",
  muted: "bg-muted text-muted-foreground",
  foreground: "crm-ink",
};
export const stageDot: Record<StageColor, string> = {
  info: "bg-[var(--crm-info)]",
  warning: "bg-[var(--crm-warning)]",
  primary: "bg-primary",
  success: "bg-[var(--crm-success)]",
  muted: "bg-muted-foreground/50",
  foreground: "bg-foreground",
};

export function useFunil() {
  const { pipelines, defaultPipelineId } = useCrm();
  return useMemo(() => {
    const list: Pipeline[] = pipelines ?? [];
    const byId = new Map(list.map((pipeline) => [pipeline.id, pipeline]));
    const pipelineOf = (opp: Pick<Opportunity, "pipelineId">) => (opp.pipelineId ? byId.get(opp.pipelineId) : undefined);
    const stageFor = (opp: Pick<Opportunity, "pipelineId" | "stageId">): PipelineStage | undefined =>
      stageOf(pipelineOf(opp), opp.stageId);
    return {
      pipelines: list,
      byId,
      pipelineOf,
      stageFor,
      defaultPipelineId: defaultPipelineId ?? list[0]?.id ?? null,
    };
  }, [pipelines, defaultPipelineId]);
}

export function StageDot({ color, className }: { color: StageColor; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2.5 shrink-0 rounded-full", stageDot[color], className)} />;
}

/** Etapa do funil do negócio (cor e nome escolhidos pelo administrador); sem funil visível, a categoria antiga. */
export function OppStageBadge({ opp }: { opp: Opportunity }) {
  const { stageFor } = useFunil();
  const stage = stageFor(opp);
  if (!stage) return <StageBadge stage={opp.stage} />;
  return <Pill className={stagePill[stage.color]}>{stage.label}</Pill>;
}

/** "N dias na etapa": laranja perto do limite de parado, vermelho quando passou. */
export function DaysInStage({ opp, now = Date.now() }: { opp: Opportunity; now?: number }) {
  const { stageFor } = useFunil();
  const stage = stageFor(opp);
  const days = daysInStage(opp.stageEnteredAt, opp.createdAt, now);
  const stale = isStale(stage, days);
  const near = !stale && !!stage && stage.kind === "open" && stage.staleDays !== null && days >= Math.max(1, Math.ceil(stage.staleDays * 0.75));
  const label = days === 0 ? "Entrou hoje na etapa" : `${days} ${days === 1 ? "dia" : "dias"} na etapa`;
  return (
    <span
      className={cn(
        "text-[11px] tabular-nums",
        stale ? "font-semibold text-destructive" : near ? "font-medium text-[var(--crm-warning)]" : "text-muted-foreground",
      )}
      title={stage?.staleDays != null ? `Considerado parado depois de ${stage.staleDays} dia(s)` : undefined}
    >
      {label}
      {stale && " · parado"}
    </span>
  );
}

/** Preferência só deste navegador (visualização, densidade, último funil aberto). Nunca guarda dado de cliente. */
export function useStoredState<T extends string>(key: string, fallback: T, allowed?: readonly T[]) {
  const [value, setValue] = useState<T>(fallback);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(key) as T | null;
      if (saved && (!allowed || allowed.includes(saved))) setValue(saved);
    } catch {
      // Armazenamento opcional: sem ele, vale o padrão.
    }
  }, [key]);
  const update = (next: T) => {
    setValue(next);
    try {
      localStorage.setItem(key, next);
    } catch {
      // A sessão continua funcionando sem salvar a preferência.
    }
  };
  return [value, update] as const;
}

/** Celular (< 640 px), para escolher a visualização inicial do funil. */
export function useIsNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 639px)");
    const sync = () => setNarrow(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  return narrow;
}
