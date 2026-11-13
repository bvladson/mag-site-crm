import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarDays, Plus, Pencil, Video } from "lucide-react";
import { toast } from "sonner";
import { getInterviewOptions, listInterviews, saveInterview } from "@/lib/interviews.functions";
import {
  INTERVIEW_STATUS,
  interviewLocalTime,
  type Interview,
  type InterviewInput,
} from "@/lib/interviews";
import { useMe, Card, Loading, ErrorState, Empty, StatusBadge, tableCls } from "./ui";
import { Button } from "@/components/ui/button";

const inputClass = "mt-1 h-10 w-full rounded-md border bg-card px-3 text-sm";
const fmt = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Fortaleza",
  });
const asInput = (r: Interview): InterviewInput => ({
  id: r.id,
  revision: r.revision,
  applicationId: r.applicationId,
  interviewerId: r.interviewerId,
  unitId: r.unitId,
  online: r.online,
  location: r.location,
  meetingUrl: r.meetingUrl,
  startsAt: interviewLocalTime(r.startsAt),
  duration: r.duration,
  status: r.status,
  rating: r.rating,
  notes: r.notes,
});

export function InterviewPanel({ applicationId }: { applicationId?: string }) {
  const me = useMe();
  const qc = useQueryClient();
  const load = useServerFn(listInterviews);
  const choices = useServerFn(getInterviewOptions);
  const save = useServerFn(saveInterview);
  const query = useQuery({
    queryKey: ["interno", "interviews", applicationId ?? "all"],
    queryFn: () => load({ data: { applicationId } }),
  });
  const options = useQuery({
    queryKey: ["interno", "interview-options"],
    queryFn: () => choices(),
  });
  const [draft, setDraft] = useState<InterviewInput | null>(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("");
  const [term, setTerm] = useState("");
  const [candidateTerm, setCandidateTerm] = useState("");
  const startNew = () => {
    const opts = options.data;
    if (!opts) return;
    setDraft({
      revision: 0,
      applicationId: applicationId ?? "",
      interviewerId:
        opts.interviewers.find((u) => u.id === me.data?.id)?.id ?? opts.interviewers[0]?.id ?? "",
      unitId: opts.units[0]?.id ?? null,
      online: false,
      location: "",
      meetingUrl: "",
      startsAt: "",
      duration: 60,
      status: "agendada",
      rating: null,
      notes: "",
    });
    setCandidateTerm("");
  };
  if (query.isLoading || options.isLoading) return <Loading />;
  if (query.isError || options.isError) return <ErrorState error={query.error ?? options.error} />;
  const opts = options.data!;
  const rows =
    query.data?.filter(
      (r) =>
        (!filter || r.status === filter) &&
        (!term ||
          `${r.candidate} ${r.protocol} ${r.job} ${r.interviewer}`
            .toLocaleLowerCase("pt-BR")
            .includes(term.toLocaleLowerCase("pt-BR"))),
    ) ?? [];
  const candidates = opts.candidates.filter(
    (c) =>
      !candidateTerm ||
      `${c.name} ${c.protocol}`
        .toLocaleLowerCase("pt-BR")
        .includes(candidateTerm.toLocaleLowerCase("pt-BR")),
  );
  const update = <K extends keyof InterviewInput>(key: K, value: InterviewInput[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <CalendarDays className="size-5 text-brand" />
            Agenda e avaliações
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Horários de Fortaleza · alterações ficam registradas no histórico.
          </p>
        </div>
        <Button onClick={startNew} disabled={!opts.candidates.length || !opts.interviewers.length}>
          <Plus />
          Agendar entrevista
        </Button>
      </div>
      <div className={`grid gap-5 ${draft ? "xl:grid-cols-[minmax(0,1fr)_360px]" : ""}`}>
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap gap-2">
            <input
              aria-label="Buscar entrevista"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Candidato, protocolo ou entrevistador"
              className="h-10 min-w-0 flex-1 rounded-md border bg-card px-3 text-sm"
            />
            <select
              aria-label="Situação da entrevista"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="h-10 rounded-md border bg-card px-3 text-sm"
            >
              <option value="">Todas as situações</option>
              {INTERVIEW_STATUS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          {!rows.length ? (
            <Empty>
              {query.data?.length
                ? "Nenhuma entrevista neste filtro."
                : "Nenhuma entrevista agendada ainda."}
            </Empty>
          ) : (
            <div className="overflow-x-auto rounded-lg border bg-card">
              <table className={tableCls}>
                <thead>
                  <tr>
                    <th>Candidato</th>
                    <th>Quando</th>
                    <th>Local e responsável</th>
                    <th>Situação</th>
                    <th>Avaliação</th>
                  <th scope="col" aria-label="Ações" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link
                          to="/interno/candidaturas/$id"
                          params={{ id: r.applicationId }}
                          className="font-semibold text-brand"
                        >
                          {r.candidate}
                        </Link>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {r.job} · {r.protocol}
                        </span>
                      </td>
                      <td className="whitespace-nowrap">
                        {fmt(r.startsAt)}
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {r.duration} minutos
                        </span>
                      </td>
                      <td>
                        <span className="block">
                          {r.online ? "Online" : r.unitName}
                          {r.location && r.location !== r.unitName ? ` · ${r.location}` : ""}
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {r.interviewer}
                        </span>
                        {r.online && r.meetingUrl && (
                          <a
                            href={r.meetingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1 inline-flex items-center gap-1 text-xs text-brand underline"
                          >
                            <Video className="size-3" />
                            Abrir reunião
                          </a>
                        )}
                      </td>
                      <td>
                        <StatusBadge s={r.status} />
                      </td>
                      <td>
                        {r.status === "realizada" ? (
                          r.rating ? (
                            <span
                              aria-label={`Nota ${r.rating} de 5`}
                              className="whitespace-nowrap text-amber-700"
                            >
                              {"★".repeat(r.rating)}
                              {"☆".repeat(5 - r.rating)}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">A avaliar</span>
                          )
                        ) : (
                          <span className="text-xs text-muted-foreground">Após realização</span>
                        )}
                      </td>
                      <td>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setDraft(asInput(r));
                            setCandidateTerm("");
                          }}
                          aria-label={`Editar entrevista de ${r.candidate}`}
                        >
                          <Pencil />
                          Editar
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {draft && (
          <Card title={draft.id ? "Editar entrevista" : "Agendar entrevista"}>
            <form
              className="space-y-3"
              onSubmit={async (e) => {
                e.preventDefault();
                setSaving(true);
                try {
                  await save({ data: draft });
                  setDraft(null);
                  await qc.invalidateQueries({ queryKey: ["interno"] });
                  toast.success("Entrevista salva");
                } catch (err) {
                  toast.error(
                    err instanceof Error ? err.message : "Não foi possível salvar a entrevista",
                  );
                } finally {
                  setSaving(false);
                }
              }}
            >
              {!draft.id && !applicationId && (
                <label className="block text-sm">
                  Buscar candidato
                  <input
                    value={candidateTerm}
                    onChange={(e) => setCandidateTerm(e.target.value)}
                    className={inputClass}
                    placeholder="Nome ou protocolo"
                  />
                </label>
              )}
              <label className="block text-sm">
                Candidato
                <select
                  aria-label="Candidato"
                  required
                  disabled={!!draft.id || !!applicationId}
                  value={draft.applicationId}
                  onChange={(e) => update("applicationId", e.target.value)}
                  className={inputClass}
                >
                  <option value="">Selecione</option>
                  {(draft.id || applicationId ? opts.candidates : candidates).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.protocol}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                Entrevistador
                <select
                  aria-label="Entrevistador"
                  required
                  value={draft.interviewerId}
                  onChange={(e) => update("interviewerId", e.target.value)}
                  className={inputClass}
                >
                  <option value="">Selecione</option>
                  {opts.interviewers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                Data e hora — Fortaleza
                <input
                  aria-label="Data e hora — Fortaleza"
                  required
                  type="datetime-local"
                  value={draft.startsAt}
                  onChange={(e) => update("startsAt", e.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="block text-sm">
                Duração, em minutos
                <input
                  required
                  type="number"
                  min={15}
                  max={240}
                  step={15}
                  value={draft.duration}
                  onChange={(e) => update("duration", Number(e.target.value))}
                  className={inputClass}
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.online}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      online: e.target.checked,
                      unitId: e.target.checked ? null : (opts.units[0]?.id ?? null),
                      meetingUrl: e.target.checked ? draft.meetingUrl : "",
                      location: "",
                    })
                  }
                />
                Entrevista online
              </label>
              {draft.online ? (
                <label className="block text-sm">
                  Link da reunião
                  <input
                    type="url"
                    maxLength={1500}
                    placeholder="https://…"
                    value={draft.meetingUrl}
                    onChange={(e) => update("meetingUrl", e.target.value)}
                    className={inputClass}
                  />
                </label>
              ) : (
                <label className="block text-sm">
                  Unidade
                  <select
                    required
                    value={draft.unitId ?? ""}
                    onChange={(e) => update("unitId", e.target.value || null)}
                    className={inputClass}
                  >
                    <option value="">Selecione</option>
                    {draft.unitId && !opts.units.some((u) => u.id === draft.unitId) && (
                      <option value={draft.unitId}>Unidade inativa (histórico)</option>
                    )}
                    {opts.units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="block text-sm">
                {draft.online ? "Identificação da reunião" : "Sala ou ponto de encontro"}
                <input
                  maxLength={120}
                  value={draft.location}
                  onChange={(e) => update("location", e.target.value)}
                  className={inputClass}
                  placeholder={draft.online ? "Ex.: entrevista inicial" : "Ex.: sala de reuniões"}
                />
              </label>
              <label className="block text-sm">
                Situação
                <select
                  value={draft.status}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      status: e.target.value as InterviewInput["status"],
                      rating: e.target.value === "realizada" ? draft.rating : null,
                    })
                  }
                  className={inputClass}
                >
                  {INTERVIEW_STATUS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              {draft.status === "realizada" && (
                <fieldset>
                  <legend className="text-sm">Avaliação</legend>
                  <div className="mt-2 flex gap-2">
                    {[1, 2, 3, 4, 5].map((score) => (
                      <button
                        type="button"
                        key={score}
                        aria-label={`Nota ${score}`}
                        aria-pressed={draft.rating === score}
                        onClick={() => update("rating", draft.rating === score ? null : score)}
                        className={`size-10 rounded-md border text-lg ${draft.rating && draft.rating >= score ? "border-amber-500 bg-amber-50 text-amber-700" : "bg-card text-muted-foreground"}`}
                      >
                        ★
                      </button>
                    ))}
                  </div>
                </fieldset>
              )}
              <label className="block text-sm">
                Observações e avaliação
                <textarea
                  maxLength={5000}
                  rows={4}
                  value={draft.notes}
                  onChange={(e) => update("notes", e.target.value)}
                  className="mt-1 w-full rounded-md border bg-card p-3 text-sm"
                />
              </label>
              <div className="flex gap-2">
                <Button type="submit" disabled={saving}>
                  {saving ? "Salvando…" : "Salvar entrevista"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDraft(null)}
                  disabled={saving}
                >
                  Cancelar edição
                </Button>
              </div>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}
