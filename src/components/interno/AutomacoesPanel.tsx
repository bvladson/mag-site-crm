import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  getAutomations,
  previewAutomationRule,
  runAutomationsNow,
  saveAutomationRule,
  saveAutomationSwitch,
  setAutomationMode,
} from "@/lib/crm-automacoes.functions";
import { Card, ErrorState, Loading, PageTitle, fmtDate } from "@/components/interno/ui";
import { Button } from "@/components/ui/button";

type Data = Awaited<ReturnType<typeof getAutomations>>;
type Rule = Data["rules"][number];
const MODOS = [
  { id: "desligada", label: "Desligada" },
  { id: "simulacao", label: "Simulação" },
  { id: "ativa", label: "Ativa" },
] as const;
const UNIDADE = { minutos: "min", horas: "h", dias: "dias" } as const;
/** "depois de 1 dia", "depois de 30 min", "assim que acontece". */
const prazo = (quantidade: number, unidade: keyof typeof UNIDADE) =>
  quantidade === 0 ? "assim que acontece" : `depois de ${quantidade} ${unidade === "dias" && quantidade === 1 ? "dia" : UNIDADE[unidade]}`;
const ORIGENS = ["todas", "Anúncio Meta", "Anúncio Google", "Site", "Indicação", "WhatsApp", "Desconhecida"];
const RESULTADO: Record<string, string> = {
  simulado: "simulado (nada criado)", criado: "tarefa criada", aviso: "aviso ao gestor", ja_pendente: "já havia tarefa pendente", pendente: "em andamento",
};
const erro = (error: unknown) => (error instanceof Error ? error.message.replace(/^Forbidden: ?/, "") : "Não foi possível concluir.");

/** Automações comerciais internas (só administrador). Nada aqui envia mensagem ao cliente nem mexe no Omie. */
export function AutomacoesPanel() {
  const qc = useQueryClient();
  const get = useServerFn(getAutomations);
  const q = useQuery({ queryKey: ["interno", "automacoes"], queryFn: () => get() });
  const saveSwitch = useServerFn(saveAutomationSwitch);
  const runNow = useServerFn(runAutomationsNow);
  const refresh = () => qc.invalidateQueries({ queryKey: ["interno", "automacoes"] });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => saveSwitch({ data: { enabled, revision: q.data?.revision ?? 1 } }),
    onSuccess: (r) => {
      toast.success(r.enabled ? "Automações ligadas." : "Automações desligadas.");
      void refresh();
    },
    onError: (e) => toast.error(erro(e)),
  });
  const run = useMutation({
    mutationFn: () => runNow(),
    onSuccess: (s) => {
      toast.success(`Rodada concluída: ${s.created} criada(s), ${s.simulated} simulada(s), ${s.duplicates} repetida(s), ${s.errors} erro(s).`);
      void refresh();
    },
    onError: (e) => toast.error(erro(e)),
  });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error} />;
  const d = q.data;
  const avisos = d.runs.filter((r) => r.action === "aviso_gestor" && r.outcome === "aviso");
  return (
    <>
      <PageTitle title="Automações comerciais">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-sm font-semibold ${d.enabled ? "bg-success text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
            {d.enabled ? "Ligadas" : "Desligadas"}
          </span>
          <Button variant={d.enabled ? "outline" : "default"} size="sm" disabled={toggle.isPending} onClick={() => toggle.mutate(!d.enabled)}>
            {d.enabled ? "Desligar todas" : "Ligar as automações"}
          </Button>
          <Button variant="outline" size="sm" disabled={run.isPending} onClick={() => run.mutate()}>
            {run.isPending ? "Rodando…" : "Rodar agora"}
          </Button>
        </div>
      </PageTitle>
      <p className="mb-5 max-w-3xl text-sm text-muted-foreground">
        Só tarefas e avisos internos: nada é enviado ao cliente, nenhuma etapa muda e o Omie não é tocado. Cada regra começa desligada; deixe em
        Simulação para ver o que aconteceria e só depois passe para Ativa. Com o interruptor geral desligado, a agenda (a cada 10 min) não roda nada.
      </p>
      <div className="grid gap-4">
        {d.rules.map((rule) => (
          <RuleCard key={rule.id} rule={rule} data={d} onChange={refresh} />
        ))}
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card title={`Avisos para o gestor (7 dias): ${avisos.length}`}>
          {!avisos.length && <p className="text-sm text-muted-foreground">Nenhum aviso.</p>}
          <ul className="divide-y text-sm">
            {avisos.slice(0, 30).map((r) => (
              <li key={r.id} className="py-2">
                <p className="font-medium">{r.title} <span className="font-normal text-muted-foreground">· {r.ownerName}</span></p>
                <p className="text-xs text-muted-foreground">{r.reason} · {fmtDate(r.at)}</p>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Rodadas recentes">
          {!d.executions.length && <p className="text-sm text-muted-foreground">Nenhuma rodada ainda.</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr><th className="py-1 pr-2">Quando</th><th className="pr-2">Origem</th><th className="pr-2">Criadas</th><th className="pr-2">Simuladas</th><th className="pr-2">Repetidas</th><th className="pr-2">Fora do horário</th><th>Erros</th></tr>
              </thead>
              <tbody className="divide-y tabular-nums">
                {d.executions.map((e) => (
                  <tr key={e.id} title={e.note ?? undefined}>
                    <td className="py-1.5 pr-2">{fmtDate(e.startedAt)}</td>
                    <td className="pr-2">{e.origin === "manual" ? "manual" : "agenda"}</td>
                    <td className="pr-2">{e.created}</td>
                    <td className="pr-2">{e.simulated}</td>
                    <td className="pr-2">{e.duplicates}</td>
                    <td className="pr-2">{e.outsideHours}</td>
                    <td className={e.errors ? "font-semibold text-destructive" : ""}>{e.errors}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}

function RuleCard({ rule, data, onChange }: { rule: Rule; data: Data; onChange: () => void }) {
  const setMode = useServerFn(setAutomationMode);
  const preview = useServerFn(previewAutomationRule);
  const [editing, setEditing] = useState(false);
  const [simulation, setSimulation] = useState<Awaited<ReturnType<typeof previewAutomationRule>> | null>(null);
  const mode = useMutation({
    mutationFn: (next: Rule["mode"]) => setMode({ data: { id: rule.id, revision: rule.revision, mode: next } }),
    onSuccess: (r) => {
      toast.success(`${r.name}: ${MODOS.find((m) => m.id === r.mode)?.label}.`);
      onChange();
    },
    onError: (e) => toast.error(erro(e)),
  });
  const simulate = useMutation({
    mutationFn: () => preview({ data: { id: rule.id } }),
    onSuccess: setSimulation,
    onError: (e) => toast.error(erro(e)),
  });
  const recent = data.runs.filter((r) => r.ruleId === rule.id).slice(0, 5);
  return (
    <section className="rounded-md border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold">{rule.name}</h2>
          <p className="text-sm text-muted-foreground">
            {data.labels.triggers[rule.trigger]} · {prazo(rule.delayAmount, rule.delayUnit)} · {data.labels.actions[rule.action]}
            {rule.taskLabel ? ` (“${rule.taskLabel}”)` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            {rule.businessDaysOnly ? "seg–sex" : "todos os dias"} · {rule.businessHoursOnly ? "08h–18h" : "qualquer hora"} · repete no máximo a cada {rule.dedupeHours} h
            {rule.origin !== "todas" ? ` · origem ${rule.origin}` : ""}
            {rule.minValueCents ? ` · a partir de ${(rule.minValueCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}` : ""}
            {rule.ownerScope !== "todos" ? ` · só ${data.owners.find((o) => o.id === rule.ownerScope)?.name ?? "um responsável"}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label={`Modo de ${rule.name}`}>
          {MODOS.map((m) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={rule.mode === m.id}
              disabled={mode.isPending || rule.mode === m.id}
              onClick={() => mode.mutate(m.id)}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${rule.mode === m.id ? (m.id === "ativa" ? "border-success bg-success text-primary-foreground" : m.id === "simulacao" ? "border-amber-500 bg-amber-50 text-amber-950" : "border-muted bg-muted") : "bg-card hover:bg-accent"}`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={simulate.isPending} onClick={() => simulate.mutate()}>
          {simulate.isPending ? "Simulando…" : "Simular agora"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(!editing)}>{editing ? "Fechar edição" : "Editar"}</Button>
      </div>
      {simulation && (
        <div className="mt-3 rounded-md border bg-surface p-3 text-sm">
          <p className="font-medium">
            {simulation.total} oportunidade(s) agora{simulation.total > simulation.limitePorRodada ? ` (no máximo ${simulation.limitePorRodada} por rodada)` : ""}
            {!simulation.dentroDoHorario && " · fora do horário desta regra: a agenda esperaria"}
          </p>
          {simulation.observacao && <p className="text-xs text-muted-foreground">{simulation.observacao}</p>}
          <ul className="mt-2 divide-y">
            {simulation.itens.map((i) => (
              <li key={i.opportunityId} className="py-1.5">
                {i.title} <span className="text-muted-foreground">· {i.ownerName} · {i.reason}{i.jaFeito ? " · já tratada nesta janela" : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {editing && <RuleForm rule={rule} data={data} onSaved={() => { setEditing(false); onChange(); }} />}
      {recent.length > 0 && (
        <ul className="mt-3 space-y-0.5 text-xs text-muted-foreground">
          {recent.map((r) => (
            <li key={r.id}>{fmtDate(r.at)} · {r.title} · {RESULTADO[r.outcome] ?? r.outcome}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RuleForm({ rule, data, onSaved }: { rule: Rule; data: Data; onSaved: () => void }) {
  const save = useServerFn(saveAutomationRule);
  const [form, setForm] = useState({
    name: rule.name, delayAmount: String(rule.delayAmount), delayUnit: rule.delayUnit, action: rule.action, taskLabel: rule.taskLabel,
    origin: rule.origin, minValue: rule.minValueCents ? String(rule.minValueCents / 100) : "", ownerScope: rule.ownerScope, unitScope: rule.unitScope,
    businessHoursOnly: rule.businessHoursOnly, businessDaysOnly: rule.businessDaysOnly, dedupeHours: String(rule.dedupeHours),
  });
  const set = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }));
  const mutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          id: rule.id, revision: rule.revision, name: form.name, trigger: rule.trigger, delayAmount: Number(form.delayAmount), delayUnit: form.delayUnit,
          origin: form.origin, minValueCents: Math.round(Number((form.minValue || "0").replace(",", ".")) * 100), ownerScope: form.ownerScope,
          unitScope: form.unitScope, action: form.action, taskLabel: form.taskLabel, businessHoursOnly: form.businessHoursOnly,
          businessDaysOnly: form.businessDaysOnly, dedupeHours: Number(form.dedupeHours),
        },
      }),
    onSuccess: () => {
      toast.success("Regra salva.");
      onSaved();
    },
    onError: (e) => toast.error(erro(e)),
  });
  const field = "mt-1 block h-9 w-full rounded-md border bg-card px-2 text-sm";
  return (
    <form
      className="mt-3 grid gap-3 rounded-md border p-3 text-sm sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
    >
      <label className="sm:col-span-2">Nome<input className={field} value={form.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} /></label>
      <label>Depois de
        <span className="mt-1 flex gap-2">
          <input className={`${field} mt-0`} inputMode="numeric" value={form.delayAmount} onChange={(e) => set({ delayAmount: e.target.value })} />
          <select className={`${field} mt-0`} value={form.delayUnit} onChange={(e) => set({ delayUnit: e.target.value as Rule["delayUnit"] })}>
            <option value="minutos">minutos</option><option value="horas">horas</option><option value="dias">dias</option>
          </select>
        </span>
      </label>
      <label>Ação
        <select className={field} value={form.action} onChange={(e) => set({ action: e.target.value as Rule["action"] })}>
          {Object.entries(data.labels.actions).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </label>
      <label className="sm:col-span-2">Texto da tarefa (quando cria tarefa)<input className={field} value={form.taskLabel} maxLength={120} onChange={(e) => set({ taskLabel: e.target.value })} /></label>
      <label>Origem
        <select className={field} value={form.origin} onChange={(e) => set({ origin: e.target.value as Rule["origin"] })}>
          {ORIGENS.map((o) => <option key={o} value={o}>{o === "todas" ? "Todas" : o}</option>)}
        </select>
      </label>
      <label>Valor mínimo (R$)<input className={field} inputMode="decimal" value={form.minValue} placeholder="0" onChange={(e) => set({ minValue: e.target.value })} /></label>
      <label>Responsável
        <select className={field} value={form.ownerScope} onChange={(e) => set({ ownerScope: e.target.value })}>
          <option value="todos">Todos</option>
          {data.owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </label>
      <label>Unidade
        <select className={field} value={form.unitScope} onChange={(e) => set({ unitScope: e.target.value })}>
          <option value="todas">Todas</option>
          {data.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </label>
      <label>Repetir no máximo a cada (horas)<input className={field} inputMode="numeric" value={form.dedupeHours} onChange={(e) => set({ dedupeHours: e.target.value })} /></label>
      <div className="flex flex-col justify-end gap-1">
        <label className="inline-flex items-center gap-2"><input type="checkbox" checked={form.businessDaysOnly} onChange={(e) => set({ businessDaysOnly: e.target.checked })} /> Só de segunda a sexta</label>
        <label className="inline-flex items-center gap-2"><input type="checkbox" checked={form.businessHoursOnly} onChange={(e) => set({ businessHoursOnly: e.target.checked })} /> Só das 08h às 18h</label>
      </div>
      <div className="sm:col-span-2"><Button type="submit" size="sm" disabled={mutation.isPending}>{mutation.isPending ? "Salvando…" : "Salvar regra"}</Button></div>
    </form>
  );
}
