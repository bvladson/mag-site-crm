import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  getDiscountPolicy,
  setDiscountPolicy,
  getDiscountQueue,
  decideQuoteDiscount,
  getQuoteDiscount,
  requestQuoteDiscount,
} from "@/lib/discounts.functions";
import {
  discountAuthority,
  discountBasisPoints,
  DISCOUNT_LABELS,
  type DiscountPolicy,
} from "@/lib/discounts";
import { Loading, ErrorState, Card, useMe, fmtDate, StatusBadge } from "./ui";
import { Button } from "@/components/ui/button";
const field = "mt-1 h-10 w-full rounded-md border bg-card px-3 text-sm";
export function useQuoteDiscount(id: string) {
  const fn = useServerFn(getQuoteDiscount);
  return useQuery({
    queryKey: ["interno", "quote-discount", id],
    queryFn: () => fn({ data: { id } }),
  });
}
export function QuoteDiscountPanel({ id, dirty = false }: { id: string; dirty?: boolean }) {
  const q = useQuoteDiscount(id),
    request = useServerFn(requestQuoteDiscount),
    qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  if (q.isLoading) return <p className="my-4 text-xs text-muted-foreground">Conferindo alçada…</p>;
  if (q.isError) return <ErrorState error={q.error} />;
  if (!q.data?.enabled) return null;
  const d = q.data,
    allowed = ["livre", "aprovado"].includes(d.state);
  return (
    <section
      aria-label="Aprovação do desconto"
      className={`my-5 rounded-lg border p-4 ${allowed ? "border-emerald-200 bg-emerald-50" : "border-amber-300 bg-amber-50"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">
            Descontos: {(d.basisPoints / 100).toLocaleString("pt-BR")}% ·{" "}
            {d.state === "aprovado" ? "Aprovado" : d.label}
          </h2>
          <p className="mt-1 text-xs">
            {allowed
              ? "A análise corresponde aos valores salvos. Alterações exigem nova conferência."
              : d.state === "bloqueado"
                ? "Reduza o desconto: ele supera o limite máximo."
                : d.state === "pendente"
                  ? "Aguardando análise. O envio, download para distribuição e aceite estão bloqueados."
                  : "Salve os valores e solicite aprovação antes de enviar."}
          </p>
          {d.reason && <p className="mt-2 text-xs">Justificativa: {d.reason}</p>}
          {dirty && (
            <p className="mt-2 text-xs font-semibold">
              Salve as alterações da tela para recalcular a alçada.
            </p>
          )}
        </div>
        {!allowed && !["pendente", "bloqueado"].includes(d.state) && (
          <Button
            disabled={busy || dirty}
            size="sm"
            onClick={async () => {
              setBusy(true);
              try {
                await request({ data: { id } });
                await qc.invalidateQueries({ queryKey: ["interno"] });
                toast.success("Aprovação solicitada");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Não foi possível solicitar");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Solicitando…" : "Solicitar aprovação"}
          </Button>
        )}
      </div>
    </section>
  );
}
export function DiscountLineWarning({
  id,
  gross,
  discount,
  percentage,
}: {
  id: string;
  gross: number;
  discount: number;
  percentage?: number | undefined;
}) {
  const q = useQuoteDiscount(id);
  if (!q.data?.enabled) return null;
  const bp =
    percentage === undefined ? discountBasisPoints(discount, gross) : Math.round(percentage * 100);
  if (bp <= Math.round(q.data.ownerLimit * 100)) return null;
  return (
    <span className="mt-1 block text-[10px] font-semibold text-amber-800">
      {DISCOUNT_LABELS[discountAuthority(bp, q.data.policy)]}
    </span>
  );
}
export function DiscountSettingsPanel() {
  const me = useMe(),
    load = useServerFn(getDiscountPolicy),
    list = useServerFn(getDiscountQueue);
  const p = useQuery({ queryKey: ["interno", "discount-policy"], queryFn: () => load() }),
    q = useQuery({ queryKey: ["interno", "discount-queue"], queryFn: () => list() });
  if (p.isLoading || q.isLoading) return <Loading />;
  if (p.isError || q.isError) return <ErrorState error={p.error ?? q.error} />;
  return (
    <div className="space-y-5">
      <PolicyForm
        key={p.data!.revision}
        initial={p.data!}
        admin={!!me.data?.roles.includes("admin")}
      />
      <Queue rows={q.data!} />
    </div>
  );
}
function PolicyForm({ initial, admin }: { initial: DiscountPolicy; admin: boolean }) {
  const [p, setP] = useState(initial),
    [sample, setSample] = useState("7"),
    [busy, setBusy] = useState(false);
  const save = useServerFn(setDiscountPolicy),
    qc = useQueryClient();
  const valid =
    [p.consultor, p.gerente, p.diretoria].every(Number.isFinite) &&
    p.consultor >= 0 &&
    p.consultor <= p.gerente &&
    p.gerente <= p.diretoria &&
    p.diretoria <= 100;
  return (
    <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <Card title="Alçadas de desconto">
        <p className="mb-4 text-sm text-muted-foreground">
          O sistema confere cada item, o desconto geral e seu efeito acumulado. Diretoria
          corresponde ao perfil Admin.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await save({ data: p });
              await qc.invalidateQueries({ queryKey: ["interno"] });
              toast.success("Alçadas salvas");
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Não foi possível salvar");
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ["consultor", "Consultor aplica até"],
                ["gerente", "Gerente aprova até"],
                ["diretoria", "Diretoria aprova até"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="text-sm">
                {label} (%)
                <input
                  aria-label={label}
                  required
                  readOnly={!admin}
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={p[key]}
                  onChange={(e) => setP({ ...p, [key]: Number(e.target.value) })}
                  className={field}
                />
              </label>
            ))}
          </div>
          <label className="mt-5 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              disabled={!admin}
              checked={p.enabled}
              onChange={(e) => setP({ ...p, enabled: e.target.checked })}
            />
            Ativar alçadas e bloqueios de envio
          </label>
          {!initial.enabled && (
            <p className="mt-2 text-xs text-amber-800">
              Bloqueios desativados. Confirme os limites reais da MAG antes de ativar.
            </p>
          )}
          {!valid && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              Use limites crescentes entre 0% e 100%.
            </p>
          )}
          {admin && (
            <Button type="submit" className="mt-4" disabled={busy || !valid}>
              {busy ? "Salvando…" : "Salvar alçadas"}
            </Button>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Alterar a política exige nova análise dos descontos sujeitos à aprovação. O histórico é
            preservado.
          </p>
        </form>
      </Card>
      <Card title="Simular">
        <label className="text-sm">
          Percentual aplicado pelo Consultor
          <input
            aria-label="Percentual para simulação"
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={sample}
            onChange={(e) => setSample(e.target.value)}
            className={field}
          />
        </label>
        <p aria-live="polite" className="mt-4 rounded bg-muted p-3 text-sm font-semibold">
          {Number.isFinite(Number(sample)) && Number(sample) >= 0 && Number(sample) <= 100
            ? DISCOUNT_LABELS[discountAuthority(Math.round(Number(sample) * 100), p)]
            : "Informe um percentual de 0 a 100"}
        </p>
      </Card>
    </div>
  );
}
type Requests = Awaited<ReturnType<typeof getDiscountQueue>>;
function Queue({ rows }: { rows: Requests }) {
  const decide = useServerFn(decideQuoteDiscount),
    qc = useQueryClient();
  const [history, setHistory] = useState(false),
    [selected, setSelected] = useState<string | null>(null),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false);
  const act = async (id: string, decision: "aprovado" | "recusado") => {
    setBusy(true);
    try {
      await decide({ data: { id, decision, reason } });
      await qc.invalidateQueries({ queryKey: ["interno"] });
      setSelected(null);
      setReason("");
      toast.success(decision === "aprovado" ? "Desconto aprovado" : "Desconto recusado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível analisar");
    } finally {
      setBusy(false);
    }
  };
  const visible = rows.filter((r) => history || r.state === "pendente");
  return (
    <Card title="Aprovações de desconto">
      <label className="mb-4 flex items-center gap-2 text-xs">
        <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} />
        Mostrar histórico e solicitações substituídas
      </label>
      {!visible.length ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhuma aprovação pendente.
        </p>
      ) : (
        <ul className="space-y-3">
          {visible.map((r) => (
            <li key={r.id} className="rounded border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <b className="font-mono text-sm">{r.number}</b>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {r.owner} · versão do orçamento {r.quoteVersion} · {fmtDate(r.requestedAt)}
                  </p>
                  <p className="mt-2 text-sm">
                    {(r.basisPoints / 100).toLocaleString("pt-BR")}% ·{" "}
                    {r.required === "gerente" ? "Gerente" : "Diretoria"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge s={r.state} />
                  {r.canDecide && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setSelected(r.id);
                        setReason("");
                      }}
                    >
                      Analisar
                    </Button>
                  )}
                </div>
              </div>
              {r.reason && <p className="mt-3 text-sm">{r.reason}</p>}
              {selected === r.id && (
                <div className="mt-4 border-t pt-3">
                  <label className="block text-sm">
                    Justificativa da decisão
                    <textarea
                      rows={2}
                      maxLength={1000}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      className="mt-1 w-full rounded border p-2"
                    />
                  </label>
                  <div className="mt-3 flex gap-2">
                    <Button
                      disabled={busy || !reason.trim()}
                      onClick={() => void act(r.id, "aprovado")}
                    >
                      Aprovar
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy || !reason.trim()}
                      onClick={() => void act(r.id, "recusado")}
                    >
                      Recusar
                    </Button>
                    <Button variant="ghost" disabled={busy} onClick={() => setSelected(null)}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
