import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listApplications, APP_STATUS } from "@/lib/admin.functions";
import { listJobsAdmin } from "@/lib/hr.functions";
import { moveApplicationStage } from "@/lib/interviews.functions";
import { toast } from "sonner";
import {
  Loading,
  ErrorState,
  Empty,
  PageTitle,
  StatusBadge,
  StatusFilter,
  RetentionDate,
  fmtDate,
  tableCls,
} from "@/components/interno/ui";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const Route = createFileRoute("/_authenticated/interno/candidaturas/")({
  // ?vaga=<id> abre já filtrado (link do número de candidaturas na lista de vagas).
  validateSearch: (search: Record<string, unknown>): { vaga?: string } =>
    typeof search["vaga"] === "string" && UUID.test(search["vaga"]) ? { vaga: search["vaga"] } : {},
  component: AppsList,
});

type F = { nome: string; area: string; cidade: string; job_id: string; from: string; to: string };

function AppsList() {
  const fn = useServerFn(listApplications);
  const move = useServerFn(moveApplicationStage);
  const qc = useQueryClient();
  const jobsFn = useServerFn(listJobsAdmin);
  const { vaga } = Route.useSearch();
  const blank: F = { nome: "", area: "", cidade: "", job_id: vaga ?? "", from: "", to: "" };
  const [tab, setTab] = useState<"vagas" | "banco">("vagas");
  const [status, setStatus] = useState("");
  const [view, setView] = useState<"list" | "board">("board");
  const [moving, setMoving] = useState<string | null>(null);
  const [over, setOver] = useState("");
  const [draft, setDraft] = useState<F>(blank);
  const [f, setF] = useState<F>(blank);
  const jobs = useQuery({ queryKey: ["interno", "jobs"], queryFn: () => jobsFn() });
  const query = useQuery({
    queryKey: ["interno", "apps", tab, status, f],
    queryFn: () =>
      fn({
        data: {
          tab,
          status: status || undefined,
          nome: f.nome || undefined,
          area: f.area || undefined,
          cidade: f.cidade || undefined,
          job_id: tab === "vagas" && f.job_id ? f.job_id : undefined,
          from: f.from || undefined,
          to: f.to || undefined,
        },
      }),
  });
  const input = "h-10 rounded-md border bg-card px-3 text-sm";
  const filtered = status || Object.values(f).some(Boolean);
  const applications = query.data ?? [];
  const changeStage = async (id: string, next: string) => {
    const row = query.data?.find((r) => r.id === id);
    if (!row || row.status === next || moving) return;
    setMoving(id);
    try {
      await move({
        data: {
          id,
          from: row.status as (typeof APP_STATUS)[number],
          to: next as (typeof APP_STATUS)[number],
        },
      });
      await qc.invalidateQueries({ queryKey: ["interno"] });
      toast.success("Etapa atualizada");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível mover a candidatura");
      await query.refetch();
    } finally {
      setMoving(null);
      setOver("");
    }
  };
  return (
    <>
      <PageTitle title="Candidaturas e talentos">
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/interno/entrevistas" className="rounded-md border bg-card px-3 py-2 text-sm">
            Agenda de entrevistas
          </Link>
          <div className="flex rounded-md border bg-card p-1" aria-label="Visualização">
            {(["board", "list"] as const).map((v) => (
              <button
                type="button"
                key={v}
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={`rounded px-3 py-1.5 text-xs font-semibold ${view === v ? "bg-brand text-white" : "text-muted-foreground"}`}
              >
                {v === "board" ? "Funil" : "Lista"}
              </button>
            ))}
          </div>
        </div>
      </PageTitle>
      <div role="tablist" className="mb-4 flex gap-1 border-b">
        {(["vagas", "banco"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`border-b-2 px-4 py-2 text-sm font-semibold ${tab === t ? "border-brand" : "border-transparent text-muted-foreground"}`}
          >
            {t === "vagas" ? "Vagas" : "Banco de talentos"}
          </button>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setF(draft);
        }}
        className="mb-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-7"
      >
        {tab === "vagas" ? (
          <select
            className={input}
            aria-label="Vaga"
            value={draft.job_id}
            onChange={(e) => setDraft({ ...draft, job_id: e.target.value })}
          >
            <option value="">Todas as vagas</option>
            {jobs.data?.map((j) => (
              <option key={j.id} value={j.id}>
                {j.title}
                {j.status !== "publicada" ? ` (${j.status})` : ""}
              </option>
            ))}
          </select>
        ) : (
          <input
            className={input}
            placeholder="Área"
            value={draft.area}
            onChange={(e) => setDraft({ ...draft, area: e.target.value })}
          />
        )}
        <input
          className={input}
          placeholder="Nome"
          value={draft.nome}
          onChange={(e) => setDraft({ ...draft, nome: e.target.value })}
        />
        <input
          className={input}
          placeholder="Cidade"
          value={draft.cidade}
          onChange={(e) => setDraft({ ...draft, cidade: e.target.value })}
        />
        <input
          className={input}
          type="date"
          aria-label="De"
          value={draft.from}
          onChange={(e) => setDraft({ ...draft, from: e.target.value })}
        />
        <input
          className={input}
          type="date"
          aria-label="Até"
          value={draft.to}
          onChange={(e) => setDraft({ ...draft, to: e.target.value })}
        />
        <button className="h-10 rounded-md bg-graphite px-4 text-sm font-semibold text-graphite-foreground">
          Filtrar
        </button>
        {filtered && (
          <button
            type="button"
            className="h-10 rounded-md border px-4 text-sm"
            onClick={() => {
              const empty = { ...blank, job_id: "" };
              setDraft(empty);
              setF(empty);
              setStatus("");
            }}
          >
            Limpar
          </button>
        )}
      </form>
      <StatusFilter value={status} options={APP_STATUS} onChange={setStatus} />
      <div className="mt-4">
        {query.isLoading ? (
          <Loading />
        ) : query.isError ? (
          <ErrorState error={query.error} />
        ) : !query.data?.length ? (
          <Empty>
            {filtered
              ? "Não há candidaturas para este filtro."
              : tab === "banco"
                ? "Nenhum perfil no banco de talentos ainda."
                : "Nenhuma candidatura recebida ainda."}
          </Empty>
        ) : view === "board" ? (
          <div>
            <p className="mb-3 text-xs text-muted-foreground">
              Arraste um cartão para mudar de etapa ou use a seleção no cartão. A mudança de etapa
              preserva os consentimentos registrados.
            </p>
            <div className="flex gap-3 overflow-x-auto pb-4" aria-label="Funil de candidaturas">
              {APP_STATUS.map((stage) => {
                const items = applications.filter((r) => r.status === stage);
                return (
                  <section
                    key={stage}
                    aria-label={stage}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (!moving) setOver(stage);
                    }}
                    onDragLeave={() => setOver("")}
                    onDrop={(e) => {
                      e.preventDefault();
                      const id = e.dataTransfer.getData("text/plain");
                      void changeStage(id, stage);
                    }}
                    className={`w-[250px] shrink-0 rounded-lg border p-2.5 ${over === stage ? "border-brand bg-brand-soft" : "border-transparent bg-muted/80"}`}
                  >
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {stage}
                      </h2>
                      <span className="rounded-full bg-card px-2 py-0.5 text-xs font-semibold">
                        {items.length}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {items.map((r) => (
                        <article
                          key={r.id}
                          draggable={!moving}
                          onDragStart={(e) => {
                            e.dataTransfer.setData("text/plain", r.id);
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          className={`rounded-md border bg-card p-3 shadow-sm ${moving === r.id ? "opacity-50" : ""}`}
                        >
                          <Link
                            to="/interno/candidaturas/$id"
                            params={{ id: r.id }}
                            className="block font-semibold text-brand hover:underline"
                          >
                            {r.nome}
                          </Link>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {r.job_title ?? r.area_interesse ?? "Banco de talentos"}
                          </p>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {r.cidade} · {fmtDate(r.created_at)}
                          </p>
                          <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                            {r.protocolo}
                          </p>
                          <label className="mt-3 block text-[11px] text-muted-foreground">
                            Mover para
                            <select
                              aria-label={`Etapa de ${r.nome}`}
                              disabled={!!moving}
                              value={r.status}
                              onChange={(e) => void changeStage(r.id, e.target.value)}
                              className="mt-1 h-8 w-full rounded border bg-card px-2 text-xs text-foreground"
                            >
                              {APP_STATUS.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                          </label>
                          {r.expires_at && (
                            <p className="mt-2 text-[11px] text-muted-foreground">
                              Revisão: <RetentionDate iso={r.expires_at} />
                            </p>
                          )}
                        </article>
                      ))}
                      {!items.length && (
                        <p className="rounded border border-dashed px-3 py-7 text-center text-xs text-muted-foreground">
                          Sem candidaturas
                        </p>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border bg-card">
            <table className={tableCls}>
              <thead>
                <tr>
                  <th>Protocolo</th>
                  <th>Data</th>
                  <th>Nome</th>
                  {tab === "vagas" ? <th>Vaga</th> : <th>Área</th>}
                  <th>Cidade</th>
                  <th>Status</th>
                  <th title="Prevista pela política de retenção; nada é apagado automaticamente">
                    Expiração
                  </th>
                </tr>
              </thead>
              <tbody>
                {query.data.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link
                        to="/interno/candidaturas/$id"
                        params={{ id: r.id }}
                        className="font-mono font-semibold text-brand"
                      >
                        {r.protocolo}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap">{fmtDate(r.created_at)}</td>
                    <td>
                      {r.nome}
                      {r.talent_bank && tab === "vagas" && (
                        <span className="ml-2 rounded-sm bg-accent px-1.5 py-0.5 text-[10px] font-semibold uppercase">
                          + banco
                        </span>
                      )}
                    </td>
                    <td>
                      {tab === "vagas"
                        ? (r.job_title ?? "-")
                        : (r.area_interesse ?? (r.job_title ? `Vaga: ${r.job_title}` : "-"))}
                    </td>
                    <td>{r.cidade ?? "-"}</td>
                    <td>
                      <StatusBadge s={r.status} />
                    </td>
                    <td className="whitespace-nowrap">
                      <RetentionDate iso={r.expires_at} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
