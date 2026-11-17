/** Visão 360° do administrador (Etapa 4): todos os funis lado a lado e o que precisa de atenção. Só leitura. */
import { AlertTriangle, CheckCircle2, Settings2, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SCOPE_LABEL, funnelMetrics, knownValueCents } from "@/lib/crm-pipelines";
import { cn } from "@/lib/utils";
import { useCrm } from "./CrmProvider";
import { Pill } from "./bits";
import { useFunilAdmin } from "./FunilAdmin";
import { StageDot } from "./funil-ui";
import { money } from "./format";

export function FunilVisao360({ onAdmin }: { onAdmin: () => void }) {
  const { opportunities, proposals, canManage } = useCrm();
  const admin = useFunilAdmin(canManage);
  if (admin.isLoading) return <p className="text-sm text-muted-foreground">Carregando a visão geral…</p>;
  if (admin.isError || !admin.data)
    return (
      <p role="alert" className="text-sm text-destructive">
        Não foi possível carregar a visão geral.
      </p>
    );
  const { pipelines, sellers } = admin.data;
  const sellerById = new Map(sellers.map((seller) => [seller.userId, seller]));
  const now = Date.now();
  const pendingAccess = opportunities.filter((item) => {
    const seller = sellerById.get(item.ownerId);
    return seller && item.pipelineId && !seller.pipelineIds.includes(item.pipelineId);
  });
  const inactiveOwner = opportunities.filter((item) => sellerById.get(item.ownerId)?.active === false);
  return (
    <div className="space-y-4">
      {pendingAccess.length || inactiveOwner.length ? (
        <div className="crm-warning space-y-1.5 rounded-xl border p-3 text-sm">
          {pendingAccess.length > 0 && (
            <p className="flex items-center gap-2">
              <AlertTriangle className="size-4 shrink-0" />
              {pendingAccess.length} negócio(s) estão em funil que o responsável não acessa. Libere o funil ou transfira os
              negócios na administração.
            </p>
          )}
          {inactiveOwner.length > 0 && (
            <p className="flex items-center gap-2">
              <UserX className="size-4 shrink-0" />
              {inactiveOwner.length} negócio(s) têm responsável inativo.
            </p>
          )}
        </div>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="size-4 text-[var(--crm-success)]" />
          Tudo em ordem: cada negócio está em um funil liberado para um responsável ativo.
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {pipelines.map((pipeline) => {
          const items = opportunities.filter((item) => item.pipelineId === pipeline.id);
          const metrics = funnelMetrics(
            pipeline,
            items.map((item) => ({
              stageId: item.stageId ?? null,
              valueCents: knownValueCents(item, proposals),
              stageEnteredAt: item.stageEnteredAt ?? null,
              createdAt: item.createdAt,
            })),
            now,
          );
          const names = pipeline.sellers.map((id) => sellerById.get(id)?.name).filter(Boolean);
          return (
            <section key={pipeline.id} className="space-y-3 rounded-xl border bg-card p-4">
              <header className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate font-semibold">{pipeline.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {SCOPE_LABEL[pipeline.scope]}
                    {pipeline.isDefault ? " · padrão do sistema" : ""}
                  </p>
                </div>
                <Pill className="bg-muted text-foreground">{items.length}</Pill>
              </header>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Em aberto</dt>
                  <dd className="font-semibold tabular-nums">{money(metrics.openCents / 100)}</dd>
                </div>
                <div title="Valor conhecido × chance de cada etapa">
                  <dt className="text-xs text-muted-foreground">Previsão</dt>
                  <dd className="font-semibold tabular-nums">{money(metrics.weightedCents / 100)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Em andamento · parados</dt>
                  <dd className="tabular-nums">
                    {metrics.open} · <span className={cn(metrics.stale > 0 && "font-semibold text-destructive")}>{metrics.stale}</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Ganhos · perdidos</dt>
                  <dd className="tabular-nums">
                    {metrics.won} · {metrics.lost}
                  </dd>
                </div>
              </dl>
              <ul className="space-y-1">
                {pipeline.stages.map((stage) => {
                  const count = metrics.perStage[stage.id]?.count ?? 0;
                  const overLimit = metrics.overLimit.includes(stage.id);
                  return (
                    <li key={stage.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <StageDot color={stage.color} />
                        <span className="truncate">{stage.label}</span>
                      </span>
                      <span className={cn("tabular-nums", overLimit && "font-semibold text-[var(--crm-warning)]")}>
                        {count}
                        {stage.wipLimit ? `/${stage.wipLimit}` : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="text-xs text-muted-foreground">Vendedores: {names.length ? names.join(", ") : "nenhum"}</p>
            </section>
          );
        })}
      </div>
      <Button variant="outline" className="h-11 sm:h-9" onClick={onAdmin}>
        <Settings2 />
        Abrir administração do funil
      </Button>
    </div>
  );
}
