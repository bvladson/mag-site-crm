import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus } from "lucide-react";
import { listJobsAdmin } from "@/lib/hr.functions";
import { jobDate } from "@/config/careers";
import { Loading, ErrorState, Empty, PageTitle, StatusBadge, tableCls } from "@/components/interno/ui";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/interno/vagas/")({ component: JobsList });

function JobsList() {
  const fn = useServerFn(listJobsAdmin);
  const q = useQuery({ queryKey: ["interno", "jobs"], queryFn: () => fn() });
  return (
    <>
      <PageTitle title="Vagas">
        <Button asChild><Link to="/interno/vagas/$id" params={{ id: "nova" }}><Plus /> Nova vaga</Link></Button>
      </PageTitle>
      <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
        Só vagas <b>publicadas</b> e dentro do prazo aparecem em /carreiras. <b>Encerrada</b> mantém o endereço com aviso de encerramento
        (sem formulário e fora do Google); <b>rascunho</b> fica só aqui.
      </p>
      {q.isLoading ? <Loading /> : q.isError ? <ErrorState error={q.error} /> : !q.data?.length ? <Empty>Nenhuma vaga cadastrada ainda.</Empty> : (
        <div className="overflow-x-auto rounded-md border bg-card">
          <table className={tableCls}>
            <thead><tr><th>Vaga</th><th>Área</th><th>Status</th><th>Candidaturas</th><th>Aberta em</th><th>Inscrições até</th><th>Prioridade</th></tr></thead>
            <tbody>
              {q.data.map((j) => (
                <tr key={j.id}>
                  <td>
                    <Link to="/interno/vagas/$id" params={{ id: j.id }} className="font-semibold text-brand">{j.title}</Link>
                    <div className="text-xs text-muted-foreground">/carreiras/vagas/{j.slug}</div>
                  </td>
                  <td>{j.area ?? "-"}</td>
                  <td><StatusBadge s={j.status === "publicada" && !j.open ? "encerrada" : j.status} />{j.status === "publicada" && !j.open && <div className="text-xs text-muted-foreground">prazo vencido</div>}</td>
                  <td>{j.applications > 0 ? <Link to="/interno/candidaturas" search={{ vaga: j.id }} className="font-semibold text-brand underline">{j.applications}</Link> : 0}</td>
                  <td className="whitespace-nowrap">{j.opened_at ? jobDate(j.opened_at) : "-"}</td>
                  <td className="whitespace-nowrap">{j.closes_at ? jobDate(j.closes_at) : "-"}</td>
                  <td>{j.priority}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
