import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ExternalLink } from "lucide-react";
import { getJobAdmin, saveJobAdmin, JOB_STATUS } from "@/lib/hr.functions";
import { careerAreas, WORK_MODELS, workModelLabel } from "@/config/careers";
import { Loading, ErrorState, Card, StatusBadge } from "@/components/interno/ui";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/interno/vagas/$id")({ component: JobEditor });

/** Instante salvo → "AAAA-MM-DD" do dia em Fortaleza (para o campo de data). */
const toDay = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Fortaleza" }) : "");
const CONTRACTS = ["CLT", "Estágio", "Jovem Aprendiz", "PJ", "Temporário"];

function JobEditor() {
  const { id } = Route.useParams();
  const isNew = id === "nova";
  const load = useServerFn(getJobAdmin);
  const save = useServerFn(saveJobAdmin);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const q = useQuery({ queryKey: ["interno", "job", id], queryFn: () => load({ data: { id } }), enabled: !isNew });
  if (!isNew && q.isLoading) return <Loading />;
  if (!isNew && (q.isError || !q.data)) return <ErrorState error={q.error} />;
  const job = isNew ? null : q.data!;
  const wasPublished = Boolean(job?.opened_at);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const get = (k: string) => String(fd.get(k) ?? "").trim();
    setSaving(true);
    try {
      const result = await save({
        data: {
          ...(job ? { id: job.id } : {}),
          title: get("title"), slug: get("slug") || undefined, area: get("area"), location: get("location"),
          work_model: get("work_model") as (typeof WORK_MODELS)[number] | "", contract_type: get("contract_type"), schedule: get("schedule"),
          summary: get("summary"), description: get("description"), responsibilities: get("responsibilities"),
          requirements: get("requirements"), differentials: get("differentials"),
          status: get("status") as (typeof JOB_STATUS)[number], opened_at: get("opened_at"), closes_at: get("closes_at"),
          priority: Number(get("priority") || 100),
        },
      });
      toast.success("Vaga salva");
      await qc.invalidateQueries({ queryKey: ["interno"] });
      if (isNew) navigate({ to: "/interno/vagas/$id", params: { id: result.id } });
    } catch (err) {
      // Regras do servidor (slug, prazo, estado) chegam como texto; erro de validação de campo vem em JSON.
      const message = err instanceof Error ? err.message : "";
      toast.error(message && !message.trim().startsWith("[") ? message : "Confira os campos: título com 3+ letras e datas válidas.");
    } finally {
      setSaving(false);
    }
  };

  const input = "mt-1 h-10 w-full rounded-md border bg-card px-3 text-sm";
  const area = "mt-1 w-full rounded-md border bg-card p-2 text-sm";
  return (
    <>
      <Link to="/interno/vagas" className="text-sm text-muted-foreground">← Vagas</Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-semibold">{job ? job.title : "Nova vaga"}</h1>
        {job && <StatusBadge s={job.status === "publicada" && !job.open ? "encerrada" : job.status} />}
        {job && job.status !== "rascunho" && (
          <a href={`/carreiras/vagas/${job.slug}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-sm text-brand underline">
            Ver no site <ExternalLink className="size-3.5" />
          </a>
        )}
      </div>
      <form key={job?.updated_at ?? "nova"} onSubmit={submit} className="mt-6 grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-5">
          <Card title="Vaga">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium sm:col-span-2">Título *<input name="title" required minLength={3} maxLength={120} defaultValue={job?.title ?? ""} className={input} /></label>
              <label className="block text-sm font-medium sm:col-span-2">Endereço (slug)
                <input name="slug" maxLength={80} defaultValue={job?.slug ?? ""} disabled={wasPublished} placeholder="gerado a partir do título" className={input} />
                <span className="text-xs text-muted-foreground">{wasPublished ? "Fixo: a vaga já foi publicada e o link pode ter sido compartilhado." : "/carreiras/vagas/… — letras minúsculas, números e hífens."}</span>
              </label>
              <label className="block text-sm font-medium">Área / departamento<input name="area" list="areas" maxLength={80} defaultValue={job?.area ?? ""} className={input} /></label>
              <label className="block text-sm font-medium">Local<input name="location" maxLength={120} defaultValue={job?.location ?? ""} placeholder="Fortaleza – CE" className={input} /></label>
              <label className="block text-sm font-medium">Modelo de trabalho
                <select name="work_model" defaultValue={job?.work_model ?? ""} className={input}>
                  <option value="">Não informado</option>
                  {WORK_MODELS.map((m) => <option key={m} value={m}>{workModelLabel[m]}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium">Tipo de contratação<input name="contract_type" list="contracts" maxLength={60} defaultValue={job?.contract_type ?? ""} className={input} /></label>
              <label className="block text-sm font-medium sm:col-span-2">Horário (opcional)<input name="schedule" maxLength={120} defaultValue={job?.schedule ?? ""} placeholder="Segunda a sexta, 8h às 18h" className={input} /></label>
            </div>
            <datalist id="areas">{careerAreas.map((a) => <option key={a} value={a} />)}</datalist>
            <datalist id="contracts">{CONTRACTS.map((c) => <option key={c} value={c} />)}</datalist>
          </Card>
          <Card title="Texto">
            <label className="block text-sm font-medium">Resumo (aparece na lista de vagas)<textarea name="summary" rows={2} maxLength={300} defaultValue={job?.summary ?? ""} className={area} /></label>
            <label className="mt-3 block text-sm font-medium">Descrição<textarea name="description" rows={6} maxLength={6000} defaultValue={job?.description ?? ""} className={area} /></label>
            <label className="mt-3 block text-sm font-medium">Responsabilidades <span className="font-normal text-muted-foreground">(um item por linha)</span><textarea name="responsibilities" rows={5} maxLength={4000} defaultValue={job?.responsibilities ?? ""} className={area} /></label>
            <label className="mt-3 block text-sm font-medium">Requisitos <span className="font-normal text-muted-foreground">(um item por linha)</span><textarea name="requirements" rows={5} maxLength={4000} defaultValue={job?.requirements ?? ""} className={area} /></label>
            <label className="mt-3 block text-sm font-medium">Diferenciais <span className="font-normal text-muted-foreground">(um item por linha)</span><textarea name="differentials" rows={4} maxLength={4000} defaultValue={job?.differentials ?? ""} className={area} /></label>
          </Card>
        </div>
        <div className="space-y-5">
          <Card title="Publicação">
            <label className="block text-sm font-medium">Status
              <select name="status" defaultValue={job?.status ?? "rascunho"} className={input}>
                {JOB_STATUS.filter((s) => !(wasPublished && s === "rascunho")).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="mt-3 block text-sm font-medium">Data de abertura<input name="opened_at" type="date" defaultValue={toDay(job?.opened_at)} className={input} />
              <span className="text-xs text-muted-foreground">Em branco: a data da primeira publicação.</span>
            </label>
            <label className="mt-3 block text-sm font-medium">Inscrições até (opcional)<input name="closes_at" type="date" defaultValue={toDay(job?.closes_at)} className={input} />
              <span className="text-xs text-muted-foreground">Depois desse dia a vaga sai do site sozinha, mesmo publicada.</span>
            </label>
            <label className="mt-3 block text-sm font-medium">Prioridade (menor aparece primeiro)<input name="priority" type="number" min={0} max={999} defaultValue={job?.priority ?? 100} className={input} /></label>
            {job?.closed_at && <p className="mt-3 text-xs text-muted-foreground">Encerrada em {new Date(job.closed_at).toLocaleString("pt-BR", { timeZone: "America/Fortaleza" })}.</p>}
            <Button type="submit" className="mt-4 w-full" disabled={saving}>{saving ? "Salvando..." : "Salvar vaga"}</Button>
          </Card>
        </div>
      </form>
    </>
  );
}
